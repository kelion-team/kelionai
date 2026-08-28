# Checkpoint operațional curent

Actualizat: `2026-08-28T23:18:36Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- `origin/master` este `01d8522140098a74cd632c6f7f11a8e2097abe6e` (PR `#1493`).
  CI master `33216840949` și buildul OCI exact `33217134821` sunt verzi.
- Aplicația live este încă versiunea sănătoasă `baf00ae`; la
  `2026-08-28T22:43Z`, `/api/version`, `/readyz`, `/livez` și `/health` au
  răspuns 200, cu `ready:true` și `sideEffectsActive:true`.
- PR `#1493` a înlocuit variabila AWK `index`, incompatibilă cu `mawk`, cu
  `i` și a adăugat regresia care execută programul AWK real din workflow.
  Configurarea `33217617233` a trecut installerul, clonele și rescrierea
  `runtime.env`, confirmând remedierea.
- Release-ul canonic `33217596289` pentru tupla
  `01d8522` / CI `33216840949` / build `33217134821` s-a oprit fail-closed la
  validatorul `runtime.env`, înainte de cutover; versiunea live nu s-a schimbat.
- Configurarea `33217617233` a atribuit următorul blocaj la
  `phase=post-installer`, `check=worker-gate-image`, `exit_code=125`:
  Podman rootless moștenea directorul SSH `/root` prin `runuser` și refuza
  pornirea cu `cannot chdir to /root`. Remedierea curentă pornește toate cele
  patru comenzi Podman din runtime-ul 0700 deținut de identitatea respectivă,
  atât în controlul VPS, cât și în refresh-ul gate-ului din deploy. Regresia
  numără și verifică toate cele opt invocări; suita relevantă este verde 77/77.
- Statusul read-only `33176281001` confirmă cele trei timere Constructor
  `inactive`, markerii `disabled`, `codex-auth=ready` și backendul ready.
- Diagnosticul read-only `33176363934` confirmă că vechile valori live
  `constructor-sync` și `constructor-publisher` sunt încă identice. Valorile
  incoming din GitHub Actions sunt distincte, dar nu au ajuns live.
- Unicul retry pe `f420c21c`, runul `33176522844`, a eșuat fail-closed în
  `recovery-preflight`; nu a activat nicio unitate și nu a afectat aplicația.
- Cauza exactă este un handoff de generație: helperul live b911, SHA-256
  `db72ef1d...`, trebuie să consume jurnalul runtime `prepared` înainte ca
  helperul corectat să poată fi publicat, dar interpretează serviciile oneshot
  canonice `static/inactive` drept enabled. Timerele sunt `disabled/inactive`,
  nu există joburi systemd sau holder al publication lock-ului.
- PR `#1472` oprește serviciile statice și validează postcondițiile, iar pentru
  jurnalul b911 folosește o singură migrare compatibilă dublu pin-uită, legată
  de manifestul installerului. Helperul live nu este înlocuit înainte ca
  absența durabilă a jurnalului să fie dovedită.
- Prima configurare pe generația corectată, runul `33179065073`, a ajuns la
  bootstrapul compatibil și a eșuat fail-closed deoarece `/run` este montat
  `noexec`; copia root-only verificată prin SHA nu a putut fi executată direct.
  Nu a activat nicio unitate și aplicația publică nu a fost afectată.
- PR `#1474` rulează copia deja autentificată prin `bash`, compatibil cu
  `noexec`, fără să slăbească pinningul, ownershipul sau verificarea hashului.
- Configurările `33180818900` și retry-ul unic controlat `33181409551` au trecut
  de `noexec`, au publicat byte-for-byte toate cele șase unități forward, apoi
  au eșuat identic într-o post-validare systemd după peste 30 de reload-uri.
  Jurnalul a rămas `prepared`; timerele sunt `disabled/inactive`, serviciile
  `static/inactive`, fără joburi, markere sau stamp ready. Aplicația este verde.
