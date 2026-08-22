# PROIECT CHAT VOCE — Kelion „Jarvis" (bătut în cuie, 20 aug 2026)

> Versiunea FINALĂ, autoritară. Deciziile de mai jos sunt luate cu owner-ul, pas
> cu pas. Istoricul raționamentului (cum am ajuns la fiecare) = `DRAFT-PROIECT-VOCE-ONLY.md`.
> **Nimic nu se codează până owner-ul nu zice „start build".**
>
> **STARE (21 aug — owner a zis „toate"):** pasul 1 (un singur motor online) e
> CONSTRUIT + LIVE v6.2 (turele scrise merg PRIN Live, Chirp suprimat cât Live
> trăiește; scoaterea totală a lui Chirp = pasul 7/Piper). Pasul 6 funcționează
> de facto pe aceeași cale (scrii → răspunde cu vocea Live). Nuanță la §5/pasul
> 2: pe calea GREA vocea trece prin /api/chat unde poartaFaptelor RULEAZĂ —
> gap-ul real rămas e calea ușoară (transcriptul Live) + reformularea de după
> unealtă. Pasul 2 (cățelul pe calea ușoară a vocii): MERGE (PR #1323) +
> PUBLICAT LIVE — măsurat 22 aug 00:0xZ: /api/version → v=ad5dff1, ver 6.7
> (judecă doar turele pur-ușoare; nota — „nu pot verifica", nu verdict de
> fals — pe istoric+monitor, nu voce; exempția călătorește cu anunțul de
> sistem și stă armată cât ușa grea e în zbor). Rămân „nu pot verifica" de
> aici: ordinea turnComplete/toolCall la Google și prima notă reală — se
> urmăresc în jurnalul live `[POARTA FAPTELOR][VOCE]` / proba owner-ului.
> Pasul 3 (trierea în doi): PASS adversarial + MERGE (PR #1324) + PUBLICAT
> LIVE — măsurat 22 aug 00:3xZ: /api/version → v=3c155b1, ver 6.8 (protocolul
> în fișa ușii + strângerea rostirilor adresate cât ușa macină + runde de
> convergență, plafon 2; două FAIL-uri de verificator reparate: re-execuția
> faptei → istoric+continuareUsa; excepția pusă pe linia moartă → mutată pe
> cereActiune-ul viu din chat.ts). Rămân „nu pot verifica" de aici:
> comportamentul REAL al buclei — jurnalul „trierea în doi — runda" +
> pulsVoce.rundeTriere pe /api/vocal-live/stare + dacă modelul Live chiar
> conversează cât unealta e blocată; limitele declarate în RAMAS (injecția
> în zbor = pas viitor).
> Pasul 4 (salvarea = dovada, §7): PASS dublu adversarial + MERGE (PR #1326)
> + PUBLICAT LIVE — măsurat 22 aug 01:57Z: /api/version → v=577f0fc, ver 7.0
> (cititorul jurnalului operațional + unealta dovada_faptelor + sarcina
> vocală cu dovezi + facts_gate durabil; limitele în RAMAS). Rămân „nu pot
> verifica" de aici: prima sarcină vocală reală, proba dovada_faptelor pe
> cont real — jurnalul VPS / proba owner-ului. Pasul 5 (monitorul, §8):
> PASS dublu adversarial + MERGE (PR #1327) + PUBLICAT LIVE — măsurat 22 aug
> 02:30Z: /api/version → v=b99fad6, ver 7.1 (legătura mecanică ecran-gură:
> textul lung cu document pe monitor pleacă în câmpul „pe_ecran_nu_se_recita",
> nu în poziția „rezultat de spus"; demascarea sare splitul). Rămân „nu pot
> verifica": contoarele usiCuDoc/predariEcran în mișcare reală + ascultarea
> predării — proba pe dispozitiv. Pasul 7: CARTOGRAFIAT și tăiat în felii în
> RAMAS (A probe / B gura Piper / C urechea / D scoaterea Chirp — B, C, D =
> decizii OWNER, cu riscurile pe masă); manualul nu mai promite Piper/Vosk
> inexistente. 2b (nota rostită) = decizie owner în RAMAS.
> Bifele cu dovadă: RAMAS-DE-FACUT.md.

---

## 0. PECETEA
**100% VORBIT.** Un **Jarvis**, doar audio. Ce auzi e mereu voce, fără excepție.
Ieșirea conversațională e 100% vorbită — nu devine niciodată chat scris.

---

## 1. PROBLEMA pe care o rezolvă (măsurată live)
Chatul vocal „pornește 2 sec și se rupe". Cauză MĂSURATĂ (`/api/vocal-live/stare`:
`cadreAudioDeLaGoogle:15`, `cadreAudioSpreBrowser:9`, `suprimateDupaTaiere:6`):
**două motoare de voce se bat** pe aceeași tură —
- **Gemini Live** (`vlRef`) — full-duplex, are gura lui, pentru VORBIT.
- **Chirp** (TTS pe server, `{audio}`) — pentru SCRIS.
Pe o tură vorbită pornesc AMÂNDOUĂ; Chirp cere gura (`requestTtsFocus{turaScrisa}`
→ `liveInterrupt`) → Live e tăiat la ~2s. **Fix din rădăcină: un singur motor.**

---

## 2. ARHITECTURA ONLINE — un singur motor
1. Online = chat audio LIVE, **doar voce**, fără scris pe ecran.
2. **Un singur motor: Gemini Live.** Chirp SCOS din online → zero coliziune → bug
   dispărut din rădăcină.
3. Textul se folosește DOAR la salvare (transcript → memorie), **invizibil** — nu
   se afișează, nu se rostește a doua oară.
4. Scrisul rămâne DOAR pe offline (rezervă).

---

## 3. ESCALADAREA (ușor / greu)
- Vorbești → Gemini Live te aude.
- **Ușor** (conversație) → Live răspunde singur, cu vocea lui. O gură.
- **Greu** (unealtă / gândire adâncă / acțiune) → **Live decide** și cheamă
  creierul greu. Canalul ușor↔greu **NU e audio — e TEXT** (apel de funcție →
  răspuns de funcție; `toolCall.functionCalls` → `toolResponse.functionResponses`).
- Creierul greu (Gemini Pro + unelte) întoarce rezultatul ca TEXT.
- **Rezultatul greu se rostește tot de Gemini Live** (verificat din cod:
  `raspundeUnealta` / `anunta` → Live vorbește). **Un singur motor și la greu.
  Chirp NU e necesar.** (Implicit Live reformulează; când vrem EXACT — cifră,
  adresă — îi punem în instrucțiune „rostește exact textul dintre ghilimele".)

---

## 4. TRIEREA ÎN DOI (perioada de gândire) — inima
Cât creierul greu macină (puțin sau mult), Live NU stă degeaba și NU doar amână:
1. Live lucrează CHIAR gândirea: află detalii, culege date (întreabă userul +
   GPS/cameră/monitor pe care le are deja).
2. Fiecare informație utilă → o **injectează subtil** creierului greu → îi scade
   posibilitățile.
3. Creierul greu cere înapoi: „întreabă asta, află asta" → Live o rostește.
4. **Convergență = criteriul de STOP:** cât mai există o întrebare care MUTĂ
   răspunsul → nu e gata; când nicio întrebare rămasă nu-l mai mișcă → ăla e
   răspunsul. (NU un „procent de corectitudine" — ar fi cifră inventată; modelul
   e sigur pe cuvinte, nu pe adevăr.)
- Efect: „așteptarea" devine conversație utilă, nu tăcere.
- Reguli: schimburile sunt DEJA rapide; întrebările către om trebuie DECENTE, nu
  interogatoriu; **calitatea răspunsului > viteza** (nu e raliu).

---

## 5. ADEVĂRUL + CĂȚELUL anti-minciună
- **PRINCIPIUL SUPREM:** adevărul contează — **oricât ar costa și oricât ar dura.**
  Nici timpul, nici banii nu scuză minciuna.
- **Cățelul = `poartaFaptelor.ts`:** funcție pură care ia textul creierului +
  uneltele chiar REUȘITE și demască pretențiile de faptă fără unealtă în spate
  (născut din „am mințit că am generat clipul", 16 aug).
  - **GAP (măsurat):** rulează doar în `chat.ts` (scris). **NU e chemat în
    `vocalLive`.** De MUTAT/extins pe voce: pe greu, verifici server-side textul +
    uneltele ÎNAINTE ca Live să rostească; pe ușor, prinzi din transcriptul lui Live.
  - Al doilea cățel: `asrHalucinatii.ts` — taie cuvintele-fantomă pe intrarea vocii.
- **Comportament (judecată, NU a/b fix):** cere DECENT câteva secunde; dacă greul
  „o ia pe cărări", Live + cățelul îl aduc pe calea normală ÎNAINTE să ajungă la
  user; rămâne FAPTIC până se întoarce confirmarea; sau marchează „nu e confirmat"
  → pornește căutări în plus.
- **Verificarea e INVIZIBILĂ:** Kelion NU-și narează procesul („stai să măsor ca
  să nu-ți dau din burtă") — sună neprofesionist, enervează. Ori dă răspunsul
  verificat curat, ori pune o întrebare firească.
- **LINIA ROȘIE (absolută):** niciodată nu spune ceva doar ca să placă urechii și
  să fie prins că a mințit — mai ales „am raportat ceva făcut" care NU e făcut.
  Atunci e în joc contractul cu firma.

---

## 6. PERSONA — „vocea" lui Kelion (cele 4 arte)
Owner: îi trebuie **arta negocierii, arta prezentării, arta discuției, arta
gândirii.** Așezate pe arhitectură: **Live** = discuție/prezentare/negociere
(ține omul cu tact); **greul + convergența + cățelul** = gândire (raționează
corect, nu lasă minciuna).
- Temelia: încrederea se clădește cu argumente MĂSURATE, VERIFICABILE — se
  construiește greu, se pierde ușor.
- Când nu știe / e neclar, cere ajutorul politicos (cuvintele owner-ului):
  - „Uite, am analizat ce ceri, dar îmi lipsește informația asta…"
  - „Crezi că-mi poți da mai multe detalii despre…?"
  - „Cum vezi tu…?"

---

## 7. SALVAREA = DOVADA (asul din mânecă)
Ideal: orice lucru cerut are o măsurătoare REALĂ cu **dovada SALVATĂ**. Prezentare:
răspuns curat default (nu te încarcă cu probe la fiecare frază), dar proba e mereu
salvată și la un pas — o scoate când o ceri sau când e provocat.
- Avem: `masurare.ts` (măsurători, salvate în KV/DB) + `jurnalOperational.ts`
  (starea + dovada fiecărei fapte, legat de Poarta Faptelor).
- GAP: merg pe calea scris/operațional; pe VOCE nu sunt legate → build.

---

## 8. MONITORUL — nu se citește NICIODATĂ cu voce
Monitorul e loc de AFIȘAT, nu de recitat.
- Vocea dă doar o predare scurtă: „vă prezint pe monitor rezolvarea:" → monitorul
  arată **grafic SAU textul scris** (îl turuie) → **și atât** → **revine la audio.**
- Poate arăta și text scris (rezolvare lungă), nu doar imagine/hartă/card — **dar
  nu-l rostește.**
- DE CE omoară bug-ul: nimic nu CITEȘTE ecranul cu voce → nicio a doua voce → zero
  coliziune. Monitorul = tăcut, pentru ochi; vocea = doar conversația.
- Măsurat: canalul `control` (`onControl`: monitor/doc/app/card) e DEJA separat de
  voce — `vocalLive.ts`: „Vocea NU vine pe aici".

---

## 9. OFFLINE — rezerva (fără net)
Companion vocal și offline, dar e REZERVĂ (online rămâne Jarvis-ul real).
- **Avatar 3D** = local (WebGL, cache) → se vede offline.
- **Gura (lip-sync):** din nivelul audio redat. TTS local **Piper** (WASM, dă
  bufferul) → lip-sync curat. (TTS de sistem cântă pe lângă graf → buze slabe.)
- **Urechea (STT):**
  - Capcană: `SpeechRecognition` din browser trimite sunetul la Google → NU offline.
  - **Decizie: nativ Android întâi, Vosk rezervă în browser.** Nativ =
    `createOnDeviceSpeechRecognizer()` (Android 13/API 33), on-device — dar doar în
    APK (punte nativă) + pachet RO pe telefon. Vosk = WASM, streaming, model RO.
  - **RO are suport BUN** (Whisper multilingv, Google on-device, Vosk RO). Precizia
    exactă pe vocea+telefonul owner-ului = DE MĂSURAT prin probă, nu presupus.
  - App-ul MĂSOARĂ singur la pornire dacă telefonul are RO on-device (owner nu caută).
  - Limită reală (nu de RO): offline NU e full-duplex ca Live (reprize, latență mai mare).
- **Vede offline? NU azi.** Camera prinde cadre offline, dar înțelegerea cere un
  VLM mic pe WebGPU (Moondream/Qwen2-VL-2B) — greu, imatur. Build separat, opțional.
- **Creierul offline** = Qwen/Gemma local (text). (Gemini „mare"/Live = cloud, cere net.)

---

## 10. OPȚIUNE NEOBLIGATORIE — input scris de la tastatură
NU e obligatoriu; implicit rămâne vocea. Poți SCRIE în loc să vorbești.
- Online: trivial — Live acceptă text nativ (`clientContent … parts:[{text}]`) →
  răspunde cu VOCEA lui.
- Offline: cel mai natural input (creierul offline e text) + **sare peste veriga
  slabă (urechea)** — scrii, primești voce.
- **REGULA DE AUR:** input scris DA, **output rămâne VOCE** — nu afișăm răspunsuri
  scrise (altfel reînvie coliziunea = bug-ul).
- UI: discret, secundar (iconiță tastatură).

---

## 11. MĂSURAT (din cod) vs DE PROBAT (înainte de cod)
**Măsurat, sigur:**
- Bug-ul = 2 motoare (Live + Chirp) se bat (stare live + `audioFocus.ts`).
- Canalul greu = text/funcție, nu audio; Live rostește rezultatul serverului.
- `poartaFaptelor` rulează pe scris, NU pe voce (gap).
- `control` (vizual) e deja separat de voce.
- Avem `masurare.ts` + `jurnalOperational.ts` pentru dovezi (pe scris/operațional).

**De probat LIVE (owner testează), înainte de promisiuni:**
- Live rostește un text EXACT/verbatim la cerere (nu doar reformulat) — de confirmat pe dispozitiv.
- Urechea offline (Vosk RO / nativ Android RO): transcrie? latență? precizie pe vocea owner-ului?
- Lip-sync offline cu Piper (nivel audio real).
- Vedere offline (VLM) — dacă owner o cere ca musai.

---

## 12. CE URMEAZĂ LA BUILD (când owner zice „start")
Nimic din astea nu e început. Ordine propusă (fiecare cu build → deploy → VERIFY LIVE).
**REGULĂ (owner, 20 aug): ACTUALIZARE după FIECARE lucru făcut ȘI verificat** —
se bifează pasul în `RAMAS-DE-FACUT.md` DOAR cu dovadă live, iar `AI-HANDOFF.md`
§13 se aduce la zi. Nu se bifează nimic „în avans".
1. **Fix-ul de bază (bug-ul):** online = un singur motor. Chirp SCOS pe calea
   vocală; pe tura vorbită Chirp nu mai pornește; rezultatul greu îl rostește Live.
2. Cățelul (`poartaFaptelor`) LEGAT pe calea voce (greu server-side + transcript Live).
3. Trierea în doi = bucla dus-întors a creierului greu (incremental + cere înapoi).
4. Salvarea dovezii + „asul din mânecă" pe voce.
5. Monitorul: predare scurtă + afișare, fără citire cu voce.
6. Tastatura opțională (input scris, output voce).
7. Offline: probele (ureche/gura/RO), apoi implementarea rezervei.

---

## Reguli de lucru (owner)
- Fără grabă. Se notează ce se vorbește, se stă la rând cu logica programului.
- Nimic „gata" fără dovadă MĂSURATĂ. Valorile neverificate = „nu pot verifica".
- Adevărul mai presus de cost și timp.
- (Separat, decis) constructorul = Devin, extern, pe cheia owner-ului.
