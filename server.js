import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import axios from 'axios';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenerativeAI } from '@google/generative-ai';

dotenv.config();

const {
    ELEVENLABS_API_KEY,
    ELEVENLABS_AGENT_ID,
    ELEVENLABS_AGENT_PHONE_NUMBER_ID,
    GEMINI_API_KEY,
} = process.env;

if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !ELEVENLABS_AGENT_PHONE_NUMBER_ID) {
    console.warn('[WARN] Missing ELEVENLABS env vars. Fill .env to enable phone calling.');
}

if (!GEMINI_API_KEY) {
    console.warn('[WARN] Missing GEMINI_API_KEY. Fill .env to enable doubt solving.');
}

const app = express();
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// CORS: front-end origin only
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
const PORT = process.env.PORT || 3000;

app.use(
    cors({
        origin: CORS_ORIGIN,
        methods: ['GET', 'POST'],
        allowedHeaders: ['Content-Type']
    })
);

// Static hosting
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, 'public')));

// Health
app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.post('/api/solve-doubt', async (req, res) => {
    try {
        if (!GEMINI_API_KEY) {
            return res.status(500).json({ error: 'Server misconfigured: GEMINI_API_KEY missing.' });
        }

        const { doubt, conversationHistory = [] } = req.body || {};
        if (typeof doubt !== 'string' || !doubt.trim()) {
            return res.status(400).json({ error: 'Invalid "doubt". Provide a farming question.' });
        }

        // Check if user is saying thank you (end conversation)
        const thankYouPatterns = [
            /thank\s*you/i,
            /thanks/i,
            /bye/i,
            /goodbye/i,
            /that's\s*all/i,
            /that's\s*enough/i,
            /no\s*more\s*questions/i
        ];

        const isThankYou = thankYouPatterns.some(pattern => pattern.test(doubt.trim()));

        if (isThankYou) {
            return res.json({
                answer: "You're welcome! Call back anytime for more farming help. Have a great day!",
                isConversationEnd: true
            });
        }

        // Initialize the Google Generative AI client (similar to Python version)
        const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

        // Get the model - using gemini-1.5-flash (stable available model)
        // Configuration optimized for concise phone call responses
        const model = genAI.getGenerativeModel({
            model: "gemini-1.5-flash",
            generationConfig: {
                temperature: 0.3,      // Lower creativity for more focused responses
                topP: 0.8,            // More focused responses
                topK: 20,             // Limited token sampling for brevity
                maxOutputTokens: 200, // Very concise answers for phone simulation
            },
            // Optimized for quick, direct phone conversation responses
        });

        // Build conversation context
        let conversationContext = '';
        if (conversationHistory.length > 0) {
            conversationContext = '\n\nPrevious conversation:\n';
            conversationHistory.forEach(item => {
                conversationContext += `Farmer: ${item.question}\nAdvisor: ${item.answer}\n\n`;
            });
        }

        // Construct the prompt for farming-specific context with conversation history
        const prompt = `You are an expert agricultural advisor on a phone call with a farmer. Give SHORT, practical answers in 1-2 sentences maximum. Speak like you're talking on the phone - be direct and helpful.${conversationContext}

Current Farmer's Question: ${doubt}

Give a brief, actionable answer (max 30 words). If you need more info, ask one short follow-up question:`;

        // Generate content (similar to Python client.models.generate_content)
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const answer = response.text();

        if (!answer || answer.trim() === '') {
            throw new Error('Empty response from AI model');
        }

        res.json({
            answer: answer.trim(),
            isConversationEnd: false
        });
    } catch (err) {
        console.error('Gemini API error:', err.message || err);

        // Fallback response for errors
        const fallbackAnswer = "Sorry, connection issue. Can you repeat your question?";

        res.status(500).json({
            error: `Doubt solving failed: ${err.message}`,
            fallback: fallbackAnswer
        });
    }
});

// Start a phone call via ElevenLabs ConvAI (server-side only)
app.post('/api/start-call', async (req, res) => {
    try {
        if (!ELEVENLABS_API_KEY || !ELEVENLABS_AGENT_ID || !ELEVENLABS_AGENT_PHONE_NUMBER_ID) {
            return res.status(500).json({ error: 'Server misconfigured: ElevenLabs env vars missing.' });
        }

        const { to_number } = req.body || {};
        if (typeof to_number !== 'string' || !to_number.replace(/\D/g, '').match(/^\d{10,}$/)) {
            return res.status(400).json({ error: 'Invalid "to_number". Provide a real phone number.' });
        }

        const url = 'https://api.elevenlabs.io/v1/convai/twilio/outbound-call';

        const payload = {
            agent_id: ELEVENLABS_AGENT_ID,
            agent_phone_number_id: ELEVENLABS_AGENT_PHONE_NUMBER_ID,
            to_number
        };

        const { data } = await axios.post(url, payload, {
            headers: { 'xi-api-key': ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
            timeout: 20000
        });

        // Expected: { success, message, conversation_id, callSid, ... }
        res.json(data);
    } catch (err) {
        const msg = err?.response?.data?.message || err?.response?.data || err.message;
        res.status(500).json({ error: `ElevenLabs call failed: ${msg}` });
    }
});

// Optional: fetch conversation metadata (status/transcript availability)
// NOTE: Endpoint names may evolve; adjust to your account docs if needed.
app.get('/api/conversation/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const url = `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(id)}`;

        const { data } = await axios.get(url, {
            headers: { 'xi-api-key': ELEVENLABS_API_KEY }
        });

        res.json(data);
    } catch (err) {
        const msg = err?.response?.data?.message || err?.response?.data || err.message;
        res.status(500).json({ error: `Failed to fetch conversation: ${msg}` });
    }
});

// Fallback to index.html (single-page style)
app.get('*', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`CORS origin: ${CORS_ORIGIN}`);
});
