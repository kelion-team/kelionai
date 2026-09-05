# Admin: inventar de controale și audit — 5 septembrie 2026

## Proveniență și limită

Inventar static citit cu `git show e65f0112:<fișier>` din versiunea `e65f0112aa2265fea12bfd248b8da645b428017a`, indicată de coordonator drept versiunea live. Modificările nepublicate din worktree-ul Doctor **nu** sunt confundate cu această versiune. Inventarierea nu execută acțiunile descrise mai jos și nu certifică funcționarea lor live. Nu s-au accesat sau copiat secrete, mesaje private ori date financiare personale pentru acest document.

Sursa meniului: `frontend/src/lib/admin.ts` (`ADMIN_TABS`) și `frontend/src/components/AdminPanel.tsx`. Sunt **13 taburi**, plus controalele globale. Criteriul pentru „funcțional” este efectul și dovada lui, nu simpla existență a butonului sau un HTTP 200.

Legendă: **R** citire; **L** efect local în browser; **W** modificare persistentă; **D** ștergere/oprire/restaurare; **B** bani sau consum posibil de servicii; **P** date private; **E** transmitere către serviciu extern. Un tab R poate declanșa probe la deschidere: excepția importantă este Tokenuri, care poate genera inferență OpenAI.

## Dovezi live comunicate de coordonator

Sesiunea de browser a coordonatorului, 06:24–06:26 UTC, versiunea e65f0112; nu sunt măsurători executate de autorul acestui inventar:

| ID | Observație efectivă | Ce NU dovedește |
| --- | --- | --- |
| LIVE-01 | Audit read-only trimis prin chat; indicatorul a afișat 8,6/9,0 secunde, dar fără răspuns vizibil sau accesibil după terminare. | Nu confirmă livrarea răspunsului și nici succesul auditului. Cauza necesită traseul exact al cererii. |
| LIVE-02 | Admin → Erori afișează „Nu pot citi erorile”. | Nu înseamnă zero erori. Remedierea parserului este rezervată probei Constructor reale. |
| LIVE-03 | Admin → Bani afișează încă „Autonomia PORNITĂ PERMANENT”. | Textul nu dovedește funcționarea Doctorului sau a Constructorului. |
| LIVE-04 | Bani: Costs/Usage `invalid_key`, inferență OpenAI `insufficient_quota`, citire Serper eșuată. | Costurile administrative, creditul API și abonamentul ChatGPT sunt surse distincte; un eșec de citire nu stabilește soldul. |
| LIVE-05 | Utilizatori → Vezi chat deschide istoricul, cu mesaje din iulie la început, nu ultimul mesaj din septembrie. | Singură, poziția de scroll nu probează pierderea mesajelor; defectul de limitare este documentat separat mai jos. |

## Matricea completă a taburilor și acțiunilor

Toate rutele `/api/admin/*` de aici verifică sesiunea admin; mutațiile prin cookie sunt supuse verificării globale a originii în `backend/src/index.ts:187` și `session.ts:120`. Sesiune lipsă → 401, rol nepotrivit → 403; butonul ascuns nu înlocuiește autorizarea serverului. Constructorul are suplimentar contractele canonice pentru stare, identitate și versiunea ordinului. Endpointurile publice de citire sunt indicate separat.

