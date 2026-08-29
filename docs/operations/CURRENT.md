# Checkpoint operațional curent

Actualizat: `2026-08-29T07:15:14Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
  Vârful remote este `afc3c7484ff7982a78b10feb2ee0c6eb4fe927a3`, rezultat prin
  rebase din PR `#1509`, copil direct al incidentului
  `de9fe5f3f081373a23796d83b469651e9c1e33e7`.
- Pentru `afc3c748...`, CI push `33238849853` și secret-scan
  `33238849762` sunt verzi. Recovery-ul VPS generic `33238849753` a
  clasificat corect tranziția specială și nu a executat mutatorul generic.
- Recovery-ul dedicat post-PONR `33238849810` a verificat incidentul,
  manifestele OCI și semnăturile Cosign, dar jobul VPS `99065095826` a eșuat
  în prima comandă SSH. Logul are un singur banner SSH; release-ul original
  avea trei pentru login, `scp` și execuția remote. Bundle-ul nu a ajuns pe
  VPS, iar `deploy.sh` nu a fost apelat.
- Comanda care a eșuat combina fără atribuire verificarea directorului
  `/root/kelion/runtime` și autentificarea GHCR. Logul nu poate distinge între
  ACL/symlink și `docker login`, deoarece predicatul era tăcut și stdout-ul
  loginului era suprimat. Jobul eșuat nu trebuie rerulat neschimbat.
- Diagnoza read-only `33228316533`, attempt 2/job `99065442805`, și inventarul
  spool `33228583946`, attempt 2/job `99065443392`, au rulat după eșec și
  confirmă că producția nu a fost mutată: cele cinci containere `blue` pentru
  `de9fe5f...` sunt healthy, proxy-ul managed este healthy, manifestul
  `active-release` lipsește, iar jurnalul
  `runtime-config-cutover.journal` root-only rămâne prezent. Serviciile și
  timerele Constructor sunt inactive; pending-ul Constructor trebuie păstrat.
- Producția rămâne fail-closed: `/api/version`, `/readyz`, `/livez` și
  `/health` răspund 200, dar `/api/release-proof` răspunde 503 cu
  `activeCommit=de9fe5f...`, `candidate=true` și `sideEffectsActive=false`.
- Buildul OCI `33239033561` pentru `afc3c748...` a fost oprit de testul
  `deploy/lib/release-rollback.test.mjs`: imaginea izolată
  `kelion-release-codex-gates` execută funcțiile Bash reale ale recovery-ului,
  dar runtime-ul ei nu conținea `jq`. `jq` este necesar numai în imaginea de
  porți; runtime-ul aplicației publice rămâne minim. Dispatchul `33239234406`
  a fost corect skipped.
- Release verifier `33238849756` este încă în polling. Sunt zece issues
  deschise: sentinelul `#1508` și nouă issues istorice de release verifier.
  Nu se închid înaintea dovezii live finale.
- Follow-up-ul local pornește exact din `afc3c748...` și permite un singur
  copil direct. Workflow-ul dedicat separă proba metadata runtime de login,
  raportează faza, linia și codul exact fără secrete, folosește un
  `DOCKER_CONFIG` izolat root-only și păstrează cleanup-ul legat de run.
  Recovery-ul generic se retrage explicit și pentru tranziția
  `afc3c748... -> copil`, ca să nu concureze cu fluxul dedicat. Include și
  `jq` numai în imaginea gates, regresia de boundary și acest checkpoint.
  Două review-uri finale nu mai raportează P0/P1; matricea statică exactă a
  CI este verde `205/205`, testele recovery țintite sunt verzi `118/118`, iar
  sintaxa workflow/shell și `git diff --check` sunt curate.
- Scanarea istoriei a clasificat fixture-urile de test separat și a găsit trei
  credențiale candidate vechi, eliminate din arborele actual odată cu
  furnizorii retrași. Valorile nu au fost afișate; dovada revocării rămâne
  obligatorie înainte de verdictul de lansare, fără a extinde acest recovery.
- Inventarul static al produsului confirmă deja un defect P0 funcțional:
  widgetul public poate trimite și face polling, dar nu există fluxul
  operator/admin pentru listarea conversațiilor și răspuns. Intră în primul
  lot funcțional după restabilirea release-ului.

## Următorul pas sigur

1. Publică un singur PR bazat pe `afc3c748...`; merge numai prin rebase după
   `verify`, `container-isolation`, `current-tree` și `merge-policy` verzi.
2. Pushul exact al copilului lui `afc3c748...` poate porni o singură dată
   recovery-ul dedicat. Acceptă-l numai dacă preflight-ul arată separat
   metadata runtime și loginul GHCR, apoi `/api/release-proof=200` dovedește
   SHA integral `de9fe5f...`, `candidate=false` și `sideEffectsActive=true`.
3. Buildul și release-ul normal al noului vârf `master` trebuie să aștepte
   mutexul `production-release`, apoi să dovedească în producție exact acel SHA.
4. După deploy-ul final, închide sentinelul/verifier-ele numai pe dovezi și
   începe matricea funcțională browser pentru visitor/customer/admin. Fiecare
   buton, meniu, formular și funcție de chat live primește rezultat, eroare,
   fix, regresie și SHA live; se livrează loturi de cel mult cinci defecte.
5. Înainte de verdictul `launch-ready`, documentează revocarea celor trei
   credențiale istorice candidate și livrează primul lot funcțional, începând
   cu traseul bidirecțional visitor-chat/operator.

## Legături canonice

- PR recovery inițial: <https://github.com/kelion-team/kelionai/pull/1509>
- CI push `afc3c748...`: <https://github.com/kelion-team/kelionai/actions/runs/33238849853>
- Recovery dedicat eșuat înainte de transfer:
  <https://github.com/kelion-team/kelionai/actions/runs/33238849810>
- Diagnoză topologie read-only:
  <https://github.com/kelion-team/kelionai/actions/runs/33228316533>
- Inventar spool read-only:
  <https://github.com/kelion-team/kelionai/actions/runs/33228583946>
- Build OCI blocat de imaginea gates:
  <https://github.com/kelion-team/kelionai/actions/runs/33239033561>
- Release original post-PONR:
  <https://github.com/kelion-team/kelionai/actions/runs/33227925046>
- Issue verifier incident: <https://github.com/kelion-team/kelionai/issues/1507>
- Sentinel producție: <https://github.com/kelion-team/kelionai/issues/1508>
