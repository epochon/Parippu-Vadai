import requests

# 1. Your Credentials
API_KEY = "sk_fbd27d80bee240d6dfb2e969eafddc22360af0b7e99ac309"

# 2. PASTE THE ID FROM YOUR PHOTO HERE
CONVERSATION_ID = "conv_7501kgvm1bhzfvtsqcf03ydh7cfv" 

url = f"https://api.elevenlabs.io/v1/convai/conversations/{CONVERSATION_ID}"

headers = {
    "xi-api-key": API_KEY,
}

response = requests.get(url, headers=headers)

if response.status_code == 200:
    data = response.json()
    
    # ElevenLabs stores the dialogue in the 'transcript' list
    transcript = data.get("transcript", [])
    
    print(f"\n--- Transcript for {CONVERSATION_ID} ---\n")
    
    if not transcript:
        print("No messages found in this conversation.")
    
    for entry in transcript:
        role = entry.get("role")     # 'user' or 'agent'
        text = entry.get("message")  # The actual spoken/typed text
        
        # Clean up the role name for display
        display_role = "YOU" if role == "user" else "AGENT"
        print(f"{display_role}: {text}")
        print("-" * 30)

else:
    print(f"Error {response.status_code}: {response.text}")



import os
import json
import time
from datetime import datetime
from google import genai
from pydantic import BaseModel, Field

# 1. SETUP: Get your API key
# Ideally, set this as an environment variable: export GOOGLE_API_KEY='your_key'
api_key = os.environ.get("GOOGLE_API_KEY") or "AIzaSyCC0BT3-04VAQwOUsFbqDePoKMvYvfFeCA"

client = genai.Client(api_key=api_key)

# 2. DEFINE THE STRUCTURE (Schema)
# This forces the AI to output exactly this structure, no regex needed.
class FarmProfile(BaseModel):
    name: str = Field(description="Name of the farmer")
    location: str = Field(description="City and State of the farm")
    farmSize: str = Field(description="Size of the farm (e.g., 10 acres)")
    crops: str = Field(description="Crops grown")
    organic: str = Field(description="Farming practices (Organic/Standard/Chemicals)")
    selling: str = Field(description="How they sell (Broker, Market, Direct)")
    challenges: str = Field(description="Any challenges mentioned (e.g., pests, weather). Empty string if none.")
    contact: str = Field(description="Phone number")

def extract_farm_data(transcript: str):
    """
    Uses Gemini 1.5 Flash with the new SDK to extract structured data.
    """
    
    prompt = f"""
    You are a data entry assistant. Analyze the conversation transcript below.
    Extract the farm details into the structured format provided.
    If a detail is missing, use an empty string.

    TRANSCRIPT:
    {transcript}
    """

    try:
        # The new SDK supports structured output natively using 'response_schema'
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=prompt,
            config={
                'response_mime_type': 'application/json',
                'response_schema': FarmProfile,
            },
        )
        
        # The response is already a Python object corresponding to the Pydantic model
        return response.parsed
        
    except Exception as e:
        print(f"Error during extraction: {e}")
        return None

def create_final_json(transcript):
    """
    Wraps the extracted profile in the final required structure with timestamp.
    """
    
    # Extract the inner profile data
    profile_obj = extract_farm_data(transcript)
    
    if not profile_obj:
        return "{}"

    # Create the metadata
    current_time = datetime.utcnow().isoformat() + "Z"
    unique_id = int(time.time() * 1000) 
    
    # Construct the final dictionary
    final_output = {
        "id": unique_id,
        "timestamp": current_time,
        "profile": profile_obj.model_dump(), # Convert Pydantic object to dict
        "type": "profile"
    }
    
    return json.dumps(final_output, indent=2)

# --- EXAMPLE USAGE ---

conversation_text = response.text

if __name__ == "__main__":
    json_output = create_final_json(conversation_text)
    print(json_output)
profile_data = json.loads(json_output)

# Export as a string environment variable
os.environ["PROFILE"] = json.dumps(profile_data)

# Optional: keep the script alive or print the variable for JS
print(os.environ["PROFILE"])
