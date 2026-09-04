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

## Activarea workerului Constructor local OpenCode/Qwen pentru un singur admin

Workerul automatizează joburile cu OpenCode `1.18.25` și două profiluri locale,
servite numai pe loopback de llama.cpp: FAST folosește Qwen3.6-35B-A3B Q4_K_M
și este implicit, iar POWERFUL folosește Qwen3.5-122B-A10B Q4_K_M și se
selectează numai manual din Admin. Constructorul nu folosește cheie OpenAI,
login ChatGPT, provider AI cloud sau task extern.

1. Instalează mai întâi runtime-ul privat cu installerul Contabo versionat.
   Receiptul `/etc/private-ai/.install-complete` trebuie să fixeze OpenCode
   `1.18.25`, commitul llama.cpp și modelul FAST
   `ggml-org/Qwen3.6-35B-A3B-GGUF` Q4_K_M. Instalează apoi POWERFUL numai prin
   installerul versionat `.github/private-ai/upgrade-private-ai-max-model.sh`.
   Acesta probează model-list și inferența pe POWERFUL, revine explicit la FAST
   și probează model-list plus inferența pe FAST. Acceptă instalarea duală numai
   cu receipturile finale `/etc/private-ai/.max-model-sealed` și
   `/etc/private-ai/.max-model-complete`, ambele profile verificate și
   `active_profile=fast`. Nu folosi `curl | bash` și nu înlocui binarele,
   shardurile sau modelele în afara installerelor versionate.
   Activarea temporară POWERFUL este o excepție tehnică aprobată exclusiv pentru
   validarea installerului: nu este o decizie de profil, nu pornește workerul și
   nu execută ori reia un ordin. Orice ieșire acceptată dovedește din nou FAST.
2. Creează utilizatorul și grupul neprivilegiate `kelion-codex`. Numele Unix și
   căile `codex-worker` sunt identificatori legacy păstrați pentru
   compatibilitate; executorul este OpenCode. Repository-ul și starea joburilor
   sunt în `/var/lib/kelion-codex` și nu sunt montate în containerul web.
3. Instalează byte-identic `deploy/opencode-constructor.json` și
   `deploy/opencode-constructor-instructions.md` în
   `/srv/private-ai/home/.config/opencode/`, root-owned, grup `privateai` și
   read-only pentru proces. Configul permite exclusiv providerul `llama.cpp`,
   endpointul `http://127.0.0.1:24080/v1` și cele două modele locale fixate;
   `model` și `small_model` rămân
   `llama.cpp/qwen3.6-35b-a3b-local`. `apiKey`, autoupdate și sharing sunt
   interzise.
4. În starea implicită verifică `private-ai-llm.service` și
   `private-ai-web.service` active, `/health` sănătos și `/v1/models` cu exact
   aliasul FAST. PID-ul serviciului LLM trebuie să execute
   `/opt/private-ai/bin/llama-server` și să aibă mapat fișierul GGUF canonic de
   `20.419.565.568` bytes. Controllerul trebuie să raporteze ambele profile ca
   instalate, dar numai FAST ca activ.
5. Starea legacy de autentificare trebuie să fie absentă:
   `/var/lib/kelion-codex-auth`, `/opt/kelion-codex/profile-home` și orice
   wrapper Codex retras nu sunt precondiții și nu se recreează. Unitatea nu
   primește `openai-project-key`; Constructorul nu are nicio credentială AI.
6. Creează configul non-secret din `deploy/codex-worker.env.example`; el conține
   numai flagul, API-ul loopback, repository-ul public și digestul imaginii de
   porți. HMAC-ul cozii intră exclusiv prin `LoadCredential` și nu este o cheie
   de model.
7. Instalează regula sudoers versionată, unitatea și timerul cu markerul de
   condiție absent. Supervisorul rămâne `kelion-codex`, iar OpenCode este pornit
   explicit ca root prin `sudo -n`, cu acces full-host conform contractului
   Constructor. Rulează `node deploy/codex-worker.mjs --self-test`; preflightul
   verifică versiunea OpenCode, configul local, llama.cpp, modelul, regula sudo,
   clona, Podman rootless și imaginea gate fixată prin digest.
8. Activează în această ordine numai după probe: flagul backend,
   `CODEX_WORKER_EXEC_ENABLED=1`, markerul
   `/etc/kelion/codex-worker.enabled`, apoi timerul. Orice lipsă raportează
   `setup_required`; nu există fallback la Codex cloud, ChatGPT/device-auth sau
   alt furnizor AI.

Workerul se oprește la `gates_passed`. Nu are credential Git, push, PR, merge
sau deploy.

## Profilurile locale și comutarea manuală din Admin

