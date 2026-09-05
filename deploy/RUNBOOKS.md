# Runbookuri operaționale

Aceste proceduri descriu numai contractul curent. Nu se rulează comenzi libere
din `workflow_dispatch`, nu se copiază secrete în chat și nu se publică dintr-un
worktree nevalidat.

## Diagnostic read-only

Rulează workflow-ul `vps-diag`. El afișează numai containerele gestionate,
manifestul activ, codurile `/livez`, `/readyz`, `/api/version`, starea unităților
și resursele gazdei. Nu citește env-ul containerelor și nu tipărește valori din
secret files sau loguri de aplicație.

Înainte de o intervenție manuală, identifică exact containerul/procesul prin
nume, PID, imagine și eticheta de commit. Nu folosi `pkill -f`, restart în masă
sau ștergere recursivă.

## Provisionarea configului și secretelor

1. Configurează repository variables pentru toate intrările din
   `requiredNonSecret` și repository secrets pentru toate intrările din
   `secretFiles`, `hostProvisionedSecretFiles` și `workflowControlSecrets` din
   `config/runtime-contract.json`. Intrările `generatedRuntime` sunt generate
   canonic de workflow; nu le dubla drept variabile GitHub.
2. Păstrează `CODEX_WORKER_ENABLED=0`, `PAYMENT_MODE=disabled` și
   `PUSH_ENABLED=0` până când fiecare capabilitate are verificarea proprie.
3. Rulează manual `vps-set-env` în mediul aprobat. Workflow-ul validează
   allowlistul, oprește cele șase unități Constructor, comite ca grup
   `runtime.env`, secret files și copiile de config Constructor, apoi recreează
   și verifică slotul backend activ înainte să reactiveze timer-ele. Operația nu
   publică un commit nou, dar produce o scurtă fereastră de restart controlat.
4. Verifică numai numele, ownerul și modurile fișierelor. Nu folosi `cat`,
   `docker inspect .Config.Env` sau shell tracing pe valori.

Când plățile sunt dezactivate, mounturile Merchant există cu placeholder
aleator și capabilitatea rămâne fail-closed. Activarea cere simultan contractul
verificat și cele două secrete Merchant reale. Push urmează aceeași regulă:
cheia privată există numai în secret-file, iar lista de endpointuri este o
allowlist de domenii.

## Release și rollback

### Ownership și freeze pentru pilotul Constructor

`release-dispatch` cere exact un PR asociat, merged canonic în `master`, pentru
SHA-ul candidat. Pentru un PR obișnuit valid, el derivă un request ID determinist
din repository + SHA + runul CI; rerularea buildului pentru același CI nu
inventează alt owner. Dispatcherul cere separat un singur build canonic verde
și un singur artefact valid pentru acel SHA. Pentru un PR Constructor canonic
(`codex/<UUID>`, titlu/body/commit exact verificate), dispatcherul generic se
oprește fără dispatch: release-ul rămâne exclusiv în proprietatea dispatcherului
Constructor și a request ID-ului său determinist. Zero/mai multe PR-uri asociate,
un marker Constructor parțial sau metadate necanonice blochează fail-closed.

Din momentul merge-ului PR-ului pilot Constructor este obligatoriu freeze pe
`master`: nu se îmbină alt PR și nu se avansează `master` până când deploy-ul
acelui SHA ajunge terminal. Nu lansa în paralel un release generic/manual cu alt
request ID. Verificatorul urmărește identitatea exactă SHA/CI/build/request,
așteaptă runul pending și acceptă o singură reușită cu jobul `release` verde;
numai eșecurile aceluiași request ID/SHA pot fi recuperate, iar două request
ID-uri reușite distincte sunt ambigue și se blochează. Dacă deploy-ul pilot se
termină cu eșec, păstrează
mutatorii de producție opriți până la diagnostic și o nouă decizie explicită a
ownerului.

1. Confirmă că SHA-ul integral este vârful `master`, `pr-verify` este verde și
   `build-images` a produs manifestul semnat pentru același SHA.
