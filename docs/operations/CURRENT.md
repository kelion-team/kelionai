# Checkpoint operațional curent

Actualizat: 2026-09-05T11:52:00Z (12:52 Londra)

## Current verified state

- Master și live rămân a32bab142cc2cf1eca2b514c92732308232155b2.
  /api/release-proof a confirmat ready=true, candidate=false și
  sideEffectsActive=true. App Docker are restart unless-stopped.
- Deploy a32: https://github.com/kelion-team/kelionai/actions/runs/33954248146,
  success. PR1660 merge: https://github.com/kelion-team/kelionai/pull/1660.
- Upgrade Constructor a32, attempt2 success:
  https://github.com/kelion-team/kelionai/actions/runs/33954585185.
  Controllerul a probat modelul autorizat opencode-free/big-pickle.
  Pregătirea motorului nu este dovadă că un ordin a ajuns la deploy.
- Lucrul autoritativ este exclusiv pe VPS vmi3415434:
  /var/tmp/kelion-maintenance.yQKdV92n/repo,
  branch fix/doctor-vps-live-20260905, bază a32. Exportul unic din laptop
  este încheiat; nu se mai citesc/editează/testează worktree-uri Windows.
  SSH și browserul sunt numai clienți. Sesiunea desktop nu este declarată
  serviciu AI permanent pe VPS.

## Incident pilot #666 și măsura de protecție

- Creat prin Admin live la 11:02:40.862 UTC pentru parserul Admin Erori.
  Prima execuție: task codex-f30fe4f1-637d-49b6-86ef-c8e718d38f9a.
  Modelul a încheiat la 11:24:33.967; gate-ul a refuzat la 11:24:35.061
  node_modules backend necontrolat, rămas din pregătirea executorului.
- Backendul a32 a transformat greșit failure în queued, fără Reia, și a
  preluat din nou la 11:27:05 cu attempts2/cycle0, task
  codex-a812fe88-1ccf-4344-905c-a6c450c1deaf. La 11:43:19 citirea DB arată
  din nou queued/technical_failure, task null, updated11:41:30.173.
  Nu există PR, handoff, commit sau deploy pentru acest pilot.
- Root a oprit numai kelion-codex-worker.timer pentru a preveni a treia
  reexecuție. Rămâne enabled, dar inactive; publisher/release sunt active.
  Execuția a doua nu a fost întreruptă. Nu reporni timerul înaintea
  remedierii instalate și reconcilierii stricte a cozii.
- Nu recrea ordinul și nu relansa modelul automat. Reia explicit pornește
  numai un ciclu nou; istoricul și verdictul terminal se păstrează.

## Unfinished work: train unificat comis pe VPS, push refuzat

- Worker: supervisorul deține două linkuri de dependențe, le elimină numai
  după oprire confirmată. Timeout/error cu exit0 nu este succes. Stop sau
  cleanup neverificat păstrează worktree-ul și jurnalul, fără rm/prune.
- DB: failure și watchdog devin terminale; claim admite numai queued,
  attempts0, fără pipeline. Migrația nouă reconciliază strict vechile
  auto-requeue-uri cu dovezi, fără a șterge istoric sau receipturi.
- Doctor: grant permanent revocabil, probe/lease durabile pe backend VPS,
  protocol2 și manifest al surselor instalate, scope AST limitat la două
  formattere publice. Chat/audio/cameră/memorie/quota/auth nu sunt declarate
  autoreparabile. Închiderea cere receipt și reproba pe exact SHA live.
- UI: registru agenți, opțiune low/high efectivă, ore Europe/London,
  progres pe etape distinct de activitatea AI și de heartbeat, SHA integral
  UI/runtime/proof. PWA păstrează asseturile taburilor vechi; nu forțează reload.
- Admin: remedieri de notificări, statistici cu baseline, istoric,
  prezență magazine și gesturi. Restul suprafețelor au nevoie de probe live.
- Restore: fixul ACL root:10050 0750 și regresiile sunt incluse, nu sunt în a32.
  Comentariul https://github.com/kelion-team/kelionai/pull/1660#discussion_r3939942944
  nu se închide fără publicarea și dovada corecției.

## Verificări candidat pe VPS, nu dovezi live

- Frontend complet: 425/425 PASS, build și lint PASS (container detached,
  network none, copie izolată, dependențe pinned). Fără SHA release în buildul
  de validare; nu este artefact de producție.
