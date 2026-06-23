import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose';
import { setServers } from 'node:dns/promises';

setServers(['1.1.1.1', '8.8.8.8']);
dotenv.config();

const app  = express();
const PORT = 4001;

app.use(express.json());
app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// ─── Keys ─────────────────────────────────────────────────────────────────────
const ELEVENLABS_KEY = process.env.ELEVENLABS_API_KEY;
const GEMINI_KEY     = process.env.GEMINI_API_KEY;

if (!ELEVENLABS_KEY) console.error('❌ ELEVENLABS_API_KEY missing in .env');
if (!GEMINI_KEY)     console.error('❌ GEMINI_API_KEY missing in .env');

// ─── MongoDB ──────────────────────────────────────────────────────────────────
mongoose.connect(process.env.MONGODB)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => console.error('❌ MongoDB error:', err));

const profileSchema = new mongoose.Schema({
  conversationId: { type: String, unique: true, sparse: true },
  timestamp:      { type: Date, default: Date.now },
  profile: {
    name:       { type: String, default: '' },
    location:   { type: String, default: '' },
    farmSize:   { type: String, default: '' },
    crops:      { type: String, default: '' },
    organic:    { type: String, default: '' },
    selling:    { type: String, default: '' },
    challenges: { type: String, default: '' },
    contact:    { type: String, default: '' },
  },
  rawTranscript: { type: String, default: '' },
  type: { type: String, default: 'profile' },
});
const Profile = mongoose.model('Profile', profileSchema);

// ═══════════════════════════════════════════════════════════════════════════════
// ELEVENLABS HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

// Returns array of conversation objects sorted newest first
// Each item: { conversation_id, status, call_duration_secs, start_time_unix_secs, ... }
async function listConversations(pageSize = 10) {
  const { data } = await axios.get(
    'https://api.elevenlabs.io/v1/convai/conversations',
    {
      headers: { 'xi-api-key': ELEVENLABS_KEY },
      params:  { page_size: pageSize },
    }
  );
  return data?.conversations || [];
}

// Returns raw transcript array: [{ role: 'user'|'agent', message: '...', time_in_call_secs }]
async function fetchTranscriptRaw(conversationId) {
  const { data } = await axios.get(
    `https://api.elevenlabs.io/v1/convai/conversations/${conversationId}`,
    { headers: { 'xi-api-key': ELEVENLABS_KEY } }
  );
  return {
    transcript: data?.transcript || [],
    metadata: {
      status:       data?.status,
      agentId:      data?.agent_id,
      startTime:    data?.metadata?.start_time_unix_secs,
      callDuration: data?.metadata?.call_duration_secs,
    }
  };
}

// Converts transcript array → readable string for Gemini
function transcriptToText(transcriptArray) {
  return transcriptArray
    .map(t => `${t.role === 'user' ? 'FARMER' : 'AGENT'}: ${t.message}`)
    .join('\n');
}

// ═══════════════════════════════════════════════════════════════════════════════
// GEMINI EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════════

