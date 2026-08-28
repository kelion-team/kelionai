# Checkpoint operațional curent

Actualizat: `2026-08-28T05:08:00Z`

## Stare verificată

- Repo: `kelion-team/kelionai`; branch implicit și singura țintă de producție:
  `master`.
- `origin/master`: `0438af5b9ce4cd17566b9cd52fc867993a959cca`.
- Live rulează încă versiunea sănătoasă `baf00aee68206ebdf259143fd9b71813fd6a5c02`
  în slotul `green`; containerele aplicației și workerelor sunt healthy.
- `vps-constructor-control` #794 și #796 au confirmat conexiunea SSH,
  `codex-auth=ready`, `ready=true` și `sideEffectsActive=true` pentru generația
  activă a aplicației.
- Cele trei timere Constructor și markerii lor sunt inactive/dezactivate.
  `sideEffectsActive` este markerul generației aplicației, nu starea timerelor.
- Configurarea Constructorului #795 a eșuat înainte de activare. Diagnosticul
  read-only #117 a confirmat, fără valori, că starea VPS existentă conține
  `TOKEN_IDENTITY_COLLISION:constructor-sync:constructor-publisher`.
- Secretele furnizate runului #795 au trecut verificarea pairwise distinct de pe
  runner; eșecul remote mut corespunde verificării `usermod --help | grep -q`
  executate sub `pipefail`, înaintea cutover-ului tranzacțional.

## Următorul pas sigur

1. Îmbină numai după porți verzi remedierea preflight-ului `usermod` fără
   pipeline cu închidere timpurie.
2. Rulează din nou o singură operație `configure-constructor` pe `master`.
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
