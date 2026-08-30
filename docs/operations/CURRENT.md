# Checkpoint operațional curent

Actualizat: `2026-08-30T11:19:25Z`

## Stare verificată

- `origin/master` este la `9d48b0bf7b8e1dd3cbf45ee13427cff98414989f`
  după merge-ul prin rebase al PR-ului de politică one-shot `#1537`.
  Ultima producție verificată rămâne la `b79fcbe1d732b8f06428fd3e98c09c1a269a399a`;
  release-ul canonic `33304034457`, attempt 2, a confirmat acel SHA prin
  `/api/release-proof`, cu `ready=true`, `candidate=false` și
  `sideEffectsActive=true`.
- Pe acea producție, proba chat a primit HTTP/provider
  `429 insufficient_quota`; Constructorul folosește încă autentificarea
  ChatGPT separată, iar `OPENAI_ADMIN_KEY` nu are consumator runtime. Acestea
  nu sunt declarate reparate live.
- PR-ul funcțional `#1538` păstrează exact 43 de căi aprobate. Ramura locală
  este rebazată pe `9d48b0bf`, include remedierea afișării UTC și leagă
  workflow-ul login Constructor de environment-ul `production`; arborele
  corectat trebuie încă publicat pe același PR.
- Schimbarea implementează contractul cerut: aceeași cheie project-scoped
  `OPENAI_API_KEY` pentru backend și Constructor, iar `OPENAI_ADMIN_KEY` numai
  în backendul Kelion Admin pentru OpenAI Costs/Usage.
- Constructorul primește `openai-project-key` numai prin systemd
  `LoadCredential`, rulează clientul oficial `codex login --with-api-key` cu
  valoarea pe stdin, zeroizează bufferul și păstrează cheia în afara argv,
  environmentului `codex exec`, browserului și logurilor. Loginul se reface
  numai la rotație sau cache invalid.
- Admin key este montată ca `/run/secrets/openai-admin-key` numai în containerul
  backend. Provisionarea cere familiile distincte `sk-proj-*` și `sk-admin-*`,
  fără placeholder OpenAI și fără `OPENAI_PROJECT_ID` suplimentar.
- Verificările locale ale schimbării sunt verzi: backend typecheck; testele țintite
  OpenAI/Admin/Constructor; frontend build, lint și 306 teste; worker self-test;
  contract deploy; codex boundary; constructor publication 88/88; secret scan.
  Cele 9 fișiere PGlite afectate de timeout sub contendența rulării paralele au
  trecut 50/50 serial. UTC are regresie 5/5, iar boundary-ul Codex 7/7.

## Următorul pas sigur

1. Publică arborele corectat pe PR `#1538` și verifică exact 43 de căi, fără
   missing/extra/duplicate/rename și fără conversații nerezolvate.
2. După toate checkurile obligatorii verzi, îmbină prin rebase în `master`.
3. Pornește imediat `vps-set-env.yml` pe noul `master`, înainte ca lanțul
   automat CI/build/release să ajungă la mutatorul de producție.
4. Acceptă release-ul numai pentru SHA-ul merged exact, cu receipt și
   `/api/release-proof` verificate independent.
5. Declară funcțional numai după probe reale separate pentru chat Responses,
   Realtime, Costs/Usage Admin, heartbeat/login Constructor și un ordin pilot.

## Legături canonice

- Workflow secrete producție: <https://github.com/kelion-team/kelionai/actions/workflows/vps-set-env.yml>
- Workflow control Constructor: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
- Workflow release: <https://github.com/kelion-team/kelionai/actions/workflows/deploy.yml>
- Versiune live: <https://kelionai.app/api/release-proof>