| Tab / control | Ce conține și ce face, inclusiv controalele condiționale | Contract / dovadă minimă de acceptare | Clasă |
| --- | --- | --- | --- |
| Global: cele 13 taburi; Înapoi | Navigare și închiderea panoului. Bara Credite AI afișează starea furnizorilor din snapshotul paginii; tooltip cu explicația măsurării. | Tabul ales și conținutul lui trebuie să corespundă; erorile de citire nu devin liste goale/verde. Înapoi păstrează chatul. | R,L |
| Global: Pornește pe telefon / Pe telefon: pornit | Cere permisiunea de notificări; creează/retrage abonarea browserului și serverului. „Blocat din browser” și „indisponibil aici” dezactivează controlul. | GET `/api/push/cheie`; POST `/api/push/aboneaza`, `/dezaboneaza`. Permisiune + abonare confirmată de server; livrarea push necesită probă distinctă. Vezi ERR-03. | W,E |
| **Bani** | Costuri interne totale/astăzi/pe tip, măsurat vs estimat; circuitul plăților; Costs/Usage oficial; becuri credit și linkuri de facturare. **Pune pe 0** cere confirmare. | GET `/api/admin/finance`, `/money-circuit`, `/credit-ai`; refresh finance 15 s. POST `/reset-counters` trebuie să confirme `ok:true` și numărul real. Resetul șterge numai jurnalul intern de cost, NU soldul furnizorului, wallet-ul sau plățile. Linkurile de facturare nu reîncarcă automat. | R,B; reset D; link E |
| **Utilizatori** | Activitate, sesiuni, ultima prezență, durată, număr mesaje, sold/scutire/consum, blocare; **Reîncearcă** dacă citirea eșuează. Rândul sau **Vezi chat** deschid istoric; **Închide**/fundal îl închid. **Tradu în română / Arată originalul**, **Blochează/Deblochează**, **Credit** cu sumă cerută. Nu există buton de ștergere utilizator. Include Registru audit. | GET `/api/admin/activity`, `/history?email=…`, `/registru-audit`, `/api/balance`. POST `/api/admin/translate` și `/user` (`block`, `unblock`, `credit`). Ultimele mesaje și paginarea trebuie verificabile; traduceri aliniate; blocarea confirmată la recitire; credit exact în unități minore și o singură înregistrare la retry. Adminul nu se poate bloca; `delete` este refuzat. ERR-01/02/05/06. | R,P; traducere B,E; cont W; credit B,W |
| **Distribuție** | Linkul aplicației; textarea cu mesaj salvat local; **Copiază text + link**; **Distribuie…** dacă există Web Share; **Revino la mesajul standard** dacă textul diferă. Linkuri X, Facebook, WhatsApp, Telegram, LinkedIn (doar link), Reddit; studiouri TikTok, Instagram, YouTube Studio, Facebook Reels. | Clipboard-ul trebuie să confirme copierea reală; anularea Web Share nu este publicare. Textul/URL-ul deschise extern trebuie să corespundă. Studiourile sunt numai linkuri, NU publicare video executată de Kelion. Nu publica în cadrul auditului. | L,E; eventual P |
| **Magazine** | Windows/Microsoft Store, Android/Google Play, iOS/App Store, Linux/Web app; etichetă listat/nelistat și link extern dacă listat; **Reîncearcă** la eșecul API. | GET `/api/admin/stores`; probe pagini publice, cache 5 min. Distinge pagină validă de 404 și de imposibilitatea verificării. Starea unei pagini nu dovedește instalarea/funcționarea aplicației. ERR-04. | R,E |
| **Inbox** | Ultimele 40 mesaje IMAP, citit/necitit; contactele din formular și emailurile procesate/răspunsurile secretarei. Checkbox per UID; **Selectează tot / Deselectează tot**; **Șterge selectate (n)** și **✕** per mesaj, cu confirmare. | GET `/api/admin/mailbox-live`, `/contact-messages`, `/inbound`; POST `/mailbox-delete` `{uids}`. Citirea eșuată ≠ inbox gol. Ștergerea trebuie reconciliată pe UID, inclusiv eșecuri parțiale; mutare în Trash dacă există, altfel ștergere definitivă. Nu șterge email real pentru probă. | R,P; selecție L; ștergere D,E |
| **Gesturi** | 39 intrări grupate; fiecare are checkbox de activare și **▶ Arată**. Preview redă local gestul o dată și expune avatarul aproximativ 3,5 s, inclusiv dacă gestul este dezactivat. Checkbox-ul salvează imediat, nu există buton Salvează. | GET public `/api/gestures/state`; POST `/api/admin/gestures` `{disabled}`. Proba vizuală verifică clipul efectiv, nu numai evenimentul. Politica persistată se recitește și trebuie să se aplice fără fereastră de cache. Lista completă este mai jos. | preview L; checkbox W |
| **Tokenuri** | Nume de variabile, prezență/lungime, aliasuri și variabile orfane, pornirea procesului; probe OpenAI, Serper, SMTP, IMAP, DB, OAuth/configurație, secrete interne ca metadate, identități Constructor/GitHub. **Reîmprospătează** repetă citirile/probele. Nu permite editarea sau dezvăluirea cheilor. | GET `/api/admin/env-check`, `/token-checks`. OpenAI este un `brainChat('ping', maxTokens:64)` real, inclusiv la montarea tabului; NU este garantat gratuit. SMTP verify/IMAP login nu trimit email. „Cheie prezentă” nu certifică un flux OAuth complet. | R,B,E; metadate sensibile |
| **Constructor** | Motorul configurat/stare canonică; ordin, evaluare, trimitere; progres măsurat, PR, aprobare, ordine curente și arhivă; formular Agent specializat. Fiecare acțiune este detaliată în matricea următoare. | Coadă `build_jobs`, worker separat admin, publisher/release; succes final numai cu dovada exactă de deploy și verificare live. Nu folosește acest worker pentru utilizatori obișnuiți. | R,W,D,E |
| **Recuperare** | Lista punctelor, SHA/dată/notă; câmp notă; **Salvează versiunea curentă**; **Restaurează** per punct, două confirmări. | GET/POST `/api/admin/backups`; POST `/backups/restore` `{tag}`. Crearea este tag GitHub, NU dovadă că arhiva VPS a fost deja materializată. Restaurarea schimbă codul prin commit/push sau PR+merge; rezultatul trebuie separat de succesul deploy/live. Nu restaura în audit. Vezi riscul de release de mai jos. | R; salvare W,E; restore D,E |
| **Sistem** | RAM/load/nuclee VPS și praguri; **Verifică toate funcțiile**; rezultat pe funcție: merge/stricat/nu pot verifica, citire reală vs efect dry-run; Registru audit și cel mai recent fișier backup măsurabil. Nu are restart/deploy server. | POST `/api/admin/autoverificare`; GET `/api/admin/registru-audit`; resurse din snapshotul paginii. Raportul nu trebuie să prezinte dry-run, lipsa probei, camera/microfonul neconsimțite drept verificare E2E. Nu este Doctor 24/7. | R; probe clasificate individual |
| **Erori** | Probleme de sistem și grupuri browser: severitate, categorie, explicație, număr/data. Numai afișare, refresh 20 s; fără ștergere sau buton Repară în e65. | GET `/api/admin/erori`. Acceptă toate sursele canonice; necitibil ≠ zero. LIVE-02; remedierea este pilotul Constructor rezervat, nu parte din acest audit. | R,P |
| **Notificări** | Cereri scrise/voce/plăți neatribuite, titlu, mesaj, starea citit. **Marchează citit** numai pentru necitite; refresh 20 s. | GET `/api/admin/notificari`; POST `/notificari/:id/citit`. Numai `ok:true` confirmă scrierea; 404/503 trebuie vizibile, fără succes fals sau cereri duplicate. Remediere deja pregătită în train separat. | R,P; citit W |
| **Creier OpenAI** | Provider și trepte configurate/validare catalog; worker Constructor distinct, executor, coadă, heartbeat; debitul Kelion admin separat de furnizori. **Niciun selector sau buton de schimbare model** în e65. | GET `/api/admin/creier`, `/constructor/worker` (15 s), `/api/balance`. Model din catalog ≠ inferență probată; debit admin scutit ≠ cost API zero; heartbeat ≠ job finalizat. | R |

