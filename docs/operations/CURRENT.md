# Checkpoint operațional curent

Actualizat: `2026-08-28T13:53:40Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; singura țintă de producție este `master`.
- `origin/master` este `f420c21c9492dac4a64dc1d780421efd98dcaa1e` (PR `#1470`).
  `pr-verify` `33171574122` și buildul OCI exact `33171912264` sunt verzi.
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
- Remedierea curentă oprește serviciile statice și validează postcondițiile,
  iar pentru jurnalul b911 folosește o singură migrare compatibilă dublu
  pin-uită, legată de manifestul installerului. Helperul live nu este înlocuit
  înainte ca absența durabilă a jurnalului să fie dovedită.
- Validări locale curente: `bash -n`, `git diff --check`, workflow safety,
  hardcoding și `67/67` teste Constructor/deploy aplicabile sunt verzi.

## Următorul pas sigur

1. Publică remedierea numai prin PR `chore/*`, fără bypass sau push în master.
2. Cere toate check-urile verzi, merge prin rebase și build OCI pentru SHA-ul
   exact rezultat în `master`.
3. Rulează exact o operație `configure-constructor`; cere recovery, cutover,
   credențiale distincte și status final verzi.
4. Activează worker+publisher, execută un ordin pilot real cap-coadă și activează
   release-ul numai cu PR-ul pilot merged și commitul exact.

## Legături canonice

- Fix servicii statice: <https://github.com/kelion-team/kelionai/pull/1470>
- Build OCI `f420c21c`: <https://github.com/kelion-team/kelionai/actions/runs/33171912264>
- Configure fail-closed curent: <https://github.com/kelion-team/kelionai/actions/runs/33176522844>
- Status read-only: <https://github.com/kelion-team/kelionai/actions/runs/33176281001>
- Diagnostic token live: <https://github.com/kelion-team/kelionai/actions/runs/33176363934>
