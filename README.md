# KelionAI

KelionAI este un asistent conversațional cu text, voce, vedere la cerere, memorie
controlată de utilizator și continuitate offline. Acest repository este sursa
canonică pentru aplicația web, API, clienții nativi și banda Constructor.

## Limite obligatorii

- **Un singur creier online:** numai API-urile oficiale OpenAI. Google este
  folosit pentru identitate și, când utilizatorul autorizează explicit, pentru
  funcții Workspace; nu este furnizor AI.
- **Offline real:** modelele locale pentru limbaj, transcriere și voce rulează
  pe dispozitiv și nu devin fallback-uri cloud ascunse.
- **Secrete numai pe server:** cheia OpenAI nu intră în browser, aplicații
  native, Git, loguri sau joburi Constructor.
- **Admin prin Google:** biometria, vocea și fața pot personaliza experiența,
  dar nu acordă privilegii administrative.
- **Constructor local separat:** worker-ul de încredere execută direct OpenCode
  1.18.25 cu Qwen3.6 local prin llama.cpp, fără login sau credentială OpenAI.
  Chatul intern și aplicația desktop separată folosesc aceeași coadă server-side.
- **Fără publicare directă:** job → worktree dedicat → OpenCode/Qwen → porți
  blocante → PR → master → deploy verificat.

Regulile complete pentru orice agent sau contribuitor sunt în
[`AGENTS.md`](AGENTS.md).

## Arhitectură

| Zonă | Rol |
| --- | --- |
| `frontend/` | React, Vite, avatar 3D, PWA și kitul offline |
| `backend/` | Fastify, OpenAI Responses/Realtime, autorizare, memorie și ledger |
| PostgreSQL | stare persistentă, consimțăminte, joburi și evidențe financiare |
| `deploy/codex-worker.mjs` | worker privat pentru Constructor; nu este expus web |
| `deploy/` | containere, systemd, Caddy, backup, porți PR și deploy |
| `android/`, `ios/`, `desktop/` | clienți nativi cu politici de platformă |

## Bani și costuri

- Pentru admin, debitul în produsul Kelion este întotdeauna **0**.
- Consumul OpenAI al adminului rămâne o cheltuială internă Kelion și este
  înregistrat într-un ledger separat, fără a pretinde că abonamentul ChatGPT
  plătește API-ul aplicației.
- La cumpărarea creditelor de către clienți, backend-ul conservă suma în unități
  monetare minore și aplică exact regula **75% credit utilizabil / 25% Kelion**.
- Tarifele, modelele și limitele vin din configurația validată sau din baza de
  date; interfața nu inventează valori de rezervă.

## Dezvoltare locală

Cerințe: Node.js 22, PostgreSQL și npm. Copiază
`backend/.env.example` în `backend/.env` și completează doar valorile locale;
nu comite fișierul rezultat.

```bash
npm --prefix backend ci
npm --prefix frontend ci

# terminal 1
npm --prefix backend run dev

# terminal 2
npm --prefix frontend run dev
```

Verificările minime înainte de PR:

```bash
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix backend run lint
npm --prefix frontend run build
npm --prefix frontend run lint
node scripts/inventar-audit.mjs
node scripts/verifica-creier-unic.mjs
node scripts/verifica-hardcodari.mjs
node scripts/verifica-exporturi.mjs
node scripts/identifica-teste-moarte.mjs
node scripts/verifica-sintaxa.mjs
node scripts/verifica-workflow-uri-sigure.mjs
bash scripts/verifica-secrete.sh --worktree --dist
```

CI și worker-ul trebuie să ruleze aceleași porți în mod blocant. Inventarul
hash-ează fiecare fișier versionat sau nou, neignorat, și eșuează dacă apare o
familie de fișiere neclasificată.

Schimbările dependente se adună într-un singur release train, cu preflight
local și o singură poartă CI completă înainte de rebase merge. Vezi
[`docs/RELEASE-TRAIN.md`](docs/RELEASE-TRAIN.md).

## Operare

- Instalare, rollback și dovada publicării: [`deploy/DEPLOY.md`](deploy/DEPLOY.md)
- Incidente, backup și restaurare: [`deploy/RUNBOOKS.md`](deploy/RUNBOOKS.md)

Restaurarea bazei de date, rotația secretelor, rescrierea istoricului Git și
publicarea în producție sunt operații controlate. Niciuna nu este efectuată de o
probă locală sau de aplicația publică.