### Constructor: fiecare acțiune și limita ei

Sursă: `frontend/src/components/admin/AdminProductie.tsx:45`; contracte în `backend/src/routes/constructor.ts` și serviciile canonice Constructor. GET-urile de tab sunt `/api/admin/constructor`, `/diagnostic`, `/release`, `/model` (sub aceeași bază Constructor).

| Control | Efect / contract | Criteriu de acceptare |
| --- | --- | --- |
| Câmp ordin | Evaluare debounced prin POST `/evalueaza` `{order}`; nu construiește. | Evaluarea nu devine dovadă că workerul a executat. |
| Trimite ordinul | POST baza Constructor `{order}`; busy împiedică trimiterea concurentă din formular. | ID canonic, stare acceptat/coadă distinctă de execuție; progres și rezultat pentru același ID. |
| PR / PR ↗ / Dovadă ↗ | Deschid linkurile rezultatului/fișei. | PR, SHA și probe aparțin ordinului; nu inventa un link când lipsește. |
| Aprobă în Kelion | Numai PR deschis către master, checks passed, approval required; POST `/release/action` `{jobId,action:'approve',prNumber,headSha}`. | SHA exact aprobat, respingere dacă s-a schimbat; apoi urmărire merge/deploy separat. Aprobarea poate duce la producție. |
| ↻ reia | POST `/:id/reia` cu `expectedStatus`, `expectedUpdatedAt`; numai dacă serverul declară retryable. | Retry explicit, stare veche → conflict, fără succes anticipat. Nu este continuare garantată de la ultimul token. |
| ⏹ oprește | Confirmare; POST `/:id/anuleaza` cu versiunea stării; numai etape anulabile. | Efectul workerului/lease reconciliat, nu doar etichetă locală. |
| ✕ șterge ordin | Confirmare; DELETE `/:id?expectedStatus=…&expectedUpdatedAt=…`, numai deletable. | Ștergere definitivă a țintei confirmate, starea concurentă respinsă. Nu este arhivare. |
| Curăță rândurile vizibile | Confirmare; POST `/curata` cu snapshotul exact al ordinelor terminale vizibile. | Arhivare recuperabilă, număr real; nu afectează ordine nevăzute/active. |
| Arhivă / Închide arhiva | GET `/arhiva`, numai citire. | Erori distincte de gol; ID-uri deduplicate. |
| Mai vechi | GET `/arhiva?cursorUpdatedAt=…&cursorId=…`. | Paginare fără pierdere/duplicare; paginile existente păstrate la eșec. |
| Restaurează (în arhivă) | POST `/:id/restaureaza` cu versiunea stării. | Revine în istoricul vizibil; NU repornește jobul și NU restaurează codul aplicației. |
| Fișa canonică (details) | Deschide progres/continuitate/contextul și legăturile existente. | Nu reetichetează eșecuri istorice 35B cu modelul nou; 100% doar cu dovadă deploy. |
| Agent: nume, rol, Raționament aprofundat, Numai admin | Câmpuri locale; nume 3–80, rol 10–500; checkbox-urile influențează cererea. | Rolul este instrucțiune, NU serviciu 24/7 sau heartbeat. Numele rezervate sunt refuzate de server. |
| Creează agentul | POST `/api/enterprise/agent-nou` `{nume,rol,efort?,doarAdmin?}`; busy guard. | ACK real, persistență și listare după reload; rolurile private rămân private. e65 nu are listă integrată/custom în acest card; este pregătită pentru trainul următor. Nu crea agentul BIBI din draft fără comanda explicită. |

