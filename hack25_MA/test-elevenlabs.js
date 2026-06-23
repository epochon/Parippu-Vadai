// Quick test script — run with: node test-elevenlabs.js
// This will show you exactly what ElevenLabs returns

import axios from 'axios';
import dotenv from 'dotenv';
dotenv.config();

const KEY = process.env.ELEVENLABS_API_KEY;

if (!KEY) {
  console.error('❌ No ELEVENLABS_API_KEY in .env');
  process.exit(1);
}

console.log('🔑 Using key:', KEY.slice(0, 10) + '...');

// Step 1: List conversations
console.log('\n── Step 1: Fetching conversation list ──');
const listRes = await axios.get('https://api.elevenlabs.io/v1/convai/conversations', {
  headers: { 'xi-api-key': KEY },
  params: { page_size: 5 }
});

const conversations = listRes.data?.conversations || [];
console.log(`Found ${conversations.length} conversations:`);
conversations.forEach((c, i) => {
  console.log(`  ${i+1}. ${c.conversation_id} | status: ${c.status} | duration: ${c.call_duration_secs}s | started: ${new Date(c.start_time_unix_secs * 1000).toLocaleString()}`);
});

if (conversations.length === 0) {
  console.log('❌ No conversations found. Check your API key.');
  process.exit(1);
}

// Step 2: Get transcript of latest
const latestId = conversations[0].conversation_id;
console.log(`\n── Step 2: Fetching transcript for ${latestId} ──`);
const transcriptRes = await axios.get(
  `https://api.elevenlabs.io/v1/convai/conversations/${latestId}`,
  { headers: { 'xi-api-key': KEY } }
);

const transcript = transcriptRes.data?.transcript || [];
console.log(`Transcript has ${transcript.length} messages:`);
transcript.forEach((t, i) => {
  console.log(`  ${t.role === 'user' ? 'FARMER' : 'AGENT '}: ${t.message?.slice(0, 80)}...`);
});
