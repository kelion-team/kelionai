# DEVIN HANDOFF — Kelionai (constructor + session state, 14 aug 2026)

> Scop: tot ce-ți trebuie ca să preiei de aici. Owner: **Adrian**
> (adrianenc11@gmail.com), admin unic. **Răspunde-i în română.** Testează **LIVE**
> pe kelionai.app. Citește întâi `AI-HANDOFF.md` (§13 „Starea") și
> `RAMAS-DE-FACUT.md` — sunt sursa de adevăr întreținută; ține-le la zi.

---

## 0. TL;DR — ce e rupt ACUM și cum se repară

**Simptom:** constructorul (worker-ul agentic de pe VPS) **trăiește** (ia ordine,
le pornește), dar fiecare ordin **se blochează la ~5% „tură sterilă"** — creierul
răspunde cu TEXT în loc să cheme o unealtă, deci ordinul nu avansează și pică/recade.

**Cauza (măsurată, nu presupusă):** creierul constructorului n-are credit/config
funcțional:
- **PRIMAR — Gemini** (`geminiModelGreu`, tier Pro) e pe **£0.00** → API-ul dă
  eroare → nu poate răspunde.
- **REZERVĂ — Fable 5** (Anthropic `claude-fable-5`, endpoint OpenAI-compat) —
  cheia ESTE pusă (becul „Fable 5" e verde), DAR codul **LIVE** o cheamă cu
  `tool_choice:'auto'` → și rezerva intră sterilă. Reparat în **PR #1091**
  (`tool_choice:'required'`) — **VERDE dar NEmerge-uit** încă.
- **NEVERIFICAT:** dacă modelul `claude-fable-5` e valid pe contul Anthropic al
  owner-ului prin `api.anthropic.com/v1/chat/completions`. Dacă nu e, rezerva dă
  404 orice-ai face.

**Reparația, în ordine:**
1. **MERGE PR #1091** (branch `claude/reparatie-cu-rosu-uokj4m`, commit `c7d0c2a0`).
   Fable 5 nu mai cade sterilă. (Owner-ul îl poate da cu un click; e verde.)
2. **Dă-i creierului bani/model valid:** FIE pui credit pe **Gemini** (primarul,
   dovedit, integrat), FIE testezi `claude-fable-5` cu un `curl` pe cheia
   Anthropic și, dacă nu merge, setezi `CONSTRUCTOR_FABLE_MODEL` pe un model
   Claude valid pe cont, în `/root/kelion/kelionai.env`.
3. **Reia un ordin** și confirmă că trece `queued → running → done` (deschide PR),
   nu se mai oprește la 5%.

---

## 1. Arhitectura constructorului (ATENȚIE: sunt DOUĂ sisteme)

**A) Coada `build_jobs` → `constructor-agent.mjs`** — ASTA e ce folosește panoul
„Coada ordinelor" și ce-am modificat eu.
- Cron: `deploy/constructor-worker.sh` la fiecare 2 min → `node
  /root/kelion/constructor-agent.mjs` (cu `timeout 1800`).
- Buclă agentică (ls/grep/read/write/run/finish), clonează repo-ul într-un atelier,
  build+teste, deschide PR (`kelion/job-*` / `builder/auto-*`).
- **Creier PRIN APP** (regula 13 aug): worker-ul NU ține chei de furnizor; face
  POST la `/api/constructor/creier` (gardat cu `x-bridge-secret`). Acolo: Gemini
  (primar) → Fable 5 (rezervă).

**B) `panouLucratori.ts` (`ruleazaPanou`)** — al DOILEA constructor, multi-agent
(aider/cline/gemini-cli) pe `gemini-2.5-pro/flash/flash-lite` → PR-uri `panou/aider-*`
(ex. #1082-1084). Declanșat separat. **NU l-am atins.** Problemă cunoscută: deschide
PR chiar și când agenții n-au produs NIMIC (doar o linie în `.gitignore`, teste roșii)
→ **bani mâncați degeaba**. De reparat: fără produs real → fără PR.

---

## 2. Fișierele cheie

| Fișier | Rol |
|---|---|
| `deploy/constructor-agent.mjs` | worker-ul agentic (rulează pe HOST-ul VPS). `llm()` cere `/api/constructor/creier`. Iese la pornire dacă lipsesc `BRIDGE_SECRET`/`GITHUB_TOKEN`. |
| `deploy/constructor-worker.sh` | cron wrapper (2 min, `timeout 1800`, flock). |
| `backend/src/routes/constructor.ts` | `/api/constructor/creier` (Gemini→Fable5), `/api/admin/constructor` (enqueue→`createBuildJob`), `/api/constructor/live` (panou), `/api/constructor/report`, `/api/constructor/tool`. |
| `backend/src/services/fable5Constructor.ts` | rezerva Fable5. `fable5Key()` citește DOAR `process.env` (`ANTHROPIC_API_KEY`/`CONSTRUCTOR_FABLE_KEY`/`FABLE_KEY`). Model `CONSTRUCTOR_FABLE_MODEL` (default `claude-fable-5`). **Bug reparat în #1091: `tool_choice` auto→required.** |
| `backend/src/services/creier2Constructor.ts` | punți OpenAI↔Gemini (`uneltePentruCreier2`, `raspunsCreier2`). |
| `backend/src/services/geminiDirect.ts` | `geminiDirectChat`, `geminiDirectAvailable` (verifică CHEIA, nu creditul). |
| `backend/src/db.ts` | `createBuildJob`, `claimNextBuildJob` (cel mai vechi `queued`; job `running` tăcut >15 min + `attempts>=3` → `failed`), `listMonitorBuildJobs`. |
| `backend/src/services/panouLucratori.ts` | al DOILEA constructor (multi-agent gemini-2.5). |
| `backend/src/services/selfHeal.ts` + `backend/src/index.ts` | auto-vindecare (`runSelfHeal`, acum la 5 min; plafon $10/zi). |

---

## 3. Deploy & ops (IMPORTANT — nu e trivial)

- **`deploy.yml` (GitHub Action) e MORT** — facturarea org e blocată; joburile mor
  în 3-11 s (`runner_id:0`, loguri 404). NU te baza pe Actions pentru deploy.
- **Deploy REAL:** cron VPS `deploy/auto-publicare.sh` → compară live vs master
  (`/api/version`) → rulează `deploy/deploy.sh` (~8 min). **`deploy.sh` REINSTALEAZĂ
  worker-ul** în `/root/kelion/` (`constructor-agent.mjs`, `constructor-worker.sh`)
  ȘI reconstruiește imaginea Docker. Deci după merge la master, worker-ul se
  actualizează singur.
- **Poarta:** `porti-pr.sh` (cron VPS) rulează porțile REALE pe PR-uri, postează
  „VERDICT: TRECE/CADE" și **auto-merge la PR-urile de CONSTRUCTOR** (`kelion/job-*`)
  pe verde. PR-urile mele (`claude/*`) se dau merge MANUAL.
- **Secrete pe server:** GitHub Secrets + `secret_publica` → workflow
  `vps-set-env.yml` (SSH la `root@164.68.120.87`, scrie `/root/kelion/kelionai.env`
  din `toJSON(secrets)`, repornește containerul). ATENȚIE: `vps-set-env` mai
  forțează și `CONSTRUCTOR_DEEPSEEK_*` (rămășiță 12 aug, acum inutilă — de curățat).
- **Containerul app:** `docker run --env-file /root/kelion/kelionai.env`. Deci env-ul
  vine din fișierul ăla. **Kelion (app-ul) rulează ÎN container → NU vede căi de pe
  HOST** ca `/root/kelion/constructor.log` (de-aia `tail` din chat dă „nu există").

---

## 4. Ce am schimbat sesiunea asta (PR-uri)

| PR | Stare | Ce face |
|---|---|---|
| #1085 | merged | Creier constructor RunPod/DeepInfra → **Gemini(primar)→Fable5(rezervă)** prin `/api/constructor/creier`. Șters `runpodBalance.ts`, RunPod din worker. Adăugat `fable5Constructor.ts`. Afișaj: scos pastila RunPod, adăugat becul Fable5. |
| #1086 | merged | Butonul „Aplicații" era clic-mort (`.apps-wrap` fără `pointer-events:auto`). |
| #1087 | merged | Admin read-access (isAdmin nu mai pică pe voce/oaspete), unealta `client_errors` (F12), prompt admin mereu-pornit. |
| #1088 | merged | Self-heal 30 min → 5 min. |
| #1089 | merged | Constructor Gemini AUTO→**ANY** (`toolChoice:'required'`) — fix sterilă pe **Gemini**. |
| #1090 | merged | Cameră pornire rapidă (sondă 150 ms). **DAR** owner-ul raportează tot 15-20 s → probabil aducerea *fluxului* (getUserMedia + primul decode), NU bucla de captare. De măsurat separat (instrumentează `startCamera` în `frontend/src/lib/camera.ts` + `CameraView.tsx`). |
| **#1091** | **OPEN, verde, NEmerge-uit** | **Fable5 `tool_choice` auto→required** (fix sterilă pe REZERVĂ). **DĂ-I MERGE.** |

---

## 5. Diagnostic LIVE (măsurat azi, nu presupus)

- `curl https://kelionai.app/api/version` → `68535fd` = vârf master → **deploy-ul
  merge, codul e live.**
- Bec „Fable 5" **VERDE** → `ANTHROPIC_API_KEY` **e pe server**.
- `vps-set-env` a rulat cu succes azi → secretele s-au publicat.
- `db_query` (prin Kelion, admin) pe `build_jobs`: worker-ul **e viu** — ordinul
  **#230 a trecut pe `running`**, dar s-a blocat la ~5% („tură sterilă", ca #221).
  #227-229 fuseseră curățate; tabelul a fost o clipă gol.
- **Concluzie:** worker viu; creier steril → Gemini £0 + Fable5 pe `auto` (pre-#1091).

---

## 6. Cum diagnostichezi live (fără SSH)

- **Public:** `curl https://kelionai.app/api/version`, `/api/health`.
- **Prin Kelion** (sesiune admin, în chat): unealta `db_query`. Ex:
  `dbquery: SELECT id,status,attempts,updated_at,left(coalesce(log,''),300) FROM build_jobs ORDER BY id DESC LIMIT 8`
  Plus `server_logs`, `client_errors`, `system_health`, `read_source`.
- **Logul host** (`/root/kelion/constructor.log`) NU e accesibil din container/Kelion
  — trebuie SSH la `root@164.68.120.87`.
- **GitHub:** urmărește PR-uri noi de constructor (`kelion/job-*`, `builder/auto-*`,
  `panou/*`) ca dovadă că a construit.

---

## 7. VPS / GĂZDUIRE — detalii complete

- **Furnizor:** Contabo (panoul „Customer Control Panel"). **Host:** `164.68.120.87`,
  user **`root`**. Acces prin **SSH** (cheie ed25519 `VPS_SSH_KEY`) sau consola web
  Contabo.
- **Aplicația pe VPS:** totul stă în **`/root/kelion/`**:
  - `repo/` — clona git a `kelion-team/kelionai` (o actualizează `auto-publicare.sh`).
  - `kelionai.env` — **fișierul de env pe care-l încarcă containerul** (aici stau
    TOATE cheile live). `chmod 600`.
  - `constructor-agent.mjs`, `constructor-worker.sh` — worker-ul (instalate de
    `deploy.sh`).
  - `constructor.log`, `auto-publicare.log` — logurile (pe HOST, nu în container).
- **Container:** `docker run -d --name kelionai-app --restart unless-stopped
  --network host --env-file /root/kelion/kelionai.env -e PORT=8080 -e
  NODE_ENV=production -e GIT_COMMIT_SHA=<sha> kelionai:latest`. Deci **env-ul vine din
  `kelionai.env`**; app-ul ascultă pe `:8080`; `/api/version` întoarce `GIT_COMMIT_SHA`
  (verificarea anti-„phantom deploy").
- **Cronuri (setate de `deploy.sh`):**
  - `*/2 * * * *` `constructor-worker.sh` — ia un ordin din coadă și rulează worker-ul.
  - `auto-publicare.sh` — deploy real (live vs master → `deploy.sh`, ~8 min).
  - `porti-pr.sh` — porțile reale pe PR + auto-merge PR-uri constructor.
  - `plasa-sanatate.mjs` — canary după deploy + auto-revert la ultimul deploy sănătos.
- **GitHub Actions = MOARTE** (facturare blocată) → deploy-ul NU vine de la Actions,
  ci de la cronurile de mai sus. Singurul workflow „viu" folosit e `vps-set-env.yml`
  (dus prin `secret_publica`), care SSH-uiește pe VPS și scrie `kelionai.env`.

## 7b. ENV VARS de care depinde codul (după NUME — valorile le pui TU în Devin/VPS)

| Nume | Folosit de | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | Fable5 (rezerva constructorului) | becul „Fable 5" verde = prezent |
| `GEMINI_API_KEY` (+ `GEMINI_MODEL`) | creierul principal (chat + constructor) | are cheie, dar **credit £0** |
| `BRIDGE_SECRET` | worker↔app (`/api/constructor/*`) | fără el, worker-ul iese la pornire |
| `GITHUB_TOKEN` | worker (deschide PR), `secret_pune` | fin-granulat, repo kelionai, Contents/PR + Secrets write |
| `CONSTRUCTOR_FABLE_MODEL` / `CONSTRUCTOR_FABLE_URL` | Fable5 | default `claude-fable-5` / endpoint Anthropic OpenAI-compat |
| `SERPER_API_KEY` | căutare web/youtube | |
| `GOOGLE_TTS_API_KEY` / `GOOGLE_API_KEY` / client secret Google | voce, Google skills | |
| `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`) | card virtual în panou | nu e secret |
| `SESSION_SECRET`, `ADMIN_EMAIL` | identitatea serverului | **se schimbă DOAR manual pe VPS** (rotirea tăcută dă 403 owner-ului) |

## 7c. Secrete — cum le dai lui Devin (și de ce NU-s în fișierul ăsta)

**Nu scriu în acest fișier parole/chei live** (parola de root, cheia SSH privată,
cheile API, cardul). Un fișier plin de secrete e exact greșeala pe care n-o las în
urmă — și oricum **toate trebuie ROTITE**, fiindcă azi au trecut prin chat. Cum
procedezi corect:
1. **Rotește** parola de root, cheia SSH, `GITHUB_TOKEN`, cheile Anthropic/OpenAI/
   Gemini, `BRIDGE_SECRET` (au fost expuse).
2. Pune valorile **direct în store-ul de secrete al lui Devin** (sau în
   `/root/kelion/kelionai.env` pe VPS), din **lista de nume de la §7b** — o singură dată.
3. Cardul / PIN-ul Revolut / parola iOS **nu-s necesare** pentru dezvoltare; tratează-le
   ca expuse.

---

## 8. Reguli de lucru (din AI-HANDOFF.md — respectă-le)

1. O valoare care nu vine dintr-o măsurătoare reușită e „nu pot verifica" — niciodată
   un număr sau un verdict.
2. Când owner-ul te contrazice, PRIMUL loc unde te uiți e CODUL TĂU care a produs
   raportul.
3. Niciodată o operație în masă pe ceva ce n-ai privit (`git add -A` pe merge cu
   conflicte a comis markeri `N HANDOFF — Kelionai (constructor + session state, 14 aug 2026)

> Scop: tot ce-ți trebuie ca să preiei de aici. Owner: **Adrian**
> (adrianenc11@gmail.com), admin unic. **Răspunde-i în română.** Testează **LIVE**
> pe kelionai.app. Citește întâi `AI-HANDOFF.md` (§13 „Starea") și
> `RAMAS-DE-FACUT.md` — sunt sursa de adevăr întreținută; ține-le la zi.

---

## 0. TL;DR — ce e rupt ACUM și cum se repară

**Simptom:** constructorul (worker-ul agentic de pe VPS) **trăiește** (ia ordine,
le pornește), dar fiecare ordin **se blochează la ~5% „tură sterilă"** — creierul
răspunde cu TEXT în loc să cheme o unealtă, deci ordinul nu avansează și pică/recade.

**Cauza (măsurată, nu presupusă):** creierul constructorului n-are credit/config
funcțional:
- **PRIMAR — Gemini** (`geminiModelGreu`, tier Pro) e pe **£0.00** → API-ul dă
  eroare → nu poate răspunde.
- **REZERVĂ — Fable 5** (Anthropic `claude-fable-5`, endpoint OpenAI-compat) —
  cheia ESTE pusă (becul „Fable 5" e verde), DAR codul **LIVE** o cheamă cu
  `tool_choice:'auto'` → și rezerva intră sterilă. Reparat în **PR #1091**
  (`tool_choice:'required'`) — **VERDE dar NEmerge-uit** încă.
- **NEVERIFICAT:** dacă modelul `claude-fable-5` e valid pe contul Anthropic al
  owner-ului prin `api.anthropic.com/v1/chat/completions`. Dacă nu e, rezerva dă
  404 orice-ai face.

**Reparația, în ordine:**
1. **MERGE PR #1091** (branch `claude/reparatie-cu-rosu-uokj4m`, commit `c7d0c2a0`).
   Fable 5 nu mai cade sterilă. (Owner-ul îl poate da cu un click; e verde.)
2. **Dă-i creierului bani/model valid:** FIE pui credit pe **Gemini** (primarul,
   dovedit, integrat), FIE testezi `claude-fable-5` cu un `curl` pe cheia
   Anthropic și, dacă nu merge, setezi `CONSTRUCTOR_FABLE_MODEL` pe un model
   Claude valid pe cont, în `/root/kelion/kelionai.env`.
3. **Reia un ordin** și confirmă că trece `queued → running → done` (deschide PR),
   nu se mai oprește la 5%.

---

## 1. Arhitectura constructorului (ATENȚIE: sunt DOUĂ sisteme)

**A) Coada `build_jobs` → `constructor-agent.mjs`** — ASTA e ce folosește panoul
„Coada ordinelor" și ce-am modificat eu.
- Cron: `deploy/constructor-worker.sh` la fiecare 2 min → `node
  /root/kelion/constructor-agent.mjs` (cu `timeout 1800`).
- Buclă agentică (ls/grep/read/write/run/finish), clonează repo-ul într-un atelier,
  build+teste, deschide PR (`kelion/job-*` / `builder/auto-*`).
- **Creier PRIN APP** (regula 13 aug): worker-ul NU ține chei de furnizor; face
  POST la `/api/constructor/creier` (gardat cu `x-bridge-secret`). Acolo: Gemini
  (primar) → Fable 5 (rezervă).

**B) `panouLucratori.ts` (`ruleazaPanou`)** — al DOILEA constructor, multi-agent
(aider/cline/gemini-cli) pe `gemini-2.5-pro/flash/flash-lite` → PR-uri `panou/aider-*`
(ex. #1082-1084). Declanșat separat. **NU l-am atins.** Problemă cunoscută: deschide
PR chiar și când agenții n-au produs NIMIC (doar o linie în `.gitignore`, teste roșii)
→ **bani mâncați degeaba**. De reparat: fără produs real → fără PR.

---

## 2. Fișierele cheie

| Fișier | Rol |
|---|---|
| `deploy/constructor-agent.mjs` | worker-ul agentic (rulează pe HOST-ul VPS). `llm()` cere `/api/constructor/creier`. Iese la pornire dacă lipsesc `BRIDGE_SECRET`/`GITHUB_TOKEN`. |
| `deploy/constructor-worker.sh` | cron wrapper (2 min, `timeout 1800`, flock). |
| `backend/src/routes/constructor.ts` | `/api/constructor/creier` (Gemini→Fable5), `/api/admin/constructor` (enqueue→`createBuildJob`), `/api/constructor/live` (panou), `/api/constructor/report`, `/api/constructor/tool`. |
| `backend/src/services/fable5Constructor.ts` | rezerva Fable5. `fable5Key()` citește DOAR `process.env` (`ANTHROPIC_API_KEY`/`CONSTRUCTOR_FABLE_KEY`/`FABLE_KEY`). Model `CONSTRUCTOR_FABLE_MODEL` (default `claude-fable-5`). **Bug reparat în #1091: `tool_choice` auto→required.** |
| `backend/src/services/creier2Constructor.ts` | punți OpenAI↔Gemini (`uneltePentruCreier2`, `raspunsCreier2`). |
| `backend/src/services/geminiDirect.ts` | `geminiDirectChat`, `geminiDirectAvailable` (verifică CHEIA, nu creditul). |
| `backend/src/db.ts` | `createBuildJob`, `claimNextBuildJob` (cel mai vechi `queued`; job `running` tăcut >15 min + `attempts>=3` → `failed`), `listMonitorBuildJobs`. |
| `backend/src/services/panouLucratori.ts` | al DOILEA constructor (multi-agent gemini-2.5). |
| `backend/src/services/selfHeal.ts` + `backend/src/index.ts` | auto-vindecare (`runSelfHeal`, acum la 5 min; plafon $10/zi). |

---

## 3. Deploy & ops (IMPORTANT — nu e trivial)

- **`deploy.yml` (GitHub Action) e MORT** — facturarea org e blocată; joburile mor
  în 3-11 s (`runner_id:0`, loguri 404). NU te baza pe Actions pentru deploy.
- **Deploy REAL:** cron VPS `deploy/auto-publicare.sh` → compară live vs master
  (`/api/version`) → rulează `deploy/deploy.sh` (~8 min). **`deploy.sh` REINSTALEAZĂ
  worker-ul** în `/root/kelion/` (`constructor-agent.mjs`, `constructor-worker.sh`)
  ȘI reconstruiește imaginea Docker. Deci după merge la master, worker-ul se
  actualizează singur.
- **Poarta:** `porti-pr.sh` (cron VPS) rulează porțile REALE pe PR-uri, postează
  „VERDICT: TRECE/CADE" și **auto-merge la PR-urile de CONSTRUCTOR** (`kelion/job-*`)
  pe verde. PR-urile mele (`claude/*`) se dau merge MANUAL.
- **Secrete pe server:** GitHub Secrets + `secret_publica` → workflow
  `vps-set-env.yml` (SSH la `root@164.68.120.87`, scrie `/root/kelion/kelionai.env`
  din `toJSON(secrets)`, repornește containerul). ATENȚIE: `vps-set-env` mai
  forțează și `CONSTRUCTOR_DEEPSEEK_*` (rămășiță 12 aug, acum inutilă — de curățat).
- **Containerul app:** `docker run --env-file /root/kelion/kelionai.env`. Deci env-ul
  vine din fișierul ăla. **Kelion (app-ul) rulează ÎN container → NU vede căi de pe
  HOST** ca `/root/kelion/constructor.log` (de-aia `tail` din chat dă „nu există").

---

## 4. Ce am schimbat sesiunea asta (PR-uri)

| PR | Stare | Ce face |
|---|---|---|
| #1085 | merged | Creier constructor RunPod/DeepInfra → **Gemini(primar)→Fable5(rezervă)** prin `/api/constructor/creier`. Șters `runpodBalance.ts`, RunPod din worker. Adăugat `fable5Constructor.ts`. Afișaj: scos pastila RunPod, adăugat becul Fable5. |
| #1086 | merged | Butonul „Aplicații" era clic-mort (`.apps-wrap` fără `pointer-events:auto`). |
| #1087 | merged | Admin read-access (isAdmin nu mai pică pe voce/oaspete), unealta `client_errors` (F12), prompt admin mereu-pornit. |
| #1088 | merged | Self-heal 30 min → 5 min. |
| #1089 | merged | Constructor Gemini AUTO→**ANY** (`toolChoice:'required'`) — fix sterilă pe **Gemini**. |
| #1090 | merged | Cameră pornire rapidă (sondă 150 ms). **DAR** owner-ul raportează tot 15-20 s → probabil aducerea *fluxului* (getUserMedia + primul decode), NU bucla de captare. De măsurat separat (instrumentează `startCamera` în `frontend/src/lib/camera.ts` + `CameraView.tsx`). |
| **#1091** | **OPEN, verde, NEmerge-uit** | **Fable5 `tool_choice` auto→required** (fix sterilă pe REZERVĂ). **DĂ-I MERGE.** |

---

## 5. Diagnostic LIVE (măsurat azi, nu presupus)

- `curl https://kelionai.app/api/version` → `68535fd` = vârf master → **deploy-ul
  merge, codul e live.**
- Bec „Fable 5" **VERDE** → `ANTHROPIC_API_KEY` **e pe server**.
- `vps-set-env` a rulat cu succes azi → secretele s-au publicat.
- `db_query` (prin Kelion, admin) pe `build_jobs`: worker-ul **e viu** — ordinul
  **#230 a trecut pe `running`**, dar s-a blocat la ~5% („tură sterilă", ca #221).
  #227-229 fuseseră curățate; tabelul a fost o clipă gol.
- **Concluzie:** worker viu; creier steril → Gemini £0 + Fable5 pe `auto` (pre-#1091).

---

## 6. Cum diagnostichezi live (fără SSH)

- **Public:** `curl https://kelionai.app/api/version`, `/api/health`.
- **Prin Kelion** (sesiune admin, în chat): unealta `db_query`. Ex:
  `dbquery: SELECT id,status,attempts,updated_at,left(coalesce(log,''),300) FROM build_jobs ORDER BY id DESC LIMIT 8`
  Plus `server_logs`, `client_errors`, `system_health`, `read_source`.
- **Logul host** (`/root/kelion/constructor.log`) NU e accesibil din container/Kelion
  — trebuie SSH la `root@164.68.120.87`.
- **GitHub:** urmărește PR-uri noi de constructor (`kelion/job-*`, `builder/auto-*`,
  `panou/*`) ca dovadă că a construit.

---

## 7. VPS / GĂZDUIRE — detalii complete

- **Furnizor:** Contabo (panoul „Customer Control Panel"). **Host:** `164.68.120.87`,
  user **`root`**. Acces prin **SSH** (cheie ed25519 `VPS_SSH_KEY`) sau consola web
  Contabo.
- **Aplicația pe VPS:** totul stă în **`/root/kelion/`**:
  - `repo/` — clona git a `kelion-team/kelionai` (o actualizează `auto-publicare.sh`).
  - `kelionai.env` — **fișierul de env pe care-l încarcă containerul** (aici stau
    TOATE cheile live). `chmod 600`.
  - `constructor-agent.mjs`, `constructor-worker.sh` — worker-ul (instalate de
    `deploy.sh`).
  - `constructor.log`, `auto-publicare.log` — logurile (pe HOST, nu în container).
- **Container:** `docker run -d --name kelionai-app --restart unless-stopped
  --network host --env-file /root/kelion/kelionai.env -e PORT=8080 -e
  NODE_ENV=production -e GIT_COMMIT_SHA=<sha> kelionai:latest`. Deci **env-ul vine din
  `kelionai.env`**; app-ul ascultă pe `:8080`; `/api/version` întoarce `GIT_COMMIT_SHA`
  (verificarea anti-„phantom deploy").
- **Cronuri (setate de `deploy.sh`):**
  - `*/2 * * * *` `constructor-worker.sh` — ia un ordin din coadă și rulează worker-ul.
  - `auto-publicare.sh` — deploy real (live vs master → `deploy.sh`, ~8 min).
  - `porti-pr.sh` — porțile reale pe PR + auto-merge PR-uri constructor.
  - `plasa-sanatate.mjs` — canary după deploy + auto-revert la ultimul deploy sănătos.
- **GitHub Actions = MOARTE** (facturare blocată) → deploy-ul NU vine de la Actions,
  ci de la cronurile de mai sus. Singurul workflow „viu" folosit e `vps-set-env.yml`
  (dus prin `secret_publica`), care SSH-uiește pe VPS și scrie `kelionai.env`.

## 7b. ENV VARS de care depinde codul (după NUME — valorile le pui TU în Devin/VPS)

| Nume | Folosit de | Note |
|---|---|---|
| `ANTHROPIC_API_KEY` | Fable5 (rezerva constructorului) | becul „Fable 5" verde = prezent |
| `GEMINI_API_KEY` (+ `GEMINI_MODEL`) | creierul principal (chat + constructor) | are cheie, dar **credit £0** |
| `BRIDGE_SECRET` | worker↔app (`/api/constructor/*`) | fără el, worker-ul iese la pornire |
| `GITHUB_TOKEN` | worker (deschide PR), `secret_pune` | fin-granulat, repo kelionai, Contents/PR + Secrets write |
| `CONSTRUCTOR_FABLE_MODEL` / `CONSTRUCTOR_FABLE_URL` | Fable5 | default `claude-fable-5` / endpoint Anthropic OpenAI-compat |
| `SERPER_API_KEY` | căutare web/youtube | |
| `GOOGLE_TTS_API_KEY` / `GOOGLE_API_KEY` / client secret Google | voce, Google skills | |
| `STRIPE_PUBLISHABLE_KEY` (`pk_live_…`) | card virtual în panou | nu e secret |
| `SESSION_SECRET`, `ADMIN_EMAIL` | identitatea serverului | **se schimbă DOAR manual pe VPS** (rotirea tăcută dă 403 owner-ului) |

## 7c. Secrete — cum le dai lui Devin (și de ce NU-s în fișierul ăsta)

**Nu scriu în acest fișier parole/chei live** (parola de root, cheia SSH privată,
cheile API, cardul). Un fișier plin de secrete e exact greșeala pe care n-o las în
urmă — și oricum **toate trebuie ROTITE**, fiindcă azi au trecut prin chat. Cum
procedezi corect:
1. **Rotește** parola de root, cheia SSH, `GITHUB_TOKEN`, cheile Anthropic/OpenAI/
   Gemini, `BRIDGE_SECRET` (au fost expuse).
2. Pune valorile **direct în store-ul de secrete al lui Devin** (sau în
   `/root/kelion/kelionai.env` pe VPS), din **lista de nume de la §7b** — o singură dată.
3. Cardul / PIN-ul Revolut / parola iOS **nu-s necesare** pentru dezvoltare; tratează-le
   ca expuse.

---

## 8. Reguli de lucru (din AI-HANDOFF.md — respectă-le)

1. O valoare care nu vine dintr-o măsurătoare reușită e „nu pot verifica" — niciodată
   un număr sau un verdict.
2. Când owner-ul te contrazice, PRIMUL loc unde te uiți e CODUL TĂU care a produs
   raportul.
3. Niciodată o operație în masă pe ceva ce n-ai privit (`git add -A` pe merge cu
   conflicte a comis markeri `<<<<<<<`).
4. Înainte să-i ceri owner-ului ceva manual, dovedește din cod/live că e chiar necesar.
- Build → deploy → **VERIFICĂ LIVE cu dovadă reală**. Niciodată „gata" fără probă.
- **master = producție, mereu în sincron.**

---

## 9. De făcut (cererile owner-ului)

- [ ] **Constructorul să meargă pe Gemini-ultra → Fable5** (blocat pe banii/modelul
      creierului — vezi §0). Ăsta e #1 acum.
- [ ] **3 ordine** de dat constructorului (unul câte unul, în panoul Constructor, NU
      în chat): (1) unealtă `server_ops` (diagnostic/reparație VPS alb-listată pentru
      Kelion); (2) extinde self-heal să scaneze TOATE logurile; (3) adâncește plasa de
      sănătate (probe reale + auto-revert).
- [ ] Camera: delay 15-20 s la pornire — măsoară aducerea fluxului, nu bucla de captare.
- [ ] `panouLucratori` deschide PR-uri goale când agenții n-au produs nimic → gardă:
      fără produs, fără PR.
- [ ] Redu testele neesențiale (owner: >1400) — cu grijă, păstrează lacătele de
      bani/securitate/regresie.
- [ ] Împerechere biometrică voce+față (feature mai mare, neînceput).

---

## 10. PRIMII PAȘI pentru tine (Devin)

1. Citește `AI-HANDOFF.md` + `RAMAS-DE-FACUT.md`.
2. `curl https://kelionai.app/api/version` (confirmă ce e live).
3. **Merge PR #1091** (sau cere-i owner-ului un click — e verde).
4. Testează Fable5: `curl -s https://api.anthropic.com/v1/chat/completions -H
   "authorization: Bearer $ANTHROPIC_API_KEY" -H "content-type: application/json" -d
   '{"model":"claude-fable-5","max_tokens":20,"messages":[{"role":"user","content":"hi"}]}'`
   — dacă dă 404 model, setează `CONSTRUCTOR_FABLE_MODEL` pe un model valid în
   `/root/kelion/kelionai.env` și repornește.
5. Sau pune credit pe Gemini (primarul).
6. Pune UN ordin de test în panoul Constructor, urmărește `db_query` pe `build_jobs`
   să treacă `queued→running→done`. Confirmă LIVE.
