# Completare aprobată — activitate reală și supravegherea ordinului 666

**Stare:** APROBAT pentru implementare, 5 septembrie 2026.  
**Confirmare:** administratorul a aprobat propunerea de funcționare cu starea verificată pe server, clepsidră pe activitate reală, monitor pe VPS și escaladarea blocajelor: „Dă-i drumul, aprobat.”

Această completare precizează cerințele C07 și C14 și mecanismul de recuperare. Documentul de bază Kelion Admin–Codex v1.1 rămâne nemodificat. Prioritatea imediată rămâne repararea și finalizarea aceluiași ordin 666. Funcțiile noii arhitecturi nu înlocuiesc și nu maschează această lucrare.

## 1. O singură stare verificabilă

Serverul păstrează starea canonică a ordinului și a lucrărilor asociate: identitate, responsabil, etapă, stare, ultima activitate efectivă, ultima verificare, dovezi și următorul pas. Interfața afișează această stare. Starea de remediere externă și starea pipelineului sunt distincte, dar ambele sunt asociate aceleiași cerințe.

Deschiderea unui ordin, pornirea unei animații, existența unui proces sau menținerea unei conexiuni nu reprezintă singure activitate utilă. Procentul crește numai prin etape confirmate.

## 2. Clepsidra la cerință

Clepsidra este mică și apare la cerință dacă există activitate efectivă, demonstrată și recentă, pentru acea cerință: diagnostic, editare, remediere, execuția modelului, teste, build sau publicare. Pentru ordinul 666 poate apărea la 37% când se lucrează efectiv la deblocarea lui; procentul rămâne separat.

Clepsidra dispare când nu există activitate efectivă confirmată: așteptare, pauză, blocaj, finalizare, eroare sau dovadă învechită. Traficul fără legătură, actualizările propriei monitorizări și mesajele repetitive nu sunt dovezi de lucru. Un proces blocat nu ține indicatorul activ la infinit.

Semnalele sunt legate de execuții concrete, au timp de verificare și expiră după praguri documentate pe etape. Lipsa sau pierderea dovezii se tratează ca activitate neconfirmată, fără animație optimistă. Interfața poate explica ce se execută și când s-a verificat. Nu se pretinde certitudine instantanee absolută peste o conexiune de rețea.

## 3. Monitor independent pe VPS

Monitorul rulează independent de workerul urmărit și verifică la un minut. El verifică separat activitatea și avansarea reală, procesele dispărute, ordinele queued fără executor disponibil, erorile terminale și depășirea pragurilor pe etapă.

Pauza intenționată este recunoscută, afișată și păstrată inclusiv la actualizare sau reboot. Monitorul publică propria ultimă verificare reușită; dacă supravegherea nu funcționează, starea nu este prezentată ca sănătoasă. Execuția pe VPS continuă independent de laptop; notificările sunt păstrate pentru livrare când dispozitivul este conectat.

## 4. Decizie și acțiune în Kelion

Detectarea unui incident informează Kelion și administratorul în interfață. Evenimentul include cauza observată, ultima etapă, dovezile, responsabilul și următorul pas. Kelion clasifică problema și aplică recuperarea autorizată și validată sau atribuie remedierea unui executor, urmărind rezultatul.

Recuperările sunt limitate, verificabile și fără execuții duplicate. Nu se ignoră pauza intenționată și nu se repetă orbește operații cu efecte externe. O imposibilitate sau o decizie care depășește autorizarea se escaladează explicit. Notificările sunt emise la preluare, progres relevant, blocaj și rezolvare, cu deduplicare pe incident.

## 5. Probe obligatorii

| Scenariu | Rezultat cerut |
|---|---|
| Ordin 666 la 37%, remediere corelată efectivă și verificată | Clepsidră prezentă la cerință; detaliul descrie remedierea; procentul nu este modificat artificial. |
| Ordin 666 la 37%, nicio activitate efectivă | Clepsidră absentă. |
| Ordin queued, worker/timer inactive | Stare adevărată, motiv vizibil și incident/decizie; nu se afișează execuție fictivă. |
| Heartbeat sau loguri repetate fără lucru util | Nu se menține la infinit clepsidra; pragul de stagnare produce tratarea incidentului. |
| Dovadă expirată ori conexiune pierdută | Activitate neconfirmată, fără clepsidră optimistă; ultima verificare rămâne vizibilă. |
| Pauză intenționată și reboot în timpul actualizării | Pauza rămâne corectă; nu se reia automat workerul vechi. |
| Blocaj detectat | Mesaj în Kelion, responsabil și pas de recuperare sau escaladare; dovada este accesibilă. |
| Reconectare, reluare și recuperare | Fără ordine, efecte externe sau notificări duplicate; incidentul este închis numai pe dovadă. |

Implementarea, testele și confirmarea live se raportează separat. Aprobarea acestui document nu reprezintă dovadă de livrare.
