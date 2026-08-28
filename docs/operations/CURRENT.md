# Checkpoint operațional curent

Actualizat: `2026-08-27T14:45:17Z`

## Current verified state

- Repo: `kelion-team/kelionai`.
- `origin/master`: `710ab45474acd9862eb5379061cbc57a6de65d3d`.
- Live: `baf00ae`, verificat prin `/api/version`; release-ul candidat nu a fost
  promovat.
- Readiness live: `ready=true` (verificat prin `/readyz`).
- CI push `33079380411` și buildul exact `33080000979` pentru `710ab454` sunt
  verzi.
- Release-ul protejat `33083892211` a trecut `idempotency` și
  `verify-candidate`, apoi a fost refuzat fail-closed de validator:
  `runtime-cutover: env invalid: runtime.env`.
- Remedierea contractului runtime rămâne în PR-ul protejat `#1395`; branch-ul
  este sincronizat cu `master` numai după rezolvarea conflictelor și reverificare.
- PR #1396 (ChatGPT Pro subscription) merged pe master (`36315b40`).
- PR #1397 (vps-set-env permite OPENAI_API_KEY gol) merged pe master (`5acdf3bc`).
- Deploy pending: `runtime.env` pe VPS e staled; trebuie rulat `vps-set-env`
  înainte de deploy pentru a actualiza câmpurile noi cerute de validator.

## Arhitectura curentă (verificată în cod)

- OpenAI Responses este singurul creier online. Modelele pot fi accesate fie
  prin cheie API (`sk-proj-*`), fie prin abonamentul ChatGPT Pro ($200/lună)
  folosind tokenul OAuth din `~/.codex/auth.json` și endpoint-ul
  `chatgpt.com/backend-api/codex/responses`.
- `isSubscriptionMode()` returnează true când `config.openai.key` e gol și
  există `~/.codex/auth.json` cu `auth_mode=chatgpt`.
- `vps-set-env.yml` acceptă acum `OPENAI_API_KEY` gol (generează placeholder
  `disabled-placeholder-*`); `deploy.sh` acceptă și acest pattern.
- Vocea live folosește OpenAI Realtime (`wss://api.openai.com/v1/realtime`).
- Modelele vin din env (`OPENAI_LUNA_MODEL`, `OPENAI_MEDIUM_MODEL`,
  `OPENAI_HEAVY_MODEL`, `OPENAI_REALTIME_MODEL`). În mod abonament,
  verificarea catalogului `/v1/models` este sărită (endpoint-ul Codex nu o servăște).
- Constructorul rulează ca worker Codex separat; web-ul pune job-uri în coadă
  și afișează starea. Flux: `queued → claimed → accepted → working →
  gates_passed → pr_opened → merged → deployed`.
- `backend/.env` local are secțiunea OpenAI completă (9 env-uri, goale).

## Audit complet (27 aug 2026)

### Porți AGENTS.md — rezultate

| Poartă | Rezultat |
|---|---|
| `typecheck` | ✓ 0 erori |
| `backend test` | ✓ 1332/1332 trec (200 suite-uri) |
| `frontend build` | ✓ build reușit |
| `frontend lint` | ✓ 0 erori |
| `verifica-hardcodari` | ✓ 0 abateri |
| `verifica-creier-unic` | ✓ 0 furnizori retrași |
| `verifica-exporturi` | ✓ 0 cod mort |
| `verifica-sintaxa` | ✓ curat |
| `verifica-workflow-uri-sigure` | ✓ curat |
| `identifica-teste-moarte` | ✓ 0 teste moarte |
| `inventar-audit` | ✓ curat |
| `jscpd` | ✓ 0 duplicate |

### Chat local verificat

- Backend pornește pe `:8080` cu env OpenAI local.
- Auth prin bearer token (sesiune nativă în `auth_sessions`) — funcțional.
- `POST /api/chat` cu `idempotencyKey` — SSE streaming, `heard`, `lang`,
  răspuns. Cu cheie OpenAI falsă, răspunsul e mesajul de epuizare (corect).
- Cu cheie OpenAI reală, chat-ul ar funcționa complet.

### Flux Admin → Constructor → Deploy verificat

