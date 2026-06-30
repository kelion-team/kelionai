# Kelionai — Status

> Where the build is right now. Updated as milestones land. The full locked
> product spec lives in Claude's project memory (`kelion-rewrite-spec.md`).

_Last updated: 2026-06-30_

## ✅ Live on kelionai.app

- **Auth** — Google login, allowlisted to `adrianenc11@gmail.com` (sole admin).
  Google **refresh token** stored in the session; chat route mints a fresh access
  token per turn, so skills survive past the ~1h access-token expiry.
- **Avatar** — 3D Ready Player Me, idle animation (breathing, blink, micro-motion),
  viseme-aware lip-sync (vowel/consonant/space from the TTS spectrum).
- **Brain** — streaming chat with Claude (Opus 4.8), adaptive Jarvis persona.
  History is sanitized server-side (drop empty turns, merge same-role, force a
  user-first start) so multi-turn voice chat no longer 400s after a turn or two.
- **Chat tab** — always-on-top, shows only the latest message, ChatGPT-style ⊕
  functions menu. UI language follows the Google account locale (en/ro).
- **Voice — hearing** — permanent, hands-free listening (no button). "Hey Kelion"
  wake word; ~1 min silence → standby. Web Speech API (Google engine in Chrome).
  Full-duplex path: browser AEC + VAD + Google Chirp STT (talk over Kelion, no echo).
- **Voice — speaking** — Google **Chirp 3 HD** (male, academic) via `/api/tts`,
  with the browser voice as automatic fallback. Voice + text in parallel
  (speaks each sentence as it streams). Say "stop/stai" to interrupt (barge-in).
- **Vision** — permanent camera (front by default), **voice/text-controlled**
  ("switch/comută camera", "camera spate/față", "open/close"); the latest frame
  goes to Claude's native vision **on each turn** (cheap policy). Floating glass
  preview, top-left.
- **GPS** — permanent `watchPosition` (free), live coords sent with each chat
  turn; backend reverse-geocodes (cached) so "here"/"near me" resolves. Capture
  1 fps still, 4 fps moving, scaling with speed.
- **Google skills (14 tools)** — generic tool-use framework. Claude can call
  **Calendar** (read + create events), **Gmail** (read + send), **Drive**,
  **Tasks** (list/add), **Contacts**, plus **web search** (Serper), **weather**,
  **maps** (OSM), **YouTube** (Serper), **translate** (Gemini).
- **Automatic monitor** — Kelion opens the screen himself via the `show_on_screen`
  tool (control frame on the chat stream); no manual monitor button.

## 🔑 Credentials

- `GOOGLE_SERVICE_ACCOUNT_JSON` — set in Railway (Chirp 3 HD). ✅
- LiveKit (`LIVEKIT_URL/API_KEY/API_SECRET`) — in backup, **not yet set** (for
  full-duplex). `VITE_GOOGLE_MAPS_KEY` — in backup (for the Maps skill).
- **Picovoice** — not available; wake word runs on the interim Web Speech match.
- Gmail/Calendar APIs must be **enabled** in Google Cloud project
  `gen-lang-client-0460348646`, and the user must **re-login** to grant the new
  scopes (consent screen for Calendar + Gmail).

## 🚧 Next

- Skill result **cards** (MapCard, EmailList, CalendarView…) — replace raw text.
- Full-duplex voice over **LiveKit** (echo-cancelled hardware path; keys in backup,
  not yet set). **Picovoice Porcupine** wake word (real low-power engine).
- Cross-session memory; monetization (credits/Stripe, 75/25 split); admin panel.
- Engineering: persistent DB + encrypted Google refresh tokens, avatar `.glb`
  optimization, credit checks before AI calls, rate limiting, tests, CI gate.

## ⚠️ Owner config (not code) — required for Google skills to work
- Google Cloud Console `gen-lang-client-0460348646`: **enable** Calendar, Gmail,
  Drive, Tasks, People (Contacts), Cloud TTS APIs (disabled API → `*_http_403`).
- **Re-login** on kelionai.app after scope changes to grant consent + get a
  refresh token.