2. Pentru un PR obișnuit, lasă `release-dispatch` să emită automat requestul
   generic determinist. Pentru pilotul Constructor, așteaptă requestul
   dispatcherului Constructor; nu lansa manual un request străin.
3. Acceptă release-ul numai dacă workflow-ul confirmă versiunea publică exactă
   și `/readyz=200` după activarea efectelor.

Pentru rollback selectează `release_mode=rollback` și un commit integral din
istoricul `master` al cărui artefact semnat este încă disponibil. Nu re-eticheta
imagini și nu ocoli runnerul de migrări. Dacă schema este incompatibilă,
rollbackul trebuie să rămână blocat; se pregătește o migrare forward de remediere.

La primul cutover, rollback-ul pre-switch oprește candidatul, restaurează
backupul verificat și abia apoi repornește containerele legacy capturate.
Confirmarea legacy este `/api/version` JSON egal cu versiunea capturată, nu
`/livez` sau `/readyz`, care în imaginea veche pot fi fallback SPA. Nu porni un
workflow către un artefact vechi dacă migratorul raportează checksum
incompatibil: pregătește un fix forward sau execută o restaurare controlată din
backup după oprirea scrierilor. Nu modifica manual tabela de migrări.

### Revenire manuală la stackul legacy păstrat

Pentru un plan fără migrare distructivă, primul release nou oprește
`kelionai-app`, `omniroute` și `kelionai-coqui` numai după ce versiunea publică
exactă și readiness-ul cu efecte active sunt verzi. Pentru un plan distructiv,
le oprește înainte de backup/migrare, iar `kelion-caddy` răspunde 502
fail-closed până la cutover.
Containerele, imaginile și volumele nu sunt șterse. `kelion-caddy` este tratat
separat de comutarea proxy-ului.

Revenirea manuală este numai pentru incidentul în care workflow-ul de rollback
semnat nu mai poate rula:

1. Înregistrează read-only existența, imaginea și starea celor patru containere;
   oprește procedura dacă numele sau imaginile diferă de preflight.
2. Citește jurnalul root-only
   `/root/kelion/runtime/destructive-cutover-recovery.json`; el persistă atomic
   faza, obligația de restore și `pointOfNoReturn` înainte de migrator și înainte
   de expunerea posibilă. Nu îl șterge până la închiderea incidentului. Dacă
   `pointOfNoReturn` este `true`, nu opri candidatul, nu aplica snapshotul și nu
   porni runtime-ul vechi: păstrează candidatul/DB/proxy nemodificate și
   pregătește fix-forward.
3. Numai înainte de point-of-no-return, oprește procesele managed, rulează
   helperul de restore verificat și confirmă contractul DB anterior înainte de
   pornirea oricărui writer.
4. Pornește, fără recreare, containerele existente `kelionai-coqui`,
   `omniroute` și `kelionai-app`; confirmă că sunt `running` și că aplicația
   legacy răspunde cu `/api/version` JSON egal cu versiunea capturată.
5. Oprește proxy-ul managed `kelion-proxy`, pornește containerul existent
   `kelion-caddy`, apoi verifică public aceeași versiune JSON.
6. Dacă proba publică nu trece, repornește proxy-ul managed și slotul nou;
   păstrează toate containerele și colectează diagnosticul. Nu folosi `rm`,
   `compose down --volumes`, prune sau ștergere de imagine în această procedură.

## Backup și migrări

`deploy/backup.sh`:

- creează un dump custom Postgres într-un container fără rețea;
- derivă separat cheia de criptare și cheia HMAC;
- verifică SHA/HMAC înainte de decriptare;
- restaurează complet într-un cluster temporar fără rețea;
- publică și sincronizează pe disc arhiva, manifestul și dovada înainte ca
  deploy-ul să poată arma migratorul distructiv;
- emite dovada de migrare legată de hashul backupului și identitatea DB;
- copiază off-host numai către un mount configurat explicit.

Pentru o migrare distructivă, `restore-verified-backup.sh --preflight` rulează
după backup și înaintea migratorului. El validează dovada/arhiva, lockurile,
clientul și serverul PostgreSQL 16, dreptul de `CREATEDB`/superuser, ownershipul,
absența bazelor scratch/quarantine și spațiul necesar, fără swap al bazei live.

