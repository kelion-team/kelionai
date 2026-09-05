# Trasabilitate — proiect aprobat Kelion Admin–Codex v1.1

Checkpoint: 2026-09-05T13:08:00Z. Coordonator: Codex / task 01a06da9-4019-79f3-ba25-72adf668ad79.
Aceasta este evidența de lucru, NU documentul aprobat și NU o acceptanță live.

## Surse fixe, copii byte-exact pe VPS

- [Baza v1.1](approved/2026-09-05/Proiect-Kelion-Admin-Codex-v1.1.md): SHA-256 a727cfb8de1ae58c65c0954b470fb81cb8af18c073999d088c455428f05a4ab4, 23391 bytes.
- [Supraveghere #666](approved/2026-09-05/Completare-aprobata-supraveghere-ordin-666.md): SHA-256 7c12fbacfbcb937f4656ac5901b7ce9380bd9c0e73ce716cd256c5f2e61ddaf7, 4879 bytes.
- [Responsabilitate și validare](approved/2026-09-05/Completare-aprobata-responsabilitate-si-validare.md): SHA-256 e981c6ee4db52ec9f9b3ac2b3c3123dbdba614c0ea3183ffbcb269410e330e87, 4169 bytes.
- Sursa autorizată este documentul predat de administrator în taskul 01a07169-6b1c-70e3-9dc8-b88b092ed134. Transferul de documente este singura citire de fișiere Windows pentru acest checkpoint; aplicația, execuția și testele sunt pe VPS.
- Nu se editează copiile aprobate pentru a schimba retroactiv cerințele; progresul se actualizează aici și în ../operations/CURRENT.md.

## Ordine de lucru și stare de acceptare

Același ordin #666 trebuie finalizat prin Constructor, publicare și dovadă live înaintea noii arhitecturi. Suplimentele necesare pentru observabilitate și recuperare sigură se aplică acum. Restul cerințelor rămân obligatorii în etapele aprobate, fără a întârzia acest ordin.

| ID | Stare reală | Implementare / verificare necesară |
|---|---|---|
| C01 | Neimplementat în noua arhitectură | E0/E1: platforme, instalare și pornire cu rețeaua oprită. |
| C02 | Neacceptat pentru noua arhitectură | E1: Google admin, respingere user și anonim pe server; testele rutei monitor nu acceptă întreaga cerință. |
| C03 | Neimplementat | E0/E1: cont propriu și autorizare oficială; GitHub auth nu este Codex auth. |
| C04 | Neimplementat | E1: persistență, rutare, revocare/reconectare. |
| C05 | Neimplementat | E2: conversație unică și continuitate voce/text/restart. |
| C06 | Neimplementat pentru Codex | Mai întâi #666 pe motorul existent autorizat; E3 va demonstra Codex. |
| C07 | În lucru pentru #666, nelivrat | Bare de etape, monitor durabil și remediere externă distinctă; dovezi expirabile și clepsidră la ordin. Necesită probe UI/live. |
| C08 | Testat parțial pe candidat, nelivrat | No-auto-retry, ciclu și lease, marker de pauză; 250/250 probe publication/recovery. Mai trebuie instalare și reluarea #666. |
| C09 | Neacceptat | E2: voce română și transcriere corectabilă pe dispozitiv, latență măsurată. |
| C10 | Neimplementat în noua arhitectură | E4: model/STT/TTS local cu rețeaua oprită. |
| C11 | Neimplementat | E4: reconciliere, conflicte și lipsa dublurilor. |
| C12 | Neprobat | E0: abonament și traseul real al consumului inclusiv voce, fără API plătit introdus implicit. |
| C13 | Testat parțial pe candidat, nelivrat | Gate/PR/merge/deploy/rollback corelat; nu există PR sau deploy pentru #666. |
| C14 | În lucru, nelivrat | Backend VPS separat de worker, interval 60s, lease, lastSuccessfulCheck, incidente și atribuire. Nu este echivalent cu automatizarea desktop. |
| C15 | Registru creat; neacceptat | Copii aprobate hash-exact și această matrice. Acceptare numai cu probe pentru fiecare criteriu. |
| C16 | Păstrat până acum; migrare neexecutată live | #666 rămâne cycle0/attempts2/144 evenimente. Migrare terminală și Reia explicit același ID după instalare. |
| C17 | Neînceput | E0 inventar autorizat complet; E2 import cu proveniență, număr și hash; niciun import complet pretins. |
| C18 | Neînceput | E2 arhivă fidelă, registru și retrieval cu citări/corecții; nu doar un rezumat. |

## Suplimente: stări separate de livrare

- Responsabil unic: candidat cu owner (jobId, cycle), UUID de execuție, CAS explicit de takeover, evenimente append-only și dedup. Nelivrat.
- Activitate externă: candidat cu baseline fără activitate, dovadă nouă și proaspătă, expirare în maximum 60s, stări blocked/completed inactive. Citirea nu refresh-uiește dovada. Nelivrat.
- Monitor: candidat cu clasificare, responsabil, nextAction și notificări durabile. Pauza nu este remediere; eroarea citirii nu este sănătate. Nu se pornește AI/retry doar din alertă. Nelivrat.
- Decizii vizibile: notificările Admin646 (12:30:17.408Z) și647 (13:01:45.972Z) au fost verificate în browser; sunt istorice și fără avansarea jobului.
- Publicare/boot: candidat verificat în fixture-uri Linux cu operații reale și SIGKILL; nu pretindem un reboot fizic al VPS-ului. Nelivrat.
- Transcriere corectabilă, demonstrația instalării/dispozitivului și recuperarea Codex OAuth: rămân în E1–E5, neimplementate; nu sunt abandonate.
- Finalizarea suplimentului și a ordinului se declară numai după reproducerea scenariului în versiunea efectiv livrată. Testele de candidat și apariția unei clepsidre nu sunt dovadă de finalizare.

## Dovada necesară în continuare pentru #666

1. Porți complete pe sursele finale, incluzând UI de expirare, backend monitor, pause/recovery și izolarea reală a workerului.
2. PR protejat fără ocolirea verificărilor, imagine semnată, deploy și upgrade atomic păstrând pauza.
3. Tuple master/producție/live/gates/runtime exactă și migrarea verificată, cu cele 144 evenimente preexistente intacte.
4. Reia explicit pe același #666 și ciclul nou; verificarea ordinii reale a cozii înainte de ștergerea markerului global de pauză.
5. Același ordin parcurge build, porți, handoff, PR, merge, deploy; scenariul original Admin Erori este repetat în browserul live.

## Completare de eficiență, aprobată ulterior

[Document fix](approved/2026-09-05/Completare-aprobata-eficienta-executiei.md): SHA-256 3673d265ed95cb07d45eb07d958250b9db9e697e37c5663b0582243e6b8677cb, 3445 bytes, copie exactă. Citit integral și aplicat organizatoric, fără funcții noi: un coordonator pentru integrare/deploy/#666; Darwin backend, Dalton gate și pregătire publicare, Lovelace UI și review; teste rapide apoi porți complete pe sursa finală. Imaginea de test compatibilă este reutilizată numai după compararea tuturor intrărilor; imaginea de release semnată pentru SHA final rămâne obligatorie. Repetările cauzate de medii diferite sunt înregistrate în checkpointul operațional, nu ascunse.
