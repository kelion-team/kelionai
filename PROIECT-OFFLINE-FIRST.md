# PROIECT KELION — OFFLINE-FIRST (ansamblul complet)

> ⚑ **PLAN AUTORITAR — bătut în cuie cu owner-ul, 21 aug 2026.**
> Decis pas-cu-pas, în discuție directă. Orice AI care atinge arhitectura,
> fazele sau modulele Kelion **respectă 100% documentul ăsta.** Proiectul voce
> (`PROIECT-CHAT-VOCE.md`) rămâne autoritar pentru **poarta de voce (P2)** și se
> subordonează ansamblului de aici. Progresul + bifele: `RAMAS-DE-FACUT.md`.
> Actualizare după FIECARE pas făcut ȘI verificat.

---

## 0. Strategia „pe dos" (de ce)

Ordinul owner-ului (21 aug, verbatim): „*vom gândi un pic pe dos strategia… să
fie o aplicație care la bază să meargă offline, la care începem să adăugăm partea
de live*" + „*e un program local de sine stătător*" + „*când programul local e
testat începem să deschidem porțile către online*".

Șapte luni de „*povestea lui Manole*": ce mergea se strica la următorul feature
lipit pe deasupra. Răspunsul e inversarea: **construiești o bază care merge
SINGURĂ (offline), apoi adaugi online ca îmbunătățire care NU are voie să strice
baza.** Progressive enhancement, disciplinat.

Bonus măsurat (audit 3 agenți independenți, 21 aug): bug-ul offline de azi
(aplicația nu comută pe creierul local când cade netul) e un defect de
**arhitectură web** (chunk WebLLM încărcat leneș + service worker + WebGPU +
timing). Un **program local de sine stătător** îl **repară din rădăcină** — ține
modelul ca piesă împachetată nativ, nu ca un chunk web care poate lipsi din cache.

---

## 0.1 Cum construim — nici cârpeală, nici rescriere totală

Owner (21 aug): „*nu mai bine scriu de la început curat tot? și înlocuim tot ce
există? decât să cârpești?*". Răspuns (recomandare inginerească — owner poate
decide altfel): **a treia cale.**

- **NU rescriere totală de la zero** — „capcana rescrierii": durează ~3×, rămâi
  fără produs care merge cât timp rescrii, și **arunci 7 luni de bug-uri deja
  rezolvate** și le redescoperi pe toate = REPEȚI durerea, n-o vindeci.
- **NU cârpeală** — lipit peste ce e încâlcit.
- **DA: schelet NOU curat, offline-first de la os, în care TRANSPLANTĂM organele
  DOVEDITE** (UI + avatar 3D + creier local + i18n + manual + legile/testele) și
  **retragem** ce e încâlcit sau cuplat-la-server.

Dovada că metoda merge: **teardown-ul de voce** (am scos curat partea încâlcită,
o reconstruim curată, am păstrat ce-i bun — narator/apel/chat — FĂRĂ să rescriem
toată aplicația). Faza 1 (nativ standalone) oricum nu există încă → scriem curat
shell-ul + core-ul local-first, reutilizăm doar organele bune. „Curat" se face
prin schelet nou + transplant, nu prin foc la tot.

---

## 1. Legile (peste tot, în orice fază)

1. **OFFLINE-FIRST.** Baza merge singură, fără net. Online doar *îmbunătățește* —
   niciodată portant. Pierzi semnalul → degradezi grațios, niciodată ecran mort.
2. **PORȚI.** Fiecare capabilitate online = o poartă cu stare deschis/închis +
   **cădere grațioasă pe bază** când o închizi. Deschisă = plus; închisă = revii
   pe programul local.
3. **ADEVĂRUL.** Cațelul anti-minciună (poarta faptelor) pe ORICE cale (și
   offline). Măsoară-nu-declara. Monitorul niciodată citit cu voce. Adevărul
   peste cost/timp. (Legile din `CLAUDE.md` + `PROIECT-CHAT-VOCE.md` rămân.)

---

## 2. Livrarea (intrarea)

- **Intrare = WEB** (`kelionai.app`): de acolo **descarci/instalezi** programul.
  Web-ul e hub-ul de livrare + landing + experiența online — NU aplicația de bază.
- **Se instalează local pe device**, rulează de sine stătător.
- **Tehnologii:**
  - **Android** — app nativă prin **Capacitor** (același cod UI web + plugin-uri
    native). Descărcare directă din web (APK) sau Play Store.
  - **Desktop (Windows/Mac/Linux)** — **Tauri/Electron** sau **PWA** instalabilă.
  - **iOS** — app nativă prin Capacitor, prin **App Store/TestFlight** (owner are
    cont de developer Apple). **Faza 3 (ultima)** — vezi §5.

### 2.1 Model economic + flux de intrare (bătut, 21 aug)

