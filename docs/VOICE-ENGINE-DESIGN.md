# MOTORUL DE VOCE — decalaj 0, full-duplex (Kelion)

Ordinul lui Adrian (5 iul 2026): vocea sincronizată cu **decalaj 0** față de când
se aude audio în microfon; full-duplex real. Dictat interactiv + completări
profesionale cerute explicit („participi interactiv și-mi aduci completări profi").
Confirmat: **toate** cele 11 puncte de mai jos.

NU sunt 11 funcții separate — sunt UN motor de voce coerent (piesele se susțin).

## Cerințele (locked)
1. **Barge-in instant** — când începe Adrian să vorbească (audio în microfon),
   vocea lui Kelion se oprește IMEDIAT (0 delay); microfonul îl prinde din prima clipă.
2. **Fără tăiat la început** — începutul frazei lui Adrian nu se mai pierde
   (cauza „frazelor ciuntite").
3. **Lip-sync avatar** — gura/vocea avatarului sincronizate cu sunetul (0 decalaj).
4. **VOX mai rapid** — reacție mai promptă după ce termină de vorbit (în mare
   înlocuit de 5+6: endpointing pe server).
5. **Detecția Google cea mai avansată** — cel mai nou model Speech-to-Text
   (Chirp 3 / v2 streaming) cu **endpointing pe server** (Google decide start/stop
   vorbă), nu pragul RMS brut din browser.
6. **ASR în STREAMING real** — audio trimis *cât vorbește*, text parțial pe loc
   (nu record→stop→trimite→așteaptă). Cel mai mare câștig de latență.
7. **AEC real (anulare ecou cu referință)** — microfonul stă DESCHIS peste vocea
   lui Kelion fără să se declanșeze pe el însuși (vocea redată = semnal de referință).
   Piesa care face full-duplex-ul REAL, nu iluzie prin mut.
8. **Manager de tur (mașină de stări: ASCULT / GÂNDESC / VORBESC / ÎNTRERUPT)** —
   coordonează barge-in + mut + redare fără curse de sincronizare. Coloana vertebrală.
9. **Lip-sync din amplitudinea reală** — gura avatarului din unda audio redată
   (AnalyserNode), timp real, zero decalaj. Implementarea concretă a lui (3).
10. **TTS în streaming (Chirp 3 HD)** — Kelion vorbește din prima silabă, nu după
    ce se sintetizează toată fraza. Time-to-first-audio mic.
11. **Telemetrie de latență** — măsor decalajul real mic→răspuns→voce și-l arăt.
    „Decalaj 0" DOVEDIT cu cifre, nu promis.

## Arhitectură — GROUNDED în codul real (citit 5 iul)

### Stare de AZI (ce se schimbă)
- **ASR** `backend/src/routes/asr.ts` — Google STT **v2 `_:recognize` (BATCH)**,
  model **`chirp_2`**, us-central1, auto-punctuation, auto/anchored lang. Primește
  UN blob base64 per frază, întoarce transcript. NU e streaming.
- **TTS** `backend/src/services/tts.ts` — Google TTS **v1 `text:synthesize`
  (BATCH)**, voce **Chirp3-HD** (`{lang}-Chirp3-HD-{style}`), MP3 întreg. NU e streaming.
- **Client** `frontend/src/lib/audioIO.ts` — VOX pe RMS local (prag zgomot),
  MediaRecorder pe TOATĂ fraza → stop la 750ms tăcere → trimite → așteaptă.
  Microfonul e **MUT cât redă** Kelion (anti-ecou prin mut = half-duplex).
- **Avatar** `frontend/src/components/AvatarModel.tsx` — **fără lip-sync**: doar
  brațe, respirație, cap, clipit (`eyeBlink`). Gura NU se mișcă la vorbă.

### Țintă (motorul nou)
- **ASR** → nou `/api/asr-stream` (STT v2 `streamingRecognize`, model **`chirp_3`**,
  interim results + **voice-activity events / endpointing pe server**), parțiale live
  pe WS. Vechiul `/api/asr` rămâne până la cutover (zero dublură DUPĂ cutover).
- **TTS** → `streamingSynthesize` (v1beta1, Chirp 3 HD) — primele cadre audio imediat.
- **Client** `audioIO.ts` rescris: mic DESCHIS permanent cu **AEC** (referință =
  redarea lui Kelion), **fără mut** la redare; stream PCM la server; **manager de tur**
  (mașină de stări); VOX-ul local scos (endpointing pe server), păstrat doar ca plasă.
- **Avatar**: `jawOpen`/`mouthOpen`/viseme conduse de **AnalyserNode pe redare**
  (amplitudine reală), timp real, zero decalaj.
- **Telemetrie**: măsor mic→transcript→creier→primul cadru audio, arăt latența.

## Ordinea de build (coloana întâi — restul depinde de ea)
1. Backend **ASR streaming** (chirp_3 + endpointing) — endpoint nou, izolat.
2. Client: **mic continuu + AEC + streaming + manager de tur** (dă 1,2,4,7,8).
3. **Lip-sync** avatar din amplitudine (3,9).
4. **TTS streaming** (10).
5. **Telemetrie** de latență (11).

## Reguli (ca la firul unic)
- Backup înainte. Nu rup nimic live. Design → build izolat → test → cutover.
- Poartă umană la publicare (deploy doar la „da").
- Analiză atentă DUPĂ scriere (100 de ochi), dovadă cu teste, nu promisiuni.

## Stare
Faza 0: spec locked (ăsta). Următor: citesc ASR backend + TTS + componenta
avatarului → design tehnic complet → build pe faze.
