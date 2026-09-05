# Checkpoint operațional curent

Actualizat: `2026-09-05T07:04:44Z`

## Incident verificat

- PR #1656 este îmbinat. Release-ul activ și journalul upgrade-ului Constructor
  indică `e65f0112aa2265fea12bfd248b8da645b428017a`.
- Upgrade-ul canonic `vps-run.yml`, run `33949055059`, s-a oprit înainte de
  publicarea artefactelor. Prima cauză a fost ACL-ul directorului runtime,
  resetat de login-ul registry din workflow-ul deploy la `root:root 0700`,
  deși contractul cere `root:10050 0750`.
- Citirea reală de la `07:02:49 UTC` a confirmat că directorul runtime este
  deja canonic, director real `0:10050:750`. Workflow-ul hotfix doar verifică
  această stare și refuză o stare diferită; nu repară automat ACL-ul.
  Journalul exterior este încă prezent, cel interior absent, iar master/live
  rămâne e65. Nu există o recuperare sau un deploy hotfix declarat implicit.
- A doua cauză este demonstrată în installer: funcția
  `validate_source_systemd_text_files` cere zece intrări, dar tupla are nouă
  unități systemd după retragerea drop-inului legacy. Bloburile Git e65 sunt
  LF, cu newline final; validatorul de bytes nu trebuie relaxat.
- Ultima citire read-only a hostului a confirmat outer journal `armed`,
  owner e65, snapshot state SHA-256
  `c7d38b2a170b973e326b012f897f91fa01a3d1abcfc8c7398f2d310a6ccd185f`.
  Journalul interior `constructor-deploy-quiesce.journal` este absent.
  Sentinelul `constructor-unit-migration.pending` are `root:root 0600`, iar
  `/run/kelion/constructor-activation.pending` are `root:root 0444`.
- Snapshotul autentificat conține toate cele trei markere prezente și toate
  cele trei timere enabled/active. Recuperarea trebuie să restaureze exact
  acest vector, nu să îl rescrie pentru a ascunde un defect.
- La `06:51:52.600 UTC`, interogarea DB în tranzacție read-only a măsurat:
  queued=0, running=0, queued arhivate=0, queued eligibile=0 și queued
  nearhivate inclusiv backoff=0. Nu s-au citit texte de ordine sau date personale.
  Aceasta este o măsurătoare punctuală; coada se reverifică înainte de recovery.
- În browserul admin, la verificarea de la `06:24 UTC`, auditul chat nu a
  produs rezultat în nouă secunde; worker/publisher/release au fost raportate
  offline. Panoul Erori are un defect de parsare, iar verificarea Tokenuri a
  întâlnit răspuns 429. Nu există încă dovadă de ordin Constructor finalizat
  prin chat până la deploy.

## Hotfix separat, PR deschis; verificări locale finale trecute

- Worktree: `kelionai-constructor-upgrade-recovery`, branch
  `fix/constructor-upgrade-recovery-20260905`, bazat pe e65.
- PR #1658 este deschis; commitul publicat inițial este `88761890`.
- Installerul corectează două defecte de orchestration: numărătorul `10 → 9`
  și provisionarea copilului `staging`, `root:kelion-handoff 2770`, înainte de
  activarea workerului. Părintele spool-ului rămâne `root:kelion-handoff 0750`.
  `repair-spool-layout` aplică același layout numai cu serviciile oprite și
  fără journal pending; respinge explicit symlinkurile și fișierele în loc
  de directoare. Conținutul handoffurilor existente nu este șters sau rescris.
- Recuperarea unui journal existent rămâne pinuită la e65. Helperul
  `scripts/constructor-upgrade-compat.mjs`, extras din masterul hotfix și
  reverificat prin digest, corectează numai copia installerului din bundle-ul
  temporar, după verificarea ambelor SHA-256 obligatorii:
  - original: `f1a1d60e83bfcd247f8af137f18aa181b30dd5578c6250f68f373c9a9949561e`;
  - corectat: `b3b4a2a6b3189eb0f352c56feed3f5164e0c07fbeaa631bff5901b3a5815d0cd`.
- Nu se modifică cele 23 de artefacte e65, journalul, snapshotul, vectorul
  de activare sau `sourceCommit`. Executorul hotfix și corecția sunt raportate
  separat; bundle-ul nu este prezentat drept arhivă e65 nemodificată.
