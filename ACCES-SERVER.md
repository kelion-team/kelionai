# ACCES SERVER & DATE — harta completă (Kelionai)

> **Scop:** un singur loc din care ajungi la TOT — server (VPS), baze de date,
> GitHub, Google, cheile. **Nu conține valori secrete** (parole/token-uri) —
> acelea rămân doar în locurile lor sigure (le deții tu). Aici scrie **unde stă
> fiecare cheie și cum o folosești**. Fișier de referință; se ține la zi manual.

---

## 1. SERVERUL (VPS Linux)

| | |
|---|---|
| **IP** | `164.68.120.87` |
| **User** | `root` |
| **Autentificare** | parolă root **SAU** cheie SSH personală (a ta) |

### 1.a Acces DIRECT, manual (tu, de pe Windows) — shell + creierul `claude`
Deja există scurtătura ta: `bridge/kelion-linux.cmd`
```bat
ssh -t -i "C:\Users\adria\Kelionai-secrets\kelion-vps" root@164.68.120.87 ^
  "bash -lc 'set -a; source /root/kelion/claude.env; set +a; cd /root/kelion/repo; exec claude'"
```
- Cheia SSH: `C:\Users\adria\Kelionai-secrets\kelion-vps` (pe laptopul tău).
- Te bagă direct în `/root/kelion/repo` cu mediul CLI încărcat și pornește `claude`.

### 1.b Acces manual simplu (doar shell, fără claude)
```bash
ssh root@164.68.120.87          # cere parola root
# sau cu cheia:
ssh -i /cale/spre/kelion-vps root@164.68.120.87
```

### 1.c Parola root — unde stă
- **Doar în GitHub → Settings → Secrets → Actions**, secretul `VPS_ROOT_PASS` (mascat).
- **NU** e pe VPS, **NU** e în repo, **NU** o are Kelion. (Motivul: secțiunea 6.)

---

## 2. CE E PE VPS (`/root/kelion/`)

| Cale | Ce e |
|---|---|
| `/root/kelion/repo/` | clona git (ținută la zi cu `master` la 5 min de timer-ul `kelion-repo-sync`) |
| `/root/kelion/claude.env` | auth CLI (token-urile de abonament ale creierului worker) |
| `/root/kelion/bridge-secret.txt` | secretul comun cu backendul (28 car., = `BRIDGE_SECRET` din env-ul VPS) |
| `/root/kelion/kimi-key.txt` | cheia Kimi (creier primar) — pusă prin `vps-keys.yml` |
| `/root/kelion/glm-key.txt` | cheia GLM (creier rezervă) — pusă prin `vps-keys.yml` |
| `/root/kelion/github-token.txt` | token GitHub pentru `bridge/kelion-github` (PR/merge/deploy/api) |
| `/root/kelion/tier-state.json` | starea failover-ului de creier (supraviețuiește deploy-ului) |

### Servicii systemd pe VPS (verifică-le cu `systemctl status <nume>`)
- `kelion-bridge` — worker CHAT (admin + public/demo)
- `kelion-builder` — constructorul (scrie/repară cod; are Bash) *(sau pool-ul de reparatori)*
- `kelion-deployer` — publicarea aprobată
- `kelion-paznic` — paznic (repornește ce cade)
- `kelion-voice` — agentul de voce full-duplex (LiveKit)
- Timere: `kelion-repo-sync` (5 min), `kelion-caiet-watch` (1 min), `kelion-perpetuum` (15 min)

### Comenzi utile pe VPS
```bash
systemctl status kelion-bridge kelion-builder kelion-deployer --no-pager
journalctl -u kelion-bridge  -n 200 --no-pager
journalctl -u kelion-builder -n 200 --no-pager
cat /root/kelion/repo/AI-HANDOFF.md      # tot ce știe Kelion
```

---

## 3. BAZA DE DATE (Postgres)

- **Conexiune:** `DATABASE_URL` — variabilă în env-ul backendului pe VPS (pusă prin `vps-set-env` din secretul GitHub omonim). Valoarea = string-ul de conexiune Postgres.
- **Acces direct:** de pe VPS, cu `DATABASE_URL` din mediul containerului:
  ```bash
  psql "$DATABASE_URL"          # rulat pe VPS (sau cu string-ul copiat din env)
  ```
- **Tabele (toate datele) — schema din `db.ts`:**
  `messages`, `user_prefs`, `memories`, `notes`, `shared_memory`, `wallets`,
  `billing_events`, `blocked_users`, `visits`, `demo_uses`, `leads`,
  `contact_messages`, `inbound_emails`, `visitor_chats`, `capability_gaps`,
  `work_orders`, `staged_releases`, `admin_pool`, `app_files`, `app_downloads`,
  `generated_images`, `google_accounts`, `cost_events`, `kv_state`, `voiceprints`.
