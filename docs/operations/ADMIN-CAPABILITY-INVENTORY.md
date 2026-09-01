# Inventarul canonic al capabilităților Admin Kelyon

Versiune registru: `1.0`

Actualizat: `2026-08-25T22:01:26Z`

Acest document este sursa unică pentru inventarul suprafețelor Admin și pentru
work item-urile lor operaționale. El nu înlocuiește starea runtime din baza de
date, GitHub Actions, Deployments sau probele live. Starea curentă de release
rămâne în [`CURRENT.md`](CURRENT.md), iar regulile de acceptare rămân în
[`DELIVERY-RULES-AND-ROADMAP.md`](DELIVERY-RULES-AND-ROADMAP.md).

O intrare în inventar nu dovedește implementarea. Nicio capabilitate nu devine
`live` sau `completă` numai fiindcă este enumerată aici.

## Legendă și metodă

- `verificat în cod`: sursa și testele nominalizate există pe branch-ul auditat;
- `parțial`: există un traseu real, dar lipsește cel puțin o dovadă sau o
  proprietate obligatorie;
- `absent`: traseul cerut nu există în codul auditat;
- `necunoscut live`: ruta autentificată sau rezultatul nu a putut fi probat în
  sesiunea live; nu este echivalent cu eșec sau succes;
- `blocat extern`: continuarea cere o autoritate externă, interactivă sau
  ireversibilă pe care sistemul nu are voie să o ocolească.

Autoritatea registry-ului de taburi este
[`frontend/src/lib/admin.ts`](../../frontend/src/lib/admin.ts). Cele 13 taburi
canonice sunt `finance`, `users`, `share`, `stores`, `inbox`, `gesturi`,
`tokenuri`, `constructor`, `recuperare`, `sistem`, `erori`, `notificari` și
`creier`. Proiecția UI principală este
[`frontend/src/components/AdminPanel.tsx`](../../frontend/src/components/AdminPanel.tsx),
iar rutele sunt în [`backend/src/routes/admin.ts`](../../backend/src/routes/admin.ts)
și [`backend/src/routes/constructor.ts`](../../backend/src/routes/constructor.ts).

## Ordine de lucru