| Profil Admin | Model local | Activare permisă | Stare implicită |
| --- | --- | --- | --- |
| FAST / Rapid (35B) | `qwen3.6-35b-a3b-local` | click explicit al ownerului în Admin | activ după instalare și după reboot |
| POWERFUL / Puternic (122B) | `qwen3.5-122b-a10b-local` | click explicit al ownerului în Admin | instalat pe disc, inactiv |

Ambele modele rămân instalate și verificate pe disc. Nu porni două servere LLM
și nu ține ambele GGUF-uri mapate simultan: un singur profil este servit de
`private-ai-llm.service` și mapat în procesul `llama-server`. Verificarea se face
pe PID-ul măsurat, aliasul din `/v1/models` și fișierul din `/proc/<PID>/maps`,
nu din numele unui drop-in. Page cache-ul kernelului nu este al doilea model
activ și nu constituie dovadă că două modele sunt servite.

Contractul de decizie este strict manual. După claim există zero retry automat
și zero reexecuție automată pentru worker, invocarea modelului și ordin,
indiferent dacă rezultatul este timeout, eroare tehnică sau `unresolved`:

- FAST este profilul implicit. Nici workerul, backendul, controllerul și nici
  interfața Admin nu aleg sau schimbă profilul fără intenția manuală a ownerului.
- Numai un rezultat terminal real `unresolved` pe FAST, cu motivul bounded
  `no_changes`, `test_failure` sau `quality_gate_failure`, afișează recomandarea
  exactă de a comuta manual la POWERFUL și apoi de a folosi explicit `Reia`.
  Recomandarea explică motivul, dar nu apasă butonul, nu trimite comanda de
  comutare și nu repune ordinul în coadă.
- Același rezultat `unresolved` pe POWERFUL este terminal pentru ciclul curent
  și nu recomandă `Reia` sau un model superior.
- `execution_timeout`, `brain_unavailable` și `worker_internal_failure` sunt
  erori tehnice. Ele se afișează separat și nu recomandă schimbarea modelului
  sau `Reia`, indiferent de profil. Nu interpreta o eroare tehnică drept
  insuficiență a modelului.
- Un rezultat nerezolvat sau eșuat rămâne terminal pentru ciclul curent. Dacă
  ownerul dorește altă încercare, după orice alegere manuală de profil folosește
  explicit `Reia`; aceasta pornește un `execution_cycle` nou și primește un task
  ID worker nou, fără să rescrie ori să continue ciclul terminal anterior.

Ordinea unei comutări aprobate de owner este:

1. În Admin, deschide cardul de control al modelului și confirmă starea
   `ready`, profilul activ măsurat și că FAST plus POWERFUL sunt instalate. Dacă
   starea este `switching`, `failed` sau `unavailable`, nu trimite altă comandă;
   diagnostichează read-only.
2. Apasă explicit butonul profilului ales. Nu rula direct
   `/opt/private-ai/bin/constructor-model-switch` și nu edita drop-in-uri
   systemd; Admin este sursa intenției manuale și păstrează request ID-ul
   auditat.
3. Controllerul persistă request ID-ul și ținta intenției manuale acceptate,
   serializează operația cu workerul, capturează și oprește temporar timerul
   acestuia, validează receipturile/modelul țintă, schimbă unicul `llama-server`,
   verifică aliasul și maparea GGUF, apoi restaurează exact starea timerului.
   Admin afișează `switching` pe durata operației.
4. Continuă numai după ce Admin revine la `ready` și arată profilul/modelul
   cerut. Abia apoi ownerul poate decide separat `Reia`, care pornește un
   `execution_cycle` și un task ID worker noi; ciclul anterior rămâne terminal.
5. Dacă o comandă POWERFUL eșuează în timpul activării, helperul restaurează
   FAST ca rollback tehnic al aceleiași comenzi. Aceasta nu este escaladare
   automată și nu reexecută niciun ordin. Dacă restaurarea nu poate fi dovedită,
   starea rămâne fail-closed și cere diagnostic read-only.
6. Pentru revenire normală, ownerul apasă explicit FAST în Admin și așteaptă
   din nou `ready`. După un reboot, serviciul pornește canonic FAST și nu
   restaurează automat un profil POWERFUL selectat anterior. Singura excepție:
   dacă restartul a întrerupt o operație de comutare deja acceptată și persistată,
   controllerul poate continua exact aceeași intenție manuală, cu același
   request ID și aceeași țintă. Nu deduce o țintă, nu creează o comutare nouă și
   nu reexecută workerul/modelul/ordinul. Fără receiptul valid al intenției
   acceptate rămâne FAST și cere un click nou. După boot, verifică profilul în
   Admin înainte de a decide un nou `execution_cycle` prin `Reia`.

## Instalarea publisherului și a dispatcherului de release

Lanțul host-only are trei identități Unix și trei domenii HMAC distincte:

1. `kelion-codex` (supervisorul OpenCode local) scrie numai handofful
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
