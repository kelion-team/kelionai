# Ce nu e făcut și ce nu merge — inventar

> Adrian, 30 iul: „pune pe listă tot ce nu ai făcut din proiect, tot ce nu merge,
> că mă ia capul."
>
> Lista asta e făcută din COD și de pe LIVE, nu din memorie. Fiecare rând are
> dovada lângă el. **Se actualizează la fiecare sesiune** — un rând rezolvat se
> taie cu data și PR-ul, nu se șterge.
>
> Ultima verificare: **30 iul 2026, 08:05**, live `cd7285f`, health 200.

---

## A. CODAT, DAR MORT PE LIVE — lipsește o cheie pe server

Astea NU sunt bug-uri de cod. Codul e scris și testat; pur și simplu n-are cu ce
să pornească, fiindcă variabila lui nu există în env-ul de pe VPS. Se pun toate
la fel: **GitHub → Settings → Secrets and variables → Actions**, apoi
**Actions → `vps-set-env` → Run workflow**.

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
| B6 | **Adresa cardului** | Hardcodată „Kelionai, London, EC1A 1AA" — adresă inventată. La un card real poate da refuz pe verificarea de adresă. De luat adresa reală la creare. |
| B7 | **Cheia restricționată nu poate citi contul** | `/v1/account` → 403. Verigile 1 și 2 din circuit nu se pot verifica. Nu mai e blocant pentru card (B1 reparat), dar payouts rămâne neverificabil. |

---

## C. CERINȚE ALE TALE, NETERMINATE

| # | Cerința | Cât e făcut | Ce mai e |
|---|---|---|---|
| C1 | **Toată aplicația în engleză, apoi limba userului** | ✅ **tot ce vede un user** (30 iul, PR #567): Stage 20 de texte + ChatPanel 3, mutate în `i18n.ts` cu **toate cele 7 limbi**. Numărătoarea de dimineață (98) era umflată — includea comentarii din cod și cuvintele-cheie ale comenzilor vocale românești, care TREBUIE să rămână românești. | rămâne **panoul de Admin: 53 de texte** (+2 în `CardReveal`), văzute doar de admin |
| C2 | **Buton „înapoi" pe toate panourile și paginile** | ✅ **gata** (verificat 30 iul): `BackLink` pe Credits, Login, Manual, AdminPanel, CustomerSettings; `ContactModal` are X **și** buton „Close". Inventarul de dimineață greșea aici — se baza pe o căutare după `BackLink`, care nu vede X-ul unui modal. | **Landing** și **Stage** NU primesc buton: sunt rădăcini, n-au „pagina anterioară" |
| C3 | **Manualul** | ✅ **refăcut** (30 iul, PR #568): copertă pe pagină proprie, cuprins cu ancore, capitole numerotate, pictogramă pe fiecare grupă de funcții, filă-schemă „cum călătorește o cerere" (4 pași). Se traduce în toate cele 7 limbi. | fără capturi de ecran, intenționat: se învechesc la fiecare schimbare de interfață. De reevaluat cu ochii tăi. |
| C4 | **Vocea per user** | coloana în bază + citit/scris, puse deoparte | de legat la vocea live și la TTS + selector în Setări. Parcat la cererea ta. |
| C5 | **Autonomie demonstrată live, cu dovadă** | constructorul merge (ordin #14, PR #483) | proba cap-coadă pe chat ȘI voce, cu dovadă, n-a fost făcută |

---

## D. CREIER ȘI AUTONOMIE — ce a rămas din specificație

| # | Ce | Stare |
|---|---|---|
| D1 | `prepare_promo_clip` | singura capabilitate la care vocea nu ajunge (din 69). Cere butonul Rec din interfață — legată fizic de client. |
| D2 | **Testul de raționament pe creier plătit** | nefăcut. Cât timp punga OpenRouter e goală, creierul merge pe modele gratuite slabe. |
| D3 | **Google Photos, YouTube personal** | cer scope-uri OAuth NOI → trebuie să reconectezi Google. Decizia ta. |
| D4 | **Etapa 5b — instalări de sistem ca runbook** | constructorul poate instala pachete npm, dar nu unelte de sistem (apt). Operație privilegiată pe VPS, de făcut cu grijă. |
| D5 | **Barge-in prin STT streaming** | mort structural: clientul nu trimite audio cât microfonul e pe mut. |
| D6 | **Pauza de autonomie invizibilă în UI** | coada constructorului nu arată când un ordin e amânat pe cotă de furnizor. |
| D7 | **Corpul erorii 502 aruncat de client** | serverul trimite `retryable`/`code`, clientul le ignoră — mesaje mai proaste decât ar putea fi. |

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
