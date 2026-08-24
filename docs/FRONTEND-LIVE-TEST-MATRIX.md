# Frontend — inventar și matrice de testare live

Acest document este contractul curent de verificare, nu un istoric de decizii. Testele distructive se rulează numai într-un mediu izolat cu sesiuni seed-uite; smoke-ul din producție rămâne read-only, cu excepția chatului și a senzorilor porniți explicit de tester.

## Acoperire inventar

- `frontend/src`: 170 fișiere — 116 producție și 54 teste.
- Cod/config/stil/manifest de producție: 31.461 linii.
- Teste frontend: 3.261 linii.
- Configurație/build inspectată: `package.json`, lockfile, toate tsconfig-urile, `vite.config.ts`, `index.html`, `public/sw.js`, scripturile frontend și workflow-ul PR.
- Fișiere de producție neclasificate: **0**.

### Entry, rute și pagini

| Fișier | Responsabilitate |
| --- | --- |
| `main.tsx` | bootstrap web/native și înregistrare PWA permisă de runtime |
| `App.tsx` | sesiune, mod offline, actualizare SW și rutare lazy |
| `index.css` | sistem vizual și layout responsive |
| `assets/background-image.png` | fundal static |
| `offline-kit.manifest.json` | inventarul pinuit al kitului offline |
| `pages/Landing.tsx` | landing public, lead și intrări publice |
| `pages/Login.tsx` | Google și magic-link; fără register/parolă nouă |
| `pages/Manual.tsx` | manual localizat, căutare, audience public/admin și descărcare |
| `pages/Credits.tsx` | guard de sesiune, sold validat, configurație server-side și istoric plăți |
| `pages/Stage.tsx` | shell autentificat, monitor, aplicații și suprafețe admin/client |

Rute UI: `/` landing sau Stage după sesiune; `/login`; `/manual`; `/credite` și aliasul `/credits`. Restul navigării este în Stage, fără router paralel.

### Componente

| Fișier | Responsabilitate |
| --- | --- |
| `AdminPanel.tsx` | panoul Google-admin, finanțe, utilizatori, constructor, worker Codex, recovery și diagnostic |
| `ApelOverlay.tsx` | interfața apelului |
| `AvatarLoading.tsx` | fallback avatar |
| `AvatarModel.tsx` | model, animații, lip-sync și micro-expresii comandate |
| `AvatarScene.tsx` | scena Three.js |
| `BackLink.tsx` | revenire accesibilă |
| `BannerOffline.tsx` | indicator persistent offline |
| `CameraView.tsx` | cameră opt-in, instantaneu la cerere și oprire |
| `CardView.tsx` | carduri de rezultat |
| `ChatPanel.tsx` | chat text/live, senzori, offline, barge-in și protocolul monitorului |
| `ContactModal.tsx` | contact idempotent, fără auto-confirmare email |
| `CustomerSettings.tsx` | preferințe, kit offline, billing, profil spectral și ștergere cont |
| `CvAdaptation.tsx` | CV upload/adapt idempotent și export |
| `DeployProgressBar.tsx` | progres release |
| `DynamicBackground.tsx`, `DynamicBackground.css` | fundal animat |
| `JarvisOrb.tsx` | mod mașină/live |
| `LandingAvatar.tsx`, `StageAvatar.tsx` | încărcare lazy a avatarului pe suprafață |
| `ManualIcon.tsx` | iconuri Lucide pentru manual |
| `MicBargraf.tsx` | nivel microfon și poartă audio |
| `VisitorChatWidget.tsx` | chat public cu sesiune cookie HttpOnly |
| `WalletButton.tsx` | sold server-side, scutire și prompt de plată |
| `WorkClock.tsx` | timp de lucru măsurat |

### Biblioteci — identitate, transport și date

