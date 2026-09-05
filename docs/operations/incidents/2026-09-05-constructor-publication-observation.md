# Incident: observația barierei Constructorului

Stare: corecție verificată pe candidatul VPS; publicarea GitHub și instalarea live sunt încă necesare. PR1662, observația discussion_r3940764950.

## Cauză și impact

Contractul monitorului recunoștea deployGate=true, dar singurul producător /v1/worker/state răspundea503 înainte sau după obținerea lockului când exista o tranzacție de publicare. Snapshotul produs normal conținea întotdeauna deployGate=false. Monitorul interpreta imposibilitatea observației drept eroare, chiar în timpul unei bariere reale. Testele anterioare injectau direct un snapshot gate și nu verificau traseul producător→HTTP→parser→clasificare.

Un simplu journal pending sau un503 nu demonstrează un deploy sănătos: poate indica metadate invalide, acces refuzat ori recuperare incompletă. Aceste situații rămân neconfirmate.

## Metodă

Doar ruta read-only worker/state, după HMAC și corpul exact{}, poate cere observarea contencției. Doar codul75 al procesului flock real, fără signal, cu descriptorul și calea revalidate root:root0600/nlink1/inode identic, produce observația limitată200: deployGate=true, worker=null, intentionalPause=null. Nu este obținut un lease și nu se execută systemctl peste tranzacția altuia.

Lock invalid sau journal pending fără contencție rămân503. Rutele model/state și switch păstrează bariera existentă. Parserul cere schema exactă și prospețime; un gate cu PID ori pauză inventate este respins. Clasificatorul păstrează eșecul terminal prioritar și nu indică execuție utilă sau remediere în timpul barierei. Observația nu afirmă că publicarea va reuși și nu autorizează restart/retry.

## Probe și responsabilitate

- RED: noul test al producătorului cere200 și primește503; testul cazurilor neconfirmate trece.
- GREEN:16/16 teste controller, zero omise, inclusiv flock root real și cerere HTTP autentificată, refuz HMAC/corp și lock invalid. Prima integrare a extensiei testului avea numele greșit al câmpului din helperul HTTP; corectat statusCode→status, fără schimbarea așteptării200.
- Backend42/42 teste afectate și typecheck trecute. Persistența SQL păstrează jobul nemodificat, gate ca state_change, fără notificare de eroare fabricată sau activeExecution. Snapshoturile stale/future/contradictorii sunt respinse.
- Lint surse416fișiere:0warnings/0errors. Prima invocare a harnessului omisese.gitignore și a scanat dependențele; acel rezultat nu este declarat verde. Invocarea corectă verifică sursele aplicației.
- Root a implementat și integrat; Lovelace a făcut review independent fără observații blocante asupra auth, lock, schemă, clasificator, store, frontend și status-proof. Nicio probă nu a folosit runtime-ul sau datele producției.

Închidere: verificările GitHub pe noul head, deploy și upgrade pe SHA exact, apoi observație autentificată pe runtime instalat. Finalizarea ordinului666 necesită separat execuția sa, PR propriu și dovada deploy-ului; această remediere nu o înlocuiește.