Retenția se citește exclusiv din `PRIVACY_BACKUP_RETENTION_DAYS` din
`/root/kelion/config/runtime.env`. Scripturile persistente sunt versionate în
`/opt/kelion-backup/releases`, iar timerul rulează numai selectorul `current`,
mutat atomic după smoke public. `kelion-backup.timer` rulează zilnic. La primul cutover, crontabul root
integral este salvat în runtime, apoi se elimină numai linia legacy exactă. Dacă
timerul nu este enabled, activ sau nu are următoarea rulare, rollbackul automat
restaurează selectorul `current`, unitățile și starea timerului anterioare,
crontabul root byte-identic și markerul anterior. Snapshotul root-only rămâne
disponibil dacă restaurarea nu poate fi confirmată fail-closed.

Cheia master și backupul nu constituie disaster recovery dacă rămân pe aceeași
gazdă. Configurează și testează o destinație off-host înainte de producție.
Dovada unei migrări distructive se consumă la release; nu se reutilizează.

## Constructorul izolat cu modelul aprobat

Constructorul folosește OpenCode `1.18.25` și configurația unică
`deploy/opencode-constructor.json`: Big Pickle, prin endpointul anonim
OpenCode aprobat de owner. Modelul este gratuit în perioada anunțată de
furnizor; nu există garanție de gratuitate permanentă sau disponibilitate
24/7. Nu se configurează chei AI, conturi, plăți ori fallback-uri.

Pe VPS-ul existent, upgrade-ul de mai jos înlocuiește generația locală
retrasă. Binarul OpenCode fixat prin versiune și SHA-256 este o precondiție;
installerul nu descarcă și nu repornește modele locale. Workflow-urile de
instalare/probare a modelelor locale sunt retrase.

1. Folosește numai checkoutul exact verificat din master și operația canonică
   `upgrade-constructor` din `vps-run.yml`.
2. Installerul verifică binarul și configurația prin același validator folosit
   de controller, apoi păstrează intentul durabil, lockul de publicare,
   quiesce-ul, receipturile și recuperarea generației.
3. Sunt revocate regulile sudo full-host și este retras drop-inul web
   privilegiat. Serviciile locale LLM și web sunt oprite și dezactivate.
   Datele istorice ale joburilor nu sunt rescrise.
4. Supervisorul `kelion-codex` citește configurația root-owned și primește
   numai HMAC-ul cozii prin `LoadCredential`. AI-ul rulează într-un container
   Podman rootless cu imaginea gate fixată prin digest, fără pull implicit.
   Numai copia de cod a jobului este inscriptibilă; configurația, ordinul și
   fișierul `.git` sunt read-only. Clona Git comună, secretele, baza de date,
   alte joburi și socketurile hostului nu sunt montate.
5. Runtime-ul OCI este calea verificată `/usr/bin/crun`, din pachetul oficial
   al distribuției. Containerele rootless folosesc `--cgroups=disabled`; limitele
   reale de CPU, memorie și procese sunt impuse și moștenite din unitățile
   systemd ale workerului/publisherului. Nu se schimbă runtime-ul global Podman.
   Rețeaua executorului
   este IPv4 izolată; adresele providerului vin din DNS la fiecare invocare,
   fără modificarea resolverului hostului.
6. Controllerul dovedește configurația, binarul și disponibilitatea modelului
   din catalog fără inferență. Acest status nu dovedește rezolvarea unui ordin.
   Admin afișează modelul din configurația validată, nu un selector 35B/122B.
7. Un ordin este acceptat numai prin aceeași coadă și trece porțile independente,
   publisherul, PR-ul protejat și release-ul. Progresul vine din evenimente
   reale și etape confirmate; 100% cere commitul publicat și versiunea live.
8. Un timeout sau eșec de provider rămâne un eșec explicit, nu schimbare automată
   de model, succes inventat sau reexecuție nelimitată. O reluare manuală
   pornește un ciclu nou, păstrând dovada ciclului anterior.

