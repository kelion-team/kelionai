# Checkpoint operațional curent

Actualizat: `2026-08-30T12:08:57Z`

## Stare verificată

- `origin/master` și producția activă sunt la
  `c516465b6a26023fe6686ce2a7644bd4e783c0e7`, după merge-ul prin rebase al
  PR-ului funcțional `#1538`.
- Release-ul canonic `33309719900` a confirmat
  `release_ok commit=c516465b6a26023fe6686ce2a7644bd4e783c0e7 slot=blue`.
  `/api/release-proof` raportează `ready=true`, `candidate=false`,
  `sideEffectsActive=true` și SHA-ul activ exact; `/health` raportează
  `status=ok`.
- Provisionarea `33309260780`, verificarea PR `33309198973`, build-ul
  `33309411200` și dispatch-ul `33309714412` au încheiat cu succes pentru
  același SHA.
- Proba reală Responses din Kelion nu este funcțională: OpenAI răspunde
  `429 insufficient_quota`, iar UI afișează fallback-ul neutru. Capabilitatea
  Realtime este indisponibilă cu `code=quota`.
- `OPENAI_ADMIN_KEY` ajunge separat numai la OpenAI Costs/Usage din Kelion
  Admin, dar endpointurile oficiale răspund `401 invalid_key` pentru valoarea
  provisionată. Cheia nu este folosită pentru chat, voce sau Constructor.
- Contractul implementat rămâne: aceeași cheie project-scoped
  `OPENAI_API_KEY` pentru backend și Constructor; cheia admin separată doar
  pentru Costs/Usage. Nicio cheie nu este expusă în browser, argv sau loguri.
- Timerele și markerele worker/publisher Constructor sunt active. Workflow-ul
  de login `33310222314` a ieșit verde, dar controlul ulterior `33310350441`
  raportează încă `codex-auth=required`; cauza este capturarea canalului greșit
  pentru receiptul `codex login status`, iar remedierea este în curs de
  integrare. Constructorul nu este declarat funcțional.
- Verifierul VPS a identificat două probleme independente de deploy:
  evaluatorul post-cutover cerea greșit `candidate=true`, iar protecția ramurii
  nu satisface încă toate regulile de livrare. Corecția evaluatorului cere
  starea activă `candidate=false` și `sideEffectsActive=true` atât în
  `/readyz`, cât și în `/api/release-proof`.
- Excepția temporară de auto-merge pentru PR-ul `#1538` a fost consumată și
  este eliminată; PR-urile VPS revin la allowlist-ul canonic fail-closed.

## Următorul pas sigur

1. Publică remedierea statusului Codex, corecția verifierului și eliminarea
   excepției one-shot într-un PR nou, după toate testele locale.
2. Îmbină numai după checkuri obligatorii verzi și conversații rezolvate, apoi
   rulează release-ul pentru SHA-ul rezultat și verifică independent live-ul.
3. Reexecută login/status Constructor și cere heartbeat real înainte de orice
   ordin pilot.
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
