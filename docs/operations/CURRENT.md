# Checkpoint operațional curent

Actualizat: 2026-09-05T13:59:17.543Z; fus orar afișare Europe/London.

## Autoritate și stare live

- Toată mentenanța/codul/testele/artefactele: VPS vmi3415434, SSH kelion-vps,
  repository /var/tmp/kelion-maintenance.yQKdV92n/repo,
  branch fix/doctor-vps-live-20260905. SSH/browser sunt doar clienți.
  Sesiunea Codex desktop NU este un serviciu autonom migrat pe VPS.
- Master și /api/release-proof verificate din nou: a32bab142cc2cf1eca2b514c92732308232155b2;
  activeCommit exact, ready=true, candidate=false, sideEffectsActive=true.
- PR1662 OPEN cu auto-rebase activ. Ultimul HEAD publicat9891437718107d17ca784a60ba70e167dc2afaef.
  Run33969440486: preflight și verifyPASS; container-isolationFAIL.
  Șase conversații de review sunt încă deschise până la corecție publicată și dovadă.
  Acest PR repară infrastructura; NU este PR executat de ordinul666.
- OpenCode1.18.25 + opencode-free/big-pickle rămâne singurul motor Constructor aprobat.
  Nicio schimbare de provider/cost/model, protecție GitHub, autentificare ori izolare.

## Ordin666: nefinalizat, prioritate

- Ultima citire completă13:16:09.339Z: queued/queued, cycle0,attempts2,
  updated_at11:41:30.173Z;144evenimente, nici pipeline/PR/commit/deploy.
  Singurul ordin nearchivat queued/running. Schema a32 nu are automation_origin.
- Execuțiile anterioare au eșuat la gate din linkul node_modules backend creat
  chiar de worker; corecția este în candidat. Nu este dovadă de model prea slab.
  Backendul vechi a făcut auto-requeue greșit după eșec; migrarea candidatului
  terminalizează strict aceste cazuri fără ștergerea istoriei.
- Worker verificat din nou: timer enabled/inactive, service inactive/static,PID0.
  Oprire explicită în jurnal11:29:33.345Z; NU reporni înainte de remediere.
  /etc/kelion/codex-worker.paused este încă ABSENT: oprirea actuală nu este
  persistentă peste rebootul unităților vechi. Publisher/release/controller active.
- Hashul celor144evenimente preexistente:
  5264db52cbfbbc569b17a2eaaafd20ad09eba8def3916af1f6c2ba69f84f1610.
  Taskurile istorice codex-f30fe4f1-637d-49b6-86ef-c8e718d38f9a și
  codex-a812fe88-1ccf-4344-905c-a6c450c1deaf nu sunt relansate implicit.

## Corecțiile curente, încă NU live

- P1pauză: inactiv+unpaused se refuză; numai marker intenționat preexistent ori
  jurnal bootstrap valid păstrează pauza. Revalidare înainte de snapshot împotriva
  cursei. Nu se fabrică intenția din systemctl. Root va atesta explicit intenția
  ownerului sub publication lock, aproape de bootstrap-ul atomic, după gates.
  Markerul singur NU protejează rebootul a32 înainte de primul journal schema2.
- P2statistici: lock pe toate cele4tabele raportate și stats_recorded_at atribuit
  de ceasul DB la INSERT, distinct de created_at original/offline/now tranzacțional.
  Migrarea20260919 face backfill fără rescriere de evenimente/costuri. CI primește
  probă concurentă obligatorie pe PostgreSQL privat, nu numai PGlite.
- P2Doctor: simptomul manual neprobat rămâne observed/unverified, nu blocker
  permanent și nu sănătos. Blocajele măsurate și eșecurile de reparație se păstrează.
- P2monitor: doar contencția flock reală validată produce gate=true cu worker și
  intentionalPause null. Pending/lock invalid rămân neconfirmate. Nu este progres,
  readiness, restart sau recuperare fictivă.
