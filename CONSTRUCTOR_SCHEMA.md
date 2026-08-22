# SCHEMĂ CONSTRUCTOR — Kelionai

> Fișier de referință pentru constructorul autonom (Devin/Aider/motor extern) și pentru orice AI care lucrează în repo.
> Acesta NU înlocuiește `AI-HANDOFF.md`, `CLAUDE.md` sau `AGENTS.md` — le completează cu o vedere de ansamblu.
> Ultima actualizare: 22 aug 2026.

## 1. CE ESTE KELIONAI

- **Kelionai** = asistent AI live la `https://kelionai.app`.
- **Stack:**
  - Frontend: React + Vite + TypeScript (`frontend/`)
  - Backend: Node.js + Fastify + TypeScript (`backend/`)
  - Baza de date: Postgres pe același VPS (`backend/src/db.ts`)
  - Gazdă: VPS Contabo `164.68.120.87`, Docker + Caddy (vezi `deploy/Dockerfile`, `deploy/Caddyfile`, `deploy/deploy.sh`)
  - Deploy: GitHub → master → cron VPS `deploy/auto-publicare.sh` → `deploy/deploy.sh` (GitHub Actions sunt morți din cauza facturării)
- **Proprietar unic și admin:** Adrian (adrianenc11@gmail.com). Răspunsul în chat este în română.

## 2. ARHITECTURĂ DE ANSAMBLU

```
[Browser PWA/TWA]  ⇄  [Backend Fastify pe :8080]  ⇄  [Postgres :5432]
                            │
                            └─ [VPS host: worker constructor, cron deploy, Caddy]
```

- **Frontend** rulează în browser. Este PWA (service worker în `frontend/public/sw.js`).
- **Backend** rulează în Docker pe VPS, expus prin Caddy la `kelionai.app`.
- **Constructorul** va rula pe host-ul VPS (nu în container), direct în repo-clonă `/root/kelion/atelier`.
- **Monitorare live:** `GET /api/version` întoarce `GIT_COMMIT_SHA` (anti-fantomă) și `GET /api/health` este bătăia de inimă.

## 3. FRONTEND (`frontend/src/`)

### Pagini principale
| Fișier | Rol |
|---|---|
| `pages/Stage.tsx` | Scena 3D + UI principal; aici își are sediul chat-ul, avatarul și admin bar |
| `pages/Landing.tsx` | Site public, QR-uri, salut avatar |

### Componente și lib-uri cheie
| Fișier | Rol |
|---|---|
| `components/ChatPanel.tsx` | Panou chat (text + voce) |
| `components/AdminPanel.tsx` | Panou admin: useri, finanțe, inbox, traducere, amprente vocale |
| `components/AvatarModel.tsx` | Avatar 3D Ready Player Me; GESTURILE sunt clipuri (`/anim/`), fără animație procedurală |
| `components/CameraView.tsx` | Ochii lui Kelion (ascuns, low-light boost) |
| `lib/chat.ts` | Streaming, reluare după pauză, ceas de gardă 50s, diagnostic conexiune |
| `lib/audioIO.ts`, `lib/micStream.ts`, `lib/utteranceCoalescer.ts` | Calea vocală (wake, dictare, coalescare 900ms) |
| `lib/i18n.ts` | 7 limbi UI + copy pentru `offline`, `brainNotActive`, etc. |
| `lib/updateCheck.ts` | Verifică versiunea live, curăță cache-uri, gestionează service worker |
| `public/sw.js` | Service Worker PWA |

## 4. BACKEND (`backend/src/`)

### Rute principale
| Fișier | Rute | Rol |
|---|---|---|
| `routes/chat.ts` | `/api/chat` | Creierul: chat, tool loop, rutare admin/public/client, limbă, voce |
| `routes/constructor.ts` | `/api/constructor/*` | Coadă ordine, next, ajutor, raport, tool-defs pentru constructor |
| `routes/bridge.ts` | `/api/bridge/*`, `/api/admin/*` | Job queue, release alerts, client errors |
| `routes/voiceprint.ts` | `/api/voiceprint/*` | Amprentă vocală, identificare |
| `routes/auth.ts` | `/api/auth/*` | Google OAuth |
| `routes/admin.ts` | `/api/admin/*` | Panou admin |
| `routes/billing.ts` | `/api/billing/*` | Stripe credits, webhook 75/25 |
| `routes/a2a.ts` | `/api/a2a/*` | Cei 33 de agenți specialiști |
| `routes/tts.ts` | `/api/tts` | Google Chirp 3 HD |
| `routes/asr.ts` | `/api/asr` | Google STT v2 (dictare) |