`private-ai-status-proof.yml` este o verificare read-only a generației
instalate. `private-ai-constructor-proof.yml` cere dovada unei finalizări reale
până la commitul live; nu creează, revendică sau publică un ordin pentru a
inventa o probă. Niciunul nu este alternativă la testul vizibil în browser.

Doctorul permanent este o cerință separată, încă neactivată. El trebuie să
trimită reparații punctuale prin acest lanț, cu deduplicare persistentă,
control administrativ revocabil și verificarea rezultatului pe live, fără
să expună acest worker utilizatorilor obișnuiți.

## Instalarea publisherului și a dispatcherului de release

Lanțul host-only are trei identități Unix și trei domenii HMAC distincte:

1. `kelion-codex` (supervisorul OpenCode izolat) scrie numai handofful
   `patch.diff` plus receiptul imuabil în
   `/var/lib/kelion-constructor-handoff/ready` și raportează `gates_passed`;
2. `kelion-publisher` citește spool-ul, recreează commitul într-o clonă proprie,
   reexecută imaginea offline de porți, împinge numai ramura
   `codex/<task-uuid>`, deschide PR-ul și cere merge numai după controalele
   obligatorii;
3. `kelion-release` citește numai receiptul merge din API și poate dispatcha
   `deploy.yml` pentru acel SHA. Nu are Git, SSH, credentiale VPS ori acces la
   spool.

Aceasta este limita unică de reluare: numai publication, CI și release pot
continua idempotent după lease expirat, restart sau eșec recuperabil, exclusiv
pe același handoff imuabil și același commit/SHA. Receiptul, request ID-ul și
payloadul trebuie să coincidă; un payload ori commit diferit este o operație
nouă și este refuzat sub identitatea veche. Reluarea downstream poate reverifica
porțile și efectele, dar nu invocă workerul/modelul și nu reexecută ordinul.

Rulează installerul numai din checkoutul exact care urmează să fie instalat:

```bash
KELION_CONSTRUCTOR_INSTALL=1 bash deploy/instaleaza-constructor.sh
```

Installerul creează userii/directoarele, copiază codul root-owned și verifică
unitățile, dar șterge markerii de activare și nu creează config, clone sau
credentiale. Nu activează și nu pornește niciun timer. Pregătește separat:

- clona publică fără credentiale a workerului la
  `/var/lib/kelion-codex/repo`, owner `kelion-codex:kelion-codex`;
- clona publisherului la `/var/lib/kelion-publisher/repo`, owner
  `kelion-publisher:kelion-publisher`, cu remote exact
  `https://github.com/<repo>.git` și fără credential helper/config global;
- cele trei fișiere de config din exemplele `deploy/*constructor*.env.example`
  și `deploy/codex-worker.env.example`, root-owned mode `0600`;
- HMAC-urile cozii în `/root/kelion/secrets`, provisionate prin contractul
  runtime. Fiecare serviciu primește numai HMAC-ul domeniului său prin
  `LoadCredential`;
- tokenul de sync al workerului, tokenul publisher în
  `/root/kelion/publisher-secrets/github-publisher-token` și tokenul dispatcher
  în `/root/kelion/release-secrets/github-release-token`, root-owned și
  expuse numai grupului serviciului prin mode `0440`. PAT-ul classic separat,
  cu scope exclusiv `read:packages`, pentru gate rămâne root-only mode `0400` în
  `/root/kelion/gate-secrets/github-ghcr-read-token`. Niciuna dintre aceste
  credentiale nu intră în runtime.env, compose sau containerul web;
- tokenul OAuth de review al consolei Admin este un secret separat, montat
  exclusiv în backend la `/run/secrets/github-release-oauth-token`. Nu este
  încărcat de worker, publisher sau dispatcher.
- cheia ED25519 necriptată a identității automate de semnare exclusiv în
  `/root/kelion/publisher-secrets/github-publisher-signing-key`, root-owned mode
  `0400`. Înregistrează cheia publică drept **signing key** pe identitatea
  publisherului, verifică fingerprintul SHA-256 prin canal separat și pune
  numai fingerprintul în configul non-secret. Cheia nu este cheie SSH de acces
  la repository și nu este primită de worker ori dispatcher.

