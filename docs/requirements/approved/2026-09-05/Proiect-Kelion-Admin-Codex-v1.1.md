# Kelion Admin — aplicație instalată, conversație unică și Constructor cu Codex

**Versiune:** 1.1, aprobată la 5 septembrie 2026.  
**Stare:** APROBAT pentru implementare. Administratorul a confirmat după prezentarea documentului: „Este în regulă, l-am verificat.”  
**Beneficiar:** administratorul KelionAI.  
**Decizie înregistrată:** scopul, etapele și criteriile de acceptanță de mai jos sunt aprobate. Necunoscutele tehnice se rezolvă prin probe înainte de alegerea soluțiilor dependente de ele. Nicio cerință nu este eliminată prin această validare tehnică.

## 1. Rezultatul urmărit

Administratorul deschide aplicația Kelion instalată pe dispozitivul său și poartă o singură conversație, prin voce în română sau text. Din aceeași conversație discută proiectul, autorizează lucrări și vede progresul, rezultatele și blocajele. Contextul util ajunge direct la Codex, fără repetarea cererii în alte conversații.

Online, Codex este motorul principal care analizează, scrie cod și execută verificări. Constructorul gestionează ordinele, execuția, dovezile, publicarea și recuperarea. Offline, aplicația folosește un model și componente de voce instalate pe dispozitiv. Istoricul rămâne disponibil și se sincronizează controlat după reconectare.

Accesul online Codex folosește contul ChatGPT al administratorului și drepturile abonamentului existent. Soluția nu introduce automat un al doilea abonament AI sau servicii API cu plată separată. Acoperirea funcțiilor de voce trebuie demonstrată, nu presupusă.

## 2. Limitele proiectului

- Integrarea este destinată exclusiv administratorului. Utilizatorii obișnuiți nu primesc acces la contul său Codex, la acreditări sau la execuția de comenzi administrative.
- Se livrează o aplicație instalabilă, cu pornire din sistemul de operare, stocare locală și componente offline. Un simplu link sau o fereastră către un serviciu remote nu îndeplinește cerința.
- Linux este o platformă cerută explicit. Calculatorul actual este Windows; compatibilitatea acestuia intră în evaluarea inițială și în demonstrația propusă. Lista exactă de dispozitive și versiuni suportate trebuie fixată înainte de construirea instalatoarelor.
- Aplicațiile mobile pentru Android și iOS nu sunt încă solicitate ca livrabile. Discuția le-a folosit ca exemplu de similitudine între platforme.
- Instalarea pe VPS deservește execuția online. Funcționarea în avion cere instalare și resurse pe dispozitivul care se află cu administratorul.
- Proiectul nu promite rularea offline a modelului OpenAI din abonament, capacități identice pentru modelul local, utilizare nelimitată sau autorizări imposibil de revocat.

## 3. Experiența administratorului

### Prima conectare

1. Administratorul instalează Kelion și intră prin Google.
2. Kelion verifică dreptul de administrator pe server.
3. Butonul **Conectează contul meu Codex** pornește autorizarea oficială OpenAI. Parola OpenAI nu este colectată de Kelion.
4. După succes, aplicația arată contul conectat și starea accesului. Asocierea contului Codex cu profilul administratorului se păstrează. Butonul devine **Deschide conversația** și rămâne util pentru navigare sau reconectare.
5. Se descarcă și se verifică pachetul offline ales pentru dispozitiv. Aplicația arată dacă modul offline este pregătit sau ce îi lipsește.

### Utilizare online

După intrarea prin Google și verificarea rolului de administrator, Kelion identifică asocierea cu contul Codex, verifică sau reînnoiește autorizarea existentă și deschide automat conversația sa. Dacă administratorul este deja autentificat, simpla deschidere a aplicației poate relua același flux. Nu se cer repetat parola OpenAI sau o nouă autorizare cât conexiunea poate fi reînnoită legitim. Dacă asocierea lipsește, a fost revocată ori nu mai poate fi reînnoită, este afișat pasul oficial de conectare.

Administratorul poate vorbi, scrie sau inspecta rezultate în conversația existentă. O explicație, o glumă sau o propunere nu devine automat comandă de modificare. Cererile clare de execuție și aprobările sunt păstrate cu lucrarea la care se referă.

În aceeași fereastră se văd conversația, ordinul activ și progresul relevant. Detaliile tehnice se pot extinde. Nu este necesară trecerea într-un alt chat pentru a afla ce face executorul. Procese interne separate sunt acceptabile dacă păstrează continuitatea și raportează în acest unic spațiu.

### Utilizare offline