- `api.ts`: sesiune și logout; `nativeAuth.ts`: browser extern/deep-link și sesiune nativă; `transport.ts`: origin unic, fetch/SSE/WS și artefacte externe allowlist.
- `clientState.ts`: namespace opac per cont și purge la switch/logout/delete; `submissionSession.ts`: UUID de sesiune pentru lead; `retryIdempotency.ts`: UUID stabil pe retry.
- `prefs.ts`: preferințe user-scoped; `productConfig.ts`: config public generat din `config/product.json`; `manualPolicy.ts`: limbi/chrome și filtrare fail-closed a capitolelor admin; `publicText.ts`, `i18n.ts`, `adminText.ts`, `languages.ts`, `langList.ts`: text și limbă fără dubluri comerciale locale.
- `conexiune.ts`, `retea.ts`, `latency.ts`, `watchdog.ts`, `energie.ts`, `usePolledJson.ts`, `updateCheck.ts`: conectivitate, măsurare și lifecycle PWA.
- `billing.ts`, `praguri.ts`: penny integers, politică server-side, reminder și istoric strict.
- `admin.ts`: contractele API admin; `deployProgress.ts`: contract unic pentru polling/SSE de release; `errorReport.ts`: raportare redactată; `vizita.ts`: vizită agregată fără fingerprint.
- `markdown.ts`: DOMPurify; `workspace.ts`: taskuri monitor, iframe allowlist și CSP playground; `tradingBridge.ts`: origin/source binding pentru iframe-ul Trading; `theme.ts`, `ceas.ts`, `wakelock.ts`, `notificari.ts`, `pushTelefon.ts`: utilitare UI/runtime.

### Biblioteci — chat, voce și senzori

- `chat.ts`: stream chat și idempotency; `chatReplayPolicy.ts`: oprirea retry-ului ambiguu; `offlineStore.ts`: istoric/outbox tranzacțional account-scoped; `coadaOffline.ts`: compatibilitate și ACK strict; `offlineSync.ts`: drenare mutex la mount/reconnect în batch-uri de maximum 100; `contextOffline.ts`: context local minim; `callMedia.ts`: envelope și segmentare media pentru apel.
- `vocalLive.ts`: client unic OpenAI Realtime prin backend; `voiceHeartbeat.ts`, `voceUnica.ts`, `rutaAudio.ts`, `audioFocus.ts`: o singură voce și ownership audio.
- `micStream.ts`, `vad.ts`, `pcm.ts`, `pcmWorklet.ts`, `opusVoce.ts`, `audioGraph.ts`, `audioIO.ts`: captură, VAD, codec și redare.
- `apel.ts`, `apelMic.ts`, `apelSonerie.ts`: apel și semnalizare; `voceBrowser.ts`, `vociKelion.ts`: fallback senzorial local.
- `camera.ts`, `cameraConsent.ts`, `avatarCamera.ts`: cameră și consimțământ; `auzAmbiental.ts`: indicii FFT neconcludente pe streamul comun.
- `facialQueue.ts`, `gestures.ts`: animații comandate ale avatarului; `audioSpatial.ts`, `companionCreativ.ts`, `dansMuzica.ts`, `motorBit.ts`, `carMode.ts`, `recorder.ts`: media locală și mod mașină.
- `voiceProfile.ts`: profil spectral metadata-only, user-scoped și fără autoritate.

### Biblioteci — kit offline

- `kitOffline.ts`: instalare explicită, progres, cancel/retry/remove și preflight; `offlineRuntimeAssets.ts`: cache opțional al runtime-urilor locale grele prin service worker, numai după consimțământ.
- `offlineKitManifest.ts`, `offlineKitIntegrity.ts`, `offlineKitReadiness.ts`, `offlineHash.ts`, `offlineInstallPolicy.ts`: schemă v2, inventar complet, SHA-256, spațiu/capabilități și readiness verificat.
- `creierLocal.ts`: WebLLM strict on-device/offline; `urecheaOffline.ts` și `urecheaOffline.worker.ts`: Whisper local; `voceBrowser.ts`: exclusiv voce OS cu `localService=true`, altfel text-only.

Niciun model local nu este selectabil pe traseul cloud. Kitul mobil implicit este SmolLM2-360M, iar runtime-urile WebLLM/Whisper se încarcă numai prin instalarea explicită. Vocea OS nu se descarcă și este raportată disponibilă numai dacă browserul confirmă `localService=true` pentru limba curentă.

