# Contractul de producție KelionAI

Producția se publică numai dintr-un commit integral din `master` care are
`pr-verify` verde și imagini OCI construite din același commit, fixate prin
digest și semnate keyless. `release-dispatch` pornește automat workflow-ul
auditat `production-release` numai după CI și build verzi pentru vârful exact
din `master`; mutatorul rulează în mediul GitHub `production`. Nu există cron
care urmărește și publică un `master` mobil.

Dispatcherul generic cere exact un PR merged canonic asociat commitului. Pentru
un PR obișnuit, request ID-ul este determinist din repository/SHA/CI, iar
rerularea buildului pentru același CI rămâne idempotentă; dispatcherul cere
separat un singur build canonic verde și un singur artefact valid. Pentru un PR Constructor canonic,
dispatcherul generic nu emite request: ownership-ul rămâne la lanțul Constructor.
Orice asociere ambiguă sau marker Constructor incomplet se blochează fail-closed.
De la merge-ul unui pilot Constructor până la starea terminală a deploy-ului
acelui SHA, `master` rămâne obligatoriu înghețat și nu se lansează un request
generic/manual concurent.

## Surse de adevăr

- `config/product.json`: identitatea și originile first-party;
- `config/runtime-contract.json`: clasificarea configului și a secretelor;
- `deploy/compose.production.yml`: limitele containerelor și mounturile exacte;
- `deploy/deploy.sh`: planul de migrare, backupul, blue-green și rollbackul;
- `.github/workflows/pr-verify.yml`, `build-images.yml` și `deploy.yml`: lanțul
  CI, artefact și aprobare.

`vps-set-env` stagează configul non-secret allowlisted și secretele individuale,
oprește toate unitățile Constructor, apoi le comite ca o singură generație cu
rollback verificat. Slotul activ este recreat din aceleași imagini fixate prin
digest, astfel încât `env_file` și bind mounturile să fie reîncărcate înainte de
reactivarea timerelor. Directorul aplicației este `root:10050` mode `0750`, iar
fișierele sunt `root:10050` mode `0440`. Tokenul GHCR gate rămâne separat,
root-only mode `0400`; tokenul OAuth Admin este montat numai în backend.
Containerul web nu montează repository-ul sau `/root/kelion`.

## Fluxul unui release

1. `pr-verify` rulează porțile backend, frontend, migrări, secrete, containere și
   inventar atât pe PR, cât și pe commitul îmbinat în `master`.
2. `build-images` acceptă numai un run `push` verde pe `master`, construiește
   imaginile din SHA-ul exact, le publică prin digest și emite manifestul
   semnat.
3. `release-dispatch` verifică PR-ul asociat și buildul verde pentru vârful
   curent din `master`. Pentru un PR obișnuit lansează `production-release` cu
   request ID-ul generic determinist; pentru un PR Constructor valid cedează
   ownership-ul fără dispatch. Workflow-ul de deploy cere SHA integral, rulează
   în mediul `production` și verifică runul CI, runul de build, manifestul și
   semnăturile înainte de SSH. Verificatorul acceptă numai identitatea exactă și
   o singură reușită al cărei job `release` este verde.
4. `deploy.sh` planifică migrările și capturează slotul, proxy-ul, upstreamul,
   markerul, containerele și Caddyfile-ul înainte de orice mutație DB. Pentru o
   migrare distructivă pune proxy-ul managed în maintenance 503; la primul
   cutover păstrează `kelion-caddy` și obține 502 fail-closed prin oprirea
   writerului legacy. Abia apoi creează un backup autentificat, verificat prin
   restaurare integrală într-un Postgres temporar fără rețea și sincronizat pe
   disc împreună cu manifestul/dovada înainte de jurnalul migratorului. Înaintea
   migratorului, helperul de recovery validează autentificat arhiva, FD-urile de
   lock, PostgreSQL 16, rolul/ownershipul DB și spațiul pentru swap, fără să
   schimbe baza live. Migrarea cere dovada HMAC legată de backup și baza exactă.
   Scriptul este instalat într-un release persistent din `/opt/kelion-backup`;
   după smoke-ul public, selectorul `current` este mutat atomic, iar release-ul
   verifică și activează service-ul/timerul systemd versionate. Numai apoi
   retrage linia cron legacy exactă, după salvarea crontabului root. Selectorul,
   unitățile, starea timerului, markerul și crontabul sunt capturate înainte de
   mutație și restaurate dacă orice etapă ulterioară a release-ului eșuează.
5. Slotul inactiv pornește cu efectele singleton dezactivate. `/readyz` trebuie
   să confirme DB, registrul migrărilor și workerii browser/converter, iar
   `/api/version` trebuie să fie commitul candidat.
6. Caddy validează configurația, upstreamul este schimbat atomic, apoi markerul
   activează efectele candidatului. Smoke-ul public verifică din nou versiunea
   și readiness înainte ca slotul vechi să fie oprit.
7. Înainte ca upstreamul candidatului să poată deveni public, orice eșec oprește
   candidatul, restaurează backupul verificat și contractul DB, apoi repornește
   runtime-ul vechi și restaurează Caddyfile-ul/upstreamul. În clipa expunerii
   posibile, faza și point-of-no-return sunt publicate atomic și sincronizate în
   jurnalul root-only `destructive-cutover-recovery.json`; un eșec ulterior nu mai aplică
   snapshotul și nu mai pornește writerul vechi, deoarece ar putea pierde
   scrieri noi. Candidatul, DB-ul și proxy-ul rămân nemodificate pentru
   intervenție fail-closed/fix-forward; numai schedulerul de backup își poate
   restaura independent snapshotul. Rollbackul se dezarmează numai după ce
   `/api/version` public confirmă repetat versiunea veche exactă.

