# API și structură UI — Kelion

## Scop și surse
Acest document este o hartă statică a codului din checkout-ul curent. Nu confirmă starea live a VPS-ului și nu înlocuiește verificarea live prin `/api/version` și endpointurile de health.

Sursele principale:

- `backend/src/index.ts` — compunerea serverului Fastify, middleware-ul global și înregistrarea modulelor de rute;
- `backend/src/routes/` — contractele HTTP și WebSocket;
- `frontend/src/main.tsx` — bootstrap React;
- `frontend/src/App.tsx` — sesiune, poartă de consimțământ, rutare și actualizare client;
- `AI-HANDOFF.md` — arhitectura și starea de predare a proiectului.

## Arhitectura runtime

```text
Browser / PWA / shell desktop sau mobil
  -> frontend React + Vite
  -> backend Fastify
  -> PostgreSQL, servicii Google, worker-e VPS și procese de deploy
```

Imaginea Docker construiește frontend-ul, compilează backend-ul și pornește `backend/dist/index.js`. În producție, Fastify servește atât API-ul, cât și build-ul static al SPA-ului.

## API fundamentale

### Operațiuni și versiune

- `GET /health` — healthcheck simplu.
- `GET /api/health` — alias pentru verificarea de conectivitate a clientului.
- `GET /api/version` — versiunea/stampila instanței care rulează; folosită de client pentru detectarea unui deploy nou.
- `GET /dl/:file` — distribuie instalatoare și pachete generate, cu validare a numelui de fișier.

### Autentificare și sesiune

Modul: `backend/src/routes/auth.ts`

- `GET /auth/google/login` — începe autentificarea Google OAuth.
- `GET /auth/google/callback` — schimbă codul OAuth, validează starea și setează sesiunea.
- `GET /auth/google/connect` — consimțământ incremental pentru serviciile Google.
- `GET /auth/google/connect-youtube` — consimțământ incremental pentru încărcare YouTube.
- `GET /auth/google/connect-business` — consimțământ incremental pentru Business Profile.
- `GET /auth/signup-status` — expune starea porții de înscriere.
- `GET /auth/me` — întoarce identitatea de browser și starea conectării Google, fără tokenuri OAuth.
- `POST /auth/logout` — șterge cookie-ul de sesiune.

Sesiunea este verificată de fiecare rută care lucrează cu datele sau capabilitățile unui utilizator.

### Chat

Modul: `backend/src/routes/chat.ts`

- `POST /api/chat` — ruta centrală pentru mesaje text, audio, imagini și context de cameră, ecran, poziție sau voce; răspunde prin stream.
- `GET /api/chat/history` — întoarce istoricul recent al utilizatorului autentificat.
- `GET /api/chat/resume` — reia un stream întrerupt folosind Server-Sent Events și `Last-Event-ID`.

Ruta de chat impune autentificare, validează mesajele și are limite proprii de body/rate limit pentru conținut media.

### Voce și audio

Module: `tts.ts`, `asr.ts`, `vocalLive.ts`, `realtime.ts`

- `GET /api/tts/status` — disponibilitatea motorului TTS și limita publică de text.
- `POST /api/tts` — sinteză vocală pentru utilizator autentificat.
- `POST /api/asr` — transcriere audio și detecția limbii.
- `GET /api/vocal-live/stare` — puls numeric al subsistemului vocal.
- `GET /api/vocal-live/capability` — disponibilitatea modului vocal live.
- `GET /api/vocal-live` — WebSocket pentru sesiunea vocală live.
- `POST /api/realtime/tick` — contabilizarea unei sesiuni vocale.
- `POST /api/realtime/transcript` — ancorarea limbii și verificarea amprentei vocale.
- `POST /api/realtime/session` — răspunde explicit că vechea sesiune realtime este dezactivată.

### Preferințe, profil și facturare

Modulele `prefs.ts`, `me.ts`, `billing.ts` și `voiceprint.ts` acoperă:

- preferințele utilizatorului;
- gestionarea sau ștergerea contului;
- înscrierea și verificarea amprentei vocale;
- creditele, plățile și starea de facturare.

Aceste rute sunt separate de fluxul principal de chat pentru a păstra contractele de identitate, media și plată distincte.

### Administrație

Modul: `backend/src/routes/admin.ts`