- Worker Linux: 38/38 PASS, zero skip, inclusiv red→green stop-timeout și
  toate probele POSIX. Self-test și sintaxă PASS.
- Doctor/wire/build/capability backend: 70/70 PASS. Runtime capability cu
  /opt sintetic privat: 5/5 PASS; fără acces la instalarea reală.
- PWA și UI low/high/London: regresii red înainte și green după fix.
- Backend complet: 1677/1677 PASS, typecheck, build și lint PASS.
- Static complet: 331/331 PASS, zero skip, trei self-testuri și 11 scannere
  PASS. Bariera POSIX de publicare a fost executată real ca root izolat.
- DB/no-auto-retry: 55/55 PASS; două review-uri independente fără blocante.
- Gitleaks snapshot și bundle: PASS, zero constatări. JSCPD: zero clone în
  337 fișiere analizate. Istoria Git: 11 constatări, nu este curată.
- Audit dependențe npm registry: backend, frontend și deploy/gates au zero
  vulnerabilități inclusiv devDependencies; lockurile au rămas identice.
- Toate containerele de verificare au încheiat; codul este înghețat.
  Singura corecție finală a sursei testelor a eliminat un spațiu terminal
  în doctor-repair-scope.test.mjs; sintaxa și preflightul au trecut.
- Imaginea gates a32 este numai cache de dependențe pentru aceste teste.
  Full canonical gates cer imagine nouă din SHA final: backend/package.json
  s-a schimbat prin generatorul manifestului. Comparația strictă rămâne.

## Blockers / owner action

- AUDIT PREVENTIV, BLOCANT NOU: deploy/deploy.sh:3992-4020 și :4839
  restaurează timer-ele pe baza markerelor, fără a păstra pauza curentă
  enabled/inactive. Poate reporni workerul vechi înainte de upgrade separat.
  deploy/upgrade-constructor.sh:377-405 refuză starea paused la preflight.
  Codul nu este încă remediat pentru acest caz. NU publica și NU porni timerul
  ca workaround; remediază conservarea pauzei/ordonarea și adaugă regresii.
  Protocolul Doctor2 nu blochează global claimurile ownerului.

- PUBLICARE BLOCATĂ: GitHub a refuzat push-ul ramurii deoarece identitatea
  OAuth gh existentă pe VPS nu are scope workflow pentru modificările din
  .github/workflows/build-images.yml. Nicio ramură remote/PR nu a fost creată.
  Nu s-au schimbat credențialele sau protecțiile și nu s-a încercat ocolirea.
  Următorul pas necesită autorizarea ownerului pentru reautorizarea GitHub
  pe VPS cu dreptul workflow; aceasta nu este aprobare individuală de PR.

- Nicio aprobare suplimentară pentru PR/merge/deploy autorizate deja.
  GitHub cere verify, container-isolation, current-tree, merge-policy,
  branch actualizat și conversații rezolvate; review_count0, enforce_admins=true.
  Nu ocoli protecțiile. Nu rezolva conversații fără remediere și dovadă.
- OpenAI insufficient_quota și Costs/Usage invalid_key rămân nerezolvate.
  Nu modifica modelul, providerul, credențialele sau facturarea pentru a ascunde.
- Eventualul nou ciclu pilot necesită Reia explicit după remediere; momentan
  nu se cere ownerului să repete ordinul sau să aprobe un PR.

## Next ordered steps

1. Obține autorizarea GitHub workflow prin fluxul normal, apoi recitește
   master și preflightul. Nu schimba identitatea sau tokenurile fără acord.
   Peer review-ul migrației este încheiat. Remediază blocantul preventiv
   deploy/upgrade descris mai sus și repetă porțile relevante înainte de PR.
   Nu porni alt pilot înaintea instalării și probelor live.
2. Recalculează manifestul din bytes finali; păstrează toate remedierile într-un
   singur train bazat pe master actual, apoi commit/preflight/PR pe verde.
3. Build semnat → deploy pe VPS → upgrade atomic al tuplei Constructor.
   Verifică migrația și coada înainte de reactivarea timerului.
4. Verifică exact master/producție/live/browser și funcțiile vizibile.
   Doctorul încă nu este live; niciun „gata” înainte de dovezi.

## Limite

Fără teste de fixture pe host, date de producție fabricate, retry AI automat,
force-push sau ocolire de securitate. Istoria Git are 11 constatări preexistente;
nu este declarată curată. Un test offline, heartbeat sau merge nu dovedește
funcționarea completă pe live.
