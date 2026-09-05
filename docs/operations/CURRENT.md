# Checkpoint operațional curent

Actualizat: `2026-09-05T07:39:02Z` (08:39 Londra)

## Current verified state

- Master și aplicația live: `c3ae5b6ef3ce5670a8f16cf6ba459b1e76288dec`.
  PR #1658 este îmbinat. Deploy-ul #33952456520, attempt 2, este **success**;
  toate joburile obligatorii au trecut. Cererea durabilă rămâne
  `ace02cae-2437-5c29-a920-adf894639916`.
- Proba publică de la 07:39:02 UTC: /api/release-proof are ready=true,
  candidate=false, sideEffectsActive=true și activeCommit exact c3.
  /api/version indică c3ae5b6, pornit la 07:28:17.366 UTC.
  Browserul a aplicat actualizarea PWA și afișează build/pornire în ora Londrei.
  Compararea automată a SHA-ului complet UI/master/runtime nu este încă live.
- Pe VPS: runtime este director real root:10050 0750; recovery și controller
  active, toate cele trei timere active, fără journal runtime rămas.
  Ultima citire read-only a cozii, 07:34:13 UTC: zero ordine.
- Recuperarea pinuită e65 s-a încheiat. Nu se reexecută: nu mai există journal.
  Artefactele Constructor instalate sunt încă generația e65; aplicația c3
  actualizată nu dovedește instalarea noii tuple worker/controller.
- Nu a fost creat încă ordinul pilot. Constructorul nu este declarat funcțional
  end-to-end; Doctorul nu este instalat sau activ pe live.

## Unfinished work

Train separat bazat pe c3: `fix/constructor-controller-readiness-20260905`.
Corecțiile sunt în lucru, nu încă îmbinate/deployate:

1. OpenCode --version din namespace-ul controllerului încerca să scrie
   /root/.local sub filesystem read-only. Proba reală a reprodus EROFS.
   Controllerul alocă HOME/XDG private numai acestei comenzi, le curăță strict
   după identitate și nu schimbă izolarea unității, modelul sau secretele.
   Testul obligatoriu CI rulează binarul oficial 1.18.25, cu ambele SHA-256
   fixate, în container read-only/network-none/cap-drop-all.
2. Cleanup-ul upgrade-ului trata unitățile tranzitorii deja colectate ca
   eșec după upgrade reușit. Corecția acceptă numai absența verificată și
   păstrează erorile reale de stop/query/job/reset/remove.
3. backup.sh rescria părintele runtime comun la root:root 0700. Writerul
   instalat din c3 și sursa Git au fost comparate, nu doar presupuse.
   Corecția păstrează ACL-ul canonic al părintelui și protecția fișierelor private.
4. Postproba deploy confunda unitatea recovery oneshot cu un daemon permanent.
   Helperul CLI se executase cu succes sub lock, dar wrapperul systemd rămăsese
   inactive/dead după oprirea din installer. Proba trebuie să valideze unitatea
   canonică enabled, fără job/error, plus rezultatul helperului curent,
   controllerul/socketul și timerele; nu pornește un al doilea helper sub lock.

Attempt 1 al deploy-ului c3 s-a oprit după commitul aplicației/gate-ului la
postproba Constructor. Recuperarea canonică a aceluiași journal a reușit la
07:35:18 UTC; attempt 2 al aceleiași cereri a trecut. Nu s-au fabricat markere,
șters jurnale manual sau creat o cerere nouă pentru a ascunde eșecul.

## Blockers / owner action

Nicio acțiune suplimentară cerută ownerului pentru acest train.
OpenAI quota/chat/voce rămân probleme separate; modelul Constructorului nu
este fallback al chatului. Nu se schimbă furnizorul și nu se autorizează costuri.

## Next ordered steps

1. Îngheață corecțiile dependente, verifică regresiile și toate porțile pe
   snapshotul final; commit, preflight și PR protejat cu merge automat pe verde.
2. Confirmă noul master, imaginile semnate și deploy-ul exact pe VPS/live.
3. Dispatch NOU operation=upgrade-constructor din vps-run.yml de pe master,
   numai după release. Instalează tupla integrală curentă și verifică hashes,
   controller/socket, heartbeats și încheierea journalelor.
4. Creează un singur ordin real în browser pentru defectul Admin Erori:
   parserul respinge sursele constructor/autoverificare/config acceptate de
   backend. Urmărește același job până la teste, PR, merge, deploy și rezultat
   vizibil pe live. Nu reexecuta modelul automat după eșec.
5. După pilot, consolidează Doctorul și compararea completă a versiunilor din
   worktree-ul separat pe noul master; rulează porțile, deploy-ul și probele
   proprii. Lucrările WIP nu sunt dovezi live.

## Canonical links

- PR: https://github.com/kelion-team/kelionai/pull/1658
- CI c3: https://github.com/kelion-team/kelionai/actions/runs/33951837314
- Imagini c3: https://github.com/kelion-team/kelionai/actions/runs/33952045711
- Deploy c3: https://github.com/kelion-team/kelionai/actions/runs/33952456520
- Live: https://kelionai.app/
- Proba exactă: https://kelionai.app/api/release-proof

## Limite obligatorii

VPS-ul existent, OpenCode și Big Pickle rămân soluția autorizată. Nu se adaugă
modele, provideri, costuri sau privilegii. Testele cu layout de host rulează
numai în containere izolate, niciodată asupra directoarelor hostului.
Scanarea snapshot+dist este separată de istoria Git, care păstrează 11
constatări preexistente; nu se declară istoricul curat.