### Build și shell

| Suprafață | Contract |
| --- | --- |
| `package.json` / lockfile | versiuni fixate unde contează, Vitest, audit producție |
| `vite.config.ts` | config produs fail-closed și route code splitting |
| `tsconfig*.json` | typecheck aplicație și build |
| `index.html` | CSP/bootstrap/meta runtime |
| `public/sw.js` | shell tranzacțional versionat; fără cache API/auth |
| `scripts/copiaza-active-offline.mjs` | WASM local verificat înainte de build |
| `scripts/genereaza-precache.mjs` | manifest determinist cu hash și reutilizare de revizii |
| `.github/workflows/pr-verify.yml` | build, lint și toate testele frontend |

## Matrice live — public

| ID | Rută/stare | Control sau acțiune | Oracle |
| --- | --- | --- | --- |
| P01 | `/`, anonim | logo, limbă, manual, login | navigare corectă; fără dialog/cameră/fotografie obligatorie; focus și nume accesibil |
| P02 | `/`, anonim | formular lead, retry identic | UUID stabil la retry; conținut schimbat produce UUID nou; succes golește pending |
| P03 | `/`, anonim | Contact | mesaj stocat; nicio promisiune de auto-email; retry idempotent |
| P04 | `/`, anonim | Visitor chat: open/send/poll/close | `POST /session`, cookie HttpOnly, send doar `{text}`, poll doar `after`; 401/410 reinițializează o singură dată |
| P05 | `/manual` | limbă, căutare, secțiuni, print/download, back | chrome și conținut localizate; publicul nu primește/renderizează `audience:admin` ori pagini legacy `🔒`; fără claims retrase |
| P06 | `/login` | Google | browser de sistem pe native; callback valid; admin numai Google |
| P07 | `/login` | magic link | răspuns generic, expirare/replay fără enumerare cont |
| P08 | `/credite`, fără sesiune | deschide ruta | stare sign-in sigură; zero request sold/istoric/reminder, zero valori private sau sold negativ în DOM |
| P09 | orice public | offline/revenire | banner corect; niciun request repetitiv cât browserul este offline |

## Matrice live — client autentificat

| ID | Suprafață | Control sau acțiune | Oracle |
| --- | --- | --- | --- |
| C01 | Stage | trimite text / Enter / Shift+Enter | un singur `/api/chat`, UUID idempotent per tură, transcript complet |
| C02 | Chat | Stop | oprește streamul și audio fără a șterge întrebarea următoare |
| C03 | Live | start cu o atingere | `connecting → listening → thinking → speaking`; status și reconectare vizibile |
| C04 | Live | vorbește peste răspuns | barge-in golește bufferul audio și păstrează transcriptul ambelor sensuri |
| C05 | Live | pauză 20s / tab background | sesiunea nu moare la 15s; închiderea serverului are motiv și reluare deliberată |
| C06 | Live | permission denied / socket timeout | eroare acționabilă, timer curățat, fără buclă de reconnect |
| C07 | Chat | limbă și voce | preferința se salvează per cont; un singur output audio |
| C08 | Chat | atașare/drop/paste | tip/mărime validate; offline refuză înainte de network |
| C09 | Cameră | pornește / schimbă / stop | consimțământ explicit, indicator persistent, tracks oprite la revoke/unmount |
| C10 | Cameră | instantaneu cerut | un singur `input_image`; niciun frame continuu, GPS sau descriptor biometric |
| C11 | Auz ambiental | start live | reutilizează streamul microfonului; etichete numai indicii posibile |
| C12 | Monitor | tab/switch/close/save/open extern | task status corect; conținutul nu se remontează inutil |
| C13 | Monitor web | URL allowlist / URL arbitrar | YouTube/OSM/Waze/Windy validate; restul POST `/api/citeste-pagina` sau link extern |
| C14 | Playground | HTML generat | CSP fără network/forms/popups; fără acces la sesiune |
| C15 | Document | PDF/Office | PDF same-origin sandbox; Office nu este trimis implicit la Microsoft |
| C16 | Aplicații Google | Gmail/Calendar/Drive/etc. | capability specific în `/auth/google/connect?capability=…`; consent la folosire |
| C17 | Wallet | sold client / low credit | starea vine din `/balance`; reminderul nu pretinde auto-debit |
| C18 | Wallet | checkout | `setup_required` închide checkout-ul; când Merchant este `active`, clientul confirmă și numai webhook-ul semnat creditează automat; fără auto-debit/credit anticipat; pending/paid/refunded/chargeback distincte |
| C19 | Settings | logout / switch A→B | purge draft/scenariu/cozi/profil local sensibil; B nu vede datele A |
| C20 | Settings | delete account | confirmare `DELETE`, reauth 428, succes numai cu receipt server |
| C21 | Settings | profil spectral enroll/revoke | metadata-only în răspuns; DELETE user-scoped; niciun efect de autorizare |
| C22 | CV | upload TXT/MD/CSV/PDF/DOCX | magic/MIME/size și UUID retry; imaginile primesc 415 onest |
| C23 | CV | adapt/retry/new action/export | retry aceeași acțiune păstrează UUID; acțiune nouă primește altul; DOC/PDF/copy |
| C24 | Mod mașină | start/stop/mic | UI voice-first; live unic; exit accesibil |
| C25 | Avatar/media | gest, vorbire, dans, muzică | animațiile reale răspund la eveniment/audio; fără polling de „emoție” falsă |
| C26 | PWA | update disponibil | aplicare numai la gest, fără hard-reset/cache clear |

