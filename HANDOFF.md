# Kelionai — Handoff (read me first)

> ⚠️ **ÎNVECHIT (11 iul 2026).** Acest fișier presupune root-ul Windows
> `C:\Users\adria\Kelionai` — proiectul e migrat pe VPS Linux de pe 9 iul.
> **Sursa de adevăr e `AI-HANDOFF.md`** (rădăcina proiectului). Citește acolo.

This is the **live** Kelionai app. If you are a fresh Claude session opening this
folder, read this file, then `STATUS.md`, then `README.md`.

## Where everything is

- **Project root (open THIS as the working folder):** `C:\Users\adria\Kelionai`
- `backend/` — Node + Fastify server (chat, voice/TTS, Google skills, auth, DB)
- `frontend/` — React + Vite UI (3D avatar, chat, camera vision, voice)
- `Dockerfile` — imaginea aplicației (rulează pe VPS; Railway scos 22 iul 2026)
- Do **NOT** use `C:\Users\adria\Downloads\k` — that is the old/archived project.

## How we work

- The owner (adrianenc11@gmail.com, sole admin) **tests live** on the deployed
  site, not locally. After each fixed requirement: **build, then deploy.**
- Replies to the owner are in **Romanian**.
- Keep the chat/voice path low-latency — don't add unjustified delays.

## Build & deploy

```bash
# from the repo root, on a branch:
cd backend  && npx tsc            # backend build  → backend/dist
cd ../frontend && npx vite build  # frontend build → frontend/dist
# deploy: NU manual. Merge-ul în `master` e publicat AUTOMAT de cronul de pe VPS
# (deploy/auto-publicare.sh → deploy/deploy.sh, build Docker pe VPS → kelionai.app).
```

- Gazda: **VPS propriu** (`164.68.120.87`), container `kelionai-app` în spatele Caddy.
  **Railway a fost SCOS (22 iul 2026)** — nu mai există proiect/serviciu/deploy pe railway.app.
- Verify after deploy: `curl https://kelionai.app/api/version` (`v` == sha `master`) + `/health` = 200.

## Local dev

```bash
cd backend  && npm run dev   # tsx watch on :8080
cd frontend && npm run dev   # vite on :5173 (proxies /api,/auth to backend)
```
Backend needs `backend/.env` (Google OAuth, ANTHROPIC_API_KEY, SESSION_SECRET,
optional DATABASE_URL, SERPER_API_KEY, GOOGLE_SERVICE_ACCOUNT_JSON for Chirp TTS).

## Current state (2026-06-30)

Just shipped, on top of the voice/vision/skills build:
1. **Google skills survive past 1h** — the OAuth **refresh token** is now stored
   in the session and the chat route mints a fresh access token automatically
   (before, the access token expired after ~1h and every skill returned 401).
2. **Device GPS is wired into the brain** — the frontend sends live coordinates
   with each chat turn; the backend reverse-geocodes (cached) and tells Claude
   where "here"/"near me" is, so weather/maps/location skills work.
3. **Monitor is automatic** — the manual "monitor mode" button is gone; Kelion
   opens the screen himself via the `show_on_screen` tool (a `\x1f…\x1f` control
   frame on the chat stream that the frontend strips and acts on).
4. **Camera switch is by voice/text** — the switch-camera button is gone; say or
   type "switch/comută/schimbă camera", "camera spate/față", "open/close camera".
5. **Multi-turn chat no longer dies after a turn or two** — the history is now
   sanitized in `backend/src/routes/chat.ts` (`sanitizeHistory`): empty turns are
   dropped, consecutive same-role turns merged, leading assistant turns removed,
   so Anthropic stops 400-ing. Root causes were a monitor-only (`show_on_screen`)
   reply leaving an empty assistant turn, and a local camera "ack" injecting an
   assistant turn with no user turn. The frontend also no longer stores an empty
   assistant bubble (`ChatPanel.tsx`).

## Known external config (NOT code — must be set in Google Cloud Console)

Project `gen-lang-client-0460348646`:
- **Enable APIs:** Calendar, Gmail, Drive, Tasks, People (Contacts), Cloud
  Text-to-Speech. A disabled API makes the matching skill return `*_http_403`.
- **OAuth consent screen:** the "this app isn't verified / you're leaving a safe
  area" warning at login is because the app requests **restricted** scopes
  (Gmail read/send, Drive, Contacts) and is unverified — it is **not** a missing
  TLS certificate. Add the owner as a **Test user** (Testing mode) to soften it,
  or submit for verification to remove it. As the sole test user you can click
  **Advanced → continue** to proceed.
- After scope changes the user must **sign in again** to grant the new consent.
