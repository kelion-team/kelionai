# Kelionai — Status

> Where the build is right now. Updated as milestones land. The full locked
> product spec lives in Claude's project memory (`kelion-rewrite-spec.md`).

_Last updated: 2026-06-29_

## ✅ Live on kelionai.app

- **Auth** — Google login, allowlisted to `adrianenc11@gmail.com` (sole admin).
- **Avatar** — 3D Ready Player Me, idle animation (breathing, blink, micro-motion).
- **Brain** — streaming chat with Claude (Opus 4.8), adaptive Jarvis persona.
- **Chat tab** — always-on-top, shows only the latest message, ChatGPT-style ⊕
  functions menu. UI language follows the Google account locale (en/ro).
- **Voice — hearing** — permanent, hands-free listening (no button). "Hey Kelion"
  wake word; ~1 min silence → standby. Web Speech API (Google engine in Chrome).
- **Voice — speaking** — Google **Chirp 3 HD** (male, academic) via `/api/tts`,
  with the browser voice as automatic fallback. Voice + text in parallel
  (speaks each sentence as it streams). Say "stop/stai" to interrupt (barge-in).
- **Vision** — permanent camera (front by default) with a Disconnect button;
  the latest frame goes to Claude's native vision **on each turn** (cheap policy).
  Floating glass preview, top-right.
- **GPS** — permanent `watchPosition` (free); capture 1 fps still, 4 fps moving,
  scaling with speed. Governs local frame freshness.
- **Google skills (first slice)** — tool-use framework; Claude can call
  **Calendar** (upcoming events) and **Gmail** (recent messages, read-only).
- **Live web search** — `web_search` tool: real current Google results via
  Serper.dev. Claude searches the live web when it needs up-to-date info.

## 🔑 Credentials

- `GOOGLE_SERVICE_ACCOUNT_JSON` — set in Railway (Chirp 3 HD). ✅
- LiveKit (`LIVEKIT_URL/API_KEY/API_SECRET`) — in backup, **not yet set** (for
  full-duplex). `VITE_GOOGLE_MAPS_KEY` — in backup (for the Maps skill).
- **Picovoice** — not available; wake word runs on the interim Web Speech match.
- Gmail/Calendar APIs must be **enabled** in Google Cloud project
  `gen-lang-client-0460348646`, and the user must **re-login** to grant the new
  scopes (consent screen for Calendar + Gmail).

## 🚧 Next

- Google skills: Drive, Maps, more (framework is generic — add a tool def + a
  case). Result **cards** (MapCard, EmailList, CalendarView…).
- Full-duplex voice over **LiveKit** (talk over Kelion naturally, echo-cancelled).
- **Picovoice Porcupine** wake word (real low-power engine).
- Skill "monitor mode" (avatar pips to a corner; background becomes a workspace).
- Cross-session memory; monetization (credits/Stripe, 75/25 split); admin panel.
- Engineering: DB + encrypted Google refresh tokens, avatar `.glb` optimization,
  credit checks before AI calls, rate limiting, tests, CI gate.
