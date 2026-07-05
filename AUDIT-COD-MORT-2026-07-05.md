# Audit cod mort — Kelionai — 2026-07-05

Audit pur de investigare, fără modificări funcționale. Metodă: pentru fiecare
fișier din `backend/src` și `frontend/src` s-a verificat (cu ripgrep) dacă
fișierul e importat de altundeva, dacă rutele sunt înregistrate în
`backend/src/index.ts`, dacă componentele React sunt importate în arborele
`App.tsx → Landing/Stage → ...`, și pentru fiecare `export` s-a numărat de
câte ori mai apare simbolul în restul codului (nu doar la declarație).

## 1) Fișiere complet neutilizate (candidat clar la ștergere)

- **`backend/src/services/speech-chunk.ts`** (44 linii, exportă
  `splitForSpeech`). Nu apare NICIUN import al lui în tot repo-ul (nici în
  `services/tts.ts`, nici în `routes/tts.ts`, nici în teste — nu există
  teste). Funcția e "pură" și bine documentată (împarte textul pe fraze
  pentru TTS incremental), dar codul de producție din `tts.ts`/`chat.ts` nu o
  cheamă deloc — pare a fi fost scrisă pentru o funcționalitate (streaming
  TTS pe bucăți) care fie nu s-a mai conectat, fie a fost înlocuită cu altă
  logică inline.
  → **Recomandare: de investigat cu Adrian** dacă intenția de streaming pe
  bucăți e încă pe roadmap (nu șterge orbește — poate fi cod pregătit pentru
  o funcție viitoare); dacă nu, se poate șterge fișierul întreg.

- **`frontend/src/lib/turnManager.ts`** (106 linii, exportă
  `createTurnManager`, tipurile `TurnManager`, `TurnState`, `TurnCallbacks`,
  `TurnOptions`). Nu e importat din NICIUN alt fișier frontend (ChatPanel,
  Stage etc. au propria logică de baraj/`barge-in` implementată direct, nu
  prin acest manager de stări). Comentariul din fișier spune că e "inima
  vocii full-duplex" — pare a fi o implementare alternativă/pregătitoare
  pentru voce full-duplex care nu a fost cuplată încă în UI.
  → **Recomandare: de investigat** — dacă e cod scris pentru milestone-ul
  "LiveKit full-duplex voice" (menționat în CLAUDE.md ca „nu construit încă”),
  păstrează-l intenționat ca schelet; altfel poate fi șters.

## 2) Funcții exportate, declarate dar niciodată apelate (nici din alt
   fișier, nici din același fișier) — moarte în interiorul modulului lor

- **`backend/src/db.ts` → `creditWallet()`** (linia 485): funcție `async`
  exportată, zero apeluri în tot codul (nici billing.ts, nici admin.ts nu o
  cheamă). Portofelul e creditat probabil prin altă cale (Stripe webhook în
  `services/stripe.ts` / `routes/billing.ts`) care scrie direct în DB.
  → **Recomandare: de investigat** înainte de ștergere — verifică dacă a
  fost înlocuită de o funcție cu alt nume în `stripe.ts`/`billing.ts`
  (risc de logică de creditare "orfană" care nu mai rulează niciodată).

- **`backend/src/db.ts` → `resolveEscalatedGaps()`** (linia 1297): la fel,
  exportată, zero apeluri oriunde. Numele sugerează legătură cu
  `CapabilityGap`/escaladări de capabilități (vezi `admin.ts`), dar nimic nu
  o invocă.
  → **Recomandare: de investigat** — posibil rest dintr-un flux de
  escaladare admin neterminat sau înlocuit.

- **`backend/src/routes/asr-stream.ts` → `asrStreamConfigured()`** (linia
  42): exportată, zero apeluri. Alte module (`asr.ts` are propriul
  `sttConfigured`/echivalent verificat separat) nu o folosesc.
  → **Recomandare: de șters** dacă `asr-stream` verifică oricum
  configurarea altundeva; de investigat rapid înainte.

- **`frontend/src/lib/billing.ts`** → `currencySymbol()`, `fetchPool()`,
  `loadPool()`: toate exportate, zero utilizări (nici în `WalletButton.tsx`,
  singurul consumator al fișierului, care folosește alte funcții din
  același modul). Par a fi API pentru un ecran de "pool" de credite care nu
  a fost cuplat în UI.
  → **Recomandare: de investigat** (posibil legat de milestone-ul
  "monetizare / credite" din CLAUDE.md, încă neconstruit) — păstrează dacă e
  în lucru, altfel șterge.