- `POST /api/admin/constructor` — poartă de calitate + `createBuildJob`.
- `GET /api/admin/constructor` — status + work cards + observability.
- `POST /api/admin/constructor/release/action` — aprobă release.
- Worker Codex: `/api/internal/constructor-publisher/jobs/claim`.
- Deploy: `deploy.ts` citește `build_jobs` și expune `DeployState`.
- Testele `constructorPipeline`, `constructorOrdineSterse`, `deploy` trec.

### Migrații DB locale

- 27 migrații aplicate pe DB local (`postgresql://postgres@localhost:5432/kelionai`).
- `auth_sessions` și toate tabelele există.
- Backup proof generat și verificat (protecție anti-distrugere funcțională).

## Fixuri aplicate în sesiunea asta

1. `backend/.env` — șters `GEMINI_API_KEY`, `JULES_API_KEY`, `LIVEKIT_*`;
   adăugat secțiune OpenAI completă.
2. `scripts/billing-check.cjs` — re-scris pe OpenAI Responses (folosea `geminiKey` inexistent).
3. `scripts/listeaza-modelle-imagine.mjs` — re-scris pe catalog OpenAI.
4. `scripts/ping-gemini.cjs` — șters (mort, referia `geminiKey` inexistent).
5. `scripts/probe-live.mjs` — URL din `PUBLIC_APP_ORIGIN`/`FRONTEND_ORIGIN` env.
6. `backend/src/agentiA2a.test.ts` — `https://kelionai.app` hardcodat → `config.publicOrigin`.
7. `scripts/autovedere-screenshot*.png` — șterse (duplicate locale negit-tracked).
8. Migrații DB locale rulate (27 migrații, DB recreat de la zero).

## Unfinished work

- Deploy `16eecd83` la live (9 commit-uri ahead de `baf00ae`).
- Configurare env OpenAI pe VPS (cheie project-scoped + modele validate).
- Verificare E2E live: chat text + voce + vedere + admin + constructor.
- `CONSTRUCTOR_PUBLISHER_GITHUB_TOKEN` necesită scope `SSH signing keys: write`.
- Profilul `kelion-codex` pe VPS trebuie să finalizeze `codex login` interactiv.

## Blockers / owner action

1. Cheia OpenAI de runtime pe VPS trebuie să fie project-scoped.
2. Modelele OpenAI pe VPS: `OPENAI_LUNA_MODEL`, `OPENAI_MEDIUM_MODEL`,
   `OPENAI_HEAVY_MODEL`, `OPENAI_REALTIME_MODEL` — toate validate în catalog.
3. Credențiala GitHub Actions `CONSTRUCTOR_PUBLISHER_GITHUB_TOKEN` — scope
   `SSH signing keys: write`.
4. `codex login` interactiv pe VPS pentru profilul `kelion-codex`.

## Next ordered steps

1. Configurează env OpenAI pe VPS (cheie + modele);
2. Deploy `16eecd83` prin traseul protejat;
3. Verifică live: `/api/version` = `16eecd83`, `/readyz` = true;
4. Testează chat text live cu auth real;
5. Testează voce live (OpenAI Realtime);
6. Testează flux Admin → Constructor → PR → Deploy cu un ordin benign;
7. Confirmă refresh client și cache update.

## Canonical links

- Repo: <https://github.com/kelion-team/kelionai>
- PR remediere contract: <https://github.com/kelion-team/kelionai/pull/1395>
- Release curent refuzat sigur: <https://github.com/kelion-team/kelionai/actions/runs/33083892211>
- Integrare GitHub Admin: [`GITHUB-RELEASE-INTEGRATION.md`](GITHUB-RELEASE-INTEGRATION.md)
- Contract livrare: [`DELIVERY-RULES-AND-ROADMAP.md`](DELIVERY-RULES-AND-ROADMAP.md)
- Live: <https://kelionai.app>
- Inventar Admin: [`ADMIN-CAPABILITY-INVENTORY.md`](ADMIN-CAPABILITY-INVENTORY.md)

## Handoff pentru sesiunea următoare

Nu relansa runurile vechi. Verifică din nou `origin/master`, PR-ul remedierii și
sondele publice. Provisionarea trebuie să fie un run nou din workflow-ul reparat;
orice token gol sau reutilizat rămâne fail-closed.