- PR `#1476` separă mutația de dovadă: stop + disable `--no-reload`
  best-effort, un singur `daemon-reload`, apoi succes exclusiv prin
  UnitFileState/ActiveState/zero jobs. Etapele eșuate sunt etichetate non-secret.
- Configurarea exactă pe `3511d9df`, runul `33183438759`, a trecut
  `post-quiesce`, apoi a eșuat fail-closed în `recovery-preflight` la
  `unit-roll-forward:strict-live-unit-contract`. Toate cele șase fișiere live
  sunt byte-for-byte identice cu manifestul și candidatele; ulterior, fiecare
  predicat strict systemd a trecut read-only. Între ultimul `daemon-reload` și
  scanarea eșuată au fost aproximativ 659 ms, iar o scanare completă durează
  peste o secundă. Aceasta a indicat inițial o observație systemd/D-Bus
  tranzitorie, ipoteză infirmată ulterior de retry-ul bounded.
- Release-ul manual `33184958383` pentru aceeași tuplă a validat CI, buildul și
  imaginile, apoi s-a oprit fail-closed înainte de cutover: jurnalul persistent
  de quiesce aparține configurării Constructor întrerupte, nu cererii de
  release. Nu a fost deployată o versiune nouă; jurnalul nu trebuie preluat sau
  șters de un release cu altă tuplă.
- PR `#1478` păstrează toate predicatele fail-closed și reîncearcă bounded
  numai validatorii read-only (`12 × 0,25 s`); mutatorii și `daemon-reload`
  rămân one-shot. Acceptă și actorul canonic `github-actions[bot]` printr-un
  allowlist fără caractere de shell.
- Configurarea `33187020692` pe `b16aef52` a executat toate cele 12 probe
  bounded ale dovezii stricte și a eșuat tot la
  `unit-roll-forward:strict-live-unit-contract`; rollbackul a rămas incomplet,
  cu unitățile oprite. Absența etichetelor `quiesce-postcondition` dovedește că
  stop/disable, ActiveState, zero joburi și contractul pre-publicare au trecut.
  Ipoteza unei întârzieri tranzitorii simple este infirmată; abaterea persistentă
  este într-un predicat strict-only, încă neatribuit de helperul live.
- PR `#1480` nu relaxează și nu repetă nicio mutație. La ultima dintre cele 12
  probe emite o singură etichetă cu vocabular fix pentru predicatul strict
  eșuat, fără căi ori valori libere; toate check-urile protejate au fost verzi.
- Configurarea controlată unică `33190206039` pe `a93eae09` a emis exact
  `kelion-codex-worker.timer:timer-contract`, apoi a eșuat fail-closed și a
  lăsat unitățile oprite. Cauza este evaluarea Bash a declarației `local`:
  `timer=${logical#...}` era expandat din scope-ul apelantului înainte ca
  `logical=$2` să fie aplicat. Validarea candidatului rula într-o buclă cu
  `logical` corect și trecea; validarea live strictă nu avea acel scope și
  eșua pe aceiași bytes. Declarația analogă a serviciilor are același defect
  demonstrabil și este corectată împreună, înainte să devină următorul blocaj.
- PR `#1482` a separat declarațiile de derivările dependente și a păstrat
  neschimbate toate predicatele de bytes, conținut și systemd. Regresia rulează
  timerul și serviciul cu `logical` exterior conflictual sau absent și dovedește
  că numai argumentul explicit este autoritativ și că un argument fals rămâne
  respins.
- Release-ul canonic `33192026959` pe `ccb4b425` a validat candidatul, apoi s-a
  oprit fail-closed înainte de cutover deoarece jurnalul persistent aparține
  configurării Constructor întrerupte. Nu a publicat și nu a activat release-ul.
- Configurarea controlată `33205355542` pe `aa330322` a confirmat că installerul
  trece recovery, publicarea celor șase unități, `published-validation` și
  `commit`. Telemetria post-installer a atribuit apoi exact eșecul:
  `phase=post-installer`, `check=signing-key-validation`, `exit_code=1`.
