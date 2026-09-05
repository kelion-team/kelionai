# Checkpoint operațional curent

Actualizat: 2026-09-05T13:17:51.116Z (Europe/London: UTC+1 la această dată)

## Producție verificată, distinctă de candidat

- Master și live: a32bab142cc2cf1eca2b514c92732308232155b2.
  Release-proof: ready=true, candidate=false, sideEffectsActive=true.
  Browserul live la 13:06 UTC afișează server a32bab1, UI build 08:56 BST.
- Deploy: https://github.com/kelion-team/kelionai/actions/runs/33954248146 success.
  Upgrade Constructor a32 attempt2: https://github.com/kelion-team/kelionai/actions/runs/33954585185 success.
  PR1660: https://github.com/kelion-team/kelionai/pull/1660.
- Motor aprobat: OpenCode 1.18.25 / opencode-free/big-pickle. Disponibilitatea
  motorului nu dovedește încheierea unui ordin. Nu se schimbă modelul/costurile.
- Repo autoritativ exclusiv VPS vmi3415434:
  /var/tmp/kelion-maintenance.yQKdV92n/repo,
  branch fix/doctor-vps-live-20260905, HEAD publicat
  8272ec5153bd20ee0653f0246a71c7831d91f2d4, PR1662 OPEN, auto-rebase activ.
  Codul este înghețat; doar checkpointul operațional se actualizează necomis.
- SSH/browser sunt clienți. Aplicația/codul/testele/artefactele sunt pe VPS.
  Documentele predate explicit de owner se copiază byte-exact din Windows;
  nu se lucrează într-un worktree Windows. Sesiunea desktop nu este serviciu VPS.

## Ordinul #666: prioritate, nefinalizat

- Creat live 11:02:40.862Z pentru parserul Admin Erori. Cele două execuții au
  eșuat după oprirea modelului, la gate, din cauza linkului node_modules backend
  creat de worker și lăsat în worktree. Nu se atribuie slăbiciunii modelului.
- Task1 codex-f30fe4f1-637d-49b6-86ef-c8e718d38f9a; task2
  codex-a812fe88-1ccf-4344-905c-a6c450c1deaf. Backendul a32 a reîncadrat greșit
  primul eșec drept queued și a reluat fără Reia.
- DB verificată 12:56:00.637Z: queued/queued, cycle0, attempts2,
  updated_at11:41:30.173Z, 144 evenimente, niciun pipeline/PR/commit/deploy.
  Este singurul ordin nearchivat queued/running. Schema live nu conține încă
  automation_origin; nu rula interogări cu această coloană înainte de migrare.
- Worker timer: enabled/inactive, oprit intenționat ca să prevină încercarea3.
  Jurnalul systemd confirmă oprirea la 11:29:33.345Z.
  Worker inactiv/PID0. Publisher/release timers și controllerul rămân active.
  Nu se reactivează până la noua tuplă instalată și reconcilierea strictă.
- Hash evenimente preexistente ordonate:
  5264db52cbfbbc569b17a2eaaafd20ad09eba8def3916af1f6c2ba69f84f1610.
  Migrația terminală păstrează istoricul. Reia autorizat explicit folosește
  același ID cu snapshot proaspăt status+updatedAt; cycle1/attempts0.
- Notificarea live646 creată 12:30:17.408Z și647 creată13:01:45.972Z au fost
  văzute în Admin→Notificări în browser. Sunt dovezi istorice de remediere/test;
  ambele afirmă că #666 nu a avansat. Nu modifică procente/ciclu/încercări.

## Train candidat: implementare înghețată, încă NU live

- Worker: cleanup numai pentru linkurile proprii, numai după stop confirmat;
  timeout/error cu exit0 nu este succes. No-auto-retry, watchdog terminal,
  claim attempts0 fără pipeline; migrare strictă pentru auto-requeue vechi.
- Pause: marker root-owned durabil și helper comun pentru deploy/upgrade/
  rollback/boot; unitățile blochează și pornirea directă. Compatibilitate a32
  numai pe bytes autentici și jurnal bootstrap fail-closed cu fsync.
  Helper final 51fb7beff6f8396383fbabe806df28ddaadffbd410fc58425f44045aeab5d8fd.
- Controller: HMAC POST /v1/worker/state, numai systemctl show argumente fixe.
  Marker verificat cu parent/inode/root ownership/mode/nlink/no-follow; eroarea
  de citire nu înseamnă sănătate. Nu există endpoint shell/executare.
