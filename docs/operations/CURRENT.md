# Checkpoint operațional curent

Actualizat: `2026-08-26T16:25:31Z`

## Current verified state

- Repo: `kelion-team/kelionai`.
- `origin/master`: `16eecd83470e1ff27f2fce5d1cf6204975a6b4d5`.
- Live: `baf00ae`; `/livez=200`, `/readyz` raportează `ready=true`, toate
  checkurile active și `release.sideEffectsActive=true`.
- Release-ul corect `32986552385` pentru `16eecd83` a verificat candidatul și
  semnăturile, apoi s-a oprit înainte de cutover: `runtime.env` live are schema
  veche de 80 de chei, iar validatorul curent cere exact 86.
- Provisionarea `32986695615` s-a oprit pe runner înainte de SSH sau mutație
  VPS. Workflow-ul cerea `secrets.GITHUB_RELEASE_OAUTH_TOKEN`, nume imposibil
  deoarece GitHub rezervă prefixul `GITHUB_`; tokenul GHCR dedicat lipsește de
  asemenea.
- Rerunul vechi `32977343950` a fost retras fail-safe deoarece `master` a
  avansat. Nu a modificat VPS-ul.
- Fișierele live `/root/kelion/secrets/github-release-oauth-token` și
  `/root/kelion/gate-secrets/github-ghcr-read-token` sunt absente. Configurile
  host-only Constructor sunt absente, iar autentificarea Codex rămâne necesară.
- Remedierea este în PR-ul protejat `#1395`, branch
  `codex/fix-runtime-contract-rollout`, worktree
  `C:\Users\adria\.devin\kelionai-runtime-contract-fix`. Ea redenumește sursa
  Actions în `KELION_GITHUB_RELEASE_OAUTH_TOKEN`, clasifică întreaga schemă
  runtime/secrete și cere egalitate exactă între contract, payload și validator.
- Porțile locale pentru remediere sunt verzi: backend typecheck/test/lint,
  frontend build/test/lint, testele statice/Constructor, audituri npm, scanare
  Gitleaks worktree+istorie și JSCpd fără clone.

## Blockers / owner action

GitHub cere reautentificarea contului înainte de generarea credențialelor. Nu
se copiază parola, tokenurile sau codurile 2FA în chat ori loguri.

După integrarea remedierei sunt necesare două credențiale distincte:

1. `KELION_GITHUB_RELEASE_OAUTH_TOKEN`: identitate user-bound de review,
   diferită de autorul PR, limitată la repository; `Pull requests: write` și
   `Checks`, `Actions`, `Contents`, `Administration`: read.
2. `CONSTRUCTOR_GHCR_READ_TOKEN`: PAT classic separat, scope exclusiv
   `read:packages`, cu acces la imaginea gate privată.

Pentru Constructor complet rămân necesare credentiala sync dedicată,
permisiunea de înregistrare a cheii publice de semnare pentru publisher și
loginul Codex interactiv pe profilul host-only.

## Next ordered steps

1. așteaptă porțile obligatorii ale PR-ului `#1395` și integrează prin rebase
   numai pe verde;
3. generează și salvează cele două credențiale ca environment secrets în
   `production`, apoi rulează un `vps-set-env` nou pe `master`;
4. validează ACL-urile, configurația strictă, readiness și gate pull;
5. rulează release-ul pentru noul SHA din `master` și confirmă SHA-ul live;
6. configurează/autentifică/activează Constructor etapizat, apoi rulează pilotul
   auditat înainte de activarea dispatcherului release;
7. actualizează acest checkpoint cu linkurile și dovezile finale.

## Canonical links

- Repo: <https://github.com/kelion-team/kelionai>
- PR remediere contract: <https://github.com/kelion-team/kelionai/pull/1395>
- Release corect eșuat sigur: <https://github.com/kelion-team/kelionai/actions/runs/32986552385>
- Provisionare eșuată înainte de SSH: <https://github.com/kelion-team/kelionai/actions/runs/32986695615>
- Rerun vechi retras: <https://github.com/kelion-team/kelionai/actions/runs/32977343950>
- Integrare GitHub Admin: [`GITHUB-RELEASE-INTEGRATION.md`](GITHUB-RELEASE-INTEGRATION.md)
- Contract livrare: [`DELIVERY-RULES-AND-ROADMAP.md`](DELIVERY-RULES-AND-ROADMAP.md)

## Handoff pentru sesiunea următoare

Nu relansa runurile vechi. Verifică din nou `origin/master`, PR-ul remedierii și
sondele publice. Provisionarea trebuie să fie un run nou din workflow-ul reparat;
orice token gol sau reutilizat rămâne fail-closed.