- **Prin app (fără psql):** panoul Admin de pe kelionai.app + endpoint-urile `/api/admin/*`.

---

## 4. MEDIUL BACKENDULUI (pe VPS)

- Gazda: **VPS propriu** (`164.68.120.87`), container `kelionai-app`. Cod din `master`, publicat pe VPS. Gazda PaaS veche a fost SCOASĂ — nu mai există serviciu, proiect sau deploy extern.
- **Variabilele de mediu** se pun pe VPS prin `vps-set-env.yml` (din secretele GitHub) și se citesc de container.
- **Toate variabilele de mediu** (nume, nu valori) — citite în `backend/src/config.ts`:
  `NODE_ENV, PORT, ADMIN_EMAIL, ALLOWLIST, ANTHROPIC_API_KEY, GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GOOGLE_API_KEY, GOOGLE_MAPS_KEY,
  GOOGLE_SERVICE_ACCOUNT_JSON, GOOGLE_TTS_API_KEY, GOOGLE_TTS_VOICE,
  KELION_GOOGLE_CHIRP_TTS_STYLE, SESSION_SECRET, DATABASE_URL, SERPER_API_KEY,
  GEMINI_API_KEY, GEMINI_MODEL, BRIDGE_SECRET, MAIL_IMAP_HOST/PORT,
  MAIL_SMTP_HOST/PORT, MAIL_USER, MAIL_PASS, MAIL_FORWARD_TO, STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET, STRIPE_CURRENCY, CREDIT_VALUE, USD_TO_CURRENCY,
  USER_SHARE, DEMO_CAP_PER_DAY, DEMO_SECONDS, OPEN_SIGNUP, AUTONOMY_DAILY_MAX,
  FRONTEND_DIST, FRONTEND_ORIGIN, KELION_FAST_MODEL, KELION_TOP_MODEL,
  KIMI_API_KEY, GLM_API_KEY, LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET`
- Tokenul gazdei PaaS vechi (secret GitHub rămas) — **secret MORT.** Niciun workflow și niciun cod nu-l mai folosește (gazda scoasă). Rămâne doar ca intrare în GitHub → Settings → Secrets → Actions; **poți să-l ștergi liniștit** (Claude nu poate șterge secrete). Apare în logul workflow-urilor doar fiindcă pasul de diagnostic listează *numele* tuturor secretelor.

---

## 5. GITHUB

- Repo (privat): **`kelion-team/kelionai`**.
- Token pe VPS: `/root/kelion/github-token.txt`; în CI: secretul `VPS_GITHUB_TOKEN`.
- **Regula #5 (importantă):** GitHub NU se accesează prin browser (repo privat → 404 + zid de login). Orice citire/operațiune trece prin `bridge/kelion-github`: `pr`, `merge`, `deploy`, `runs`, `api <cale>`.
- **GitHub → Settings → Secrets → Actions** (cheile care dau putere reală):
  `VPS_ROOT_PASS`, `KIMI_KEY`, `GLM_KEY`, `VPS_GITHUB_TOKEN`. (Un token vechi de gazdă mai e listat acolo, dar e MORT — vezi §4; se poate șterge.)
- Workflow-uri de operațiuni pe server (`.github/workflows/`): `bridge-deploy.yml`,
  `vps-restart.yml`, `vps-auto-restart.yml`, `vps-keys.yml`, `vps-repo-sync.yml`,
  `vps-tier-test.yml`, `vps-diag.yml`, `vps-livekit-install.yml`,
  `vps-livekit-tls.yml`, `vps-voice-agent-run.yml`, `vps-qa-patrol.yml`.

---

## 6. DE CE KELION NU ARE ACCES LA SSH (și „restul")

