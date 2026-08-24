# Contractul de producție KelionAI

Producția se publică numai dintr-un commit integral din `master` care are
`pr-verify` verde și imagini OCI construite din același commit, fixate prin
digest și semnate keyless. Publicarea este manuală, în mediul GitHub
`production`; nu există cron care urmărește și publică un `master` mobil.

## Surse de adevăr

- `config/product.json`: identitatea și originile first-party;
- `config/runtime-contract.json`: clasificarea configului și a secretelor;
- `deploy/compose.production.yml`: limitele containerelor și mounturile exacte;
- `deploy/deploy.sh`: planul de migrare, backupul, blue-green și rollbackul;
- `.github/workflows/pr-verify.yml`, `build-images.yml` și `deploy.yml`: lanțul
  CI, artefact și aprobare.

`vps-set-env` scrie numai configul non-secret allowlisted în
`/root/kelion/config/runtime.env` și fișierele de secrete individuale în
`/root/kelion/secrets`. Directorul este `root:10050` mode `0750`, iar fișierele
sunt `root:10050` mode `0440`. Containerul web nu primește un env legacy în
bloc și nu montează repository-ul sau `/root/kelion`.

## Fluxul unui release

1. `pr-verify` rulează porțile backend, frontend, migrări, secrete, containere și
   inventar atât pe PR, cât și pe commitul îmbinat în `master`.
2. `build-images` acceptă numai un run `push` verde pe `master`, construiește
   imaginile din SHA-ul exact, le publică prin digest și emite manifestul
   semnat.
3. `production-release` pornește numai prin dispatch manual autorizat, cere SHA integral și folosește mediul `production`. Verifică runul
   CI, runul de build, manifestul și semnăturile înainte de SSH.
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

## Separarea OpenAI și Codex

Fișierul `openai-project-key` conține numai cheia project-scoped folosită de
backend pentru funcțiile OpenAI ale clienților. `OPENAI_ADMIN_KEY` nu aparține
runtime-ului public, workerului Codex sau secret root-ului aplicației.

Constructorul are trei servicii host-only separate. Web-ul deține coada și câte
un verificator HMAC per domeniu; nu primește `CODEX_HOME`, `auth.json`, token
ChatGPT, token Git sau shell. Workerul folosește CLI-ul oficial cu login ChatGPT
gestionat de Codex, profil fără rețea pentru comenzile generate și o imagine
offline fixată pentru porți. El produce numai un handoff `gates_passed`.
Publisherul are credentiala GitHub minimă, dar nu are Codex/VPS; dispatcherul
are numai permisiune Actions pentru commituri deja merged, fără Git/VPS.
Flagurile, markerii și timerele celor trei identități rămân implicit oprite.

App Server nu este expus de Kelion și nu este necesar pentru coada actuală.
Ceremonia de login se face de operator în terminalul workerului; statusul public
este numai `setup_required`, `ready`, `busy` sau `degraded`, fără URL, cod sau
token de autentificare.
