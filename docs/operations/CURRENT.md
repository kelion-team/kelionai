# Checkpoint operațional curent

Actualizat: `2026-08-28T21:07:24Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- `origin/master` este `392b174660b02ce3a2db23e0fedf1555206ea83b` (PR `#1489`).
  CI master `33210808739` este verde; buildul OCI exact `33211160656` rulează.
- Aplicația live rulează sănătos pe slotul green la `baf00ae`; `/readyz`
  raportează `ready:true` și `sideEffectsActive:true`.
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

## Următorul pas sigur

1. Publică testele executabile și acest checkpoint numai prin PR `chore/*`, fără
   bypass sau push în `master`; cere toate check-urile verzi.
2. Nu porni niciun release de producție. După merge, CI și buildul OCI exact,
   rulează o singură configurare controlată pe vârful `master`.
3. Activarea și release-ul rămân blocate până când configurarea este verde,
   jurnalele sunt absente și statusul final confirmă workerul, publisherul și
   releaserul dezactivate/ready conform etapei curente.

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
- Status read-only: <https://github.com/kelion-team/kelionai/actions/runs/33176281001>
- Diagnostic token live: <https://github.com/kelion-team/kelionai/actions/runs/33176363934>
