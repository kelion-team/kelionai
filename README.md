# Kelionai

KelionAI v3 — a clean, independent rewrite. 3D voice/chat AI assistant (Jarvis-style).

> **Canonical project location (permanent):** `C:\Users\adria\Kelionai`
> This is a brand-new project with **zero** relationship to the old KelionAI app.

## Spec / contract

The full, locked product + engineering spec lives in Claude's project memory
(`kelion-rewrite-spec.md`). It is the authoritative contract — build to it exactly.

## Current status

Live: **Google login** (allowlisted to `adrianenc11@gmail.com`, the permanent sole admin),
the **3D avatar**, and **Brain v1** — streaming chat with Claude in a text tab, plus a
first **voice** increment (browser Web Speech API: Kelion speaks replies and listens,
with a **continuous-listening** toggle; voice and text are delivered in parallel).

Next voice steps: Google Chirp 3 HD male voice, "Hey Kelion" wake word, and the
LiveKit full-duplex transmission. The `speak()` layer is isolated so the TTS engine
can be swapped to Chirp 3 HD without touching the chat UI.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React + Vite + TypeScript + React Three Fiber |
| Backend | Node + Fastify + TypeScript |
| Auth | Google OAuth (Sign in with Google) + signed session cookie |
| DB | PostgreSQL (later milestones) |
| Deploy | VPS propriu (Railway scos, 22 iul 2026), domain `kelionai.app` |

## Engineering rules (non-negotiable)

1. Fix errors by **rewriting** the module, never band-aid patches.
2. **Stop & repair** gate — no progress while typecheck/lint/tests are red.
3. **200-only** — every endpoint check must return HTTP 200; anything else goes back to repair.
4. **Anti-dead-code** — knip/ts-prune in CI; verify before deleting.

## Local development

```bash
# backend
cd backend && npm install && npm run dev
# frontend (separate terminal)
cd frontend && npm install && npm run dev
```

Create `backend/.env` from `backend/.env.example` first.
