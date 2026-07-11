# KELIONAI — DOCUMENT COMPLET DE PRELUARE PENTRU ORICE AI
*(actualizat 11 iulie 2026 — dacă deschizi acest fișier ca AI nou, aici ai TOT ce trebuie ca să lucrezi imediat, fără să mai explorezi de la zero)*

> **DOCUMENT VIU — regulă obligatorie:** dacă schimbi cod, arhitectură, reguli sau
> starea proiectului, **actualizează secțiunea relevantă de aici (și §13 Starea)
> ÎNAINTE să închei sesiunea/PR-ul.** Nu există alt mecanism de auto-actualizare —
> convenția asta E mecanismul. Un document de preluare depășit e mai periculos
> decât unul lipsă (induce în eroare AI-ul următor). Vezi și §11.

## 0. Ce este proiectul
**Kelionai** = asistent AI live la **https://kelionai.app**: avatar 3D (Ready Player Me),
voce hands-free (wake word „Hey Kelion", TTS Chirp 3 HD, barge-in), vedere prin cameră,
GPS, 14+ skill-uri Google/tool-use, chat multilingv, browser live navigabil de Kelion,
generare imagini, corectare transcriere. Proprietar unic + singurul admin:
**Adrian — adrianenc11@gmail.com**. Repo: `kelion-team/kelionai` (GitHub).

## 1. REGULI NE-NEGOCIABILE (ordinea lui Adrian)
1. **Vorbește cu Adrian în ROMÂNĂ.** Limba lui de chat cu Kelion e blocată permanent pe română; restul userilor pe detecție automată.
2. Adrian **testează live** pe kelionai.app, nu local → după fiecare cerință rezolvată: **build → deploy → VERIFICĂ LIVE cu dovadă** (nu declara nimic „gata" fără dovadă reală: curl, decodare, măsurătoare).
3. **Producția = master, 100% sincron, mereu.** Nimic nu are voie să publice cod mai vechi decât `origin/master` (lecția „deploy fantomă", vezi §6).
4. Chat/voce = **latență minimă** (țintă: primul cuvânt sub 1s). Nu adăuga întârzieri nejustificate.
5. Repară **rescriind modulul mic responsabil**, nu cu petice.
6. **NU schimba cheia/rutarea pe abonament pentru admin și demo** (vezi §5 — bani). Cost pe demo: neschimbat fără acord explicit.
7. Model: **pornește mereu pe viteză maximă, escaladează automat la cel mai puternic model al momentului** doar când cerința o cere (router §4.3).
8. Marcaje de sistem în producție (versiune sub QR, filigran): **ora Londrei**. Ora către utilizator: **a utilizatorului** (clientul trimite `now`/`tz` per tură).
9. Toți userii au aceleași capabilități consumer (voce/față/ochi/GPS/Google); ingineria de cod la nivel Claude Code e pentru admin prin punte (userii obișnuiți = milestone sandbox).
10. Nu atinge `C:\Users\adria\Downloads\k` (proiect vechi arhivat, doar pe mașina lui Adrian).
11. **Autonomie „în lesă"** (`services/autonomy.ts`): max 20 reparații automate/24h; aceeași eroare de 2 ori → oprire, nu retry orb. Fără force-push, fără publicare fără „da"-ul lui Adrian (vezi `bridge/UNELTELE-LUI-KELION.md`).
12. **Ține acest document la zi** — vezi banda de sus.

## 2. ARHITECTURA
```
[Browser: React+Vite+TS]  ⇄  [Backend: Node+Fastify+TS pe Railway]  ⇄  [Postgres pe Railway]
        │                             │
        │                             ⇅ (punte HTTP long-poll, secret partajat)
        │                     [VPS Linux 164.68.120.87: worker `claude` CLI pe
        │                      abonamentul lui Adrian + paznic + builder + deployer]
        └── PWA/TWA/instalatoare = învelișuri live peste kelionai.app
```

### 2.1 Frontend (`frontend/src/`)
- **Pagini:** `pages/Stage.tsx` (scena 3D + orchestrarea UI), `pages/Landing.tsx` (site public + QR-uri).
- **Componente:** `ChatPanel.tsx` (panoul de chat), `AdminPanel.tsx` („Vezi chat" per user, „Tradu în română", Inbox live, finanțe, useri), `CustomerSettings.tsx` (⚙ client: Preferințe, Credit cu mențiunea 25%, BYOK, Cont+ștergere), `ContactModal.tsx`, `WalletButton.tsx` (credit + reminder escaladant), `AvatarModel.tsx` (randare RPM + idle + lip-sync moderat intenționat), `AvatarLoading.tsx` (progres GLB ~9MB, altfel ecran negru pe mobil), `CameraView.tsx` (ochii lui Kelion — ascuns pe ecran, gard anti-cadru-negru), `CardView.tsx` (rezultate skill: email/calendar/tasks/Drive/contacts/search), `VisitorChatWidget.tsx` (chat live vizitator↔OWNER, nu AI, poll 3s).
- **Lib (`src/lib/`):** `voice.ts`/`audioIO.ts` (voce — anti-ecou `VOICE_GAP_MS=1800` NU se atinge), `updateCheck.ts` (sursă unică versiune: filigran + sub QR, ora Londrei), `chat.ts` (streaming client, „ceas de gardă" 50s + `/api/chat/resume`), `admin.ts` (toate fetch-urile panoului admin), `api.ts` (auth Google + `startGoogleConnect` consimțământ incremental + `startDemo`), `camera.ts`, `fingerprint.ts` (anti-abuz demo, SHA-256 semnale browser), `i18n.ts` (7 limbi UI), `micStream.ts` (dictare live, pauză 3000ms închide fraza — „ordinul lui Adrian"), `recorder.ts` (clipuri promo admin), `turnManager.ts` (**COD MORT — neimportat**, vezi §10), `utteranceCoalescer.ts` (leagă fragmente STT, debounce 900ms), `wakelock.ts`, `workspace.ts` (mod monitor multi-taburi, o singură voce), `prefs.ts`, `billing.ts`, `languages.ts`.

### 2.2 Backend (`backend/src/`)
**Rute (`routes/`):**
| Fișier | Ce face |
|---|---|
| `chat.ts` | Creierul: rutare admin→punte / public→punte / clienți→API; voce din prima frază; guardian limbă; tool-use loop; router model |
| `bridge.ts` | Puntea: coadă joburi, `pull/ack/reply/reply-chunk`, `authed()` (log nepotrivire secret) |
| `auth.ts` | Google OAuth, allowlist, consimțământ incremental |
| `admin.ts` | Panou admin (useri, finanțe, gaps, inbox live, traducere) |
| `prefs.ts` | Limbă/meserie/BYOK per user |
| `billing.ts` | Credite Stripe, webhook 75/25 |
| `me.ts` | Auto-ștergere cont (GDPR) |
| `demo.ts` | Pornire probă gratuită + leads + chat vizitator |
| `asr.ts` | Transcriere batch (Google STT v2, `chirp_3`, regiune `eu`) — costă bani |
| `asr-stream.ts` | Transcriere live WebSocket, start/stop vorbire pentru barge-in |
| `tts.ts` | Sinteză Chirp 3 HD, plafon 5000 car. — costă bani |
| `correct.ts` | Corectare STT via Gemini (doar la încredere scăzută) — costă bani |
| `image.ts` | Servește bytes-ii imaginilor generate |
| `ingest.ts` | Document base64 → Markdown (Kelion citește fișiere) |
| `mapview.ts` | Hartă Leaflet+OSRM cu GPS live, fără cheie Google (merge în iframe) |
| `meserii.ts` | Lista rolurilor/personajelor disponibile |
| `contact.ts` | Formular contact public, salvat mereu în DB + royal letter |
| `greet.ts` | Salutul avatarului la hover pe landing (4 replici fixe, cache) |
| `legal.ts` | `/privacy`, `/terms`, `/delete-account` static (cerut de Google verification) |

**Servicii (`services/`):**
| Fișier | Ce face |
|---|---|
| `google.ts` | Toate skill-urile Google + `webSearch` (Serper: answerBox+KG+PAA+news+related) |
| `modelRouter.ts` | Router capabilitate↔cost — vezi §4.3 |
| `agents.ts` | Memorie: `recallMemories`/`learnFromTurn` |
| `mailbox.ts` | Poller contact@ + Inbox live (fetchRecentInbox, nu marchează citit) |
| `mail.ts` | Client SMTP (Namecheap), scrisori „royal letter" cu referință KA-AN-NNNN |
| `lang.ts` | Detecție limbă deterministă server-side |
| `pronounce.ts` | Mod academic: pronunție acronime litere-cu-litere |
| `stripe.ts` | Checkout + verificare webhook |
| `autonomy.ts` | Lesa autonomiei: `budgetCheck` (20/24h), `sameFailure` (stop la eșec repetat) |
| `commands.ts` | Interpretor comenzi dispozitiv server-side (cameră/monitor) — instant, fără cost model |
| `feedback.ts` (+`.verify.ts`) | Re-cheamă creierul admin când constructor/tester termină (ready/pass/fail) |
| `orders.ts` (+`.verify.ts`) | Registrul de ordine: conflict vs eroare, duplicate, raport de stadii |
| `supervisor.ts` (+`.verify.ts`) | Supervizare agent constructor: wait/deploy-check/reassign (1×)/giveup |
| `replayStore.ts` | Buffer reluare răspuns chat întrerupt (expiră 2 min) |
| `speech-chunk.ts` | `splitForSpeech` — TTS începe din prima propoziție (folosit activ în chat.ts) |
| `image.ts` (serviciul) | Generare imagini Gemini `2.5-flash-image` (service account, nu cheia gratuită) |
| `linuxPackage.ts` | Construiește `/dl/Kelionai-linux.zip` on-the-fly, cache după prima construcție |
| `markitdown.ts` | Document→Markdown via subprocess Python, timeout 30s |
| `meserii.ts` (serviciul) | 15 „meserii" (Influencer, Avocat, Contabil...) cu `systemPromptAddon` |
| `anthropic.ts` | Clientul Claude — O SINGURĂ cheie plătită, FĂRĂ cheie de rezervă (ordin) |
| `browser.ts` (serviciul) | Browser real (Playwright/Chromium) navigabil de Kelion, gard SSRF, `/api/browser/shot/:id` |
| `cost.ts` | Tabel prețuri reale per model/serviciu — date admin-only |

### 2.3 Puntea/VPS (`bridge/`) — 164.68.120.87
**ACTIV (rulează pe VPS acum):**
- `kelion-bridge-linux.mjs` — workerul principal: benzi separate admin/public (max 2 fiecare); sesiune caldă admin (`WARM_MAX_TURNS=8`); **sesiuni calde per-vizitator** (`warmPub`, plafon 6, LRU, stingere 10 min); **procese de gardă publice** (standby ×2); puls 3s; prima bucată text instant.
- `context.md` — briefing-ul privat trimis creierului admin la fiecare tură (cine e Adrian, arhitectura, banii, reguli); **NICIODATĂ** trimis joburilor `persona:'public'` (gard anti-scurgere).
- `repair.sh` — reparație autonomă: ANCORATĂ la `origin/master` (nu la HEAD local vechi); succes → **push în master**.
- `pornire-linux.sh` — sincronizare forțată VPS la `origin/master` + restart servicii.
- `kelion-builder-server.mjs` — constructor headless pe VPS (servicul systemd `kelion-builder`): trage ordine, streamează pași, staghează release, așteaptă „da"-ul lui Adrian.
- `blindare-punte.sh` (+ `BLINDEAZA-PUNTEA.cmd`) — hardening manual: systemd `Restart=always`, cron pază la 1 min.
- `kelion-linux.cmd` — scurtătură SSH Windows→shell `claude` pe VPS (unealtă manuală Adrian).
- `UNELTELE-LUI-KELION.md` — specificația contractului de unelte + reguli de decizie autonomă (referință validă, nu cod).

**COD VECHI/ARHIVAT — era laptop Windows (înlocuită de migrarea pe VPS, 9 iul):** vezi §10.

Servicii systemd pe VPS: `kelion-bridge`, `kelion-paznic`, `kelion-builder`, `kelion-deployer`.

## 3. RUTAREA CREIERULUI (cine răspunde cui) — chat.ts
- **Admin (Adrian)** → puntea (worker `claude` pe VPS = echivalent Claude Code, cu context privat + memorie + fișiere). Punte jos → mesaj cinstit (NU cădea pe API — ordin).
- **Vizitatori/demo/public** → puntea, banda `public`, personaj neutru `PUBLIC_PREAMBLE`, FĂRĂ context privat, cwd `/tmp`; demo = anonim (fără memorie/istoric injectat). Punte jos → mesaj cinstit (NU API — ordin: „peste tot abonamentul mare").
- **Clienți plătitori** (credite `paysOwnWay` sau cheia lor BYOK) → API Anthropic direct, cu tool-uri complete. Cheia clientului NU cade NICIODATĂ pe cheile platformei.
- Joburile publice cer capabilitatea `persona` declarată de worker la `pull` (gard anti-scurgere); jobul public poartă `turn` (pachet subțire) + `visitor` (cheia sesiunii calde per-vizitator).

## 4. SISTEME CHEIE
### 4.1 Memoria (dublată, #20)
Tabel `memories` (namespace per agent). `recallMemories` (DB pur, în paralel — zero latență) injectat în system prompt; `learnFromTurn` (Haiku, fire-and-forget) învață fapte; **tool-uri pentru TOȚI userii**: `list_memories` („ce știi despre mine?"), `forget_memory` („uită că…" → `deleteMemory` ILIKE); **continuitate**: pauză >45 min → prompt de „reîntâlnire". Notițe explicite = tabel separat (`save_note`/`list_notes`/`delete_note`). **Status real (corectează STATUS.md, care încă o listează la „Next"): LIVE, DONE.**
**Căutare full-text (11 iul):** `searchMemories` NU mai folosește `ILIKE` (substring literal) — acum e full-text Postgres nativ (`to_tsvector`/`to_tsquery` config `'simple'`, index GIN `idx_memories_fts`), cu **potrivire de PREFIX** (`:*`, ca „cafea" să prindă „cafeaua" fără dicționar de limbă) și sortare după relevanță reală (`ts_rank`), nu doar recență. Testat cu Postgres 16 real local (11 cazuri, inclusiv izolare user/agent + imunitate injecție SQL) înainte de deploy — nu doar `tsc`. Tot NU e embeddings/AI semantic (ar cere `pgvector` + apel API pe scriere); e potrivire pe cuvinte reale cu scor, un pas real peste ILIKE dar sub semantică adevărată.
### 4.2 Limbă
Admin blocat `ro-RO` (`adminLocked` în chat.ts). Restul: detecție deterministă server (`services/lang.ts`, comitere după 2 mesaje consecutive), guardian care re-servește o singură dată la limbă greșită. Mod academic: registru + pronunție acronime (`pronounce.ts`, `academicPronounce`).
### 4.3 Router model (capabilitate↔cost)
`services/modelRouter.ts`: `MODEL_FAST` (env `KELION_FAST_MODEL`, azi `claude-fable-5`) / `MODEL_TOP` (env `KELION_TOP_MODEL`, azi `claude-opus-4-8`). `taskDifficulty()` euristic (0 cost) + **marjă +10%** → `chooseModel` ia cel mai IEFTIN model care acoperă necesarul; eșec/refuz pe FAST → re-servit pe TOP + odihnă 10 min. Model nou în viitor = setezi variabila în Railway, intră instant fără deploy. Teste: `backend/src/modelRouter.test.ts`.
### 4.4 Latență (#7)
Server: stall punte public 12s (era 45s); voce din prima frază; recall DB în paralel. Worker: standby ×2 + sesiuni calde per-vizitator + prima bucată instant + puls 3s.
**MĂSURAT REAL (11 iul, după fix-ul „calea rulată" din §6): tura 1 = 3.31s, tura 2 = 3.12s, tura 3 = 2.54s** — de la eșec total (13s + eroare) la răspuns real funcțional, tendință clară de scădere. **Ținta „sub 1s" NU e atinsă** — onest, nu ascunde asta. Cauza probabilă: rundă completă rețea (client→Cloudflare→Railway→VPS→model) + timpul real al modelului până la primul token; pe distanțe astea, sub 1s e o limită fizică realistă, nu doar de cod. Măsurătoare: `python3` scriptul multi-tură din scratchpad (sesiune demo reală, cookie păstrat între ture) sau workflow `public-latency-test`.
### 4.5 Căutare web (#12)
`webSearch` în `google.ts`: Serper cu answerBox + knowledgeGraph + peopleAlsoAsk + topStories/news + relatedSearches, 8 (max 12) rezultate; fallback Gemini grounded search. Cost: `SERPER_USD_PER_CALL`.
### 4.6 Autonomie & reparare (buclă completă)
`commands.ts` (interpretor server, instant) → creierul admin decide reparația → constructor (`kelion-builder-server.mjs`) execută → `orders.ts` ține registrul (conflict vs eroare, duplicate) → `supervisor.ts` verifică progresul (1 re-asignare, apoi giveup) → `feedback.ts` re-cheamă creierul admin cu verdictul → `autonomy.ts` plafonează totul (20 reparații/24h, stop la eroare repetată de 2×).
### 4.7 Browser live + documente
`services/browser.ts` — Chromium real navigabil de Kelion (o sesiune per user, gard SSRF, capturi `/api/browser/shot/:id`). `ingest.ts` + `markitdown.ts` — orice document (PDF/Word/Excel) → Markdown, tăiat la 120.000 car.

## 5. BANII (nu confunda portofelele!)
| Portofel | Cine consumă | Unde se vede/încarcă |
|---|---|---|
| **Abonamentul Claude al lui Adrian (Max 20x)** + usage credits | Claude Code (sesiunile de lucru) + puntea VPS (chat admin + public/demo) | claude.ai → Settings → Usage |
| **Cheia API platformă** (`ANTHROPIC_API_KEY` în Railway) | clienții plătitori fără BYOK | console.anthropic.com → Billing |
| **Cheia clientului (BYOK)** | doar acel client | contul lui |
| **Portofelele clienților în app** (Stripe) | creditele lor de chat; **din fiecare reîncărcare 75% credit client, 25% platformă** | kelionai.app (billing.ts, webhook `/api/credits/webhook`) |

Alte costuri reale (contorizate în `cost.ts`, plătite din abonament/cheie platformă după caz): ASR (`ASR_USD_PER_CALL`), TTS Chirp 3 HD, Serper (`SERPER_USD_PER_CALL`), generare imagini Gemini, corectare Gemini.

## 6. DEPLOY — LECȚIA CRITICĂ „DEPLOY FANTOMĂ" (10 iul)
**Simptom:** GitHub zicea „success", producția rămânea pe build vechi (rute noi 404).
**Cauze reale găsite:** (a) verificarea veche se uita doar la `/health=200`, care venea de la containerul VECHI; (b) VPS-ul divergase (commituri locale de auto-reparare) și publica cod vechi peste cel corect; (c) `bridge-secret.txt` de pe VPS avea un secret VECHI (64 car. vs 28 în Railway) → serverul respingea workerul nou (`auth fail: header 64 chars vs secret 28`), iar un **worker zombie** (secret bun, fără `persona`) ținea becul verde cu banda publică moartă.
**Fixuri permanente:** `deploy.yml` (push pe master) verifică acum că **`/api/version` s-a SCHIMBAT** față de dinainte; `repair.sh`/`pornire-linux.sh` ancorate la `origin/master` (reparațiile reușite se ÎMPING în master); `bridge-deploy.yml` (manual, cere parola root VPS ca input mascat) sincronizează VPS-ul la master + **scrie secretul corect din Railway în `/root/kelion/bridge-secret.txt` (prin stdin)** + omoară zombie + repornește serviciile.
**Verificare după ORICE deploy:** `curl https://kelionai.app/api/version` (formă `{v,at}`, `v` = boot nou) + o rută nouă relevantă (401/403 ≠ 404).

**A DOUA LECȚIE — „calea rulată ≠ calea din repo" (11 iul).** Chiar și cu VPS-ul sincronizat corect la master + secretul corect, chatul public tot dădea 13s stall+eroare. Dovadă din jurnal: procesul REAL rulat de systemd era `/root/kelion/kelion-bridge.mjs` — **NU** `bridge/kelion-bridge-linux.mjs` din repo. `git reset --hard origin/master` sincronizează REPO-ul, dar systemd rula o **copie separată, în afara repo-ului**, pe care niciun `git reset` n-o atinge. Toate fixurile de cod la worker (sesiuni calde, standby, stall 12s) erau corecte de la început — dar n-au ajuns NICIODATĂ să ruleze pe VPS până la acest fix.
**Fix:** `bridge-deploy.yml` + `pornire-linux.sh` acum citesc calea EXACTĂ din `systemctl show kelion-bridge -p ExecStart` și copiază codul corect exact acolo (indiferent de nume/locație), cu verificare prin marker (`grep warmPub`) ca dovadă că noul cod chiar a ajuns pe disc — nu doar presupunere.
**Regulă pentru orice AI viitor:** un deploy „reușit" pe VPS NU e dovadă că workerul rulează codul nou. Verifică mereu conținutul fișierului de la calea REALĂ din systemd, nu doar starea repo-ului.

## 7. CI/WORKFLOWS (`.github/workflows/`)
- `deploy.yml` — push pe master → Railway (token → proiect „Kelionai", serviciul `web`), verificare prin schimbarea versiunii.
- `deploy-verified.yml` — deploy de pe ramura de lucru la schimbări de cod (aceeași verificare).
- `bridge-deploy.yml` — SINGURA cale spre VPS (workflow_dispatch + parola root; parola se maschează în primul pas din `$GITHUB_EVENT_PATH`).
- `public-latency-test.yml` — test real chat public (demo start + cronometru primul cuvânt) + jurnalele Railway ale turei.
- `railway-deploy-status.yml` — diagnostic doar-citire: sursa serviciului, repoTriggers, ultimele deploy-uri (cine+de ce), build/deploy logs.
- `railway-env-check.yml` — listează NUMELE variabilelor Railway (niciodată valorile). `mail-imap-check.yml` — login IMAP real (Python) la contact@.
- `security-audit.yml`. **Notă:** `workflow_dispatch` merge doar de pe branch-ul default (master); de pe ramuri se declanșează prin `push:` cu filtru de `paths`.
- `read-caiet.yml` — citește caietul + istoricul admin; input opțional `post_content` = Claude scrie DIRECT în caiet (canalul rămas între cei doi AI).
- `vps-keys.yml` — Adrian pune cheile Kimi/GLM pe VPS (mascate). `vps-tier-test.yml` — dovada că rezervele răspund (KIMI OK/GLM OK + markerii pe căile reale).
- `vps-repo-sync.yml` — instalare O DATĂ (parolă): timer systemd pe VPS care aduce `/root/kelion/repo` la zi cu master la 5 min (doar fast-forward, sare dacă constructorul are modificări locale) → AI-HANDOFF.md din capul lui Kelion e mereu proaspăt, fără parolă.

## 8. MEDIU/SECRETE (nume, niciodată valori aici)
**Railway** (serviciul `web`, production) — toate citite în `config.ts`:
`NODE_ENV`, `PORT`, `ADMIN_EMAIL`, `ALLOWLIST`, `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_API_KEY`, `GOOGLE_MAPS_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` (TTS Chirp), `GOOGLE_TTS_API_KEY`, `GOOGLE_TTS_VOICE`, `KELION_GOOGLE_CHIRP_TTS_STYLE`, `SESSION_SECRET`, `DATABASE_URL`, `SERPER_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `BRIDGE_SECRET` (28 car. — aceeași valoare TREBUIE să fie în `/root/kelion/bridge-secret.txt` pe VPS), `MAIL_IMAP_HOST/PORT`, `MAIL_SMTP_HOST/PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FORWARD_TO`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CURRENCY`, `CREDIT_VALUE`, `USD_TO_CURRENCY`, `USER_SHARE`, `DEMO_CAP_PER_DAY`, `DEMO_SECONDS`, `OPEN_SIGNUP`, `AUTONOMY_DAILY_MAX`, `FRONTEND_DIST`, `FRONTEND_ORIGIN`, `KELION_FAST_MODEL` (opțional, §4.3), `KELION_TOP_MODEL` (opțional, §4.3).
`RAILWAY_TOKEN` — DOAR în GitHub Secrets (nu în Railway).
GCloud proiect `gen-lang-client-0460348646` (API-urile Calendar/Gmail/Drive/Tasks/People/TTS trebuie ACTIVATE de Adrian; 403 pe un skill = API dezactivat, nu bug).
**Neconfigurate încă (din STATUS.md, verifică dacă s-au adăugat între timp):** `LIVEKIT_URL/API_KEY/API_SECRET` (full-duplex voice — există „în backup", nu setate), `VITE_GOOGLE_MAPS_KEY` (există „în backup"), **Picovoice** (nedisponibil — wake word merge pe Web Speech interimar).
**VPS:** `/root/kelion/repo` (clona), `/root/kelion/claude.env` (auth CLI), `/root/kelion/bridge-secret.txt`, `/root/kelion/kimi-key.txt` + `/root/kelion/glm-key.txt` (cheile lanțului de rezervă — puse de Adrian prin `vps-keys.yml`, citite de worker la fiecare spawn; lipsesc = treaptă sărită).
**Local:** copiază `backend/.env.example` → `backend/.env` și completează.

## 9. SCHEMA BAZEI DE DATE (Postgres, `db.ts`)
`messages` (istoric chat), `user_prefs` (limbă/meserie/BYOK), `memories` (memorie învățată, per agent), `notes` (notițe explicite), `shared_memory` (caiet comun între cei doi Claude — admin+bridge), `wallets` (credite clienți), `billing_events`, `blocked_users`, `visits`/`demo_uses` (analytics + plafon probă gratuită), `leads` (emailuri lăsate de vizitatori), `contact_messages`, `inbound_emails` (mailbox contact@), `visitor_chats` (chat vizitator↔owner), `capability_gaps` („ce nu știe Kelion să facă" — cu triaj/escaladare), `work_orders` (coada persistentă a constructorului), `staged_releases` (release-uri care așteaptă aprobarea lui Adrian), `admin_pool` (pool provider/finanțe), `app_files`/`app_downloads` (instalatoare + jurnal descărcări), `generated_images`, `google_accounts` (refresh tokens), `cost_events` (cheltuieli reale per apel), `kv_state` (generic key-value, ex. `last_worker_seen`).

## 10. COD VECHI/ARHIVAT — NU LUCRA AICI, NU-L TRATA CA SURSĂ DE ADEVĂR
Era „laptop Windows", înlocuită integral de migrarea pe VPS (9 iul, „Laptop Eliminat" — STATUS.md):
- `bridge/kelion-bridge.mjs` — workerul Windows original (caută `claude.exe` în `APPDATA`, citește secretul din `C:\Users\adria\...`). Predecesorul lui `kelion-bridge-linux.mjs`.
- `bridge/kelion-bridge-hidden.vbs` — lansa ascuns `kelion-bridge.mjs` la login Windows.
- `bridge/kelion-wake-agent.ps1` + `bridge/kelion-wake-launch.cmd` — agent PowerShell pe laptop, rol preluat de `kelion-builder-server.mjs` pe VPS.
- `bridge/kelion-bridge-server.mjs` — prototip timpuriu al workerului VPS, depășit de `kelion-bridge-linux.mjs` (18 commituri de dezvoltare activă vs. o atingere incidentală).
- `bridge/kelion-builder-sdk.mjs` — probă de concept pe `@anthropic-ai/claude-agent-sdk` (5 iul), neatinsă de atunci — păstrată, nu confirmat activă.
- `frontend/src/lib/turnManager.ts` — mașină de stări pentru full-duplex, scrisă dar **niciodată importată** (confirmat: zero referințe în frontend).
- `HANDOFF.md` (rădăcina proiectului) — presupune root Windows `C:\Users\adria\Kelionai`, pre-migrare VPS. **Înlocuit de acest document.**
- `AUDIT-COD-MORT-2026-07-05.md` — raport istoric (5 iul), nu se actualizează; câteva concluzii ale lui sunt deja depășite (`speech-chunk.ts` a devenit activ ulterior).

## 11. DOCUMENTE ÎN REPO — care e sursa de adevăr
| Fișier | Stare | Folosește pentru |
|---|---|---|
| **`AI-HANDOFF.md`** (acesta) | **VIU, sursa principală** | preluare completă, orice AI nou |
| `CLAUDE.md` | viu, scurt | auto-încărcat la fiecare sesiune → trimite aici |
| `STATUS.md` | parțial depășit (9 iul) | istoric de milestone-uri + lista credențialelor neconfigurate (§8) — restul, verifică contra acestui document |
| `HANDOFF.md` | **depășit** (presupune Windows/laptop) | doar valoare istorică |
| `AUDIT-COD-MORT-2026-07-05.md` | **instantaneu istoric** (5 iul) | listă de pornire pentru curățenie, verifică înainte de a acționa (unele concluzii nu mai sunt valide) |
| `README.md` | — | verifică dacă mai e la zi înainte de a te baza pe el |

## 12. COMENZI
```bash
# backend (din backend/)
npm run dev         # tsx watch, :8080
npm run build       # tsc → dist/
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run lint        # oxlint

# frontend (din frontend/)
npm run dev         # vite, :5173
npm run build       # tsc -b && vite build
npm run lint        # oxlint

# worker
node --check bridge/kelion-bridge-linux.mjs

# fluxul de lucru al AI-ului:
# ramură → commit → push → PR → merge în master → deploy automat → VERIFICĂ LIVE
```

## 13. STAREA LA 11 IULIE 2026 + CE URMEAZĂ
- ✅ Live și verificat: setări client (⚙), căutare web max, router model, memorie dublată + căutare full-text reală (LIVE, nu „next"), ora Londrei, QR Linux → `/dl/Kelionai-linux.zip`, deploy-uri anti-fantomă (repo), fixul „calea rulată" (§6, confirmat cu md5 diferit înainte/după + marker `warmPub` pe disc).
- 🟡 **#7 latență — REPARATĂ FUNCȚIONAL, dar NU la ținta „sub 1s".** Adrian a rulat `bridge-deploy` A DOUA oară (07:22, 11 iul), DUPĂ fixul „calea rulată" (#80) — jurnalul confirmă explicit: „MISMATCH găsit — copiat codul corect", md5 diferit, `grep warmPub` OK. Măsurat REAL imediat după: **tura 1 = 3.31s, tura 2 = 3.12s, tura 3 = 2.54s** (de la eșec total 13s+eroare la răspuns funcțional). Progres real și mare, dar ținta de sub 1s NU e atinsă — probabil limită fizică de rețea+model, nu doar cod. Rămâne loc de investigat dacă cineva vrea să împingă mai departe (profilare exactă unde se duc cele ~2.5-3s: rețea vs. gândirea modelului vs. altceva).
- Milestone-uri nepornite: sandbox de cod per user obișnuit (nu doar admin), aplicații native „full packaged" (iOS App Store etc.), Picovoice wake word, LiveKit full-duplex (chei „în backup", neconfigurate), carduri rezultate skill-uri (parțial — `CardView.tsx` există), monetizare completă (Stripe 75/25 există pe webhook), panou admin extins, curățare cod mort (`turnManager.ts` + orice altceva găsit de un audit nou), memorie cu embeddings/AI reale (dincolo de full-text), profilare fină a latenței (§4.4).
- Istoric PR-uri relevante: #72 (fantomă+setări), #73 (router+memorie+stall), #74 (secret VPS+zombie), #75 (standby), #76 (QR Linux), #77 (sesiuni calde per-vizitator + prima bucată instant + ora Londrei), #78/#79 (acest document), #80 (fix cale rulată systemd — CONFIRMAT FUNCȚIONAL), #81 (memorie full-text), #82 (acest document, runda 2).
- 🤝 **PARITATE KELION = CLAUDE (ordinul lui Adrian, 11 iul: „identic ca tine, absolut toate").** Kelion are aceleași unelte, în repo (proaspete prin repo-sync, executabile direct): **`/root/kelion/repo/bridge/claude-munca`** — ORICE spawn de agent de muncă (cercetător, navigator, orice) pornește prin el: Kimi→GLM, niciodată Max, model implicit `kimi-for-coding`, rulează din repo deci are automat CLAUDE.md→AI-HANDOFF (toată cunoașterea); **`bridge/kelion-github`** — PR, merge, `deploy` (declanșează `deploy.yml` + verificare anti-fantomă: versiunea TREBUIE să se schimbe), `runs`; cere `/root/kelion/github-token.txt` (Adrian, prin vps-keys); **`bridge/kelion-monitor`** — un pas = un apel: linia pe monitor + procentul; ce nu e pe monitor NU există. REGULI DE FIER pentru Kelion: niciodată `railway up` direct (doar `kelion-github deploy`); niciodată editare de fișiere pe VPS în afara repo-ului (doar branch→PR→merge); niciodată diagnostic din memorie — verifică LIVE întâi (git blame, curl, jurnale); dovada înainte de afirmație, întotdeauna.
- 🏗️ **Constructorul (kelion-builder) NU mai muncește pe Max (11 iul, schimbare de logică ordonată de Adrian): Max = DOAR chatul adminului + demo; MUNCA (reparațiile) = Kimi (primar) → GLM (secundar)**, cu revenire automată la 30 min și avarie zgomotoasă pe Max doar dacă nu există NICIO cheie pe disc. `bridge-deploy.yml` sincronizează acum și calea reală systemd a constructorului (marker „MOTORUL DE LUCRU"). Ambele env-uri de rezervă șterg `CLAUDE_CODE_OAUTH_TOKEN` (blindare: CLI-ul să nu poată ocoli cheia și munci pe furiș pe Max). Dovadă chei+endpoint-uri: rularea `vps-tier-test` #1 („KIMI OK", „GLM OK").
- 🔗 **Lanțul de abonamente în worker (11 iul, ordinul lui Adrian): Claude Max → Kimi for Coding → GLM Coding Plan.** Workerul comută automat pe treapta următoare când CLI-ul raportează cotă golită (DOAR pe canalele de eroare — stderr / `result` cu `is_error`, niciodată pe text normal) și revine singur pe Max după 30 min (Max se reîncearcă primul la fiecare spawn). Cheile: fișiere pe VPS (§8), puse prin `vps-keys.yml` — fără chei, codul e inert, comportamentul de azi. Kimi: base `https://api.kimi.com/coding/`, model fix `kimi-for-coding` (docs oficiale kimi.com/code). GLM: base `https://api.z.ai/api/anthropic`, numele de model claude e mapat de endpoint-ul lor. Deploy pe VPS: DOAR prin `bridge-deploy.yml` (parola lui Adrian) — de verificat live la prima golire reală de cotă.
- ⛔ **Canalul de echipă (PR #85–#90) — CONSTRUIT ȘI SCOS INTEGRAL în aceeași zi (11 iul), la ordinul lui Adrian**, după un incident de cost: fiecare mesaj „către kelion" declanșa `bridgeAsk` (abonamentul personal al lui Adrian), iar un bug de afișare în tab (poll-ul re-adăuga tot firul la fiecare 4s — closure învechit pe `teamMsgs`) arăta ca o buclă de trimitere continuă. Tabelul `team_channel` rămâne în Postgres cu datele lui, dar NICIUN cod nu-l mai atinge. NU reconstrui feature-ul fără ordin explicit de la Adrian.

## 14. CUM VERIFICI CĂ TOTUL E SĂNĂTOS (60 de secunde)
```bash
curl -s https://kelionai.app/api/version            # {v,at} cu boot recent
curl -s https://kelionai.app/health                 # 200
curl -s https://kelionai.app/api/dev/status         # bridge:true, lanes>0, srv raportează
curl -s -o /dev/null -w '%{http_code}' -X POST https://kelionai.app/api/me/delete   # 401 (nu 404)
# chat public real: workflow public-latency-test (demo de pe runner) — primul cuvânt rapid, nu 12s+eroare
```