- Proba POSIX izolată a demonstrat separat că workerul e65 elimină setgid-ul
  copilului înainte de scrierea fișierelor 0440; publisherul primește EACCES.
  Corecția workerului păstrează copilul 2750 și grupul handoff. Această schimbare
  de artefact NU intră în recuperarea e65; se instalează prin tupla hotfix.
- `stale_base` rămâne terminal cu identitatea, ciclul și dovezile păstrate;
  nu mai șterge pipeline-ul, nu resetează attempts și nu reintroduce jobul
  în coadă pentru o nouă execuție AI.
- Ownerul a cerut explicit publicare integral automată: se retrag ruta și
  controalele de aprobare manuală internă. Adminul trebuie să reflecte aceeași
  politică reală ca publisherul: merge automat numai pe checks verzi pentru
  head-ul exact și când protecția GitHub permite. Politica GitHub actuală are
  zero reviews obligatorii; nu se modifică și nu se ocolește protecția GitHub.
- Workflow-ul deploy verifică ACL-ul canonic înainte de login/upload; nu îl
  mai rescrie. Doctorul și celelalte funcții noi nu fac parte din acest hotfix.
- Trainul final înghețat a trecut suita statică Linux: **295/295**, fără
  eșecuri sau teste omise, în 62,585 secunde. Include staging/digest, bytes,
  manifestul static delimitat, inventarul fixture-ului, publicarea automată
  și păstrarea handoffului la `stale_base`. Toate cele trei self-testuri
  worker/publisher/release au trecut. Sintaxa JSON/CSS/shell, workflow-urile
  sigure, hardcodările, exporturile și testele moarte sunt curate.
- Containerul a avut rețeaua dezactivată, zero capabilități, 2 CPU și 4 GB RAM,
  cu sursa montată read-only. Snapshot SHA-256:
  `41c1905530796e66839a8d50aa70d16f537238c3fe12b6828d4d27c7ded2b991`.
- Verificările finale separate: backend **1555/1555**, 212 fișiere, 97 secunde;
  frontend **356/356**, neschimbat de la ultima rulare completă; build/lint/
  precache trecute. Proba POSIX cu bind-uri read-only a trecut **3/3**, iar
  probele publisherului au trecut **20/20**, fără acces GitHub real.
- Scanarea snapshot+dist de la `07:04 UTC`, 49,94 MB, este curată. Duplicate
  zero și audituri dependențe zero vulnerabilități. Istoricul păstrează cele
  11 constatări preexistente; nu se declară istoricul curat. Rezultatele
  locale nu înlocuiesc CI-ul protejat, recuperarea sau dovada live.

## Ordinea sigură de recuperare

1. Revizuiește hotfixul separat și trece porțile/PR-ul protejat. Nu publica
   încă un nou release al aplicației peste e65.
2. Rulează operația canonică `upgrade-constructor` din workflow-ul masterului
   hotfix. Se păstrează ownerul e65 și imaginea gate verificată pentru e65.
   Ambele verificări existente ale release-ului activ trebuie să confirme e65.
   Este necesar un dispatch nou după merge; rerularea runului vechi
   `33949055059` păstrează workflow-ul vechi, fără corecția pinuită.
3. Verifică încheierea reală a upgrade-ului, restaurarea exactă a vectorului
   inițial, controllerul/socketul și lipsa journalelor/sentinelurilor reziduale.
   Nu crea manual markere ready și nu șterge journalul pentru a debloca.
4. Abia apoi publică release-ul hotfix al aplicației și rulează din nou
   `upgrade-constructor`, de această dată pentru tupla integrală hotfix
   (worker SGID și publicare automată aliniată). Între recuperarea e65 și instalarea
   tuplei hotfix nu se creează sau reia niciun ordin; un queued/running detectat
   înainte de recovery impune oprirea și definirea unei migrări sigure.
5. Numai după verificarea noii tuple, execută ordinul real din chat. Acceptarea
   cere testele, PR-ul, receipturile, commitul live și rezultatul
   efectiv, nu doar heartbeat sau teste locale.

## Limite

VPS-ul existent, OpenCode și Big Pickle rămân soluția deja autorizată.
Nu se adaugă modele, provideri, costuri sau privilegii. Testele care execută
helperi de host se rulează numai în containere izolate; un director temporar
nu izolează filesystemul hostului. Acest hotfix nu a fost încă îmbinat,
deployat sau executat în producție; PR-ul inițial nu dovedește extensiile noi.