- CI `33193590693` și buildul OCI `33193943981` pentru `aa330322` sunt verzi.
  Release-ul `33194500539` a fost refuzat înainte de cutover deoarece
  `runtime.env` live nu trece încă validatorul canonic; nu a publicat versiunea.
- Remedierea curentă păstrează materialul și fingerprintul cheii existente.
  Pentru o cheie regulară, root-owned, fără hardlinkuri și cu mărime limitată,
  construiește o copie `0400` root-only, validează ED25519 și egalitatea
  byte-for-byte, apoi o publică atomic. O cheie invalidă, un symlink, un owner
  străin sau un hardlink rămân refuzate fail-closed.
- PR `#1487` a fost integrat prin rebase, iar toate porțile master și buildul OCI
  exact au trecut. Release-ul automat `33207891242` a validat artefactul și
  semnăturile, apoi a fost refuzat în `Release blue-green pe VPS`; nu a produs
  dovada externă și versiunea live a rămas neschimbată.
- Configurarea unică `33207951663` a trecut din nou installerul complet și a
  eșuat fail-closed la `phase=post-installer`,
  `check=signing-key-normalization`, înainte de publicarea copiei normalizate.
- Cauza este contractul parserului public: `ssh-keygen -y` poate emite tipul,
  blobul și comentariul cheii, dar validatorul cerea greșit sfârșit de linie
  imediat după blob. Reproducerea executabilă respinge o cheie ED25519 sănătoasă
  exact în validarea copiei `0400`. Remedierea canonizează numai tipul și blobul
  public, păstrează verificarea ED25519/fingerprint și nu schimbă cheia privată.
- PR `#1489` a canonizat strict cheia publică la algoritm + blob, a păstrat
  protecțiile pentru tip, owner, hardlink, dimensiune și fingerprint și a fost
  integrat prin rebase după toate porțile verzi. Workflow-ul din `master` este
  byte-for-byte identic cu varianta validată local; CI master este verde.
- PR `#1496` a mutat toate apelurile Podman rootless în runtime-ul accesibil
  identității Constructor. CI `33218751472` și buildul OCI `33219033777` pentru
  `645afe8d` sunt verzi; pull-urile worker și publisher au trecut pe VPS.
- Release-ul canonic `33219478924` pentru aceeași tuplă a fost refuzat înainte
  de cutover deoarece `runtime.env` live este încă legacy. Configurarea
  `33219503435` a instalat Constructorul dezactivat și a ajuns la aplicarea
  runtime, apoi a fost refuzată fail-closed: fișierul staged
  `constructor-config.constructor-release.env` conținea două comentarii, iar
  validatorul strict acceptă exclusiv linii `CHEIE=valoare`. Versiunea publică
  a rămas `baf00ae` și endpointurile de sănătate sunt verzi.
- Remedierea curentă mută explicația în afara heredoc-ului `.env` și corectează
  și următorul blocaj determinist: contractul live trebuie să ceară egalitatea
  runtime/publisher pentru porțile PR, dar release-ul post-merge trebuie să
  rămână exact `verify,container-isolation`. Regresiile execută validatorul pe
  fișierul generat și contractul separat al porților; pin-ul SHA-256 al helperului
  compatibil de recovery este actualizat la bytes-ii noi.

## Următorul pas sigur

1. Publică remedierea heredoc-ului release, regresia executabilă și acest
   checkpoint numai prin PR, fără bypass sau push direct în `master`; cere toate
   check-urile protejate.
2. După merge, cere CI și build OCI verzi pentru noul vârf `master`, apoi rulează
   o singură configurare controlată pe acel SHA și cere rezultat verde.
3. Abia după configurarea verde, reia release-ul canonic al noii tuple; dovedește
   extern SHA-ul complet, readiness și side effects înainte să marchezi deploy-ul
   reușit sau să închizi incidentele verifierului.