- CI Doctor EPERM: fixture-ul copia sursa runner-owned într-un container root fără
  privilegiile copy necesare. Staging byte-exact read/write ca root, cu ownership,
  mode/nlink/hash verificate, fără relaxarea CAP ori gardelor runtime.

## Dovezi preventive și limite

- P1: RED vechi98933tests28PASS/5FAIL; candidat36/36pause+cleanup și52/52bootstrap,
  fără omise. Include timeroprit fărăintenție, race, markerlost și crashcutpoints.
- DoctorP2: RED43PASS/8FAIL; GREEN80/80afectate, typecheck/lintPASS.
- Statistici: realPG RED3PASS/4FAIL→7/7; pasCI nou exact8/8PASS0skip. Toate38migrațiile
  reale cu registry/checksum, backup pg_dump semnat și replay idempotent au trecut
  în PostgreSQL16.15privat. Nicio resetare sau migrare pe DB live.
- GateP2:16/16controller inclusiv flock+HTTP reale;42/42backend, typecheckPASS,
  lintsrc416fișiere0warnings/0errors, peerreview Lovelace fără blocant.
- DoctorCI: cele2comenzi în ordinea/opțiunile canonice, sursăUID1001RO:
  REDscope15PASS/cap0PASS5FAIL→GREENscope15PASS/cap6PASS. Diferența față de proba
  VPS5/5 anterioară era sursa root-owned; nu atribuim syscall intern fără strace.
- Full backend/frontend sunt în curs, log VPS
  /var/tmp/kelion-review-gates.X5G6CZiY/backend-frontend.log.
  Static/scannere rulează separat pe snapshotul comun. Nicio suită în curs nu este
  declarată trecută. Imaginile release ale noului SHA trebuie construite și semnate.
- Incidentele complete sunt în docs/operations/incidents; dovezile de candidat nu
  înlocuiesc instalarea live sau acceptarea ordinului666.

## Următorul pas sigur

1. Încheie verificările comune, actualizează manifestele dacă este necesar, commit,
   preflight clean/currentmaster, push o singură dată pe branch. Răspunde fiecărei
   observații de review cu corecție publicată și dovadă înainte de resolve.
2. Urmărește PR CI/protecțiile→auto-rebase→pushmaster CI→imagini semnate→deploy automat.
   Nu duplicate deploy și nu folosi PRCI drept dovadă pe SHA post-rebase.
3. Pregătește pauza explicită și bootstrap-ul sub publication lock; validează
   vectorul și lipsa tranzacțiilor concurente. Nu lăsa un simplu marker prezentat
   drept gard reboot pe unitățile a32. Upgrade separat după live exactSHA:
   gh workflow run vps-run.yml --repo kelion-team/kelionai --ref master -f operation=upgrade-constructor.
4. Verifică tupla source/master/live/gates/runtime și istoria666. După migrare,
   POST/api/admin/constructor/666/reia cu expectedStatus=failed și updatedAt proaspăt;
   acelașiID, cycle1,attempts0. Clear marker/starttimer numai sublock, fără altjob
   running și cu666primul eligibil. Fără claim folosit drept diagnostic.
5. Urmărește worker→gates→handoff→PRpropriu→merge→deploy și scenariul real Admin Erori
   în browser. Nu se simulează procentul și nu se repetă AI automat după eșec.
6. După666 continuă cerințele aprobate v1.1 și A01–A04; backlogul separat rămâne separat.

## Limite explicite de produs și comunicare

- Monitorul observă; reporterul root-only atestă activitate concretă, nu repară.
  Doctorul candidat are scope doar2formatterepublice, nu parserul666 și nu toate
  funcțiile chat/audio/cameră/memorie/quota/auth. Autorepararea generală NU e livrată.
- Notificarea648 are dovadă DB+DOM+pixels, NU consum automat în orchestrator.
  Fluxul notifyAdmin→admin_notifications→UI nu injectează mesajele în creier.
  systemHealth live condiționează GitHub de GITHUB_TOKEN, absent în runtime.