### Upgrade in-place al Constructorului instalat

După bootstrap, codul și unitățile Constructorului se actualizează numai din
workflow-ul `vps-constructor-control`, cu operația separată
`upgrade-constructor`. Înainte de dispatch, rulează `constructor-status`, reține
vectorul complet și cere una dintre stările canonice `000`, `100`, `110` sau
`111`: pentru fiecare componentă, markerul și timerul enabled/active trebuie să
fie aliniate, serviciile oneshot inactive și lista joburilor systemd goală.

Prima execuție acceptă exclusiv bundle-ul urmărit din vârful curent `master`,
dovada build-ului gate, release proof-ul și markerul activ pentru exact același
SHA, plus pinul ed25519 al gazdei.
Către VPS nu trimite config, HMAC-uri, tokenuri GitHub ori chei OpenAI.
Constructorul nu consumă o cheie AI. Nu reinstalează `apt`, `npm` sau CLI-ul și
nu regenerează configul ori secretele. Reface tranzacțional numai configul
workerului din copia live byte-identică; nu include `runtime.env`, nu recreează
și nu restartează backendul.

Înainte de prima oprire, helperul capturează durabil markerii și starea
enabled/active a celor trei timere. Installerul publică generația nouă cu toate
unitățile quiesced, iar cutover-ul strict restaurează exact vectorul capturat
în markeri, dar păstrează ready absent și toate unitățile oprite. Numai după
dovada completă scrie și sincronizează faza exterioară `committed`; finalizerul
poate publica ready și porni timerele abia după acel prag durabil. Un crash după
primul start păstrează `committed`, iar reluarea aceleiași instalări de release,
pentru același commit pin-uit, quiesce-uiește înainte să restaureze idempotent
vectorul și să șteargă jurnalul. Această reluare nu repornește workerul/modelul/
ordinul. La crash, reia operația fără să modifici starea VPS. Selectorul
read-only acceptă SHA-ul vechi numai din jurnalul root-only
strict, dacă acel commit există, este strămoș al noului `master`, iar release-ul
live a rămas exact pe acel SHA; fără jurnal, orice SHA diferit de vârful
`master` este refuzat. Nu porni manual timere și nu
șterge `constructor-upgrade.journal`, directoarele `constructor-upgrade.*` sau
`constructor-unit-migration.pending`. Avansarea `master` nu rescrie și nu
suprascrie jurnalul: rerun-ul sau redispatchul aceluiași request de release
selectează determinist commitul pin-uit, iar un jurnal invalid, symlink ori cu
SHA neînrudit este refuzat.

Acceptă upgrade-ul numai dacă evenimentul final este
`constructor_upgrade_complete`, apoi rulează `constructor-status` și cere
vectorul pre-upgrade exact, plus `opencode-qwen-local=ready|required`. Dacă preflight-ul raportează
o stare necanonică ori alt recovery activ, diagnostichează read-only; nu folosi
`configure-constructor`, deoarece reprovisionează configul și credentialele și
refuză un Constructor deja activ.

Credentiala publisherului are numai metadata read, Contents write, Pull
requests write, Actions/Checks read și Administration **read-only** pe
repository-ul unic; ultimul scope este necesar exclusiv pentru verificarea
branch protection și nu permite schimbarea ei. Nu are environments ori secrets.
Credentiala dispatcherului are numai metadata, Contents și Pull requests read,
plus Actions read/write; nu are Contents write sau acces VPS. Branch protection
pentru `master` trebuie să impună reviews, controalele
nominalizate în strict mode, cel puțin o aprobare, respingerea aprobărilor stale,
rezolvarea conversațiilor, istoric liniar și commituri semnate; force-push și
deletion sunt interzise inclusiv administratorilor. Publisherul citește și
validează toate aceste proprietăți înainte de push și verifică local semnătura
commitului înainte să trimită ramura.

Porțile de activare sunt cumulative și rămân implicit absente/zero:

