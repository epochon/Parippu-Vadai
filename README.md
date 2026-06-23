

# FarmLink 🌾

> Bridging the gap between farmers and vendors — one phone call at a time.

Most farmers don't have smartphones. Many aren't online at all. FarmLink solves this by letting farmers create a digital marketplace profile using nothing but a regular phone call. An AI agent handles the rest — vendors can then discover and contact them through a fully-featured web platform.

---

## The Problem

India has millions of small-scale farmers with produce to sell, but no digital presence. Vendors waste time sourcing through middlemen. The farmers miss out on fair prices. The barrier? Farmers don't have smartphones, don't use apps, and aren't on the internet.

**FarmLink's answer: if you can make a phone call, you can be on the marketplace.**

---

## How It Works

### For Farmers — Just Call

1. Farmer dials the FarmLink number (a real US number via Twilio)
2. An AI voice agent answers the call and has a natural conversation
3. The agent asks about their produce, quantity, location, pricing, and availability
4. That conversation gets transcribed and parsed into structured data
5. A profile is automatically created for them on the FarmLink marketplace

The farmer never touches a screen. Never downloads an app. Never types a word.

### For Vendors — Browse the Marketplace

1. Vendors sign up and log in to the FarmLink web platform
2. They browse farmer profiles — produce type, quantity, location, availability
3. They find what they need and connect directly with the farmer

---

## Tech Stack

| Layer | Technology |
|---|---|
| AI Voice Agent | ElevenLabs Conversational AI |
| Phone Number | Twilio (US number) |
| Conversation Extraction | ElevenLabs API (via Conversation ID) |
| Database | MongoDB |
| Backend | Node.js + JWT Auth (built from scratch) |
| Auth | JWT access tokens + refresh token flow |
| API Testing | Postman |
| Frontend | Web (farmer profiles, vendor dashboard) |

---

## Architecture

```
Farmer Phone Call
      │
      ▼
 Twilio Number
      │
      ▼
ElevenLabs AI Agent (voice conversation)
      │
      ▼
ElevenLabs API → Conversation transcript (via Conversation ID)
      │
      ▼
Profile Parser → Structured farmer profile
      │
      ▼
MongoDB (profile stored)
      │
      ▼
Web Platform → Vendor browses profiles
```

---

## Features

- 📞 **Call-based onboarding** — zero smartphone or internet required for farmers
- 🤖 **AI voice agent** — natural conversation, not a rigid IVR menu
- 👤 **Auto-generated profiles** — structured data extracted from free-form conversation
- 🔐 **Full auth system** — JWT access tokens, secure login, built from scratch
- 🛒 **Vendor marketplace** — browse, filter, and connect with farmers
- 🗄️ **MongoDB backend** — profiles persisted and served to the web platform

---

## Built At

FarmLink was built as a hackathon project exploring how AI voice agents can bridge the digital divide in agricultural supply chains.

---

## Team

Built by team Parippu-Vadai.