- Documentele aprobate raportare/context/metode și A01–A04 sunt cerințe, nu probe
  de implementare. Adminul vrea stări concise la ordin; detaliile trebuie să ajungă
  în contextul Kelion cu proveniență. Evită spamul listei Notificări.
- OpenAI insufficient_quota, Admin Costs/Usage invalid_key și Serper necitit rămân
  nerezolvate. Nu inventa zero/succes și nu ascunde roșul.
- Istoria Git avea11constatări Gitleaks preexistente; nu o declara curată/rescrie.
- Nu există contare de boți în visit_daily; read-only13:49UTC:46afișări29aug–5sept,
  azi7; prezență azi1cont/824acțiuni. Caddy live nu are accesslogging; aceste date
  nu pot dovedi crawler legitim, furt, UA, IP unic ori acces sensibil reușit/refuzat.

## Handoff de model autorizat: Astra → Spark → Astra după reset

- Ownerul a autorizat continuarea aceleiași sarcini pe gpt-5.3-codex-spark, apoi
  revenirea la gpt-6-astra / ultra după resetul săptămânal. Starea modelului și
  automatizarea revenirii nu sunt confirmate de acest fișier. Nu recrea proiectul,
  jobul666, ramura ori verificările existente. Cerințele v1.1/A01–A04 rămân valide.
- Viziunea suplimentară a fost salvată, încă necomisă, în
  docs/requirements/approved/2026-09-05/Viziune-aprobata-asistenti-derivati-si-inteligenta-distribuita.md;
  SHAf694516b2b1c0daf3668c4729e90e88e542a1eef70d473efd799f453d0dd0b34.
  Este viziune neimplementată, nu o nouă prioritate.
- Procese: root unified-exec62053 rulează fullBE/FE; logul de mai sus este activ.
  Nu îl relansa. Agent /root/doctor_release_audit/version_ui_audit rulează static
  și scannere; /root/constructor_failure_trace preia ISOstats P2 nou. Agentul
  /root/doctor_release_audit a încheiat88/88+Doctor15/15+6/6 și pregătirea operatorului.
- Inventar GitHub13:56:56UTC: PR1662OPEN/MERGEABLE, ahead4/behind0, head98914377,
  mastera32; verify/current-tree/preflightPASS; container-isolation/merge-policyFAIL;
  full-historySKIPPED. Niciun CI nou pornit și niciun push al corecțiilor actuale.
- Șase review-uri: cele4corectate n8W(pause),n8Z(stats),n8a(Doctor),n8c(gate),
  plus P0 PRRT_kwDOTNNplc6fjw3p index.ts453 și P2 PRRT_kwDOTNNplc6fjw3s statsISO.
  Nu resolve fără corecție publicată și probe.
- P0 ROOT: app.addHook(onClose) pentru constructorMonitorTimer este în
  startBackgroundWork DUPĂ app.listen. Repro Fastify real în container VPS
  networknone/RO/capdrop: FST_ERR_INSTANCE_ALREADY_LISTENING, exit1. Fix ÎNCĂ
  NEAPLICAT: declară timerul nullable și înregistrează hook înainte de listen;
  startBackgroundWork doar atribuie timerul. Adaugă regresie startup/activare/close
  cu Fastify real, fără provider sau servicii live.
- P2 DARWIN: read/reset stats_since::text nu trece parserul ISO strict UI.
  Aprobată normalizare centrală numai wire; predicatele DB folosesc instantul
  exact după baseline.id ca să nu piardă microsecundele prin Date.toISOString.
  Agentul implementează și testează parserul frontend real + evenimente pe
  aceeași milisecundă în jurul cutoff123456microsecunde. Fără client relaxat.
- Pașii imediat următori: P0+P2noi → probe afectate și rezultatele testelor deja
  active → checkpoint/incident/commit/preflight/push unic →6reviewreplies/resolve
  justificate→CIverde/merge/masterCI/imagini/deploy/upgrade→Reiaacelași666.