- **`frontend/src/lib/camera.ts` → `hasMultipleCameras()`**: exportată,
  zero apeluri (nici din `CameraView.tsx`, nici din `ChatPanel.tsx`).
  → **Recomandare: de investigat / de șters** — probabil utilă pentru un
  buton "schimbă camera" care nu există încă în UI.

- **`frontend/src/lib/admin.ts` → `fetchCosts()`**: exportată, zero apeluri
  din `AdminPanel.tsx` (care probabil citește costurile prin alt endpoint
  sau altă funcție deja folosită).
  → **Recomandare: de investigat** — verifică dacă `AdminPanel.tsx` afișează
  deja costurile prin altă cale; dacă da, `fetchCosts` e sigur de șters.

## 3) Fals-pozitive verificate și eliminate (păstrate intenționat)

În timpul auditului au fost verificați ~50 de candidați suplimentari
(exporturi de tipuri/interfețe și helper-e interne) care la prima vedere
păreau "neutilizate cross-file", dar s-au confirmat ca fiind:

- **tipuri/interfețe folosite doar în fișierul propriu** ca semnătură de
  întoarcere / parametru (ex: `db.ts: WorkOrderRow, DemoStats, HistoryRow,
  CapabilityGap...`, `services/browser.ts: BrowserSnapshot, BrowserResult`,
  `services/stripe.ts: CheckoutResult, StripeEvent`, `routes/bridge.ts:
  StagedRelease, WorkOrder` etc.) — sunt exportate din obicei de stil de
  cod, dar chiar folosite, nu sunt cod mort.
- **funcții helper apelate intern în același fișier**, doar marcate
  `export` (ex: `services/lang.ts: detectSpeechLang` — apelată de
  `primaryLang` în același fișier; `services/tts.ts: ttsConfigured` —
  apelată de propriul `synthesize`; `routes/bridge.ts: wsLaneCount,
  noteBuildBeat` — apelate din alte handlere din același fișier;
  `services/google.ts: OSRM_BASES` — folosită de funcția de directions din
  același fișier; `services/mail.ts: RoyalLetter/royalLetterHtml` —
  folosite reciproc).
- **toate rutele backend** (`routes/*.ts`) sunt înregistrate explicit în
  `backend/src/index.ts` (`app.register(...)`) — nicio rută orfană
  neînregistrată.
- **toate componentele React** (`AdminPanel, AvatarModel, CameraView,
  CardView, ChatPanel, ContactModal, WalletButton`) sunt importate în
  `Stage.tsx`/`Landing.tsx`/`ChatPanel.tsx` — nicio componentă neimportată.
- **niciun fișier `.bak`/`.old`/`.orig`/duplicat** găsit în `backend/`,
  `frontend/`, rădăcina repo-ului (căutare recursivă, excluzând
  `node_modules`, `.git`, `android/`, `ios/`).
- `db.ts: dbEnabled` — folosit de 52 de ori în propriul fișier (fals-pozitiv
  al scriptului de căutare per-fișier, nicidecum cod mort).

## Rezumat

- Fișiere complet neimportate: **2** (`backend/src/services/speech-chunk.ts`,
  `frontend/src/lib/turnManager.ts`) — de investigat, nu s-a șters nimic.
- Funcții exportate niciodată apelate: **8**
  (`db.ts:creditWallet`, `db.ts:resolveEscalatedGaps`,
  `asr-stream.ts:asrStreamConfigured`, `billing.ts:currencySymbol`,
  `billing.ts:fetchPool`, `billing.ts:loadPool`, `camera.ts:hasMultipleCameras`,
  `admin.ts:fetchCosts`).
- Rute neînregistrate: **0**.
- Componente React neimportate: **0**.
- Fișiere `.bak`/`.old`/duplicate: **0**.
- Candidați falși eliminați după verificare (tipuri/helper-e interne
  folosite doar în același fișier): **~50**.

Nu s-a șters și nu s-a modificat niciun fișier de cod ca parte a acestui
audit — doar raportare, conform cerinței.