Aplicația deschide istoricul local autorizat și indică explicit **Offline — model local**. Administratorul poate conversa prin voce și text, lucra cu materialele disponibile local și pregăti cereri pentru server. Autentificarea Google și OpenAI inițială se fac cât există conexiune. Un profil local deja autorizat poate fi deblocat prin mecanismul sigur al dispozitivului, fără a pretinde că verifică online contul.

Operațiile care necesită VPS, GitHub sau OpenAI sunt afișate ca indisponibile ori în așteptarea conexiunii. O lucrare deja pornită pe VPS poate continua acolo; dispozitivul offline arată doar ultima stare primită și ora ei, nu o stare live inventată.

### Revenire online

Istoricul și mesajele se reconciliază fără pierderi și fără dubluri. Cererile pentru server sunt revalidate față de starea actuală și aprobările existente. Nu se repetă automat operații deja executate. O schimbare materială a contextului sau un conflict este prezentat administratorului înaintea acțiunii afectate.

## 4. Arhitectura propusă

| Componentă | Responsabilitate |
|---|---|
| Aplicația Kelion instalată | Interfață unică, voce/text, istoric local, mod online/offline, afișarea progresului și protecția profilului local. |
| Integrarea Admin pe VPS | Verificarea identității și rolului, conexiune sigură cu aplicația, sincronizarea conversației și asocierea ordinelor. |
| Codex App Server | Integrarea oficială cu Codex: autorizare, conversații persistente, comenzi și evenimente de execuție. |
| Constructor | Coada de ordine, stări și încercări, execuție izolată, teste, modificări revizuibile, publicare, dovezi și recuperare. |
| Pachetul offline | Model local, recunoașterea vorbirii și redarea vocală în română; toate necesare conversației fără rețea. |
| Monitor de conformitate | Compară implementarea și execuția cu proiectul aprobat; verifică progresul și semnalează abateri. |

Codex devine motorul online al Constructorului. Un model online suplimentar de generare a codului nu este o dependență obligatorie. Componenta existentă se înlocuiește gradual numai după demonstrarea echivalenței funcțiilor necesare și existența unei căi de revenire.

