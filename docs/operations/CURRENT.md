# Checkpoint operațional curent

Actualizat: `2026-08-25T22:01:26Z`

## Current verified state

- Repo: `kelion-team/kelionai`.
- `origin/master`: `7072263bdfb738953e6fefa67e5acf8b4fc15414`, verificat direct prin
  referința Git remote.
- Live: `b8e7a33`, verificat prin `/api/version` la ora actualizării.
- Readiness live: `ready=true`; `config`, `database`, `migrations`,
  `browserWorker` și `converterWorker` sunt `true`; candidatul și efectele
  laterale sunt active.
- Ultimul release live confirmat este runul GitHub Actions `32900123878` pentru
  `b8e7a33`.
- Buildul semnat pentru `7072263bdfb738953e6fefa67e5acf8b4fc15414` a fost
  finalizat cu succes în runul `32902537746`; acest fapt nu înseamnă că SHA-ul
  este live.
- Ultima configurare Constructor, run `32903385898`, a trecut remedierea ACL a
  cheii private, apoi a eșuat la înregistrarea cheii publice de semnare GitHub.
- Ultimul status Constructor, run `32903648228`, a confirmat cele trei timere
  inactive, cele trei servicii dezactivate și `codex-auth=required`.
- Live Voice nu este acceptată: captarea microfonului funcționează, dar sesiunea
  OpenAI Live cade după captare și clientul intră în fallback de dictare.
- Becul Admin `OpenAI 1/2` înseamnă un furnizor roșu din cele două rânduri
  OpenAI/căutare. Cauza fină a OpenAI roșu nu este încă dovedită din sesiunea
  Admin; nu este declarată automat drept lipsă de credit.
- Worktree-ul activ este
  `C:\Users\adria\AppData\Local\Temp\kelionai-pr1383`, branch
  `codex/release-train-policy-pr1383`, cu implementarea nepublicată a fișei
  persistente Constructor. Nu există încă un PR nou pentru această reconciliere.
- Producția nu a fost modificată de lucrul din acest checkpoint.

## Unfinished work

- Activează publisherul, releaserul și workerul Constructor numai după ce
  ambele credențiale externe sunt valide.
- Reconciliază o singură dată implementarea fișei de lucru cu `origin/master`,
  apoi rulează testele relevante și deschide un PR protejat.
- Proiectează evenimentele persistente ale fișei în monitorul Kelyon și în
  Admin, inclusiv progres real, heartbeat, cauză, acțiune automată și dovadă.
- Transformă incidentul Live Voice într-un work item persistent, deduplicat și
  observabil, cu clasificare, retry limitat, strategii distincte, fallback clar,
  escaladare și test de regresie.
- Dovedește bidirecțional Live Voice în clientul real; dictarea nu satisface
  acest criteriu.
- Rulează o cerere pilot benignă prin Admin -> Constructor -> worker -> PR ->
  protected master -> artefact semnat -> release -> rezultat live.
- Confirmă în client comportamentul de update/cache numai după următorul
  release reușit.
- Urmărește toate suprafețele Admin prin registrul canonic
  [`ADMIN-CAPABILITY-INVENTORY.md`](ADMIN-CAPABILITY-INVENTORY.md).

## Blockers / owner action

Sunt necesare exact două acțiuni externe care nu pot fi executate sigur de
aplicație:

1. credentiala GitHub Actions `CONSTRUCTOR_PUBLISHER_GITHUB_TOKEN` trebuie
   înlocuită sau actualizată cu permisiunea user-scoped
   `SSH signing keys: write` (ori scope clasic `write:ssh_signing_key`);
2. profilul `kelion-codex` de pe VPS trebuie să finalizeze loginul Codex
   interactiv.

Valorile credentialelor nu se introduc în acest document, browser, loguri,
worker sau chat. După rezolvarea celor două acțiuni, același traseu trebuie să
se reia automat; ownerul nu recreează cererea.

## Next ordered steps

1. păstrează implementarea locală a fișei de lucru într-un commit de siguranță;
2. creează un singur release-train branch din `origin/master` și reconciliază
   commitul o singură dată;
3. completează vizibilitatea Admin/Stage și incidentul Live Voice fără progres
   simulat;
4. rulează testele țintite, build, lint, typecheck și verificarea migrației;
5. deschide PR, rezolvă review-ul și așteaptă toate checkurile obligatorii;
6. după acțiunile externe, rerulează configurarea oficială și confirmă
   heartbeatul workerului;
7. execută un singur E2E benign și păstrează linkurile/receipturile;
8. îmbină și publică numai prin traseul protejat, apoi confirmă versiunea,
   readiness, vocea și refresh-ul clientului.

## Canonical links

- Repo: <https://github.com/kelion-team/kelionai>
- Ultimul release live verificat: <https://github.com/kelion-team/kelionai/actions/runs/32900123878>
- Build semnat pentru master curent: <https://github.com/kelion-team/kelionai/actions/runs/32902537746>
- Configurare Constructor eșuată: <https://github.com/kelion-team/kelionai/actions/runs/32903385898>
- Status Constructor verificat: <https://github.com/kelion-team/kelionai/actions/runs/32903648228>
- PR remediere ACL, îmbinat: <https://github.com/kelion-team/kelionai/pull/1388>
- Contract de livrare: [`DELIVERY-RULES-AND-ROADMAP.md`](DELIVERY-RULES-AND-ROADMAP.md)
- Inventar Admin: [`ADMIN-CAPABILITY-INVENTORY.md`](ADMIN-CAPABILITY-INVENTORY.md)

## Handoff pentru sesiunea următoare

Prezintă proactiv secțiunile de mai sus înainte de a cere ownerului să repete
contextul. Verifică din nou `origin/master`, runurile GitHub și sondele live;
orice diferență se actualizează aici înainte de o mutație. Nu declara
Constructor, fișa de lucru sau Live Voice drept live până la dovezile E2E.