## Legături canonice

- Recovery static + bootstrap b911: <https://github.com/kelion-team/kelionai/pull/1472>
- Hotfix `noexec`: <https://github.com/kelion-team/kelionai/pull/1474>
- Contract systemd strict one-shot: <https://github.com/kelion-team/kelionai/pull/1476>
- Build OCI `3511d9df`: <https://github.com/kelion-team/kelionai/actions/runs/33182832152>
- Configure `noexec` fail-closed: <https://github.com/kelion-team/kelionai/actions/runs/33179065073>
- Configure post-validare fail-closed: <https://github.com/kelion-team/kelionai/actions/runs/33180818900>
- Retry controlat identic: <https://github.com/kelion-team/kelionai/actions/runs/33181409551>
- Configure strict-contract fail-closed: <https://github.com/kelion-team/kelionai/actions/runs/33183438759>
- Release manual blocat de jurnalul configurării: <https://github.com/kelion-team/kelionai/actions/runs/33184958383>
- Retry bounded strict fail-closed: <https://github.com/kelion-team/kelionai/actions/runs/33187020692>
- Telemetrie strictă protejată: <https://github.com/kelion-team/kelionai/pull/1480>
- Configure cu predicat exact: <https://github.com/kelion-team/kelionai/actions/runs/33190206039>
- Remediere scope Bash: <https://github.com/kelion-team/kelionai/pull/1482>
- Release canonic blocat de jurnal: <https://github.com/kelion-team/kelionai/actions/runs/33192026959>
- Configure post-installer neatribuit: <https://github.com/kelion-team/kelionai/actions/runs/33192142478>
- Configure signing-key-validation atribuit: <https://github.com/kelion-team/kelionai/actions/runs/33205355542>
- Release `aa330322` refuzat de contractul runtime: <https://github.com/kelion-team/kelionai/actions/runs/33194500539>
- Normalizare cheie Constructor: <https://github.com/kelion-team/kelionai/pull/1487>
- Build OCI `d61d5d56`: <https://github.com/kelion-team/kelionai/actions/runs/33207342384>
- Release `d61d5d56` refuzat înainte de cutover: <https://github.com/kelion-team/kelionai/actions/runs/33207891242>
- Configure cu parserul public necanonic: <https://github.com/kelion-team/kelionai/actions/runs/33207951663>
- Parser canonic al cheii publice: <https://github.com/kelion-team/kelionai/pull/1489>
- CI master `392b1746`: <https://github.com/kelion-team/kelionai/actions/runs/33210808739>
- Build OCI `392b1746`: <https://github.com/kelion-team/kelionai/actions/runs/33211160656>
- Remediere AWK runtime: <https://github.com/kelion-team/kelionai/pull/1493>
- CI master `01d8522`: <https://github.com/kelion-team/kelionai/actions/runs/33216840949>
- Build OCI `01d8522`: <https://github.com/kelion-team/kelionai/actions/runs/33217134821>
- Release `01d8522` refuzat înainte de cutover: <https://github.com/kelion-team/kelionai/actions/runs/33217596289>
- Configurare cu cwd Podman invalid: <https://github.com/kelion-team/kelionai/actions/runs/33217617233>
- Remediere cwd Podman: <https://github.com/kelion-team/kelionai/pull/1496>
- CI master `645afe8d`: <https://github.com/kelion-team/kelionai/actions/runs/33218751472>
- Build OCI `645afe8d`: <https://github.com/kelion-team/kelionai/actions/runs/33219033777>
- Release `645afe8d` refuzat înainte de cutover: <https://github.com/kelion-team/kelionai/actions/runs/33219478924>
- Configurare cu comentarii în env-ul staged: <https://github.com/kelion-team/kelionai/actions/runs/33219503435>
- Status read-only: <https://github.com/kelion-team/kelionai/actions/runs/33176281001>
- Diagnostic token live: <https://github.com/kelion-team/kelionai/actions/runs/33176363934>