## Matrice live — kit offline și recuperare

| ID | Stare | Control sau acțiune | Oracle |
| --- | --- | --- | --- |
| O01 | online, kit absent | Descarcă kit | consimțământ explicit; mărime ~904 MB și tier afișate |
| O02 | data saver/mobil/baterie joasă | confirmare secundară | fără primul byte înainte de confirmare |
| O03 | spațiu/WebGPU insuficient | preflight | blocare înainte de download; motiv precis |
| O04 | instalare | progress/cancel/retry | progres per componentă, cancel eliberează runtime, retry nu marchează partial ready |
| O05 | instalat | startup integrity | fiecare artefact/revizie/mărime/SHA-256 prezent; eviction/corupție revocă ready |
| O06 | instalat | remove | șterge brain/hearing/voice și readiness atomic |
| O07 | airplane cold reload | shell | index, CSS, JS, worker și WASM pornesc; zero request de rețea |
| O08 | airplane | microfon→Whisper→reply→voce OS locală sau text-only | transcript și răspuns local; voce/barge-in numai dacă există o voce `localService=true` pentru limbă |
| O09 | offline, kit loading/absent | două mesaje | niciodată cloud; queue UUID account-scoped și UX „în așteptare” |
| O10 | reconnect | același batch de trei ori | server ACK exact IDs; FE elimină numai ACK-urile exacte, fără duplicate |
| O11 | A offline→logout→B | queue/draft/scenario | zero transfer cross-account; fără lat/lon persistat |
| O12 | stream rupt după tool side effect, terminal salvat | retry cu același UUID | răspunsul terminal este redat fără a doua unealtă, taxă sau bulă duplicată |
| O13 | crash după marcajul de side effect, înainte de terminal | retry după expirarea lease-ului | serverul răspunde fail-closed `turn_result_indeterminate`; nicio reexecuție automată; UI cere verificarea rezultatului |
| O14 | crash înainte de orice side effect | retry cu același UUID | lease-ul expirat este recuperat o singură dată; răspunsul parțial abandonat este înlocuit, nu concatenat |
| O15 | cerere amânată peste 7 zile | reconnect | textul terminal nu mai este reținut, dar tombstone-ul UUID împiedică definitiv reexecuția; contul B rămâne izolat |

## Matrice live — Google admin

