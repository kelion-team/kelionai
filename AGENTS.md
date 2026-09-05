# KelionAI — reguli obligatorii pentru orice agent

Acest monorepo livrează aplicația KelionAI. Răspunsurile pentru owner sunt în
română. Codul, configurația validată, testele și runbook-urile curente sunt
singurele surse de adevăr; handoff-urile și rapoartele istorice nu se păstrează
în arborele activ.

## Reluarea lucrului operațional

La începutul oricărei lucrări de release, incident, producție sau continuitate,
citește mai întâi `docs/operations/CURRENT.md`. Actualizează-l înainte de a
întrerupe sesiunea și după orice schimbare materială de stare. Fișierul conține
numai starea curentă verificată și următorul pas sigur; nu copiază loguri,
secrete sau presupuneri din conversație.

Ownerul cere explicit execuție independentă de laptop: mentenanța, editările,
testele și artefactele acestui release se lucrează pe VPS într-un repository
izolat, nu într-un worktree Windows. SSH și browserul sunt numai clienți de
control/observare. Constructorul, Doctorul și reluările downstream permise
trebuie supravegheate pe server, cu stare durabilă; nu depind de un terminal,
tab sau sesiune Codex deschisă. O sesiune AI desktop nu se declară migrată pe
VPS doar pentru că transmite comenzi SSH.

Înaintea următorului ordin pilot, verifică integral compatibilitatea coadă →
claim → executor → cleanup → porți → handoff → publisher → release → UI,
inclusiv eșec, timeout și restart. Proba live confirmă analiza și regresiile;
nu înlocuiește auditul preventiv al interfețelor dintre componente.

## Invariante de produs

- OpenAI Responses este singurul creier online al conversației Kelion. OpenAI
  Realtime, transcrierea, imaginea și video pot fi folosite numai prin backend,
  cu modele validate din configurare. Constructorul este excepția explicită:
  rulează separat cu OpenCode și modelul gratuit Big Pickle, aprobat explicit
  de owner. Configurația canonică este `deploy/opencode-constructor.json`.
  Nu este fallback pentru chat, nu folosește o cheie OpenAI și nu comută la
  modele plătite. Gratuitatea furnizorului nu este o garanție permanentă.
- Modul avion rulează exclusiv pe dispozitiv. Modelele/runtime-urile locale
  offline sunt permise, nu primesc chei și nu devin fallback online de server.
- Browserul nu primește niciodată chei OpenAI, tokenuri Codex, refresh-tokenuri
  Google sau credențiale Git/VPS.
- Adminul este determinat doar din identitatea Google verificată pe server și
  emailul configurat. Vocea și fața sunt funcții opționale de personalizare,
  nu factori de autentificare sau autorizare.
- Cheia project-scoped `OPENAI_API_KEY` este unica identitate pentru inferența
  cloud a aplicației și alimentează Responses, Realtime și media prin backend.
  Nu ajunge la Constructor. Constructorul rulează într-un worker separat cu
  OpenCode izolat; web-ul și clientul Constructor pentru laptop pun aceleași
  joburi validate în aceeași coadă și afișează starea, fără chei AI, OAuth
  OpenAI sau execuție shell/Git în procesul aplicației.
- `OPENAI_ADMIN_KEY` este o credențială distinctă, montată numai în backend-ul
  Kelion Admin pentru endpointurile OpenAI de administrare (costuri, usage și
  diagnostic). Nu poate fi folosită pentru inferență, Realtime, media sau
  Constructor și nu ajunge niciodată în browser, loguri ori răspunsuri API.
- Pentru admin, debitul Kelion este întotdeauna zero. Costul real OpenAI este
  înregistrat separat ca cheltuială internă; nu este amestecat cu portofelul.
- La fiecare alimentare eligibilă a unui client, politica este exact 75% credit
  utilizabil și 25% marjă Kelion, calculată în unități monetare minore. Politica
  este unică, versionată și nu poate deriva din variabile procentuale arbitrare.
- Sumele clientului sunt în GBP minor units/credite de produs. Costurile
  furnizorului sunt în USD micros. Conversia sau debitarea între unități fără o
  politică explicită, versionată și testată este interzisă.
- Colectarea de senzori/biometrie cere consimțământ granular și revocabil.
  Minimizare, retenție per tabel, export și ștergere/anonymizare self-service
  trebuie să corespundă exact textului legal.

## Limite de securitate

- Nicio rută publică nu primește căi de fișiere, SQL, shell, URL-uri arbitrare,
  PAN/CVC sau tokenuri. Orice input extern are schemă, limită de mărime și
  autorizare la obiectul utilizatorului.
- Taskurile pentru agentul Copilot rămân strict în repository-ul curent; nu
  includ comenzi de acces pe hosturi externe (SSH/VPS), mutații pe sisteme
  private sau instrucțiuni în afara sandboxului de CI.
- Mutațiile pe cookie cer protecție CSRF și verificare strictă Origin. Cookie-ul
  de sesiune este Secure, HttpOnly, host-only și nu conține tokenuri OAuth.
- HTML generat/iframe este sandboxat cu CSP minim; autentificarea Google se
  deschide în browserul de sistem, nu într-un webview încorporat.
- Jurnalele și auditul nu păstrează secrete, conținut biometric, IP complet sau
  payload-uri personale brute. O eroare de DB/cost/auth este fail-closed, nu zero
  inventat și nu succes 2xx cu `ok:false`.