- Secvență operator confirmată read-only de Dalton: pentru bootstrap înainte
  de deploy folosește owner RELEASE din SHA master post-rebase și CIpush verde,
  request determinist prin scripts/release-dispatch-owner.mjs request-id. Lock
  existent /root/kelion/publicare.lock FD9 validat, nu crea altlock. Sublock
  revalidează tot, publică explicit markerul autorizat schema=1 LF/rootroot0444
  fărăoverwrite, apoi imediat helperul final hashpinned --capture-worker-pause
  cu KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID și KELION_DEPLOY_QUIESCE_OWNER_COMMIT.
  Nu crea journal manual, nu apela deploy.sh subFD9 și nu confunda markerul
  singur cu gardul reboot a32. Helperfinal ebc12ea5dc03064778a281f65e04e8cf5631841caaaf53bb4ab97af56a99c95e.
- Origin pentru model/viziune:01a071d8-0b46-7483-acb7-b1f4ae3a01df; coordonare
  anterioară01a07169-6b1c-70e3-9dc8-b88b092ed134. Raportează progresul fără a
  declara modelul schimbat, CIverde sau livefinalizat fără dovadă.

## Comutare permanentă după limite, confirmată de coordonare

- Originea01a071d8-0b46-7483-acb7-b1f4ae3a01df confirmă automatizarea ACTIVE
  revenire-la-astra-dup-resetarea-codex, «Comutare permanentă Codex după limite
  disponibile», la fiecare30minute. Înlocuiește revenirea unică; nu crea duplicat.
- Principal <=3% rămas (și 2% ca trigger preventiv): Spark/xhigh dacă disponibil. Principal >=20% în toate
  ferestrele: Astra/ultra la această sarcină Constructor, Astra/medium la coordonare.
  Limite reale separate; fără cumpărare sau creditreset, fără bucle ori restarturi.
- Citire cont root: codex92%consumat, reset2026-09-12T10:58:37Z; Spark0%consumat
  în ambeleferestre. Nicio atribuire a consumului la sarcini. Nu retrimite model
  redundant: originea a confirmat cererea Spark/xhigh acceptată; root trimisese
  și Spark/high folosind metadatele toolului. Aplicarea efectivă în tura activă
  nu este verificată. Verifică la următoarea tură dacă instrumentele permit.
- Acesta este controlul modelului Codex, nu dovada unui executor Kelion pe VPS.
  Remedierea continuă din starea existentă; testele/procesele nu se recreează.

## Ultima predare operațională înainte de următoarea tură

- FullBE/FE62053 s-a TERMINAT:1759PASS/1FAIL/3SKIP,1763teste,361.83s.
  Uniculfail: capabilityEvidence.test→genereaza-dovezi-capabilitati cere
  git rev-parse HEAD, iar copia tmpfs tar nu avea.git. Nu este declaratPASS;
  frontend/build/lint de după test NU au rulat. Lovelace preia doar testul
  afectat cu gitmetadata corecte și FEbuild/lint/teste dupăstatics/scannere.
  NU relansa întreaga suită pentru această lipsă de harness.
- P0latehook: ownership transferat ROOT→Dalton /root/doctor_release_audit.
  El implementează index.ts+regresie dedicată și trebuie să demonstreze pornirea
  APLICAȚIEI REALE, activarea candidatului, backgroundwork și controlledclose
  în container izolat cu marker/configfixture, nu doar ordineaAST. P0mini-repro
  Fastifyreal dejaFAILconfirmat. Nu folosi live/providercredentials.
- Darwin ISOstats: realPG RED9PASS/4FAIL→GREEN13/13zeroSKIP,14:00:58UTC.
  Parserii frontend reali acceptă reset/read;123400/123456/123500microsecunde
  demonstrează cutoff exact (2nu3), nullbaseline și infinityrefuzate.
  Finalaffected/typecheck/lint/docînlucru; fărămigrare/clientguard/livewrite.
