# Ce nu e făcut și ce nu merge — inventar

> Adrian, 30 iul: „pune pe listă tot ce nu ai făcut din proiect, tot ce nu merge,
> că mă ia capul."

## ⭐ CRITERIUL DE „GATA" (owner, 14 aug: „când voi avea aplicația gata, ca produs final funcțional?")

**Definiția convenită (nu o dată din aer):** produs final = fiecare funcție promisă
merge pentru un utilizator care plătește, iar când ceva pică, sistemul **vede
singur, strigă singur, repară singur** — fără Adrian pe post de babysitter.
**Proba de GATA: 7 zile la rând** în care (a) Adrian nu repară nimic cu mâna,
(b) becurile stau verzi pe PROBE reale, (c) zero bug nou raportat de el —
self-heal duce singur ce apare. Nimeni nu declară „gata" în avans; o arată calendarul.

**Lista cunoscută rămasă până la probă (14 aug, seara):**
- [ ] ORDIN 15 aug (captura Vizitatori): „vizitatori nu au poză... de ce nu e
      legată de vizitator" — FAPTE: vizitele se nasc pe server (IP/UA/pagini),
      camera nu e pe drum; pozele trăiesc în faceprints cu cheia user_email.
      DE FĂCUT legătura cinstită: (1) la logare, vizitele aceleiași sesiuni/
      ferestre IP+browser se leagă de cont → rândul de vizitator primește poza
      contului (acoperă chiar rândurile ownerului dinainte de logare);
      (2) oaspeții care dau voie camerei în demo → captură legată de vizită
      (simetric cu amprentele vocale de oaspete). Boții rămân cinstit fără. [ ]
- [ ] ORDIN 15 aug: dovezile de autonomie 6 și 7 („vede ce îi lipsește și
      construiește"; „își reanalizează soluțiile livrate") — de APRINS pe
      dovadă reală: bucla golurilor triate există (triageGaps), dar niciun gol
      n-a ajuns REZOLVAT cap-coadă; cerințe cu sursa='kelion' nu s-au născut
      încă. ÎN LUCRU. [ ]
- [x] ORDIN 15 aug (verbatim): „constructorul dacă are o eșuare, următoarea
      tură o escaladează automat pe nivel superior Fable 5. Nu pornește
      duplicat pe același model, se revine pentru un nou job la primul model."
      — SCRIS: agentul trimite attempt-ul la /api/constructor/creier; tura ≥2
      → Fable 5 conduce (Gemini doar plasă de avarie), job nou → iar Gemini;
      lacăt: escaladareConstructor.test.ts. ATENȚIE: escaladarea e REALĂ doar
      cu ANTHROPIC_API_KEY VALIDĂ pe VPS — cea de acum e invalidă (măsurat
      14 aug); până o schimbă ownerul, tura escaladată cade cinstit pe plasă.
- [ ] ORDIN 15 aug (captura Sign-in + verbatim): „nu mai are voie să pună doar
      poza — tot ce pune pe monitor trebuie să fie apelabil, selectabil,
      adresabil": tab-urile cu URL primesc linkul REAL clicabil («deschide în
      tab»); suprafețele Google cu zid de logare (iframe-ul nu poate loga —
      Google blochează) se deschid în tab nou cu sesiunea ownerului, nu în
      ramă moartă; interzis screenshot în loc de suprafață vie. DE FĂCUT.
- [x] ORDIN 15 aug (verbatim): „am nevoie de un sistem care anulează echo" —
      SCRIS: (1) AEC pornit pe DESKTOP, stins doar pe mobil (istoricul #1006:
      procesarea WebRTC rupea A2DP pe Android — rămâne apărat); (2) poarta
      half-duplex din 13 aug avea coada de ecou prea scurtă (0,25s < latența
      element-audio + boxe) și judeca audibilul doar din ceas → coadă 0,6s +
      sursele vii numără; (3) LACĂTUL AUZULUI în verifica-gemini (regulaAuzul:
      AEC !eMobil + poarta + coada ≥0,5s) — rulează pe poarta VPS; contractul
      vechi din lacat.test (false peste tot) adus la adevărul nou, cu istoria
      scrisă. PROBA OWNERULUI după publicare: o conversație pe voce, pe boxe —
      Kelion nu se mai taie singur; întreruperea TA încă merge.
- [x] ORDIN 15 aug (verbatim): „acest lucru trebuie să fie monitorizat de
      Kelion" — publicarea care STĂ (dovedit azi: 2+ ore, live pe f3440b9 cât
      master avansase de 2 ori; stagnarea nu scrie erori → senzorii pe erori
      n-o vedeau). SCRIS: santinelaPublicarii (ciclu 5 min): sha propriu vs
      vârf master; peste prag (20 min, env) → alarmă O DATĂ în panou + pe
      telefon, cu coada auto-publicare.log lângă (cauza, nu doar simptomul);
      la revenire → „și-a revenit", o dată. RĂMAS (brațul 2): la alarmă,
      remedierea din runbook rulată SINGUR (deblocare deploy atârnat/restart
      cron/curățenie disc), cu jurnal — omul strigat doar dacă pică și asta.
- [ ] ORDIN 15 aug (captura „Ce vezi în această imagine?" delegată la
      cheama_agent, 20%, fără sfârșit): „alocă, dar nu are consistență și
      finalizare" — (1) întrebările cu imagine se răspund NATIV (creierul
      vede singur; delegarea pierde imaginea), cheama_agent interzis pe ele;
      (2) ORICE delegare primește timeout + verdict raportat (gata/eșuat cu
      motiv), niciodată agonie la 20%. DE FĂCUT.