- Monitor: interval60s independent în backend VPS, lease, istoric/incidente/
  responsabil/nextAction. Se disting ultima încercare și ultima verificare
  reușită; heartbeatul repetat nu este progres real.
- Remediere externă: owner unic per job/ciclu, UUID, CAS takeover explicit,
  evenimente deduplicate, baseline inactiv; doar dovadă nouă proaspătă aprinde
  activitatea maximum60s. Nu scrie în build_jobs. Writerii au acum entrypoint strict root-only stdin livrat în imagine;
  24 teste CLI reale PASS și review independent aprobat.
  Fără HTTP/AI/tool, fără dependențe noi, fără inferență sau execuții live.
- UI: clepsidră la ordin pe activitate validă în ciclul/starea curentă, separat
  de procent; dispare la offline/eroare/expirare. Snapshot server no-store,
  timp server și RTT, nu ceas local pentru prospețime. Registry agenți, low/high,
  ore Europe/London, SHA și PWA old-assets sunt incluse în train.
- Doctor: backend VPS cu grant revocabil, protocol2, manifest exact, scope AST
  limitat la două formattere publice. Receipt + reproba exact SHA live obligatorii.
  Nu se pretinde autoreparare universală chat/audio/cameră/memorie/quota/auth.
- Admin: remedieri notificări/statistici baseline/istoric/gesturi/magazine.
  Întreaga aplicație rămâne neacceptată până la probele live ale fiecărei funcții.

## Probe preventive pe VPS

### Surse finale înainte de adaptorul reporter

- Backend1719/1719 teste, 225 fișiere, 376.29s; typecheck/build/lint PASS,
  zero warning/error, 419 fișiere. Snapshot56818edaeabf46985acef7760a3e70f9b41d47ff01a66affe73efbfd4b0e4d37.
- Frontend467/467, 83 fișiere, 42.04s; build/tsc/precache/lint PASS,
  zero warning/error, 224 fișiere. Include46 probe hook HTTP/abort, projection/SSR.
- Static448/448, zero skip, 165.72s, root mandatory; 10 scanere și3 self-testuri
  PASS. Scanner exporturi găsise2 writeri neconsumați: remediat prin entrypointul
  real, nu allowlist. Acum329/329 module accesibile,0 exporturi neconsumate.
- Pause/publication/recovery250/250 includebootstrap53 și32 cutpoints SIGKILL.
  Nu se adună rezultate suprapuse.
- Controller worker-state14/14 PASS, inclusiv marker/parent/race/fd cleanup.
- Prima probă statică a eșuat din TMPDIR harness /work/tmp. Rerulată în /tmp
  privat cu aceleași permisiuni/teste:448/448 PASS, fără relaxări.
- Gitleaks snapshot/bundle anterior29fb:0; istorie Git:11 constatări preexistente.
  Istoria nu este declarată curată și nu se rescrie. Lockuri npm neschimbate;
  audit registry anterior:0 vulnerabilități în cele3 arbori.

### Canonical exact29fb, probă distinctă

- Full gate Docker standard, UID1000, docker-default, networknone, RO,
  capdropALL: PASS exit0, fărăOOM, 12:43:51–12:55:10UTC (11m19.6s).
  Backend1677/1677, frontend425/425, build/lint; static330PASS+1SKIP root-only.
  Proba statică finală448 de mai sus rulează root obligatoriu și nu omite nimic.
- Log /var/tmp/kelion-canonical-gate.3MJz2Rp9/docker-gates.log
  SHA531d53d1716bf11e25e1c546e2c4ccd89fa53d65b010ce4eff6c3ab9ecbd44f2.
- Podman root avusese AppArmor signal denial137, nuOOM. Identitatea reală
  rootless kelion-codex cu crun existent a trecut SIGTERM și oprirea canonică
  cu SIGKILL după10s; parent/child dispăruți, zero containere/procese de probă.
  Nu s-a schimbat runtime sau profil de securitate.
- Imaginea de TEST poate fi reutilizată pentru sursele finale numai dacă toate
  intrările Dockerfile/6manifeste/entrypoint/2vendor corespund. Nu conține codul
  aplicației și nu înlocuiește noua imagine de RELEASE semnată pentru SHA final.
- GitHub container-isolation rămâne obligatoriu în CI. Nu se rulează fixture-uri
  cu nume de servicii care ar coliziona cu producția pe VPS.

## Publicare și reluare: următorii pași autorizați

