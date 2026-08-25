# Checkpoint operațional curent

Actualizat: `2026-08-25T04:09:55Z`

## Obiectiv activ

Stabilizarea completă a producției și verificarea aplicației în browser/chat
live, apoi repararea traseului creier -> control structurat -> avatar astfel
încât gesturile, expresiile și animațiile să fie aplicate și confirmate real.

## Punct de reluare Git

- Repo: `kelion-team/kelionai`
- Worktree: `C:\Users\adria\kelionai-workspace`
- Branch activ: `codex/ops-checkpoint-proxy-20260825`
- Bază branch: `origin/master` la `b65d7483a581e3c42e285e76a1d1c3a1351a6c2d`
- Schimbări locale intenționate: fixul durabil pentru mount/reconciliere proxy
  și acest checkpoint. Verifică `git status` înainte de orice editare.

## Rutina de reluare Codex

`AGENTS.md` obligă orice agent care lucrează la release/producție să citească
acest fișier primul. Skill-ul de proiect
`.codex/skills/kelion-operations-memory/SKILL.md` aplică aceeași ordine după un
restart sau upgrade și a trecut validatorul oficial local `quick_validate.py`.
Procesele și subagenții anteriori nu se presupun activi după restart.

## Producție verificată

- Versiune publică: `b65d748`.
- Release: GitHub Actions `32807088322`, production-release `#1500`, succes.
- `/livez`: HTTP 200.
- `/readyz`: `ready=true`; config, database, migrations, browserWorker și
  converterWorker sunt toate `true`; candidatul și efectele laterale sunt active.
- Proxy: `kelion-proxy` este `running healthy`.

## Ultimul incident și remedierea aplicată

Deploy-ul #1500 a publicat aplicația, dar containerul proxy păstrase inode-ul
vechi al `/etc/caddy/Caddyfile`, deoarece fișierul era montat individual iar
deploy-ul îl înlocuiește atomic. Hostul avea politica nouă, containerul pe cea
veche.

La `2026-08-25T04:05Z`, compose-ul a fost validat cu binarul pregătit
`/root/kelion/bin/docker-compose` și a fost recreat controlat numai containerul
`kelion-proxy`. După reconciliere:

- inode host `/root/kelion/proxy/Caddyfile`: `2049:2365507`;
- inode container `/etc/caddy/Caddyfile`: `2049:2365507`;
- CSP public conține `connect-src 'self' blob:`;
- `/api/version` răspunde `b65d748`;
- `/readyz` rămâne complet verde.

Proba într-o filă publică proaspătă, urmată de aplicarea update-ului PWA, arată
avatarul texturat corect: păr mov, piele și tricou negru. Regresia avatarului gri
este remediată live.

## Fix durabil în lucru

Branch-ul activ modifică:

- `deploy/compose.proxy.yml`: montează directorul de configurare la
  `/etc/caddy`, astfel încât înlocuirile atomice și rollback-ul să fie vizibile;
- `deploy/deploy.sh`: reconciliază compose-ul și pentru proxy-ul deja pornit,
  apoi validează și reîncarcă Caddy;
- `deploy/lib/caddy-security.test.mjs`: acoperă mountul de director și ordinea
  reconcile -> validate -> reload.

Dovezi locale existente: sintaxă Bash verde; testele Caddy + rollback 34/34;
întreaga suită `deploy/lib` 76 pass, 0 fail, 1 skip doar pentru lipsa `jq` local;
audituri de sintaxă, workflow-uri și hardcodări verzi. Compose runtime local nu
a fost testat deoarece Docker nu este instalat; CI trebuie să-l valideze.

## Constatări următoare, încă nereparate

Auditul traseului creier-avatar a identificat: gesturi lazy pierdute înainte de
încărcare; finalizări necorelate care pot întrerupe gestul nou; Stage blocabil
în dans; preferințe de gesturi fail-open; expresii faciale fără buffer; două
protocoale `gest`/`gesture`; lipsa unui tool structurat prin care creierul să
aleagă și să primească confirmarea gestului; lipsa testelor frontend pentru
acest traseu. Nu declara aceste funcții reparate până la implementare și probă
live autentificată.

## Următorul pas sigur

1. rulează `git status` și inspectează toate fișierele intenționate din diff;
2. rulează din nou testele țintite și `git diff --check`;
3. commit, push și PR pentru checkpoint + fixul proxy;
4. așteaptă toate verificările obligatorii și îmbină numai pe verde;
5. rulează production-release și dovedește că mountul este director, CSP-ul
   păstrează `blob:`, versiunea live este commitul îmbinat și `/readyz` e verde;
6. apoi implementează protocolul creier-avatar și matricea de teste live.