| ID | Tab/suprafață | Control sau acțiune | Oracle |
| --- | --- | --- | --- |
| A01 | intrare Admin | deschide/închide/taburi | absent pentru client și pentru sesiunea offline cache-uită/tampered |
| A02 | Bani | refresh/reset counters | cifre măsurate; admin `scutit`, `debitMinor=0`, `creditsUsed=0`; fără CTA checkout |
| A03 | Utilizatori | open history/block/unblock/credit | acțiuni confirmate server-side; credit în `amountMinor`; fără foto/IP/device/location |
| A04 | Inbox/contact | select/delete/reply/translate | tri-state read failure vs empty; reload după mutație |
| A05 | Stores/mailbox | refresh | setup/read failure onest; fără promisiuni Revolut/Gmail/PSD2 inventate |
| A06 | Erori/notificări | refresh/read | redacție date; badge și 20s refresh fără duplicate |
| A07 | Gesturi | preview/enable/save | preview vizibil; stare revert la save failure |
| A08 | Tokenuri/env | refresh | numai prezență/status, niciun secret în DOM/log |
| A09 | Recovery | list/save/restore | eroare body afișată; mutații doar în staging |
| A10 | Constructor | evaluate/send/cancel/retry/clean | worker Codex, status și progres reale; idempotency și autoritate server |
| A11 | Agent specializat | create | numai formular React → POST JSON `/api/enterprise/agent-nou`; fără consolă HTML paralelă |
| A12 | Creier | afișare | OpenAI read-only; trepte din GET, fără selector/POST/KV mutabil |
| A13 | Codex | heartbeat/setup/task | browser worker: `codex login`; headless: flux oficial `codex login --device-auth`; URL/cod/token nu intră în Kelion DOM/DB/log, task URL oficial noopener |
| A14 | Codex | cost/capabilități | subscription numai pentru Codex text/reasoning/Constructor; Realtime/TTS/image/video rămân OpenAI API server-side; cost intern separat și debit Kelion admin zero din `/balance` |
| A15 | VPS/diagnostic | citire/autoverificare | status real, eșec explicit; fără restart/deploy VPS direct din browser |

## Matrice live — native și securitate

| ID | Runtime | Probă | Oracle |
| --- | --- | --- | --- |
| N01 | iOS/Android/Tauri | cold start bundle local | shell local pornește fără `server.url` de producție |
| N02 | native online | toate API-urile | originul vine din `productConfig`; zero raw first-party fetch/SSE/WS |
| N03 | native auth | Google system browser→deep link | ticket one-time/revocabil; niciun cookie cross-origin presupus și niciun token în localStorage |
| N04 | native offline | airplane reload | shell local și kit offline funcționează; SW nu se înregistrează pe scheme native |
| S01 | Markdown | payload XSS | script/event/style/URL periculos eliminat |
| S02 | iframe | host/path adversarial | allowlist strict; fără iframe arbitrar și fără Office leak |
| S03 | playground | fetch/form/popup | CSP blochează exfil și sandboxul nu are capabilități inutile |
| S04 | privacy | cameră/mic/fingerprint | consimțământ granular; zero analytics foto/fingerprint/device signals |
| S05 | bundle | secret scan | niciun token/task ID/credential în source, dist, storage sau log |

## Dovezi automatizate și limite

Porțile obligatorii sunt: `npm test`, `npm run lint`, `npm run build`, `npm audit --omit=dev`, contractul butoane-rute, exporturi, hardcodări, creier unic, inventar/hash și scanare secrete. Testele unitare acoperă politicile offline, transport, native auth, XSS/iframe/playground, billing, idempotency, senzori și PWA.

Aceste porți nu înlocuiesc probele live pentru cameră, microfon, OpenAI Realtime, WebGPU, instalarea reală a kitului de ~904 MB, browserul de sistem native, taskul privat Codex și fault-injection PostgreSQL pentru O12–O15. Pentru ele sunt necesare un browser/dispozitiv compatibil, backend de staging, conturi public/client/admin izolate și permisiuni explicite. Local este dovedită siguranța anti-dublare și redarea terminalului; un crash după marcajul efectului, dar înaintea rezultatului durabil, rămâne intenționat nedeterminat și cere verificare umană, nu reexecuție.
