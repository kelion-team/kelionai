# Checkpoint operațional curent

Actualizat: `2026-08-30T10:18:20Z`

## Stare verificată

- `origin/master` și producția sunt încă la
  `b79fcbe1d732b8f06428fd3e98c09c1a269a399a`. Release-ul canonic
  `33304034457`, attempt 2, a reușit, iar `/api/release-proof` a confirmat
  același SHA, `ready=true`, `candidate=false` și `sideEffectsActive=true`.
- Pe producția curentă, proba chat a primit apoi HTTP/provider
  `429 insufficient_quota`; Constructorul folosește încă autentificarea
  ChatGPT separată, iar `OPENAI_ADMIN_KEY` nu are consumator runtime. Acestea
  nu sunt declarate reparate live.
- Ramura locală `fix/openai-unified-credentials-20260830`, bazată exact pe
  `b79fcbe1`, implementează contractul cerut: aceeași cheie project-scoped
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
- Verificările schimbării sunt verzi: backend typecheck; testele țintite
  OpenAI/Admin/Constructor; frontend build, lint și 305 teste; worker self-test;
  contract deploy; codex boundary; constructor publication 88/88; secret scan.
  Rularea backend completă paralelă a trecut 1479 teste și a avut numai timeout
  pe 9 teste PGlite sub contendența locală; fișierele respective se reverifică
  serial și CI rămâne autoritatea canonică.

## Următorul pas sigur

1. Încheie rerularea serială și orice ultim test țintit după diff-ul final.
2. Publică un PR din ramura curentă; fără push direct în `master` și fără bypass.
3. După toate checkurile obligatorii verzi, îmbină prin rebase în `master`.
4. Rulează `vps-set-env.yml` pe noul `master` ca să monteze ambele secrete,
   apoi lasă release train-ul canonic să livreze exact SHA-ul merged.
5. Declară funcțional numai după probe reale separate pentru chat Responses,
   Realtime, Costs/Usage Admin, heartbeat/login Constructor și un ordin pilot.

## Legături canonice

- Workflow secrete producție: <https://github.com/kelion-team/kelionai/actions/workflows/vps-set-env.yml>
- Workflow control Constructor: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
- Workflow release: <https://github.com/kelion-team/kelionai/actions/workflows/deploy.yml>
- Versiune live: <https://kelionai.app/api/release-proof>