- Root poate încheia tura pentru schimbarea modelului; aceasta NU este
  finalizareaConstructorului. Originea01a071d8-0b46-7483-acb7-b1f4ae3a01df
  trebuie să continue o singurădată peaceeașisarcinăSpark dupăfinal, dacăidle.

- Supliment login aprobat, salvat separat în docs/requirements/approved/2026-09-05/Completare-aprobata-politica-cont-si-continuitate-login-Kelion.md: politica pe cont, preferințe, context/decizii/sarcină dupălogin/relogin, limite reale și fărădublare. NEIMPLEMENTAT; automatizarea Codex locală nu este dovadă de integrare Kelion. Nu schimbă prioritatea1662→666.
Actualizat: `2026-09-05T15:00:00Z` (16:00 Londra) — executor: Claude (Opus 5)

## Coordonare Claude ↔ GPT/Codex — răspunde tot aici

Am preluat pentru **citire și analiză** la `14:45 UTC`. **Nu am modificat niciun
fișier de cod, nu am pornit niciun deploy și nu am atins ordinul
`constructor:666`.** Singura mea scriere este acest checkpoint.

Motivul: PR **#1662** (`fix/doctor-vps-live-20260905`) a fost deschis la
`14:45:45 UTC`, cu trei minute înainte să încep, cu verificările în curs. Am
confirmat independent că tratează exact cauza pe care am măsurat-o, deci a
lucra în paralel ar însemna doi executori pe același ordin.

**Întrebare:** duci tu #1662 până la capăt, sau predai? Dacă îl duci tu,
actualizează checkpointul la progres și ignoră pașii de mai jos. Dacă predai,
scrie aici ce rămâne și preiau de la pasul următor.

## PROBLEMĂ ACTIVĂ pe #1662 — `container-isolation` a picat

Rularea `33972768310`, jobul `container-isolation`, pasul **«Doctor scope,
semantic AST și capabilitate instalată»**: `5 tests, 0 pass, 5 fail`.

Toate cele cinci eșecuri din `deploy/lib/doctor-runtime-capability.test.mjs`
au aceeași cauză:

```
EPERM: operation not permitted, copyfile
  '/proof/deploy/lib/doctor-repair-scope.mjs'
  -> '/opt/kelion-codex/lib/doctor-repair-scope.mjs'
```

Subteste căzute: `both installed guard copies measure the exact root-owned
supervisor tuple` (`:41`), `semantic parser runtime is non-root, offline,
readonly and mounts no host credentials or parser from the worktree` (`:45`),
`a running old process cannot advertise replacement bytes as the new
capability`, plus încă două.

**Pistă cu dovadă prin contrast, nu încă demonstrată de mine prin rulare.**
Am citit fixture-ul (`deploy/lib/doctor-runtime-capability.test.mjs`, nou în
acest PR) și pasul de CI care îl lansează. Secvența este: `mkdirSync` pe
`/opt/kelion-codex/lib` la `0755`, apoi `writeFileSync` + `chmodSync 0555` pe
worker/publisher, apoi `copyFileSync(guardSource, ...)` + `chmodSync 0444` pe
cele două copii guard. EPERM apare pe `copyFileSync`, deci `mkdirSync` a
reușit — directorul există și este al procesului.

Contrastul decisiv este în același workflow: pasul imediat următor,
**«Predare worker către publisher cu identități separate»**, rulează tot cu
`--user 0:0` și `--cap-drop ALL`, dar **trece**, iar diferența este exact
setul de capabilități:

```
pasul care pică:  --cap-drop ALL --cap-add CHOWN
pasul care trece: --cap-drop ALL --cap-add CHOWN --cap-add FSETID \
                  --cap-add SETUID --cap-add SETGID
```

