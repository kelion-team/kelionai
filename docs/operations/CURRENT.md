# Checkpoint operațional curent

Actualizat: `2026-08-28T16:33:54Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- `origin/master` este `a93eae09f81eb17c4f36554023e9b1209237483e` (PR `#1480`).
  CI master `33189074236` și buildul OCI exact `33189473374` sunt verzi.
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
- Patchul curent separă declarațiile de derivările dependente și păstrează
  neschimbate toate predicatele de bytes, conținut și systemd. Regresia rulează
  timerul și serviciul cu `logical` exterior conflictual sau absent și dovedește
  că numai argumentul explicit este autoritativ și că un argument fals rămâne
  respins.

## Următorul pas sigur

1. Publică remedierea derivării Bash numai prin PR `chore/*`, fără bypass sau
   push în master; cere toate check-urile verzi.
2. Nu porni niciun release de producție. După merge, rulează o singură
   configurare controlată: ea trebuie să consume jurnalul existent, să treacă
   toate predicatele stricte și să încheie cu status verde.
3. Reia activarea și release-ul numai după absența dovedită a jurnalelor și
   după ce workerul, publisherul și release-ul trec verificarea finală.

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
- Status read-only: <https://github.com/kelion-team/kelionai/actions/runs/33176281001>
- Diagnostic token live: <https://github.com/kelion-team/kelionai/actions/runs/33176363934>