### Catalogul complet Gesturi

Sursa unică a listei UI e65: `frontend/src/lib/gestures.ts:14`. Fiecare dintre aceste 39 de intrări are **checkbox persistent + ▶ Arată local**:

- Expresii (14): Salut/rămas-bun; Arată înainte; Uimire; Dezamăgire ușoară; Nedumerire; Victorie; Mulțumire; Surpriză; Stai puțin; Gânditor; Aprobare; Entuziasm; Acord discret; Plecăciune teatrală.
- Repaus (6): Înclină capul; Privire în jos; Privește în jur; Se uită la mâini; Se uită ca la ceas; Mută greutatea.
- Conversație (9): calm; o mână; ambele mâini; animat; palme deschise; privirea sus; foarte reținut; relaxat; deschis calm.
- Dansuri (10): energic; hip-hop; disco; brațele sus; cu picioare; ritmat; atletic; pași laterali; ridicări de picior; stilat.

## Defecte statice rămase, în afara remediilor deja pregătite

Acestea sunt trasee demonstrabile în e65, NU experimente pe datele producției. Reproducerile cer date sintetice/depedențe controlate și nu sunt rezultate de teste executate în această sesiune.

| ID / prioritate | Dovadă și rezultat | Regresie necesară |
| --- | --- | --- |
| **ERR-01 / P1: istoricul recent dispare din Admin la volum** | `backend/src/db.ts:4450` selectează `ORDER BY created_at ASC,id ASC LIMIT 1000`; `routes/admin.ts:201` nu expune cursor. `AdminUtilizatori.tsx:66` afișează acea listă fără paginare. Cu 1.001 mesaje, cel mai recent nu poate fi văzut deloc. LIVE-05 este observație compatibilă, nu măsurare a volumului DB. | 1.001+ mesaje sintetice; pagina inițială conține ultimul, paginarea recuperează toate exact o dată, ordonare stabilă la timestamp egal. Testul existent `offlineHistoryOrder.test.ts:70` are 101 rânduri și nu atinge această limită. |
| **ERR-02 / P1: creditarea nu păstrează idempotency la retry HTTP** | `routes/admin.ts:686` generează un `admin-grant:${randomUUID()}` nou la fiecare cerere, deși `db.ts:1513` suportă idempotency prin referință. După commit, ruta mai citește activitatea (`:708`); răspuns pierdut/citire eșuată poate afișa eșec, iar repetarea adaugă credit încă o dată. Este risc pe creditul produsului, nu dovadă că s-a produs dublare live. | Un identificator pentru operația logică, repetat după răspuns pierdut și eșec post-commit; un singur eveniment/sold incrementat o dată. Nu testa pe soldul unui client real. |
| **ERR-03 / P2: Push spune inactiv chiar dacă retragerea a eșuat** | `frontend/src/lib/pushTelefon.ts:60–73` ignoră `unsubscribe() === false`/excepția și statusul POST `/dezaboneaza`; returnează mereu `inactiv`. Backendul poate răspunde 503 `unsubscribe_unavailable` (`routes/push.ts:82`), ignorat de client. | Browser unsubscribe fals + HTTP 503/rețea: nu afișa inactiv, recitește ambele stări; separat succes real și lipsă abonare. Nu modifica permisiuni live în auditul read-only. |
| **ERR-04 / P2: Magazine confundă indisponibilitatea probei cu nelistarea** | `routes/admin.ts:69–88` inițializează `listed=false`, setează numai `res.ok`, iar timeout/rețea/5xx rămân false, apoi se cachează 5 min. Contractul `StoreRow.listed:boolean` nu poate reprezenta necunoscut. | 200 valid, 404, 403 anti-bot, 500 și timeout distincte; cele din urmă trebuie necunoscute cu motiv, nu „nelistat”. Nu este necesar contact extern plătit. |
| **ERR-05 / P2: traducerea istoricului >300 texte este respinsă după lucru efectuat** | `AdminUtilizatori.tsx:52` trimite toate textele distincte lipsă; `routes/admin.ts:222` taie la 300; `frontend/src/lib/admin.ts` (`translateToRo`) respinge răspunsul dacă lungimea nu corespunde cererii. Pentru 301 texte rezultatul celor 300 poate fi aruncat, iar toate sunt declarate netraduse. | 301 texte sintetice, batch explicit/aliniere pe index, progres și retry fără retraducerea celor confirmate; verificare fără apel plătit. |
| **ERR-06 / P2: răspuns întârziat redeschide istoricul închis** | `AdminUtilizatori.tsx:66–75` aplică rezultatul fetch fără generație/anulare; Închide pune null, dar vechea promisiune pune din nou conversația. Deschiderea rapidă A/B poate reveni la A. Nu demonstrează trecere între roluri, doar afișare stale în sesiunea admin. | Promisiuni controlate A lent/B rapid și închidere înainte de răspuns; nu reapare panoul sau conversația veche. |

