# Kelionai — project guide for Claude (auto-loaded)

You are working on **Kelionai**, a live AI assistant (3D avatar, voice, vision,
Google skills) deployed at **kelionai.app**. This file is your standing context.

## READ THIS FIRST, ALWAYS
**On a fresh session, read `AI-HANDOFF.md` in this folder BEFORE doing anything
else.** It is the single, actively-maintained source of truth: full architecture,
every route/service/component, the brain-routing rules, the database schema, all
env vars, the money flows, the "phantom deploy" postmortem + permanent fixes, CI
workflows, what's dead code vs. live code, and the current state of the project.
`HANDOFF.md` and `STATUS.md` in this folder are OLDER and PARTLY OUTDATED —
`AI-HANDOFF.md` supersedes them; don't treat them as current without checking.

## THE DOCUMENT IS LIVE — YOU MUST KEEP IT CURRENT
If you change code, architecture, rules, or the project's state, **update the
relevant section of `AI-HANDOFF.md` (and its §13 "Starea") before you finish
your session/PR.** There is no other auto-update mechanism — this convention is
the mechanism. A stale handoff doc is worse than none: it misleads the next AI.

## Working rules (non-negotiable) — full detail in AI-HANDOFF.md §1
- **Reply to the owner in Romanian.** Owner = adrianenc11@gmail.com, sole admin.
- The owner **tests live** on kelionai.app, not locally. After each fixed
  requirement: **build → deploy → VERIFY LIVE with real proof** (curl, decode,
  measurement) — never declare something "done" without evidence.
- **Production = master, 100% in sync, always.** Nothing may ever publish code
  older than `origin/master` (see the "phantom deploy" lesson, AI-HANDOFF.md §6).
- Keep the chat/voice path **low-latency** (target: first word under 1s).
- Fix by rewriting the small responsible module — no band-aid patches.
- Don't touch `C:\Users\adria\Downloads\k` — that's the OLD archived project.

## Layout (see AI-HANDOFF.md §2 for the complete file-by-file map)
- `backend/` — Node + Fastify + TS. Routes in `src/routes/`, services in `src/services/`.
- `frontend/` — React + Vite + TS. `src/pages/Stage.tsx`, `src/components/ChatPanel.tsx`.
- `bridge/` — the VPS worker (`kelion-bridge-linux.mjs`) + autonomous repair/deploy scripts.
- `Dockerfile` — imaginea aplicației (gazda: VPS propriu; Railway scos, 22 iul 2026).

## Build & deploy
```bash
# from the repo root, on a branch:
# edit → commit → push → PR → merge to master → publicare pe gazdă (VPS) → VERIFY LIVE
```
Full CI/workflow list, env vars, DB schema, brain-routing rules, and current
project state: **`AI-HANDOFF.md`**.
