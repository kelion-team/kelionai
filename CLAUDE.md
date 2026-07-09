# Kelionai — project guide for Claude (auto-loaded)

You are working on **Kelionai**, a live AI assistant (3D avatar, voice, vision,
Google skills) deployed at **kelionai.app**. This file is your standing context.
On a fresh session, also read **HANDOFF.md** and **STATUS.md** in this folder.

## Working rules (non-negotiable)
- **Reply to the owner in Romanian.** Owner = adrianenc11@gmail.com, sole admin.
- The owner **tests live** on kelionai.app, not locally. After each fixed
  requirement: **build, then deploy** — don't batch many changes undeployed.
- Keep the chat/voice path **low-latency**; don't add unjustified delays.
- Fix by rewriting the small responsible module — no band-aid patches.
- Don't touch `C:\Users\adria\Downloads\k` — that's the OLD archived project.

## Layout
- `backend/`  — Node + Fastify + TS. Routes in `src/routes/` (auth, chat, tts,
  asr, prefs, admin, correct). Google skills in `src/services/google.ts`.
- `frontend/` — React + Vite + TS. Main UI in `src/components/ChatPanel.tsx`,
  3D stage in `src/pages/Stage.tsx`, voice in `src/lib/voice.ts`.
- `Dockerfile`, `railway.json` — deploy.

## Build & deploy (Linux-first)
Proiectul se bazează acum pe un VPS Linux pentru dezvoltare și Railway pentru producție.
```bash
# Pe VPS (/root/kelion)
git pull origin master
railway up --detach
```
Adminul folosește interfața din `https://kelionai.app` pentru a trimite comenzi către Puntea de pe VPS.

## Local dev
`cd backend && npm run dev` (:8080) + `cd frontend && npm run dev` (:5173).
Backend needs `backend/.env`: GOOGLE_CLIENT_ID/SECRET, GOOGLE_REDIRECT_URI,
SESSION_SECRET, ANTHROPIC_API_KEY, optional DATABASE_URL, SERPER_API_KEY,
GOOGLE_SERVICE_ACCOUNT_JSON (Chirp 3 HD TTS), GEMINI_API_KEY (transcript fix).

## What's live (see STATUS.md for detail)
Google OAuth (allowlisted to the owner), 3D RPM avatar, streaming Claude Opus 4.8
brain, hands-free voice (Web Speech + "Hey Kelion" wake word, Chirp 3 HD TTS,
barge-in), permanent camera vision (latest frame → Claude per turn), permanent
GPS, 14 tool-use skills (Calendar, Gmail, Drive, Tasks, Contacts, web search,
weather, maps, YouTube, translate), automatic monitor (`show_on_screen`),
voice/text camera control.

## External config the OWNER must do (NOT code) for skills to work
- Google Cloud Console project `gen-lang-client-0460348646`: **enable** the
  Calendar, Gmail, Drive, Tasks, People (Contacts) and Cloud TTS APIs. A disabled
  API makes that skill return `*_http_403`.
- After scope/code changes the owner must **sign in again** on kelionai.app to
  get a refresh token and grant consent. The login "app not verified / leaving a
  safe area" warning is the unverified-app + restricted-scope consent screen —
  **not** a missing TLS certificate.

## Next milestones (not built yet)
Picovoice wake word, LiveKit full-duplex voice, skill result cards, cross-session
memory, monetization (credits/Stripe, 75/25 split), admin panel.
The full locked product spec lives in the owner's Claude project memory
(`kelion-rewrite-spec.md`); HANDOFF.md mirrors the operational essentials.
