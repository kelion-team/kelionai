# ACCES APLICAȚIE — FULL

Tot ce-i trebuie unui AI (sau unui om) ca să preia proiectul și să-l gestioneze
100%, fără să întrebe pe nimeni. Scris la cererea lui Adrian, 30 iul 2026.

**Despre parole:** valorile NU sunt aici și nu pot fi. Fișierul trăiește în git,
pe GitHub — o parolă scrisă în el e o parolă pierdută. În plus, cine scrie
documentul **nu le are**: secretele GitHub nu pot fi citite înapoi (așa sunt
construite), iar env-ul de pe VPS nu e accesibil din afara serverului. Documentul
spune **ce chei există, la ce folosesc și cum se pun**. Valorile le dă Adrian.

---

# PARTEA I — CE E APLICAȚIA

## 1.1 Pe scurt

Asistent AI live la **kelionai.app**: avatar 3D, voce full-duplex, vedere prin
cameră, skill-uri Google (Gmail/Calendar/Drive), căutare web, browser real,
memorie pe termen lung, panou de administrare, sistem de credite.

- **backend/** — Node 22 + Fastify + TypeScript
- **frontend/** — React + Vite + TypeScript
- rulează în container Docker pe VPS propriu; publicare din GitHub Actions
- proprietar/admin unic: **adrianenc11@gmail.com**

## 1.2 Harta codului

**Rute** (`backend/src/routes/`) — 24:
`admin` `asr` `asr-stream` `auth` `authLocal` `billing` `browser` `chat`
`clientErrors` `constructor` `contact` `demo` `image` `ingest` `legal` `manual`
`mapview` `me` `models` `ops` `ping` `prefs` `realtime` `tts` `voiceprint`

**Servicii** (`backend/src/services/`) — cele care contează:

| Serviciu | Ce face |
|---|---|
| `orchestrator` | bucla creierului: mesaj → unelte → răspuns |
| `openrouter` | accesul la modele (catalog, alegere, cost) |
| `geminiDirect` | creier gratuit de rezervă |
| `brainCapabilities` | **registrul unic** al celor 69 de capabilități |
| `brainToolDefs` | schemele uneltelor date creierului |
| `adminTools` | uneltele de admin, comune chat ∩ voce |
| `realtime` | vocea live (WebRTC cu OpenAI Realtime) |
| `asr` / `tts` | transcriere / sinteză vocală |
| `browser` | browser real pe server (9 unelte, capturi pe monitor) |
| `google` | Gmail, Calendar, Drive, traduceri |
| `stripe` | **istoric** — plățile au trecut pe Revolut (30 iul) |
| `openBanking` | citirea plăților din Revolut (creditare automată) |
| `runbooks` / `github` | mâinile lui Kelion: publică singur, rulează proceduri |
| `recovery` | puncte de recuperare (tag-uri git + arhive pe VPS) |
| `selfHeal` | reparare automată |
| `envCheck` | ce chei vede procesul ACUM (nume + lungime, **niciodată valori**) |

**Frontend**:
- pagini: `Stage` (aplicația), `Landing`, `Login`, `Credits`, `Manual`
- componente: `AdminPanel`, `ChatPanel`, `AvatarModel`, `CameraView`,
  `WalletButton`, `CustomerSettings`, `VisitorChatWidget`, `BackLink`, ...

**Baza de date** (Postgres) — 34 de tabele, cele principale:
`messages` `user_prefs` `wallets` `transactions` `billing_events` `payment_codes`
`memories` `voiceprints` `faceprints` `cost_events` `visits` `demo_uses`
`local_accounts` `google_accounts` `kelion_tools` `build_jobs` `work_orders`
`notes` `leads` `inbound_emails` `client_errors` `kv_state`

## 1.3 Cum gândește (regula de rutare a creierului)

- **Owner-ul** primește ÎNTOTDEAUNA modelul plătit capabil din catalogul live.
  Dacă alegerea lui manuală nu mai e validă, cade pe alt model plătit — **nu** pe
  gratuit — și scrie `[CREIER]` în jurnal cu motivul.
- **Userii** merg pe scara gratuită, cu escaladare pe dificultate.
- Fără sold la OpenRouter → totul cade pe modele `:free`, care **narează în loc să
  execute**. Ăsta e primul lucru de verificat când „nu face ce i se cere".

---

# PARTEA II — ACCESUL

## 2.1 Serverul

| | |
|---|---|
| IP | `164.68.120.87` |
| User | `root` |
| Auth | cheie SSH (fără parolă) |
| Cheia | secretul GitHub **`VPS_SSH_KEY`** |
| Aplicația | `/root/kelion/` |
| Codul | `/root/kelion/repo` |
| Cheile | `/root/kelion/kelionai.env` (chmod 600) |
| Puntea | `/root/kelion/bridge-secret.txt` |

```bash
ssh -i <cheia-privata> -o StrictHostKeyChecking=no root@164.68.120.87
```

## 2.2 Fără cheie locală — prin Actions

Nu-ți trebuie cheia pe calculatorul tău. **Actions → workflow → Run workflow**:

| Workflow | La ce e |
|---|---|
| `vps-run` | orice comandă bash, ca root |
| `vps-enter` | intră în container |
| `vps-diag` | diagnostic: container, disc, memorie, loguri |
| `vps-probe` | răspunde aplicația? |
| `vps-keys` | ce chei există (numele, nu valorile) |
| `vps-set-env` | duce cheile din GitHub Secrets pe VPS |
| `vps-set-key` | scrie o singură cheie |
| `vps-key-setup` | pune o cheie SSH nouă |

## 2.3 GitHub

Repo: `github.com/kelion-team/kelionai` · producție = ramura `master`.

- Secrete: Settings → Secrets and variables → Actions
- Publicare: Actions → `deploy`
- Verificare PR: Actions → `pr-verify` (informativă, nu blochează)

---

# PARTEA III — PUBLICAREA

```
ramură → PR → merge în master → workflow „deploy" → VPS → verificare anti-fantomă
```

Pașii reali din `deploy.yml`:
1. SSH la `root@164.68.120.87`;
2. `cd /root/kelion/repo && git fetch origin master`;
3. **rulează `deploy/deploy.sh` DIN `origin/master`, dintr-o copie în `/tmp`** —
   nu din clonă. Motivul e o pană reală („deploy fantomă"): scriptul din clonă
   putea publica o versiune mai veche, iar verificarea de după valida greșit;
4. **anti-fantomă**: `/api/version` live trebuie să fie EXACT sha-ul din
   `origin/master`, iar `/health` == 200. Altfel publicarea pică.

**Regula de aur:** producția = `master`, mereu. Nimic nu publică vreodată cod mai
vechi decât `origin/master`.

**Proba, din orice terminal:**
```bash
curl -s https://kelionai.app/api/version
curl -s -o /dev/null -w "%{http_code}\n" https://kelionai.app/health
git rev-parse --short origin/master     # trebuie să fie acelasi sha
```

---

# PARTEA IV — CHEILE

Trăiesc în `/root/kelion/kelionai.env`; sursa e GitHub Secrets.
**Drumul unei chei:** GitHub Secrets → `vps-set-env` → env + repornire container.

## 4.1 Obligatorii

| Cheie | Fără ea |
|---|---|
| `DATABASE_URL` | nu pornește — conturi, credite, istoric |
| `SESSION_SECRET` | nimeni nu rămâne logat |
| `OPENROUTER_API_KEY` | **creierul** — nu răspunde nimic |
| `OPENAI_API_KEY` | vocea live, TTS, transcrierea |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | login cu Google |

## 4.2 Utile

`GEMINI_API_KEY` (creier rezervă + vedere) · `SERPER_API_KEY` (web) ·
`GOOGLE_MAPS_KEY` · `GOOGLE_TTS_API_KEY` + `GOOGLE_SERVICE_ACCOUNT_JSON`
(voce Chirp 3 HD) · `MAIL_USER` / `MAIL_PASS` (contact@) · `GITHUB_TOKEN`
(Kelion publică singur) · `BRIDGE_SECRET` (**aceeași valoare** și în
`/root/kelion/bridge-secret.txt`)

## 4.3 Plăți

`REVOLUT_PAY_LINK` · `GOCARDLESS_SECRET_ID` · `GOCARDLESS_SECRET_KEY` ·
`GOCARDLESS_ACCOUNT_ID` — detalii complete în **`PROCEDURA-PLATI.md`**.

## 4.4 Cum vezi ce chei are procesul ACUM

**Admin → Tokenuri** → „Ce chei vede serverul CHIAR ACUM": pentru fiecare cheie
spune dacă e prezentă, **câte caractere are** (0 = prezentă dar goală) și **sub ce
nume** a fost găsită. Nu afișează niciodată valori. Arată și ora pornirii
procesului — o cheie scrisă DUPĂ acea oră nu e încărcată până la repornire.

> **CAPCANĂ DOVEDITĂ:** `vps-set-env` are o **listă fixă de nume** în bucla care
> scrie. O cheie care nu e în listă se pune degeaba — workflow-ul raportează
> „succes" și cheia nu ajunge nicăieri. Când adaugi o cheie nouă, pune-o în
> **trei** locuri din `vps-set-env.yml`: blocul `env:`, lista buclei, și
> instrucțiunile din capul fișierului.

---

# PARTEA V — PORȚILE DE CALITATE

Rulează-le **exact așa** înainte de orice publicare:

```bash
cd backend  && npm ci && npm run typecheck && npm test
cd frontend && npm ci && npm run build          # tsc -b && vite build
node scripts/verifica-sintaxa.mjs               # marcaje de conflict, CSS, JSON
node scripts/verifica-exporturi.mjs             # exporturi fără utilizator
npx jscpd backend/src frontend/src --threshold 0.0001
```

Referință la 30 iul: **261 teste / 33 fișiere, 0 picate · 0 clone · 0 exporturi
orfane · sintaxă curată**.

> **CAPCANĂ DOVEDITĂ:** `npx tsc --noEmit -p tsconfig.json` **NU** e același lucru
> cu `npm run build` la frontend (`tsc -b && vite build`). `vite build` singur nu
> face typecheck. Verificarea greșită a lăsat o eroare de tip să treacă și a
> blocat publicarea 25 de minute.

---

# PARTEA VI — CÂND NU MERGE

| Simptom | Unde te uiți ÎNTÂI |
|---|---|
| situl nu răspunde | `vps-diag` (container pornit? disc plin?), apoi `vps-probe` |
| 502 imediat după publicare | containerul repornește — ~1 minut |
| chatul nu răspunde NIMIC | soldul OpenRouter (Admin → Bani); apoi jurnal: `[CHAT MUT]` |
| „nu execută ce-i cer" | jurnal `[CREIER]` — spune dacă a căzut pe model gratuit și de ce |
| o cheie „lipsește" deși e pusă | Admin → Tokenuri (§4.4) + lista din `vps-set-env` |
| publicarea nu ajunge live | Actions → `deploy`; anti-fantoma spune ce nu s-a potrivit |
| plata nu creditează | Admin → Bani → „Citirea plăților Revolut" |

Jurnalul: `docker logs --tail 200 <container>` (prin `vps-run`), sau
**Admin → Jurnale** din aplicație.

**Recuperare:** Admin → Recuperare — puncte de restaurare (tag-uri git + arhive pe
VPS). Restaurarea aduce `master` la starea aleasă printr-un commit nou, deci
publicarea pornește singură.

---

# PARTEA VII — STAREA REALĂ (30 iul 2026)

## Merge, verificat
Chat scris · voce live full-duplex · vedere prin cameră · skill-uri Google (cu
acordul fiecărui user) · căutare web · browser real pe server (9 unelte, cu
capturi pe monitor) · memorie · manual în 7 limbi · panou admin · publicare
automată cu verificare anti-fantomă.

## Nu merge / nefinalizat
- **Creditarea automată a plăților** — codul e scris (coduri unice, istoric,
  potrivire, creditare idempotentă), lipsește ultima verigă: cine anunță
  aplicația că a intrat un ban. Vezi `PROCEDURA-PLATI.md` §9 pentru cele trei căi.
- **Arderea creditului n-are plafon** — rândul B8 din `RAMAS-DE-FACUT.md`:
  owner-ul primește modelul plătit la FIECARE mesaj, cu până la 4 cadre de cameră
  pe tură, și **nu există niciun plafon pentru admin** (`chat.ts`: „adminul e
  scutit"). Ăsta e cel mai scump lucru nerezolvat.
- Restul, cu dovezi: **`RAMAS-DE-FACUT.md`**.

---

# PARTEA VIII — REGULILE DE LUCRU

Sunt în **`CLAUDE.md`** și se încarcă la fiecare sesiune. Scrise după eșecuri
reale, nu din teorie:

1. **O valoare care nu vine dintr-o măsurătoare reușită se scrie „nu pot
   verifica"** — niciodată o cifră sau un verdict. Într-o singură zi, panoul a
   afirmat de cinci ori stări pe care nu le măsurase.
2. **Când Adrian contrazice un raport, primul loc de căutat e codul care a produs
   raportul**, nu sistemul lui. A avut dreptate de fiecare dată.
3. **Nicio operație în masă pe ceva ce n-ai privit.** (`git add -A` pe un merge cu
   conflicte a comis `S APLICAȚIE — FULL

Tot ce-i trebuie unui AI (sau unui om) ca să preia proiectul și să-l gestioneze
100%, fără să întrebe pe nimeni. Scris la cererea lui Adrian, 30 iul 2026.

**Despre parole:** valorile NU sunt aici și nu pot fi. Fișierul trăiește în git,
pe GitHub — o parolă scrisă în el e o parolă pierdută. În plus, cine scrie
documentul **nu le are**: secretele GitHub nu pot fi citite înapoi (așa sunt
construite), iar env-ul de pe VPS nu e accesibil din afara serverului. Documentul
spune **ce chei există, la ce folosesc și cum se pun**. Valorile le dă Adrian.

---

# PARTEA I — CE E APLICAȚIA

## 1.1 Pe scurt

Asistent AI live la **kelionai.app**: avatar 3D, voce full-duplex, vedere prin
cameră, skill-uri Google (Gmail/Calendar/Drive), căutare web, browser real,
memorie pe termen lung, panou de administrare, sistem de credite.

- **backend/** — Node 22 + Fastify + TypeScript
- **frontend/** — React + Vite + TypeScript
- rulează în container Docker pe VPS propriu; publicare din GitHub Actions
- proprietar/admin unic: **adrianenc11@gmail.com**

## 1.2 Harta codului

**Rute** (`backend/src/routes/`) — 24:
`admin` `asr` `asr-stream` `auth` `authLocal` `billing` `browser` `chat`
`clientErrors` `constructor` `contact` `demo` `image` `ingest` `legal` `manual`
`mapview` `me` `models` `ops` `ping` `prefs` `realtime` `tts` `voiceprint`

**Servicii** (`backend/src/services/`) — cele care contează:

| Serviciu | Ce face |
|---|---|
| `orchestrator` | bucla creierului: mesaj → unelte → răspuns |
| `openrouter` | accesul la modele (catalog, alegere, cost) |
| `geminiDirect` | creier gratuit de rezervă |
| `brainCapabilities` | **registrul unic** al celor 69 de capabilități |
| `brainToolDefs` | schemele uneltelor date creierului |
| `adminTools` | uneltele de admin, comune chat ∩ voce |
| `realtime` | vocea live (WebRTC cu OpenAI Realtime) |
| `asr` / `tts` | transcriere / sinteză vocală |
| `browser` | browser real pe server (9 unelte, capturi pe monitor) |
| `google` | Gmail, Calendar, Drive, traduceri |
| `stripe` | **istoric** — plățile au trecut pe Revolut (30 iul) |
| `openBanking` | citirea plăților din Revolut (creditare automată) |
| `runbooks` / `github` | mâinile lui Kelion: publică singur, rulează proceduri |
| `recovery` | puncte de recuperare (tag-uri git + arhive pe VPS) |
| `selfHeal` | reparare automată |
| `envCheck` | ce chei vede procesul ACUM (nume + lungime, **niciodată valori**) |

**Frontend**:
- pagini: `Stage` (aplicația), `Landing`, `Login`, `Credits`, `Manual`
- componente: `AdminPanel`, `ChatPanel`, `AvatarModel`, `CameraView`,
  `WalletButton`, `CustomerSettings`, `VisitorChatWidget`, `BackLink`, ...

**Baza de date** (Postgres) — 34 de tabele, cele principale:
`messages` `user_prefs` `wallets` `transactions` `billing_events` `payment_codes`
`memories` `voiceprints` `faceprints` `cost_events` `visits` `demo_uses`
`local_accounts` `google_accounts` `kelion_tools` `build_jobs` `work_orders`
`notes` `leads` `inbound_emails` `client_errors` `kv_state`

## 1.3 Cum gândește (regula de rutare a creierului)

- **Owner-ul** primește ÎNTOTDEAUNA modelul plătit capabil din catalogul live.
  Dacă alegerea lui manuală nu mai e validă, cade pe alt model plătit — **nu** pe
  gratuit — și scrie `[CREIER]` în jurnal cu motivul.
- **Userii** merg pe scara gratuită, cu escaladare pe dificultate.
- Fără sold la OpenRouter → totul cade pe modele `:free`, care **narează în loc să
  execute**. Ăsta e primul lucru de verificat când „nu face ce i se cere".

---

# PARTEA II — ACCESUL

## 2.1 Serverul

| | |
|---|---|
| IP | `164.68.120.87` |
| User | `root` |
| Auth | cheie SSH (fără parolă) |
| Cheia | secretul GitHub **`VPS_SSH_KEY`** |
| Aplicația | `/root/kelion/` |
| Codul | `/root/kelion/repo` |
| Cheile | `/root/kelion/kelionai.env` (chmod 600) |
| Puntea | `/root/kelion/bridge-secret.txt` |

```bash
ssh -i <cheia-privata> -o StrictHostKeyChecking=no root@164.68.120.87
```

## 2.2 Fără cheie locală — prin Actions

Nu-ți trebuie cheia pe calculatorul tău. **Actions → workflow → Run workflow**:

| Workflow | La ce e |
|---|---|
| `vps-run` | orice comandă bash, ca root |
| `vps-enter` | intră în container |
| `vps-diag` | diagnostic: container, disc, memorie, loguri |
| `vps-probe` | răspunde aplicația? |
| `vps-keys` | ce chei există (numele, nu valorile) |
| `vps-set-env` | duce cheile din GitHub Secrets pe VPS |
| `vps-set-key` | scrie o singură cheie |
| `vps-key-setup` | pune o cheie SSH nouă |

## 2.3 GitHub

Repo: `github.com/kelion-team/kelionai` · producție = ramura `master`.

- Secrete: Settings → Secrets and variables → Actions
- Publicare: Actions → `deploy`
- Verificare PR: Actions → `pr-verify` (informativă, nu blochează)

---

# PARTEA III — PUBLICAREA

```
ramură → PR → merge în master → workflow „deploy" → VPS → verificare anti-fantomă
```

Pașii reali din `deploy.yml`:
1. SSH la `root@164.68.120.87`;
2. `cd /root/kelion/repo && git fetch origin master`;
3. **rulează `deploy/deploy.sh` DIN `origin/master`, dintr-o copie în `/tmp`** —
   nu din clonă. Motivul e o pană reală („deploy fantomă"): scriptul din clonă
   putea publica o versiune mai veche, iar verificarea de după valida greșit;
4. **anti-fantomă**: `/api/version` live trebuie să fie EXACT sha-ul din
   `origin/master`, iar `/health` == 200. Altfel publicarea pică.

**Regula de aur:** producția = `master`, mereu. Nimic nu publică vreodată cod mai
vechi decât `origin/master`.

**Proba, din orice terminal:**
```bash
curl -s https://kelionai.app/api/version
curl -s -o /dev/null -w "%{http_code}\n" https://kelionai.app/health
git rev-parse --short origin/master     # trebuie să fie acelasi sha
```

---

# PARTEA IV — CHEILE

Trăiesc în `/root/kelion/kelionai.env`; sursa e GitHub Secrets.
**Drumul unei chei:** GitHub Secrets → `vps-set-env` → env + repornire container.

## 4.1 Obligatorii

| Cheie | Fără ea |
|---|---|
| `DATABASE_URL` | nu pornește — conturi, credite, istoric |
| `SESSION_SECRET` | nimeni nu rămâne logat |
| `OPENROUTER_API_KEY` | **creierul** — nu răspunde nimic |
| `OPENAI_API_KEY` | vocea live, TTS, transcrierea |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | login cu Google |

## 4.2 Utile

`GEMINI_API_KEY` (creier rezervă + vedere) · `SERPER_API_KEY` (web) ·
`GOOGLE_MAPS_KEY` · `GOOGLE_TTS_API_KEY` + `GOOGLE_SERVICE_ACCOUNT_JSON`
(voce Chirp 3 HD) · `MAIL_USER` / `MAIL_PASS` (contact@) · `GITHUB_TOKEN`
(Kelion publică singur) · `BRIDGE_SECRET` (**aceeași valoare** și în
`/root/kelion/bridge-secret.txt`)

## 4.3 Plăți

`REVOLUT_PAY_LINK` · `GOCARDLESS_SECRET_ID` · `GOCARDLESS_SECRET_KEY` ·
`GOCARDLESS_ACCOUNT_ID` — detalii complete în **`PROCEDURA-PLATI.md`**.

## 4.4 Cum vezi ce chei are procesul ACUM

**Admin → Tokenuri** → „Ce chei vede serverul CHIAR ACUM": pentru fiecare cheie
spune dacă e prezentă, **câte caractere are** (0 = prezentă dar goală) și **sub ce
nume** a fost găsită. Nu afișează niciodată valori. Arată și ora pornirii
procesului — o cheie scrisă DUPĂ acea oră nu e încărcată până la repornire.

> **CAPCANĂ DOVEDITĂ:** `vps-set-env` are o **listă fixă de nume** în bucla care
> scrie. O cheie care nu e în listă se pune degeaba — workflow-ul raportează
> „succes" și cheia nu ajunge nicăieri. Când adaugi o cheie nouă, pune-o în
> **trei** locuri din `vps-set-env.yml`: blocul `env:`, lista buclei, și
> instrucțiunile din capul fișierului.

---

# PARTEA V — PORȚILE DE CALITATE

Rulează-le **exact așa** înainte de orice publicare:

```bash
cd backend  && npm ci && npm run typecheck && npm test
cd frontend && npm ci && npm run build          # tsc -b && vite build
node scripts/verifica-sintaxa.mjs               # marcaje de conflict, CSS, JSON
node scripts/verifica-exporturi.mjs             # exporturi fără utilizator
npx jscpd backend/src frontend/src --threshold 0.0001
```

Referință la 30 iul: **261 teste / 33 fișiere, 0 picate · 0 clone · 0 exporturi
orfane · sintaxă curată**.

> **CAPCANĂ DOVEDITĂ:** `npx tsc --noEmit -p tsconfig.json` **NU** e același lucru
> cu `npm run build` la frontend (`tsc -b && vite build`). `vite build` singur nu
> face typecheck. Verificarea greșită a lăsat o eroare de tip să treacă și a
> blocat publicarea 25 de minute.

---

# PARTEA VI — CÂND NU MERGE

| Simptom | Unde te uiți ÎNTÂI |
|---|---|
| situl nu răspunde | `vps-diag` (container pornit? disc plin?), apoi `vps-probe` |
| 502 imediat după publicare | containerul repornește — ~1 minut |
| chatul nu răspunde NIMIC | soldul OpenRouter (Admin → Bani); apoi jurnal: `[CHAT MUT]` |
| „nu execută ce-i cer" | jurnal `[CREIER]` — spune dacă a căzut pe model gratuit și de ce |
| o cheie „lipsește" deși e pusă | Admin → Tokenuri (§4.4) + lista din `vps-set-env` |
| publicarea nu ajunge live | Actions → `deploy`; anti-fantoma spune ce nu s-a potrivit |
| plata nu creditează | Admin → Bani → „Citirea plăților Revolut" |

Jurnalul: `docker logs --tail 200 <container>` (prin `vps-run`), sau
**Admin → Jurnale** din aplicație.

**Recuperare:** Admin → Recuperare — puncte de restaurare (tag-uri git + arhive pe
VPS). Restaurarea aduce `master` la starea aleasă printr-un commit nou, deci
publicarea pornește singură.

---

# PARTEA VII — STAREA REALĂ (30 iul 2026)

## Merge, verificat
Chat scris · voce live full-duplex · vedere prin cameră · skill-uri Google (cu
acordul fiecărui user) · căutare web · browser real pe server (9 unelte, cu
capturi pe monitor) · memorie · manual în 7 limbi · panou admin · publicare
automată cu verificare anti-fantomă.

## Nu merge / nefinalizat
- **Creditarea automată a plăților** — codul e scris (coduri unice, istoric,
  potrivire, creditare idempotentă), lipsește ultima verigă: cine anunță
  aplicația că a intrat un ban. Vezi `PROCEDURA-PLATI.md` §9 pentru cele trei căi.
- **Arderea creditului n-are plafon** — rândul B8 din `RAMAS-DE-FACUT.md`:
  owner-ul primește modelul plătit la FIECARE mesaj, cu până la 4 cadre de cameră
  pe tură, și **nu există niciun plafon pentru admin** (`chat.ts`: „adminul e
  scutit"). Ăsta e cel mai scump lucru nerezolvat.
- Restul, cu dovezi: **`RAMAS-DE-FACUT.md`**.

---

# PARTEA VIII — REGULILE DE LUCRU

Sunt în **`CLAUDE.md`** și se încarcă la fiecare sesiune. Scrise după eșecuri
reale, nu din teorie:

1. **O valoare care nu vine dintr-o măsurătoare reușită se scrie „nu pot
   verifica"** — niciodată o cifră sau un verdict. Într-o singură zi, panoul a
   afirmat de cinci ori stări pe care nu le măsurase.
2. **Când Adrian contrazice un raport, primul loc de căutat e codul care a produs
   raportul**, nu sistemul lui. A avut dreptate de fiecare dată.
3. **Nicio operație în masă pe ceva ce n-ai privit.** (`git add -A` pe un merge cu
   conflicte a comis `<<<<<<<` în cod care rula; un script de ștergere
   necontrolat a tăiat 1524 de linii dintr-un fișier.)
4. **Înainte să-i ceri ceva manual, dovedește din cod sau de pe live că e chiar
   necesar.** Timpul lui nu e locul unde se testează ipoteze.

**Convenția care ține totul legat:** dacă schimbi codul, actualizezi
`AI-HANDOFF.md` înainte să închizi. Nu există alt mecanism — convenția asta E
mecanismul.

**Alte reguli:** răspunde-i lui Adrian în română · el testează live, nu local, deci
după fiecare reparație: build → publicare → **verificare live cu dovadă** ·
chatul/vocea rămân sub 1 secundă până la primul cuvânt · repari rescriind modulul
responsabil, nu prin peticiri.

---

# PARTEA IX — DOCUMENTELE PROIECTULUI

| Fișier | Ce conține |
|---|---|
| `acces_aplicatie_full.md` | **acesta** — acces, publicare, chei, porți, stare |
| `AI-HANDOFF.md` | arhitectura completă + istoricul fiecărei decizii (sursa de adevăr) |
| `RAMAS-DE-FACUT.md` | ce NU e făcut și ce NU merge, cu dovada fiecărui rând |
| `CLAUDE.md` | regulile de lucru, încărcate automat la fiecare sesiune |
| `PROCEDURA-PLATI.md` | plățile, de la A la Z |

**Ordinea de citit la prima sesiune:** `CLAUDE.md` → acest fișier →
`AI-HANDOFF.md` → `RAMAS-DE-FACUT.md`.