- [ ] ORDIN 15 aug, dimineața („aplicațiile din butonul Aplicații, de la
      Google, trebuiesc TOATE funcționale, nu doar poze — interconectare reală
      și funcțională"): fiecare intrare din meniu trebuie să ducă REAL la
      API-ul Google (meniu → comandă → unealtă → googleapis.com). SCRIS AZI:
      lanțul există pe toate; DE FĂCUT: (1) verificator de lanț ca poartă
      (meniu ↔ capabilitate ↔ unealtă ↔ apel API — să nu poată rugini în
      „doar poze"); (2) probele pe ecranul ownerului: RECONECTARE Google o
      dată (scope-urile noi Photos/Slides/Forms au intrat DUPĂ consimțământul
      lui vechi), poarta separată YouTube, aprobarea Business Profile. [ ]
- [x] ORDIN 15 aug (verbatim): „ordinele de rezolvat nu au voie sa se dubleze
      nici o data" — ușa unică createBuildJob refuză dublura pe amprentă
      (fără ore/sha/contoare); ordin încheiat nu blochează („reia" rămâne);
      lacăt: dublareOrdine.test.ts. LIVE după următorul merge.
- [x] ORDIN 15 aug: „analizează de ce se blochează ordinele + dă-i gândirea să
      le ducă la final" — găsit: reîncercările din coadă plecau AMNEZICE
      (text original, fără escaladare, fără logul eșecului, cu ancora „ăsta
      e" lipită → #293 murea identic de 3 ori). Acum /api/constructor/next
      dă la reîncercare: schimbă-metoda + coada logului mort + ancora scoasă
      + pasul 0 („cauza mai există pe master-ul proaspăt? nu → închide
      cinstit") + granițele mediului (fără ecran/camera → calea din app).
- [x] ORDIN 15 aug (captură + F12): [CHAT MUTE] — flash a păginat db_query
      ×18, sinteza a stat 37s pe server și a întors gol ×3 → „încearcă mai
      târziu". Plasa oglindită pusă: fața rapidă epuizată → o urcare unică pe
      creierul profund. De probat live: aceeași întrebare grea nu mai moare.
- [x] ORDIN 15 aug (captură): „refă încadrările pe partea de sus, folosim
      selectorul de limbă" — selectorul constructorului era scris în Tailwind
      (inexistent în proiect): meniul nu se închidea niciodată. Re-croit pe
      tiparul casei (ca Aplicații: stare+backdrop+meniu absolut), un rând,
      închis implicit. De văzut pe ecran după publicare.
- [ ] ORDIN 14 aug, 21:10 („toate aplicațiile trebuiesc"): TOATE aplicațiile
      Google interconectabile se fac, în ordinea: (1) Photos (Picker API —
      flux propriu de ales poze) — SCRIS, pe #1118 (9b2b9369), de probat live;
      (2) YouTube upload (consimțământ SEPARAT, nu poate sta lângă Drive) —
      SCRIS, pe #1118 (09c07dc0): poartă `/auth/google/connect-youtube`,
      urcare privată implicit, unealta `youtube_urca`, registru 113 — de
      probat live cu un clip real; (3) notificări pe telefon — SCRIS (14 aug,
      noaptea): Web Push cu VAPID, NU cont Firebase (același canal standard pe
      care browserele îl duc prin FCM, dar zero conturi, zero chei de pus de
      owner — perechea VAPID se naște singură în kv_state); butonul „🔔 Pe
      telefon" în capul adminului; orice notifyAdmin (pr_gata al santinelei,
      alarme) zboară și pe telefon; de probat live: pornește butonul, apoi
      un „PR gata" trebuie să sune telefonul; (4) Business Profile — SCRIS
      (14 aug, noaptea, PR-ul de după #1118): poartă separată
      `/auth/google/connect-business` (scope sensibil, NU în FULL_SCOPES),
      unealta `business_vezi` (cont + locații), registru 114, meniu + manual;
      PAȘII OWNERULUI ca să prindă viață (API-ul are cota 0 până la aprobare):
      în Cloud Console pe proiectul aplicației pornește „My Business Account
      Management API" + „My Business Business Information API", apoi
      completează formularul oficial „Business Profile APIs access request"
      cu numărul proiectului; după emailul de aprobare — nimic de cod. Fiecare: un PR,
      intrare în meniul „Aplicații", rând în manual, tarif unde costă bani,
      porți verzi + probă live. Deja legate azi: Slides, Meet, Forms (#1116).
      Imposibilele rămân marcate cinstit (Keep = doar enterprise, Google Pay ≠
      procesator, Fit = mort).
- [ ] GĂURILE DE POARTĂ prinse pe viu (14 aug, noaptea): poarta VPS nu rula
      NICI verifica-butoane (bara de deploy din #1122 a intrat pe master cu
      ambele apeluri în gol — rute fără prefix, la rădăcină — și verdictul a
      fost TRECE), NICI lacătul Gemini (a zăcut crăpat pe master cu
      ReferenceError și tot TRECE se posta). SCRIS: ambele adăugate în
      ruleaza_portile + rândurile lor în raport; rutele deploy reparate (căi
      complete + gard x-bridge-secret pe POST). De probat live: primul raport
      de poartă de după deploy trebuie să aibă 9 rânduri, nu 7.
- [ ] ORDIN 14 aug, 20:45 („când apare ceva scris de la Kelion, obligatoriu e
      și audio"): ORICE text al lui Kelion se și rostește — inclusiv turele
      scrise, ack-urile și rezultatele. De legat sinteza (aceleași frame-uri
      {audio} care merg pe voce) și pe calea scrisă; de măsurat costul TTS
      înainte de a-l face implicit pentru userii plătitori. URMĂTORUL PR.
- [ ] Santinela PR (nou, 14 aug noaptea): scrisă + teste verzi, dar NEPROBATĂ live —
      dovada cerută: un PR verde anunțat în panou cât ownerul e logat, și unul
      îmbinat de Kelion singur (cu jurnalul în Notificări) cât e delogat.
- [ ] Bara de execuție cu punctulețe (nou, 14 aug noaptea): scrisă, de văzut LIVE
      pe un ordin real („fiecare pas pe monitor, 0→100%").
- [ ] ORDIN 15 aug (după raport): soldul Gemini se citește AUTOMAT — „valoarea
      reală" — SCRIS (PR-ul de după #1142): soldul se DERIVEAZĂ per credit din
      exportul BigQuery (`credits.full_amount` − aplicat, toată istoria) în
      `soldCrediteGoogle()`; pastila (bară + admin) arată cifra derivată sau
      motivul cinstit („aștept exportul" / pasul de consolă) — NICIODATĂ un
      număr declarat; butonul «✎ credit Gemini» + ruta de declarare AU MURIT
      (410 cu motiv), cheile moarte scoase din toate cele 7 limbi. DE PROBAT
      LIVE după ce exportul scrie primele rânduri (ore): pastila trebuie să
      arate singură soldul real din AI Studio, fără nicio mână.
- [ ] Scutul datelor: de PROBAT live după deploy (un DELETE de test pe
      voiceprints prin db_query trebuie refuzat cu «tabel_protejat», iar
      triggerul din Postgres să apară în \d voiceprints).
- [ ] Auditul „fiecare buton din admin, pe realitate" (ordinul din 14 aug,
      noaptea): trecerea buton-cu-buton PE COD s-a făcut (14 aug, noaptea, 2 —
      53 de butoane; găsite și reparate: „Close" englezesc, „merge-ul îl dai
      tu" depășit, butonul „Șterge" user care promitea interzisul, pozele
      lipsă la useri). Rămâne CONFRUNTAREA PE LIVE, tab cu tab, după deploy.
- [ ] „Timbrul nu e salvat" (owner, 14 aug, live): drumul din cod e întreg
      (chat.ts → saveVoiceprint la prima voce sau la potrivire; scutul NU
      blochează INSERT/UPDATE). De măsurat pe live: (1) `db_query`:
      `SELECT count(*), max(updated_at) FROM voiceprints`; (2) client_errors
      pe extragerea de trăsături; (3) o tură de voce a ownerului → reapare
      rândul în Amprente? Cauza se caută ÎNTÂI în codul nostru (regula #2).
- [ ] Vizitatorii nu au poze — PRIN CONSTRUCȚIE (widgetul de vizitatori n-are
      cameră): nu e bug, e o limită. Dacă ownerul vrea capturi și la
      vizitatori, e o decizie de produs (consimțământ + cameră în widget) —
      de discutat, nu de „reparat" pe tăcute.
- [ ] Vocea live îngheață după câteva schimburi de fraze (ordinul #233, în coadă).
- [ ] Camera: nu capturează după accept + delay mare la pornire — instrumentată azi
      (jurnal `[cameră]` + eroare la >5s până la primul cadru); cifra fazei vinovate
      vine din primul test live al ownerului.
- [ ] Împerecherea biometrică voce+față (cerută 14 aug) — neîncepută.
- [ ] Reducerea testelor (>1400) fără tăierea lacătelor de bani/securitate — necerută încă o trecere.
- [ ] Cheia `ANTHROPIC_API_KEY` de pe server e INVALIDĂ (măsurat 14 aug la Anthropic);
      cheia NOUĂ validă există (probată: „Rezerva funcționează.") — de pus prin
      `secret_pune` + `secret_publica`. Până atunci becul Fable 5 stă ROȘU pe drept.
- [ ] Estimarea de credit Gemini („£0.00") e declarativă și veche — de re-declarat
      în Admin → „credit Gemini" ca cifra să însemne ceva.
- [ ] Proba vie a constructorului pe 3.7-flash: un ordin dus cap-coadă cu
      „Creier folosit: gemini/gemini-3.7-flash" în PR (după deploy #1095 → „reia" pe #233).
>
> Lista asta e făcută din COD și de pe LIVE, nu din memorie. Fiecare rând are
> dovada lângă el. **Se actualizează la fiecare sesiune** — un rând rezolvat se
> taie cu data și PR-ul, nu se șterge.
>
> Ultima verificare: **30 iul 2026, 09:10**, live `e66e84c` = master, health 200.
> Sesiunea din 30 iul a publicat 10 lucrări (PR #565–#576) și a tăiat 7 rânduri.

> **14 aug 2026 — CONSTRUCTORUL PE GEMINI → FABLE 5 (ordinul #213 / RunPod 402 reparat în cod). ⏳ de verificat LIVE de owner.**
> Owner: „schimbă-mi constructorul cu gemeni ultra… când nu merge repara să cadă
> pe fable 5, înlocuiește peste tot" + „să schimbi și în afișaj AI corect" + „nu mai
> bag bani". CAUZA (din emailurile #213): constructorul pe RunPod, `402 out-of-balance`
> îi omora ordinele. **Reparat, respectând regula 13 aug (constructorul NU ține chei
> de furnizor):** creierul e PRIN APP, pe `/api/constructor/creier` — app-ul rulează
> Gemini „ultra" (Pro, `geminiModelGreu`) ca PRINCIPAL și cade pe Fable 5 (`claude-fable-5`,
> `ANTHROPIC_API_KEY` în app) ca REZERVĂ; revenirea pe Gemini e automată (fiecare pas
> reîncepe cu principalul). Constructorul: scos creierul propriu RunPod/DeepInfra;
> `runpodBalance.ts` șters. **Afișaj:** becul „RunPod" → „Fable 5 (rezerva
> constructorului)" (verde=cheie pusă / roșu=lipsă, nu gri); pastila Gemini marcată
> creier PRINCIPAL al constructorului; câmpul `runpod` din admin + pastila AdminPanel
> scoase. Porți: backend tsc 0 · **1316 teste** · frontend build 0 · sintaxă/exporturi/jscpd 0.
> **NU POT VERIFICA LIVE** (fără acces VPS): owner-ul (1) pune `ANTHROPIC_API_KEY`
> (console.anthropic.com → API Keys) în `/root/kelion/kelionai.env` ca rezerva Fable 5
> să fie activă — fără ea, DOAR Gemini, spus onest; (2) trimite un ordin real → raportul
> arată `Creier folosit: gemini/…` (sau `fable5/…` la cădere).

> **13 aug 2026 — GDPR + AEC + CONSTRUCTOR (poartă calitate) + BECURI pâlpâie. ✅ (PR #1079, LIVE-ul = merge-ul lui Adrian)**
> Patru cerințe din aceeași zi, pe ramura `claude/reparatie-cu-rosu-uokj4m`:
> - **GDPR**: poartă blocantă de consimțământ foto (Landing + Stage; refuz = fără
>   acces; `/credite` și `/manual` publice). „Ce au vizitat" în raport: coloană
>   `pages` pe `visits`, fiecare pagină își anunță secțiunea, strânse DISTINCT pe
>   rând; cardul de vizitator arată „a vizitat: …", rândurile vechi spun cinstit
>   „secțiuni: neînregistrate". Buton admin-only „Golește baza de vizitatori"
>   (declanșat de owner; șterge doar `visits`; rezultat măsurat).
> - **AEC half-duplex**: microfonul e fără echoCancellation (ca ieșirea să prindă
>   Bluetooth) → Kelion își auzea ecoul → „varză". Fix: cât e audibil (redare +
>   coadă 250ms) se trimite TĂCERE la creier (`vocalLive.ts`). Preț: fără barge-in
>   vocal cât vorbește (server barge-in oricum OFF). Verificare LIVE = a lui.
> - **Constructor**: poartă de calitate (`evalueazaOrdin`, pură + testată) — „să
>   treacă orice ordin?" NU: ordinele goale/vagi/în-afară RESPINSE cu motiv,
>   ENFORCED în POST (400). AI-uri pe capacitate + credit live (Constructor local,
>   Jules, Creier 2; roșu ≈ exclus) + panou de evaluare + endpoint `/evalueaza`.
>   RĂMAS: dispatch explicit la Jules din tab (acum recomandarea e informativă).
> - **Becuri**: roșul (gol/402) PÂLPÂIE (owner: „când e gol becul pâlpâie roșu").
> - **Auto-alimentare Revolut — NU e posibilă complet fără om** (măsurat,
>   `billing.ts`): Revolut Pro n-are API de charge / webhook; linkul e „pull la
>   tapul userului". Ce EXISTĂ deja (cel mai bun posibil): pre-armarea reîncărcării
>   la prag + un tap. Auto-charge real = alt procesator (Stripe/mandat) = decizie
>   de business a owner-ului. NU am inventat o alimentare care nu poate mișca banii.
> Porți: backend tsc 0 · 1315 teste (145 fișiere) · frontend build 0 · 46 teste ·
> jscpd 0 · exporturi 0 · sintaxă 0. **Nu pot verifica LIVE** din headless — se
> confirmă pe telefonul lui, DUPĂ merge-ul PR #1079 pe master.

> **13 aug 2026 — CREIERUL 2 LEGAT LA CONSTRUCTOR (fallback 24/7) + model creier-2 dezînțepenit. ✅**
> Owner, cu dovadă: „creierul 2 nu e legat la constructor, am verificat… de aia
> TOATE ordinele sunt eșuate; supervizează 24/7." DOVADA (în cod, regula #2):
> `deploy/constructor-agent.mjs:791` scria explicit „UN SINGUR creier… NU cade pe
> alt creier" — deci când DeepInfra pica toate cele 6 încercări, ORICE ordin murea.
> FĂCUT: (1) endpoint `POST /api/constructor/creier` (gardat x-bridge-secret) care
> rutează cererea constructorului (format OpenAI) la creierul 2 (Gemini) prin
> `geminiDirectChat` + înregistrează costul; conversia de format e într-un modul
> PUR + testat (`services/creier2Constructor.ts`, `creier2Constructor.test.ts`,
> 5 teste). (2) `llm()` din constructor cade pe `llmGemini()` (prin app) când
> creierul propriu pică — nu mai moare pe furnizorul sufocat. (3) DOVADA #2:
> `modelCreierProfund` era `gemini-3.1-pro-preview` (versiunea 3.1 EXPIRATĂ) în timp
> ce modelul viu, validat, e 3.5 → creierul 2 din CHAT pica tăcut pe flash → „creier
> 2 nefuncțional" + Kelion orb pe admin (modelul slab nu cheamă uneltele). Acum
> `modelCreierProfund` = modelul VALIDAT (env-overridable). LACĂTUL de la 12 aug
> („fără Gemini în constructor") MUTAT, nu rupt: constructorul tot n-are cheia
> Gemini / apel direct la Google — rescue-ul merge prin app (bridge). Porți:
> backend tsc 0 · 1289 teste · sintaxă 0 · constructor-agent.mjs `node --check` OK.
> RĂMAS: tab AI-uri selectabile pe capacitate + credit (poartă de calitate: nu
> orice ordin trece); auto-alimentare Revolut; verificare LIVE creier 2.

> **13 aug 2026 — BECURI: fals-roșu REPARAT (Gemini £9.59 & RunPod $5.84 arătau roșu) + buton individual per AI. ✅**
> Owner (capturi Google AI Studio £9.59 + RunPod $5.84): „e greșit roșu că are
> credit… ce ai scris că nu e credit era FALS." CAUZA, în codul meu (regula #2):
> `beculCredit` trata orice `ramas ≤ 0` ca roșu — dar pentru Gemini `ramas` e o
> ESTIMARE (declarat − cheltuit) care NU vede auto-reload-ul (£20 pe Aug 13) →
> roșu fals. FIX: câmp `soldReal` — doar soldurile CITITE real (Serper /account,
> RunPod clientBalance) aprind roșul pe 0; pentru Gemini becul vine din PINGUL de
> viață (servește = are credit = verde), iar estimarea rămâne doar cifra. Necitibil
> = gri, nu roșu fals. + Link-urile EXACTE de reîncărcare date de owner: Gemini
> `aistudio.google.com/billing?billing=011729-7DA3DA-87ED94`, RunPod
> `console.runpod.io/user/billing`, Serper `serper.dev/dashboard`. + „buton
> individual la fiecare ai, click = reîncărcare DIRECT": fiecare bec din bară e
> acum PROPRIUL link spre pagina furnizorului (nu un buton comun spre panou).
> Porți: backend tsc 0 · teste 10 (creditAI) · frontend tsc 0 · 43 teste · build 0 · sintaxă 0.
> URMĂTORUL: constructorul — teanc de AUTO-VINDECARE care pică pe „llm încercarea
> X/6 a picat pe DeepInfra/…" (fără plasă → creier 2 + agenți, aprobat).

> **13 aug 2026 — BARA DE SUS reorganizată: VPS sub Admin, becurile de credit în locul liber. ✅**
> Owner (captură bară): „VPS îl pui sub admin, vizibil; și în spațiul rămas pe
> linia aia pui butoanele astea [becurile]. Trading la useri momentan NU se
> afișează până nu e gata." FĂCUT: (1) pastila VPS scoasă din bara de sus și
> mutată în tabul „Sistem (VPS)" cu ACELEAȘI cifre (RAM liber, încărcare ca raport
> pe nuclee, load average) și același prag roșu — necitibil = „⚠ VPS necitibil",
> nu zerouri. (2) În locul liber din bară, `BecuriBara` (admin): un rând compact
> de becuri per AI (verde/roșu/gri din aceeași sursă server ca boardul, fără logică
> dublată) + numărul de „fără credit"; click → tabul Bani. (3) Trading rămâne DOAR
> admin (neschimbat); Adaptare CV rămâne la toți (neschimbat). Porți: frontend tsc
> 0 · 43 teste · build 0 · sintaxă 0.
> RĂMAS: auto-alimentare Revolut + bec pâlpâind (card gol); constructor autonom
> (fallback 402 → creier 2 + agenți, aprobat).

> **13 aug 2026 — BECURI DE CREDIT per-furnizor în Bani: „unde arată că are nevoie de credit?" — REZOLVAT (parțial). ✅**
> Owner: „butonul Bani trebuie redesenat să fie util… un bec roșu/verde care
> indică credit sau lipsă, click = reîncărcare; 402 = fără credit." CAUZA (măsurat
> cu agent de mapare): backendul CALCULA deja creditul per furnizor
> (`services/creditAI.ts` → `/api/admin/credit-ai`: Gemini, Serper, RunPod, Google
> Cloud, Jules, fiecare cu sold/serveste/facturare) DAR **frontendul nu-l citea
> deloc** — bara arăta doar 3 pastile, iar RunPod (care murise pe 402) nici măcar
> nu apărea. FĂCUT: (1) `beculCredit()` onest — verde=credit citit>0/servește,
> **roșu=fără credit MĂSURAT (402/sold 0)**, gri=nu pot verifica (necunoscutul NU
> se maschează în verde, regula #1); 10 teste. (2) Env RunPod împăcat
> (`CONSTRUCTOR_RUNPOD_*` SAU `_DEEPSEEK_*`) ca becul lui roșu să APARĂ, nu să fie
> ascuns. (3) Secțiune „Credit AI — becuri" în tabul Bani: rând per furnizor cu
> bec colorat + soldul/motivul + **click = pagina reală de reîncărcare**. Clasa
> `.bec-rosu.palpaie` e pregătită în CSS pentru pasul următor (auto-alimentare
> eșuată = card gol). Porți: backend tsc 0 · 1279 teste · frontend tsc 0 · 43 teste ·
> build 0 · sintaxă 0.
> RĂMAS: (a) bara de sus — VPS mutat sub Admin, becurile în spațiul liber, trading
> rămâne doar admin (până e gata); (b) **auto-alimentare de pe card Revolut** +
> bec roșu PÂLPÂIND când cardul e gol; (c) constructorul autonom: fallback rapid
> pe 402 → creier 2 (Gemini) + agenți de ajutor (APROBAT de owner).

> **13 aug 2026 — URECHEA lui Kelion: „varză" = ALIASING la decimarea 48→16 kHz — REPARAT (măsurat). ✅**
> Owner, pe vocea lui: „tot ce trimit audio = varză", „primul cuvânt nu-l aude
> corect" („Kelion" → „Kelemen"). CAUZA MĂSURATĂ în `frontend/src/lib/pcm.ts`:
> `downsample` lua `input[floor(i*ratio)]` — un eșantion din 3, FĂRĂ filtru
> trece-jos. La 16 kHz, Nyquist = 8 kHz; orice energie de peste 8 kHz (sâsâit,
> zgomot, hârâit de microfon) se PLIA (aliasing) înapoi peste voce = frecvențe
> false peste silabe → Google scoate silabe stâlcite. FIX: medie pe o fereastră
> ≈ factorul de decimare (filtru FIR box) ÎNAINTE de decimare. DOVADĂ în
> `pcm.test.ts`: ton de 15 kHz → alias PLIN pe calea veche (RMS >0.6), STRIVIT pe
> cea nouă (<0.2, de ~13×); vocea reală de 500 Hz trece cu >85% din energie.
> A 2-a cauză (mobil): în `frontend/src/lib/vocalLive.ts` contextele audio se
> creează DUPĂ 2 await-uri → nasc 'suspended' pe telefon → microfon surd / primul
> cuvânt pierdut; `resume()` pe interval „nu ajută" fără gest. Armat
> `deblocheazaAudioLaGest` pe primul tap (exact ca `openMicGraph`) — additiv,
> no-op pe desktop. **NU pot proba efectul de mobil din headless — se confirmă
> LIVE pe telefonul ownerului.** Porți: frontend tsc 0 · 43 teste (2 noi anti-alias) ·
> build 0 · sintaxă 0.

> **13 aug 2026 — KELION ORB PE ADMIN: `admin_vezi` chema hairpin-ul public, nu bucla — REPARAT. ✅**
> Owner: „în continuare Kelion nu are acces la admin… îi sabotezi activitatea
> punându-l să fie orb." CAUZA MĂSURATĂ, în codul meu (regula #2): `admin_vezi` /
> `admin_schimba` (`backend/src/services/adminVedere.ts`) chemau
> `https://kelionai.app/api/admin/<secțiune>` — adică VPS → internet public →
> înapoi la ACELAȘI VPS (hairpin-NAT + un TLS către tine însuți). Când ies
> conexiunile VPS-ului — DOVADĂ chiar în logurile lui din aceeași zi:
> „[mailbox] poll failed: Failed to establish connection in required time" /
> „[mail] send failed: Connection timeout" — fetch-ul ăsta pica la fel, iar
> unealta întorcea o eroare de rețea: Kelion AVEA unealta, dar o murea pe drumul
> pe care i-l pusesem eu. FIX: se cheamă **bucla locală** `http://127.0.0.1:${port}`
> — exact calea pe care vocea își cheamă deja creierul (vocalLive.ts), dovedită
> în producție (fără DNS, fără hairpin, fără TLS-către-sine, mai rapid); poarta de
> admin rămâne (cookie-ul e dus mai departe, aceeași rută îl validează în proces).
> În plus, „nu știe unde-s butoanele": `admin_vezi` fără secțiune (sau cu una
> inexistentă) întoarce acum **catalogul secțiunilor reale** din admin, nu o
> eroare oarbă. Porți: backend tsc 0 · 1277 teste (7 noi în `adminVedere.test.ts`) ·
> build 0. RĂMAS de verificat LIVE cu ownerul: „Kelion, arată-mi erorile din admin".
> (Separat, de urmărit: erorile `[mailbox]`/`[mail]` = conexiuni IEȘITE ale
> VPS-ului către serverul de mail extern — alt subiect decât bucla internă.)

> **13 aug 2026 — „VORBĂ = FAPTĂ": garda care lăsa Kelion să SPUNĂ ce nu face — SCOASĂ. ✅**
> Owner: „kelion se chinuie să pună ceva pe monitor, să închidă pe X… când spune
> orice, trebuie să fie executat acel orice." CAUZA MĂSURATĂ (în cod, nu presupusă):
> **modul mașină (car mode)** avea o gardă DUBLĂ care, la volan, arunca orice frame
> de suprafață vizuală (monitor/hartă/document/card) DEȘI creierul zicea că a
> deschis-o — (a) promptul „CAR MODE" din `backend/src/routes/chat.ts` îi zicea „nu
> deschide, doar spune"; (b) `permisLaVolan` din `frontend/src/components/ChatPanel.tsx`
> (`handleControl`) tăia frame-ul. FIX: ambele scoase; car mode rămâne doar UI
> voce-first + o linie de prompt care CERE „ce spui că faci, execută prin unealtă".
> A 2-a cauză (creierul NARează în limbaj natural fără să cheme unealta) NU e gardă —
> e comportament de model; plasa existentă `parseFakeToolCalls` prinde doar apeluri
> în FORMĂ de apel, nu narațiune liberă — de urmărit separat.
> **Constructor FIXAT pe `deepseek-ai/DeepSeek-V4-Pro`** (probă comparativă 13 aug:
> DeepSeek dus end-to-end 19 pași→PR #1050 merge; Qwen stâlcește editări precise;
> Kimi K3 blocat la pas 5; forțat și în `vps-set-env.yml`). **MINIM 4G** (owner: „nu
> cred că e realizabil 3G… treci 4G minim"): scoasă suprimarea de vizualuri pe 2G/3G
> + notă scurtă non-blocantă (i18n `retea4g` × 7 limbi). Porți: backend tsc 0 · 1246
> teste · frontend build 0 · sintaxă 0 · exporturi 0 · jscpd 0.

> **12 aug 2026 (NOAPTEA) — AUTONOMIA CONSTRUCTORULUI: REPARATĂ + DOVEDITĂ + LIVE (PR #1043, #1044, #1046). ✅**
> Owner: „constructorul nu merge", „Gemini? tot timpul de azi pierdut", „cind e
> autonomia gata?". Trei cauze CONCRETE, toate MĂSURATE (nu presupuse):
> 1. **Model supraîncărcat, NU cod.** `Qwen3-Coder-480B-A35B-Instruct-Turbo` pe
>    DeepInfra e supraîncărcat cronic → `engine_overloaded`, **0 tool_calls**, în
>    timp ce alte modele pe ACEEAȘI cheie cheamă uneltele pe loc. De-aia murea pe
>    „8 ture sterile". Format OpenAI de tool-calling era corect.
> 2. **Cod mort Gemini + etichetă falsă.** Monitorul scria „Gemini e sugrumat"
>    deși constructorul nu mai e pe Gemini (mutat de owner pe DeepInfra). ~250 de
>    linii `llmGemini`+helpere+`GEMINI_KEY`/`GEMINI_MODEL` — cod MORT (nu-l chema
>    nimeni, `foloseste = llmRunpod`).
> 3. **Atârna pe CI oprit.** După ce deschidea un PR BUN, aștepta checkul `verify`
>    — dar Actions e oprit pe repo (`ACTIONS_PORNIT` fals), deci `verify` iese
>    `skipped`. `verdictDinCheckRuns` citea `skipped` ca EȘEC, iar `asteaptaVerificareCI`
>    aștepta tot bugetul (9 min) pe un check care nu vine → ordinul cu PR corect
>    raporta „picat".
> **Reparat:** primar `Qwen/Qwen2.5-72B-Instruct` (măsurat: ~1s/apel, duce un ordin
> end-to-end în ~67s; DeepSeek-V3 a ATÂRNAT >9 min pe context real — nefolosibil,
> rămâne doar rezervă) + rotire pe rezerve (DeepSeek-V3, Llama) când primarul cade;
> `engine_overloaded`→AMÂNABIL; cod mort Gemini SCOS; monitorul arată furnizorul
> REAL; `skipped`→`absent` (nu eșec) + grație 90s pe CI absent; lacătul Gemini
> actualizat (creierul APLICAȚIEI neatins, constructorul păzit „NU Gemini"); README
> refăcut (îl ciuntise constructorul vechi). Porți: backend `tsc` 0 · **1239 teste**
> · lacăt 10/10 · `node --check`. **DOVADĂ CURATĂ (măsurată, live pe VPS):** ordin
> #186 → constructorul (Qwen2.5-72B) a chemat unelte, a creat DOAR fișierul cerut
> (`deploy/SMOKE-DEEPSEEK.md`, 3 linii, nimic altceva atins), a trecut toate cele 7
> porți, a împins ramura și a deschis PR corect (#1045) în ~67s, singur. Autonomia
> merge end-to-end. **CERINȚELE REALE #182/#183/#185, rulate autonom peste noapte —
> rezultat MĂSURAT, onest:** constructorul le-a atacat pe rând; TOATE au eșuat SIGUR
> pe porți (build/tsc), **niciun cod stricat nu s-a îmbinat, master intact, live 200**.
> Cauza: Qwen2.5-72B nu e destul de puternic pe fișiere existente mari — inventează
> pachete (`jooble-api`, `@mui/material`) și ciuntește fișiere cu erori de sintaxă
> (`App.tsx`, `AdminPanel.tsx`, `brainToolDefs.ts`) → porțile îl resping de fiecare
> dată. Plasa de siguranță merge PERFECT; livrarea, nu. Le-am OPRIT din reîncercări
> (status failed, attempts=9) ca să nu ardă bani la infinit; rămân în panou cu notă,
> re-lansabile cu «reia». **Ce le blochează, pe rând:** #183 (#12 CV) cere un CONT
> API extern (Jooble/Adzuna) — decizia ownerului; #182 (#11) e o funcție mare de CV
> upload, spec de clarificat; #185 (#13) e auto-publish în producție fără confirmare
> — riscant, de revizuit (istoricul „phantom deploy"). Concluzie: **autonomia merge
> mecanic + în siguranță (dovedit), dar cele 3 cerințe cer ori owner-ul (cont/decizie),
> ori un model mai puternic decât cel disponibil pe cheia curentă.**
>
> **12 aug 2026 (seara, partea 6) — „finalizezi?": L1h făcut, L1b+L1c verificate acoperite (nu fake).**
> Owner: „finalizezi?" → iau ce se poate în cod, fără cont/token/social („fără
> insta"). **L1h — feedback implicit** (nou, real): `feedbackImplicit.ts` prinde
> corecțiile clare („nu asta am cerut") FĂRĂ fals pozitive, le notează în registru
> și le bagă în lecțiile creierului — 7 teste. **L1b + L1c — verificate în COD ca
> deja acoperite** (nu presupus, nu re-scris peste ce merge): L1b prin
> `zidul`/`cauzaComuna`/`escaladare`/`semnaturaLumii`/arhivare din `autonomie.ts`;
> L1c prin cron-ul de 1 min care re-rulează deploy la live≠master + veghe + plasa
> de sănătate. Am tăiat rândurile cu dovada, nu am fabricat cod redundant.
> **Sărite explicit** (i-am spus owner-ului de ce): L1d Telegram + L2 (cer
> token/cont de-al lui), L1g cameră continuă (i-ar răsturna decizia de cost din
> 9 aug), L1f sandbox (periculos — doar la cerere explicită). Porți: backend tsc
> 0 + 1220 teste verzi (7 noi) · sintaxă 0. **Un test a picat (autoInvatare —
> fereastra de 200 car. între isAdminUser și lectiiCurente): NU l-am slăbit — am
> REORDONAT codul (lecțiile întâi, notarea reproșului după), ceea ce e și mai
> corect (corecția curentă intră în lecțiile turelor viitoare, nu în asta).**

> **12 aug 2026 (seara, partea 5) — OPUS pe vocea live (owner: „fă Opus").**
> Banda vocii live pe 3G (PCM brut ~256/384 kbit/s) e singura care mai rămăsese
> din discuția cu 3G. Acum: hopul **browser↔server** se comprimă cu Opus (~10×),
> serverul↔Google rămâne PCM (Gemini cere PCM). **OFF din start** (`VOICE_OPUS`):
> stins = PCM-ul de azi octet cu octet, zero regresie; cădere sigură pe PCM fără
> WebCodecs sau fără codec de server. Server = opusscript (pur-JS, fără build
> nativ); browser = WebCodecs nativ (zero dep). Teste: round-trip REAL de server
> (9) + reîncadrare pură ambele capete; backend 1213 verzi, frontend 41 verzi.
> **De probat LIVE de owner** (WebCodecs nu există în Node): `VOICE_OPUS=1` →
> voce pe telefon curată + bandă mult mai mică. **RĂMAS din 3G:** nimic — Opus
> era ultimul. Detecția țevii + calitatea adaptivă a vederii sunt deja pe master.

> **12 aug 2026 (seara, partea 4) — „fă-le TOATE nefăcut": ultimele 4 rânduri închise.**
> Ordinul: „vreau aplicația finalizată, verificată și funcțională, kelion 100%
> autonom… să poată executa din chat orice cerință reală și orice dezvoltare".
> - **N val 2 (a) — starea de trading pe VOCE.** Clientul vocal trimite acum
>   `getStareTranzactii()` cu bătaia de coords → serverul o ține (`tranzactiiLive`)
>   → `turaCreierului` o pune în body `tranzactii` la `/api/chat`. Abia atunci
>   răspunsul VOCAL produce cadrul `{niveluri}` desenat pe grafic (deja în lista
>   albă). Aceeași logică chat.ts, deci vocea beneficiază de tot.
> - **N val 2 (d) — memoria de trading REAMINTITĂ în conversație.** Namespace
>   separat `tranzactii` (doar butonul Analiză îl citea) → `recallMemoriiTranzactii`
>   intră în conversație cât Centrul e ancorat (admin+tab), în valul paralel cu
>   termen de 400ms (zero latență adăugată). Test nou (citește `tranzactii` NU
>   `kelion`, gol fără schimburi, dedup).
> - **L1e — procesare CSV/JSON** ca unealtă (`proceseaza_date`, vezi tabelul L1).
> - **L1i — editare avansată Docs+Sheets** (vezi tabelul L1; ⚠ reconectare Google).
> **Verificat:** backend tsc 0 + 1204 teste verzi + frontend tsc/build verzi +
> `verifica-sintaxa` curat. **RĂMAS din N val 2:** nimic — toate închise.
> **De probat LIVE de owner:** nivelurile pe voce (trading deschis) + editarea
> Drive DUPĂ reconectarea Google (scope-uri noi).

> **12 aug 2026 (seara, partea 3) — N val 2 închis + verificări oneste (nu presupuse).**
> - **N val 2 (c) — listener MORT de deblocare-admin SCOS.** Nimeni nu emitea
>   `kelion:admin-unlock` (amprenta scoasă din calea vocii, 6 aug); comentariul jura
>   „realtimeVoice emits" — FALS. Scos listener-ul + corectat comentariul. NU am
>   re-cablat voce→admin (din grija ta de securitate: ar fi lărgit suprafața admin).
>   Un eveniment rătăcit nu-mai poate flip-ui lacătul din UI.
> - **N val 2 (e) — VERIFICAT deja acoperit** (nu presupus): butonul de înregistrare
>   dă feedback la refuz/unsupported (`Stage.tsx` 964-975: „Rec ⚠" 3s, cu motiv).
> - **L1b — VERIFICAT deja acoperit:** bucla de autonomie reia joburile picate CU
>   jurnalul eșecului + escaladare de la PRIMA reîncercare (test verde).
> **RĂMAS, onest:** ~~N val 2 (a) cadrul `niveluri` pe voce; (d) memoria trading în
> conversație; L1e/L1i~~ → **TOATE închise în partea 4 (mai sus), 12 aug.**

> **12 aug 2026 (seara, partea 2) — continuare „toate, absolut toate".**
> - **N val 2 (b) — persona vocală ONESTĂ.** Nu mai pretinde vedere continuă:
>   „VEDEREA (la CERERE, NU continuu)… CERI cadrele prin cere_creierului". Test
>   întărit (`.not.toContain` pe minciuna veche).
> - **B8/K15 — PLAFON ZILNIC DE ARDERE, cerut EXPLICIT de owner.** Contor real
>   (cheltuiala MĂSURATĂ azi, `cheltuitAziConstructor`), cifră adjustabilă
>   (`constructor:plafon_usd`, default $10) + comutator (`constructor:plafon_activ`);
>   bucla `poateSaLucreze` se OPREȘTE la atingere, cu motiv clar. Endpoint
>   `GET/POST /api/admin/plafon-constructor` (gardat admin) + bloc în tabul
>   Constructor: „construit azi $X din $Y" + buton „oprește limita" + câmp cifră.
>   Testul vechi „nu există plafon" (cerință depășită) ÎNLOCUIT cu unul care CHIAR
>   verifică oprirea la atingere + butonul de stins — NU slăbit ca să treacă. 1172
>   teste, tsc + build + sintaxă verzi.

> **12 aug 2026 (seara) — ÎNCHIDEREA LISTEI, la ordinul „toate, absolut toate".**
> Iau la rând tot ce a rămas cod-abil; fiecare cu porți verzi. De verificat live
> după merge.
> - **K16 — DEDUP FUZZY DE CERINȚE.** `adaugaCerinta` deduplica doar pe text
>   IDENTIC → aceeași cerință spusă altfel (diacritice, punctuație, ordinea
>   cuvintelor) intra a doua oară și bucla o re-analiza (dubluri = timp + bani).
>   Fix: modul pur `services/cerinteDedup.ts` (normalizare + similaritate Jaccard
>   pe tokeni semnificativi, prag 0.8); `adaugaCerinta` compară cu cerințele
>   deschise și cade pe cea existentă. Prinde reformulările (nu flexiune/sinonime
>   — onest). 6 teste noi (1167 total), tsc curat.
> - **K9 + K13 — AUTO-ARHIVAREA ORDINELOR VECHI.** Panoul Constructor
>   (`listBuildJobs`) arăta TOATE joburile, inclusiv cele eșuate vechi (gunoi).
>   Fix: coloană `arhivat` pe `build_jobs`; `listBuildJobs` exclude arhivatele;
>   `arhiveazaBuildJobsVechi()` (nouă) marchează arhivate ordinele TERMINATE
>   (done/failed) mai vechi de o zi — iese din panou, RĂMÂN în DB (recuperabile,
>   nu șterse); chemată automat de bucla de autonomie („curățenie când e gata").
>   Nu atinge niciodată ordinele vii. 1167 teste verzi, tsc curat.
> - **K14 — ANUNȚ LA OWNER LA CERERE NOUĂ.** Serviciul `adminNotification` exista,
>   dar NU-l chema nimeni și adminul nu-l vedea. Legat: `notifyAdmin` pe **plată
>   neatribuită** (openBanking — bani fără cod, de atribuit) și pe **cerere
>   neacoperită** NOUĂ (`logCapabilityGap` întoarce acum `nou`, anunț o singură
>   dată). Endpoint `GET /api/admin/notificari` + `POST …/:id/citit` (gardate
>   `cerAdmin`). Frontend: tab „Notificări" cu badge de necitite. **Atenția
>   ownerului respectată** („Kelion are drepturi admin"): toate ușile noi gardate
>   admin; notificarea deduplică (nu se poate spama). 1167 teste, tsc + build +
>   sintaxă verzi.
> - **K10 — ANUNȚ DE ESCALADARE CÂND CREIERUL NU POATE.** La `/api/constructor/report`,
>   dacă un ordin pică fiindcă MODELUL nu a dus sarcina (semnătură în log:
>   creier/răspuns gol/indisponibil/„fără nicio modificare"/401-403), pun o
>   notificare în panou (K14) cu ce e de făcut: escaladează la creier plătit
>   (`CONSTRUCTOR_MODEL` + `CONSTRUCTOR_ALLOW_PAID=1`) + reia ordinul
>   (`constructor_manage retry`) — nu doar email care se pierde. 1167 teste, tsc curat.
> - **K8 — FANTOMA STT PE TĂCERE („Greț") + reevaluarea celor 7.** Poarta de
>   energie de pe client tăia mult, dar o fantomă tot scăpa în chat. Filtru
>   centralizat pe `/api/asr`: modul pur `asrHalucinatii.ts` (listă curată de
>   halucinații de tăcere — „greț", „subtitrare", „thanks for watching", doar
>   simboluri — DOAR când tot transcriptul e asta; Da/Nu/OK NU se ating). 5 teste.
>   NU promit un „0 garantat" de la un model probabilistic (ar fi invenție) —
>   blochez tăcerea + fantomele cunoscute, iar lista crește din fantome REALE.
>   Pe drum (la „reevaluează 1–7"): **corectat un comentariu stale** în
>   `autonomie.ts` (zicea că schimbarea de metodă vine „de la a treia" încercare;
>   codul o face de la PRIMA — `escaladare()` linia 536). 1172 teste, tsc curat.

> **12 aug 2026 — PLASĂ DE SĂNĂTATE LA PUBLICARE: backup → health → revert automat (de verificat live).**
> Adrian: „să poată da automat merged, DAR cu backup înainte în caz că crapă ceva;
> după merged, verificare automată de sănătate; dacă nu trece, REVERT și schimbă
> abordarea." Construit ca script Node standalone (`deploy/plasa-sanatate.mjs`),
> chemat de `auto-publicare.sh` DUPĂ `deploy.sh` — rulează din AFARA aplicației,
> deci poate reveni chiar dacă publicarea nouă nu mai pornește. Flux: (1) BACKUP
> durabil (tag `backup-…`) al stării bune de dinainte; (2) `/api/health` verificat
> ~4 min (sănătos = 3 citiri 200 la rând, cu toleranță la blip-ul de repornire);
> (3) dacă nu ajunge sănătos → REVERT la starea bună (commit ÎNAINTE pe master, ca
> `restoreToPoint`, fără rescriere de istorie — `auto-publicare` o republică
> singură); (4) ISSUE care spune că abordarea a picat (semnalul de schimbat
> abordarea). Anti-spirală: nu revine de două ori la rând. Acoperă ORICE publicare
> (merge-uri constructor ȘI ale ownerului — toate trec prin `auto-publicare`).
> Probat uscat: scenariile sănătos + picat→revert merg; `node --check` + `bash -n`
> curate. **DE TĂIAT după proba live**: o publicare stricată intenționat → live
> revine singur la starea bună în câteva minute + issue deschis.

> **12 aug 2026 — CONSTRUCTORUL AJUNGE LA PLACA PROPRIE (jobul #177 „fetch failed" reparat, de verificat live).**
> Cauza MĂSURATĂ (jobul #177, era în codul meu — regula #2): constructorul suna
> modelul de pe placa RunPod cu un apel SINCRON pe `/openai`, dar placa serverless
> stă stinsă la 0 muncitori și prima trezire DESCARCĂ modelul (~3–8 min) →
> conexiunea sincronă cădea cu „fetch failed" (0 octeți) ÎNAINTE ca placa să
> pornească. Fix (`deploy/constructor-agent.mjs`): dacă endpointul e RunPod,
> TREZIM întâi placa pe ruta ASINCRONĂ (`/run` + poll `/status` până e terminal —
> NU ține conexiunea deschisă, deci supraviețuiește pornirii la rece oricât ar
> dura), cu progresul scris pe monitor (`beat`); abia când e caldă trimitem
> cererea reală cu unelte pe `/openai`. Auto-vindecare: dacă placa se stinge între
> pași și un apel sincron cade, se marchează RECE și reîncercarea o retrezește
> singură. Sintaxă verificată (`node --check` + `verifica-sintaxa` curate).
> **DE TĂIAT după proba live**: un ordin de build real → jurnalul constructorului
> arată „placa e CALDĂ" apoi `modelServit: deepseek/…`, ordinul se termină, nu mai
> pică pe „fetch failed".

> **12 aug 2026 — KELION ÎȘI CUNOAȘTE SINGUR DEFECTELE (autodiagnostic, de verificat live).**
> Adrian: „Kelion nu știe by default că are probleme… nu are sisteme să-i zică
> automat ce probleme are" — întrebat „ce e eroarea 1006?", răspundea „încearcă din
> nou". Cauza (din cod, regula #2): (1) eroarea de voce urca DOAR ca toast —
> `urcaEroarea` din `vocalLive.ts` NU o trimitea pe canalul de erori, deci Kelion
> n-o vedea niciodată; (2) erorile din browser se injectau BRUT în creier, fără
> „ce este". Fix: `urcaEroarea` raportează acum și pe `console.error` (→
> `/api/client-errors` → context); clasificator nou `explicaEroare.ts` (traduce
> „cod 1006" / „Failed to fetch" / 5xx… în explicație clară, iar la necunoscut
> spune „neclasificat" — NU inventează); serviciu `autodiagnostic.ts` care strânge
> defectele curente (erori de server + ordine de build eșuate) SINCRON din cache
> (zero latență, ca lookup-urile GPS); ambele injectate în creier (`chat.ts`) —
> erorile din browser cu explicație, plus, pentru OWNER, blocul „PROBLEMELE MELE
> ACUM". Porți verzi (**1161 teste**, +8 pe clasificator; tsc curat cu `@types/ws`;
> build frontend; sintaxă). **DE TĂIAT după proba live**: în chat „ce e eroarea
> 1006?" / „ce probleme ai?" → Kelion răspunde exact ce e, nu „încearcă din nou".

> **12 aug 2026 — AVATARUL NU MAI ACOPERĂ ANALIZA (de verificat live).**
> Adrian: „mută avatarul în stânga sau scrisul în stânga când se afișează o
> analiză, că acoperă ce scrie." Ales de owner (AskUserQuestion): avatar în colț,
> mic. Cauza (din CSS): chatul (`.chat`, z-index 30) stă PESTE avatarul central
> (`.stage-canvas`, z-index 1) — la un răspuns lung (analiză) se calcă în centru.
> Suprafețele (`monitorOn`) dădeau deja avatarul în colț; lipsea cazul „doar chat,
> fără suprafață". Fix: `ChatPanel` emite `kelion:analiza-vizibila` când ultimul
> răspuns e o analiză (text >320 caractere); `Stage` ascultă și pune avatarul în
> colț (refolosește clasa `pip`, deci mecanism deja probat) cât timp analiza e pe
> ecran; la răspuns scurt revine central. Build frontend verde. **DE TĂIAT după
> proba live**: pui o întrebare care cere analiză lungă → avatarul se dă în colț,
> textul rămâne liber; la „salut" scurt, avatarul stă central.

> **12 aug 2026 — KELION PORNEȘTE SINGUR CONSTRUCȚIA DIN CHAT/VOCE (de verificat live).**
> Adrian: „kelion trebuie să fie capabil să o facă, nu tu" — a dat ordinul cu
> avatarul și Kelion a VORBIT, nu a construit. Cauza (din cod, regula #2): regula
> de rutare a uneltei `build_software` pornea constructorul DOAR când ownerul
> spunea LITERAL „construiește"; un ordin implicit („găsește o modalitate să muți
> avatarul") era tratat ca discuție. Fix: rutarea acceptă acum ordine EXPLICITE
> SAU IMPLICITE (orice cere schimbarea aplicației), în AMBELE surse (`chat.ts` +
> `brainToolDefs.ts` pentru voce), plus o directivă în prompt pentru owner:
> „sarcină despre aplicație = ACȚIUNE, nu vorbă" (build_software / repo_write
> ACUM, nu promite). Test actualizat (`rutareChat.test.ts`). 1161 teste verzi,
> tsc curat. **DE TĂIAT după proba live**: îi dai un ordin fără „construiește"
> (ex. „repară X") → apare în panoul Constructor + PR, nu doar vorbă în chat.

> **12 aug 2026 — MONITORUL ARATĂ TOT FLUXUL, CU BARE 0–100% (de verificat live).**
> Adrian: „tot fluxul, cu bari de la 0 la 100%, actualizate real dinamic până la
> deploy… de la preluare, pe unde ajunge sarcina." Backendul dădea deja `pct`
> (`progresOrdin.ts` + `/api/constructor/live`), dar suprafața constructorului din
> monitor NU-l desena — arăta doar textul ultimului pas. Fix (`Stage.tsx`
> `BuildSurface` + CSS nou, clase noi fără coliziune): bară vizuală 0–100% +
> cronologia etapelor (Preluat → Atelier → Construiește → Verifică → PR →
> CI/Deploy) care se APRIND din pct-ul REAL raportat, cu etapa activă evidențiată;
> la eșec, motivul scris pe față (bloc roșu), nu doar un badge sec. Se
> reîmprospătează la 2.5s. Build frontend + sintaxă CSS verzi. **DE TĂIAT după
> proba live**: dai un ordin → în monitor vezi bara urcând și etapele aprinzându-se
> pas cu pas până la CI/Deploy; la un ordin picat, vezi motivul, nu doar „eșuat".

> ✅ **VERIFICAT LIVE de owner (11 aug): „merge bloutotch".** Vocea live iese pe Bluetooth/mașină,
> ȘI update-ul blocant a funcționat (a primit codul nou pe telefon fără chin — altfel BT ar fi
> rămas mort). Ambele puncte (A poarta + B microfonul fără procesare) confirmate pe telefon real.
> RĂMAS deschis doar dacă reapare: ecou pe difuzorul telefonului (fără AEC) → ruta-conștientă.
> **11 aug 2026 — REPARAT (de verificat live): update BLOCANT + voce pe Bluetooth pasul 2 (#1008).**
> (A) Owner: „update-ul să vină la toți oriunde folosesc app-ul + să nu se poată continua până
> nu faci update-ul." Cauza „telefonul rămas pe cod vechi": bara de update se amâna cât lucrai
> (voce/cerere/draft) → în sesiune de voce nu se aplica niciodată. Acum: POARTĂ blocantă peste
> toată aplicația la orice deploy, cu buton + numărătoare 15s care aplică singură (fără pauză).
> NB: ca să prinzi ACEST update, închide app o dată complet; de-acum se forțează singur.
> (B) După #1006, vocea TOT rămânea pe telefon: cât microfonul e deschis cu procesare WebRTC,
> Android intră în „mod convorbire" și ține ieșirea pe telefon/SCO. Fix: microfon FĂRĂ procesare
> (echoCancellation/noiseSuppression/autoGainControl = false) → mod normal → A2DP pe căști/mașină.
> Porți verzi (tsc 0 · build · oxlint 0 · jscpd 0 · sintaxă 0 · exporturi 0 · teste 15/15).
> **DE TĂIAT după verificarea LIVE**: (1) închizi app → prinde poarta; (2) voce live pe căști BT
> → iese pe căști; (3) deploy următor → poarta nu lasă continuarea. Dacă TOT rămâne pe telefon
> după (B) → cauza e nativă (captura audio forțează modul convorbire la nivel OS) → fix în APK
> (audio focus / half-duplex cu mic închis cât vorbește Kelion), rând nou atunci.
>
> ✅ **VERIFICAT LIVE (11 aug, „merge bloutotch") — vezi rândul #1008 de mai sus (pasul 2 l-a închis).**
> **11 aug 2026 — REPARAT (de verificat live): vocea live nu ieșea pe Bluetooth/mașină (#1006).**
> Owner a MĂSURAT: vocea live rămâne pe telefon, nu se duce pe căști/car audio. Critic pentru
> modul mașină. Cauza (din cod): vocea live ieșea prin bucla WebRTC (AEC), iar audio-ul WebRTC
> e clasat de Android drept „convorbire" (SCO) → rămâne pe telefon, nu folosește canalul A2DP
> de muzică al căștilor/mașinii. Fix (`vocalLive.ts`): vocea live iese acum printr-un `<audio>`
> media alimentat de WebAudio (ca mp3-ul din audioIO.ts, care MERGE pe BT) → urmează ruta de
> muzică la căști/mașină; bucla WebRTC scoasă; ecoul rămâne pe seama microfonului
> (echoCancellation). Porți verzi (tsc 0 · build · oxlint 0 · jscpd 0 · sintaxă 0 · teste 15/15).
> **DE TĂIAT după verificarea LIVE** (pornește vocea live cu căști BT / în mașină → iese pe
> căști/boxe). Dacă TOT rămâne pe telefon → cauza e „modul convorbire" din microfonul deschis,
> iar fixul e nativ în APK (audio focus), nu în web — de deschis rând nou atunci.
>
> **11 aug 2026 — REPARAT (de verificat live): audio moare când pornești camera pe telefon (#1004).**
> Ownerul a MĂSURAT pe APK: „i-am zis *porneste camera*, a pornit-o dar a MURIT AUDIO,
> nu-l mai aud" — și a confirmat că o a doua atingere îl aduce înapoi. Cauza (din cod):
> camera (sau o întrerupere de sistem) pune pe pauză elementul `<audio>` al buclei AEC,
> iar autoplay-ul de pe mobil refuză `el.play()` fără gest → mut până la atingere. Fix
> (`vocalLive.ts`): dacă elementul AEC rămâne pe pauză ~2,4s, sesiunea trece SINGURĂ pe
> redarea directă WebAudio (nu cere gest) → audio revine automat, fără atingere. Porți
> verzi (tsc 0 · build · jscpd 0 · sintaxă 0 · oxlint 0). **DE TĂIAT după verificarea
> LIVE** (pornește camera în timpul vorbirii pe telefon → audio revine singur în 2–3s).
>
> **11 aug 2026 — MODUL MAȘINĂ livrat (de verificat live) + MESSENGER Kelion↔Kelion (NOU, de făcut).**
> (1) **Modul mașină** (voce-first, legislație auto): buton 🚗 (activare manuală),
> strat Jarvis (glob audio-reactiv pe vocea reală a lui Kelion), `carMode` →
> creier (răspuns SCURT, spus, fără suprafețe vizuale; muzică/radio doar audio),
> suprimarea suprafețelor în `handleControl`, avatarul 3D demontat la volan. Porți
> verzi (tsc 0 · 1135 teste · build · jscpd 0 · sintaxă 0). **DE TĂIAT doar după
> verificarea LIVE** (🚗 deschide stratul; Kelion răspunde cu vocea, nu deschide
> monitor/hărți; ✕ iese). Pe drum s-a reparat o poartă `jscpd` ROȘIE pe master
> (clona LandingAvatar↔StageAvatar din #995 → extras `AvatarScene`).
> (2) **Messenger Kelion↔Kelion — FAZA 1 GATA (de verificat live), FAZA 2 de făcut**
> (owner, 11 aug): „apelează-l pe X" → canal securizat între 2 useri Kelion; audio
> prin internet cu TRADUCĂTOR LIVE prin Kelion (eu RO, el în limba lui și invers);
> închizi oricând; funcțional din chat scris SAU voce, în mașină SAU acasă.
> **Faza 1 + Faza 2 livrate** (de verificat live cu 2 conturi). Faza 1: prezență
> (WS `/api/apel`), `apeleaza_user` (chat scris + voce), invitație + accept/refuz +
> conectat + închide, strat global de apel (și în modul mașină). Faza 2: audio real
> + TRADUCERE LIVE — mic (VAD, pe frază) → Gemini transcrie+traduce în limba
> celuilalt → Chirp o rostește → subtitrare + voce la destinatar, ambele direcții;
> vocea cu Kelion se suspendă cât ești în apel. Porți verzi (tsc 0 · **1149 teste**,
> 14 pe apel/traducere · build · jscpd 0). **DE TĂIAT după verificarea LIVE** (2
> conturi cu limbi diferite în prefs). **Rămas (opțional):** sonerie/anunț vocal la
> apel primit (hands-free în mașină); WebRTC P2P pentru audio brut simultan; listă
> de contacte/permisiuni (acum se apelează orice user înregistrat, după nume/email
> — de restrâns pentru intimitate); latența e per-frază (interpret pe rând).
>
> **10 aug 2026 (după-amiaza) — „CHATUL PRĂJIT", GĂSIT CU AGENȚII + REPARAT.**
> Ownerul: „iar ai prăjit ceva la chat, trimite iar toți agenții și repară." Sweep
> cu 5 vânători + verificare adversarială. Cauza (confirmată, afectează chatul
> SCRIS normal): în română **„cameră" = și „încăpere"**, iar `cameraOp`
> (`commands.ts`) se declanșa pe orice `camer`+verb → fraze firești ca „stinge
> lumina din cameră", „închide ușa camerei", „deschide fereastra din cameră"
> **deturnau tura**: `chat.ts` întorcea un „am închis camera" din conservă, SĂREA
> peste creier și chiar comuta camera video. Fix: `cameraOp` refuză când apare un
> obiect de încăpere (lumină/ușă/fereastră/geam…), dacă nu e numit explicit
> dispozitivul („webcam"/„cameră video"). +2: pe VOCE, cadrul de cameră se trimitea
> **fără gardul de adresare** (o frază ambientală „închide camera" din încăpere
> comuta camera) → acum doar pe tură adresată; și o `Date` invalidă din #979 putea
> arunca RangeError pe calea de trading (păzit). Teste noi în `commands.test.ts`.

> **10 aug 2026 (dimineața/prânz) — ADAPTARE CV + CONSTRUCTORUL PE VERDE REAL.**
> (1) **Filtrul de salariu chiar filtrează** + ordonare permanentă (relevanță →
> salariu) — #977, LIVE pe `8af1907` (răspunsul „nu se aplică filtrele").
> (2) **Constructorul rulează în atelier TOATE cele 7 porți** ca `porti-pr.sh`
> (adăugate: jscpd, exporturi, sintaxă, boot pe dist) — #978, master `884073c`.
> Cauza reală a PR-ului roșu #973 (ordin #173, „canal de ordine"): atelierul
> verifica doar build+teste și sărea celelalte patru porți. CORECȚIE (măsurat pe
> `merged_at`, nu pe câmpul `merged` care e nesigur în output-ul minimal): #973 A
> FOST îmbinat 10:03 și A RUPT master (rută la nivel de modul) — reparat imediat
> de #974 (10:09). De-acum constructorul repară în atelier ÎNAINTE de PR.
> (2b) **Constructorul chiar TERMINĂ ordinele** (ownerul: „de ce a eșuat,
> implementează-i să le poată finaliza"): fiindcă #978 a înmulțit porțile din
> atelier (3→7), dar rundele de reparație rămăseseră 2 și garda de timp era fixă
> la 10 min — un ordin care pica o poartă nouă „eșua" deși era reparabil, cu timp
> pe ceas. Fix: `MAX_REPAIR` 2→4 + gardă de timp ADAPTIVĂ (`durataVerif`+tampon,
> nu 10 min fix). Măsurat: ordinele ard 2–3.4M tokeni fiecare, deci frâna reală e
> TIMPUL (30 min dur), nu tokenii.
> (3) **Câmp „Locație" în căutarea de joburi** (ownerul: „lipsește unde editezi
> locația") — intră în interogarea Serper ȘI în ordonarea de bază ca al treilea
> filtru (relevanță → salariu → potrivire locație). Distanța = potrivire de
> locație reală (anunțul menționează zona), NU km inventați fără coordonate.
> **REZOLVAT (aceeași sesiune):** „kelion să vadă când pun mouse-ul exact peste
> orice poziție din graficul de tranzacționare" — `cuCrosshair` din iframe-ul
> `tranzactii.ts` trimite lumânarea de sub cursor (O/H/L/C/volum/MA20/EMA50) prin
> postMessage (`peste`, throttled ~150ms) → `StareTranzactii.peste` (workspace.ts)
> → `body.tranzactii.peste` → ancora mentorului din chat + `get_monitor`
> (`grafic_sub_cursor`). Merge cu PR-ul locației (#979). **RÂND NOU (deschis):**
> mutarea pastilelor de credit AI (Serper/Gemini) SUS în admin (răspuns
> AskUserQuestion), încă neînceput.

> **9 aug 2026 (după-amiaza) — 7 PR-uri MERGED + VERIFICATE LIVE (`c8ebed3` =
> master, health 200):** #926 trezirea pe nume în persona live; #927 memoria
> unificată voce↔scris + economia pe scris (text-in→text-out); #928 constructorul
> pe DeepSeek direct (gated pe cheie, fallback Gemini); #929 **oprirea arderii
> fără user** — motoarele autonome (iscoade/pietar/embeddings/autonomie/self-heal/
> triaj) OFF implicit, comutator `POST /api/admin/autonom`; cauza „creditul afișat
> e fals": motoarele NU treceau prin `recordCost`; #930 **hărțile: dalele prin
> domeniul nostru** (`/api/tile` proxy+cache; dovadă live: 200 image/png); #931
> **gardul trezirii pe SERVER** (difuzorul tace determinist la vorbire între alți
> oameni; tura suprimată se scrie în jurnal); #932 **sesiunea moartă nu mai minte**
> (54 porți admin: 401 pe cookie mort vs 403 pe rol; dovadă live: admin fără
> cookie → 401; `ADMIN_EMAIL` cu `.trim()`; `SESSION_SECRET`/`ADMIN_EMAIL` excluse
> din `vps-set-env`). **RÂNDURI NOI (deschise azi):** (R1) testul LIVE al
> trezirii/memoriei/hărților/imaginilor pe monitor = al ownerului (credit Google
> viu din nou) — „nu pot verifica" de aici; (R2) circuitul constructor→DeepSeek
> așteaptă cheia `CONSTRUCTOR_DEEPSEEK_KEY` pe VPS (prin Kelion `secret_pune`);
> dovada = `modelServit: deepseek/…` în raport; (R3) banda urechii mai poate
> scrie fonetici străine pe vorbirea PROPRIE a ownerului (turele neadresate nu se
> mai afișează, dar transcrierea urechii Google rămâne fără buton de limbă);
> (R4) cereri NOI în coadă, neatinse (ordinea ownerului): Trading Center ca tab
> in-app + × + memorie separată admin; date reale „ca în live" + selecția pe
> timp + butonul „Urmărește"; buton REC vizibil în orice tab admin.

> **9 aug 2026 (seara) — FURTUNA VOCII, ÎNCHISĂ CU NUMERE (#935–#949, live
> `ff6a1a7` = master):** simptomul „nu-i pleacă vocea audio, răspunde scris" a
> fost MĂSURAT cu contoarele publice `GET /api/vocal-live/stare` (PR #947):
> înainte de fix — 429/429 cadre audio de la Google, TOATE suprimate de gardul
> de adresare, 0 spre browser (blocaj la rece: `ultimaVorbaKelion` se seta doar
> pe cadre care treceau → prima tură nu trecea niciodată). Fix #949 (prima tură
> după deschidere e adresată) publicat 20:59:31Z; dovada live: **281/281 cadre
> spre browser, 0 suprimate**. Pe drum: #943 butonul de mic oprește și sesiunea
> live (factura nu mai curge după opt); #944–#946 garda de limbă doar pe pin
> ro-RO + deschideri românești scoase din markerii străini + NO_INTERRUPTION;
> #948 consola pe reparații reale (mic pe AudioWorklet). „Live a rămas în urmă"
> (21:57) NU a fost blocaj: două merge-uri spate-în-spate (21:48, 21:50 UK) =
> două publicări la rând; fereastra totală master→live pentru #949 a fost 9 min.
> **RÂND NOU (R5):** discul VPS 58% — `vps-curatenie.sh` (27 iul; 134 imagini/
> ~48G strânse la prima rulare manuală) NU era instalat de nimeni în cron (boala
> veghii din 8 aug); instalarea intră în `deploy.sh` pasul 6h — dovada = discul
> scade în auditul de după 04:30. **RÂMÂN:** THREE.Clock (avertisment din
> @react-three/fiber, cere upgrade de bibliotecă — planificat separat);
> barge-in-ul clientului a tăiat vorba de 3× în consola ownerului (de urmărit cu
> microfonul în față); căderea 1006/521 din timpul fiecărei publicări taie
> sesiunea vocală în curs (reconectarea merge singură, dar tăietura se simte).

> **10 aug 2026 (noaptea) — AUDITUL CU 40 DE AGENȚI + REPARAȚIA DE NOAPTE
> (#950–#953).** Ordinul ownerului: „ia din nou toți agenții și reparați până
> dimineața aplicația și cu toți agenții o testezi în live". 10 lentile de
> căutare + un sceptic adversarial per constatare → **29 confirmate (6 critice),
> 1 respinsă**; **28 REPARATE** în #952 (voce/chat-bani/porți) + #953 (Trading
> Center/frontend), toate cu porți verzi (1108/1108 teste; scriptul emis al
> paginii de tranzacții validat cu node --check; proba Playwright pe build-ul
> de producție: pagina + Trading Center fără nicio eroare de script). Pe drum:
> #951 „vorbește peste mine" — barge-in pe server (vocea OMULUI susținută îl
> taie; ecoul/zgomotul nu; degradarea nu mai aruncă NO_INTERRUPTION — cauza
> celor ×10 „modelul și-a tăiat vorba"). **RÂND NOU (R6):** calea „vederii în
> timp real" din sesiunea live e moartă pe sârmă (serverul are handlerul
> `type:'cadru'`, frontend-ul nu-l trimite nicăieri, dar persona îi SPUNE
> modelului că vede camera) — decizie de produs: ori recablăm expeditorul, ori
> aliniem persona la realitate; până atunci „ce vezi" merge prin ușa
> cere_creierului. **DOVEZI CARE RĂMÂN ALE DIMINEȚII:** barge-in-ul pe vocea
> ownerului (contorul `taieriPeVoceaOmului` din puls trebuie să crească când
> vorbește peste el); discul scade după 04:30.

> **3 aug 2026 — EXTIRPAREA TOTALĂ OpenRouter + OpenAI (branch, PR în lucru,
> NEVERIFICAT LIVE):** furnizorii au fost scoși din tot codul (creier =
> Gemini-only, căutare = Serper, voce = Chirp; detalii în AI-HANDOFF §3 + §13).
> Efect asupra listei: rândurile care pomenesc soldul/cheile OpenRouter/OpenAI
> (ex. D2 „punga OpenRouter", K7 „OPENAI_USAGE_KEY", B9 „openrouter.searchModel",
> M6 partea OpenRouter/Anthropic/OpenAI) NU se mai pot rezolva — sistemele pe
> care le descriau au fost extirpate. Se taie DOAR după merge + verificare live,
> conform regulii; până atunci rămân, cu nota asta drept context.

> **7 aug 2026 — DEPLOY DEBLOCAT + VOCEA REPARATĂ (măsurat).** Live `9cbf29e` ==
> master, 0 commituri nepublicate, `/api/health` 200. Vocea „nu aude" (6 aug)
> reparată și LIVE: audio-ul ajunge la creier pe o tură user proaspătă, iar
> intermediarul de timbru a fost scos din cale (audio DIRECT la creier, viteză).
> Publicarea stătuse blocată ore (constructorul, cron la 2 min, sufoca CPU-ul →
> `docker build` agățat ținea lacătul); deblocată manual + `deploy.sh` întărit
> (trap de restaurare a constructorului + kill pe grupul de procese/atelier +
> `timeout 1200` pe build). **CE RĂMÂNE:** (1) comportamentul live al vocii sub 1s
> + adresarea corectă — „nu pot verifica", proba e testul ownerului (trezirea e
> acum 100% judecata creierului pe audio; un fals `<TAC/>` poate înghiți tăcut o
> frază adresată); (2) **SECRETE EXPUSE** într-o captură (root/SSH/tokenuri
> GitHub/chei API) → **rotire necesară**, GitHub + SSH întâi; (3) cod mort:
> `/api/realtime/transcript` + `/api/realtime/session` fără apelant din frontend.

> **3 aug 2026 (mai târziu) — REPARAȚIA TOTALĂ A PANOULUI DE ADMIN (branch de
> worktree, PR în lucru, NEVERIFICAT LIVE):** toate cele 83 de probleme din
> auditul multi-agent pe 8 zone (bani, utilizatori-vizitatori, istoric-cereri,
> magazine-inbox, tokenuri-envcheck, constructor-recuperare, amprente-gesturi-
> setări, bara-pastile) au fost reparate sau confirmate deja-reparate de
> extirpare — lista completă în AI-HANDOFF §13, intrarea „REPARAȚIA TOTALĂ A
> PANOULUI DE ADMIN". Tiparul central: nicio citire eșuată nu se mai afișează
> ca cifră/gol (null + declarare explicită, peste tot). K7 (OPENAI_USAGE_KEY în
> vps-keys.yml) e acum curățat ÎN COD — se taie după merge + verificare live.

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
| B9 | **Diagnosticele mele n-au ars credit — verificat, nu presupus** | ✅ **rezolvat / verificat** (august): OpenRouter a fost extirpat complet din aplicație (vezi AI-HANDOFF.md); `manualLang.ts` folosește `geminiDirectChat` pe modelul Gemini gratuit/configurat direct, fără dependențe pe OpenRouter. Adăugate teste automate în `manualLang.test.ts`. |

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
| D3 | **Google Photos, YouTube personal** | ✅ **procesat/verificat** (5 aug): Scope-urile YouTube (`youtube.readonly`) și Cloud Platform sunt incluse în `FULL_SCOPES` pe `/auth/google` și `/auth/google/connect`. Google Photos Library API read-only a fost eliminat de Google pe 31 martie 2025 (necesită Photos Picker API). Ownerul trebuie doar să reconecteze Google pentru re-autorizare. |
| D4 | **Etapa 5b — instalări de sistem ca runbook** | constructorul poate instala pachete npm, dar nu unelte de sistem (apt). Operație privilegiată pe VPS, de făcut cu grijă. |
| D5 | **Barge-in prin STT streaming** | **Analizat 30 iul, NEATINS deliberat.** Barge-in-ul pe vocea live (full-duplex) MERGE — îl face OpenAI Realtime nativ (`interrupt_response: true`). Lipsește doar pe calea de auz a chatului (`micStream` → `/api/asr-stream`): cât timp Kelion vorbește, microfonul e pe mut, deci nu curge audio și n-are ce detecta întreruperea. Reparația reală înseamnă să ținem microfonul deschis cât vorbește și să ne bazăm pe anularea de ecou — cu riscul concret ca **Kelion să se audă pe el însuși și să-și taie singur vorba**. Nu se poate proba fără microfon; nu se publică nedovedit pe un produs viu. De făcut cu tine în față, cu microfonul pornit. |
| D6 | **Pauza de autonomie invizibilă în UI** | ✅ **reparat** (30 iul, PR #574): la amânare, lucrătorul trimite un pas marcat „⏳" care sare peste throttle, iar panoul arată insigna **„Așteaptă cotă"** (în toate cele 7 limbi) în loc de „Lucrează" cu pasul înghețat 40 de minute. |
| D7 | **Corpul erorii 502 aruncat de client** | ✅ **reparat** (30 iul, PR #573): serverul trimite acum și `code` (ce anume a picat) și `retryable`; clientul le citește și afișează motivul pe înțelesul omului — „furnizorul vocii n-a răspuns la timp", „nu mai ai credit" — în loc de „realtime 502". |
| D8 | **DOUĂ VOCI simultan cu două taburi deschise** (Adrian, 4 aug seara: „am 2 voci") | fix scris 4 aug (zăvor pe TOT lanțul vocii între taburi: takeover + inimă la 10s + rămas-bun; regulile pure în `frontend/src/lib/voceUnica.ts`) — cauza: zăvorul vechi acoperea doar sesiunea live, dictarea de rezervă scăpa și vorbeau amândouă. **Nu pot verifica live până la merge+deploy+test cu 2 taburi** |
| D9 | **Cheia Gemini moartă pe live, 4 aug seara** („Gemini ⚠", creier+ureche 400 `API_KEY_INVALID`) | ✅ **reparat cu dovadă** (4 aug 18:39Z): cheia veche din Secrets avea 37 octeți (validă=39+) și Google o refuza verbatim; owner a făcut cheie NOUĂ în AI Studio (proiect Kelion) → `vps-keys` a scris-o mascat (53 octeți, test pe loc HTTP 200) → container recreat forțat (`KELION_DEPLOY_FORCE=1`, 18:37Z) → probă din container: generateContent **HTTP 200 („Salut")**, urechea Live deschisă. Lecție: env-file-ul se citește DOAR la recrearea containerului — o cheie ruptă în fișier explodează abia la următorul deploy |

---

## E. CE POT FACE DOAR EU (Adrian) — nimeni altcineva n-are acces

1. Cheile din **A** — puse o dată în GitHub Secrets + `vps-set-env`.
2. **Stripe → payouts pe Manual** (B3) și starea cererii **Issuing** (B2).
3. **Cardul la OpenRouter și OpenAI** — ~~niciun furnizor nu lasă un program să-și
   bage cardul în contul lui de facturare~~. **Corectat 31 iul: ba da** — pagina
   de facturare e o pagină web obișnuită, iar Kelion are browser real. De azi o
   completează el (M6), gardat de vocea ta, fără să vadă vreodată valoarea.
   **Ce rămâne al tău: să pui valorile O SINGURĂ DATĂ**, ca `CARD_NUMAR`,
   `CARD_EXPIRARE`, `CARD_CVC`, `CARD_NUME`, `CARD_COD_POSTAL`. Două drumuri:
   - **GitHub → Settings → Secrets → Actions**, apoi `vps-set-env`. **Blocat
     acum**: `vps-set-env` e un workflow, iar runnerele GitHub mor în 2-7
     secunde de aseară (măsurat pe fiecare job: `runner_id: 0`, jurnal 404).
   - **Direct pe VPS**, care nu depinde de GitHub deloc: cele 5 rânduri
     `NUME=valoare` în `/root/kelion/kelionai.env` (fișierul are deja `chmod
     600` și e exact cel dat containerului prin `--env-file`), apoi repornești
     containerul. Valoarea stă acolo în repaus, ca toate celelalte chei.

   **NU prin Kelion**: `secret_pune` refuză din construcție orice arată a card
   (13-19 cifre + Luhn) și rămâne așa. Și nu mi-l scrie mie în chat — un număr
   de card scris într-o conversație e un card compromis, indiferent cine citește.
4. **Reconectarea Google**, dacă vrem Photos/YouTube personal (D3).
5. **Permisiunile de cameră și locație** pe telefon.

---

## I. GĂSITE DE AUDITUL FRONTEND DIN 2 AUG (cele „roșii" din Kimi) — ce s-a reparat și ce a rămas

> Cele două audituri picate în Kimi (HC-front 1: chat/voce UI; HC-front 6: cod
> mort + i18n) au fost rulate cap-coadă și reparate în **PR #653** (828 teste,
> tsc + build verzi; **nu pot verifica live** până la merge + publicare).
> Rândurile de mai jos sunt CE A RĂMAS, cu dovada din audit lângă fiecare.

| # | Ce | Dovada | Stare |
|---|---|---|---|
| I1 | **AdminPanel: ~120 de linii cu literale românești în afara `adminText.ts`** (`setBuildMsg('Scrie ordinul complet…')`, `window.confirm('Restaurezi aplicația…')`, `window.alert('Email trimis.')` etc.) + 5 literale engleze pe lângă chei existente (`Loading…` dublează `A.loading`) | auditul din 2 aug, lista de linii în istoricul sesiunii; C1 din 30 iul numărase 54 de texte, dar panoul a crescut mult între timp | ✅ **REZOLVAT** — toate literalele extras în `adminText.ts` |
| I2 | **Dicționare paralele în afara `i18n.ts`**: WalletButton (~16 ternare `ro ? … : …` — es/fr/de/it/pt primesc tăcut engleză), CustomerSettings (`const RO/EN` propriu, 18 chei × 2 limbi), ContactModal (`const T` propriu, 22 chei × 7 limbi) | audit 2 aug; verificat în cod | ✅ **REZOLVAT** (3 aug): centralizat dicționarele paralele în `frontend/src/lib/i18n.ts` (`CustomerSettings`, `WalletButton`, `ContactModal`) |
| I3 | **Traducerile es/fr/de/it/pt pentru cheile noi din #653** (~60 chei: promo, voce onestă, constructor, unlock, monitor) | `i18n.ts` — cheile au EN+RO complete; restul limbilor cad curat pe engleză (mecanismul din 30 iul) | **deschis**, cosmetic |
| I4 | **Dubluri de politică client-server, documentate, nereparate**: pragurile VPS din bară (`liberPct <= 10 || incarcarePct >= 200`) dublate față de sentinelă; vocabularul gesturilor (`GESTURE_TO_CLIP`, 18 intrări) și lista de limbi (`languages.ts`, 27 coduri) dublate în browser; rotirea la 55 min vs limita 60 a OpenAI; watchdog-ul de stream 50s vs heartbeat 15s | audit 2 aug, TIER B | ✅ **REZOLVAT** — pragurile VPS transmise direct din backend (`PRAG_MEMORIE_PCT`/`PRAG_INCARCARE_PCT`), politicile centralizate și documentate ca sursă unică |
| I5 | **Landing.tsx: engleza hardcodată în componentă, nu în `publicText.ts`** (lead-form, QR, Install, Contact) | audit 2 aug | **REZOLVAT** (aug 2025): extras toate șirurile englezești din lead-form, QR, Install, Contact în `publicText.ts` |
| I6 | ~~Promisiunea falsă „încearcă gratis” pe landing (7 limbi) + „3 minute gratuit” în meta/JSON-LD~~ | proba gratuită nu există (decizia lui Adrian, comentată în Landing.tsx) | ✅ **tăiat cu PR #653 + VERIFICAT LIVE** (2 aug, 20:1x): live = `ba912ff`; titlul englez onest pe kelionai.app, „3 minute gratuit” = 0 apariții, „Try it free for 10 minutes” = 0 în bundle, textul onest prezent |
| I7 | ~~Fișierul „raw” al adminului: cip afișat, transmisie zero~~ + ~~conversia picată = atașament dispărut mut~~ + ~~402 la voce = „temporar” cu promisiune falsă~~ + ~~fraza pierdută la ASR = tăcere cu punct roșu aprins~~ | audit 2 aug TIER A, verificate pe cod | ✅ **tăiate cu PR #653**, live pe `ba912ff` (marker `voiceNeedCredit` prezent în bundle-ul live — măsurat); proba de COMPORTAMENT pe voce/atașamente rămâne a lui Adrian |

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
| M1 | **Veriga lipsă, făcută de EL cu browserul** — pe **Enable Banking** (enablebanking.com), NU GoCardless: măsurat 31 iul, GoCardless a închis conturile noi la final de 2025 („New signups are currently disabled"); codul cititorului e deja pe API-ul Enable Banking (`openBanking.ts`). Tu apeși o singură dată: aprobarea PSD2 în Revolut, pe telefon. **NU prin email** (ordinul tău) și **nu prin API-ul Revolut** — măsurat: API-ul e doar pe Business, plan Grow+, iar Business nu se dă persoanelor fizice autorizate | Admin → Bani scrie ✅ la citirea plăților |
| M2 | **Plasa**: o plată fără cod, sau cu cod greșit, ajunge în `plati_neatribuite` — nu dispare. **Livrat 2 aug** (măsurarea din aceeași zi găsise doar proză: nicio tabelă, plata se număra într-o variabilă locală și se arunca): tabela + scrierea din cititor + garda anti-„plată reușită reintrată ca problemă" + atribuire/ignorare din panou | Plătești fără cod → apare în panou, necreditată. **LIVE pe `2d2873c`** (2 aug 21:00, marker „Plăți neatribuite” măsurat în bundle); proba de comportament rămâne prima plată reală |
| M3 | **Panoul**: coduri emise, plăți creditate, plăți neatribuite, totaluri. **Livrat 2 aug** (`GET /api/admin/plati` + blocul din Admin → Bani; citirea picată se spune, nu se afișează zerouri) | Le vezi în Admin → Bani. **LIVE pe `2d2873c`** (2 aug 21:00; fereastra zidită de garda `expenses` a fost deschisă în PR #655) |
| M4 | **Capătul userului**: sume la alegere, cod mare cu buton de copiere, „aștept plata" care se închide singură, istoric. **Livrat 2 aug** — măsurarea găsise gaura fatală: checkout-ul întorcea codul, dar UI-ul naviga la Revolut FĂRĂ să-l arate vreodată, deci nimeni nu putea scrie codul în referință și nicio plată nu se putea potrivi | Un cont obișnuit cumpără credit și îl vede intrând, fără refresh. **LIVE pe `2d2873c`** (2 aug 21:00, marker `pay-code-big` ×2 în bundle); proba finală = o plată reală |
| M5 | **Proba automată**: test cap-coadă — cod → **încasare Revolut simulată** (NU email — ordinul tău: plata nu se citește din inbox) → credit exact → aceeași încasare a doua oară nu mai creditează → plata fără cod intră în plasă. **Livrat 2 aug**: `fluxBaniCapCoada.test.ts`, pe funcțiile reale, motorul fake-pg | `npm test` are testul și e verde ✅ (6/6, măsurat 2 aug) |
| M6 | **Cardul la furnizori + PLĂȚILE AUTOMATE**: îți pune cardul în pagina furnizorului (OpenRouter/Anthropic/OpenAI) fără să vadă vreodată valoarea, și **pornește reîncărcarea automată** — ca să nu mai rămână fără credit | `card_stare` scrie `plati_automate: true`, iar dovada e ce a **citit serverul** pe pagina lor („•••• 4242" + „Auto-recharge"), nu ce a spus el |

**M6 — cele trei lucruri care fac diferența** (31 iul, cerința ta: „asta era
cerința care dovedea autonomia reală" · „să opereze pentru mine când îi cer doar
eu, folosind sistemul de recunoaștere vocală" · **„plățile automate"**):

1. **Poarta e VOCEA, nu sesiunea.** Uneltele de card refuză dacă amprenta ta
   vocală nu s-a potrivit în ultimele 15 minute — și fereastra se deschide
   **doar** acolo unde amprenta chiar se potrivește (`realtime.ts`, unde deja se
   dădea deblocarea). Un cookie de admin furat nu ajunge la card.
2. **Modelul nu vede niciodată numărul.** El spune doar „câmpul 7 e numărul
   cardului"; **serverul** ia valoarea din secret și o scrie. Din prima scriere:
   zero capturi de ecran, iar cifrele lungi se maschează în textul paginii.
   Altfel PAN-ul ar fi ajuns în trei jurnale deodată — conversație, monitor, text.
3. **„Gata" e o măsurătoare.** La `card_gata`, serverul citește el pagina și
   spune dacă vede card la dosar **și** plată automată. Card fără plată automată
   = **neterminat**, și i-o spune: peste o lună ar tăcea din nou. Regula ta #1.

**Ce rămâne al tău, o singură dată:** valorile cardului se pun **de mâna ta** ca
secrete GitHub (`CARD_NUMAR`, `CARD_EXPIRARE`, `CARD_CVC`, `CARD_NUME`,
`CARD_COD_POSTAL`), apoi `vps-set-env`. **NU prin Kelion** — `secret_pune`
refuză din construcție orice arată a card (13-19 cifre + Luhn) și rămâne așa.
Pentru cea mai sensibilă valoare din sistem, un pas manual e mai bun decât o
automatizare care poate greși.

**M6 nu se ia în bucla de noapte** — dacă fereastra de voce e închisă, bucla
trece peste el fără să-l ardă în încercări eșuate (are test: altfel M6, fiind
cel mai puțin încercat, ar fi fost ales primul la fiecare trecere și ar fi
înfometat tot restul).

**Unde se vede că bucla trăiește:** Admin → Bani, rândul „Kelion, de capul lui" —
scrie ultima trecere: ce a pornit singur, sau de ce nu. Dacă rândul lipsește sau
e vechi de ore, bucla nu merge; nu se presupune că merge.

**Bariere: niciuna dintre ale mele.** Pusesem un plafon zilnic și un abandon
după trei încercări. Nu mi le ceruse nimeni — sunt scoase (30 iul, PR #593).
Rămâne „un singur ordin odată", care nu e o permisiune: lucrătorul ia oricum un
ordin pe rând.

**DE LA PRIMA REÎNCERCARE, IESE ȘI CAUTĂ** — nu de la a treia (corectat 2 aug:
codul o face deliberat de la prima reîncercare — „pragul de 3 era al meu, nu al
lui" scrie chiar în `autonomie.ts`; rândul ăsta rămăsese pe varianta veche). Nu
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

---

## K. TOT CE MI-AI CERUT PE 3 AUG (dimineața) — și ce am făcut cu fiecare

> Adrian, 3 aug: „cauta tot ce ti-am scris pune in tabel si arata ce ai facut
> din tot ce am scris ca asa nu se mai poate." · „tot ce zic parca ricoseaza din
> tine." Are dreptate — prea mult diagnostic, prea puțin pus negru pe alb. Ăsta
> e tabelul. ✅ = făcut și publicat · 🔧 = de reparat (pe listă) · ⛔ = blocat pe
> tine, cu motivul · 🔎 = măsurat/diagnosticat, urmează reparația.

| # | Ce ai cerut/raportat | Stare | Dovada / ce urmează |
|---|---|---|---|
| K1 | „continuă și repară" autonomia | ✅ | Ritm dinamic al buclei (2 min după o acțiune, nu o oră fixă) — PR #666, unit. |
| K2 | Cerințele nu primesc ordin decât după ce se termină toată misiunea | ✅ | Coada schimbată: cerința analizată primește ordin și cu misiunea deschisă — PR #666, unit. |
| K3 | „a rămas vreun PR nemerge-uit?" | ✅ | Am închis 17 PR-uri vechi, depășite (schelării de constructor iul, bug „litere sparte", docs Railway, soneria #110). Rămâne deschis doar #401 (ghid Google OAuth), decizia ta. |
| K4 | Citirea plăților Revolut: lipsește `ENABLE_BANKING_APP_ID` | ⛔ | Înregistrarea aplicației Enable Banking cere titularul + trece prin **reCAPTCHA cu imagini** (măsurat cu browserul de pe VPS) — nu o pot face eu. Ți-am dat cheia PUBLICĂ (derivată din cea privată de pe server, neatinsă) + pașii + redirect `kelionai.app/admin`. Îmi dai App ID → îl pun eu în env + verific M1. |
| K5 | (găsit reparând K4) Browserul mâinilor mort la fiecare publicare | ✅ | `/root/.cache/ms-playwright` nu exista în container → orice `browser_open` crăpa. Reparat: volum persistent + instalare la deploy (pas 4b) — PR #667, unit. |
| K6 | La pornire să NU spună „văd că ați trimis o imagine" — s-o **primească și s-o salveze**, atât; doar salut ancorat pe **oră** | ✅ | Reparat: imaginea primită la pornire e procesată/salvată tăcut, răspunsul este strict salutul ancorat pe oră (dimineața/ziua/seara), fără formulări interzise precum „Văd/Observ". |
| K7 | Cheia OpenAI nu e corect legată — pastila dă „⚠ OpenAI" | ✅ | Extirpate complet din cod (3 aug): OpenAI/OpenRouter eliminate, creierul e Gemini direct + Serper + Chirp 3. Nu mai există consumator sau verificare `OPENAI_USAGE_KEY`. |
| K8 | De unde apar cuvinte ca „Greț" — n-am scris nimic | 🔧 | Intrare-fantomă în chat (bulă user „Greț." fără ca tu să scrii). Cel mai probabil transcrierea vocală (STT) inventează cuvinte din tăcere/zgomot. De reparat: prag de energie + să nu trimită transcrieri fără vorbire reală. |
| K9 | Golește istoricul cu joburi eșuate | 🔧 | 12 ordine picate în `build_jobs` (11 vechi + #28). Zidul le ignoră deja (granița=26), dar tu le vezi în panou. De curățat/arhivat + de ascuns cele vechi din panou. |
| K10 | Când dai ordin de build și creierul nu poate, să te anunțe „bifează creier superior" (auto dacă se poate, dar și manual ca acum) | 🔧 | Azi #28 a picat pe „creier" fără să-ți spună clar că e nevoie de treaptă superioară. De adăugat: la eșec de tip „creierul nu poate", anunț explicit către admin cu butonul de escaladare. |
| K11 | Trecut la cereri neacoperite | ✅ | Legat lista de cereri neacoperite (`plati_neatribuite` + cereri de la useri) în fluxul de lucru și afișat în panoul AdminPanel (PR #668). |
| K12 | Curățat ce nu mai e de actualitate | 🔧 (parțial) | PR-urile vechi — făcut (K3). Rândurile moarte din liste + joburi — de curățat (K9). |
| K13 | Sistem automat de curățare care **arhivează** când e gata | 🔧 | De construit: la închiderea unei cerințe/job, mută în arhivă în loc să lase gunoiul la vedere. |
| K14 | Sistem de rezolvări care **anunță adminul** că sunt cereri | 🔧 | De construit: când apare o cerere nouă (scris/voce/plată neatribuită), notificare la admin. |
| K15 | „ceva toacă creditul OpenRouter, caută soluții, că e faliment curat" | 🔎 | MĂSURAT: constructorul pe **Fable 5 plătit** = ~$4-5 per ordin de build (30 apeluri azi = $5.04; ora 02 = $4.21 doar pentru cei 24 de pași ai ordinului #28). Ultimul apel al constructorului: 03:23 — deci scurgerea mică de acum (chat/analiză) e alta. Soluții de decis (mai jos). |
| K16 | „de ce sistemul nu monitorizează cerințele până la capăt? se ajung la dubluri, timp și bani" | 🔧 | Gaură reală: captarea cerințelor nu deduplică după text, iar bucla re-analizează → dubluri. De reparat: dedup la captare + urmărire clară până la „verificat", ca o cerință dusă la capăt să nu fie reluată. |
| K17 | iOS: user/pass în fișierul „kei" de pe desktop | ⛔ | **Nu am acces la desktopul tău** — rulez într-un container izolat care vede doar repo-ul, VPS-ul și site-ul live. Nu pot citi un fișier de pe Windows-ul tău. Dacă e nevoie, mi-l dai tu (dar parolele nu în chat dacă nu e musai). |

### Soluțiile pentru arderea de credit (K15) — decizia ta, cu cifre

Constructorul rulează structural pe `:free`; pe VPS e pus **conștient** `CONSTRUCTOR_MODEL=fable-5` + `CONSTRUCTOR_ALLOW_PAID=1` (alegerea ta din 2 aug, „fable 5 peste tot"). Asta arde ~$4-5 de fiecare ordin de build. Trei pârghii, oricare sau combinate:
1. **Plafon zilnic de cheltuială** pe buclă: când s-a ars X$ azi, oprește ordinele plătite și te anunță (exact „faliment curat" prevenit). Se poate face și cu buton manual.
2. **Constructorul pe `:free` implicit**, escaladează la Fable 5 **doar** când pasul pică pe neputința modelului (design-ul de escaladare există deja) — plătești doar unde chiar e nevoie.
3. **Analiza cerințelor pe model ieftin** (deja e pe `:free`), doar construirea pe plătit.

Recomandarea mea: **1 + 2** (plafon + free-cu-escaladare) — păstrează Fable 5 unde contează, dar taie falimentul.

---

## L. LISTA DE CAPABILITĂȚI CERUTĂ PE 3 AUG SEARA („implementezi obligatoriu tot")

> Adrian, 3 aug: Kelion și-a autoanalizat golurile, Adrian a ordonat „implementezi
> obligatoriu tot". Împărțirea de mai jos e CINSTITĂ (regula #1): ce pot construi
> singur, ce cere conturile/cheile TALE, ce nu se poate azi — cu dovada. Rândurile
> se taie doar cu PR + verificare live.

### L1. Pot construi singur (în ordinea valorii)
| # | Ce | Stare |
|---|---|---|
| L1a | ~~Bara de progres 0–100% pe fiecare ordin din Constructor~~ FĂCUT 3 aug: `progresOrdin.ts` (hartă etapă→procent, testată) + `pct` în `/api/admin/constructor` și `/api/constructor/live`; LIVE pe 49b8e0a (verificat pe master, apoi 979cec8) | ✅ |
| L1b | ~~Gestionare automată a ordinelor eșuate: la eșec definitiv → analiză jurnal + repunere corectată sau închidere motivată~~ **VERIFICAT ACOPERIT 12 aug** (cod, nu presupus): `autonomie.ts` are `zidul` (după `PRAG_ESEC`=2 eșecuri consecutive schimbă ținta, nu lovește același zid), `cauzaComuna` (normalizează jurnalele și scoate cauza REPETATĂ, nu ultima eroare), `escaladare` (reia CU jurnalul eșecului + abordare schimbată de la prima reîncercare), `semnaturaLumii` (parcare motivată până se schimbă lumea: versiune/chei/reușite), `arhiveazaBuildJobsVechi` (curăță ce e vechi). „Închiderea motivată" = starea zidului (`StareZid.cauza/raport`) văzută în panou. Nu re-scriu cod peste ce merge. | ✅ (acoperit) |
| L1c | ~~Auto-rerun deploy la eșec de rețea~~ **VERIFICAT ACOPERIT 12 aug**: `auto-publicare.sh` (cron 1 min) re-rulează `deploy.sh` ori de câte ori live≠master → o cădere trecătoare de rețea se auto-vindecă la următorul minut; `veghe-publicare.sh` deschide issue la divergență >15 min; `plasa-sanatate.mjs` face revert la LKG dacă publicarea nouă pică sănătatea. „dispatch_failed_204" e mut pe arhitectura de azi (GitHub Actions e mort pe org — calea VPS-cron l-a înlocuit). | ✅ (acoperit) |
| L1d | Telegram: trimitere/primire mesaje prin Bot API (îți faci un bot cu @BotFather în 2 min, cheia intră în GitHub Secrets) | de făcut — cere UN token de la tine |
| L1e | ~~Procesare CSV/JSON complexe ca unelte de chat (parse + agregări + afișare pe monitor)~~ **REZOLVAT 12 aug**: unealta `proceseaza_date` (`services/dateTabelare.ts` PUR+testat: parseCSV RFC-4180, laNumar en/ro/mii/%, JSON/NDJSON, agregări suma/medie/min/max/numar/numar_unic grupate, profil măsurat) → cadru `{doc}` pe monitor; înregistrată în `brainCapabilities`+`manual` (count 101→102); 18 teste noi | ✅ |
| L1f | Scripturi ad-hoc în sandbox pe server (constructorul deja scrie+rulează cod; de expus ca unealtă de chat cu limite dure) | parțial există (constructor) |
| L1g | Analiză imagine în timp real (obiecte/text): Gemini vede nativ DEJA (fix 3 aug); de adăugat fluxul continuu pe cameră | parțial există |
| L1h | ~~Învățare din feedback implicit: de legat semnalele („nu asta am cerut") de registru~~ **REZOLVAT 12 aug**: `services/feedbackImplicit.ts` (PUR+testat): `esteNemultumire` prinde CORECȚIILE clare (RO+EN), NU orice negație (fără fals pozitive — testat pe „nu știu"/„ce e greșit la asta?"); reproșul (ce ceruse + ce a făcut + corecția) se notează în registru (`invatare:reprosuri`, persistat, reîncărcat la boot), iar `lectiiReprosuri` bagă ultimele corecții în contextul creierului (lângă lecțiile din timpi), doar pe owner; 7 teste noi | ✅ |
| L1i | ~~Drive avansat: editare documente/foi prin API-urile Google existente (scope-uri noi la consimțământ)~~ **REZOLVAT 12 aug**: `create_doc`/`edit_doc` (API Docs: adaugă/rescrie/caută-înlocuiește), `create_sheet`/`edit_sheet` (API Sheets: append/scrie interval) în contul omului logat; scope-uri de scriere adăugate la consimțământ (`documents`+`spreadsheets`+`drive.file` — minim necesar, NU drive complet); `normalizeazaRanduri` PUR+testat; înregistrate în `brainCapabilities`+`manual` (google 19→23, count →106); 403 (token vechi) → „reconectează Google" **⚠ owner: reconectează Google o dată ca să acorzi scrierea** | ✅ (reconectare Google o dată) |

### L2. Cer conturile/aprobările TALE (nu pot fără ele — nu e refuz, e fapt)
| # | Ce | Ce-mi trebuie de la tine |
|---|---|---|
| L2a | WhatsApp | cont WhatsApp Business API (aprobare Meta, proces de zile) |
| L2b | Slack/Teams | app înregistrată în workspace-ul tău + token |
| L2c | Apeluri telefonice | cont Twilio/Vonage (număr + credit) |
| L2d | Smart home | cont Google Home/SmartThings + dispozitivele legate pe el |
| L2e | Bancar (extrase/plăți) | GoCardless există DEJA în secrete (citire); plăți = licență PSD2 — doar prin furnizor autorizat |
| L2f | Investiții | cont broker cu API (ex. Alpaca) + acceptul tău scris per tranzacție |
| L2g | Uber/Bolt/Glovo/Booking | API-uri partener — acces doar pe cont de business aprobat de ei |
| L2h | IFTTT/Zapier | cont + webhook-uri create de tine |

### L3. Nu se poate azi — cu dovada
| # | Ce | De ce |
|---|---|---|
| L3a | „Sold Gemini prin API" | Google NU expune creditul promoțional prin niciun API (verificat 3 aug pe Cloud Billing + AI Studio). Soluția onestă e LIVE: cifra spusă de tine pe pastilă, cu dată |
| L3b | Control Waze real (rute prin comenzi) | Waze nu are API public de control — doar deep-links de deschidere |
| L3c | Control desktop-ul tău (deschide aplicații locale) | rulez pe server; pe Windows-ul tău ar trebui un agent instalat de tine local — de discutat separat, e software nou pe mașina ta |
| L3d | Recunoaștere facială persoane | interzisă pe față umană de politicile mari de API și de AI Act pe identificare biometrică fără temei; obiecte+text DA (L1g) |
| L1j | Descoperire și integrare de API-uri noi: `propose_tool` + uneltele dinamice EXISTĂ deja (Kelion propune, tu aprobi cu un clic, unealta e activă instant); de adăugat pasul de căutare autonomă a API-ului potrivit | parțial există |
| L1k | GAMA COMPLETĂ de agenți Gemini (Adrian, 3 aug: „trebuie să aibă toată gama"): legat DEJA — Flash (chat/lucru), Pro (greu+constructor), Flash-Image+Imagen (imagini), Veo (video), text-embedding-004 (memorie), audio nativ (ureche); în curs — muncitorii pe gemini/ (rebazarea extirpării); de făcut — Gemini Live API (full-duplex real, probat de owner înainte de comutare) + Flash-Lite (treapta ieftină publică, probată întâi pe cheie) | parțial există |
| L1l | SUITA DE AGENȚI GOOGLE/GEMINI (Adrian, 3 aug, întrebat de 2 ori): Gemini CLI ✅ LIVE (al 4-lea lucrător, în imagine pe 979cec8). Jules ✅ LIVE ca unelte (`jules_repos`/`jules_task`/`jules_status`; dovadă 3 aug: HTTP 200, 7 surse văzute PRIN unealta lui Kelion) — dar producția `kelion-team/kelionai` NU e între sursele legate (toate-s `AE1968/*`): ownerul trebuie să lege org-ul kelion-team în Jules („Connect to GitHub"), abia apoi proba sarcină→PR. ADK = framework, nu aduce câștig peste orchestratorul existent | parțial LIVE — blocat pe legarea repo-ului (owner) |
| L1m | AGENȚII ENTERPRISE „pentru tot, inclusiv skilluri" (Adrian, 3 aug seara): TOT lanțul tehnic a fost deschis în aceeași seară, pas cu pas, fiecare cu măsurătoarea lui — API-uri aprinse ✓, rol dat ✓ (`engines.list` 200), data store-uri create ✓ (`kelion-cunostinte`, `kelion-cautare`), **motorul `kelion-agenti` („Kelion — agenți") CREAT ✓ (HTTP 200, 21:50)** — se vede în consola lui. Zidul FINAL, măsurat 21:56 pe două forme de agent (A2A + managed): `FAILED_PRECONDITION — „an active Gemini Enterprise license is not available. Please contact your GCP administrator to allocate an active license"`. Adică: crearea de agenți în Gemini Enterprise cere LICENȚĂ plătită (produs cu abonament per-loc) — decizie de bani a ownerului, nu de cod. Alternativa care EXISTĂ deja: cei 34 de agenți 🏠 din aplicație (meserii + skilluri pe creierul Gemini). Scriptul `scripts/creaza-agenti-enterprise.mjs` ține tot lanțul și rosterul (~33) — în secunda în care licența apare, o rulare îi creează pe toți și citește lista din API | ACTUALIZAT 4 aug seara: LICENȚA CUMPĂRATĂ de owner (Gemini Enterprise Standard, $35/lună, ACTIVE) — verdictul vechi era greșit, nu trebuie organizație Workspace. Butonul din admin creează agenții ÎN FUNDAL cu ritm (fix 429, PR #747); primii intrați măsurat (Agent Deploy CI, Agent Monitorizare, Inginer-șef...). RĂMAS: quota Google de creare e strânsă azi (429 repetat) — apăsări repetate până intră toți; „nu pot verifica" încă numărul final din consolă. MĂSURAT 8 aug (jurnalul lui Kelion): resetul = miezul nopții Pacific, ritmul real = 2/zi (docs ziceau 1/zi), iar cele 8 rafale de 429 erau repornirile de la deploy-urile mele (~7-9 min după fiecare merge), nu cota — „nu e de la limitare, cauta greseli in soft" (ownerul, corect). Reparat și PUBLICAT (PR #884, live `e75bfed` măsurat pe `/api/version` 8 aug 10:29 UTC). APOI, tot 8 aug, ordinul ownerului: „scoate partea asta si sa ramina manual adaugarea dar functionala" — TOATĂ calea consolei ȘTEARSĂ (enterpriseCreate.ts, rute, scripturi, boot-resume), cu garanția MĂSURATĂ pe live înainte de tăiere: /api/a2a → 92 agenți, agentul „adevar" a răspuns corect 17×23=391. Rămas funcțional: agent-nou manual + temele iscoadelor. Rândul ăsta e ÎNCHIS |
| L1o | **GITHUB ACTIONS MORT DIN 6 AUG 04:50 UTC** (raportat de Kelion pe 8 aug — „diverente intre versiuni si deploy esuate" — și confirmat cu măsurători independente): ultima rulare verde `deploy` #899 (6 aug 04:16), prima roșie #900 (04:50); de atunci 100% roșu pe TOT ce cere runner (deploy #900–#947, sentinel). Semnătura măsurată: jobul moare în 1–3s, `runner_id=0`, **0 ms facturate** (get_workflow_run_usage), zero loguri, anotații goale; între verde și roșie NICIUN diff în `.github/workflows/` (doar AdminPanel/admin.ts) → blocajul e la NIVEL DE CONT GitHub (repo privat: minute Actions epuizate / limită de cheltuieli / plată picată), NU în cod. Consecințe: publicarea REALĂ merge (veghea VPS a publicat toate cele 10 merge-uri din 8 aug, ~7–9 min fiecare), dar au murit: verificatorul anti-fantomă din `deploy.yml`, sentinela de sănătate din afară (`sentinel.yml`), și calea `vps-run` de acces la VPS. „Diverența de versiuni" văzută de Kelion = fereastra normală de ~9 min a publicării (master `e75bfed` 10:19 → live `e75bfed` 10:29, măsurat pe `/api/version`); acum master=live | fix = 1 min al ownerului: github.com/organizations/kelion-team/settings/billing → Actions (minute rămase / spending limit / plată); din cod nu se poate. ACOPERIT PE VPS 8 aug (seara): veghea publicării acum instalată de deploy.sh (6g — era scrisă din 7 aug dar neinstalată de nimeni), sentinela locală (6b) și vindecătorul (6e) erau deja în cron → publicare + sănătate + anti-fantomă merg FĂRĂ Actions; health.ts raportează acum cauza MĂSURATĂ (toate rulările roșii mor în ≤20s = blocaj de cont, cu butonul în text) |
| L1n | URECHILE CHIRP JOS (măsurat 3 aug 22:12, email alertă): `PERMISSION_DENIED speech.recognizers.recognize` — foarte probabil rolul Speech pierdut la editarea IAM din aceeași seară (corelație de timp; „nu pot verifica" exact ce rol a dispărut — IAM nu e citibil cu contul de serviciu). PLASA construită imediat (ordin „auzul pe Gemini"): urechea Gemini în PR #715 — batch + rafale streaming, fără IAM. Reparația Chirp = ownerul re-adaugă rolul „Cloud Speech Client" (sau Editor) pe kelion-ears în IAM | plasă în PR #715; rolul Chirp = 1 click owner |

## M. AUDITUL RUTELOR CARE SCRIU (8 aug 2026) — măsurat, nu citit

Ce s-a făcut: aplicația a fost pornită local cu **mediul curățat de credențiale**
(listă albă: doar `PATH`, `HOME`, `NODE_ENV`, `PORT`, plus un `SESSION_SECRET` și
un `ADMIN_EMAIL` generate pe loc) și au fost lovite **toate cele 57 de rute care
scriu** — de două ori fiecare: fără bilet (poarta) și cu bilet de admin (ce face
butonul cu adevărat). Unealta: `scripts/proba-scriere.mjs`.

De ce curățarea mediului nu e un moft: containerul în care rulează probele **are
`GITHUB_TOKEN`**, iar `POST /api/admin/reset-vps` cheamă `runRunbook` →
`workflow_dispatch` pe repo-ul real. O probă care moștenea mediul ar fi repornit
producția.

| # | Ce s-a găsit, măsurat | Stare |
|---|---|---|
| M1 | `POST /api/admin/reset-vps` întorcea `200 {"ok":true}` **orice s-ar fi întâmplat** — arunca răspunsul celor două runbook-uri. Dovadă: fără `GITHUB_TOKEN`, `runRunbook` a întors `{"error":"github_token_missing"}` și ruta a răspuns tot `ok:true`; panoul scria „Comanda a fost trimisă cu succes". La fel s-ar fi purtat cu autonomia pe pauză (`paused_by_owner`) | ✅ reparat + 6 teste pe răspunsurile reale ale runbook-urilor |
| M2 | `POST /api/admin/reset-counters` („Pune pe 0") întorcea `200 {"ok":false,"sterse":0}`, iar panoul se uita **doar** la statusul HTTP → scria „Resetat ✓" peste contoare neatinse | ✅ reparat (502 la eșec) + panoul citește cifra ștearsă |
| M3 | `DELETE /api/voiceprint/me` întorcea `200 {"ok":false}` pentru o ștergere picată (panoul citea corpul, dar uneltele lui Kelion și scripturile nu) | ✅ reparat (502) |
| M4 | `POST /api/tranzactii/analiza` întorcea `200` cu `{error:…}` pe trei ieșiri (piață necitibilă, agent lipsă, agent mut) | ✅ reparat (502/503) |
| M5 | **Poarta**: 38/38 rute privilegiate refuză cererea fără bilet. Zero rute de admin fără poartă | ✅ măsurat |
| M6 | Zero rute care crapă, tac sau lipsesc la rulare (57 din 57) | ✅ măsurat |

### M7. GĂSIT ȘI **NEREPARAT** — familia „citire picată → 0/gol" din `db.ts`

CORECȚIE LA PROPRIA MEA CIFRĂ (8 aug, aceeași zi): am scris întâi „36 + 49"
într-un fel care sugera 85 de locuri distincte. **Nu e adevărat** — 28 dintre
funcții apar în ambele liste. Numărat din nou, cu scriptul de față: din **130**
de funcții exportate în `backend/src/db.ts`, **35** întorc gol/zero la
`!dbEnabled()` și **49** în `catch`, iar reuniunea e de **56 de funcții
distincte**. Umflasem breadth-ul cu 50%; o cifră dată din cap, într-un document
despre cifre date din cap.
Adică o citire IMPOSIBILĂ iese pe sârmă ca un fapt: `listUsers()` → `[]`
(„0 utilizatori"), `getBalance()` → `0` („£0.00"), `getCostSummary()` → totul pe
zero. E exact familia care te-a costat ziua de 30 iulie.

**Nu toate sunt defecte** — unele sunt corecte prin proiectare (`isBlocked → false`
ca o pică de bază să nu blocheze pe toată lumea; `touchVisit → true` ca analitica
să nu rupă aplicația). De-aia nu am făcut o rescriere în bloc: ar fi fost fix
genul de operație pe nevăzute care a stricat lucruri înainte (regula #3).

Subsetul care contează cel mai mult, de atacat cu `Masuratoare<T>` din
`services/masurare.ts` (varianta picată n-are câmp `valoare`, deci minciuna nu
compilează): `getBalance`, `getWalletStatus`, `getCostSummary`, `listUsers`,
`listAllTransactions`, `getHistory`.

**Cum se vede că e real:** în producție `DATABASE_URL` există, deci `dbEnabled()`
e adevărat și zerourile astea nu apar la mers normal. Apar **la o pică de bază de
date** — adică exact în minutul în care ai nevoie de adevăr, panoul ar arăta
„£0.00" și „0 utilizatori" în loc de „nu pot citi".

| # | Ce | Stare |
|---|---|---|
| M7a | **Soldul** — `getBalance`/`getWalletStatus` înlocuite cu `citesteSold`/`citestePortofel`, care spun `citit:false` + motiv. Consecința reparată nu era cosmetică: `chat.ts` ridica **paywall-ul** („Ai rămas fără credit") pe un sold necitit, `realtime.ts` **tăia vocea** (`stop`), iar `/api/billing/balance` afișa 0 credite — deci un sughiț de bază de date îi spunea unui om cu credit plătit că n-are bani, și îl bloca. Acum: citirea picată **nu ridică zidul** (eroarea noastră nu se plătește din buzunarul lui), ruta dă **503 `sold_necitit`**, iar `validateTopUp` refuză să valideze pe un portofel necitit (înainte `topupRef=0` însemna „prima alimentare, minim £20" pentru oricine, la orice sughiț) | ✅ reparat, 999 teste verzi |
| M7b | Restul: `getCostSummary`, `listUsers`, `listAllTransactions`, `getHistory` — aceeași trecere pe o citire care spune „nu pot" | ✅ **ÎNCHIS 8 aug (seara)**: `listUsers`/`listAllTransactions`/`getHistory` erau deja migrate (măsurat: nu mai există în db.ts); `getCostSummary` → `citesteRezumatCost()` (Citire), consumatorii spun motivul: `/api/admin/costs` + `/finance` → 503 cu motiv, `money-circuit` → `costRealMotiv` afișat în panou, uneltele lui Kelion → „nu pot citi jurnalul de cost: motiv" |

### M8. Creditul rămas pe fiecare AI (cerut 8 aug)

`GET /api/admin/credit-ai` + `services/creditAI.ts`: un rând pe furnizor, fiecare
cifră fiind o `Masuratoare<T>` (ori valoare + cum s-a citit, ori motiv).

| Furnizor | Sold rămas | Ce e măsurabil |
|---|---|---|
| Serper | **citibil real** (`GET /account`) | căutări rămase, live |
| Gemini (Google AI) | **nu e citibil** — Google nu expune sold prin API | creditul spus de tine − cheltuiala lunii măsurată din `cost_events`; plus starea live a cheii |
| Google Cloud (voce/traducere/agenți) | **nu e citibil** | cheltuiala lunii (`asr`, `voice_minutes`, `tts:*`) + link la facturare |
| Jules | **nu e citibil** | nimic — Jules nu trece prin `recordCost`, deci nu raportez nicio cifră |

Probat pe instanța de probă (fără chei, fără DB): ruta a răspuns `200` și **toate
cele 8 celule au ieșit „nu pot verifica" cu motiv**, niciun zero inventat.
RĂMAS: Gemini și Google Cloud n-au fost încă văzute cu chei reale — „nu pot
verifica" cifrele live până nu se uită cineva pe kelionai.app.

## N. VÂNĂTOAREA „DECLARAT DAR NECABLAT" (10 aug 2026) — 19 găuri, val 1 reparat

Un workflow cu 27 de agenți (vânători + verificator adversarial per constatare) a
căutat tiparul `get_monitor`: capabilități DECLARATE undeva dar NECABLATE. **Val 1
reparat** (același PR): `ruleaza_portile`/`jurnal_masuratori`/`vaneaza_buguri` legate
la creierul de chat (fără primul, PR-urile REFUZAU structural din chat);
`execUserScopedTool` cablat pe voce (7 unelte răspundeau „nesuportată în voce");
memoria iscoadelor scrisă pe 'kelion' (era scriere-oarbă); memoria de lungă durată
(recall+învățare) adusă pe calea vocală; `goleste_monitorul` în registru+manual;
`niveluri`/`gest`/`gesture` în `CADRE_ECRAN`; `proba-restaurare` anunțat în `run_runbook`.

**VAL 2 — RĂMAS (dovadă în raportul workflow-ului, `tasks/wi0dv62rm.output`):**

- **Frame `niveluri` nu se EMITE pe voce.** Adăugat în `CADRE_ECRAN`, dar
  `turaCreierului` (vocalLive.ts) NU pasează contextul `tranzactii` către /api/chat,
  deci `piata` e undefined și cadrul {niveluri} nici nu se produce. De cablat:
  clientul vocal trimite starea de tranzacționare + turaCreierului o pune în body.
- **Persona vocală supra-declară vedere continuă.** Textul personei promite „primești
  CADRELE ei în timp real — aia e ce VEZI acum", dar ceasul de cadre a fost scos pe
  9 aug (`cadruLive` + calea `{type:'cadru'}`/`scrieCadru` = cod mort); vederea reală
  e doar la cerere, prin ușă. De ales: ori repui ceasul, ori corectezi persona +
  scoți codul mort (ca modelul să nu pretindă o vedere pe care n-o are).
- **Deblocarea admin prin voce = listener fără emițător.** `Stage.tsx` ascultă
  `kelion:admin-unlock`, dar nimeni nu-l emite (amprenta vocală a fost scoasă din
  calea vocii pe 6 aug). Lacătul e azi dezarmat, dar la rearmare doar secretul tastat
  ar merge. De ales: ori emiți evenimentul la potrivirea amprentei, ori scoți
  listener-ul + comentariile care promit calea.
- **Memoria 'tranzactii' nu e reamintită în conversație** (doar butonul Analiză o
  citește). Într-o discuție normală despre BTC, observațiile pietarului nu apar. De
  decis dacă e intenționat (memorie doar-prin-buton) sau de cablat un recall pe
  'tranzactii' când tabul de trading e ancorat.
- **Cod mort/UX fără feedback (mic):** banda „queued" + `pendingSendsRef` nu se mai
  populează (barge-in a înlocuit punerea în coadă) — de curățat; butonul „●
  Înregistrează scenariul" e mut la eșec (fără getDisplayMedia / la refuz) — de adăugat
  ack ca la butonul Rec principal.
- **Respinse la verificare (2):** nu erau găuri reale (verificatorul adversarial le-a
  infirmat).

## O. SENTINELĂ + SCURGERE DE MARKUP (13 aug 2026) — reparat în cod, de verificat live

| # | Ce nu mergea | Stare |
|---|---|---|
| O1 | **Emailul fals „23 erori de client în ultima oră".** Cablajul [PERF] din 13 aug (fir principal blocat / ceas lent → `raporteazaSimptom` → `/api/client-errors`) e CORECT — vrei ca astea să ajungă la creier — dar sentinela le număra ca „erori UI rupt" și trimitea alarma. FIX: `[PERF]` primește `type='perf'` la salvare (`routes/clientErrors.ts`); un helper unic `countClientErrorsLastHour()` (`db.ts`) numără doar erorile REALE (exclude `type='perf'` ȘI mesajele cu `[PERF]` — și rândurile vechi din fereastră), folosit de sentinelă (`routes/ops.ts`) ȘI de scanarea de sănătate (`services/health.ts`). Creierul TOT le vede (inel `recentClientErrors` + `client_errors` prin db_query), doar nu mai declanșează „UI rupt". | 🔧 reparat, de verificat live (owner): emailul nu mai vine doar din blocaje [PERF] |
| O2 | **`response:secret_publica{result:{rezultat:{}` brut în bandă.** Un model slab tastase wrapperul de REZULTAT al unei unelte ca text; `toolMarkup.ts` cunoștea apelurile goale (`get_weather`, `call:x{...}`) dar nu forma cu prefix de răspuns. FIX: `CALL_LINE_RE` + `PARTIAL_CALL_LINE_RE` prind acum prefixul opțional `response:`/`result:`/`output:`/`observation:` (eventual `tool_`-) înaintea unei unelte a turei — se ASCUNDE (stream + text final), NU se execută (e rezultat fabricat); garda pe `knownTools` rămâne, deci o frază care menționează unealta stă vizibilă. 6 teste noi. | 🔧 reparat, de verificat live (owner): în bandă nu mai apare `response:...{...}` brut |

> **RELUAREA ÎNTREGII DISCUȚII (14 aug, 21:20 — ordinul „nu zău, reia toată
> discuția"; extras din transcriptul brut, nu din memorie).** Cerințe din
> straturile vechi regăsite și starea lor:
> - „Kelion să aibă acces la ORICE buton apare pe ecran" — PARȚIAL (click_monitor
>   + poarta comenzii clare); acoperirea buton-cu-buton a TUTUROR suprafețelor
>   rămâne de probat live. [ ]
> - „vocea care funcționează să fie PESTE TOT în aplicație" — reunit cu „audio
>   obligatoriu pe scris" (#1118); de probat live pe toate căile. [ ]
> - „sistemul de auzit să NU se mai schimbe niciodată" — angajament de
>   stabilitate: orice schimbare pe lanțul urechii cere acordul explicit al
>   ownerului; de adăugat un lacăt de tip verifica-gemini pe pipeline-ul ASR. [ ]
> - „liber la creier pe gratuite; la plată DOAR cu întrebare" — construit
>   (aprobare la 402); de re-verificat live după toate schimbările de azi. [ ]
> - „pentru alți useri din RO cum se va face?" — limba per user există
>   (detectare 2 mesaje + persistare); de probat cu un cont nou RO. [ ]
> Restul cerințelor vechi (Revolut/KLN automat, gratuitele de bun-venit, becuri
> reale, Gemini permanent cu rezervă anunțată) sunt FĂCUTE și live — dovezile în
> AI-HANDOFF §13.

## P. FLUXURILE FIFO DIN 15 AUG (dimineața) — ordinea fixată de owner: „le rezolvi doar in ordinea finalizari, nu intrerupi fluxuri"

| # | Ce | Stare |
|---|---|---|
| P1 | **Dovezile 6+7 ale autonomiei** — dovada 6: golurile „DE IMPLEMENTAT" flămânzeau în spatele unei misiuni fără pași rulabili (un pas PARCAT ținea `misiuneGata=false` fără să ruleze); dovada 7: `imbunatatireContinua()` (singurul izvor de cerințe cu `sursa='kelion'`) era chemată doar când bucla nu avea absolut nimic de dus — practic niciodată. FIX: misiunea fără pas rulabil lasă lista generală la rând (autonomie.ts) + reanaliza zilnică lângă triaj (index.ts). Verzi REAL abia când bucla produce pe viu golul construit + cerința lui. | 🔧 în fluxul 1, de verificat live pe panoul dovezilor |
| P2 | **Politica monitorului** — nimic doar-poză. Măsurat: un site care refuză înrămarea (X-Frame-Options/CSP) tot declanșează onLoad → rama moartă era raportată „ok"; lista frontend știa doar de google.com. FIX: `/api/embed-check` (citește anteturile paginii pe server, urmărește redirecturile cu gardă SSRF la fiecare pas, prinde peretele accounts.google.com pe nume) + `MonitorPagina` (refuz măsurat → panoul cinstit cu „deschide în tab" + status error spre creier; „nu pot verifica" ≠ refuz) + legătura „↗ deschide în tab" mereu vizibilă în antetul monitorului pentru orice suprafață cu adresă. 8 teste noi. | 🔧 reparat în cod, de verificat live: o pagină care refuză rama (ex. github.com) cade pe panou, nu pe cutia moartă; ↗ apare în antet |
| P3 | **Poza vizitatorilor** — MĂSURAT: coloana `visits.photo_url` exista din 13 aug și panoul o afișa, dar NIMENI n-o scria vreodată (decorațiune). FIX pe lanț întreg, cu consimțământ (ordinul din 13 aug „cu acceptul lor"): cameră ACORDATĂ → un cadru mic/sesiune (CameraView + vizita.ts, la 1,5s după pornire) → `/api/visit/poza` validat strict (doar data-URL imagine ≤200KB) → `attachVisitPhoto` scrie DOAR peste gol (prima poză rămâne); vizitele logate primesc poza CONTULUI prin JOIN faceprints; boții fără cameră = fără poză, prin construcție. Lacăt: pozaVizitatorului.test.ts (4 verigi). | 🔧 reparat în cod, de verificat live: o vizită cu camera acordată apare cu poză în Admin → Vizitatori |
| P4 | **Bucla închisă „cerința #N e LIVE / a murit"** — MĂSURAT: verificaLivrata() (autonomie.ts) muta doar starea în tabel; ownerul afla de o probă picată abia lovindu-se de ea. FIX: ambele tranziții anunță prin notifyAdmin (panou + push pe telefon, pushTelefon fiind deja cablat în notifyAdmin din #1158): „Cerința #N e LIVE" cu dovada / „Cerința #N a picat proba pe live" cu ce s-a văzut. Tipuri noi cerinta_live/cerinta_picata; lacăt cerintaLive.test.ts. | 🔧 reparat în cod, de verificat live: la următoarea cerință verificată vine push pe telefon |
| P5 | **Verificatorul lanțului Google** — MĂSURAT intrare cu intrare: toate cele 17 aplicații din meniu au lanț REAL (gmail/calendar/drive/docs/sheets/tasks/slides/forms/meet-conferenceData/photospicker/youtube search+upload/business/veo/imagen; Hărți = harta proprie same-origin; Căutare = web_search/Serper). LACĂT nou lantGoogle.test.ts: (1) o intrare nouă de meniu fără dovadă pică testul; (2) fiecare dovadă (semnătura endpoint-ului în serviciul ei) se verifică; (3) scope-urile OAuth din consimțământ acoperă uneltele. Reconectarea ownerului: dispecerul cere deja re-conectarea la 403 (token mai vechi decât scope-urile noi) — starea LUI se vede în Admin → token-checks. | 🔧 lacăt în cod (PR curent); owner: dacă vreo unealtă Google răspunde 403, reconectează-te O dată |
| P6 | **Utilizatori unici pe email** — MĂSURAT: gruparea era pe `user_email` sensibil la majuscule (aceeași adresă scrisă altfel = rânduri separate) + sub listă stătea lista PLATĂ „Sesiuni recente" care repeta același om de N ori (exact captura ownerului). FIX: agregare pe `lower(email)` (și subinterogările sold/blocat/consum pe lower), device-urile DISTINCTE pe (adresă, device, browser) atașate SUB fiecare user (sesiuni, timp, ultima intrare, IP, loc), lista plată scoasă. Lacăt utilizatoriUnici.test.ts. | 🔧 reparat în cod, de verificat live: Admin → Utilizatori — un rând pe adresă, device-urile dedesubt |
| P7 | **PR-urile merged se arhivează singure + sistemul informațional PR** — MĂSURAT: ordinul done rămânea „în așteptare" și cu PR-ul demult îmbinat (#301) — nimeni nu întreba GitHub-ul; creierul n-avea NICIO unealtă de PR-uri. FIX: (1) mătura din index.ts (la 3 min de la boot, apoi la 10 min): ordin done + PR CONFIRMAT merged (204 pe /pulls/N/merge) → arhivat, iese din listă; 404 rămâne (atunci „în așteptare" e adevărat); eroare → nu ghicim; (2) unealta `pr_lista` (creier, ADMIN): toate PR-urile cu stare/merged/ramură/sha/URL, citire picată spusă pe față. Lacăte: prInfo.test.ts; numărătorile actualizate conștient (37 unelte, 115 capabilități). | 🔧 reparat în cod, de verificat live: un ordin cu PR merged dispare din coadă în ≤10 min; „Kelion, arată-mi PR-urile" răspunde cu date reale |
| P8 | **Numele ordinelor = FAPTA** — MĂSURAT: rândul arăta primele litere ale promptului (ambalajul), fapta stând mai jos după marcaje fixe. FIX: `numeleOrdinului()` (services/numeOrdin.ts, funcție pură) extrage fapta din „CE A CERUT" (cerințe+goluri), „SARCINĂ LUATĂ SINGUR… rândul XN"+titlu (lista), sau prima linie de conținut după curățarea ambalajului (ordine directe); legată în AMBELE afișaje (panoul admin `nume` + monitorul /live). Ordinul întreg rămâne neatins pentru constructor. 6 teste pe șabloanele reale. | 🔧 reparat în cod, de verificat live: coada arată „Opțiuni schimbare limbă bara admin", nu „NIVEL DE DIFICULTATE: 3/5 CERINȚA…" |
| P9 | **Legitimația de admin 2 a lui Kelion** — FIX livrat: `TOKEN_ADMIN_INTERN` (session.ts — token aleator pe viața procesului, nu părăsește procesul), acceptat de `cerAdmin` DOAR de pe loopback (verificat pe `req.socket.remoteAddress`, nu req.ip/XFF); `adminVedere` îl pune pe ambele fetch-uri (vezi+schimbă) lângă cookie → pe voce și în bucla autonomă panoul răspunde, iar în audit apare `kelion@kelionai.app`, nu ownerul. Secțiunea „ordine" (GET /api/admin/constructor) mutată pe cerAdmin. Banii/restore rămân ai ownerului (DOAR_OWNERUL neatins). Lacăt legitimatiaAdmin2.test.ts (6 teste). | 🔧 reparat în cod, de verificat live: pe VOCE „uită-te în panou la ordine" răspunde cu date, nu cu „sesiunea nu e de admin" |
| P10 | **Cifrele suspecte, lămurite cu măsurătoare** — SOLDUL £-1027.99: real în tabel, dar ISTORIC — toate căile de debit de azi îl scutesc pe owner (tarife/voce/chat, măsurat); datoria e dinaintea scutirilor și nu se mai mișcă; panoul o spune acum lângă cifră („scutit — sold istoric") + tooltip cu butonul de zero (Admin → user → credit — mișcă bani, îl apeși TU). PLAFONUL „$0.00 măsurat": două găuri de regula #1 tăiate — `catch → 0` prezenta citirea picată drept măsurătoare (acum „NU POT CITI cheltuiala" cu motivul), iar joburile fără cost raportat făceau zeroul să pară „nu s-a cheltuit" (acum: „N joburi fără cost raportat — cifra e minimul măsurat"). Lacăt cifreCinstite.test.ts. | 🔧 reparat în cod, de verificat live în Admin: nota „scutit" pe rândul tău + contextul la plafon |
| P11 | **Ecoul „sala de nunți" din FILMARE** — vocea lui Kelion intra pe înregistrare de 2-3 ori: registrul vocilor vărsat necondiționat (rămas de la 8 aug, când captura de tab NU auzea vocea prin WebRTC — dar reforma anti-ecou a scos WebRTC, deci captura o aude ACUM) + copia acustică din microfonul narațiunii deschis fără AEC. Măsurat în filmarea ownerului: copie la ~40ms, corelație 0.48. FIX: registrul se varsă doar când captura n-are audio de tab; microfonul narațiunii cu AEC pornit (recorder.ts, lacăt salaDeNunti.test.ts). | 🔧 reparat în cod (PR #1166), de verificat live: o filmare nouă cu „Distribuie audio" bifat → o singură voce |
| P12 | **Răspunde DOAR la nume — STRICT, livrat pe litera ordinului** („doar cind aude numele, doar atunci"). Sistemul exista din 9 aug (gard determinist pe server: nume SAU fereastră de dialog 120s + excepția primei ture); „doar atunci" le-a revocat: turaAdresata = doar numeStrigat; fereastra/prima tură/„nimic auzit→trece" scoase; plasa de timp fail-open→fail-closed (1500ms fără transcriere = tăcere, contor pe față); instrucțiunea modelului aliniată („FĂRĂ EXCEPȚII — FIECARE frază cere numele", inclusiv răspunsul la propria lui întrebare). Anunțurile de SISTEM trec în continuare. Lanțul AUZULUI neatins (lacătul Gemini verde). Dacă ownerul vrea înapoi fereastra de dialog, se repune doar cu ordinul lui. | 🔧 reparat în cod, de verificat live: vorbește FĂRĂ nume → tăcere; „Kelion, ..." → răspunde |
| P13 | **Limita de încărcare fișiere în chat** (ownerul, 15 aug: „trebuie sa-i maresti spatiu de incarcare in chat") — de măsurat limita reală (bodyLimit/multipart backend + orice limită frontend), apoi mărită cu cap + mesaj cinstit la depășire. | ⏳ în coadă |

