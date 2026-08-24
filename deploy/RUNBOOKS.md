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

1. Configurează repository variables pentru toate intrările non-secrete din
   `config/runtime-contract.json` și repository secrets numai pentru intrările
   din `secretFiles`.
2. Păstrează `CODEX_WORKER_ENABLED=0`, `PAYMENT_MODE=disabled` și
   `PUSH_ENABLED=0` până când fiecare capabilitate are verificarea proprie.
3. Rulează manual `vps-set-env` în mediul aprobat. Workflow-ul validează
   allowlistul, scrie atomic `runtime.env` și secret files, dar nu repornește și
   nu publică nimic.
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

La primul cutover, rollback-ul pre-switch repornește containerele legacy
capturate și se bazează pe bridge-ul DB bidirecțional verificat. Nu porni un
workflow către un artefact vechi dacă migratorul raportează checksum
incompatibil: pregătește un fix forward sau execută o restaurare controlată din
backup după oprirea scrierilor. Nu modifica manual tabela de migrări.

### Revenire manuală la stackul legacy păstrat

Primul release nou oprește `kelionai-app`, `omniroute` și `kelionai-coqui` numai
după ce versiunea publică exactă și readiness-ul cu efecte active sunt verzi.
Containerele, imaginile și volumele nu sunt șterse. `kelion-caddy` este tratat
separat de comutarea proxy-ului.

Revenirea manuală este numai pentru incidentul în care workflow-ul de rollback
semnat nu mai poate rula:

1. Înregistrează read-only existența, imaginea și starea celor patru containere;
   oprește procedura dacă numele sau imaginile diferă de preflight.
2. Dezactivează efectele slotului nou prin markerul de release și confirmă că
   procesele managed s-au oprit înainte de a porni vechiul runtime.
3. Pornește, fără recreare, containerele existente `kelionai-coqui`,
   `omniroute` și `kelionai-app`; confirmă că sunt `running` și că aplicația
   legacy răspunde local.
4. Oprește proxy-ul managed `kelion-proxy`, pornește containerul existent
   `kelion-caddy`, apoi verifică public versiunea și endpointul de sănătate.
5. Dacă proba publică nu trece, repornește proxy-ul managed și slotul nou;
   păstrează toate containerele și colectează diagnosticul. Nu folosi `rm`,
   `compose down --volumes`, prune sau ștergere de imagine în această procedură.

## Backup și migrări

`deploy/backup.sh`:

- creează un dump custom Postgres într-un container fără rețea;
- derivă separat cheia de criptare și cheia HMAC;
- verifică SHA/HMAC înainte de decriptare;
- restaurează complet într-un cluster temporar fără rețea;
- emite dovada de migrare legată de hashul backupului și identitatea DB;
- copiază off-host numai către un mount configurat explicit.

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
   `forced_login_method="chatgpt"`, `approval_policy="never"`, env allowlist și
   rețea oprită pentru comenzile generate.
4. Ca utilizatorul workerului, rulează interactiv:

   ```bash
   CODEX_HOME=/var/lib/kelion-codex-auth /opt/kelion-codex/bin/codex login --device-auth
   ```

   Device-code trebuie întâi permis în setările ChatGPT/workspace. Linkul și
   codul one-time rămân în terminalul operatorului; nu se trimit backendului,
   browserului Kelion, GitHub Actions sau logurilor. Dacă device-code nu este
   disponibil, `codex login` folosește browserul și callbackul gestionat de CLI.
   Nu folosi `--with-api-key`, `--with-access-token` sau external auth tokens.
5. Verifică `codex login status`. Fișierul `auth.json`, când este folosit ca
   credential store, se tratează ca o parolă și rămâne accesibil numai
   identității workerului.
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
   `setup_required`; nu există fallback la OpenAI API.

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
- tokenul publisher în
  `/root/kelion/publisher-secrets/github-publisher-token` și tokenul dispatcher
  în `/root/kelion/release-secrets/github-release-token`, root-owned mode
  `0400`. Ele nu intră în runtime.env, compose sau containerul web.
- cheia ED25519 necriptată a identității automate de semnare exclusiv în
  `/root/kelion/publisher-secrets/github-publisher-signing-key`, root-owned mode
  `0400`. Înregistrează cheia publică drept **signing key** pe identitatea
  publisherului, verifică fingerprintul SHA-256 prin canal separat și pune
  numai fingerprintul în configul non-secret. Cheia nu este cheie SSH de acces
  la repository și nu este primită de worker ori dispatcher.

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
se mută într-un alt secret store. `OPENAI_ADMIN_KEY` rămâne absentă din aplicație
și Codex; dacă va exista reconciliere financiară, folosește un proces separat și
o credentială minimă.

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