| Prioritate | Work item | Motiv verificat |
| --- | --- | --- |
| P0 | [ADM-008 Constructor](#adm-008-constructor) | Traseul local OpenCode/Qwen și autoritățile GitHub/release cer dovadă live completă. |
| P0 | [ADM-018 Live Voice](#adm-018-live-voice) | Captarea funcționează, dar sesiunea provider/relay nu ajunge la răspuns bidirecțional. |
| P0 | [ADM-015 Fișa canonică](#adm-015-fisa-canonica-si-intake) | Implementarea există numai nepublicată și incidentul curent nu are card vizibil verificat. |
| P0 | [ADM-014 Monitor și provider health](#adm-014-monitor-si-provider-health) | `OpenAI 1/2` comprimă cauza și nu oferă incident/următor pas canonic. |
| P1 | [ADM-010 Sistem](#adm-010-sistem) | Există autoverificare/audit, dar rezultatele nu conduc toate la work item-uri. |
| P1 | [ADM-011 Erori](#adm-011-erori) | Erorile sunt vizibile, dar handofful automat către Constructor nu este dovedit. |
| P1 | [ADM-017 Istoric activitate](#adm-017-istoric-activitate-si-audit) | Există surse parțiale; istoricul unificat, queryable și cu retenție rămâne backlog. |
| P2 | ADM-001–ADM-007, ADM-009, ADM-012, ADM-013, ADM-016 | Audit și consolidare după fundația release/voice/Constructor. |

## Matricea suprafețelor Admin

| Work item | Suprafață | Implementare și autoritate | Sănătate/completitudine | Hardcoding | Vizibilitate monitor | Dependențe / următor pas |
| --- | --- | --- | --- | --- | --- | --- |
| [ADM-001](#adm-001-finante) | Finanțe | `AdminPanel`, `/api/admin/finance`, `/money-circuit`, `/credit-ai`, `/brain-credit` | Verificat în cod; live autentificat necunoscut; parțial | Testele interzic sold/profit/curs fabricate | Becuri agregate în Stage; fără work card per operație | DB, billing, provider metering; probă live și receipts |
| [ADM-002](#adm-002-utilizatori) | Utilizatori | `/users`, `/activity`, `/history`, `/translate`, `/user` | Verificat în cod; live necunoscut; parțial | Suma creditului este cerută manual; numărătorile vin din server | Nu există timeline canonic per acțiune | DB, auth, billing; idempotency și audit per mutație |
| [ADM-003](#adm-003-distribuire) | Distribuie | Tab `share` și configurarea platformelor client | Implementat UI; traseul live necunoscut; audit incomplet | Linkurile/texte/platforme necesită audit de origine | Fără status persistent | Config platforme, PWA/mobile; dovadă pe fiecare țintă |
| [ADM-004](#adm-004-magazine) | Magazine | `/api/admin/stores`; contract frontend dedicat | Verificat în cod; live necunoscut | Testul respinge ledgerul de download retras și forme invalide | Doar tab Admin | Metadata store/build; link la artefact/release |
| [ADM-005](#adm-005-inbox) | Inbox | `/inbound`, `/mailbox-live`, `/mailbox-delete`, `/contact-messages` | Verificat în cod; stările gol/eșec/neconfigurat sunt separate; live necunoscut | Folderele mail și limitele de citire trebuie documentate ca politică | Fără work card per mesaj/acțiune | IMAP, DB, mail config; receipt de delete/reply |
| [ADM-006](#adm-006-gesturi) | Gesturi | `/gestures`, manifestul și preview-ul avatarului | Verificat în cod; aplicarea runtime end-to-end nu este probată | Timerele preview sunt cosmetice; catalogul trebuie să aibă un singur owner | Preview vizual, fără confirmare durabilă | Avatar/control frames; confirmare aplicată și test live |
| [ADM-007](#adm-007-tokenuri) | Tokenuri | `/keys`, `/token-checks`, `/env-check` | Verificat în cod; status live necunoscut; parțial | Aliasurile de env sunt configurare backend, nu date UI | Diagnostic Admin, fără incident automat | Secret store, provider APIs; zero valori sensibile și work item la lipsă |
| [ADM-008](#adm-008-constructor) | Constructor | `build_jobs`, activity events, rutele admin/internal și pipeline worker OpenCode/Qwen local, publisher/release | Parțial și blocat extern pentru publicare; dovada live completă lipsește | Zero retry/reexec automat pentru worker, model și ordin; `Reia` explicit pornește un ciclu nou, iar numai publication/CI/release pot relua idempotent același handoff/commit | Stage separă `local_gates` de CI GitHub și proiectează progresul persistent; fișa nouă nu este live și AdminPanel nu o proiectează complet | OpenCode 1.18.25, llama.cpp/Qwen local, token signing, GitHub, CI, VPS, deploy; fără cheie OpenAI în Constructor |
| [ADM-009](#adm-009-recuperare) | Recuperare | `/backups` și `/backups/restore` | Verificat în cod; restore live netestat | Confirmarea umană este justificată pentru mutația cu impact; progresul nu trebuie simulat | Rezultat în tab, fără timeline durabil | Backup store, DB, deploy; dry-run, receipt și rollback |
| [ADM-010](#adm-010-sistem) | Sistem | `/audit`, `/registru-audit`, `/demos`, `/models`, `/autoverificare` | Parțial; probele există, dar nu formează o singură stare operațională | Cadentele de polling sunt constante UI; rezultatele trebuie să rămână server-backed | Vizibil în tab, fără card automat pentru toate abaterile | Health, DB, config, jobs; creare/deduplicare work item |
| [ADM-011](#adm-011-erori) | Erori | `/erori`, `client_errors`, probleme server/job | Parțial; colectare reală, handoff absent/neverificat | Polling 20 s este doar refresh; severitatea/cauza trebuie să vină din autoritate | Listă vizibilă, fără progres de remediere | Client telemetry, autodiagnostic, Constructor |
| [ADM-012](#adm-012-notificari) | Notificări | `/notificari` și marcarea citit | Verificat în cod; live necunoscut; parțial | Polling 20 s este UI; mesajele nu trebuie să copieze starea canonică | Vizibil în tab, nu în timeline-ul work item-ului | DB, mail/push, incident/work item links |
| [ADM-013](#adm-013-creier-openai) | Creier OpenAI | `/creier`, `/models`, OpenAI Responses și metering | Parțial; model catalog în cod, provider live degradat observat | Lista de furnizori este limită de produs; cauza nu poate fi redusă la „reîncarcă” | Bec și tab, dar cauza exactă/receiptul lipsesc | OpenAI project key, model access, quota/billing, relay |
| [ADM-014](#adm-014-monitor-si-provider-health) | Stage/monitor și becuri | `Stage.tsx`, `/api/constructor/live`, `creditAI` | Parțial; progres Constructor persistat există, incidentul Voice nu apare ca work card | 25 puncte și 0,5%/punct sunt randare; procentul trebuie să vină din evenimente | Da, dar cardul și cauza providerului sunt incomplete | Constructor observability, credit health, session auth |
| [ADM-015](#adm-015-fisa-canonica-si-intake) | Intake și fișă de lucru | Migrarea/work-card service din branch-ul activ | În lucru, nepublicat; nu există dovadă live | Defaulturile generice/empty metadata trebuie populate din intake, nu declarate adevăr | Stage parțial în branch; AdminPanel incomplet | DB migration, build jobs, chat/voice intake, event FK |
| [ADM-016](#adm-016-frontiera-admin) | Auth și frontieră Admin | Sesiune, rol admin și guarduri pe rute | Implementat în cod; probă live completă necunoscută | Owner identity/config trebuie să aibă un singur owner server-side | Badge/panou; fără afișare de secrete | Auth/OAuth, cookies/CSRF/origin, rate limits |
| [ADM-017](#adm-017-istoric-activitate-si-audit) | Activitate și audit | `/activity`, `/registru-audit`, history, events | Parțial; backlog post-fundație pentru timeline unificat | Retenția și categoriile nu pot fi implicite | Fragmente în taburi; nu există vedere unică verificată | DB schema, RBAC, retenție/export/ștergere |
| [ADM-018](#adm-018-live-voice) | Live Voice și reziliență | `ChatPanel`, `vocalLive.ts` frontend/backend, OpenAI Realtime | Captare verificată de owner; sesiune bidirecțională eșuată; cauză fină necunoscută | Retry client limitat există, dar politica nu este canonică; fallbackul generic ascunde cauza | Mesaj/fallback în chat; work card/timeline absent | Project key, Realtime model, quota, WebSocket relay, auth |

## Work items și dovezi de acceptare

### ADM-001 Finanțe

Owner: backend billing + Admin UI. Stare: `parțial`.

- [ ] O probă autentificată leagă cifrele afișate de receipturile DB/provider.
- [ ] Eșecul oricărei surse rămâne `necunoscut/degradat`, niciodată zero inventat.
- [ ] Orice mutație are idempotency key, actor, rezultat și link canonic.

### ADM-002 Utilizatori

Owner: identity/billing + Admin UI. Stare: `parțial`.

- [ ] Listare, istoric, blocare/deblocare, credit și delete sunt probate separat.
- [ ] Fiecare mutație produce audit durabil și rezultat recuperabil după refresh.
- [ ] Suma și autoritatea vin din cererea canonică, nu din prompturi UI ad-hoc.

### ADM-003 Distribuire

Owner: frontend/platform packaging. Stare: `audit necesar`.

- [ ] Fiecare țintă afișată are config canonic, artefact și link oficial.
- [ ] Disponibilitatea este măsurată; platformele nepublicate sunt marcate clar.
- [ ] Share/install este probat desktop și mobil fără date hardcodate de mediu.

### ADM-004 Magazine

Owner: release/platform distribution. Stare: `parțial`.

- [ ] Răspunsul `/stores` este validat și legat de artefactul/versionarea reală.
- [ ] Linkurile sunt deschise și probate pe ținta lor, nu doar randate.
- [ ] Starea absentă/neverificată nu este transformată în disponibilitate.

### ADM-005 Inbox

Owner: messaging integrations. Stare: `parțial`.

- [ ] IMAP neconfigurat, citire eșuată și inbox gol rămân trei stări distincte.
- [ ] Delete/reply produce actor, rezultat, ID mesaj și receipt fără conținut sensibil.
- [ ] Mesajele care cer lucru creează ori actualizează un work item canonic.

### ADM-006 Gesturi

Owner: avatar runtime. Stare: `parțial`.

- [ ] Catalogul, preferințele și control frame folosesc aceeași identitate de gest.
- [ ] Preview/aplicare au confirmare de start, final și eroare, nu numai animație UI.
- [ ] Un test live dovedește creier -> comandă structurată -> avatar -> receipt.

### ADM-007 Tokenuri

Owner: secret/config platform. Stare: `parțial`.

- [ ] Diagnosticul arată numai nume logic, prezență, permisiune și cauză redactată.
- [ ] Lipsa/scopul greșit creează incident deduplicat și o singură acțiune externă.
- [ ] Browserul, workerul, logurile și artefactele nu primesc valoarea secretului.

### ADM-008 Constructor

Owner: Constructor pipeline. Stare: `blocat extern`.

- [ ] Tokenul publisher are permisiunea minimă de signing și testul preflight trece.
- [ ] OpenCode `1.18.25`, llama.cpp loopback și Qwen3.6-35B-A3B local sunt
      probate; workerul raportează heartbeat/ready fără cheie OpenAI sau cache Codex.
- [ ] O cerere reală parcurge toate etapele cu procente/evenimente persistente.
- [ ] După claim, workerul, modelul și ordinul au zero retry și zero reexecuție
      automată; timeoutul, eroarea tehnică și `unresolved` rămân terminale pentru
      ciclul curent.
- [ ] `Reia` explicit este o decizie separată a ownerului: creează un
      `execution_cycle` și un task ID worker noi, fără să rescrie ori să continue
      ciclul terminal anterior.
- [ ] Numai publication, CI și release pot relua idempotent un checkpoint, doar
      pentru același handoff imuabil și același commit/SHA, fără a reinvoca modelul.
- [ ] Installerul poate proba temporar POWERFUL numai în instalare și încheie cu
      FAST activ dovedit; excepția nu execută sau reia niciun ordin.
- [ ] După restart, controllerul continuă numai intenția manuală acceptată și
      persistată, cu același request ID și aceeași țintă; nu decide profilul, nu
      creează o comutare nouă și nu repune ordinul în coadă.
- [ ] Numai o autoritate externă reală poate produce `waiting_external` pentru
      publication/CI/release, cu o singură acțiune explicită și reluarea
      aceluiași checkpoint downstream după restabilirea readiness.
- [ ] `local_gates` are receipt propriu și nu este prezentat ca CI GitHub verde.
- [ ] PR, CI, master, artifact, deploy, live și rollback au link/SHA/receipt comune.
- [ ] Anularea explicită persistă `cancelled` ca rezultat terminal rezolvat,
      separat de eșec și fără a fabrica dovadă de deploy.

### ADM-009 Recuperare

Owner: operations/deploy. Stare: `parțial`.

- [ ] Lista restore points vine din autoritate și include checksum/versionare.
- [ ] Preflight și dry-run preced orice restore; acțiunea ireversibilă cere confirmare.
- [ ] Postflight, rezultat și rollback sunt persistente și vizibile după refresh.

### ADM-010 Sistem

Owner: platform health. Stare: `parțial`.

- [ ] Fiecare sondă are owner, timestamp, rezultat, categorie și link la dovadă.
- [ ] O abatere materială creează/actualizează automat un work item deduplicat.
- [ ] Revenirea în verde închide incidentul numai după postflight și regresie.

### ADM-011 Erori

Owner: observability. Stare: `parțial`.

- [ ] Browser/server/job errors au fingerprint, cauză, severitate și first/last seen.
- [ ] Erorile recuperabile urmează politica subsistemului. Pentru Constructor,
      numai publication/CI/release pot relua același handoff/commit; rezultatul
      workerului/modelului/ordinului rămâne terminal și nu intră în retry.
- [ ] Monitorul arată progresul remedierii și rezultatul, nu doar alerta.

### ADM-012 Notificări

Owner: notification service. Stare: `parțial`.

- [ ] Fiecare notificare referă obiectul canonic și nu copiază o stare divergentă.
- [ ] Read/delivery/failure sunt persistente, idempotente și probate.
- [ ] Notificarea nu devine substitut pentru work item, incident sau receipt.

### ADM-013 Creier OpenAI

Owner: AI runtime. Stare: `degradat observat, cauză fină necunoscută`.

- [ ] Health diferențiază credential, model/access, quota/rate, relay și provider.
- [ ] UI afișează cauza redactată, impactul, retry-ul și acțiunea canonică.
- [ ] Modelul folosit, request receiptul și evaluarea răspunsului sunt trasabile.

### ADM-014 Monitor și provider health

Owner: Stage/observability projection. Stare: `parțial`.

- [ ] Fiecare operație vizibilă are status 0–100 derivat numai din evenimente persistente.
- [ ] Timeline-ul supraviețuiește refreshului și redă tranziții în limbaj simplu.
- [ ] Becul providerului leagă incidentul/cauza și nu reduce toate erorile la credit.

### ADM-015 Fișa canonică și intake

Owner: work orchestration. Stare: `în lucru, nepublicat`.

- [ ] Orice cerere scrisă/vorbită creează sau actualizează exact o fișă canonică.
- [ ] Fișa conține obiectiv, criterii, surse, actor, plan/pas, stare/progres,
      heartbeat, decizii, aprobări, dovezi, riscuri, escaladare și închidere.
- [ ] Fiecare eveniment de execuție referă fișa, iar Admin și Stage o proiectează.
- [ ] După refresh se vede aceeași stare; lipsa DB nu este mascată prin card gol.

### ADM-016 Frontiera Admin

Owner: auth/security. Stare: `verificat în cod, live necunoscut`.

- [ ] Fiecare rută Admin refuză sesiuni non-admin și păstrează CSRF/origin policy.
- [ ] Mutațiile au rate limit, audit și confirmare proporțională cu impactul.
- [ ] Nicio cheie, comandă brută sau diagnostic sensibil nu ajunge în UI.

### ADM-017 Istoric activitate și audit

Owner: audit platform. Stare: `planificat post-fundație`.

- [ ] Timeline-ul unifică vizite, suprafețe, acțiuni, jobs, rezultate și config changes.
- [ ] Schema definește retenție, RBAC, minimizare, export și ștergere.
- [ ] Deciziile și rezultatele au obiect, actor, timestamp și link canonic.

### ADM-018 Live Voice

Owner: voice runtime + Constructor incident recovery. Stare: `P0, eșuat live`.

- [ ] Eșecul capture/session/auth/relay/provider este clasificat din dovadă redactată.
- [ ] Retry-ul este limitat, observabil și schimbă strategia; nu formează buclă invizibilă.
- [ ] Fallbackul este etichetat și nu închide incidentul ca succes.
- [ ] Incidentul are fișă/timeline persistentă și escaladare după epuizare.
- [ ] Testul real dovedește microfon -> transport -> transcript românesc -> răspuns audio.

## Auditul constantelor și hardcodărilor cunoscute

Acest tabel nu legitimează automat constantele. El păstrează ownerul și
rațiunea până la auditul complet al aplicației.

| Constantă/comportament | Locație | Clasificare | Owner / rațiune | Acțiune |
| --- | --- | --- | --- | --- |
| Poll Constructor `2500 ms` | `Stage.tsx` | intenționată UI | monitor frontend; latență de refresh, nu progres | Mută în config dacă devine policy operațională. |
| Poll health `60 s` | `Stage.tsx` | intenționată UI | provider lights; limitează trafic | Păstrează procentul independent de timer. |
| Poll erori/notificări `20 s` | `AdminPanel.tsx` | intenționată UI | refresh Admin | Preferă push/event stream după fundație. |
| 25 puncte și `0,5%`/punct | `Stage.tsx` | prezentare | vizualizarea unei valori persistente | Testează că nu generează procentul. |
| Limite text `500` și log `20000` | `routes/constructor.ts` | securitate/stocare | limitează payload/log sanitizat | Documentează și testează truncarea. |
| Mesaj „worker în max. 2 minute” | `adminText.ts` | defect | SLA hardcodat fără stare autoritativă | Înlocuiește cu heartbeat/policy observabilă. |
| Retry Live Voice până la `15 s` | `ChatPanel`/`vocalLive` client | parțial | protecție UX locală | Mută cauza/bugetul în incident canonic și testează epuizarea. |
| Timere toast/peek/copy | `AdminPanel.tsx`, `Stage.tsx` | cosmetic | feedback efemer, fără efect asupra stării | Păstrează separate de status/progres. |
| Lista OpenAI + căutare | `creditAI` | limită de produs | singurele integrații contorizate aici | Nu o folosi drept inventar complet al agenților. |

## Reguli de întreținere

- Un modul nou intră mai întâi în registry-ul canonic, primește ID stabil,
  owner, autoritate, risc și dovadă de acceptare.
- Un endpoint, buton sau tab fără work item este defect de trasabilitate.
- Starea runtime nu se copiază manual aici; se păstrează linkul către autoritate.
- Un check local poate marca `verificat în cod`, niciodată `live`.
- Orice schimbare de stare actualizează [`CURRENT.md`](CURRENT.md), nu o a doua
  coloană concurentă în alte documente.
- Work item-urile P0 se închid înaintea auditului extensiv P1/P2.
- Cercetare, senzori, instrumente, medical/veterinar, agenți endpoint și alte
  capabilități viitoare rămân roadmap post-release; inventarierea lor nu este
  dovadă de implementare.

## Criteriul global de acceptare al inventarului

- [ ] Toate cele 13 taburi din `ADMIN_TABS` au exact un work item în acest registru.
- [ ] Toate suprafețele transversale Admin au owner și autoritate unice.
- [ ] Fiecare item are sănătate, completitudine, hardcoding, monitor și dependențe.
- [ ] Fiecare item are dovadă nominalizată pentru închidere, nu o afirmație generică.
- [ ] P0 reflectă blocajele release reale și nu este depășit de cleanup/roadmap.
- [ ] La reluarea sesiunii, handofful din `CURRENT.md` este prezentat înaintea
      oricărei cereri de repetare a contextului.
