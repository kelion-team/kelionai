# Contract de livrare si roadmap operational

Versiune contract: `1.0`

Agreat de owner: `2026-08-25`

Acest document este inregistrarea versionata a regulilor de livrare si a
ordinii de produs agreate de owner. Orice schimbare a contractului trece prin
PR. El defineste criteriile de acceptare, nu confirma starea curenta a
produsului. Starea verificata si urmatorul pas sigur raman exclusiv in
[`CURRENT.md`](CURRENT.md).

## Limbaj factual si legaturi canonice

Orice stare afisata ownerului se bazeaza pe dovada sursei care o autorizeaza:

- `planificat`: exista numai ca intentie sau scope; nu este implementat;
- `in lucru`: exista executie observabila, dar nu toate portile au trecut;
- `blocat`: exista cauza si actiune de escaladare explicite;
- `verificat`: criteriul nominalizat are o dovada verde, dar nu implica
  automat productie;
- `live`: commitul exact este publicat si confirmat prin probele publice
  cerute.

Fiecare PR, check, deploy si incident vizibil ownerului trebuie sa includa o
legatura directa catre obiectul canonic si starea citita din acea sursa:

| Obiect | Legatura canonica si dovada minima |
| --- | --- |
| PR | URL-ul direct GitHub al PR-ului, head SHA, baza si starea de merge |
| Check | URL-ul direct al runului GitHub Actions, numele checkului, SHA-ul si concluzia |
| Deploy | URL-ul direct al runului/deploymentului, SHA-ul publicat si probele live pentru acel SHA |
| Incident | URL-ul direct al inregistrarii durabile de incident, cauza curenta, dovezile si actiunea urmatoare |

Un link catre o lista, un screenshot, un mesaj de chat sau un numar fara URL nu
inlocuieste legatura canonica. O concluzie planificata, un workflow aflat in
coada sau un PR verde nu se prezinta drept functionalitate live. Daca dovada nu
poate fi citita, starea este `necunoscuta` sau `blocata`, nu succes presupus.

## Legea unicitatii / single source of truth

Fiecare regula, configuratie, stare, inregistrare de job, runbook si legatura
canonica are exact un owner si un loc autoritativ. Orice UI, document, worker
sau workflow secundar citeste ori referentiaza acea autoritate; nu copiaza
campul pentru a crea o a doua sursa de adevar.

Identitatea canonica a obiectului ramane stabila de-a lungul proiectiilor sale.
O actualizare se face la autoritate si se propaga catre consumatori. Daca
autoritatea nu poate fi citita sau propagarea nu este confirmata, consumatorul
afiseaza starea necunoscuta/degradata si linkul canonic; nu pastreaza o valoare
copiata ca adevar curent. Orice exceptie de ownership trebuie eliminata sau
migrata explicit catre o singura autoritate, nu sincronizata permanent intre
surse concurente.

## Banda persistenta Admin -> Constructor -> productie

O cerere de produs foloseste o singura identitate durabila de la creare pana
la dovada live sau inchiderea prin rollback. Admin, monitorul Constructor si
chatul trebuie sa proiecteze aceleasi checkpointuri ordonate:

1. cererea validata este inregistrata in Admin;
2. workerul revendica aceeasi cerere si publica heartbeat/progres;
3. schimbarea este produsa intr-un worktree izolat;
4. portile locale/offline produc receiptul pentru commitul candidat;
5. publisherul deschide PR-ul si ataseaza legaturile canonice;
6. review-ul si toate checkurile obligatorii trec pe head-ul exact;
7. PR-ul intra in `master` protejat, fara push direct sau ocolirea politicii;
8. artefactul semnat este construit din SHA-ul exact din `master`;
9. release-ul publica acel SHA si inregistreaza probele publice;
10. cererea devine `done` numai dupa dovada live; la esec urmeaza rollbackul
    verificat sau un fix-forward explicit.

Fiecare checkpoint are timestamp, actor, stare, legatura canonica si ultima
dovada. Lease-ul si heartbeatul detecteaza stagnarea. Timeoutul nu marcheaza
succes: reia aceeasi cerere idempotent, pe un termen/backoff persistat. Numarul
de incercari este diagnostic si nu devine plafon terminal pentru o eroare
recuperabila. Numai o autoritate externa reala poate pune cererea in asteptare,
cu o singura actiune explicita; dupa restabilirea autoritatii, aceeasi cerere se
reia automat. Retry-ul nu creeaza o cerere duplicata si nu pierde dovezile
anterioare. Receiptul `local_gates` confirma numai portile locale/offline;
rezultatul GitHub `ci=green` este un checkpoint independent si ulterior.

