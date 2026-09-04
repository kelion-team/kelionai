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
Admin. Niciuna nu ajunge în Constructor. Workerul execută OpenCode 1.18.25
numai prin endpointul loopback llama.cpp, cu profilul FAST implicit
(Qwen3.6-35B-A3B) sau profilul POWERFUL (Qwen3.5-122B-A10B), selectat exclusiv
manual de owner din Admin.

### Profilurile locale Constructor

FAST este profilul implicit și starea obligatorie după instalare și după boot
sau reboot. În exploatarea normală, POWERFUL poate fi activat exclusiv printr-o
cerere manuală din Admin. Workerul, backendul și interfața nu schimbă profilul
și nu reexecută automat un ordin.

O recomandare de comutare manuală la POWERFUL este emisă numai pentru un
rezultat FAST `unresolved` real, validat de worker. O eroare
`technical_failure` nu recomandă alt model. Un rezultat POWERFUL `unresolved`
este terminal pentru ordin și nu produce recomandare, comutare sau reluare.

Comutarea este serializată și păstrează exact un singur model servit și mapat
de procesul `llama-server`; ambele GGUF-uri rămân instalate pe disc, dar nu sunt
încărcate simultan ca două modele active în RAM. Profilul POWERFUL este numai un
override de runtime; configurația persistentă rămâne FAST, astfel încât orice
boot sau reboot normalizează runtime-ul la FAST.

Constructorul are trei servicii host-only separate. Web-ul deține coada și câte
un verificator HMAC per domeniu; nu primește cheie AI, token Git sau shell.
Supervisorul neprivilegiat revendică ordinul HMAC și îl scrie într-un worktree
dedicat. Numai executorul OpenCode local este pornit explicit prin `sudo` root,
cu config fixat la unicul provider `llama.cpp`; accesul complet la host este
intenționat și verificat prin regula sudoers versionată. Lease-ul, timeoutul,
porțile și handofful `gates_passed` rămân controlate de worker.
Installerul permanent publică atomic configul, comutatorul de model și
instrucțiunile din
`deploy/opencode-constructor.json` și
`deploy/opencode-constructor-instructions.md`; configure și upgrade le compară
byte-identic și refuză orice provider extern, `apiKey` sau permisiune restrânsă.
Pentru instalarea dual-model, validarea controlată pornește și probează
model-list plus inferența pe POWERFUL, revine la FAST, probează model-list plus
inferența pe FAST și finalizează numai cu FAST activ și verificat. Validarea nu
declară instalarea reușită dacă revenirea la FAST sau invariantul unui singur
model activ nu pot fi dovedite.
Publisherul are credentiala GitHub minimă, dar nu are OpenCode/root/VPS; dispatcherul
are numai permisiune Actions pentru commituri deja merged, fără Git/VPS.
Flagurile, markerii și timerele celor trei identități rămân implicit oprite.

Interfața OpenCode nu este intake-ul cozii. Chatul Kelion și clientul desktop
Constructor creează aceleași joburi validate prin backend, iar workerul unic le
revendică din aceeași coadă. Statusul public este numai `setup_required`,
`ready`, `busy` sau `degraded`, fără secrete ori output brut al executorului.
