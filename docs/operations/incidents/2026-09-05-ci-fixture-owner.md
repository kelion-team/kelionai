# Incident: CI Constructor — proprietarul candidatului din fixture

Stare: cauza reprodusă și corecția fixture-ului verificată pe VPS; verificarea GitHub pe noul commit, deploy-ul și ordinul 666 rămân separate și neconfirmate.

## Eșec și dovadă

[Run 33968410862, job verify](https://github.com/kelion-team/kelionai/actions/runs/33968410862/job/101312518097), commit 8272ec5153bd20ee0653f0246a71c7831d91f2d4: backend 1743/1743 și frontend 467/467 trecute; static 452 teste, 442 trecute, 9 eșuate, 1 omis. Izolarea containerului nu a rulat după acest eșec.

Scenariile eșuate sunt capture, sync-after, snapshot, symlink, hardlink, writable, foreign-owner, malformed și unsafe-parent din deploy/lib/constructor-pause.test.mjs. Testul omis este testul restore inode/ACL destinat explicit containerului Linux root, nu unul dintre cele nouă eșecuri. O omitere nu este o trecere.

## Cauză confirmată și de ce a scăpat

Fixture-ul indica direct helperul din checkout drept worker_pause_candidate_source. Checkoutul GitHub este deținut de runner. Validatorul de producție cere corect root:root pentru candidatul executabil de bootstrap. sudo schimbă identitatea procesului, nu proprietarul fișierului. Cele nouă ramuri ajungeau la bootstrap și erau respinse înaintea comportamentului testat.

În verificarea anterioară pe VPS, copia checkoutului din container era root-owned. Acea pregătire diferită a mediului a mascat lipsa din fixture. Nu este o dovadă că producția trebuie să accepte surse runner-owned.

Agentul Lovelace a reprodus în container VPS izolat exact 17 trecute / 9 eșuate / 0 omise, cu checkout UID1000 și Node UID1000 plus sudo. Această reproducere, împreună cu codul validatorului, confirmă cauza; simplul exit 1 din CI nu ar fi suficient.

## Corecție și validare

Fixture-ul copiază bytes autentici în propriul director privat cu root:root, verifică egalitatea prin cmp și pregătește de acolo helperul instalat. Checkoutul nu este chown, validarea de securitate nu este relaxată. Noua regresie candidate-foreign-owner verifică refuzul fără marker sau jurnal de migrare.

După corecție, pe același checkout non-root:
- Node UID1000 plus sudo: 27/27 trecute, zero omise, 8,53 secunde.
- Node root: 27/27 trecute, zero omise, 10,14 secunde.

KELION_REQUIRE_ROOT_PUBLICATION_BARRIER_PROBE=1 a rămas obligatoriu. Helperul runtime, root-filesystem-test.mjs și matricea bootstrap nu au fost modificate. Hash SHA-256 al testului corectat: 813790cb4c6550e232c80b3ab1a217f5d5399ac0da76af0dfecbfe2838571356.

## Impact, responsabilitate și închidere

Eșecul blochează integrarea PR 1662 și publicarea infrastructurii. Nu dovedește finalizarea sau reluarea ordinului 666.

Lovelace răspunde de corecția fixture-ului și reproducere; root răspunde de integrare, verificări obligatorii GitHub, deploy, upgrade și acceptarea separată live. Închiderea incidentului CI necesită noul commit și toate porțile GitHub trecute, fără bypass. Închiderea ordinului 666 necesită propriul traseu worker → verificări → PR → merge → deploy și probă live.

## Proveniență și regula de raportare

Raportul inițial al conversației de origine este Cauza-esecului-CI-Constructor-2026-09-05.md, citit integral la integrare. Explicația sa a fost confruntată cu reproducerea independentă Lovelace și este confirmată. Prezenta fișă adaugă rezultatele red/green ulterioare; nu suprascrie retrospectiv starea raportului inițial.

Pentru orice eșec ulterior se raportează: ce a eșuat, cauza concretă plus dovada (sau ipoteza marcată), motivul scăpării dacă este cunoscut, impactul, responsabilul, corecția și criteriul de închidere. O cauză identificată sau o verificare de candidat nu înseamnă publicare live.
