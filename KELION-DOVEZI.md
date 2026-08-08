# KELION — DOVEZILE (§7 din proiectul aprobat)

> Tabelul cerut de owner: **fiecare funcție cu dovada ei.** Ancorat 100% în codul
> real (nu inventat). Însoțește `KELION-CREIER-UNIC.md` §7.
>
> **Ce dovedește ce:**
> - **Paznicul** (`backend/src/brainCapabilities.test.ts`, în CI) dovedește, verificabil,
>   că creierul **ȚINE (are rutată) fiecare funcție** — zero adormite ascunse.
> - Coloana **„Cum se dovedește"** spune, per funcție, dacă proba se poate face
>   pe **server** (fără owner) sau **NECESITĂ owner live** (sesiunea/dispozitivul
>   lui: voce, cameră, GPS, monitor, token-ul Google, trimitere reală de email).
>   Codul arată calea de execuție; proba finală a EFECTULUI, pentru rândurile
>   „owner live", o dă Adrian din contul lui.

## Numărători exacte (din registrul unic `CAPABILITIES`, măsurate)

- **Total capabilități:** **69**
- **Pe chat** (`chat: true`): **66** (toate mai puțin `look`, `get_monitor`, `get_location`)
- **Pe voce** (`voice: true`): **31** — coincide cu plafonul MĂSURAT al OpenAI Realtime (`MAX_VOICE_TOOLS = 31` în `services/realtime.ts`)
- **`dormantOnChat`** (pe voce, dar NU pe chat): **3** → `look`, `get_monitor`, `get_location`
- Categorii: google 22, cod 15, browser 9, afișare 6, memorie 6, ops 3, vedere 3, bani 3, diverse 2
- **76 teste verzi** (typecheck 0).

### `dormantOnVoice()` — pe chat, dar NU încă pe voce (38 nume)
`show_document`, `read_email`, `delete_calendar_event`, `complete_task`, `read_drive_file`, `list_source`, `read_source`, `search_source`, `build_software`, `constructor_status`, `repo_write`, `repo_open_pr`, `repo_merge_pr`, `request_repair`, `run_runbook`, `runbook_status`, `runbook_log`, `db_tables`, `db_query`, `system_health`, `server_logs`, `propose_tool`, `browser_open`, `browser_click`, `browser_type`, `browser_read`, `browser_back`, `browser_scroll`, `browser_close`, `browser_key`, `browser_click_at`, `list_memories`, `forget_memory`, `read_inbox`, `get_real_cost`, `list_updates`, `prepare_promo_clip`, `log_unsupported_request`

> Notă: pe voce, uneltele de introspecție/constructor (`list_source`…`system_health`,
> `build_software`, `constructor_status`) NU sunt unelte directe (plafonul de 31),
> dar creierul le atinge prin escaladarea `ask_brain` → `voiceBrainTurn`/`execIntrospection`,
> admin-gated (lacăt admin). Deci nu sunt „adormite": sunt accesibile prin creierul unic.
>
> **Zero rânduri „NECESITĂ re-auth Google":** toate skill-urile Google (inclusiv
> ștergere calendar, complete task, read email/drive) folosesc scope-urile DEJA acordate.

---

## 2.1 `afisare` — Comunicare & afișare pe monitor

| Funcție | chat? | voce? | Unde e implementată | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| show_on_screen | ✅ | ✅ | chat: `chat.ts runTool 'show_on_screen'` (frame `{monitor}`); voce: `ChatPanel.tsx onToolCall` (client) | NECESITĂ owner live | „afișează X pe ecran" → apare |
| show_document | ✅ | — | chat: `chat.ts runTool 'show_document'` | NECESITĂ owner live | „afișează un document" → vizibil |
| run_web_app | ✅ | ✅ | chat: `runTool 'run_web_app'`; voce: `ChatPanel.tsx onToolCall` → `{app}` | NECESITĂ owner live | „scrie o mini-aplicație" → rulează |
| generate_image | ✅ | ✅ | chat: `runTool` → `image.ts generateImage`; voce: `/api/realtime/tool` → `generateImage` | NECESITĂ owner live (generarea e server) | „cere o imagine" → apare pe monitor |
| open_app_view | ✅ | ✅ | chat: `runTool 'open_app_view'` (`{nav}`); voce: `ChatPanel.tsx` → `kelion:navigate` | NECESITĂ owner live | „deschide setările" → se deschid |
| play_avatar_gesture | ✅ | ✅ | chat: `runTool 'play_avatar_gesture'`; voce: `ChatPanel.tsx` → `{gesture}` | NECESITĂ owner live | „salută" → avatarul salută |

## 2.2 `google` — Skill-uri Google (22)

Chat: `chat.ts runTool` → `google.ts runGoogleTool`. Voce: `/api/realtime/tool` → `runGoogleTool`.

