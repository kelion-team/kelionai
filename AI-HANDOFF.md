# KELIONAI — DOCUMENT COMPLET DE PRELUARE PENTRU ORICE AI
*(actualizat 11 iulie 2026 — dacă deschizi acest fișier ca AI nou, aici ai TOT ce trebuie ca să lucrezi imediat)*

## 0. Ce este proiectul
**Kelionai** = asistent AI live la **https://kelionai.app**: avatar 3D (Ready Player Me),
voce hands-free (wake word „Hey Kelion", TTS Chirp 3 HD, barge-in), vedere prin cameră,
GPS, 14 skill-uri Google/tool-use, chat multilingv. Proprietar unic + singurul admin:
**Adrian — adrianenc11@gmail.com**.

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

## 2. ARHITECTURA
```
[Browser: React+Vite+TS]  ⇄  [Backend: Node+Fastify+TS pe Railway]  ⇄  [Postgres pe Railway]
        │                             │
        │                             ⇅ (punte HTTP long-poll, secret partajat)
        │                     [VPS Linux 164.68.120.87: worker `claude` CLI pe
        │                      abonamentul lui Adrian + paznic + builder + deployer]
        └── PWA/TWA/instalatoare = învelișuri live peste kelionai.app
```
- **Frontend** `frontend/`: UI principal `src/components/ChatPanel.tsx`, scena 3D `src/pages/Stage.tsx`, landing+QR `src/pages/Landing.tsx`, voce `src/lib/voice.ts`, audio `src/lib/audioIO.ts` (anti-ecou: `VOICE_GAP_MS=1800` ține microfonul mut între propozițiile rostite — NU strica asta), versiune/update `src/lib/updateCheck.ts` (sursa UNICĂ a etichetei de versiune: filigran + sub QR; ora Londrei), setări client `src/components/CustomerSettings.tsx` (⚙: Preferințe, Credit cu mențiunea 25%, BYOK, Cont+ștergere), admin `src/components/AdminPanel.tsx` („Vezi chat" per user, „Tradu în română", Inbox live).
- **Backend** `backend/src/`: rute în `routes/` — `chat.ts` (creierul: rutare admin→punte, public→punte, clienți→API; vocea din prima frază `createVoiceStream`; guardian de limbă; tool-use loop), `bridge.ts` (puntea: coadă joburi, `pull/ack/reply/reply-chunk`, `authed()` cu log de nepotrivire), `auth.ts` (Google OAuth, allowlist), `admin.ts`, `prefs.ts` (limbă/meserie/BYOK), `billing.ts` (credite Stripe), `me.ts` (auto-ștergere cont), `demo.ts`. Servicii în `services/`: `google.ts` (toate skill-urile + `webSearch` îmbogățit: knowledge graph, PAA, știri, related), `modelRouter.ts` (§4.3), `agents.ts` (memorie: recall + learn), `mailbox.ts` (contact@ + Inbox live), `lang.ts`, `tts.ts`+`pronounce.ts` (mod academic), `stripe.ts`.
- **Puntea/VPS** `bridge/kelion-bridge-linux.mjs`: worker pe abonament; benzi separate admin/public (max 2 fiecare); sesiune caldă admin (`WARM_MAX_TURNS=8`); **sesiuni calde per-vizitator** (`warmPub`, plafon 6, LRU, stingere 10 min); **procese de gardă publice** (standby ×2, pre-pornite); puls la 3s; prima bucată de text pleacă instant. Alte fișiere: `repair.sh` (auto-reparare ANCORATĂ la origin/master + push în master la succes), `pornire-linux.sh` (sincronizare forțată la master), servicii systemd: `kelion-bridge`, `kelion-paznic`, `kelion-builder`, `kelion-deployer`.

## 3. RUTAREA CREIERULUI (cine răspunde cui) — chat.ts
- **Admin (Adrian)** → puntea (worker `claude` pe VPS = echivalent Claude Code, cu context privat + memorie + fișiere). Punte jos → mesaj cinstit (NU cădea pe API — ordin).
- **Vizitatori/demo/public** → puntea, banda `public`, personaj neutru `PUBLIC_PREAMBLE`, FĂRĂ context privat, cwd `/tmp`; demo = anonim (fără memorie/istoric injectat). Punte jos → mesaj cinstit (NU API — ordin: „peste tot abonamentul mare").
- **Clienți plătitori** (credite `paysOwnWay` sau cheia lor BYOK) → API Anthropic direct, cu tool-uri complete. Cheia clientului NU cade NICIODATĂ pe cheile platformei.
- Joburile publice cer capabilitatea `persona` declarată de worker la `pull` (gard anti-scurgere); jobul public poartă `turn` (pachet subțire) + `visitor` (cheia sesiunii calde per-vizitator).

## 4. SISTEME CHEIE
### 4.1 Memoria (dublată, #20)
Tabel `memories` (namespace per agent). `recallMemories` (DB pur, în paralel — zero latență) injectat în system prompt; `learnFromTurn` (Haiku, fire-and-forget) învață fapte; **tool-uri pentru TOȚI userii**: `list_memories` („ce știi despre mine?"), `forget_memory` („uită că…" → `deleteMemory` ILIKE); **continuitate**: pauză >45 min → prompt de „reîntâlnire". Notițe explicite = tabel separat (`save_note`/`list_notes`/`delete_note`).
### 4.2 Limbă
Admin blocat `ro-RO` (`adminLocked` în chat.ts). Restul: detecție deterministă server (`services/lang.ts`, comitere după 2 mesaje consecutive), guardian care re-servește o singură dată la limbă greșită. Mod academic: registru + pronunție acronime (`pronounce.ts`, `academicPronounce`).
### 4.3 Router model (capabilitate↔cost)
`services/modelRouter.ts`: `MODEL_FAST` (env `KELION_FAST_MODEL`, azi `claude-fable-5`) / `MODEL_TOP` (env `KELION_TOP_MODEL`, azi `claude-opus-4-8`). `taskDifficulty()` euristic (0 cost) + **marjă +10%** → `chooseModel` ia cel mai IEFTIN model care acoperă necesarul; eșec/refuz pe FAST → re-servit pe TOP + odihnă 10 min. Model nou în viitor = setezi variabila în Railway, intră instant fără deploy. Teste: `backend/src/modelRouter.test.ts`.
### 4.4 Latență (#7)
Server: stall punte public 12s (era 45s); voce din prima frază; recall DB în paralel. Worker: standby ×2 + sesiuni calde per-vizitator + prima bucată instant + puls 3s. Țintă: tura 1 ~1–2s, turele 2+ <1s. Măsurătoare: workflow `public-latency-test` (sesiune demo reală de pe runner, IP proaspăt) sau scriptul din scratchpad.
### 4.5 Căutare web (#12)
`webSearch` în `google.ts`: Serper cu answerBox + knowledgeGraph + peopleAlsoAsk + topStories/news + relatedSearches, 8 (max 12) rezultate; fallback Gemini grounded search. Cost: `SERPER_USD_PER_CALL`.

## 5. BANII (nu confunda portofelele!)
| Portofel | Cine consumă | Unde se vede/încarcă |
|---|---|---|
| **Abonamentul Claude al lui Adrian (Max 20x)** + usage credits | Claude Code (sesiunile de lucru) + puntea VPS (chat admin + public/demo) | claude.ai → Settings → Usage |
| **Cheia API platformă** (`ANTHROPIC_API_KEY` în Railway) | clienții plătitori fără BYOK | console.anthropic.com → Billing |
| **Cheia clientului (BYOK)** | doar acel client | contul lui |
| **Portofelele clienților în app** (Stripe) | creditele lor de chat; **din fiecare reîncărcare 75% credit client, 25% platformă** | kelionai.app (billing.ts, webhook `/api/credits/webhook`) |

## 6. DEPLOY — LECȚIA CRITICĂ „DEPLOY FANTOMĂ" (10 iul)
**Simptom:** GitHub zicea „success", producția rămânea pe build vechi (rute noi 404).
**Cauze reale găsite:** (a) verificarea veche se uita doar la `/health=200`, care venea de la containerul VECHI; (b) VPS-ul divergase (commituri locale de auto-reparare) și publica cod vechi peste cel corect; (c) `bridge-secret.txt` de pe VPS avea un secret VECHI (64 car. vs 28 în Railway) → serverul respingea workerul nou (`auth fail: header 64 chars vs secret 28`), iar un **worker zombie** (secret bun, fără `persona`) ținea becul verde cu banda publică moartă.
**Fixuri permanente:** `deploy.yml` (push pe master) verifică acum că **`/api/version` s-a SCHIMBAT** față de dinainte; `repair.sh`/`pornire-linux.sh` ancorate la `origin/master` (reparațiile reușite se ÎMPING în master); `bridge-deploy.yml` (manual, cere parola root VPS ca input mascat) sincronizează VPS-ul la master + **scrie secretul corect din Railway în `/root/kelion/bridge-secret.txt` (prin stdin)** + omoară zombie + repornește serviciile.
**Verificare după ORICE deploy:** `curl https://kelionai.app/api/version` (formă `{v,at}`, `v` = boot nou) + o rută nouă relevantă (401/403 ≠ 404).

## 7. CI/WORKFLOWS (`.github/workflows/`)
- `deploy.yml` — push pe master → Railway (token → proiect „Kelionai", serviciul `web`), verificare prin schimbarea versiunii.
- `deploy-verified.yml` — deploy de pe ramura de lucru la schimbări de cod (aceeași verificare).
- `bridge-deploy.yml` — SINGURA cale spre VPS (workflow_dispatch + parola root; parola se maschează în primul pas din `$GITHUB_EVENT_PATH`).
- `public-latency-test.yml` — test real chat public (demo start + cronometru primul cuvânt) + jurnalele Railway ale turei.
- `railway-deploy-status.yml` — diagnostic doar-citire: sursa serviciului, repoTriggers, ultimele deploy-uri (cine+de ce), build/deploy logs.
- `railway-env-check.yml` — listează NUMELE variabilelor Railway (niciodată valorile). `mail-imap-check.yml` — login IMAP real (Python) la contact@.
- `security-audit.yml`. **Notă:** `workflow_dispatch` merge doar de pe branch-ul default (master); de pe ramuri se declanșează prin `push:` cu filtru de `paths`.

## 8. MEDIU/SECRETE (nume, niciodată valori aici)
Railway (serviciul `web`, production): `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID/SECRET`, `GOOGLE_REDIRECT_URI`, `SESSION_SECRET`, `DATABASE_URL`, `SERPER_API_KEY`, `GOOGLE_SERVICE_ACCOUNT_JSON` (TTS Chirp), `GEMINI_API_KEY`, `BRIDGE_SECRET` (28 car. — aceeași valoare TREBUIE să fie în `/root/kelion/bridge-secret.txt` pe VPS), `MAIL_*` (privateemail.com, contact@kelionai.app), `STRIPE_*`, `RAILWAY_TOKEN` doar în GitHub Secrets. GCloud proiect `gen-lang-client-0460348646` (API-urile Calendar/Gmail/Drive/Tasks/People/TTS trebuie ACTIVATE de Adrian; 403 pe un skill = API dezactivat, nu bug).
VPS: `/root/kelion/repo` (clona), `/root/kelion/claude.env` (auth CLI), `/root/kelion/bridge-secret.txt`.

## 9. COMENZI
```bash
# local
cd backend  && npm run dev      # :8080      | npx tsc --noEmit | npx vitest run
cd frontend && npm run dev      # :5173      | npx tsc -b && npx vite build
node --check bridge/kelion-bridge-linux.mjs
# fluxul de lucru al AI-ului: ramură → commit → push → PR → merge în master → deploy automat → VERIFICĂ LIVE
```

## 10. STAREA LA 11 IULIE 2026 (dimineața) + CE URMEAZĂ
- ✅ Live și verificat: setări client (⚙), căutare web max, router model, memorie dublată, stall 12s, ora Londrei, QR Linux → `/dl/Kelionai-linux.zip`, deploy-uri anti-fantomă. QR-uri: win → `Kelionai-Setup.exe` (NSIS real), apk → APK real (TWA), ios → site (PWA, fără App Store nu se poate altfel), play → Play Store.
- 🔴 **ÎN AȘTEPTARE: o rulare `bridge-deploy` de către Adrian (parola root VPS)** — activează pe VPS: secretul corect + vânarea zombie-ului + workerul nou (standby + sesiuni calde per-vizitator). Fără ea, **chatul public/demo e MORT** (stall 12s → mesaj de eroare). După rulare: rulează `public-latency-test` și pune dovada <1s în tabelul de capabilități.
- Milestone-uri nepornite: sandbox de cod per user obișnuit, aplicații native „full packaged" (iOS App Store etc.), Picovoice wake word, LiveKit full-duplex, carduri rezultate skill-uri, monetizare completă (Stripe 75/25 există pe webhook), panou admin extins.
- Istoric PR-uri relevante: #72 (fantomă+setări), #73 (router+memorie+stall), #74 (secret VPS+zombie), #75 (standby), #76 (QR Linux), #77 (sesiuni calde per-vizitator + prima bucată instant + ora Londrei).

## 11. CUM VERIFICI CĂ TOTUL E SĂNĂTOS (60 de secunde)
```bash
curl -s https://kelionai.app/api/version            # {v,at} cu boot recent
curl -s https://kelionai.app/health                 # 200
curl -s https://kelionai.app/api/dev/status         # bridge:true, lanes>0, srv raportează
curl -s -o /dev/null -w '%{http_code}' -X POST https://kelionai.app/api/me/delete   # 401 (nu 404)
# chat public real: workflow public-latency-test (demo de pe runner) — primul cuvânt rapid, nu 12s+eroare
```
