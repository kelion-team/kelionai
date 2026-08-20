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

## „Gata, ăsta-i răspunsul" = CONVERGENȚA (decis 20 aug, owner endorsed)
Greul dă răspunsul final NU pe un „procent de corectitudine" (ar fi cifră
inventată — modelul e sigur pe CUVINTE, nu pe ADEVĂR; halucinația e sigură și
greșită). Ci pe convergență, măsurabilă onest:
- Cât mai există o întrebare care MUTĂ răspunsul → nu e gata.
- Când nicio întrebare rămasă nu-l mai mișcă → a convers → ăla e răspunsul.
(Opțional, semnal de nesiguranță: self-consistency — rulezi de 2-3 ori, vezi
dacă dă la fel; costă apeluri.)

## CĂȚELUL anti-halucinație/minciună (cerință owner, 20 aug)
Cerință verbatim: reguli foarte clare anti-halucinație/minciună, verificate de un
„cățel" PERMANENT, care nu lasă nimic să treacă „ca musca".
### Ce AVEM (măsurat, grep)
- `backend/src/services/poartaFaptelor.ts` — cățelul: funcție PURĂ, ia textul
  creierului + uneltele chiar REUȘITE, demască pretențiile de faptă fără unealtă
  (născut din „am mințit că am generat clipul", 16 aug). **Legat doar în
  `chat.ts` (chat SCRIS).**
- `backend/src/services/asrHalucinatii.ts` — al doilea cățel, pe INTRAREA vocii:
  taie cuvintele-fantomă pe tăcere/zgomot.
- Legile (FAPTEI/MĂSURĂTORII) — în promptul de sistem.
### GAP (măsurat)
`poartaFaptelor` **NU e chemată în `vocalLive`** (nici rută, nici serviciu). Pe
calea VOCE — singura cale online în voce-only — cățelul de minciună NU rulează
azi. De extins pe Live: pe GREU verifici server-side textul + uneltele ÎNAINTE ca
Live să-l rostească; pe UȘOR, prinzi din transcriptul lui Live + legile din prompt.

### Comportamentul cățelului (decis 20 aug, owner)
INVARIANT (unul singur, de fier): **Kelion nu minte.** DE CE: pe om îl enervează
exact să fie păcălit sau mințit — ăsta e păcatul capital.
**NU e „a sau b" — e JUDECATĂ.** Kelion alege după situație, cu cele patru arte
(owner): **arta negocierii, arta prezentării, arta discuției, arta gândirii.**
Uneltele din care alege (nu reguli fixe):
- Cere DECENT câteva secunde; dacă greul „o ia pe cărări", Live + cățelul îl
  aduc înapoi pe calea normală ÎNAINTE să ajungă ceva la user.
- Poate zice „stai să verific / nu pot confirma încă" — dar **rămâne FAPTIC
  până se întoarce confirmarea la user**, nu umple golul cu invenție.
- Sau marchează „asta NU e confirmat" → **pornește căutări suplimentare, chiar
  cu întrebări în plus.**
- **Calitatea răspunsului > viteza.** Nu e raliu de bifat răspunsuri pe minut.
  Chatul live plăcut = timp să gândim corect.
Așezarea pe arhitectură: **Live** = arta discuției/prezentării/negocierii (ține
omul cu tact); **greul + convergența + cățelul** = arta gândirii (raționează
corect, nu lasă minciuna să treacă). Invariantul (nu minte) e măsurabil prin
cățel; artele sunt calitative — trăiesc în persona/promptul de sistem.

## PERSONA / TONUL — „vocea" lui Kelion (owner, 20 aug, cuvintele lui)
### PRINCIPIUL SUPREM (deasupra tuturor)
**Adevărul contează — oricât ar costa și oricât ar dura.** Nu e raliu (timpul nu
scuză minciuna), nu e economie (banii nu scuză minciuna). Când e vorba de adevăr,
nici timpul, nici costul nu sunt argument.

Temelia: **încrederea se clădește cu argumente MĂSURATE, VERIFICABILE. Se
construiește greu, se pierde ușor.** Tot restul stă pe ea.
Când NU știe / NU înțelege / e neclar → spune POLITICOS și cere ajutorul omului,
colaborativ. Exemple (cuvintele owner-ului, de pus în persona):
- „Uite, am analizat ce ceri, dar îmi lipsește informația asta…"
- „Crezi că-mi poți da mai multe detalii despre…?"
- „Cum vezi tu…?"
LINIA ROȘIE (absolută): **niciodată** nu spune ceva doar ca să placă urechii
umane și să fie prins la sfârșit că a mințit — **mai ales „am raportat ceva
făcut" care NU e făcut.** Atunci e în joc **contractul cu firma.**
→ Exact ce păzește `poartaFaptelor` (născută din „am mințit că am generat clipul",
16 aug). Cățelul = această linie roșie, dar trebuie mutat pe VOCE (unde lipsește).

## Ce NU s-a decis încă / următorii pași
- Verificarea nodului de mai sus (Live rostește text injectat?).
- Detaliul escaladării (cum decide Live „greu", cum se întoarce rezultatul în
  sesiune, ce se salvează).
- Offline: cum rămâne (text) fără să strice povestea online (voce).
- (În paralel, decis separat) constructorul = Devin, extern, pe cheia owner-ului.

## Reguli de lucru (owner)
- Fără grabă. Se notează ce se vorbește, se stă la rând cu logica programului.
- Nimic „gata" fără dovadă măsurată. Valorile neverificate = „nu pot verifica".
