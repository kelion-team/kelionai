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
| B1 | **Cardul Kelion AI** | ✅ **închis** (30 iul): Stripe a fost scos din aplicație, cardul virtual nu mai există în cod (butonul, `createAiCard`, `CardReveal.tsx` — șterse). Rândul nu spune „Stripe merge", spune că **nu mai depindem de el**. Furnizorii se plătesc cu cardul tău Revolut, direct la ei — linkurile sunt în Admin → Bani. |
| B2 | **Issuing pe contul LIVE** | ✅ **închis** (30 iul), din același motiv ca B1: nu mai avem nevoie de aprobarea Issuing, fiindcă nu mai emitem card prin Stripe. |
| B3 | **Punga rămâne pe £0** | ✅ **închis** (30 iul): punga Stripe nu mai e sursa banilor. Încasările intră direct în Revolut Pro, la tine. |
| B4 | **Transferul automat plăți→card** | ✅ **închis** (30 iul): nu mai există card de alimentat. Vezi B1. |
| B5 | **Cheia `sk_live` „K"** | Acces TOTAL la cont, nefolosită din 10 iunie. **Acum e și mai simplu de retras**, fiindcă aplicația nu mai cheamă Stripe pe nicio cale de plată. E un click în dashboardul tău — nu-l pot face eu. |
| B6 | **Adresa cardului** | ✅ **reparat** (30 iul, PR #572): adresa hardcodată („Kelionai, London, EC1A 1AA" — o adresă care nu există) a fost ștearsă. Butonul „Creează cardul" o cere acum, iar backendul refuză cu `bad_address` dacă lipsește. Nu mai declarăm către Stripe o adresă falsă a titularului. |
| B7 | **Cheia restricționată nu poate citi contul** | ✅ **închis** (30 iul): circuitul Stripe pe care nu-l putea citi nu mai există în aplicație. |
| B8 | **ARDEREA: punga creierului se golește fără plafon și fără avertisment** | Adrian, 30 iul: „punga 0 din cauza ta, am plătit dimineața 50" (dintre care $8.92 mai erau acum ~45 min). MĂSURAT DIN COD, nu presupus: (1) regula „owner-ul primește ÎNTOTDEAUNA modelul plătit capabil" se aplică la **fiecare** mesaj, nu doar la cele grele — `heavy` reglează doar efortul de gândire, nu modelul; (2) cu camera pornită pleacă **până la 4 cadre foto** pe tură către modelul plătit (pozele sunt partea scumpă); (3) fiecare tură cară 24 de mesaje de istoric + unelte + 5000 tokeni buget; (4) **nu există NICIUN plafon pentru admin** — în `chat.ts` scrie explicit „adminul e scutit" de debitare, deci nimic nu oprește consumul. Un comentariu mai vechi din propriul cod măsoară „o singură tură cu unelte a costat $4.24". BUCLA: plătești → arde → punga 0 → codul cade pe `:free` → „Kelion nu execută cerințele" → plătești iar. Jumătatea de jos e reparată (PR #582: căderea pe free nu mai e tăcută, scrie `[CREIER]` în jurnal cu motivul). **Arderea NU e reparată** — e decizia lui: model plătit doar pe cereri de acțiune reală (ieftin la vorbă obișnuită), și/sau plafon zilnic care anunță când e atins. Nu se pune o limită pe banii omului fără să știe. **A lui.** |
| B9 | **Diagnosticele mele n-au ars credit — verificat, nu presupus** | Am chemat traducerea manualului de 4 ori azi (zh/hu/pl/cs) în timpul diagnosticului. `manualLang.ts` folosește `config.openrouter.searchModel`, implicit `google/gemma-4-26b-a4b-it:free` → cost $0. **Rezervă onestă:** nu pot citi env-ul de pe VPS, deci dacă `OPENROUTER_SEARCH_MODEL` e setat acolo pe un model plătit, concluzia asta cade și am contribuit la ardere. |

---

## C. CERINȚE ALE TALE, NETERMINATE

| # | Cerința | Cât e făcut | Ce mai e |
|---|---|---|---|
| C1 | **Toată aplicația în engleză, apoi limba userului** | ✅ **TERMINAT** (30 iul, PR #567 + #569). Suprafața userului: Stage 20 + ChatPanel 3, în `i18n.ts` cu **toate cele 7 limbi**. Panoul de admin: **54 de texte + 14 etichete de tab**, în `lib/adminText.ts` (engleză bază + română completă; o limbă lipsă cade curat pe engleză). `CardReveal` trecut direct pe engleză. **Măsurat: 0 texte românești în interfață.** | comenzile VOCALE („înregistrează", „reluăm", „comută camera") rămân în română — sunt cuvinte de recunoaștere a vorbirii, nu interfață |
| C2 | **Buton „înapoi" pe toate panourile și paginile** | ✅ **gata** (verificat 30 iul): `BackLink` pe Credits, Login, Manual, AdminPanel, CustomerSettings; `ContactModal` are X **și** buton „Close". Inventarul de dimineață greșea aici — se baza pe o căutare după `BackLink`, care nu vede X-ul unui modal. | **Landing** și **Stage** NU primesc buton: sunt rădăcini, n-au „pagina anterioară" |
| C3 | **Manualul** | ✅ **refăcut** (30 iul, PR #568): copertă pe pagină proprie, cuprins cu ancore, capitole numerotate, pictogramă pe fiecare grupă de funcții, filă-schemă „cum călătorește o cerere" (4 pași). Se traduce în toate cele 7 limbi. | fără capturi de ecran, intenționat: se învechesc la fiecare schimbare de interfață. De reevaluat cu ochii tăi. |
| C4 | **Vocea per user** | ✅ **gata** (30 iul, PR #570): coloana `voice` pe `user_prefs` (pe emailul normalizat, deci nu se încurcă între conturi), selector în Setări cu lista venită de la server, iar vocea aleasă intră în sesiunea Realtime a omului. O preferință necunoscută cade pe vocea implicită — probat cu 3 teste — și dacă totuși prima încercare pică, a doua pleacă pe implicită: preferința unui om nu-i poate omorî vocea. | — **TERMINAT**: și TTS-ul scris (`/api/tts` + vocea din răspunsul de chat) folosește aceeași preferință, deci scrisul sună ca vocea live |
| C5 | **Autonomie demonstrată live, cu dovadă** | constructorul merge (ordin #14, PR #483) | proba cap-coadă pe chat ȘI voce, cu dovadă, n-a fost făcută |
| C6 | **„Răspuns = nimic" — chatul se termina în TĂCERE** | 🔧 **reparat în cod, PR #581** (30 iul). Cauza era a mea: creierul poate întoarce 200 cu text GOL (model scos de furnizor, completare vidă) — nu se aruncă nicio excepție, deci plasa de eroare nu pornea niciodată, iar tura se închidea mută; clientul șterge turele goale → pe ecran, NIMIC: nici răspuns, nici eroare. Trei plase: `areCevaDeVazut` (deosebește ce vede omul de cadrele pur-protocol), reîncercare o dată pe modelul de rezervă când creierul răspunde gol, și mesaj onest + `[CHAT MUT]` în jurnal dacă tura tot n-a produs nimic. 7 teste noi. | **nu pot verifica pe contul tău**: n-am acces la sesiunea ta logată (crearea unui cont de test pe producție e blocată, corect). Dovada finală o dai tu după publicare — dacă tot nu vine nimic, acum apare măcar motivul scris, și ăla arată direct unde e |

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

---

## G. MISIUNEA AUTONOMĂ — partea Revolut, dusă de Kelion singur

> Adrian, 30 iul: „dă-i liber să se repare singur, să-și construiască ce nu ești
> tu în stare" · **„tema autonomiei lui va fi să facă partea totală cu Revolut;
> când merge aia, e autonom."**

Ăsta e singurul loc unde proba autonomiei e definită de el, nu de mine. Nu se
scrie „e autonom" nicăieri până când **un user plătește și primește creditele
fără ca cineva să miște un deget**.

De pe 30 iul, `backend/src/services/autonomie.ts` se uită **din oră în oră** și,
dacă e liber, îi dă constructorului următorul pas — fără să întrebe pe nimeni.
Pașii, în ordine, și cum se verifică fiecare:

| Pas | Ce construiește | Cum vezi că e gata |
|---|---|---|
| M0 | **Setările, făcute de EL**: își pune singur cheile (`secret_pune`), le duce pe server (`secret_publica`) și verifică. Tu nu mai intri nicăieri | îți spune ce a configurat — **numele** cheilor, niciodată valorile |
| M1 | **Veriga lipsă, făcută de EL cu browserul**: intră singur pe `bankaccountdata.gocardless.com`, își face secretele, le pune cu `secret_pune`, leagă contul, publică. Tu apeși o singură dată: aprobarea PSD2 în Revolut, pe telefon. **NU prin email** (ordinul tău) și **nu prin API-ul Revolut** — măsurat: API-ul e doar pe Business, plan Grow+, iar Business nu se dă persoanelor fizice autorizate | Admin → Bani scrie ✅ la citirea plăților |
| M2 | **Plasa**: o plată fără cod, sau cu cod greșit, ajunge în `plati_neatribuite` — nu dispare | Plătești fără cod → apare în panou, necreditată |
| M3 | **Panoul**: coduri emise, plăți creditate, plăți neatribuite, totaluri | Le vezi în Admin → Bani |
| M4 | **Capătul userului**: sume la alegere, cod mare cu buton de copiere, „aștept plata" care se închide singură, istoric | Un cont obișnuit cumpără credit și îl vede intrând, fără refresh |
| M5 | **Proba automată**: test cap-coadă — cod → email → credit → al doilea email nu mai creditează | `npm test` are testul și e verde |

**Unde se vede că bucla trăiește:** Admin → Bani, rândul „Kelion, de capul lui" —
scrie ultima trecere: ce a pornit singur, sau de ce nu. Dacă rândul lipsește sau
e vechi de ore, bucla nu merge; nu se presupune că merge.

**Bariere: niciuna dintre ale mele.** Pusesem un plafon zilnic și un abandon
după trei încercări. Nu mi le ceruse nimeni — sunt scoase (30 iul, PR #593).
Rămâne „un singur ordin odată", care nu e o permisiune: lucrătorul ia oricum un
ordin pe rând.

**După 3 încercări, IESE ȘI CAUTĂ** — cerința ta, și e echilibrul corect: nu
renunță, dar nici nu se învârte. Schimbă metoda: browser pe mesajul exact de
eroare și pe documentația oficială → studiu pe date reale → **își instalează**
ce-i lipsește → alt drum, motivat în PR. Ca un pas greu să nu blocheze restul,
sarcinile se iau în ordinea „cine a fost încercat de mai puține ori".

**Își cunoaște inventarul.** Lista completă a capabilităților lui, grupată, îi
intră în minte la fiecare tură — în chat și în munca autonomă — cu regula: nu
ceri voie pentru ce ai, și nu spui „nu pot" pentru ceva ce e în listă. Se derivă
din registru, deci nu poate rămâne în urmă (are test).

**Agenții sunt echipați la full (30 iul, PR #591).** Constructorul avea șapte
unelte — putea scrie cod, dar nu putea deschide un site și nu putea pune o cheie.
Acum are browserul real (9), secretele (3), baza de date, sănătatea proprie,
runbook-urile de pe server și `request_repair`. Ordinul de portal pe care i-l
scrisesem era **imposibil** pentru el; ar fi picat de trei ori și ar fi părut că
agentul e prost, când de fapt eu îl trimisesem unde nu avea mâini.

**Cine intră pe portal (30 iul, hotărât de tine): EL.** „Are liber 1000000% să
folosească tot ca să obțină scopul meu." Browserul lui e real (9 unelte,
Playwright pe server) și de azi are și mâinile ca să-și pună singur cheile. Deci
lanțul GoCardless — cont, secrete, legarea băncii, publicarea cheilor — e al lui
cap-coadă. **Singurul pas care rămâne al tău** e aprobarea din aplicația Revolut,
fiindcă legea (PSD2) cere ca titularul contului s-o dea. O apăsare.

**Ce NU pot promite:** că modelul constructorului duce fiecare pas din prima.
Constructorul rulează, structural, pe un model gratuit (`:free`) — o regulă pusă
tot la cererea ta, pe 27 iul, ca să nu mai poată arde bani din greșeală. Modelele
gratuite povestesc uneori în loc să folosească uneltele. Dacă un pas se blochează
la trei încercări din motivul ăsta, se vede în panou și **singura pârghie e a ta**:
`CONSTRUCTOR_MODEL` pe un model plătit + `CONSTRUCTOR_ALLOW_PAID=1`. Nu ți-am
schimbat-o eu, fiindcă sunt banii tăi și regula e a ta.

---

## H. CELE ȘASE ALE UNUI KELION AVANSAT — livrate 30 iul, noaptea

> „Ce mai trebuie să aibă un Kelion avansat?" · „fii onest și adu lumină" ·
> **„da, și cele 6 trebuiesc, dar NU frâne."**

Lista a ieșit din ce s-a **măsurat** în ziua aia, nu din broșură. Regula ta peste
toate: niciuna nu are voie să devină limită pentru el.

| # | Ce | Unde se vede | De ce nu e frână |
|---|---|---|---|
| 1 | **Memoria deciziilor** | tabela `cerinte` | îl scutește să reintre în ziduri, nu-l oprește |
| 2 | **Captarea cerințelor** | `cerinta_noua` din chat și voce | notează ce ceri, cu criteriul scris înainte |
| 3 | **Prioritatea** | `cerinta_prioritate` (1 = arde) | schimbă ORDINEA, nu ce are voie |
| 4 | **Verificarea proprie** | probează pe live ce a livrat | dacă pică, EL repară |
| 5 | **Costul + maneta ta** | Admin → Bani | unul măsoară, celălalt e comanda TA |
| 6 | **Restaurarea probată** | runbook `proba-restaurare` | dovedește plasa, nu limitează munca |

**Peste listă:** reanaliza continuă — când n-are ce duce, își reia ce a livrat și
întreabă „se putea mai bine, acum?". Ce iese devine cerință nouă.

**Ce NU e dovedit, și n-o ascund:** proba de restaurare **nu a fost rulată**.
Rulează prin mașinile de build GitHub, picate de pe la 16:18 (joburile mor în
2-3 secunde, înainte de primul pas; jurnalele dau 404, deci motivul exact nu se
poate citi). Runbook-ul e scris, corect și sub test. Se rulează când revin.

**Ce rămâne al tău:** B5 (cheia `sk_live`, un click în dashboardul tău) și B8
(arderea — acum ai cifra la vedere, deci decizia e informată).