Rollbackul este parte a traseului, nu o nota ulterioara. Pentru fiecare release
se pastreaza candidatul, point-of-no-return, artefactul anterior eligibil si
proba rezultatului rollback/fix-forward. Procedura tehnica ramane cea din
[`deploy/DEPLOY.md`](../../deploy/DEPLOY.md) si
[`deploy/RUNBOOKS.md`](../../deploy/RUNBOOKS.md).

## Fara configurare de rutina in traseul Constructor

Traseul normal Constructor nu prezinta ownerului sau utilizatorului butoane de
configurare pentru operatii pe care sistemul le poate executa in siguranta.
Sistemul trebuie sa:

1. detecteze automat prerechizitele si sa afiseze rezultatul verificarii;
2. aplice defaulturi sigure, versionate si fail-closed;
3. creeze si sa porneasca automat cererea/jobul validat;
4. avanseze automat tranzitiile eligibile si sa reia dupa un retry sau dupa
   disparitia unui blocaj;
5. afiseze starea, checkpointurile, dovezile si escaladarea, fara a transfera
   munca operationala evitabila catre owner.

Actiunea umana este permisa numai cand este ireversibila sau cere autoritate
externa pe care sistemul nu o poate delega, de exemplu consimtamant OAuth,
plata/acceptarea unui contract ori loginul interactiv al unei credentiale. In
acel caz, UI-ul descrie in limbaj simplu o singura actiune necesara, motivul si
efectul ei. Dupa confirmarea externa, aceeasi cerere se reia automat de la
checkpointul durabil; utilizatorul nu trebuie sa recreeze jobul sau sa apese
butoane de continuare evitabile. Un task de setup care poate fi automatizat nu
este prezentat ownerului.

## Regula release train

Schimbarile legate de acelasi rezultat folosesc un singur release-train branch,
un singur PR coerent si un singur run CI complet pe head-ul final. Reparatiile
descoperite inainte de merge se adauga aceluiasi branch, apoi se ruleaza o data
suita completa pe forma finala.

Nu se fragmenteaza acelasi rezultat in PR-uri succesive doar pentru a grabi o
stare aparenta si nu se repeta rebase-uri dupa fiecare observatie. O separare
este acceptata numai cand exista o limita independenta de risc, ownership sau
rollback; motivul si ordinea trenurilor se inregistreaza in cererea durabila.
Orice schimbare a head-ului invalideaza dovezile CI anterioare.

## Fundația din aceasta seara

„Fundatia din aceasta seara” este numele milestone-ului, nu o afirmatie ca
functiile sunt deja implementate sau live. Milestone-ul este complet numai cand
toate elementele urmatoare au dovezile din checklist:

1. chat natural, cu raspuns online real si erori factuale;
2. voce realtime in limba romana, bidirectionala si verificata in clientul
   real;
3. stare transparenta pentru cerere, Constructor, PR, CI, deploy si incident;
4. traseu protejat complet de la Admin la `master`, deploy, dovada si rollback.

Un element incomplet ramane `planificat`, `in lucru` sau `blocat` in
`CURRENT.md`. Nu se foloseste starea altui element pentru a declara intregul
milestone gata.

## Urmatorul scope de maine

„Scope-ul de maine” incepe numai dupa acceptarea fundatiei si ramane planificat
pana la PR-uri, checkuri si probe proprii:

1. functii de produs si actiuni controlate de utilizator;
2. vedere, cu permisiuni, minimizare si rezultat observabil;
3. memorie durabila, controlata, inspectabila si stergibila de utilizator;
4. agenti specializati, cu limite, instrumente si escaladari explicite.

Aceste puncte nu sunt dovezi de implementare si nu pot aparea ca `live` doar
pentru ca sunt descrise aici.

### Backlog amanat: Admin activity/audit history

Status: `planificat`, post-foundation / sesiunea urmatoare. Acest punct nu se
implementeaza in release train-ul curent. Poate incepe numai dupa ce traseul
complet Constructor -> `master` protejat -> deploy -> dovada/rollback si
fundatia voice/chat sunt confirmate live.

Scope-ul viitor cere vizibilitate durabila si interogabila pentru vizite,
pagini/functii vizualizate, actiuni user/admin, evenimente de job, rezultate si
schimbari materiale de configurare. Admin trebuie sa primeasca o cronologie
clara, legata de actor, obiect, moment, rezultat si dovezi canonice. Designul
trebuie sa defineasca explicit retentia, minimizarea, accesul pe roluri,
exportul si stergerea, astfel incat deciziile verbale sau scrise si urmarile lor
operationale sa nu dispara. Pana la proiectarea si acceptarea acestor limite,
punctul ramane backlog si nu este prezentat drept functie existenta.

## Invatare operationala si incidente

Fiecare esec care afecteaza un check, release, deploy sau flux Constructor este
inregistrat durabil cu:

