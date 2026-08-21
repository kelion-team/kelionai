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

Voice today: Google Chirp 3 HD + the Gemini Live full-duplex session (LiveKit
was removed from the codebase — any mention of it is history). The `speak()`
layer stays isolated from the chat UI.

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React + Vite + TypeScript + React Three Fiber |
| Backend | Node + Fastify + TypeScript |
| Auth | Google OAuth (Sign in with Google) + signed session cookie |
| DB | PostgreSQL (later milestones) |
| Deploy | VPS propriu, domain `kelionai.app` |

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

## Database backup & restore

English is the default language for ops docs.

### Automatic schedule

| Item | Detail |
| --- | --- |
| Script | `deploy/backup.sh` → `/root/kelion/backup.sh` |
| When | **Sunday 03:00 Europe/London** (`CRON_TZ=Europe/London`) |
| Files | `/root/kelion/backups/kelion-YYYY-MM-DD_HHMM.sql.enc` |
| Pipeline | `pg_dump` → `gzip` → AES-256-CBC (PBKDF2) |
| Key | `/root/kelion/backup.key` (root only) |
| Retention | 60 days |

**Code versions** (git tags `backup-…`) ≠ **database dumps** (`.sql.enc`). Admin → Recovery = code. Encrypted files = database.

### From Kelion chat (owner)

| Ask | Tool |
| --- | --- |
| List DB backups | `list_db_backups` |
| List app versions | `list_app_versions` |
| Save code checkpoint | `save_app_version` |
| Run DB backup now | `run_runbook` → `backup-db` |
| Rehearse restore (safe) | `run_runbook` → `proba-restaurare` |

Show results with `show_document` when asked. Production DB restore is destructive — only on explicit owner order. Prefer `proba-restaurare` first.

### SSH restore recipe

Always **gunzip** after decrypt (dump is gzipped before encryption):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/kelion/backup.key \
  -in /root/kelion/backups/kelion-YYYY-MM-DD_HHMM.sql.enc \
  | gunzip > /tmp/kelion-restore.sql
# Restore into a throwaway DB first; never production by default.
```

### User manual vs admin

- **Users**: in-app manual section *Your data and continuity* (no paths, keys, or restore commands).
- **Admin**: chat tools above, Admin → Recovery, this README.
- **Default language**: English (manual translates from the English source).
