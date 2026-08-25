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
succes: reia aceeasi cerere idempotent, cu buget limitat de retry. Dupa
epuizarea bugetului, cererea ramane `blocat` cu o cauza, responsabil, actiune
ceruta ownerului/operatorului si termen de recontrol. Retry-ul nu creeaza o
cerere duplicata si nu pierde dovezile anterioare.

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

Credentiala nu ajunge niciodata in browser, client nativ, workerul Constructor,
publisher, releaser, Git, GitHub Actions logs sau artefacte. Workerul Codex isi
pastreaza separat autentificarea oficiala `codex login`; ea nu inlocuieste si nu
citeste credentiala de produs.

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
