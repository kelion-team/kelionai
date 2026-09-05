# Checkpoint operațional curent

Actualizat: `2026-09-05T06:40:10Z`

## Incident verificat

- PR #1656 este îmbinat. Release-ul activ și journalul upgrade-ului Constructor
  indică `e65f0112aa2265fea12bfd248b8da645b428017a`.
- Upgrade-ul canonic `vps-run.yml`, run `33949055059`, s-a oprit înainte de
  publicarea artefactelor. Prima cauză a fost ACL-ul directorului runtime,
  resetat de login-ul registry din workflow-ul deploy la `root:root 0700`,
  deși contractul cere `root:10050 0750`.
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
- În browserul admin, la verificarea de la `06:24 UTC`, auditul chat nu a
  produs rezultat în nouă secunde; worker/publisher/release au fost raportate
  offline. Panoul Erori are un defect de parsare, iar verificarea Tokenuri a
  întâlnit răspuns 429. Nu există încă dovadă de ordin Constructor finalizat
  prin chat până la deploy.

## Hotfix separat, nepublicat

- Worktree: `kelionai-constructor-upgrade-recovery`, branch
  `fix/constructor-upgrade-recovery-20260905`, bazat pe e65.
- Installerul curent corectează strict numărătorul `10 → 9`. Contractul de
  bytes și numărul exact de unități rămân obligatorii.
- Recuperarea unui journal existent rămâne pinuită la e65. Helperul
  `scripts/constructor-upgrade-compat.mjs`, extras din masterul hotfix și
  reverificat prin digest, corectează numai copia installerului din bundle-ul
  temporar, după verificarea ambelor SHA-256 obligatorii:
  - original: `f1a1d60e83bfcd247f8af137f18aa181b30dd5578c6250f68f373c9a9949561e`;
  - corectat: `801e14436d8ac8341614f04fb7b9d327172db7523535c31868832ef597be7ab5`.
- Nu se modifică cele 23 de artefacte e65, journalul, snapshotul, vectorul
  de activare sau `sourceCommit`. Executorul hotfix și corecția sunt raportate
  separat; bundle-ul nu este prezentat drept arhivă e65 nemodificată.
- Workflow-ul deploy verifică ACL-ul canonic înainte de login/upload; nu îl
  mai rescrie. Doctorul și celelalte funcții noi nu fac parte din acest hotfix.
- Suita statică canonică a trecut în Node 22/Linux: **292/292**, fără eșecuri
  sau teste omise, în 58,231 secunde. Include corecția digest-pinned,
  artefacte/journal nemodificate, bytes strict, hashul tuplei și probele
  existente recovery/deploy. Toate cele trei self-testuri worker, publisher
  și release au trecut; sintaxa JSON/CSS/shell, workflow-urile sigure,
  hardcodările, exporturile și testele moarte sunt curate.
- Verificarea a rulat într-un container temporar fără rețea/capabilități,
  cu 2 CPU, 4 GB RAM și snapshotul montat read-only. Snapshot SHA-256:
  `eaac4b7773e41ad8fe3f7befcc045a91eff918b641ec9fc20400c52d621c102d`.
  Aceste rezultate nu reprezintă încă CI-ul protejat sau proba live a
  Constructorului. Prima rulare a detectat o aserțiune statică învechită
  care încă cerea zece unități; aceasta a fost corectată la cele nouă reale,
  apoi întreaga suită a fost rerulată.
- Verificările separate finalizate de coordonator: backend **1554/1554**,
  frontend **356/356**, build/lint/precache trecute, snapshot și dist fără
  secrete, duplicate zero și audituri dependențe zero vulnerabilități.
  Scanarea istoricului a păstrat cele 11 constatări preexistente; nu se
  declară istoricul curat și nu se confundă aceste rezultate cu proba live.

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
4. Abia apoi publică un nou release al aplicației și execută un ordin real
   din chat. Acceptarea cere testele, PR-ul, receipturile, commitul live și
   rezultatul efectiv, nu doar heartbeat sau teste locale.

## Limite

VPS-ul existent, OpenCode și Big Pickle rămân soluția deja autorizată.
Nu se adaugă modele, provideri, costuri sau privilegii. Testele care execută
helperi de host se rulează numai în containere izolate; un director temporar
nu izolează filesystemul hostului. Acest hotfix nu a fost încă îmbinat,
deployat sau executat în producție.
