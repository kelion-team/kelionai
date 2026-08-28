# Checkpoint operațional curent

Actualizat: `2026-08-28T11:12:00Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; branch implicit și singura țintă de producție:
  `master`.
- `origin/master`: `6f0963895ebd5494e48df4ba2ef070e7add2c18f`.
- Buildul OCI pentru acest SHA, inclusiv trust probe, semnare și publicare, este
  verde în runul `33165092882` (6m50s).
- Auditul read-only `audit-token-identity` `33164813105` a confirmat
  `NO-COLLISION` pentru cele patru credențiale incoming din GitHub Actions față
  de OAuth Admin live. Nu a modificat VPS-ul și nu a expus valori sau hashuri.
- `configure-constructor` `33165537976` a eșuat fail-closed în faza
  `unit-cutover`, linia telemetrică 842, înainte de activare. Cele trei timere
  Constructor rămân oprite.
- Cauza dovedită nu este rotația secretelor: installerul execută mai întâi un
  cutover exclusiv al celor șase unități. Manifestul unit-only nu conține
  credențialele incoming, iar helperul valida prematur setul live legacy. Abia
  după instalarea unităților workflow-ul construiește tranzacția mixtă cu
  valorile incoming deja validate pairwise.
- Corecția locală introduce un opt-in limitat pentru amânarea porților numai în
  cele două cutover-uri unit-only urmate obligatoriu de tranzacția mixtă
  (`instaleaza-constructor.sh` și `vps-set-env.yml`). Deploy-ul release nu
  primește opt-in-ul și continuă să valideze toate identitățile live.
- Validări locale pentru corecție: `git diff --check` PASS, `bash -n` PASS pentru
  helper și installer, `constructor-publication.test.mjs` 64/64 PASS. Testul
  negativ dovedește că unit-only fără opt-in și orice cutover mixt execută toate
  porțile, iar orice coliziune rămâne fail-closed.

## Următorul pas sigur

1. Publică schimbarea numai prin PR `chore/*`, cu toate checks și conversațiile
   obligatorii verzi; fără push direct în `master` și fără bypass.
2. După merge, cere un build verde pentru SHA-ul exact nou din `master`.
3. Rulează o singură operație `configure-constructor`; tranzacția mixtă trebuie
   să valideze candidații incoming înainte de commit și să consume bariera
   unit-only numai după succes.
4. Confirmă prin `constructor-status` că toate trei sunt încă inactive și
   `ready:true`, apoi activează eșalonat worker+publisher și release-ul pilot.

## Legături canonice

- Audit identitate incoming: <https://github.com/kelion-team/kelionai/actions/runs/33164813105>
- Build OCI verde pentru `6f096389`: <https://github.com/kelion-team/kelionai/actions/runs/33165092882>
- Configure fail-closed la `unit-cutover`: <https://github.com/kelion-team/kelionai/actions/runs/33165537976>