| Funcție | chat? | voce? | Funcția reală (`google.ts`) | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| get_recent_emails | ✅ | ✅ | `recentEmails` | owner live (token Gmail) | „ce emailuri am?" → listă reală |
| read_email | ✅ | — | `readEmail` | owner live (token Gmail) | „citește emailul de la X" → corpul real |
| send_email | ✅ | ✅ | `sendEmail` | owner live (trimite din contul lui) | „trimite un mail lui X" → ajunge |
| get_calendar_events | ✅ | ✅ | `calendarEvents` | owner live | „ce am azi?" → evenimente reale |
| create_calendar_event | ✅ | ✅ | `createCalendarEvent` | owner live | „pune o întâlnire mâine la 10" → apare |
| delete_calendar_event | ✅ | — | `deleteCalendarEvent` | owner live (scope existent) | „anulează întâlnirea de la 3" → dispare |
| complete_task | ✅ | — | `completeTask` | owner live | „bifează task-ul X" → done |
| get_drive_files | ✅ | ✅ | `driveFiles` | owner live | „ce am pe drive?" → listă reală |
| read_drive_file | ✅ | — | `readDriveFile` | owner live | „citește documentul X" → conținut real |
| get_tasks | ✅ | ✅ | `getTasks` | owner live | „ce task-uri am?" → listă reală |
| add_task | ✅ | ✅ | `addTask` | owner live | „adaugă un task" → apare în Tasks |
| search_contacts | ✅ | ✅ | `searchContacts` | owner live | „găsește contactul X" → real |
| add_contact | ✅ | ✅ | `addContact` | owner live | „adaugă contactul X" → real |
| web_search | ✅ | ✅ | `webSearch` (fără token user) | **SERVER** | întrebare de actualitate → rezultat |
| youtube_search | ✅ | ✅ | `youtubeSearch` + `ytPlayable` | **SERVER** | „pune melodia X" → redă cu sunet |
| get_weather | ✅ | ✅ | `weather` (Open-Meteo, keyless) | **SERVER** (nume loc); „aici" = GPS → owner | „ce vreme e aici?" → vremea locului |
| maps_search | ✅ | ✅ | `mapsSearch` (Nominatim) | **SERVER** | „unde e X?" → loc pe hartă |
| maps_directions | ✅ | ✅ | `mapsDirections`/`osrmRoute` | **SERVER** | „cum ajung la X?" → traseu |
| translate_text | ✅ | ✅ | `translateText` | **SERVER** | „tradu în engleză" → traducere |
| wikipedia_lookup | ✅ | ✅ | `wikipediaLookup` (keyless) | **SERVER** | întrebare enciclopedică → rezultat |
| convert_currency | ✅ | ✅ | `convertCurrency` (keyless) | **SERVER** | „cât e 100€ în lei?" → curs real |
| get_time | ✅ | ✅ | `getTime` (`Intl`, server) | **SERVER** | „cât e ceasul?" → ora REALĂ |

## 2.3 `cod` — Propriul cod, DB, expert (admin)

| Funcție | chat? | voce? | Unde e implementată | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| list_source | ✅ | (ask_brain) | `chat.ts runTool` → `sourceCode.ts listSource`; def `brainToolDefs.LIST_SOURCE_TOOL` | **SERVER** | „arată-mi fișierul X" → conținut |
| read_source | ✅ | (ask_brain) | `runTool` → `readSource` | **SERVER** | „arată-mi fișierul X" → conținut |
| search_source | ✅ | (ask_brain) | `runTool` → `searchSource` | **SERVER** | „caută X în cod" → potriviri |
| build_software | ✅ | (ask_brain) | `runTool` → `db.ts createBuildJob` (worker VPS → PR) | **SERVER** (rând `build_jobs` + PR) | „construiește X" → PR deschis |
| constructor_status | ✅ | (ask_brain) | `runTool` → `listBuildJobs` | **SERVER** | „unde e ordinul?" → pasul curent |
| repo_write | ✅ | — | `runTool` → `github.ts repoWrite` | **SERVER** (commit GitHub) | reparație → fișier scris pe branch |
| repo_open_pr | ✅ | — | `runTool` → `repoOpenPR` | **SERVER** (PR GitHub) | → PR deschis |
| repo_merge_pr | ✅ | — | `runTool` → `repoMergePR` | **SERVER** (merge + deploy) | → merge → live |
| request_repair | ✅ | — | `runTool` → `runbooks.ts requestRepair` | **SERVER** (`work_orders` + email) | ordin greu → salvat + email |
| db_tables | ✅ | (ask_brain) | `runTool` → `db.ts dbTablesOverview` | **SERVER** | „ce tabele ai?" → schema reală |
| db_query | ✅ | (ask_brain) | `runTool` → `db.ts dbQuery` | **SERVER** | „câți useri am?" → număr real |
| system_health | ✅ | (ask_brain) | `runTool` → `health.ts systemHealth` | **SERVER** | „ești bine?" → raport health |
| server_logs | ✅ | — | `runTool` → `logbuffer.ts recentLogs` | **SERVER** | „ai erori?" → erorile reale |
| ask_brain | ✅ | ✅ | chat: `execTool` → `brain.ts brainComplete`; voce: `/api/realtime/tool` → `voiceBrainTurn` (orchestrator + unelte admin) | **SERVER** | cerere grea → răspuns corect |
| propose_tool | ✅ | — | chat: `execTool` → `db.ts proposeKelionTool` | **SERVER** (rând `pending`) | îi lipsește o unealtă → o propune |

