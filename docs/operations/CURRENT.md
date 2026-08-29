# Checkpoint operațional curent

Actualizat: `2026-08-29T06:28:13Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- Vârful `master` este
  `de9fe5f3f081373a23796d83b469651e9c1e33e7` (PR `#1506`). CI exact
  `33227451553`, scanarea exactă `33227451542`, recovery-ul VPS exact
  `33227451578` și buildul OCI exact `33227641381` sunt verzi; imaginile celor
  cinci roluri sunt semnate pentru acest SHA.
- Dispatchul release `33227921235` a validat tupla exactă. Release-ul canonic
  `33227925046`, request
  `e5c00af2-1fb9-4daf-a30b-bdfed24d5689`, a trecut drainul SQL, restaurarea
  verificată a backupului, migrațiile, cele cinci containere candidate și
  probele SSRF/converter. După PONR s-a oprit fail-closed la dovada publică a
  candidatului pregătit.
- Cauza exactă este o contradicție în validarea locală: dovada candidatului
  respingea orice jurnal distructiv, deși `mark_point_of_no_return` tocmai
  publicase jurnalul autentic al aceluiași release. Refuzul s-a produs înainte
  de primul `curl`; avertismentele Node.js 20/24 și Caddy nu l-au cauzat.
- Handlerul de ieșire post-PONR nu arma simultan `release_rollforward_only=1`
  și nu retrăgea `gate_matches_active_release`. Recovery-ul Constructor generic
  a consumat astfel snapshotul quiesce/proxy care trebuia păstrat pentru
  continuarea release-ului.
- Configurarea `33227955270` a fost apoi refuzată înaintea primei mutații: markerul
  activ păstrat este versiunea veche `baf00aee68206ebdf259143fd9b71813fd6a5c02`,
  iar proxy-ul și slotul `blue` servesc candidatul `de9fe5f...`. Guardul de
  restart a detectat corect această stare mixtă post-PONR.
- Diagnoza read-only `33228316533` și inventarul spool `33228583946` confirmă un
  singur jurnal `runtime-config-cutover.journal`, schema 1/faza `prepared`, cu
  exact cele 11 intrări așteptate. Toate țintele live sunt încă byte-identice cu
  backupurile; nu a existat mutație runtime/config. Markerul ready și activarea
  lipsesc, iar `constructor-unit-migration.pending` canonic este prezent și
  trebuie păstrat.
- Producția rămâne fail-closed pe candidatul exact `de9fe5f...`: cele cinci
  containere `blue` și proxy-ul sunt healthy; `/api/version`, `/readyz`,
  `/livez` și `/health` răspund 200. `/api/release-proof` răspunde 503 cu
  `activeCommit=de9fe5f...`, `candidate=true` și `sideEffectsActive=false`.
  Serviciile și timerele Constructor sunt inactive.
- Workflow-urile generice de recovery, rerun, configure, set-env și rollback nu
  pot închide sigur această stare și nu trebuie rulate. Recovery-ul permis este
  exclusiv fix-forward, legat de tuplele și artefactele exacte de mai sus.
- Hotfixul dedicat este publicat în PR `#1509` ca un singur copil direct al
  `de9fe5f...`. Primul run
  `merge-policy` a identificat fail-closed cele trei căi recovery noi absente
  din allowlist; commitul unic este amendat cu allowlistul și regresia aferentă.
  Primul `verify` a expus și o presupunere root-only în harnessul noii regresii,
  nu în codul de producție: runnerul non-root nu putea executa `chown 0:0`.
  Harnessul simulează acum numai ownerul, păstrând mode-ul și nlink-ul reale
  pentru probele ACL/symlink/hardlink. Pe SHA-ul `77c9916...`, `verify`,
  `container-isolation`, `current-tree` și `merge-policy` au trecut, dar
  review-ul GitHub a identificat corect un TOCTOU: recovery-ul generic verifica
  jurnalul distructiv numai înainte de `flock`. Patchul curent îl reverifică
  sub lock chiar înainte de helper și cere un lock existent, root-only, deschis
  read-only, cu identitatea path↔FD probată înainte și după `flock`.
  Backendul este verde `1334/1334`, frontendul `297/297`, matricea
  statică/deploy `205/205`, iar buildul, lintul, self-testele workerilor și
  porțile de contract sunt verzi. Workflow-ul dedicat așteaptă și CI-ul push
  exact al hotfixului înaintea primei mutații VPS; scanarea de secrete și
  porțile containerizate rămân obligatorii în PR.

## Următorul pas sigur

1. Cere toate porțile protejate pe commitul unic din PR `#1509` și merge numai
   prin rebase; nu modifica manual VPS-ul.
2. Workflow-ul generic `VPS Recovery` trebuie să împartă mutexul
   `production-release` și să se oprească/defer-e înaintea helperului când
   există jurnalul distructiv. Installerul trebuie să refuze aceeași stare atât
   înainte de prima mutație, cât și după dobândirea lockului.
3. După merge, rulează workflow-ul auditat post-PONR numai de pe `master`, cu
   target `de9fe5f...`, requestul și runurile exacte de mai sus. El poate șterge
   tranzacția runtime numai după allowlistul exact de 11, ACL/nlink, comparația
   byte cu backupurile, topologia/imaginile semnate și dovada stării mixte.
   Pending-ul Constructor rămâne intact.
4. Acceptă recovery-ul numai după `/api/release-proof=200`, SHA integral
   `de9fe5f...`, `ready=true` și `sideEffectsActive=true`. Abia apoi lasă
   release-ul normal al SHA-ului hotfix din `master` să ruleze și repetă dovada
   externă exactă pentru acel SHA.
5. Închide issue-ul verifierului `#1507` și sentinelul `#1508` numai după dovada
   live finală. Migrarea acțiunilor Node.js 24 rămâne separată până la
   stabilizarea producției.

## Legături canonice

- PR recovery post-PONR: <https://github.com/kelion-team/kelionai/pull/1509>
- PR-ul candidatului curent: <https://github.com/kelion-team/kelionai/pull/1506>
- CI exact `de9fe5f`: <https://github.com/kelion-team/kelionai/actions/runs/33227451553>
- Build OCI exact `de9fe5f`: <https://github.com/kelion-team/kelionai/actions/runs/33227641381>
- Dispatch release exact: <https://github.com/kelion-team/kelionai/actions/runs/33227921235>
- Release canonic post-PONR: <https://github.com/kelion-team/kelionai/actions/runs/33227925046>
- Configurare refuzată fără mutație: <https://github.com/kelion-team/kelionai/actions/runs/33227955270>
- Diagnoză topologie read-only: <https://github.com/kelion-team/kelionai/actions/runs/33228316533>
- Inventar spool read-only: <https://github.com/kelion-team/kelionai/actions/runs/33228583946>
- Issue verifier deschis: <https://github.com/kelion-team/kelionai/issues/1507>
- Issue sentinel deschis: <https://github.com/kelion-team/kelionai/issues/1508>
