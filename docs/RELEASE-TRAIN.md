# Release train: o singură verificare completă

Schimbările dependente se publică într-un singur release train. Scopul este să
evităm ciclurile repetate de rebase, CI și deploy, fără a reduce niciuna dintre
porțile de siguranță.

1. Creează o ramură nouă din `origin/master` curent.
2. Pune în aceeași ramură toate corecțiile care trebuie să ajungă împreună.
3. Rulează `node scripts/release-train-preflight.mjs`, apoi porțile locale din
   `AGENTS.md`.
4. Deschide un singur PR. `pr-verify` blochează CI-ul complet dacă ramura nu
   conține masterul curent sau worktree-ul nu este curat.
5. După verde, publisherul face automat rebase merge; deploy-ul acceptă numai
   commitul din `master` cu dovada CI și imaginile semnate. Nu există un pas de
   aprobare manuală în Kelion pentru fiecare PR, conform cerinței ownerului
   din 5 septembrie 2026.

O schimbare independentă poate avea propriul train. O schimbare care depinde de
un PR deschis nu pornește încă un PR: se adaugă aceluiași train înainte de
preflight. Dacă `master` avansează între preflight și merge, trainul se
actualizează o singură dată, apoi rulează din nou poarta completă.

## Branch, conversații de review și alte blocaje

Obligație explicită a ownerului, 5 septembrie 2026: agenții urmăresc și
reconciliază continuu branch-ul de lucru, `master`, release-ul de producție și
aplicația live. O diferență în timpul lucrului este o stare în curs sau un
incident măsurat, niciodată o livrare finalizată. Se păstrează o singură
identitate de ordin, PR, head, handoff și release; nu se creează execuții
duplicate pentru a ascunde un blocaj.

Înaintea fiecărei acțiuni se citesc stările actuale din GitHub și de pe live,
nu din capturi vechi. Se înregistrează cauza exactă, SHA-ul, runul sau
conversația afectată și următoarea acțiune permisă.

| Situație măsurată | Acțiune obligatorie | Condiție de închidere |
| --- | --- | --- |
| Branch rămas în urmă | Fetch, compară baza cu `origin/master`, păstrează toate modificările și actualizează trainul prin strategia Git permisă. Dacă este necesară o ramură înlocuitoare pentru a evita rescrierea istoricului publicat, leagă explicit PR-urile și retrage candidatul vechi. | Verificări noi pe head-ul actual; verdele vechi nu este transferat. |
| Conflict de merge | Citește ambele modificări, rezolvă sensul funcțional și testează integrarea. Nu folosi automat `ours`, `theirs`, reset distructiv sau force-push. | Fără conflicte și toate verificările obligatorii verzi pe rezultatul integrat. |
| Conversație de review nerezolvată | Citește observația și codul curent. Aplică remedierea și proba, sau răspunde justificat prin dovezi dacă observația nu se aplică. Numai după aceea marchează conversația rezolvată. | Răspuns/probă atașate conversației și recitirea stării rezolvate din GitHub. |
| `merge-policy` roșu din cauza conversațiilor | Rezolvă cauza de mai sus, apoi repetă verificarea politicii. Nu modifica politica pentru a face roșul să dispară. | Rezultat canonic verde; dacă sursa s-a schimbat, și restul verificărilor se repetă pentru noul head. |
| CI eșuat, lipsă, anulat sau pe alt SHA | Citește pasul și eroarea reală. Repară sursa pentru un defect de cod; pentru un eșec tranzitoriu demonstrat reia verificarea aceleiași surse, fără a modifica dovezile. | Toate checkurile cerute de politica efectivă, de la aplicațiile GitHub așteptate, pe exact head-ul candidat. |
| Workflow încă în execuție | Urmărește statusul; indisponibilitatea temporară a logurilor CLI nu este dovadă de eșec al aplicației. | Concluzie finală citită din workflow. |
| Deploy, journal sau recovery blocat | Citește etapa și precondiția eșuată. Repară cauza măsurată și continuă procedura canonică. Nu șterge jurnale, sentinele sau dovezi și nu fabrica ready. | Procedură încheiată și release exact verificat independent. |
| Auth, cote, facturare sau permisiuni externe | Raportează separat lipsa autorității sau resursei. Nu schimba modelul, credențialele, costurile ori protecțiile pentru a ascunde eroarea. | Dovadă reală că prerequisite-ul a fost restabilit, apoi reluarea checkpointului permis. |

Un handoff Constructor deja sigilat este imuabil. O bază devenită stale nu
autorizează rescrierea patchului, schimbarea head-ului sau o nouă execuție AI
sub aceeași dovadă. Se aplică regula ciclului terminal și a retenției din
`docs/operations/DELIVERY-RULES-AND-ROADMAP.md`; actualizarea unui train de
lucru nu trebuie confundată cu mutarea identității unei execuții sigilate.

## Compararea obligatorie master, producție, live și browser

Se compară separat:

1. head-ul PR-ului cu baza actuală `master` și verificările lui;
2. commitul rezultat după rebase merge cu ținta release-ului de producție;
3. SHA-ul din manifestul imaginilor semnate și receiptul release-ului cu
   `activeCommit` din `/api/release-proof`, care trebuie să fie ready, activ,
   non-candidat și cu side-effects activate pentru aceeași generație;
4. `/api/version` cu același release și identificatorul buildului frontend
   încărcat efectiv în browserul live, după aplicarea actualizării;
5. funcția cerută, executată real în acea versiune, cu rezultat observabil.

Head-ul PR-ului se poate schimba legitim prin rebase merge: comparația
post-merge folosește commitul rezultat și dovada conținutului integrat, nu
pretinde identitate între două SHA-uri diferite. Eticheta semantică singură,
ora buildului sau pornirii, HTTP 200, un merge ori un heartbeat nu sunt dovadă
de deploy complet. Orele afișate ownerului sunt Europe/London, cu GMT/BST;
ora buildului, pornirii și verificării rămân etichetate distinct.

Monitorul trebuie să detecteze și să raporteze diferențele, să continue
checkpointurile idempotente permise și să păstreze incidentul deschis până
la reconciliere. Nu pornește un deploy concurent peste un recovery armat și
nu consideră o pagină veche din cache drept actualizare finalizată.

## Setări GitHub necesare ownerului

Repository settings → Branches → `master` trebuie să impună:

- branch up to date înainte de merge;
- check obligatoriu `pr-verify / container-isolation`;
- pragul de review configurat efectiv în GitHub (zero este permis pentru
  publicarea automată autorizată; nu inventăm un review și nu reducem un prag
  mai strict configurat ulterior);
- doar **Rebase and merge** pentru release train;
- merge queue pentru trenuri concurente, cu `pr-verify` rulat pe merge group.

Aceste setări nu pot fi schimbate din codul unui PR și nu trebuie ocolite.