Alte limite de acceptare care nu trebuie ascunse:

- **Recuperare / cale veche de release:** `backend/src/services/recovery.ts:131` încearcă PATCH direct master, apoi PR + merge imediat (`:208`, `merge_method:'merge'`), fără a aștepta aici porțile canonice Constructor/release. Protecțiile GitHub pot bloca, dar eșecul efectiv nu a fost reprodus. Butonul nu trebuie folosit pentru „test” pe live; trebuie aliniat cu release-ul aprobat înainte de a-l certifica funcțional.
- **Inbox / eșec parțial:** `/mailbox-delete` răspunde 200 chiar cu `ok:false`, iar clientul afișează `Șterse: n — detaliu` și recitește fără să valideze acel flag. Detaliul poate raporta cinstit eșecul, deci nu este automat succes fals; acceptarea cere reconciliere reală pe UID și păstrarea selecției nereușite.
- **Tokenuri / cost:** `services/tokenChecks.ts:25` → `brain.ts:230–246` efectuează inferență, nu numai GET de catalog. Efectul este prezent și la deschiderea tabului, nu doar la butonul de refresh. Nu prezenta întregul inventar ca audit fără consum AI.

## Separat: remedii în lucru, încă necertificate live de acest raport

Textul de autonomie permanentă din Bani, ACK/erori Notificări, propagarea imediată a politicii Gesturi, clasificarea probelor lipsă la autoverificare, panoul Doctor, lista agenților și badge-ul cu SHA/oră London sunt în trainul separat. Prezența fișierelor sau testele locale nu sunt dovadă de deploy. Erori rămâne pilotul Constructor coordonat separat. Acest document nu modifică aceste implementări și nu declară rezolvate LIVE-01…05.

## Protocol scurt pentru verificarea vizibilă

1. Notează SHA runtime, ora măsurării și sesiunea admin fără PII. Deschide fiecare din cele 13 taburi și consemnează starea concretă, inclusiv încărcare/eșec/gol.
2. Citește Bani, Magazine, Inbox, Recuperare, Sistem, Erori, Notificări și Creier; nu confunda zero cu imposibilitatea citirii. Tokenuri necesită acceptarea probei de inferență sau o singură observație deja efectuată.
3. Utilizatori: deschide/închide istoric și verifică accesul la ultimele mesaje; nu publica textul/emailurile. Constructor: Arhivă/Mai vechi, fișa și PR sunt citiri; verifică dacă dovezile aparțin aceluiași ordin/SHA.
4. Gesturi: probe vizuale locale individuale, fără schimbarea checkbox-urilor; consemnează exact care clip s-a redat. Distribuție: inspectează destinațiile; nu publica și nu trimite mesaje către terți.
5. Mutațiile financiare, ștergerile, restore, granturile, push, crearea agenților și ciclul Constructor complet se probează separat, pe ținte aprobate, cu înainte/după, ACK canonic și dovadă finală. Un buton existent, un dry-run sau o bară încheiată nu închid cerința.