Un root fără capabilități este tratat de kernel ca utilizator obișnuit la
verificările DAC: uid 0 în sine nu mai acordă nimic. Fixture-ul copiază
fișiere și le fixează imediat pe `0555`/`0444`, iar `copyFileSync` din Node
face `open(dest, …, mode-ul sursei)` urmat de `fchmod` pe destinație.

Verificările de făcut, în ordinea probabilității:
1. adaugă `--cap-add FSETID` (și, dacă mai e nevoie, `DAC_OVERRIDE`, `FOWNER`)
   la pasul care pică, aliniindu-l cu pasul vecin care trece — probabil o
   corecție de o linie în `pr-verify.yml`, nu în test;
2. confirmă `umask` din imaginea `kelion-ci-gates`: un umask neobișnuit ar face
   ca `mkdirSync(mode 0o755)` să producă un director fără bit de scriere;
3. exclude `copy_file_range` între bind-mountul read-only `/proof/deploy` și
   tmpfs-ul `/opt` — dacă e cauza, o copiere prin `readFileSync` +
   `writeFileSync` o ocolește.

Montarea nu este cauza: `/opt` este tmpfs
`rw,nosuid,nodev,noexec,mode=0755,size=8m`, deci permite scrierea.

## Stare verificată de mine (măsurători directe, 14:47–14:52 UTC)

Checkpointul anterior, `07:39:02Z`, era depășit: indica master/live `c3ae5b6e`.

- **Master și aplicația live: `a32bab142cc2cf1eca2b514c92732308232155b2`**,
  identice. `/api/release-proof` la `14:47 UTC`: `ready=true`,
  `candidate=false`, `sideEffectsActive=true`, `activeCommit` exact a32.
  **Nu există nimic gata de publicat peste a32**: master este deja live, iar
  #1662 nu a trecut verificările.
- PR #1658 este **îmbinat**, head `847312f2`, toate verificările obligatorii
  verzi.
- **Infrastructura Constructorului este recuperată.** Citire read-only pe VPS:
  `kelion-codex-worker`, `kelion-constructor-publisher` și
  `kelion-constructor-release` au timer **enabled** și ultimul rezultat
  **success**; `kelion-constructor-model-control` este **active**;
  `/run/kelion/runtime-config-recovery.ready` este **prezent**; niciun marker
  blocant — doar `constructor-unit-migration.pending.abandoned*`, în afara
  globului `constructor-*`. Recuperarea a fost făcută de `vps-run`
  **33954585185**, `08:11:30`, success.

## Cauza blocajului lui `constructor:666` — demonstrată

Ordinul rămâne `queued`, cycle0, attempts2, fără pipeline/PR/deploy. Din
jurnalul workerului, ultima rulare, `13:41:30 CEST`:

```
codex-gates: VERDICT schema=1 exit=1
codex-gates: worktree-ul conține node_modules backend necontrolat
```

Poarta respinge worktree-ul poluat cu `node_modules` necontrolat. Imaginea
gate are `org.opencontainers.image.revision = a32bab14`, adică exact masterul
activ — **nu este o nepotrivire de versiune**.

**Cauza istorică din checkpointul de la 07:04 — oprirea la capturarea stării
serviciilor înainte de înlocuirea fișierelor — NU mai este cauza curentă.**
Verificată și exclusă: serviciile sunt sănătoase, journalele s-au încheiat,
ACL-ul runtime este canonic.

Confirmat că #1662 acoperă această cauză: diff-ul conține fixture care creează
`node_modules` pe secțiuni și asertează worktree-ul poluat
(`?? backend/node_modules`, `?? frontend/node_modules`) plus curățarea lui.

## Ce rămâne pentru acceptare

Constructorul **nu** este funcțional capăt-la-capăt. Lipsește proba completă:
o cerere reală din chat/Admin care produce o modificare, trece verificările,
ajunge prin fluxul protejat în master, este publicată automat și are
rezultatul confirmat live. Niciun ordin nu a parcurs încă acest traseu.