### Servicii cheie
| Fișier | Rol |
|---|---|
| `services/brainToolDefs.ts` | TOATE uneltele lui Kelion (`build_software`, `ruleaza_portile`, `system_health`, etc.) |
| `services/brainContract.ts` | Contract de mesaje/tool-uri pentru orice creier |
| `services/modelRouter.ts` | Alegere model după capabilitate/cost |
| `services/geminiDirect.ts` | Client Gemini (creierul unic după 22 iul) |
| `services/google.ts` | Skill-uri Google + web search (Serper) |
| `services/agents.ts` | Memorie: `recallMemories`, `learnFromTurn` |
| `services/agentiKelion.ts` | Rosterul celor 33 de agenți A2A |
| `services/autonomie.ts` | Executorul uneltelor comune (pentru chat și constructor) |
| `services/selfHeal.ts` | Autonomie reparație: înregistrează simptome → ordine `build_software` |
| `services/evalOrdinConstructor.ts` | Poarta calității ordinelor pentru constructor |
| `services/creierRationament.ts` | Planificare pași pentru constructor |
| `services/constructorProtocol.ts` | Protocol structurat de fișiere/operații pentru constructor |
| `services/poartaFaptelor.ts` | Detector de "minciuni" — când AI spune că a făcut ceva fără să fi chemat unealtă |

## 5. BAZA DE DATE

- **Motor:** Postgres 16.
- **Conexiune:** `DATABASE_URL` din `kelionai.env`.
- **Tabele cheie:** `users`, `memories`, `notes`, `build_jobs`, `work_orders`, `client_errors`, `sessions`, `voiceprints`, `payments`, `credits`, `a2a_agents`.
- **Schema exactă și migrațiile:** `backend/src/db.ts`. Nu există un ORM clasic; interogările sunt SQL direct cu verificări.

## 6. CONSTRUCTORUL / AUTONOMIE

### Flux curent (în curs de rescriere)
1. Ownerul cere în chat: "repară X" sau "adaugă Y".
2. Kelion cheamă unealta `build_software` (definită în `brainToolDefs.ts` și executată în `autonomie.ts`).
3. `build_software` validează ordinul prin `evalOrdinConstructor.ts` și creează un rând în tabelul `build_jobs`.
4. Cron VPS `deploy/constructor-worker.sh` la fiecare 2 minute rulează `deploy/constructor-agent.mjs`.
5. Workerul ia un ordin din `/api/constructor/next` (gătat cu `x-bridge-secret`).
6. **NOU (țintă):** va rula **Devin CLI** pe repo-ul clonat în `/root/kelion/atelier`, în loc de Aider + Ollama.
7. Devin editează, rulează porțile, face commit, push branch `kelion/job-<id>` și deschide PR.
8. `deploy/porti-pr.sh` rulează porțile reale și auto-merge pe verde pentru ramuri `kelion/job-*`.
9. `deploy/auto-publicare.sh` compară live vs master, rulează `deploy/deploy.sh` și verifică `/api/version`.

### Porți obligatorii (trebuie să treacă înainte de PR)
- tipuri: `npx tsc --noEmit` (backend) și `npx tsc -b` (frontend)
- teste: `npx vitest run` (backend)
- sintaxă: `node scripts/verifica-sintaxa.mjs`
- hardcodări: `node scripts/verifica-hardcodari.mjs`
- build frontend: `npm run build` în `frontend/`
- lacăte: `backend/src/lacat.test.ts` (protejează lucruri care merg)

## 7. ONLINE / OFFLINE

Aplicația este o **PWA**. Comportamentul la conexiune e măsurat, nu inventat:

| Stare | Cine o detectează | Ce se întâmplă |
|---|---|---|
| `offline` | `navigator.onLine === false` în `frontend/src/lib/chat.ts` (`diagnozaConexiune`) | Browserul raportează că nu are rețea. Chat-ul arată mesajul `offline` din `i18n.ts` și intră în mecanism de reluare. |
| `server_down` | Fetch la `/api/health` fără răspuns, dar `navigator.onLine` e `true` | Rețeaua e bună, dar serverul e jos (deploy/restart/crash). NU se afișează "fără internet", ci se încearcă reluarea. |
| `transient` | Un singur fetch pică, dar `/api/health` răspunde | Eșec punctual. Nu se schimbă starea globală. |

### Reguli pentru constructor (să nu strice online/offline)
- Nu modifica `/api/health` să depindă de ceva greu sau instabil — trebuie să răspundă rapid și mereu cât backendul e viu.
- Nu strica `public/sw.js` sau logica de înregistrare a service workerului din `updateCheck.ts`.
- `frontend/src/lib/errorReport.ts` colectează erori și le trimite când e online — nu lăsa înregistrarea să pice când e offline.
- Textul pentru offline este în `i18n.ts` sub cheia `offline` și e tradus în toate limbile. Dacă schimbi mesajul, actualizează toate limbile.
- La reluare, `chat.ts` restabilește sesiunea. Nu adăuga delay-uri artificiale pe calea de reluare.

## 8. VARIABILE DE MEDIU CHEIE (doar nume — valorile vin din `kelionai.env`)

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_EMAIL`
- `GEMINI_API_KEY` (creier aplicație)
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- `GOOGLE_TTS_API_KEY`, `GOOGLE_API_KEY`
- `SERPER_API_KEY`
- `STRIPE_PUBLISHABLE_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- `BRIDGE_SECRET` (punte worker↔app)
- `GITHUB_TOKEN` (constructor)
- `VPS_SSH_KEY`, `VPS_HOST` (pentru operațiuni VPS manuale)
- `WINDSURF_API_KEY` / `DEVIN_API_KEY` (pentru viitorul Devin CLI constructor)

## 9. REGULI DE FIER PENTRU ORICE MODIFICARE

1. **Producția = master** — orice merge în master se publică automat.
2. **Nicio publicare fără PR + merge** — nu face push direct pe master.
3. **După orice fix: build → deploy → verificare LIVE** (`curl https://kelionai.app/api/version`, `/api/health`).
4. **Nu există "gata" fără dovadă măsurată.**
5. **LEGEA ANTI-HARDCODARE** — nicio cifră de bani, prag, tarif, nume de model, stare arătată omului, scrisă de mână în cod. Totul din config/env/DB. Poarta: `node scripts/verifica-hardcodari.mjs`.
6. **Nu atinge `C:/Users/adria/Downloads/k`** — e proiectul vechi arhivat.
7. **Nu șterge/throttle ce merge** fără argument verificabil și acord explicit.
8. **Nu modifica cheile/rutarea pe abonament pentru admin și demo** fără acord.

## 10. CE SĂ CITEASCA CONSTRUCTORUL ÎNAINTE SĂ LUCREZE

- `CONSTRUCTOR_SCHEMA.md` (acest fișier) — vedere de ansamblu.
- `AI-HANDOFF.md` — starea exactă, istoric decizii, TODO live.
- `CLAUDE.md` / `AGENTS.md` — regulile de interacțiune pentru orice AI.
- `RAMAS-DE-FACUT.md` — ce NU merge / ce e de făcut, cu dovezi.
- `backend/src/services/brainToolDefs.ts` — uneltele disponibile.

## 11. DEPLOY ȘI VERIFICARE

- `deploy/deploy.sh` — imagine Docker, container, Caddy, cronuri.
- `deploy/auto-publicare.sh` — verifică `origin/master` vs live și declanșează `deploy.sh`.
- `deploy/porti-pr.sh` — porți reale + auto-merge pe ramuri `kelion/job-*`.
- Verificare finală: `curl https://kelionai.app/api/version` trebuie să întoarcă SHA-ul nou; `curl https://kelionai.app/api/health` = 200.