1. cauza radacina sau, pana la confirmare, ipoteza marcata explicit;
2. dovada canonica: run, job, log redactat, incident si SHA;
3. remedierea aplicata si limita ei;
4. testul de regresie care ar fi detectat esecul;
5. runbookul reutilizabil sau actualizarea procedurii existente.

Un retry reusit fara cauza si protectie de regresie nu inchide lectia. Nu se
copiaza secrete sau loguri brute in documentatie; se pastreaza linkul canonic si
rezumatul minim verificabil.

## Credentiala proiectului Keleon

Functiile OpenAI ale produsului folosesc o singura credentiala project-scoped
pentru proiectul Keleon, reprezentata de secretul logic `openai-project-key`.
Serviciile server-side relevante o primesc din aceeasi sursa de secret, prin
mount read-only si cu privilegiu minim; „partajata” nu inseamna copiere in cod,
env-uri publice sau baze de date.

Credentiala nu ajunge niciodata in browser, client nativ, Constructor,
publisher, releaser, Git, GitHub Actions logs sau artefacte. Workerul Constructor
executa direct OpenCode 1.18.25 cu Qwen3.6 prin llama.cpp local si nu face login
la niciun furnizor AI extern. Secretele operationale raman server-side; ele nu
sunt copiate in mediul procesului OpenCode si pot fi folosite numai prin
controalele explicite ale hostului atunci cand ordinul autorizat le necesita.

Daca secretul lipseste sau nu poate fi citit, capabilitatile dependente se
opresc fail-closed si afiseaza un diagnostic stabil, redactat si actionabil in
Admin/chat: serviciul afectat, categoria `provider credential missing`, starea
`setup_required` sau `degraded` si actiunea operatorului. Diagnosticul nu
afiseaza valoarea, prefixul sau lungimea secretului si nu activeaza un furnizor
alternativ.

## Protocol obligatoriu de reluare intre sesiuni

La sfarsitul fiecarei sesiuni de lucru, agentul actualizeaza `CURRENT.md` cu un
handoff concis si verificabil care contine obligatoriu:

1. **Current verified state**: branch, SHA, stare PR/check/deploy/live si ora
   ultimei verificari;
2. **Unfinished work**: ce nu este terminat si starea factuala a fiecarui punct;
3. **Blockers / owner action**: cauza, decizia sau actiunea exacta ceruta
   ownerului; scrie `niciuna` cand nu exista;
4. **Next ordered steps**: urmatorii pasi siguri, in ordinea executiei;
5. **Canonical links**: URL-uri directe pentru toate PR-urile, runurile,
   deploymenturile si incidentele active.

La inceputul sesiunii urmatoare, agentul citeste mai intai `CURRENT.md`, verifica
linkurile si starea fata de sursele canonice, apoi prezinta proactiv ownerului
acest handoff in forma scurta. El face aceasta prezentare inainte sa ceara
ownerului sa repete contextul. Daca checkpointul este depasit, agentul spune ce
s-a schimbat si il actualizeaza; nu transforma starea veche in adevar curent.
Aceasta regula este criteriu de acceptare obligatoriu, nu recomandare.

## Checklist de acceptare si dovezi

### Legea unicitatii

- [ ] Nu exista campuri duplicate care pot actiona independent drept sursa de
      adevar pentru aceeasi regula, configuratie, stare sau inregistrare.
- [ ] Fiecare obiect are identificator si legatura canonica stabile, folosite de
      toate proiectiile UI, documentele si joburile aferente.
- [ ] O actualizare facuta la autoritate se propaga catre toti consumatorii, iar
      lipsa propagarii este detectata si afisata factual, nu mascata de copii.

### Chat natural

- [ ] PR direct si head SHA pentru implementarea acceptata.
- [ ] Run CI complet verde pe acel head.
- [ ] Deploy direct al SHA-ului rezultat.
- [ ] Proba in client real ca o conversatie online primeste raspuns coerent si
      ca eroarea providerului este afisata factual.
- [ ] Prezenta credentialei este confirmata numai prin status redactat, fara
      valoare sau metadate sensibile.

### Voce realtime in romana

- [ ] PR, head SHA si run CI complet pentru traseul audio.
- [ ] Deploy direct al acelui SHA.
- [ ] Proba in client real pentru captare, transcript romanesc, raspuns audio si
      inchiderea/reconectarea sesiunii.
- [ ] Permisiunile refuzate, credentiala absenta si reteaua cazuta au stari
      clare, fara succes fals sau fallback cloud ascuns.

### Status transparent

- [ ] Aceeasi cerere durabila este vizibila in Admin si chat.
- [ ] Checkpointurile, heartbeatul, timeoutul, retry-ul si escaladarea au
      timestamp si stare factuala.