## Următorii pași, în ordine

1. Repară eșecul `container-isolation` de mai sus; #1662 trece verificările și
   este îmbinat prin fluxul protejat, fără ocolire.
2. Deploy automat pe noul master; se confirmă `activeCommit` pe
   `/api/release-proof`, nu doar rularea verde.
3. Dispatch **nou** `operation=upgrade-constructor` din `vps-run.yml`, de pe
   noul master, după release. Se verifică hashes, controller/socket,
   heartbeats și încheierea journalelor.
4. **Reia explicit** același `constructor:666` — fără ordin nou, fără
   reexecuție automată a unui ordin deja revendicat.
5. Se urmărește ordinul până la teste, PR, merge, deploy și rezultat vizibil
   live. Abia atunci Constructorul poate fi declarat gata.

## Blockers / owner action

Nicio acțiune cerută ownerului. Singura decizie deschisă este cea de
coordonare din capul documentului.

## Regulă permanentă de continuitate: Claude ↔ GPT/Codex

Continuitatea este obligatorie în ambele sensuri și folosește **acest** fișier
ca unic checkpoint canonic, nu jurnale paralele cu stări concurente. Fiecare
executor îl actualizează după progres semnificativ, la eșec sau blocaj și
înainte de predare ori încheiere — nu doar la final, pentru ca o întrerupere
sau o limită atinsă să lase un punct recent de reluare.

Handofful conține: obiectivul și ultimele decizii ale utilizatorului;
checkoutul, ramura, commitul și modificările necomise; ce este verificat, cu
dovezi și momentul verificării; ce a eșuat, cu cauza demonstrată sau ipoteza
marcată ca atare; operațiile încă active și cum se verifică; lucrul rămas și
pașii următori în ordine; deciziile cerute utilizatorului; legăturile canonice.
Fără secrete și fără loguri sensibile.

Executorul care preia citește întâi acest checkpoint, verifică starea actuală
și continuă fără să ceară utilizatorului să reconstruiască discuția. Nu se
presupune acces la conversațiile celuilalt și nu se presupune că o operație în
desfășurare a reușit.

## Prioritate imediat după finalizarea Constructorului

Prima prioritate devine **«Apelarea asistentului prin Kelion»**. Definiția
integrării se recuperează din documentația existentă; mecanismul tehnic nu a
fost clarificat și nu se presupune un anumit API sau mod vocal. Nu se începe
implementarea înaintea finalizării Constructorului.

Asistenții interconectați și celelalte funcții noi rămân pentru etape
ulterioare.

La orice schimbare de model, modalitate voce/text, sesiune sau executor, se
recitesc obligatoriu acest checkpoint și regulile de livrare, se identifică ce
este verificat, ce a eșuat și pasul următor, și se verifică operațiile active
înainte de reluare.

## Canonical links

- PR în lucru: https://github.com/kelion-team/kelionai/pull/1662
- Verificarea căzută: https://github.com/kelion-team/kelionai/actions/runs/33972768310
- PR îmbinat anterior: https://github.com/kelion-team/kelionai/pull/1658
- Recuperare Constructor: https://github.com/kelion-team/kelionai/actions/runs/33954585185
- Live: https://kelionai.app/
- Proba exactă: https://kelionai.app/api/release-proof

## Limite obligatorii

VPS-ul existent, OpenCode și Big Pickle rămân soluția autorizată. Nu se adaugă
modele, provideri, costuri sau privilegii. Nu se rescrie software-ul, nu se
schimbă arhitectura, stackul, motorul Constructorului sau configurația
aprobată. Testele cu layout de host rulează numai în containere izolate,
niciodată asupra directoarelor hostului. Nu se șterg markere sau jurnale
pentru a afișa succes și nu se declară funcțional ce este doar planificat.
Scanarea snapshot+dist este separată de istoria Git, care păstrează 11
constatări preexistente; nu se declară istoricul curat.
