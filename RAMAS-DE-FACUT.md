# Ce nu e făcut și ce nu merge — inventar

> Adrian, 30 iul: „pune pe listă tot ce nu ai făcut din proiect, tot ce nu merge,
> că mă ia capul."
>
> Lista asta e făcută din COD și de pe LIVE, nu din memorie. Fiecare rând are
> dovada lângă el. **Se actualizează la fiecare sesiune** — un rând rezolvat se
> taie cu data și PR-ul, nu se șterge.
>
> Ultima verificare: **30 iul 2026, 09:10**, live `e66e84c` = master, health 200.
> Sesiunea din 30 iul a publicat 10 lucrări (PR #565–#576) și a tăiat 7 rânduri.

---

## A. CODAT, DAR MORT PE LIVE — cheia nu ajunge în procesul care rulează

> **CAUZA GĂSITĂ, 30 iul — era în codul meu, nu la tine.** Adrian a spus de două
> ori „toate cheile au fost scrise de zeci de ori". Avea dreptate. `config.ts`
> accepta **două nume** pentru OpenAI (`OPENAI_API_KEY` / `OPENAI_KEY`), două
> pentru OpenRouter, două pentru Google TTS — semn că problema „am scris alt
> nume" lovise deja de trei ori și fusese peticită. Dar exact pe cele care nu
> mergeau, alias nu exista: `GOOGLE_MAPS_KEY` (singura scrisă **fără `_API_`**),
> `SERPER_API_KEY`, `GEMINI_API_KEY` — câte un singur nume. O cheie scrisă
> `GOOGLE_MAPS_API_KEY`, cum scrie oricine, nimerea în gol, iar panoul raporta
> „lipsește". **Reparat (PR #578):** fiecare cheie e căutată acum sub toate
> numele rezonabile, iar tabul **Admin → Tokenuri** arată „**Ce chei vede
> serverul CHIAR ACUM**" — sub ce nume a găsit fiecare cheie, câte caractere are
> (**niciodată valoarea**), ora pornirii procesului, și mai ales **cheile pe care
> le ai sub un nume pe care codul nu-l citea**.


| Ce nu merge | Cheia care lipsește | Dovada |
|---|---|---|
| **Hărți și trasee** (Google Maps) | `GOOGLE_MAPS_KEY` | panoul Bani scria „(neconfigurat) Google Maps" |
| **Căutare web** (Serper) | `SERPER_API_KEY` | „(neconfigurat) Serper" |
| **Voce sintetizată Google** | `GOOGLE_TTS_API_KEY` | „(neconfigurat) Google TTS" |
| **Chirp 3 HD** (auzul/vocea Google, calitate mare) | `GOOGLE_SERVICE_ACCOUNT_JSON` | AI-HANDOFF §28 iul — STT/TTS cad pe OpenAI |
| **Butonul „Vezi numărul cardului"** în Admin → Bani | `STRIPE_PUBLISHABLE_KEY` | panoul spune el ce lipsește |

Notă: Maps are și o cale gratuită (OpenStreetMap) care merge — deci harta nu e
complet moartă, dar rutarea bună și locurile lipsesc.

---

## B. BANII — unde s-a oprit circuitul

| # | Ce | Stare reală (măsurată) |
|---|---|---|
| B1 | **Cardul Kelion AI** | Necunoscut până la următoarea deschidere a panoului. Până azi codul nici nu căuta cardurile (reparat, PR #565). Cardul `••••0013` din dashboard a fost refuzat de furnizor cu „numărul cardului este incorect" — semn de card din **test mode**. |
| B2 | **Issuing pe contul LIVE** | Cererea trimisă pe 24 iul; aprobarea Stripe nu e confirmată nicăieri. Fără ea nu există card real. |
| B3 | **Punga rămâne pe £0** | Stripe scoate banii în bancă după programul lui, înainte să apuce transferul orar spre card. Se schimbă DOAR din dashboard (payouts → Manual). Nu există API. |
| B4 | **Transferul automat plăți→card** | `POST /v1/balance_transfers` e în **beta** la Stripe — până la aprobare răspunde 4xx. |
| B5 | **Cheia `sk_live` „K"** | Acces TOTAL la cont, nefolosită din 10 iunie. De retras — dar cu grijă, după ce restul merge. |
| B6 | **Adresa cardului** | ✅ **reparat** (30 iul, PR #572): adresa hardcodată („Kelionai, London, EC1A 1AA" — o adresă care nu există) a fost ștearsă. Butonul „Creează cardul" o cere acum, iar backendul refuză cu `bad_address` dacă lipsește. Nu mai declarăm către Stripe o adresă falsă a titularului. |
| B7 | **Cheia restricționată nu poate citi contul** | `/v1/account` → 403. Verigile 1 și 2 din circuit nu se pot verifica. Nu mai e blocant pentru card (B1 reparat), dar payouts rămâne neverificabil. |

---

## C. CERINȚE ALE TALE, NETERMINATE

| # | Cerința | Cât e făcut | Ce mai e |
|---|---|---|---|
| C1 | **Toată aplicația în engleză, apoi limba userului** | ✅ **TERMINAT** (30 iul, PR #567 + #569). Suprafața userului: Stage 20 + ChatPanel 3, în `i18n.ts` cu **toate cele 7 limbi**. Panoul de admin: **54 de texte + 14 etichete de tab**, în `lib/adminText.ts` (engleză bază + română completă; o limbă lipsă cade curat pe engleză). `CardReveal` trecut direct pe engleză. **Măsurat: 0 texte românești în interfață.** | comenzile VOCALE („înregistrează", „reluăm", „comută camera") rămân în română — sunt cuvinte de recunoaștere a vorbirii, nu interfață |
| C2 | **Buton „înapoi" pe toate panourile și paginile** | ✅ **gata** (verificat 30 iul): `BackLink` pe Credits, Login, Manual, AdminPanel, CustomerSettings; `ContactModal` are X **și** buton „Close". Inventarul de dimineață greșea aici — se baza pe o căutare după `BackLink`, care nu vede X-ul unui modal. | **Landing** și **Stage** NU primesc buton: sunt rădăcini, n-au „pagina anterioară" |
| C3 | **Manualul** | ✅ **refăcut** (30 iul, PR #568): copertă pe pagină proprie, cuprins cu ancore, capitole numerotate, pictogramă pe fiecare grupă de funcții, filă-schemă „cum călătorește o cerere" (4 pași). Se traduce în toate cele 7 limbi. | fără capturi de ecran, intenționat: se învechesc la fiecare schimbare de interfață. De reevaluat cu ochii tăi. |
| C4 | **Vocea per user** | ✅ **gata** (30 iul, PR #570): coloana `voice` pe `user_prefs` (pe emailul normalizat, deci nu se încurcă între conturi), selector în Setări cu lista venită de la server, iar vocea aleasă intră în sesiunea Realtime a omului. O preferință necunoscută cade pe vocea implicită — probat cu 3 teste — și dacă totuși prima încercare pică, a doua pleacă pe implicită: preferința unui om nu-i poate omorî vocea. | — **TERMINAT**: și TTS-ul scris (`/api/tts` + vocea din răspunsul de chat) folosește aceeași preferință, deci scrisul sună ca vocea live |
| C5 | **Autonomie demonstrată live, cu dovadă** | constructorul merge (ordin #14, PR #483) | proba cap-coadă pe chat ȘI voce, cu dovadă, n-a fost făcută |

---

## D. CREIER ȘI AUTONOMIE — ce a rămas din specificație

| # | Ce | Stare |
|---|---|---|
| D1 | `prepare_promo_clip` | singura capabilitate la care vocea nu ajunge (din 69). Cere butonul Rec din interfață — legată fizic de client. |
| D2 | **Testul de raționament pe creier plătit** | nefăcut. Cât timp punga OpenRouter e goală, creierul merge pe modele gratuite slabe. |
| D3 | **Google Photos, YouTube personal** | cer scope-uri OAuth NOI → trebuie să reconectezi Google. Decizia ta. |
| D4 | **Etapa 5b — instalări de sistem ca runbook** | constructorul poate instala pachete npm, dar nu unelte de sistem (apt). Operație privilegiată pe VPS, de făcut cu grijă. |
| D5 | **Barge-in prin STT streaming** | **Analizat 30 iul, NEATINS deliberat.** Barge-in-ul pe vocea live (full-duplex) MERGE — îl face OpenAI Realtime nativ (`interrupt_response: true`). Lipsește doar pe calea de auz a chatului (`micStream` → `/api/asr-stream`): cât timp Kelion vorbește, microfonul e pe mut, deci nu curge audio și n-are ce detecta întreruperea. Reparația reală înseamnă să ținem microfonul deschis cât vorbește și să ne bazăm pe anularea de ecou — cu riscul concret ca **Kelion să se audă pe el însuși și să-și taie singur vorba**. Nu se poate proba fără microfon; nu se publică nedovedit pe un produs viu. De făcut cu tine în față, cu microfonul pornit. |
| D6 | **Pauza de autonomie invizibilă în UI** | ✅ **reparat** (30 iul, PR #574): la amânare, lucrătorul trimite un pas marcat „⏳" care sare peste throttle, iar panoul arată insigna **„Așteaptă cotă"** (în toate cele 7 limbi) în loc de „Lucrează" cu pasul înghețat 40 de minute. |
| D7 | **Corpul erorii 502 aruncat de client** | ✅ **reparat** (30 iul, PR #573): serverul trimite acum și `code` (ce anume a picat) și `retryable`; clientul le citește și afișează motivul pe înțelesul omului — „furnizorul vocii n-a răspuns la timp", „nu mai ai credit" — în loc de „realtime 502". |

---

## E. CE POT FACE DOAR EU (Adrian) — nimeni altcineva n-are acces

1. Cheile din **A** — puse o dată în GitHub Secrets + `vps-set-env`.
2. **Stripe → payouts pe Manual** (B3) și starea cererii **Issuing** (B2).
3. **Cardul la OpenRouter și OpenAI** — niciun furnizor nu lasă un program să-și
   bage cardul în contul lui de facturare. Se pune de mână, o dată.
4. **Reconectarea Google**, dacă vrem Photos/YouTube personal (D3).
5. **Permisiunile de cameră și locație** pe telefon.

---

## Reguli pentru lista asta

- Un rând se taie **doar cu dovadă**: PR + verificare pe live.
- Un rând nou se adaugă când se descoperă, nu la sfârșit de sesiune.
- Dacă un rând nu se poate verifica, scrie **„nu pot verifica"** — nu „e ok".

---

## F. MUNCĂ PARCATĂ CARE NU E ÎN COD — se pierde dacă nu e cerută

Două „stash"-uri stăteau în containerul de lucru al sesiunii din 30 iul. Containerul
se șterge singur; ce nu e într-un commit dispare. Le scriu aici ca să nu se piardă
**informația**, chiar dacă se pierde fișierul.

| Ce | Stare | Decizia ta |
|---|---|---|
| „editii-pre-rebazare" — cascada de modele Realtime (`realtimeModelFallbacks`) | **deja în master**, verificat: `config.ts` are câmpul. Stash-ul era o copie. | nimic de făcut |
| **„fallback abonament liber"** — 28 iul, „nu mai dau un ban" + contul Claude blocat pe limită | **NU e în master.** Verificat: `subBrainFailed` nu apare în `chat.ts`. Era marcat de autorul lui „se aplică doar dacă Adrian zice da", fiindcă venea peste o restaurare făcută de tine. | **a ta** |

**Ce făcea a doua**, exact: când tura grea a adminului mergea pe creierul de
abonament (cheia ta Claude) și acesta pica — cheie respinsă (401/403), cont blocat
pe limită (429), fără credit (402) sau model invalid — aplicația **dădea eroare**
(„problemă tehnică"/„verifică cheia"). Cu ea, tura se reia **tăcut** pe creierul
liber ($0): Gemini direct dacă e disponibil, altfel modelul `work` din punga
centrală. Zero eroare pentru tine, zero bani cheltuiți. `brainApiKey` devine `let`
și se golește înainte de reluare, ca să nu plece cheia de abonament spre punga
centrală (ar fi cheie greșită). Se aplică doar dacă n-a curs încă text, altfel s-ar
dubla răspunsul.

Sunt ~23 de linii în `backend/src/routes/chat.ts`. Dacă zici „da", o rescriu într-o
lucrare separată, cu teste. Dacă zici „nu", rândul ăsta rămâne aici ca urmă și se
închide.