1. Adaptorul root-only și status-proof sunt încheiate, teste și peer review
   aprobate. Source freeze. Încheie commit/preflight și publică trainul.
2. Recalculează manifestul, gitdiffcheck, commit, preflight clean/currentmaster,
   push branch și PR protejat; rebase auto-merge numai pe verde. Nu cere o
   aprobare manuală suplimentară. Nu bypass checks/conversații.
3. Push master CI → imagini semnate → deploy autorizat → upgrade-constructor,
   toate corelate exact cu SHA nou și păstrând markerul de pauză.
4. Verifică master/live/gates/runtime/DB și cele144 evenimente intacte.
   După migrare, Reia același666; verifică ordinea reală a cozii și lipsa unui
   running înainte de clear marker global sub publication lock și start timer.
5. Urmărește același666 până la gate/handoff/PR/merge/deploy și repetă scenariul
   Admin Erori în browserul live. Progresul nu este fabricat și nu se repetă AI
   automat după eșec.
6. După666 continuă cerințele aprobate din docs/requirements/TRACEABILITY-v1.1.md.
   Backlogul executanților reutilizabili rămâne separat, fără implementare acum.

## Protecții / limite actuale

- Auth gh VPS persistent rootroot0600, identitatekelion-team cuworkflow scope;
  nu depinde de laptop. No credential transfer către worker/publisher.
- GitHub strict/enforceadmins/conversation/linearhistory, review_count0;
  verify/container-isolation/current-tree/merge-policy obligatorii.
- Verifierul incident1661 are corecție candidată bounded în
  scripts/lib/vps-release-verification.mjs, 19/19 și API read-only PASS.
  Nicio protecție GitHub nu a fost modificată.
- Comentariul1660#discussion_r3939942944 nu se închide fără corecție publicată.
- OpenAI insufficient_quota, Admin Costs/Usage invalid_key și Serper necitit
  rămân reale/nerezolvate. Nu se ascund prin zero inventat sau alt provider.
- Fără fixture-uri pe host, restart/retry AI orb, force-push, secrete în loguri,
  progres fabricat sau pretinsă finalizare pe baza testelor de candidat.


## Freeze final și dovezi suplimentare, 13:15 UTC

- Reporter livrat: backend/dist/constructorRemediationReporter.js, numai register
  sau report. Operatorul root din containerul activ verificat transmite un JSON
  stdin {input, expectedExecutionId?}; CAS numai register, maximum8192bytes/5s.
  Fără override env, HTTP, AI, shell primit sau acces browser. Environment
  blue/green + SHA + marker activ exact și release guard real; poolclosefinally.
  66/66 target (24CLI +42existente) PASS, typecheck/build/lint/export PASS.
  Entry SHA ec2130e26cc88e6534f913a7ce91b45a3ebbc6389127301aaa3b60795eb1dbc8.
- Status-proof P1: helperul instalat nehashat nu mai este executat. HMAC
  worker/state de la controller verificat, schema/freshness15s/max2048 și
  systemctl independent. 5red înainte,22statusgreen/36affectedgreen după,
  zero skip; peerreview aprobat. SHA bb3bb9e6d3519cad2f3f92fb5fe27d59a6cd132d5f0b3d2e939639e790d57a3b.
- Cele11 scanere finale pe snapshotul cu reporter au trecut. Containerul
  kelion-final-integration-20260905T1312 s-a oprit ulterior la self-test numai
  din lipsa tmpfs /tmp; logSHA19419839fd4bc06a5158224d8c6fa252cab13d90ae3cd7d750d1050d9d48127a.
  Proba anterioară T1315 s-a oprit înainte de execuție (UID tmpfs nepotrivit).
  Nu se pretinde că aceste două containere au trecut.
- Containerul corect kelion-final-bundle-20260905T1313: 13:12:54.481–13:13:49.254Z,
  exit0/noOOM; toate3 self-testuri, frontend build, Gitleaks snapshot+bundle
 50.62MB zero constatări, JSCPD347fișiere zero clone. LogSHA
  8ca6706ea058ecede072d995186b4c8f8afb4302d7ee7c9a7af906e7e351790d.
  Rootfs RO/networknone/capdropALL și tmpfs private; niciun fixture pe host.
- Monitorul doar observă și notifică; nu atribuie automat un executor Codex.
  Reporterul atestă activitatea operatorului, nu repară. Doctorul candidat
  are scope limitat2module publice; #666 este în afara lui. Nu există încă
  executor autonom general incident→reparație. Codex coordonează această
  remediere pe VPS; supravegherea nu este declarată autoreparare universală.