Documentația oficială descrie Codex App Server ca mecanism de integrare în produse proprii, inclusiv istoric, autorizare și evenimente. Aceasta susține alegerea de arhitectură; compatibilitatea exactă a versiunii instalate, a contului și a funcțiilor necesare se probează în etapa de fezabilitate. [Codex App Server](https://learn.chatgpt.com/docs/app-server)

## 5. Cerințe obligatorii și dovezi de acceptanță

| ID | Cerință | Dovada necesară pentru acceptare |
|---|---|---|
| C01 | Aplicație instalată | Instalare și pornire pe dispozitivele convenite; interfața și istoricul local se deschid cu rețeaua oprită. |
| C02 | Acces numai pentru administrator | Contul admin are acces; contul obișnuit și clientul neautentificat sunt respinse și la nivelul serverului. |
| C03 | Contul ChatGPT propriu | Autorizarea oficială identifică contul ales; identitatea și starea contului sunt afișate fără expunerea acreditărilor. |
| C04 | Autorizare persistentă și rutare automată | După autentificarea Google ca admin, se deschide automat conversația asociată contului Codex, fără reintroducerea acreditărilor OpenAI. Restartul păstrează accesul valid; revocarea ori imposibilitatea reală de reînnoire produce o cerere clară de reconectare. |
| C05 | O singură conversație | Vocea, textul, rezultatele execuției și deciziile apar în același istoric după reconectare și restart. O informație introdusă prin voce poate fi folosită ulterior prin text. |
| C06 | Codex execută lucrările online | O cerere reală produce modificări verificabile, teste și rezultat prin Codex, cu legătură demonstrată la ordinul inițial. |
| C07 | Progres bazat pe dovezi | Fiecare etapă declarată finalizată are dovadă; o încercare eșuată apare ca eșuată/blocată, fără a rămâne fals în lucru. |
| C08 | Reluare fără dubluri | Întreruperea și reconectarea nu creează ordine duplicate, publicări repetate ori pierderea aprobărilor relevante. |
| C09 | Voce română | Probe pe dispozitiv pentru recunoaștere, răspuns vocal, întreruperea vorbirii și trecerea între voce și text; rezultatele și întârzierile sunt măsurate și prezentate. |
| C10 | Offline real | După descărcarea componentelor, se pornește aplicația cu rețeaua oprită și se poartă o conversație nouă prin voce și text, pe model local. |
| C11 | Sincronizare corectă | Conversația offline reapare online în ordine, fără dubluri; conflictul dintre schimbări locale și remote este detectat. |
| C12 | Un singur abonament AI pentru fluxul propus | Traseul de consum al fiecărei funcții este documentat; demonstrația nu depinde de un al doilea abonament sau de API plătite separat, introduse implicit. |
| C13 | Publicare controlată | Modificarea, testele, versiunea publicată și verificarea aplicației live sunt asociate aceluiași ordin; revenirea la versiunea anterioară este verificată. |
| C14 | Monitorizare la un minut | Monitorul înregistrează verificările și ultima verificare reușită; o schimbare sau o abatere produce o notificare utilă, fără mesaje repetitive când nimic nu se schimbă. |
| C15 | Respectarea proiectului aprobat | Fiecare cerință are implementare și dovadă asociate. Nicio cerință obligatorie nu este declarată îndeplinită pe baza unui plan, a unui procent sau a unui simplu raport de intenție. |
| C16 | Păstrarea lucrărilor existente | Ordinul 666, istoricul, încercările și modificările existente sunt păstrate în migrare. Nu se creează un ordin înlocuitor pentru a masca blocajul. |
| C17 | Importul complet al istoricului disponibil | Inventar al tuturor conversațiilor și lucrărilor din această aplicație accesibile și autorizate de administrator; pentru fiecare sursă există un rezultat de import, număr de elemente și verificări de integritate. Golurile sunt enumerate explicit. |
| C18 | Memorie comună, trasabilă | Întrebări despre decizii și lucrări vechi primesc răspunsuri susținute de sursele importate; corecțiile și deciziile noi prevalează, iar informațiile vechi sau neverificate sunt identificate ca atare. |

Pragurile de latență vocală, consum de memorie, spațiu și autonomie se stabilesc după măsurarea dispozitivului, înainte de validarea alegerii modelului local. Nu sunt inventate rezultate sau performanțe în această propunere.

## 6. Autorizări și costuri

Google pentru Kelion și autorizarea contului OpenAI sunt legături distincte, reunite în experiența administratorului. Conectarea inițială OpenAI se face oficial, iar acreditările valide sunt păstrate sigur și reînnoite prin mecanismele furnizorului. Acestea nu ajung la utilizatorii obișnuiți și nu sunt incluse în loguri sau surse.

Codex autentificat prin ChatGPT poate folosi accesul abonamentului. Cheile API au facturare separată. Abonamentul și limitele lui nu sunt transformate în acces nelimitat prin integrare. [Autentificarea Codex](https://learn.chatgpt.com/docs/auth)

Etapa de fezabilitate trebuie să confirme și traseul vocii. Dacă funcțiile vocale cer un serviciu separat cu plată, varianta care păstrează cerința de cost folosește voce locală, dacă proba de calitate o susține. Dacă cerințele nu pot fi satisfăcute împreună, este prezentată incompatibilitatea și se cere o decizie asupra ei; nu se introduc în tăcere chei API sau abonamente noi.

Costul VPS și resursele dispozitivului rămân costuri de infrastructură. Alegerea concretă a modelului local, a componentelor vocale, a licențelor și a consumului de resurse se documentează înainte de livrare. Codex are suport documentat pentru furnizori de modele locale; acest lucru nu demonstrează singur calitatea sau compatibilitatea modului offline Kelion. [Modele locale](https://learn.chatgpt.com/docs/config-file/config-advanced#oss-mode-local-providers)

## 7. Ordine, execuție și recuperare

Fiecare ordin are o identitate stabilă, intenția administratorului, aprobările aplicabile, starea, încercările și dovezile etapelor. Stările trebuie să distingă cel puțin: în așteptare, în lucru, verificare, pregătit pentru publicare, publicare, finalizat, blocat și eșuat.

Un progres numeric reprezintă numai etape confirmate. Un număr mare de mesaje de activitate nu crește artificial procentul. Interfața arată etapa curentă, ultima activitate verificată și cauza unui blocaj.

Publicarea și actualizarea serviciilor păstrează pauza intenționată a workerului. Reluarea este explicită și sigură după verificarea mediului și a modificărilor. O oprire a aplicației utilizatorului nu trebuie să provoace o nouă execuție a aceleiași comenzi pe server.

Reparația ordinului 666 este deja autorizată separat și continuă în taskul existent. Această propunere nu îi retrage autorizarea și nu îl declară rezolvat. Noua arhitectură începe numai după aprobarea prezentului proiect și după stabilirea unei baze stabile pentru migrare.

## 8. Etape de implementare după aprobare

| Etapă | Livrabil | Condiție de trecere |
|---|---|---|
| E0 — Inventar și fezabilitate | Starea reală a Kelion, modul avion existent, versiunile Codex, contul/abonamentul, dispozitivele și resursele; inventarul istoricului accesibil; probe de autorizare, conversație și voce. | Demonstrație a traseului de cost și a integrării oficiale; sursele de istoric, limitele și alegerea platformelor sunt explicite. |
| E1 — Aplicația instalată și conectarea admin | Instalator, profil admin, Google, conectare Codex, stocare sigură, reconectare. | C01–C04 demonstrate în mediul convenit. |
| E2 — Conversația unică și memoria | Text și voce în română, importul istoricului, memoria comună, evenimente și rezultate în aceeași fereastră. | C05, C09, C17 și C18 demonstrate, inclusiv după restart și întreruperea conexiunii. |
| E3 — Constructor cu Codex | Integrarea ordinelor, execuția, verificările, publicarea și recuperarea. | C06–C08, C13 și C16 demonstrate pe o lucrare reprezentativă. |
| E4 — Offline și sincronizare | Model local, voce locală, istoric disponibil, cereri amânate și reconciliere. | C10–C11 demonstrate cu rețeaua realmente oprită. |
| E5 — Migrare și acceptanță | Migrare reversibilă, documentație de operare, demonstrație finală și matrice completă de dovezi. | Toate cerințele obligatorii au dovezi; limitele rămase sunt acceptate explicit. |

Monitorizarea și verificarea conformității funcționează pe tot parcursul etapelor. O probă tehnică poate identifica o incompatibilitate; aceasta este un rezultat de analiză și nu autorizează eliminarea cerinței afectate.

## 9. Monitorizarea la fiecare minut

Automatizarea existentă din această conversație a fost schimbată de la cinci minute la un minut. Ea urmărește taskul proiectului și schimbările relevante, fără modificări proprii ale codului sau serviciilor. Notificările comunică ce s-a actualizat, ce s-a rezolvat, la ce se lucrează, ce este live și orice abatere de la proiectul aprobat.

Programarea la un minut nu este o garanție de execuție exact la secundă: depinde de disponibilitatea aplicației, calculatorului și conexiunii. În arhitectura finală, monitorul operațional se rulează pe VPS pentru a putea verifica serviciile chiar dacă laptopul este închis. Notificările ajung la dispozitiv când acesta poate primi conexiunea. Lipsa monitorului sau a unei surse de date se afișează ca verificare indisponibilă, nu ca stare sănătoasă.

Se păstrează pentru fiecare verificare: momentul, sursele accesate, versiunea proiectului, lucrarea/etapa, schimbările observate, dovada, eventualele abateri și următoarea acțiune. Verificările se comasează când există deja o verificare în curs; nu se pornesc procese duplicate în fiecare minut.

După aprobarea proiectului, controlul de conformitate folosește matricea C01–C18 și versiunea aprobată. Un mesaj de progres nu înlocuiește o probă. O verificare CI reușită nu dovedește singură publicarea live. O interfață funcțională nu dovedește singură execuția corectă a ordinului.

## 10. Predarea către executor și disciplina modificărilor

După aprobarea administratorului, această versiune primește starea **aprobat** și este predată taskului de implementare cu contextul complet al discuției. Executorul trebuie să confirme primirea și să lege lucrările de cerințele documentului.

Fiecare cerință va avea starea propusă, în lucru, implementată, testată sau verificată în mediul final, cu dovezile aferente. Modificările de scop, identitate, cost, experiență sau criterii de acceptanță sunt prezentate înainte de aplicare. Problemele tehnice nu justifică schimbarea tacită a rezultatului cerut.

Respectarea integrală se controlează prin această trasabilitate și prin demonstrații. Nu se poate garanta infailibilitatea unui executor AI; se poate refuza declararea proiectului finalizat când o cerință obligatorie este neîndeplinită sau neverificată.

## 11. Demonstrația finală pentru administrator

1. Instalează și deschide Kelion pe dispozitivul convenit; verifică accesul admin și contul Codex propriu.
2. Vorbește în română și continuă aceeași conversație prin text; verifică păstrarea contextului.
3. Cere o modificare reprezentativă și urmărește ordinul, testele și rezultatul în aceeași fereastră.
4. Închide și redeschide aplicația; verifică istoricul și lipsa execuțiilor duplicate.
5. Oprește rețeaua și pornește o conversație nouă prin voce cu modelul local.
6. Pregătește o cerere pentru server offline; reconectează și verifică reconcilierea, autorizarea și lipsa dublurilor.
7. Simulează o eroare controlată de execuție; verifică blocajul explicit, notificarea și reluarea sigură.
8. Verifică dovada versiunii publicate, posibilitatea revenirii și monitorizarea la un minut.
9. Cere explicații despre decizii și lucrări anterioare importate; verifică sursele, corectarea unei amintiri și lipsa răspunsurilor inventate pentru surse absente.
10. Revizuiește matricea C01–C18 și costurile funcțiilor. Acceptă numai ceea ce a fost demonstrat.

## 12. Istoricul și memoria comună — cerință confirmată

Administratorul a cerut preluarea în Kelion a întregului istoric al conversațiilor și al lucrărilor realizate în această aplicație, pentru a exista un subiect comun și continuitate. Importul urmărește toate sursele accesibile și autorizate; nu doar un rezumat al conversației curente. Înainte de transfer, inventarul arată ce conversații, fișiere și lucrări pot fi citite sau exportate, ce este deja în Kelion și ce lipsește.

### Conținutul păstrat

- Mesajele utilizatorului și răspunsurile, inclusiv transcrierile vocale existente; înregistrările audio se includ numai dacă sunt disponibile și fac parte din sursele autorizate.
- Planuri, cerințe, decizii, aprobări, schimbări de direcție, ipoteze respinse și întrebări nerezolvate.
- Lucrări efectuate, fișiere și artefacte disponibile, modificări de cod, rezultate ale testelor, pull requesturi, versiuni publicate și dovezi relevante.
- Identitatea sursei, titlul conversației, momentul, legăturile dintre conversații și lucrări, precum și starea de verificare a informației.

Conținutul local nu apare automat pe alt dispozitiv doar prin autentificarea în același cont. Sursele inaccesibile, șterse, neexportabile sau din alte conturi sunt raportate în inventar. Nu se declară import complet până când inventarul și rezultatele sunt reconciliate. Informațiile care nu pot fi recuperate nu se reconstruiesc prin presupuneri.

### Trei niveluri de memorie

1. **Arhivă fidelă:** păstrează conversațiile și artefactele disponibile, cu proveniență și verificări de integritate. Se protejează acreditările și se elimină secretele din conținutul indexat, marcând redacțiile fără a păstra valoarea secretă.
2. **Registru de decizii și lucrări:** extrage fapte, preferințe explicite, decizii și stări cu trimitere la sursa originală. O decizie nouă poate înlocui una veche, fără a șterge istoria schimbării.
3. **Context recuperat pentru conversație:** aduce în discuție materialele relevante când sunt necesare. Nu promite că întregul istoric, indiferent de mărime, încape simultan în contextul modelului.

Textele importate sunt date și dovezi, nu instrucțiuni cu autoritate superioară. Aprobările vechi se păstrează cu scopul și lucrarea lor; nu devin o autorizare generală pentru acțiuni noi. Istoricul spune ce era adevărat la acel moment. Starea actuală a aplicației se verifică separat.

### Acces, sincronizare și acceptare

Memoria este accesibilă numai administratorului și proceselor sale autorizate. Administratorul poate consulta proveniența, corecta, exporta sau șterge datele; ștergerea trebuie propagată în indexuri și în copiile sincronizate conform politicii de retenție documentate. Copiile offline se protejează pe dispozitiv.

Importul se poate relua fără dubluri și înregistrează fiecare eroare. Se validează identitățile, numărul elementelor, ordinea și legăturile dintre surse, plus integritatea artefactelor copiate. Se face o demonstrație de recuperare a deciziilor și rezultatelor vechi, inclusiv a cazurilor în care sursele se contrazic sau nu sunt disponibile. Actualizările ulterioare completează aceeași memorie, online și offline.

Pentru istoricul complet offline, disponibilitatea fișierelor mari și capacitatea dispozitivului se stabilesc în inventar; nicio sursă nu este exclusă tacit. Dacă spațiul nu permite copia integrală, se prezintă alegerea necesară înainte de a reduce cerința.

## 13. Aprobarea înregistrată

Administratorul a aprobat această arhitectură, scopul exclusiv de administrator, rezultatul de produs, etapele și criteriile de acceptanță după verificarea documentului. Implementarea trebuie să le respecte integral. Alegerea componentelor încă neverificate se face în E0, pe baza dispozitivului și a probelor. Orice compromis material este adus înapoi pentru decizie.

Confirmarea finală după prezentarea documentului a fost: „Este în regulă, l-am verificat.” Documentul poate fi predat executorului. Reparația curentă a ordinului 666 și monitorizarea deja autorizată continuă.