- Secretele vin numai din secret store/env, se scanează în arborele curent și în
  istoria Git și nu se copiază în chat, teste, artefacte sau documentație.

## Constructor și publicare

Fluxul unic este:

1. admin Google autentificat creează un job validat;
2. workerul HMAC îl revendică într-un checkout/worktree dedicat;
3. OpenCode 1.18.25 folosește numai modelul aprobat din configurația canonică.
   Executorul rulează într-un container rootless cu copia de lucru a codului;
   nu primește sudo pe host, secrete, baza de date, socketuri sau credențiale
   Git/VPS. Workerul păstrează controlul ordinului, lease-ului și jurnalului;
   publisherul separat gestionează publicarea. Profilul `fast` poate rămâne
   identificator intern de compatibilitate, dar nu dovedește modelul unei
   rulări istorice. Modelele locale și selectorul lor sunt retrase;
4. schimbările dependente intră într-un singur release train bazat pe ultimul
   `origin/master`; rulează `node scripts/release-train-preflight.mjs` și toate
   porțile locale înainte de PR;
5. toate porțile obligatorii trec o singură dată pentru trainul complet;
6. se deschide un PR auditat;
7. PR-ul se îmbină prin rebase în `master` numai pe verde;
8. deploy-ul este separat, cu backup, health și dovada că versiunea live este
   exact commitul din `master`.

Ownerul a cerut explicit pe 5 septembrie 2026 publicare complet automată:
Constructorul și Doctorul nu cer aprobarea manuală a fiecărui PR și nu introduc
un acord intern paralel. Publisherul face rebase merge numai după verificările
obligatorii verzi pe head-ul exact și respectând protecția GitHub existentă.
Un prag GitHub de zero review-uri nu înseamnă că s-a efectuat un review uman.
Nu se dezactivează protecții, autentificarea sau izolarea pentru automatizare.

Nu se face push direct în `master`, force-push, deploy din browser sau publicare
dintr-un job care nu a trecut porțile. Credențialele Git/host sunt separate de
aplicația publică și au permisiuni minime.

Doctorul permanent cerut de owner identifică simptome măsurate și trimite
reparații punctuale prin aceeași coadă și aceleași porți. Nu creează o conductă
paralelă de publicare, nu repetă nelimitat un eșec și nu schimbă modelul,
facturarea, secretele sau datele utilizatorilor pentru a ascunde o problemă.
Un incident este rezolvat numai după verificarea rezultatului pe live; lipsa
unor loguri noi sau trecerea testelor locale nu reprezintă dovadă de remediere.

Regula completă și setările GitHub cerute ownerului sunt în
`docs/RELEASE-TRAIN.md`.

Actualizările de branch, conflictele, conversațiile de review nerezolvate și
celelalte blocaje se tratează obligatoriu prin procedura din același document.
Fiecare corecție păstrează identitatea dovezilor și repetă verificările cerute
pentru noul head. Nu marca o conversație rezolvată fără răspuns și dovadă.
Urmărește permanent branch → master → release de producție → live → buildul
încărcat în browser; comparația se face pe commituri și manifeste, nu doar pe
eticheta semantică sau oră. Orice diferență rămâne vizibilă până la reconciliere.

## Calitatea codului

- Caută înainte de a crea o rută, funcție, componentă sau schemă. O singură
  responsabilitate are o singură implementare și un singur contract.
- Elimină modulele, rutele, testele și configurațiile retrase; nu le păstra prin
  markere de excepție sau comentarii istorice.
- Numele modelelor, tarifele, procentele, originile, pragurile și stările
  operaționale vin din config/server/DB. Excepțiile tehnice statice au motiv
  local și test.
- Nu masca erori și nu pretinde capabilități neverificate. Semnalele de
  cameră/microfon sunt indicii măsurate, nu inferențe despre emoții, intenții,
  sănătate sau identitate.
- Editează fișierele mici responsabile; sparge monoliții când schimbarea altfel
  ar dubla logică. Păstrează compatibilitatea doar dacă există consumator real.

## Porți înainte de PR

Din rădăcina repo-ului, minimum:

```bash
npm --prefix backend ci --no-audit --no-fund
npm --prefix backend run typecheck
npm --prefix backend test
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build
npm --prefix frontend run lint
node scripts/inventar-audit.mjs
node scripts/identifica-teste-moarte.mjs
node scripts/verifica-exporturi.mjs
node scripts/verifica-sintaxa.mjs
node scripts/verifica-hardcodari.mjs
node scripts/verifica-creier-unic.mjs
node scripts/verifica-workflow-uri-sigure.mjs
npx --yes jscpd@5.0.16 --config .jscpd.json --threshold 0 --cross-formats js-ts
```

Mai rulează auditul de dependențe, scanarea Gitleaks pentru snapshot + istorie,
testele Docker/worker și matricea E2E relevantă. Nicio poartă obligatorie nu are
`continue-on-error`.

## Acceptare

„Gata” înseamnă: teste locale verzi, staging verificat, apoi producție în
browser real pentru visitor/customer/admin, chat text + live voice, vedere,
auz, memorie, offline/avion, cumpărare credite, regula 75/25, admin zero,
Constructor și dovada deploy-ului. Un flux netestat este raportat ca netestat,
nu ca funcțional.