- Backlogul executanților reutilizabili este separat, neimplementat:
  docs/backlog/approved/2026-09-05/De-facut-Kelion-executanti-reutilizabili.md,
  SHA79122855c4c0eaf15f59d65b483dcd69988a19925ad58c64235bce8ecebbfe87.

## Publicare în curs

- PR https://github.com/kelion-team/kelionai/pull/1662 creat și deschis în browser;
  auto-rebase confirmat13:16:15Z. Nu cere review manual și nu ocolește checks.
- CI https://github.com/kelion-team/kelionai/actions/runs/33968410862 a eșuat
  la static: 442PASS/9FAIL/1SKIP. Backend1743/1743 și frontend467/467 PASS.
  container-isolation nu a rulat; nu este declarat trecut.
- Live încăa32; PR1662 este al remedierii infrastructurii, NU PR executat de#666.
  Nicio dovadă de finalizare a ordinului nu este înlocuită de acest PR.
- Citirea jobului13:16:09.339Z: calendar2h13m28sde lacreare; cele2ferestre
  claim→failure35m17s, nu inferență continuă. Ultimul workerreport11:41:29.609Z;
  failure11:41:30.173Z; logsmodelindividualeabsente, ultimaunealtăutilăneconfirmată.

## Incident CI fixture owner: corecție verificată, publicare în curs

- Cele9 eșecuri provin din candidatul bootstrap runner-owned în checkoutul CI.
  sudo nu schimbă proprietarul; validatorul root:root a refuzat corect candidatul.
  Proba anterioară VPS copia checkoutul ca root și nu exercita această diferență.
- Lovelace a reprodus exact17PASS/9FAIL/0SKIP cu NodeUID1000+sudo și checkoutUID1000.
  Fixul pregătește candidatul în fixture privat root:root și verifică bytes prin cmp.
  Nu schimbă checkoutul ori validările de producție. Regresie nouă: owner străin
  refuzat fără marker/journal. După fix:27/27PASS0SKIP UID1000+sudo (8.53s),
  27/27PASS0SKIP root pe același checkout nonroot-owned (10.14s).
- Test SHA813790cb4c6550e232c80b3ab1a217f5d5399ac0da76af0dfecbfe2838571356.
  Runtime helper, root guard și bootstrap neschimbate. Responsabil fix:Lovelace;
  integrare/CI/deploy:root. Detalii:docs/operations/incidents/2026-09-05-ci-fixture-owner.md.
- Închiderea CI cere noul GitHub HEAD cu toate porțile trecute. Deploy și ordin666
  au acceptări separate; nu sunt declarate finalizate din probele fixture.

## CI32a1 și al doilea incident, 5 septembrie2026

- Run33968908143: verifyPASS3m4s; backend1743/1743, frontend467/467,
  static453tests/452PASS/0FAIL/1SKIP. OwnerregressionPASS.
- Container-isolation101314219700: imaginile construite; Doctor scope12PASS/1FAIL
  din regex stale pentru heartbeat (detail întrestate și doctorCapability).
  Producția arecapabilitymăsurată, backendacceptădetailbounded240.
- Fixnumaitestdoctor-repair-scope: ASTapeleazăexpresiilePOSTreale și verifică
  capabilitatemăsuratăindependent, refuzămutanțiomiși/fabricați.15/15PASS0skip,
  peerreviewDaltonaprobat; SHA9baa07297ecfa87b6fe1dcdb77de98c3d6abb3c167cb56428248088d89e694df.
  Fișă:docs/operations/incidents/2026-09-05-ci-doctor-heartbeat-contract.md.
- Clarificărileaprobateraportare/context/metoderezolvare și4zonetehnice suntîn
  docs/requirements/approved/2026-09-05/Completare-aprobata-raportare-si-zone-tehnice.md.
  Nu suntimplementateprinfișă.648DB+DOM+capturănuînseamnăconsumorchestrator;
  Darwinconfirmăcănotificărilenusuntîncontext/unelteKelionautomat.
- PreflightVPS13:29–13:30UTC: markerpausedABSENT; timerenabled/inactive,PID0.
  Helperlegacy833b28...=a32acceptatdebootstrap,jurnaleabsente; nublocajnou.
  Pauzaîncănudurabilă; deploytrebuiesăcaptezemarkerînainteupgrade/reluare.
