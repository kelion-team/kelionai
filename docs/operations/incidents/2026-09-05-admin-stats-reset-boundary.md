# Reset statistici: limită de înregistrare atomică

Data: 2026-09-05. Review PR1662, P2 PRRT_kwDOTNNplc6fjn8Z.
Implementare și probe: Codex/constructor_failure_trace (Darwin).
Review independent și coordonare publicare: Codex/root.

## Cauză și impact

Resetul bloca numai user_presence_daily și visit_daily. Inserările în messages
și cost_events puteau rămâne neconfirmate peste momentul resetării. Cititorii
filtrau created_at, al cărui DEFAULT now() este începutul tranzacției, nu
momentul inserării sau al commitului. Un BEGIN anterior resetului urmat de
INSERT ulterior rămânea astfel exclus. Mesajele offline au legitim created_at
în trecut și prezentau aceeași excludere.

Datele brute nu erau șterse; limita statisticilor putea omite înregistrări.
Adăugarea lockurilor singură nu repară semantica now()/timestamp offline.

## Corecție

- Resetul blochează toate cele patru tabele înainte de clock_timestamp() și
  păstrează aceeași tranzacție pentru baseline, agregate și audit.
- Migrația 20260919 adaugă stats_recorded_at, NOT NULL, cu DEFAULT
  clock_timestamp() server-side. Este timpul înregistrării INSERT, nu data
  evenimentului și nu o afirmație despre momentul commitului.
- Cele cinci predicate ale raportării folosesc această coloană pentru baseline.
  created_at, conținutul, costurile și celelalte date istorice rămân neschimbate.
- Pentru rândurile istorice, backfillul copiază created_at ca limită compatibilă;
  nu pretinde că s-a măsurat retrospectiv timpul real al înregistrării.

## Probe măsurate pe VPS, exclusiv izolat

- RED: 13:44:55–13:45:04 UTC, 3 PASS / 4 FAIL, zero skip, funcțiile reale
  adminStats/db pe PostgreSQL16.15. Eșecurile: INSERT messages în zbor,
  INSERT cost_events în zbor, BEGIN anterior/INSERT ulterior și mesaj offline.
  Migrația nouă exista în fixture, dar codul vechi nu utiliza coloana.
- GREEN: 13:46:08–13:46:15 UTC, aceleași șapte probe: 7/7 PASS, zero skip.
  Așteptarea resetului este probată prin pg_locks, nu printr-un sleep presupus.
- Corpul noului pas CI, 13:49:37–13:49:50 UTC: 8/8 PASS, zero skip, inclusiv
  regresia care cere invocarea PostgreSQL obligatorie. Numai referința imaginii
  gates a fost înlocuită cu imaginea de test cached; pașii sunt cei din YAML.
- Suita obișnuită PGlite: 5 PASS, 3 probe concurente explicit omise acolo.
  Pasul CI dedicat le rulează obligatoriu cu KELION_ADMIN_STATS_POSTGRES=1.
- La 13:52:29 UTC au trecut toate cele 38 de migrații prin mecanismul canonic
  applyMigrationsAtomically/runMigrations, cu pg_dump real și backup proof
  semnat canonic. Verificate schema istorică, backfillul și reaplicarea inertă.
  Digest registry: 02c4aa1e9af8c3b240878b259cad710cee36e8311ca78365feeea68bbe52e4c1.
- PostgreSQL pin: sha256:60f4761b9035e0b8d5218f701a8c3382f641bf12b1604822574cf5be3baeb537.
  Containere unice, network none, tmpfs, fără porturi sau mounturi de producție;
  testul Node partajează numai namespace-ul acelui PostgreSQL. Toate eliminate.
- Typecheck, lint țintit, sintaxă, exporturi, hardcodări și workflow safety PASS;
  regresiile compose: 6/6 PASS. Nicio inferență, resetare live sau mutație DB live.

## P2 ulterior: contractul ISO al răspunsului

Review PRRT_kwDOTNNplc6fjw3s: stats_since::text produce formatul PostgreSQL,
de exemplu 2026-09-05 12:34:56.123456+00, refuzat de parserul UTC ISO din UI.
Resetul putea comite corect, dar confirmarea și statisticile erau respinse.

- Normalizarea unică din adminStats convertește Date valid la ISO UTC pentru
  read/reset. Null păstrează semnificația perioadei istorice; valori nefinite
  sunt erori, nu null sau contoare zero fabricate. Clientul nu a fost relaxat.
- SQL și auditul folosesc baseline.id pentru limita originală din DB:
  afișarea la milisecunde nu rotunjește înapoi comparațiile la microsecunde.
  Nu există migrare suplimentară și nici modificare a evenimentelor.
- RED PostgreSQL real, 13:59:47–13:59:54 UTC: 9 PASS / 4 FAIL, zero skip.
  GREEN, 14:00:51–14:00:58 UTC: 13/13 PASS, zero skip. Sunt apelate funcțiile
  reale resetCostCounters/readAdminStatsBaseline/getDemoStats și parserii
  frontend existenți; doar transportul HTTP este înlocuit în fixture.
- La limita exactă .123456, evenimentul .123400 este exclus, iar .123456 și
  .123500 sunt incluse; SQL păstrează limita exactă, UI afișează .123Z.

## Limite și închidere

Backfillul și indexarea cer lockuri și lucru proporțional cu datele existente;
proba sintetică nu măsoară durata pe volumul producției. Nu s-a pretins deploy.
Închiderea cere CI verde pe noul head, merge/deploy protejat și migrația live
confirmată. Un reset live de verificare necesită autorizație separată; nu se
execută automat și nu constituie condiție implicită a acestei intervenții.