async function extractProfileWithGemini(transcriptText) {
  if (!GEMINI_KEY) return emptyProfile();

  const genAI = new GoogleGenerativeAI(GEMINI_KEY);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

  const prompt = `
You are extracting structured data from a farmer onboarding phone call transcript.

Transcript:
"""
${transcriptText}
"""

Return ONLY a valid JSON object with exactly these keys (use "" if not mentioned):
{
  "name": "",
  "location": "",
  "farmSize": "",
  "crops": "",
  "organic": "",
  "selling": "",
  "challenges": "",
  "contact": ""
}

Rules:
- name: farmer full name
- location: village/town and state
- farmSize: land area (acres/hectares)
- crops: all crops mentioned, comma-separated
- organic: "yes", "no", or farming method mentioned
- selling: how/where they sell produce (broker, mandi, direct, export, etc.)
- challenges: any problems or difficulties mentioned by the farmer
- contact: phone number if spoken

Return ONLY the JSON. No markdown fences, no explanation.
`.trim();

  const result  = await model.generateContent(prompt);
  const rawText = result.response.text().trim();

  // Strip markdown code fences if Gemini adds them
  const clean = rawText
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i,     '')
    .replace(/```\s*$/i,     '')
    .trim();

  try {
    const p = JSON.parse(clean);
    return {
      name:       String(p.name       || ''),
      location:   String(p.location   || ''),
      farmSize:   String(p.farmSize   || ''),
      crops:      String(p.crops      || ''),
      organic:    String(p.organic    || ''),
      selling:    String(p.selling    || ''),
      challenges: String(p.challenges || ''),
      contact:    String(p.contact    || ''),
    };
  } catch (e) {
    console.error('❌ Gemini JSON parse failed. Raw output:\n', clean);
    return emptyProfile();
  }
}

function emptyProfile() {
  return { name:'', location:'', farmSize:'', crops:'', organic:'', selling:'', challenges:'', contact:'' };
}

// ═══════════════════════════════════════════════════════════════════════════════
// CORE PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════

async function processConversation(conversationId) {
  // 1. Skip if already in DB
  const existing = await Profile.findOne({ conversationId });
  if (existing) {
    console.log(`⏭️  Already saved: ${conversationId}`);
    return { skipped: true, reason: 'already_saved', data: existing };
  }

  // 2. Fetch transcript
  console.log(`📥 Fetching transcript: ${conversationId}`);
  const { transcript: rawTranscript } = await fetchTranscriptRaw(conversationId);

  if (!rawTranscript.length) {
    throw new Error(`Transcript empty for ${conversationId} — call may still be processing`);
  }

  const transcriptText = transcriptToText(rawTranscript);
  console.log(`📄 Transcript (${rawTranscript.length} messages):\n${transcriptText}\n`);

  // 3. Extract profile with Gemini
  console.log('🤖 Sending to Gemini for extraction...');
  const profile = await extractProfileWithGemini(transcriptText);
  console.log('👤 Extracted:', profile);

  // 4. Save to MongoDB
  const doc = new Profile({
    conversationId,
    profile,
    rawTranscript: transcriptText,
    type: 'profile',
  });
  await doc.save();
  console.log('✅ Saved to MongoDB:', conversationId);

  return { skipped: false, data: doc };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// ── POST /savenew — manual trigger (test from Postman / curl) ─────────────────
// Body options:
//   {}                              → picks the absolute latest conversation
//   { "conversation_id": "conv_X" } → process a specific conversation
//   { "agent_id": "agent_X" }       → filter by agent, picks latest from that agent
//   { "sync_all": true }            → process ALL conversations not yet in DB
app.post('/savenew', async (req, res) => {
  console.log('\n🔄 POST /savenew', req.body);

  try {
    // OPTION: sync all unprocessed conversations
    if (req.body?.sync_all) {
      const allConvs = await listConversations(50);
      const results  = [];

      for (const conv of allConvs) {
        try {
          const r = await processConversation(conv.conversation_id);
          results.push({ conversation_id: conv.conversation_id, ...r });
        } catch (e) {
          results.push({ conversation_id: conv.conversation_id, error: e.message });
        }
      }

      const total = await Profile.countDocuments();
      return res.json({ success: true, total, results });
    }

    // OPTION: specific conversation_id in body
    let conversationId = req.body?.conversation_id;

    // OPTION: latest (optionally filtered by agent_id)
    if (!conversationId) {
      const convs = await listConversations(1);

      // filter by agent_id if provided
      const filtered = req.body?.agent_id
        ? convs.filter(c => c.agent_id === req.body.agent_id)
        : convs;

      if (!filtered.length) {
        return res.status(404).json({ success: false, message: 'No conversations found in ElevenLabs' });
      }

      conversationId = filtered[0].conversation_id;
    }

    console.log('Processing:', conversationId);
    const result = await processConversation(conversationId);
    const total  = await Profile.countDocuments();

    res.json({ success: true, total, conversationId, ...result });

  } catch (err) {
    console.error('❌ /savenew error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /webhook/elevenlabs — ElevenLabs calls this after every call ──────────
// Set in ElevenLabs: Agent → Post-call webhook → https://YOUR_DOMAIN/webhook/elevenlabs
app.post('/webhook/elevenlabs', async (req, res) => {
  console.log('\n📲 Webhook received from ElevenLabs');
  console.log('Payload keys:', Object.keys(req.body));

  try {
    // ElevenLabs sends conversation_id at top level
    const conversationId = req.body?.conversation_id || req.body?.data?.conversation_id;

    if (!conversationId) {
      console.warn('⚠️  No conversation_id found in webhook payload:', req.body);
      return res.status(400).json({ success: false, message: 'Missing conversation_id' });
    }

    // Respond to ElevenLabs immediately (they have a timeout)
    res.status(200).json({ success: true, received: conversationId });

    // Process in background
    processConversation(conversationId).catch(err =>
      console.error(`❌ Background processing failed for ${conversationId}:`, err.message)
    );

  } catch (err) {
    console.error('❌ Webhook error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /profiles — all saved farmer profiles ──────────────────────────────────
app.get('/profiles', async (_req, res) => {
  try {
    const profiles = await Profile.find().sort({ timestamp: -1 });
    res.json({ success: true, count: profiles.length, data: profiles });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /debug/conversations — see what's in ElevenLabs ───────────────────────
app.get('/debug/conversations', async (req, res) => {
  try {
    const convs = await listConversations(10);
    res.json({
      count: convs.length,
      conversations: convs.map(c => ({
        conversation_id:    c.conversation_id,
        status:             c.status,
        call_duration_secs: c.call_duration_secs,
        started_at:         new Date(c.start_time_unix_secs * 1000).toISOString(),
        agent_id:           c.agent_id,
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── GET /debug/transcript/:id — see raw transcript ────────────────────────────
app.get('/debug/transcript/:id', async (req, res) => {
  try {
    const { transcript, metadata } = await fetchTranscriptRaw(req.params.id);
    res.json({
      conversationId: req.params.id,
      metadata,
      messageCount: transcript.length,
      transcript: transcript.map(t => ({
        role: t.role,
        message: t.message,
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.response?.data || err.message });
  }
});

// ── GET /health ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date() }));

// ─────────────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🚀 Server: http://localhost:${PORT}`);
  console.log('');
  console.log('  TEST THESE IN ORDER:');
  console.log('  1. GET  /debug/conversations          → confirm ElevenLabs API key works');
  console.log('  2. GET  /debug/transcript/<conv_id>   → confirm transcript is readable');
  console.log('  3. POST /savenew                      → process latest → save to MongoDB');
  console.log('  4. POST /savenew  { sync_all: true }  → process ALL past conversations');
  console.log('  5. GET  /profiles                     → see everything saved in MongoDB');
  console.log('');
  console.log('  AUTO: POST /webhook/elevenlabs         → ElevenLabs calls this after each call');
});