**Nu e mutilare — e o barieră de siguranță pusă intenționat („autonomie în lesă", regula #11 din AI-HANDOFF).** Concret:

1. **Cheile care dau putere de root/deploy stau DOAR în GitHub Secrets, în afara VPS-ului** unde rulează Kelion: `VPS_ROOT_PASS` (parola root). Kelion nu le are pe disc → **nu poate face SSH ca root, nu poate publica singur** pe lângă pipeline.
2. **Kelion rulează DEJA pe VPS** (ca worker de chat + constructor), deci nu-i trebuie SSH către el însuși ca să citească/scrie cod: constructorul are `Bash` + repo-ul local. Ce NU are e **parola root** și dreptul de a face operațiuni privilegiate nesupravegheat.
3. **Operațiunile de root (restart servicii, instalare pachete, scriere chei, deploy) le atinge INDIRECT:** Kelion *declanșează* un workflow determinist (`vps-*.yml`) prin token-ul GitHub, iar acel workflow face SSH cu secretul din GitHub Secrets. Așa fiecare acțiune privilegiată e o **procedură numită, logată, repetabilă** — nu o comandă liberă a unui LLM. (Principiul din §14.b: operațiuni exacte = unealtă deterministă, nu „LLM care interpretează".)
4. **Creierul din CHAT** are, în plus, uneltele scoase complet (doar `Read`, și doar când atașezi o poză) — tăiate pentru **viteză** (cei 31s veneau din `--add-dir /root/kelion` + unelte). Execuția reală se predă constructorului prin eticheta `[EXECUT]`.

**Motivul de fond:** un LLM care intră în buclă sau greșește NU trebuie să poată șterge producția sau serverul. De aceea puterea reală (root/SSH/deploy) stă la tine, în GitHub Secrets, și trece prin pași aprobați.

### Dacă vrei să-i DAI lui Kelion acces direct (decizie ta, conștientă)
Se poate — dar cu compromisul de securitate asumat:
- **SSH direct:** pui cheia SSH pe VPS (ex. `/root/kelion/vps-key`) și dai constructorului voie s-o folosească → poate face `ssh`/root singur. (Riscul: o buclă poate atinge rootul nesupravegheat.)
- **Deploy fără aprobare:** scoți poarta de aprobare din constructor. (Riscul: publică singur cod nedovedit.)
- **Unelte pe chat:** repui `--add-dir` + unelte pe creierul de chat. (Costul: latența crește — cei 31s.)

Spune-mi exact care din ele le vrei și le fac, cu bariere clare (ex. doar comenzi dintr-o listă albă), ca autonomia să crească fără să pierzi siguranța.

---

## 7. CUM OBȚII VALORILE REALE (fiecare secret, din locul TĂU)

> Valorile nu se scriu în repo (ar rămâne pe veci în istoricul git). Dar tu le
> deții pe toate — iată cum scoți fiecare, direct de la sursă.

### 7.a Toate secretele de pe VPS — o singură comandă
Rulează asta de pe laptop (cu cheia ta SSH) și-ți afișează pe ecran tot ce e pe VPS:
```bash
ssh -i "C:\Users\adria\Kelionai-secrets\kelion-vps" root@164.68.120.87 ^
  "for f in bridge-secret.txt kimi-key.txt glm-key.txt github-token.txt; do echo \"== $f ==\"; cat /root/kelion/$f; echo; done; echo \"== claude.env ==\"; cat /root/kelion/claude.env"
```
Îți dă: secretul punții, cheia Kimi, cheia GLM, tokenul GitHub și tot `claude.env` (auth CLI).

### 7.b Valorile de mediu de pe VPS (DB, Google, Stripe, mail, LiveKit etc.)
Env-ul backendului stă pe **VPS**. Valorile se pun prin `vps-set-env.yml`
(din secretele GitHub) și se citesc de container. Ca să le vezi pe VPS:
```bash
ssh -i "C:\Users\adria\Kelionai-secrets\kelion-vps" root@164.68.120.87 \
  "docker exec kelionai-app printenv | sort"   # numele + valorile din container
```
Aici stau: `DATABASE_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `GEMINI_API_KEY`, `SERPER_API_KEY`,
`STRIPE_SECRET_KEY`, `MAIL_PASS`, `SESSION_SECRET`, `BRIDGE_SECRET`,
`LIVEKIT_API_KEY/SECRET` ș.a.m.d.
- **Stringul bazei de date:** `DATABASE_URL` din env-ul containerului (comanda de mai sus).

### 7.c GitHub Secrets — ATENȚIE
`VPS_ROOT_PASS`, `KIMI_KEY`, `GLM_KEY`, `VPS_GITHUB_TOKEN` **NU se pot
citi înapoi** din GitHub (așa e proiectat GitHub — după ce salvezi un secret, nu-l mai
arată niciodată; îl poți doar **suprascrie**). Dacă ai nevoie de valoarea lor:
- **Parola root VPS:** nu-ți trebuie de fapt — ai deja acces root cu **cheia SSH** (`kelion-vps`). Dacă vrei totuși parola și n-o mai știi, o resetezi de la providerul VPS.
- **Kimi/GLM/GitHub token:** valorile reale sunt pe VPS (7.a) — aceleași care sunt și în GitHub Secrets.
- **Tokenul vechi de gazdă PaaS:** MORT, nu-l mai regenera — șterge-l din GitHub Secrets (§4).

### 7.d Google Cloud (skill-uri Gmail/Calendar/Drive/TTS)
Consola: `console.cloud.google.com`, proiect **`gen-lang-client-0460348646`**.
Service account JSON = valoarea `GOOGLE_SERVICE_ACCOUNT_JSON` din env-ul VPS (7.b).

---

## 8. VERIFICARE RAPIDĂ CĂ TOTUL E SUS (60s)
```bash
curl -s https://kelionai.app/api/version        # {v,at} cu boot recent
curl -s https://kelionai.app/health             # 200
curl -s https://kelionai.app/api/dev/status     # bridge:true, lanes>0, srv
```
