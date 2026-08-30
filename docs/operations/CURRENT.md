# Checkpoint operațional curent

Actualizat: `2026-08-30T06:33:28Z`

## Stare verificată

- `origin/master` este `056c740cc6887158e35e78e860200460a3594ee0`.
  Release run `33296250851`, job `99216341157`, s-a oprit înainte de
  point-of-no-return; dovada publică a rămas la
  `ff6d2e30991b4f35adaf68f4b3a88ada8504d350`.
- Bootstrap-ul GC a trecut. Eșecul imediat următor a fost
  `A dependency job for kelion-codex-worker.service failed`, după crearea
  linkurilor timerelor. `kelion-codex-worker.service` are dependență hard de
  `kelion-constructor-sync.service`; logul release-ului nu conține însă eroarea
  leaf a serviciului sync, deci aceasta rămâne necunoscută și nu este declarată
  reparată.
- Același eșec de dependență apare și în activarea inițială
  `33254987691`, job `99107013438`. Mesajul GC care a urmat a fost secundar:
  activarea a rămas jurnalizată după roll-forward/rollback incomplet.
- Corecția locală de pe `chore/recover-activation-quiesced-20260830` reia
  explicit numai activarea worker/publisher acceptată de callerul dublu
  pin-uit. Helperul publică durabil faza `applied`, apoi
  `constructor-unit-migration.pending`, și abia după aceea retrage pendingul
  activării; nu execută `start` sau `enable` în bootstrap.
- Callerul validează și persistă din nou blockerul root-only exact înainte de
  unlink, persistă absența jurnalului înainte să șteargă snapshotul și persistă
  din nou directorul runtime după ștergere. Blockerul rămâne fail-closed și este
  consumat ulterior numai de cutover-ul strict cu owner și dovadă de generație.
- Retry-ul pre-upgrade este armat și când a rămas numai blockerul persistent,
  inclusiv după crash între unlink-ul jurnalului și curățarea snapshotului.
- Schimbarea nu repară și nu validează credențialele OpenAI/Codex și nu
  identifică eroarea leaf a sync-ului. Aceste probe rămân separate.

## Următorul pas sigur

1. Încheie porțile locale pentru helper, caller, fault-cuts și hashurile pin-uite;
   orice lipsă de dependență locală se raportează separat, nu ca succes.
2. Inspectează diff-ul și publică un PR din ramura `chore/*`; fără push direct
   în `master` și fără deploy înainte ca toate checkurile obligatorii să fie verzi.
3. După merge, rulează release-ul pentru noul SHA și confirmă întâi consumarea
   fail-closed a jurnalului/blockerului, apoi extrage diagnosticul leaf al
   `kelion-constructor-sync.service` dacă dependency job mai eșuează.
4. Declară Constructorul funcțional numai după release proof, starea exactă a
   timerelor/serviciilor și o probă reală a chatului/workerului.

## Legături canonice

- Workflow control Constructor: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
- Release eșuat pre-PONR: <https://github.com/kelion-team/kelionai/actions/runs/33296250851>
- Job release: <https://github.com/kelion-team/kelionai/actions/runs/33296250851/job/99216341157>
- Versiune live: <https://kelionai.app/api/release-proof>