**Flux:** web `kelionai.app` → **Google auth** → **download GRATIS** → instalezi →
Faza 1 offline merge **fără credite**. Auth-ul e online, o dată (te înregistrează
+ te lasă să descarci); după instalare, programul rulează offline fără să mai
ceară auth.

**Freemium aliniat pe COSTUL REAL:**
- **Faza 1 (offline) = GRATIS, modele locale FULL.** Rulează pe device → **zero
  cost pe noi pe utilizare** (owner: „*dacă e free, nici pe noi să nu ne coste*").
  Modelele locale sunt mai slabe (~3B) dar complete, nefragmentate — nu le ciuntim.
- **Porțile online (Faza 2) = cu CREDITE.** Acolo plătim noi API real (Gemini,
  Google, căutare) → acolo taxăm. Creditele se cumpără **DUPĂ** download, **doar
  pentru net**.

**Condiția ca „free" să nu ne coste:** baza offline 100% pe device, **zero apel la
server**. Un singur cost real la free = bandwidth-ul descărcării modelului (~2GB,
o dată/user), mitigat prin app store/CDN/HuggingFace. Per-utilizare = 0. (Dacă
baza gratis ar face fie și un apel la server, ne-ar costa — de-aia standalone e
cheia, nu preferință.)

### 2.2 Cum aduc bani (owner, 21 aug: „te las pe tine să aduci bani la noi")

Adus pe legile Kelion — cinstit, măsurat, fără trucuri.

- **Unde se cumpără — pe WEB, nu în app.** Apple/Google iau **15–30%** + interzic
  procesatorul propriu la cumpărături digitale în app. Pe web = procesatorul
  nostru → ținem **~97%** (strategia Netflix/Spotify/Kindle).
- **Puntea = contul comun** (Google auth, același web + app). User free offline
  vrea o poartă online → e oricum pe net → app-ul îl trimite pe web (buton/link pe
  Android/desktop; **QR** pe iOS, că Apple interzice butonul „cumpără") → cumpără
  credite în ACELAȘI cont → app-ul sincronizează → poarta se deschide.
- **Model:** credite **PREPLĂTITE** (nu intri pe minus — lecția „40 ture/1 penny"),
  scăzute DOAR la deschiderea porților online. Offline = 0 credite.
- **Procesator (recomandare, revizuibil):** **Stripe + Stripe Tax** (reutilizăm
  infra existentă = transplant; Stripe Tax face TVA-ul/GST automat). Rezervă:
  **Merchant of Record** (Paddle/LemonSqueezy) dacă taxele globale devin grele —
  ei duc taxa lumii, pe comision mai mare.
- **Prețul creditelor = din COSTUL REAL măsurat + marjă corectă — NICIODATĂ
  inventat** (legea măsurătorii; lecția „tarife inventate 24/48/200 vs reale
  6/12/50"). Transparent, fără dark patterns.
- **Implementarea = Faza 2.** Acum = doar designul, bătut.

---

## 3. FAZA 1 — programul offline (100% local, fără net) · Android + Desktop

Rulează în „mod avion". Modulele:

- **M1 · Învelișul instalabil** — Capacitor/PWA, cache + stocarea modelului pe device.
- **M2 · Creierul local** — model on-device (WebLLM/WebGPU pe desktop; runtime
  nativ pe mobil). Gândește offline. **Include fix-ul de comutare offline** (bug-ul
  de azi = fundație, nu peticeală — vezi §8).
- **M3 · Gura offline (vorbește)** — TTS local (browser/OS). = `voceBrowser`
  reconstruit curat. *Ușor.*
- **M4 · Urechea offline (aude)** — STT on-device (Whisper WASM/Vosk pe desktop;
  STT nativ Android pe mobil). **Munca grea a Fazei 1.**
- **M5 · Ochii offline (vede)** — cameră + față local (face-api există deja);
  „descrie scena" = model viziune local. *Parțial/greu.*
- **M6 · Avatarul 3D + UI + Manual** — rulează local.
- **M7 · Memorie/istoric local** + cozile offline (ce s-a făcut se ține pentru
  sincronizare la revenirea netului).
- **M8 · Cațelul anti-minciună pe calea LOCALĂ** — nu minte nici offline.

**Poartă de trecere:** testat COMPLET în mod-avion (vorbește/aude/vede/gândește
fără net) ÎNAINTE de Faza 2.

**Adevăr pe efort:** M2 (creier ~3B pe telefon) + M4 (STT) + M5 (viziune) = munca
grea; restul e ușor. STT/TTS/văz sunt native și ușoare pe Android; creierul local
e piesa de calibrat peste tot (memorie/viteză/căldură pe telefon).

---

## 4. FAZA 2 — porțile către net (inteligența superioară) · Android + Desktop

Peste baza offline. Fiecare poartă = îmbunătățire cu fallback grațios pe Faza 1:

- **P1 · CREIER MARE** — Gemini (escaladează când localul e prea mic).
- **P2 · VOCE-LIVE** — Gemini Live = exact `PROIECT-CHAT-VOCE.md` (un motor,
  escaladare pe canal text, cațel pe voce, monitor necitit, triere-în-doi +
  convergență, tastatură opțională).
- **P3 · VIZIUNE-CLOUD** — „îmi spune bogat ce vede".
- **P4 · GOOGLE** — calendar/gmail/drive.
- **P5 · CĂUTARE** — Serper (web live).
- **P6 · DEVIN** — constructorul (mâinile care scriu cod → PR → owner aprobă).
- **P7 · CONT/PLĂȚI** — auth Google + portofel/Revolut.
- **P8 · APEL** — Kelion↔Kelion (om-la-om / traducere).
- **Sincronizare offline↔online** — la revenirea semnalului, cozile se urcă și se
  rezolvă civilizat.

**Regula porților:** deschisă doar adaugă; închisă → cazi curat pe bază, niciodată
ecran mort. Legile proiectului voce = regulile porții de voce.

---

## 5. FAZA 3 (ultima) — iOS nativ

Portul complet pe iPhone, NATIV (nu PWA — pe iOS aia e slăbiciunea):
- **Gândește** → Metal / Core ML (MLC-LLM are iOS nativ).
- **Aude** → Apple Speech framework (on-device).
- **Vorbește** → AVSpeechSynthesizer (voci offline).
- **Vede** → Vision + Core ML.
- Distribuție: App Store/TestFlight (contul Apple al owner-ului).

Lăsat la final: dovedim modelul pe Android+Desktop (unde nativ merge ușor),
învățăm, apoi portăm — nu blocăm cel mai greu teren la început.

---

## 6. Tehnologii per capabilitate (măsură, nu presupunere)

| Capabilitate | Android (nativ) | Desktop | iOS (Faza 3) |
|---|---|---|---|
| Gândește | runtime local (MLC/llama.cpp) | WebLLM/WebGPU sau llama.cpp | Metal/Core ML |
| Vorbește | TTS nativ Android | TTS OS/browser | AVSpeechSynthesizer |
| Aude | STT nativ Android | Whisper WASM/Vosk | Apple Speech |
| Vede | ML Kit/TFLite + face-api | face-api + model local | Vision/Core ML |

---

## 7. Ordinea de construit

1. **Fundație:** repară comutarea offline (bug-ul de azi) + curăță codul mort
   (harta celor 3 agenți, §8) — teren curat.
2. **Faza 1** pe Android + Desktop: M1→M2→M3 (ușoare) → M4, M5 (grele) → M7, M8.
   Test complet mod-avion.
3. **Faza 2:** deschizi porțile una câte una, fiecare cu fallback pe bază.
4. **Faza 3:** port iOS nativ.

---

## 8. Starea (unde suntem) + audit 3 agenți (21 aug)

**FĂCUT — baza curățată:** teardown-ul de voce (PR #1302, master) a scos vocea
online încâlcită care se ciocnea („2 sec și se rupe"). Terenul e gol și curat.
Verde măsurat: build FE, tsc+teste BE (201/1713), porți.

**Audit 3 agenți independenți (convergent):**
- **Bug offline (pre-existent, NU din teardown — verificat byte-cu-byte):** poarta
  `eTuraOffline = !esteConectat() && stareCreierLocal().stare === 'gata'`. Modelul
  e „descărcat" (cache), nu „încărcat în GPU" când cade netul; plus chunk-ul WebLLM
  poate lipsi din cache offline; plus bara zice „gata" și pe „descărcat". **Fix:**
  await `pregatesteModelOffline()` la tură offline + precache chunk + bară cinstită.
  (Devine moot pe nativ — de-aia standalone.)
- **Cod mort de scos (harta convergentă):** urechea moartă din `audioIO.ts`
  (`startMic` + extractoare voiceprint), rutele backend orfane `realtime` + `asr`,
  plumbing-ul dormant `audio→creier` din `chat.ts`. **A PĂSTRA (viu):** `audioGraph`
  (folosit de apel), jumătatea de redare din `audioIO` (narator), `guestVoices`
  (uneltele de admin), feature-ul voiceprint (are extracție proprie), apel.
- **Poarta `verifica-exporturi` = fals-verde** (numără comentarii/teste ca
  „folosit") — de întărit.

**RĂMAS:** vezi `RAMAS-DE-FACUT.md`. Faza 1 e neîncepută; teardown-ul e fundația.

---

## 9. Legături

- `PROIECT-CHAT-VOCE.md` — autoritar pentru **poarta P2 (voce-live)**.
- `AI-HANDOFF.md` — arhitectura vie + starea (§13).
- `RAMAS-DE-FACUT.md` — lista owner-ului cu ce nu e făcut.
- `CLAUDE.md` — legile de bază + ordinea de citire.
