# Checkpoint operațional curent

Actualizat: `2026-08-30T13:13:43Z`

## Stare verificată

- `origin/master` și producția activă sunt la
  `5792fbfde2b603be8efcaa6fe67cabdd823d3171`, după merge-ul PR-ului `#1541`.
- CI `33312315059`, build-ul `33312531594`, dispatch-ul `33312852263` și
  release-ul canonic `33312856341` au încheiat cu succes pentru același SHA.
  Receiptul este
  `release_ok commit=5792fbfde2b603be8efcaa6fe67cabdd823d3171 slot=green`.
- Verifierul `33312315032` a confirmat trei din trei eșantioane live, toate
  endpointurile cu HTTP 200 și fără lipsuri: versiunea `5792fbf`, readiness,
  liveness, health și release-proof cu `candidate=false`,
  `sideEffectsActive=true` și commitul activ exact. Verdictul său final a eșuat
  exclusiv pe `branch-protection`; incidentul canonic este `#1544`.
- Proba reală Responses din Kelion nu este funcțională: OpenAI răspunde
  `429 insufficient_quota`, iar UI afișează fallback-ul neutru. Capabilitatea
  Realtime este indisponibilă cu `code=quota`.
- `OPENAI_ADMIN_KEY` ajunge separat numai la OpenAI Costs/Usage din Kelion
  Admin, dar endpointurile oficiale răspund `401 invalid_key` pentru valoarea
  provisionată. Cheia nu este folosită pentru chat, voce sau Constructor.
- Contractul implementat rămâne: aceeași cheie project-scoped
  `OPENAI_API_KEY` pentru backend și Constructor; cheia admin separată doar
  pentru Costs/Usage. Nicio cheie nu este expusă în browser, argv sau loguri.
- Corecția statusului Codex este în Git, dar release-ul aplicației nu publică
  automat copia host `/opt/kelion-codex/codex-worker.mjs`. Constructorul rămâne
  nedeclarat funcțional până la un upgrade in-place canonic, apoi login,
  status și heartbeat real verificate.
- Schimbarea curentă elimină excepția one-shot consumată de PR-ul `#1541` și
  extinde permanent allowlist-ul fail-closed numai pentru upgrade-ul canonic al
  Constructorului, runbook, testul său și acest checkpoint operațional.

## Următorul pas sigur

1. Integrează această curățare de politică numai după testele remediatorului,
   siguranța workflow-urilor și verificarea sintaxei.
2. Publică apoi upgrade-ul in-place al Constructorului într-un PR separat,
   păstrând atomic markerii și timerele și fără a retransmite secretele.
3. După upgrade, verifică hashul workerului host, loginul project-scoped,
   `constructor-status` și heartbeatul real înainte de orice ordin pilot.
4. Chatul și vocea pot deveni funcționale numai după ce proiectul OpenAI
   provisionat are credit/spend limit disponibil sau primește o altă cheie
   project-scoped cu quota. Costs/Usage necesită o cheie admin validă.
5. Schimbarea regulilor de branch protection rămâne o operație GitHub separată
   și nu se aplică fără confirmarea explicită a proprietarului.

## Legături canonice

- Workflow secrete producție: <https://github.com/kelion-team/kelionai/actions/workflows/vps-set-env.yml>
- Workflow control Constructor: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
- Workflow release: <https://github.com/kelion-team/kelionai/actions/workflows/deploy.yml>
- Versiune live: <https://kelionai.app/api/release-proof>
