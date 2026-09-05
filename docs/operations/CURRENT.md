# Checkpoint operațional curent

Actualizat: `2026-09-05T05:36:00Z`

## Stare verificată

- Baza verificată `origin/master` și versiunea live sunt
  `44c570d7e5feac01c7c5cbd5e7345070f9787802`. Instanța existentă răspunde la
  `/api/version`, `/readyz` și `/api/release-proof`. Aceste verificări nu
  demonstrează executarea unui ordin Constructor până la deploy.
- Trainul este pe `fix/runtime-failure-evidence-20260905`. Sursele sunt
  înghețate pentru commit, verificări GitHub și publicare protejată. Noul
  Constructor nu are încă un deploy live verificat.
- Constructorul live este `setup_required`: workerul păstrează configurația
  Qwen 35B, iar modelele 35B și 122B lipseau de pe host înaintea acestei reluări.
- La `04:06:14Z` a fost eliminat, cu autorizarea ownerului, fișierul 7B de
  `4.683.073.536` bytes din
  `/srv/private-ai/models/qwen2.5-coder-7b/qwen2.5-coder-7b-instruct-q4_k_m.gguf`.
  Singurul GGUF rămas este
  `/srv/private-ai/models/qwen2.5-coder-3b/qwen2.5-coder-3b-instruct-q4_k_m.gguf`,
  `2.104.932.800` bytes, SHA-256
  `724fb256bec1ff062b2f65e4569e871ad2e95ab2a3989723d1769c54294730b7`.
- Proba OpenCode 3B din `/srv/private-ai/proofs/constructor3b-1Eh67opm` a
  eșuat: pornire rece `240.238 ms`, pornire caldă `101.577 ms`, zero apeluri
  reale de unelte în ambele. Răspunsul cald a emis JSON în bloc de cod, fără
  execuție. Fișierul de probă pentru sumă a rămas neschimbat, iar verificarea
  independentă a eșuat. Modelul nu are dovadă de funcționare ca Constructor.
  Listenerul temporar de test de pe `127.0.0.1:24081` este oprit.

## Schimbări nepublicate și limite

- Sunt în lucru tratarea fail-closed a erorii timpurii de inițializare audio,
  eliminarea dependențelor `Wants` prin care pollingul workerului repornea
  modelul oprit și eliminarea meniului dropdown Aplicații cerută de owner.
  Aceste schimbări nu sunt pe live și nu reprezintă finalizarea Constructorului.
- Constructorul izolat pentru utilizatori nu este implementat. Workerul
  privilegiat al adminului nu trebuie expus utilizatorilor.
- Ownerul cere conectori independenți pentru aplicații și un Constructor care
  execută efectiv cerința. VPS-ul existent rămâne în scop; nu se aleg unilateral
  alte modele, provideri sau costuri.
- Candidatul găzduit Big Pickle a trecut o probă sintetică reală pe VPS la
  `04:34:18.286–04:34:30.618Z`: OpenCode `1.18.25`, `12114 ms`, patru unelte
  executate (read, read, edit, bash), fișier modificat și test independent verde,
  oracle neschimbat. API anonim, fără cheie sau abonament nou. Prima încercare
  a expirat la transport pe IPv6; reluarea a folosit IPv4 numai în sandbox.
  Dovezi private: `/srv/private-ai/proofs/opencode-free-ZMqthVQ8`. Serviciile
  temporare sunt oprite. Nu s-a trimis cod Kelion și nu există integrare live.
  Gratuitatea este temporară; furnizorul poate folosi datele trimise pentru
  îmbunătățirea modelului. Ownerul a aprobat acum acest model și procesarea
  codului proiectului. Migrarea coerentă worker/controller/UI/installer este
  în lucru; nu există încă dovadă de funcționare a noului Constructor pe live.
- Ownerul cere și un Doctor permanent: simptome măsurate, diagnostic punctual,
  ordine deduplicate în aceeași coadă, testare, deploy și verificare live.
  `autodiagnostic.ts` colectează în prezent probleme la cerere; nu este o buclă
  permanentă de reparații. Această capabilitate nu este încă activă pe live.
- În browserul autentificat s-a trimis efectiv în chat cererea read-only de
  verificare worker/publisher/release. După `7.4 s`, răspunsul live a fost
  „Încearcă din nou în câteva secunde.” Nu s-a primit diagnostic, nu s-a creat
  ordin și nu există dovadă de finalizare Constructor în browser.

## Incident de izolare a testelor

