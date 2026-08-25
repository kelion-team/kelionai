---
name: kelion-operations-memory
description: "Resume or hand off KelionAI release, deployment, production incident, live verification, or long-running repair work. Use after a Codex restart/upgrade, when asked where work stopped, and before changing production state."
---

# Kelion Operations Memory

1. Read `AGENTS.md`, then read `docs/operations/CURRENT.md` completely.
2. Treat the checkpoint as a claim to verify, not as live truth. Check the
   current branch/worktree and re-run read-only public/VPS probes before any
   production mutation.
3. Continue only from `Următorul pas sigur`. Preserve unrelated user changes
   and never repeat an operation merely because its prior process disappeared.
4. Use commit, PR, Actions/Deployment IDs, exact live version and measured
   health as evidence. Do not infer success from an HTTP 200 alone.
5. Update `CURRENT.md` after every material state transition and before a
   planned stop, restart, upgrade or handoff. Keep one current state, not a
   transcript or historical report.
6. Never store secrets, environment values, IPs, raw logs, database dumps,
   personal data or unverified guesses in the checkpoint.
7. Treat every observed error, alert, red/cancelled check, degradation or UI
   fault as blocking. Diagnose it immediately, fix the actual cause and rerun
   the evidence to green. Never hide, weaken, skip or relabel a failing gate.
   For immutable historical/external signals, prove the classification, rerun
   the current check when possible and record the unresolved evidence plainly.