- [ ] PR-ul, checkurile, deploy-ul si incidentul au fiecare URL direct canonic.
- [ ] Nicio stare `live` nu apare fara SHA si proba publica aferenta.

### Traseu protejat complet

- [ ] O cerere pilot reala parcurge Admin -> Constructor -> PR.
- [ ] PR-ul intra in `master` numai dupa review si checkurile obligatorii.
- [ ] Artefactul si deploy-ul sunt legate de acelasi SHA din `master`.
- [ ] `/api/version`, readiness si proba publica confirma SHA-ul live.
- [ ] Exista o tinta de rollback eligibila si procedura/proba ei este legata de
      cerere.

### Fara setup de rutina pentru owner

- [ ] Prerechizitele sunt detectate automat, cu rezultat si dovada vizibile.
- [ ] Defaulturile sigure sunt aplicate fara butoane de configurare in traseul
      normal.
- [ ] Crearea jobului si tranzitiile eligibile pornesc si continua automat.
- [ ] Orice actiune umana ramasa este externa sau ireversibila, iar UI-ul cere
      o singura actiune in limbaj simplu si explica motivul.
- [ ] Dupa actiunea externa, aceeasi cerere se reia automat de la checkpoint,
      fara recreare sau pas manual evitabil.

### Reluare intre sesiuni

- [ ] La inchidere, `CURRENT.md` contine toate cele cinci campuri obligatorii.
- [ ] Linkurile si starile sunt reverificate, nu copiate ca presupuneri.
- [ ] La urmatoarea sesiune, handofful concis este prezentat proactiv inaintea
      oricarei cereri de repetare a contextului.

Fundatia este declarata completa numai cand toate cele patru sectiuni de
produs, regula fara setup de rutina si protocolul de reluare sunt bifate cu
legaturi canonice verificabile.

## Constructor observability and no-hardcoding rule

This section is a mandatory carry-over requirement and supersedes any earlier
wording that permits an accepted Constructor request to remain blocked or to
require a routine manual retry.

- Every user-visible operation exposes an on-screen status, real 0-100 progress,
  and a plain-language activity timeline from start to a resolved result.
- Progress and timeline entries come only from canonical persisted execution
  state/events or an authoritative provider result. Timers, text matching,
  cosmetic minimums, fixed stage percentages, and simulated output are forbidden.
- Refresh reconstructs the same status from PostgreSQL. The UI is a projection;
  it does not own stages, transition labels, percentages, or completion.
- Once an admin request is accepted, recoverable worker, publisher, CI, and
  release transitions retry automatically from their last durable checkpoint.
  They do not become a blocking terminal result because an attempt counter was reached.
- A truly external authority step may pause execution only for one explicit
  action such as interactive provider login, OAuth consent, or payment. The UI
  states that single action and the persisted request resumes automatically when
  readiness is restored.
- 100% is emitted only after the release service has persisted the deployed
  commit and verified live version. Administrator cancellation is a separate
  resolved terminal result.

### Constructor evidence checklist

- [ ] A real admin request has a durable job identifier and an initial persisted event.
- [ ] Worker readiness/heartbeat and claim are visible without exposing credentials.
- [ ] Every meaningful Constructor, PR, merge, and release transition appears after refresh.
- [ ] Percentage changes are derived from the canonical activity catalog and event history.
- [ ] A recoverable failure produces a persisted automatic-recovery event and advances again.
- [ ] No accepted request remains failed, blocked, or lease-expired without automatic continuation.
- [ ] The monitor reaches 100% only with deployed commit, live version, readiness proof, and canonical links.
- [ ] The session handoff records verified state, unfinished work, owner-only blockers, ordered next steps, and links.

### Intentional Constructor constants

| Constant | Authority/owner | Rationale |
| --- | --- | --- |
| Public bounds 0 and 100 (99 before resolution) | Constructor observability contract | Accessibility/API scale; 100 uniquely means authoritative completion, never a stage threshold. |
| Default lease 120s | Platform operations via CONSTRUCTOR_PIPELINE_LEASE_SECONDS | Safe fallback only; production may configure it at runtime without changing source. |
| Cryptographic SHA/UUID lengths | Security protocol | Protocol invariants validated at trust boundaries, not environment data. |
| Database event retention (no automatic deletion) | Data/operations owner | Evidence remains durable until a documented retention policy is approved. |

### Post-foundation no-hardcoding audit backlog

After the full Constructor-to-deploy and voice/chat foundation is live, audit
the broader application for duplicated or hardcoded statuses, transitions,
provider/environment values, simulated responses, progress, feature data, and
timeouts. For each discovery record the authoritative owner, migration/runtime
configuration, evidence, remedy, regression test, and reusable runbook. This
backlog is not permission to delay tonight's Constructor release path.
