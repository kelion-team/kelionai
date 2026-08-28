# Checkpoint operațional curent

Actualizat: `2026-08-28T12:18:00Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; branch implicit și singura țintă de producție:
  `master`.
- `origin/master`: `b911a3bf011932e959dc53eeca47b89dad7ec883` (merge-ul PR
  `#1468`).
- `pr-verify` pentru acest SHA este verde în runul `33169216377`, iar buildul
  OCI exact, inclusiv trust probe, semnare și publicare, este verde în runul
  `33169526982`.
- Singura reluare `configure-constructor` pe acest SHA, runul `33170074001`, a
  trecut supersedarea intentului vechi, publicarea artefactelor și validarea
  celor șase unități, apoi a eșuat fail-closed la `unit-cutover`.
- Cauza este dovedită în sursă și log: serviciile oneshot Constructor nu au
  intenționat `[Install]`/`WantedBy` și au `UnitFileState=static`, dar bariera
  generică interpreta succesul `systemctl is-enabled` ca activare. Cele trei
  avertismente systemd din run corespund exact celor trei servicii statice.
- Statusul read-only `33170314943` confirmă cele trei timere `inactive`, cei
  trei markeri `disabled`, `codex-auth=ready` și backendul `ready:true`; nu a
  existat activare prematură.
- Diagnosticul read-only `33170437766` confirmă că valorile live vechi pentru
  `constructor-sync` și `constructor-publisher` încă sunt identice. Valorile
  incoming din GitHub Actions au trecut deja poarta pairwise-distinct; ele nu
  au ajuns live deoarece tranzacția s-a oprit înainte de cutover-ul mixt.
- Corecția curentă validează tipizat `UnitFileState`: timerele trebuie exact
  `disabled`, serviciile exact `static`; stările active, joburile, drop-in-urile,
  fragmentele greșite și orice altă stare continuă să fie refuzate fail-closed.
- Jurnalul eșecului păstrează deja o generație supersedată. Reluarea următorului
  SHA păstrează durabil maximum două generații vechi autentificate, refuză
  ciclurile de sursă și o a treia supersesiune, iar cleanup-ul începe numai după
  ștergerea și sincronizarea jurnalului.
  Validări locale: `bash -n`, `git diff --check`, workflow/hardcoding/syntax,
  66/66 teste Constructor și 138/138 teste deploy aplicabile sunt verzi.

## Următorul pas sigur

1. Publică remedierea numai prin PR `chore/*`; toate checks și conversațiile
   trebuie să fie verzi, fără push direct în `master` și fără bypass.
2. După merge, construiește artefactele pentru SHA-ul exact nou din `master`.
3. Rulează o singură operație `configure-constructor`; cere `unit-cutover`,
   distinctness-ul celor cinci credențiale și markerul final verzi.
4. Confirmă prin `constructor-status` cele trei timere inactive și `ready:true`,
   apoi activează eșalonat worker+publisher și release-ul numai cu pilot valid.

## Legături canonice

- PR supersedare intent vechi: <https://github.com/kelion-team/kelionai/pull/1468>
- Build OCI exact: <https://github.com/kelion-team/kelionai/actions/runs/33169526982>
- Configure fail-closed: <https://github.com/kelion-team/kelionai/actions/runs/33170074001>
- Status read-only: <https://github.com/kelion-team/kelionai/actions/runs/33170314943>
- Diagnostic token live: <https://github.com/kelion-team/kelionai/actions/runs/33170437766>