Suprafața `/api/admin/*` gestionează starea de administrare, activitatea, auditul, utilizatorii, finanțele, inboxul, cerințele, autonomia și setările. În `backend/src/index.ts`, un hook global cere o sesiune admin și, când lock-ul este armat, un unlock separat.

Rutele de unlock sunt excepțiile controlate:

- `GET /api/admin/unlock/status`
- `POST /api/admin/unlock`
- `POST /api/admin/unlock/secret`

### Constructor

Modul: `backend/src/routes/constructor.ts`

Suprafața constructorului separă panoul admin de workerul VPS:

- `POST /api/admin/constructor` — validează și pune un ordin în coadă.
- `POST /api/admin/constructor/evalueaza` — evaluează cerința înainte de trimitere.
- `GET /api/admin/constructor` — citește coada și probele motoarelor.
- `GET /api/constructor/next` — workerul autorizat preia următorul job.
- `POST /api/constructor/progress` — workerul raportează progresul.
- `GET /api/constructor/live` — panoul citește joburile și progresul live.
- `GET /api/constructor/creier-config` și `GET /api/constructor/tool-defs` — configurare și unelte pentru worker.
- `POST /api/constructor/tool` — execută o unealtă prin canalul workerului.

Rutele consumate de worker sunt protejate de secretul bridge, nu sunt API-uri publice de browser.

### Deploy

Modul: `backend/src/routes/deploy.ts`

- `GET /api/deploy/progress` — starea curentă ca JSON.
- `GET /api/deploy/status` — stream SSE cu progres.
- `POST /api/deploy/progress` — actualizare din procesul autorizat de deploy.

Actualizarea progresului cere autentificare de bridge; UI-ul poate afișa starea, nu o poate declara reușită.

## Compoziția UI

### Bootstrap

`frontend/src/main.tsx`:

1. pornește raportarea erorilor client;
2. încarcă stilurile globale;
3. montează `<App />` în elementul `#root`.

### Responsabilitățile `App.tsx`

`App.tsx` este coordonatorul global al clientului:

- citește sesiunea prin `fetchMe()` (`/auth/me`);
- pornește watchdog-ul UI;
- citește periodic versiunea serverului;
- blochează aplicația și aplică resetarea la detectarea unui deploy nou;
- cere consimțământ foto înainte de ecranele care pot folosi camera;
- alege pagina din `window.location.pathname`.

Nu folosește React Router; ruta este selectată direct din pathname.

### Pagini încărcate leneș

- `Landing` — pagina publică.
- `Login` — autentificare.
- `Credits` — credite și plată.
- `Manual` — documentație publică.
- `Stage` — aplicația autentificată, inclusiv scena 3D, avatarul, chatul, vocea și panourile asociate.

### Componente globale din `App.tsx`

- `DynamicBackground` — fundal comun al experienței.
- `ConsimtamantFoto` — poarta de consimțământ pentru cameră.
- indicatorul de versiune — dovada vizibilă a versiunii încărcate.
- poarta de update — overlay blocant în timpul tranziției la o versiune nouă.

### Decizia de afișare

```text
/manual                 -> Manual
/credite sau /credits   -> Credits
utilizator autentificat -> Stage
/login                  -> Login
alt caz                 -> Landing
```

`/manual` și rutele de credit rămân accesibile înainte de consimțământul foto. Celelalte rute trec prin poarta de consimțământ.

## Fluxuri principale

### Login

```text
Landing sau Login
  -> /auth/google/login
  -> Google OAuth
  -> /auth/google/callback
  -> cookie de sesiune
  -> /auth/me
  -> Stage
```

### Chat

```text
Stage / ChatPanel
  -> POST /api/chat
  -> validare sesiune și context
  -> servicii de creier, memorie și unelte
  -> răspuns streamuit către interfață
```

### Constructor

```text
Admin Panel
  -> POST /api/admin/constructor
  -> coada de joburi
  -> worker VPS: GET /api/constructor/next
  -> progres / raport / PR
  -> panou: GET /api/constructor/live
```

## Menținere

Actualizează acest document când se schimbă contractul endpointurilor sau compoziția UI de nivel înalt. Pentru starea curentă, arhitectura completă și dovezile live, consultă `AI-HANDOFF.md`.