1. aplică migrarea `constructor_publication_pipeline` și confirmă readiness;
2. verifică în staging HMAC-urile separate, expirarea/reînnoirea lease-urilor,
   retry-ul limitat la trei numai pentru publication/CI/release și replay-ul
   nonce după restart, mereu pe același handoff/commit;
3. setează flagurile backend `CONSTRUCTOR_PUBLISHER_ENABLED=1` și
   `CONSTRUCTOR_RELEASE_ENABLED=1`, apoi flagurile host
   `*_EXEC_ENABLED=1`;
4. creează markerul publisherului și pornește numai timerul publisher;
5. după un PR real auditat și un merge verde, creează markerul dispatcherului și
   pornește timerul release.

Un crash eliberează lease-ul după 120 de secunde; receipturile identice pentru
același handoff/commit sunt idempotente, iar un payload diferit este refuzat.
După trei încercări eșuate, etapa de publication/CI/release se oprește factual
și cere intervenție admin, nu ocolirea porților; contorul nu autorizează vreodată
reexecuția workerului/modelului/ordinului. La incident, șterge markerul exact și
oprește timerul aferent; nu șterge receipturi, ramuri sau runs până la triere.
Revocă doar credentiala identității afectate. Restartul aplicației nu redeschide
replay-ul: nonce-urile sunt durabile în `constructor_service_nonces` și
expiratele sunt curățate de API.

## Rotație și eliminarea secretelor legacy

Înainte de cutover se revocă la furnizor cheile AI retrase, tokenurile GitHub
legacy, parolele VPS/root, credentialele bancare vechi, certificatele mobile
copiate în env și orice cheie găsită în istoricul Git. PAN/CVC se înlocuiesc, nu
se mută într-un alt secret store. `OPENAI_ADMIN_KEY` este o credentială minimă
distinctă, montată numai în backendul Kelion Admin pentru Costs/Usage și
diagnostic de control-plane. Rămâne absentă din inferență, Realtime, media,
Constructor, browser, răspunsuri API și loguri; nu poate înlocui
`openai-project-key`.

Rotația externă cere autoritate explicită și probă pe fiecare integrare.
Ștergerea unui fișier sau a unui run GitHub nu înlocuiește revocarea.

Scanarea manuală `secret-scan` rulează și Gitleaks pe toate commiturile, cu
output redactat. Baseline-ul istoric cunoscut se clasifică astfel, fără a
allowlista aceste căi în scanarea istoriei:

- `backend/src/envCheck.test.ts` și `backend/src/secrete.test.ts`: fixture-uri
  sintetice; se păstrează doar clasificarea, nu valorile;
- `bridge/UNELTELE-LUI-KELION.md`, `KELION-ORDIN-URGENT.md` și versiunea veche
  `backend/src/index.ts`: materiale operaționale/bridge tratate ca secrete reale
  compromise, care cer revocare la furnizor.

Rescrierea istoriei este o operațiune separată, coordonată, după rotație și o
clonă de siguranță. Nu se face force-push în cadrul unui audit sau release.

## Confidențialitate și CSP

Migrările destructive de minimizare se aplică numai după backupul restaurat și
planul checksum-uit. Curățarea datelor de producție nu se face la boot. Caddy nu
păstrează access logs; țara aproximativă poate veni numai din headerul
Cloudflare acceptat de la proxy-urile de încredere și sanitizat.

CSP este enforced. `script-src` acceptă numai bundle-ul same-origin,
`wasm-unsafe-eval` pentru runtime-ul offline și hashul exact al JSON-LD-ului;
nu acceptă `unsafe-inline`, `blob:` sau CDN-uri de script. `connect-src` acceptă
API/WS same-origin și sursele pin-uite Hugging Face/GitHub ale kitului offline.
OpenAI rămâne server-side și nu este un origin browser permis. `worker-src`
acceptă same-origin plus blob workers; `style-src unsafe-inline` rămâne temporar
necesar pentru style props. COEP rămâne oprit fiindcă ar bloca resursele de model
care au CORS, dar nu toate au CORP. Orice schimbare a JSON-LD-ului cere
recalcularea hashului și testele Caddy înainte de release.
