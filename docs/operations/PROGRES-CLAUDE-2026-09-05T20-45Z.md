# Progres verificat — executor Claude, 2026-09-05T20:45Z

Adaugă la checkpointul canonic. Măsurători directe, cu ora lor.

## Live acum

`master = live = 8a3d305c1a03`, confirmat pe `/api/release-proof`.

Conține, în ordinea intrării: nota de progres (#1665), filigranul redus la
versiune (#1666), păstrarea cauzei reale a erorii de stream (#1670) și proba
OpenCode robustă (#1671).

## Ce am reparat în această tură

1. **Publicarea lucrării blocate.** Cele 29 de fișiere necomise din repo-ul
   autoritativ, rămase după epuizarea limitei Codex, au fost publicate prin
   fluxul protejat, rebazate curat. #1662 a fost îmbinat cu toate verificările
   verzi, inclusiv `container-isolation`.
2. **Amprenta helperului de cutover**, rămasă veche după înlocuirea verificării
   de pauză cu `worker_pause_state`. Pica `verify` pe două teste de contract.
3. **Filigranul acoperea conținutul.** Afișează acum doar versiunea; eticheta
   completă, commitul serverului, ora pornirii și starea de sincronizare au
   trecut în `title`, iar atributele `data-*` au rămas neatinse.
4. **Cauza erorii de chat era aruncată la gunoi.** Un eveniment de eroare
   nerecunoscut ca limită din lista albă devenea `Error(openai_stream_error)`
   gol, deci jurnalul raporta `isRateLimit`, `isQuota` și `isRefusal` toate
   false, fără nicio cauză. Acum eroarea poartă `code`, `type`, `param`,
   `status` și `message`, mărginite. Comportamentul de reîncercare și
   escaladare este neschimbat.
5. **Masterul era roșu și bloca orice deploy.** `container-isolation` cerea ca
   mesajul EROFS să conțină exact `/root/.local`, dar binarul fixat atinge
   `/root/.config` primul. Proba acceptă acum ambele; restul verificărilor,
   inclusiv amprenta binarului, rămân neschimbate.

## Constructorul

`upgrade-constructor` a instalat tupla nouă, verificat prin sha256: worker,
publisher și release identice cu masterul, timer `enabled`, zero marcaje de
pauză. Workerul trece self-testul și întoarce `no_claimable_job` — corect după
migrarea terminală, fără reluare automată.

## Chat: stare reală, nu presupusă

Înainte de deploy, chatul pica scris și vorbit pe ambele modele. Escaladarea la
creierul superior funcționa; și el pica. Un indiciu adiacent din același
jurnal, `[VOCE] bucată nesintetizată (429 tts_http_429)`, sugerează o limitare
reală de cont la furnizor.

După deploy jurnalul nu are erori de chat, **dar nu a existat trafic**, deci
funcționarea nu este dovedită. La prima cerere reală, cauza va fi vizibilă
integral datorită reparației de la punctul 4.

## Ce rămâne

`constructor:666` cere **Reia explicit** din Admin, acțiune de owner. După
aceea, urmărirea traseului complet: execuție, teste, PR propriu, merge, deploy
și rezultat vizibil live. Constructorul nu este declarat funcțional.
