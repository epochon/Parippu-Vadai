import requests
import json
import time
from datetime import datetime
from openai import OpenAI

# ---------------------------
# CONFIG
# ---------------------------



# 2. PASTE THE ID FROM YOUR PHOTO HERE

ELEVEN_API_KEY = "sk_fbd27d80bee240d6dfb2e969eafddc22360af0b7e99ac309"
CONVERSATION_ID = "conv_7501kgvm1bhzfvtsqcf03ydh7cfv"

OPENAI_API_KEY = "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"

client = OpenAI(api_key=OPENAI_API_KEY)

# ---------------------------
# 1. FETCH CONVERSATION
# ---------------------------
url = f"https://api.elevenlabs.io/v1/convai/conversations/{CONVERSATION_ID}"
headers = {"xi-api-key": ELEVEN_API_KEY}

res = requests.get(url, headers=headers)
res.raise_for_status()

data = res.json()
transcript = data.get("transcript", [])

# ---------------------------
# 2. EXTRACT ONLY USER SPEECH
# ---------------------------
user_text = []
for msg in transcript:
    if msg.get("role") == "user":
        text = msg.get("message", "").strip()
        if len(text) > 2:
            user_text.append(text)

conversation_text = "\n".join(user_text)

# ---------------------------
# 3. AI EXTRACTION PROMPT
# ---------------------------
prompt = f"""
You are an information extraction assistant.

From the following conversation, extract a FARMER PROFILE.

Return ONLY valid JSON in this exact format:

{{
  "name": "",
  "location": "",
  "farmSize": "",
  "crops": "",
  "organic": "",
  "selling": "",
  "challenges": "",
  "contact": ""
}}

Rules:
- If a field is unknown, return an empty string
- Do NOT hallucinate
- Use simple human-readable values

Conversation:
\"\"\"
{conversation_text}
\"\"\"
"""

# ---------------------------
# 4. CALL AI
# ---------------------------
completion = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": prompt}],
    temperature=0
)

profile = json.loads(completion.choices[0].message.content)

# ---------------------------
# 5. FINAL OUTPUT
# ---------------------------
final_output = {
    "id": int(time.time() * 1000),
    "timestamp": datetime.utcnow().isoformat() + "Z",
    "profile": profile,
    "type": "profile"
}

print(json.dumps(final_output, indent=2))