## 2.3b `ops` — Operații VPS (admin)

| Funcție | chat? | voce? | Unde e implementată | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| run_runbook | ✅ | — | `runTool` → `runbooks.ts runRunbook` (GitHub Actions) | **SERVER** (log Actions) | „diagnostic" → raport real |
| runbook_status | ✅ | — | `runTool` → `runbookStatus` | **SERVER** | „ce-ai rulat?" → status real |
| runbook_log | ✅ | — | `runTool` → `runbookLog` | **SERVER** | „arată jurnalul rulării N" → jurnal |

## 2.4 `browser` — Browser live (9)

Toate: `chat.ts runTool` cases `browser_*` → `services/browser.ts` (Chromium real pe server → titlu + text + elemente numerotate).

| Funcție | chat? | voce? | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|
| browser_open | ✅ | — | **SERVER** (pagina revine ca text) | „intră pe X" → se deschide |
| browser_click | ✅ | — | **SERVER** | „dă click pe N" → navighează |
| browser_type | ✅ | — | **SERVER** | „scrie X în câmpul N" → tastat |
| browser_read | ✅ | — | **SERVER** | „citește pagina" → text real |
| browser_back | ✅ | — | **SERVER** | „înapoi" → pagina precedentă |
| browser_scroll | ✅ | — | **SERVER** | „derulează" → mai mult conținut |
| browser_close | ✅ | — | **SERVER** | „închide browserul" → curățat |
| browser_key | ✅ | — | **SERVER** | „apasă Enter" → tasta trimisă |
| browser_click_at | ✅ | — | **SERVER** | „click la x,y" → click pe coordonate |

## 2.5 `memorie` — Memorie, note, inbox propriu

| Funcție | chat? | voce? | Unde e implementată | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| save_note | ✅ | ✅ | chat+voce → `db.ts saveNote` | **SERVER** (rând DB) | „ține minte asta" → o regăsește |
| list_notes | ✅ | ✅ | → `listNotes` | **SERVER** | „ce am salvat?" → listă reală |
| delete_note | ✅ | ✅ | → `deleteNote` | **SERVER** | „șterge notița N" → dispare |
| list_memories | ✅ | — | → `db.ts getMemories` | **SERVER** | „ce știi despre mine?" → real |
| forget_memory | ✅ | — | → `db.ts deleteMemory` | **SERVER** | „uită că…" → șters |
| read_inbox | ✅ | — | → `mailbox.ts fetchRecentInbox` | **SERVER** (inbox app) | „ce mail a venit?" → listă reală |

## 2.6 `vedere` — Vedere & loc (doar voce)

| Funcție | chat? | voce? | Unde e implementată | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| look | — | ✅ | client: `ChatPanel.tsx onToolCall 'look'/'see'` → cadru cameră → `/api/realtime/tool` → `describeScene` | NECESITĂ owner live (camera) | „ce vezi pe cameră?" → descrie real |
| get_monitor | — | ✅ | client: `onToolCall 'get_monitor'` → `getWorkspace()` | NECESITĂ owner live (monitorul lui) | „ce e pe ecran?" → citește ce e afișat |
| get_location | — | ✅ | client: `onToolCall 'get_location'` → `getFreshCoords()` + hartă OSM | NECESITĂ owner live (GPS-ul lui) | „unde sunt?" → locul real |

## 2.7 `bani` — Bani & stare (admin)

| Funcție | chat? | voce? | Unde e implementată | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| get_real_cost | ✅ | — | `runTool` → `db.ts getCostSummary` | **SERVER** (DB cost) | „cât m-a costat?" → cifra reală |
| list_updates | ✅ | — | `runTool` → `updates.ts updatesList` | **SERVER** | „ce nou ai?" → lista reală |
| prepare_promo_clip | ✅ | — | `runTool` (`PROMO_TOOL`, `promoSceneUrl`) | NECESITĂ owner live (recorder în client) | cere un clip → scenariul armat |

## Diverse

| Funcție | chat? | voce? | Unde e implementată | Cum se dovedește | Testul live |
|---|:--:|:--:|---|---|---|
| log_unsupported_request | ✅ | — | `execTool` → `db.ts logCapabilityGap` | **SERVER** (rând DB) | cer ceva imposibil → notat + spune sincer |
| set_active_role | ✅ | ✅ | chat+voce → `db.ts setMeserieActivaPref` | **SERVER** (pref DB) | „treci pe rolul de bucătar" → rol activ |

---

## Cum se citește tabelul (onest)
- **SERVER** = pot proba eu, fără tine, prin rută/DB/GitHub/health (majoritatea uneltelor de cod, browser, ops, memorie, o parte din Google keyless).
- **NECESITĂ owner live** = proba efectului cere sesiunea/dispozitivul tău (voce, cameră, GPS, monitor, token-ul tău Google, trimitere reală de email). Codul e acolo și verificat; efectul îl confirmi tu.
- **Paznicul** garantează în CI că fiecare rând de mai sus e chiar rutat în creier — „adormit ascuns" e imposibil.
