# Checkpoint operațional curent

Actualizat: `2026-08-30T05:39:53Z`

## Stare verificată

- `master` este `4687c7f2a57b17f2f3a1e8ca5b1a9bcb2583e907`.
  CI-ul post-merge și buildul celor cinci imagini OCI au trecut, iar
  digesturile au fost semnate.
- Release run `33272696377` a validat candidatul și semnăturile, dar s-a
  oprit înainte de point-of-no-return. Release-ul public anterior a rămas
  activ.
- Cauza nouă este un bootstrap deadlock în `deploy.sh`: înainte să
  instaleze helperul reparat, deploy-ul cere helperului live vechi să
  recupereze `constructor-activation.journal`. Generația veche include
  jurnalul în globul `constructor-activation.*` și refuză recovery-ul.
- Migrarea pregătită pe ramura
  `chore/deploy-activation-gc-bootstrap-20260829` este one-shot și dublu
  pin-uită. Acceptă numai helperul live `ce136f…`, candidatul `cd93ea…`,
  un jurnal schema 2 pentru `activate-worker-publisher` și absența
  oricărui jurnal runtime, gate sau deploy concurent.
- Migrarea rulează helperul candidat numai dintr-o copie temporară
  root-only, reia explicit operația jurnalizată, dovedește ștergerea
  jurnalului/pendingului/snapshotului, apoi quiesce din nou Constructorul.
  Helperul live nu este înlocuit înaintea dovezii.
- Constructorul rămâne fail-closed; timerele sunt inactive până la
  recovery/deploy reușit și la probele Codex CLI.
- Cheia OpenAI API de producție rămâne revocată; aceasta este o problemă
  separată de release și Constructor.
- Failul jobului `provision` (`actions/runs/33295132843/jobs/99213371892`)
  a fost corelat cu validarea prea strictă a snapshoturilor
  `constructor-activation.*`: helperul refuza sufixe legacy validate
  root-only, ceea ce bloca `garbage_collect_activations`.
- Corecția locală lărgește allowlist-ul de sufixe pentru snapshoturile
  `constructor-activation.*` în helperul runtime și actualizează hash-urile
  pin-uite pentru helperul compatibil (`deploy.sh` și
  `instaleaza-constructor.sh`), împreună cu testul contractual aferent.

## Următorul pas sigur

1. Rulează din nou workflow-ul `provision-production-secrets` pe SHA-ul cu
   fixul GC + hash pinning și confirmă că jobul `provision` trece.
2. Rulează porțile PR pentru modificările curente și păstrează doar failurile
   reproduse local (în prezent, un test existent cere dependența
   `@electric-sql/pglite` absentă în sandboxul curent).
3. Îmbină prin rebase numai pe verde și publică noul `master`.
4. Confirmă release proof pentru SHA-ul nou și apoi rulează controlul
   Constructor pentru starea timerelor și proba `codex --version`.

## Legături canonice

- Workflow control Constructor: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
- Release eșuat pre-PONR: <https://github.com/kelion-team/kelionai/actions/runs/33272696377>
- Versiune live: <https://kelionai.app/api/release-proof>
