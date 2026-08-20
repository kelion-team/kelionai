# DRAFT — Kelion voce-only (proiect în lucru cu Adrian, 20 aug 2026)

> Document de LUCRU. Deciziile de mai jos sunt luate împreună cu owner-ul, pas cu
> pas. NU e implementat nimic încă — întâi batem logica, apoi codul.

## Problema care a pornit totul
Chatul vocal „pornește 2 sec și se rupe". Cauză MĂSURATĂ live
(`/api/vocal-live/stare`: `cadreAudioDeLaGoogle:15`, `cadreAudioSpreBrowser:9`,
`suprimateDupaTaiere:6`): **două motoare de voce se bat.**
- **Gemini Live** (`vlRef`) — full-duplex, are gura lui, pentru VORBIT.
- **Chirp** (TTS pe server, `{audio}`) — pentru SCRIS.
Pe o tură VORBITĂ pornesc AMÂNDOUĂ; Chirp îi cere gura lui Live → trimite
„întrerupe" → Live e tăiat la ~2s. De-aia se rupe.

## DECIZIA (arhitectura țintă)
1. **Online = chat audio LIVE, DOAR voce. Fără scris pe ecran.**
2. **Un singur motor: Gemini Live.** Fără Chirp online → **zero coliziune → bug-ul dispare din rădăcină.**
3. **Textul se folosește DOAR la salvare** (transcript → memorie/istoric), **invizibil** — nu se afișează, nu se rostește a doua oară.
4. **Scrisul rămâne DOAR pe offline** (rezervă, WebLLM Qwen — el n-are voce live, n-are net).

## Treapta superioară (escaladarea) — logica
1. Vorbești → Gemini Live te aude.
2. Live judecă: UȘOR (conversație) sau GREU (unealtă / gândire adâncă / acțiune)?
3. **Ușor** → Live răspunde singur, cu vocea lui. O gură.
4. **Greu** → Live cheamă serverul (ușa `cere_creierului`), care rulează:
   - creierul PUTERNIC (Gemini Pro),
   - + uneltele (Google, acțiuni).
   Serverul întoarce răspunsul ca TEXT.
5. **Rezultatul greu se rostește tot de Gemini Live** (se dă înapoi în sesiunea
   live), NU de Chirp. Așa rămâne un singur motor.

## NODUL — VERIFICAT DIN COD (20 aug, nu ghicit)
Întrebarea care decidea tot: **poate Gemini Live să rostească, cu vocea lui, un
text venit de la server (rezultatul de la creierul greu)?**
**RĂSPUNS: DA.** Dovadă în `backend/src/services/vocalLive.ts`:
- Live scoate GREUL ca **apel de funcție = TEXT/JSON** (`toolCall.functionCalls`,
  ~l.480–483). NU e audio între Live și superior.
- Serverul rulează creierul superior (Gemini Pro + unelte) și dă rezultatul
  înapoi tot **TEXT/JSON** (`toolResponse.functionResponses`, ~l.743).
- Live primește textul și **rostește el, cu vocea lui** (audio spre user). Există
  și `anunta(text)` = server bagă un text, Live răspunde cu gura lui
  (`clientContent … turnComplete:true`, ~l.561/730).

### CANALUL ușor↔greu = TEXT, NU audio (întrebarea lui Adrian, răspuns măsurat)
- Audio e DOAR user↔Live.
- Între Live și creierul superior: **funcție (apel + răspuns), text/JSON.**
- „Live vorbește audio cu superiorul pe canal ascuns" — **nu există.**
- „Se face text → superior → text înapoi → Live aduce audio" — **exact asta e.**

### Consecința
**Un singur motor (Gemini Live) e de ajuns, inclusiv la GREU. Chirp NU e necesar.**
Cinstit: implicit Live REFORMULEAZĂ, nu citește cuvânt-cu-cuvânt. Când vrem EXACT
(cifră, adresă), îi punem în instrucțiune „rostește exact textul dintre
ghilimele". Reglabil, nu blocaj.

## GREU = perioada de gândire e TRIERE ACTIVĂ în doi (decis 20 aug — ideea owner-ului)
Cât creierul greu macină (puțin sau mult), Live NU stă degeaba și NU doar amână:
1. Live lucrează CHIAR perioada de gândire: află detalii despre cerință, culege
   cât mai multe date (întreabă userul + GPS/cameră/monitor pe care le are deja).
2. Fiecare informație utilă → o **injectează subtil** creierului greu (canal
   text/funcție) → îi scade numărul de posibilități.
3. Creierul greu poate cere înapoi: „întreabă asta, află asta" → Live o rostește.
4. Așa se face o **triere/scurtare** în doi → se ajunge la un răspuns cât mai PRECIS.
- Efect: „așteptarea" devine conversație utilă, nu tăcere. Ăsta e rostul de a
  avea un creier LIVE în față, nu doar o gură.
- Plasă (guardrail): se pun DOAR întrebările care taie cel mai mult din
  posibilități; te oprești când e destul de precis — nu interogatoriu.
- Owner (20 aug): schimburile ușor↔greu sunt DEJA foarte rapide; chatul live
  oferă timp cât gândește; întrebările către om trebuie să fie DECENTE
  (rezonabile ca număr), nu un interogatoriu.

### Ce avem deja / ce e NOU (măsurat)
- AVEM: Live culege GPS/cameră/monitor și le trimite; poate injecta text
  (`anunta`/`trimiteRand`); bucla unealtă apel→răspuns.
- NOU (inima build-ului): creierul greu nu mai e un apel „o dată și gata", ci o
  BUCLĂ dus-întors (primește date incremental + cere înapoi întrebări) până
  converge. Compromis pe față: mai multe runde = mai multe apeluri (latență+cost);
  trocul bun = Live te ține în conversație instant, precizia vine în câteva runde.

## Ce NU s-a decis încă / următorii pași
- Verificarea nodului de mai sus (Live rostește text injectat?).
- Detaliul escaladării (cum decide Live „greu", cum se întoarce rezultatul în
  sesiune, ce se salvează).
- Offline: cum rămâne (text) fără să strice povestea online (voce).
- (În paralel, decis separat) constructorul = Devin, extern, pe cheia owner-ului.

## Reguli de lucru (owner)
- Fără grabă. Se notează ce se vorbește, se stă la rând cu logica programului.
- Nimic „gata" fără dovadă măsurată. Valorile neverificate = „nu pot verifica".