- Testele statice Linux au fost lansate greșit ca root într-un checkout
  temporar direct pe host. La `04:19:51Z`, un harness nesigur a eliminat
  `/run/kelion/runtime-config-recovery.ready` de pe hostul real.
- La `04:24:59Z` a fost pornit numai serviciul canonic instalat
  `kelion-runtime-config-recovery.service`, după verificarea hashului sursei.
  Acesta a terminat cu succes la `04:25:20Z`; markerul ready a fost restaurat
  ca `root:root`, mod `0444`, iar timerele au fost reconciliate prin mecanismul
  existent. Nu s-a inventat manual un marker de succes.
- Remedierea celor două harnessuri a trecut proba comportamentală `2/2` în
  container fără rețea și cu hostul montat exclusiv read-only în directorul
  temporar. Testele boundary/controller au trecut separat `33/33` izolat;
  markerul real a rămas neatins și containerele temporare au fost eliminate.
  Manifestul static complet a trecut `288/288`, fără skip, în container Linux
  izolat. Corecția ulterioară a runtime-ului rootless se reverifică înainte de PR.
  Testele care execută helperi de host
  sau ating căi absolute se rulează de acum numai în containere izolate, nu ca
  root direct pe VPS. Un director temporar nu izolează filesystemul hostului.

## Blocajul actual de publicare

- Proba rootless a identificat concurența timerului vechi asupra
  `RuntimeDirectory`, apoi lipsa delegării cgroup către utilizatorul workerului.
  Varianta verificată folosește explicit `/usr/bin/crun` din pachetul oficial
  al distribuției și `--cgroups=disabled`; din container s-au citit limitele
  moștenite din systemd: 6 GiB, CPU 200%, 512 procese. Proba a rulat ca UID 995,
  nu root. Timerul oprit temporar a fost restaurat la starea active/enabled.
  Aceasta dovedește izolarea executorului, nu finalizarea unui ordin live.
- Publisherul rootless a trecut ca UID 994, cu limitele de resurse verificate.
  Varianta finală a executorului, inclusiv tmpfs privat 0700 deținut de UID-ul
  workerului, a executat proba sintetică AI în `38299 ms`: șase unelte,
  fișier reparat, test independent trecut și oracle neschimbat. Imaginea gate
  reală și regresiile finale sunt în verificare. Noul worker/controller/config
  nu sunt încă instalați în producție.
- Backendul a trecut `1546/1546` după trei actualizări patch ale dependențelor;
  auditul de producție este fără vulnerabilități raportate. Frontendul a trecut
  `348/348`, lint și build. Aceste probe nu sunt dovadă de deploy.
- Gitleaks pentru snapshotul curent este curat. Scanarea istoriei a găsit
  11 potriviri anterioare acestui train, inclusiv fixture-uri și literali vechi
  în documente/cod. Revocarea eventualelor credențiale istorice nu este probată;
  istoricul nu este declarat curat și nu a fost rescris ori allowlistat.
- Nu este necesară o nouă decizie de provider din partea ownerului. Doctorul
  și funcțiile suplimentare rămân oprite din dezvoltare până la livrarea
  Constructorului; verificarea read-only a opțiunilor Admin continuă în paralel.
- Cele trei defecte demonstrate în crearea/expunerea agenților specializați au
  corecții în același train: ID-uri rezervate respinse, limite de rol validate
  fără trunchiere și metadate admin excluse din răspunsurile publice. Regresiile
  focalizate au trecut `34/34`; nu se declară încă remediere live.

## Următorul pas sigur și acceptare

Providerul și trimiterea codului sunt autorizate. Implementează într-un
singur train migrarea coerentă a workerului, controllerului, contractelor UI,
installerului și dovezilor de release. Păstrează HMAC, lease-urile, receipturile,
rollbackul și porțile obligatorii. Rulează testele de host numai izolat, apoi
PR, verificări, merge protejat și release separat pe VPS-ul existent.

Constructorul nu este „gata” până când un ordin real din chat produce o
modificare verificată, trece testele, ajunge prin publisher și PR la release,
iar versiunea live și rezultatul ordinului sunt confirmate independent.
Funcțiile audio, memorie și conectorii se raportează separat, numai în limita
probelor efectiv executate.

## Legături canonice

- Aplicație: <https://kelionai.app>
- Repository: <https://github.com/kelion-team/kelionai>
- Upgrade canonic VPS: <https://github.com/kelion-team/kelionai/actions/workflows/vps-run.yml>
