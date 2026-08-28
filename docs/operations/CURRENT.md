# Checkpoint operațional curent

Actualizat: `2026-08-28T05:41:00Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; branch implicit și singura țintă de producție:
  `master`.
- `origin/master`: `5c04dcae4b360ee30effb51b60e133c612293b11`.
- Live rulează încă versiunea sănătoasă `baf00aee68206ebdf259143fd9b71813fd6a5c02`
  în slotul `green`; containerele aplicației și workerelor sunt healthy.
- `vps-constructor-control` #794 și #796 au confirmat conexiunea SSH,
  `codex-auth=ready`, `ready=true` și `sideEffectsActive=true` pentru generația
  activă a aplicației.
- Cele trei timere Constructor și markerii lor sunt inactive/dezactivate.
  `sideEffectsActive` este markerul generației aplicației, nu starea timerelor.
- Configurările Constructorului #795 și #798 au eșuat înainte de activare.
  Diagnosticul read-only #118 a confirmat, fără valori, că starea VPS existentă conține
  `TOKEN_IDENTITY_COLLISION:constructor-sync:constructor-publisher`.
- Secretele furnizate runului #798 au trecut verificarea pairwise distinct de pe
  runner. Artefactul OCI fixat la master a fost construit, probat și semnat în
  build-ul #33144907325. Eșecul remote rămâne fără etichetă internă deoarece
  aserțiunile instalatorului nu raportează încă faza și linia.
- Statusul read-only #799 confirmă toate cele trei timere inactive și disabled,
  `codex-auth=ready` și aplicația `ready=true`; nu există activare parțială.

## Următorul pas sigur

1. Îmbină numai după porți verzi diagnosticul fail-closed al instalatorului,
   limitat la fază, linie și cod de ieșire, fără comandă ori date sensibile.
2. Rulează o singură operație `configure-constructor` pe `master` și remediază
   exact aserțiunea raportată; nu repeta orb.
3. Confirmă prin `vps-diag` că identitățile sunt distincte și prin
   `constructor-status` că nimic nu s-a activat prematur.
4. Activează `activate-worker-publisher`, verifică statusul, apoi folosește
   `activate-release` numai cu un PR pilot merged și commitul exact cerut de
   workflow.

## Legături canonice

- Workflow status verde #794:
  <https://github.com/kelion-team/kelionai/actions/runs/33143498133>
- Configurare refuzată #795:
  <https://github.com/kelion-team/kelionai/actions/runs/33143698760>
- Status post-eșec #796:
  <https://github.com/kelion-team/kelionai/actions/runs/33143743633>
- Diagnostic read-only #117:
  <https://github.com/kelion-team/kelionai/actions/runs/33143782462>
- Build OCI semnat pentru master:
  <https://github.com/kelion-team/kelionai/actions/runs/33144907325>
- Configurare refuzată #798:
  <https://github.com/kelion-team/kelionai/actions/runs/33145293484>
- Diagnostic read-only #118:
  <https://github.com/kelion-team/kelionai/actions/runs/33145400224>
- Status fail-closed #799:
  <https://github.com/kelion-team/kelionai/actions/runs/33145471701>