Rollbackul folosește același workflow, numai către un artefact semnat al unui
commit din istoricul `master`. Runnerul de migrări refuză versiuni/checksumuri
necunoscute; un rollback incompatibil cu schema se oprește înainte de trafic.

La primul cutover, revenirea înainte de point-of-no-return folosește numai
containerele legacy capturate, `/api/version` JSON exact și dovada restaurării
DB. Un
workflow către un artefact al cărui checksum de migrare diferă este blocat
intenționat; recuperarea este un fix forward sau o restaurare controlată din
backup, nu o rescriere a istoricului migrărilor.

## Readiness și limite de proces

- `/livez` dovedește numai că procesul răspunde;
- `/readyz` este poarta de cutover și nu se înlocuiește cu `/health`;
- `/api/version` leagă runtime-ul de SHA-ul aprobat;
- aplicația, browserul, convertorul și Caddy rulează non-root, cu rootfs
  read-only, capabilități eliminate, `no-new-privileges`, limite de PID/RAM/CPU
  și fără `network_mode: host`;
- browserul ajunge la internet numai prin proxy-ul care fixează DNS și refuză
  adrese private/rezervate la fiecare hop; parserul de documente nu are rețea.

CSP este impus de Caddy; o politică report-only opțională poate fi mai strictă,
dar nu înlocuiește enforcementul. Testele de release verifică loginul Google în
browserul de sistem, media, workers, WebGL/wasm, modelele offline și embedurile
allowlisted. Access logul Caddy rămâne oprit; raportarea CSP nu stochează IP sau
payload personal brut.

## Separarea OpenAI și Constructor

Fișierul `openai-project-key` conține unica cheie project-scoped de inferență.
Backendul o montează read-only numai pentru funcțiile OpenAI ale clienților.
`OPENAI_ADMIN_KEY` este distinctă și poate fi montată numai în backendul
Admin. Niciuna nu ajunge în Constructor. Configurația canonică
`deploy/opencode-constructor.json` selectează exclusiv OpenCode 1.18.25 și
`opencode-free/big-pickle`, prin endpointul anonim aprobat de owner
`https://opencode.ai/inference/openai/v1`. Nu folosește autentificare OpenAI,
chei API sau fallback plătit. Gratuitatea și disponibilitatea furnizorului nu
sunt garanții permanente.

### Executorul izolat și verificarea disponibilității

Workerul, publisherul și release-ul sunt identități host-only separate, cu
autentificare HMAC per domeniu. Aplicația web deține coada, dar nu primește
credențialele Git/VPS sau acces shell. Workerul revendică un ordin într-un
worktree dedicat și păstrează controlul lease-ului, jurnalului, porților și
handoffului `gates_passed`.

OpenCode execută numai în container rootless, prin Podman și `crun`, cu o
copie de lucru a codului și tmpfs privat deținut de utilizatorul workerului.
Executorul nu primește sudo pe host, baza de date, secrete, socketuri sau
credențiale Git/VPS. Accesul furnizorului folosește IPv4 în sandbox; gate-ul
separat rulează fără rețea. Unitățile systemd limitează workerul și publisherul
la 6 GiB, CPU 200% și 512 procese, inclusiv containerele lor. Aceste limite nu
reprezintă o promisiune de durată sau de finalizare a unei reparații.

Upgrade-ul canonic este operația `upgrade-constructor` din `vps-run.yml`, care
apelează `deploy/upgrade-constructor.sh` și `deploy/instaleaza-constructor.sh`.
Installerul verifică binarul OpenCode fixat prin versiune și SHA-256, apoi
publică și compară byte-identic configurația, instrucțiunile, controllerul și
unitățile versionate. Retrage regulile sudo de acces complet și oprește/dezactivează
runtime-ul local și interfața web veche. Reactivarea trece prin jurnalele,
lockurile, markerii și barierele de recovery existente; nu se fabrică un marker
ready și nu se pornesc manual timerele pentru a ocoli o etapă eșuată.

Controllerul validează configurația anonimă și binarul instalat, apoi citește
catalogul furnizorului printr-o cerere limitată, fără inferență. Un catalog valid
dovedește numai disponibilitatea măsurată pentru preflight, nu executarea unui
ordin. Selectorul de modele locale este retras; `fast` rămâne numai ID intern
de compatibilitate și nu identifică modelul unei rulări istorice. Nu există
comutare automată sau manuală la un al doilea model.

Publisherul separat are credențiala GitHub minimă, dar nu rulează OpenCode și
nu primește root/VPS. Release-ul urmărește numai commituri deja merged și
publică prin aceeași conductă protejată descrisă mai sus. Testele, PR-ul sau
starea ready nu înlocuiesc dovada finală: jobul, receipturile, commitul aprobat
și versiunea live trebuie să corespundă aceluiași ordin.

Interfața OpenCode nu este intake-ul cozii. Chatul Kelion și clientul desktop
Constructor creează aceleași joburi validate prin backend, iar workerul unic le
revendică din aceeași coadă. Statusul public este numai `setup_required`,
`ready`, `busy` sau `degraded`, fără secrete ori output brut al executorului.
