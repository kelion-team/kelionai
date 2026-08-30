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

1. Confirmă că SHA-ul integral este vârful `master`, `pr-verify` este verde și
   `build-images` a produs manifestul semnat pentru același SHA.
2. După verificarea dovezilor, rulează manual `production-release`, cu
   `release_mode=release`, în mediul `production`.
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

## Activarea workerului Codex pentru un singur admin

Workerul actual automatizează joburi locale, deci folosește CLI-ul
non-interactiv; App Server este destinat clienților bogați cu auth, istoric,
aprobări și evenimente și nu se publică pe web. Dacă va exista un control-plane
local App Server, transportul acceptat este numai `stdio` sau Unix socket în
același boundary host-only, nu WebSocket public.

1. Instalează pachetul oficial `@openai/codex` la versiunea exactă cerută de
   `deploy/codex-worker.mjs`. Nu folosi `curl | bash`. Verifică
   `codex --version`, `codex exec --help` și `codex app-server --help` înainte de
   instalarea unității.
2. Creează utilizatorul și grupul neprivilegiate `kelion-codex`. Directoarele de
   lucru sunt `/var/lib/kelion-codex`; cache-ul de autentificare separat este
   `/var/lib/kelion-codex-auth`. Niciunul nu este montat în containerul web.
3. Instalează `deploy/codex-worker.profile.toml` ca
   `/opt/kelion-codex/profile-home/kelion-worker.config.toml`, root-owned și
   read-only. Auth home conține numai starea gestionată de CLI. Profilul impune
   `forced_login_method="api"`, `approval_policy="never"`, env allowlist și
   rețea oprită pentru comenzile generate.
4. Sursa canonică rămâne `/root/kelion/secrets/openai-project-key`, cu metadata
   `0:10050:0440`. Unitatea workerului o primește numai prin
   `LoadCredential=openai-project-key:...`; valoarea nu intră în environment,
   argv sau jurnal. La prima pornire, la rotația cheii ori dacă statusul
   cache-ului eșuează, workerul execută echivalentul sigur:

   ```bash
   /opt/kelion-codex/bin/codex \
     -c 'forced_login_method="api"' \
     -c 'cli_auth_credentials_store="file"' \
     login --with-api-key \
     < "$CREDENTIALS_DIRECTORY/openai-project-key"
   ```

   Redirecționarea este pe stdin; nu folosi `printenv`, pipe din `cat`,
   substituție de comandă, `set -x`, `--with-access-token`, device-auth sau
   login ChatGPT. Workflow-ul `vps-codex-login.yml` poate reînnoi manual același
   cache fără ca GitHub Actions să primească vreodată cheia OpenAI.
5. Workerul verifică statusul cu aceleași două override-uri `-c`, plasate
   înainte de `login status`, și publică atomic, cu mod `0600` și
   `fsync`, numai fingerprintul SHA-256 privat din auth home. Fișierele
   `auth.json` și `.openai-project-key.sha256` rămân accesibile exclusiv
   identității workerului; fingerprintul evită relogarea la fiecare minut.
6. Creează configul dedicat din `deploy/codex-worker.env.example`; el conține
   numai flagul, API-ul loopback, repository-ul public și digestul imaginii de
   porți. HMAC-ul cozii intră exclusiv prin `LoadCredential`.
7. Instalează unitatea și timerul cu markerul de condiție absent. Rulează
   `node deploy/codex-worker.mjs --self-test`. Pentru preflightul Linux sunt
   obligatorii CLI-ul și profilul root-owned, bubblewrap, Podman rootless,
   clona fără credentiale, imaginea gate cu același commit și probele
   adversariale pentru auth home, credentiale, `/tmp`, localhost și rețea.
8. Activează în această ordine numai după probe: flagul backend, flagul
   `CODEX_WORKER_EXEC_ENABLED=1`, markerul
   `/etc/kelion/codex-worker.enabled`, apoi timerul. Orice lipsă raportează
   `setup_required`; nu există fallback la ChatGPT/device-auth sau la alt
   furnizor.

Workerul se oprește la `gates_passed`. Nu are credential Git, push, PR, merge
sau deploy.

## Instalarea publisherului și a dispatcherului de release

Lanțul host-only are trei identități Unix și trei domenii HMAC distincte:

1. `kelion-codex` scrie numai handofful `patch.diff` plus receiptul imuabil în
   `/var/lib/kelion-constructor-handoff/ready` și raportează `gates_passed`;
2. `kelion-publisher` citește spool-ul, recreează commitul într-o clonă proprie,
   reexecută imaginea offline de porți, împinge numai ramura
   `codex/<task-uuid>`, deschide PR-ul și cere merge numai după controalele
   obligatorii;
3. `kelion-release` citește numai receiptul merge din API și poate dispatcha
   `deploy.yml` pentru acel SHA. Nu are Git, SSH, credentiale VPS ori acces la
   spool.

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
Către VPS nu trimite config, HMAC-uri, tokenuri GitHub ori
chei OpenAI. Nu reinstalează `apt`, `npm` sau CLI-ul și nu regenerează configul
ori secretele. Reface tranzacțional numai configul workerului din copia live
byte-identică; nu include `runtime.env`, nu recreează și nu restartează backendul.

Înainte de prima oprire, helperul capturează durabil markerii și starea
enabled/active a celor trei timere. Installerul publică generația nouă cu toate
unitățile quiesced, iar cutover-ul strict restaurează exact vectorul capturat
numai după validarea generației. La crash, reia operația fără să modifici starea
VPS. Selectorul read-only acceptă SHA-ul vechi numai din jurnalul root-only
strict, dacă acel commit există, este strămoș al noului `master`, iar release-ul
live a rămas exact pe acel SHA; fără jurnal, orice SHA diferit de vârful
`master` este refuzat. Nu porni manual timere și nu
șterge `constructor-upgrade.journal`, directoarele `constructor-upgrade.*` sau
`constructor-unit-migration.pending`. Avansarea `master` nu rescrie și nu
suprascrie jurnalul: rerun-ul sau un nou dispatch selectează determinist commitul
pin-uit, iar un jurnal invalid, symlink ori cu SHA neînrudit este refuzat.

Acceptă upgrade-ul numai dacă evenimentul final este
`constructor_upgrade_complete`, apoi rulează `constructor-status` și cere
vectorul pre-upgrade exact, plus `codex-auth=ready`. Dacă preflight-ul raportează
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
   retry-ul limitat la trei și replay-ul nonce după restart;
3. setează flagurile backend `CONSTRUCTOR_PUBLISHER_ENABLED=1` și
   `CONSTRUCTOR_RELEASE_ENABLED=1`, apoi flagurile host
   `*_EXEC_ENABLED=1`;
4. creează markerul publisherului și pornește numai timerul publisher;
5. după un PR real auditat și un merge verde, creează markerul dispatcherului și
   pornește timerul release.

Un crash eliberează lease-ul după 120 de secunde; receipturile identice sunt
idempotente, iar un payload diferit este refuzat. După trei încercări eșuate
jobul se oprește factual și cere intervenție admin, nu ocolirea porților. La
incident, șterge markerul exact și oprește timerul aferent; nu șterge receipturi,
ramuri sau runs până la triere. Revocă doar credentiala identității afectate.
Restartul aplicației nu redeschide replay-ul: nonce-urile sunt durabile în
`constructor_service_nonces` și expiratele sunt curățate de API.

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
