# KELION — CREIERUL UNIC: ce va face, tot, cu dovadă

> Specificație oficială, aprobată de owner (Adrian). Scop: **un singur creier**
> care ține REAL tot ce are softul — nimic adormit, nimic separat — ancorat în
> realitate, și fiecare funcție **dovedită live** la final.
>
> Regula de aur: **dacă o funcție există în soft dar creierul nu ajunge la ea,
> e BUG, nu stare acceptată.** O verificare automată o prinde (vezi §5).

## 1. Principiul — un singur creier
Nu trei (scris / voce / expert). Același creier, aceleași funcții, aceeași
memorie și aceeași ancorare, fie că îi scrii, fie că îi vorbești. Ce poate
scrisul, poate și vocea. Fără liste separate, fără dispecer, fără duplicare.

## 2. TOT ce ține creierul (inventar complet — 61 funcții)
Coloana **DOVADA** = proba live pe care o aduc la final pentru fiecare.

### 2.1 Comunicare & afișare pe monitor
| Funcție | Ce face | DOVADA finală |
|---|---|---|
| show_on_screen | pune orice URL/dată pe monitor | îi cer să afișeze X → apare pe ecran |
| show_document | pune un text/rezultat pe monitor | afișează un document → vizibil live |
| run_web_app | rulează o pagină scrisă de el (izolat) | scrie o mini-aplicație → rulează pe monitor |
| generate_image | generează o imagine | cere o imagine → apare pe monitor |
| open_app_view | deschide panourile aplicației | „deschide setările" → se deschid |
| play_avatar_gesture | avatarul face un gest | cere un salut → avatarul salută |

### 2.2 Google (18) — toate, și pe voce, și pe scris
| Funcție | Ce face | DOVADA finală |
|---|---|---|
| get_recent_emails | citește emailurile recente | „ce emailuri am?" → listă reală |
| send_email | trimite email | „trimite un mail lui X" → ajunge |
| get_calendar_events | citește calendarul | „ce am azi?" → evenimente reale |
| create_calendar_event | pune un eveniment | „pune o întâlnire mâine la 10" → apare în calendar |
| get_drive_files | listează fișierele Drive | „ce am pe drive?" → listă reală |
| get_tasks / add_task | citește / adaugă task-uri | „adaugă un task" → apare în Tasks |
| search_contacts / add_contact | caută / adaugă contacte | „găsește contactul X" → real |
| web_search | căutare web | întrebare de actualitate → rezultat real |
| youtube_search | caută + redă YouTube | „pune melodia X" → redă cu sunet |
| get_weather | vremea (cu GPS-ul real) | „ce vreme e aici?" → vremea locului |
| maps_search / maps_directions | locuri / trasee | „cum ajung la X?" → traseu pe monitor |
| translate_text | traduce | „tradu asta în engleză" → traducere |
| wikipedia_lookup | caută pe Wikipedia | întrebare enciclopedică → rezultat |
| convert_currency | schimb valutar | „cât e 100€ în lei?" → curs real |
| get_time | ora/data | „cât e ceasul?" → ora REALĂ (vezi §3) |

### 2.3 Propriul cod & autonomie (constructor + expert)
| Funcție | Ce face | DOVADA finală |
|---|---|---|
| list_source / read_source / search_source | vede orice fișier din codul lui | „arată-mi fișierul X" → conținut real |
| build_software | dă un ordin de construcție | „construiește X" → PR deschis |
| constructor_status | starea ordinelor | „unde e ordinul?" → pasul curent |
| repo_write / repo_open_pr / repo_merge_pr | scrie cod, PR, merge | o reparație → PR → merge → live |
| request_repair | notează un ordin de reparație durabil | ordin greu → salvat + email |
| run_runbook (+8) | operații pe VPS (diagnostic, restart, backup...) | „diagnostic" → raport real |
| runbook_status / runbook_log | starea + jurnalul rulărilor | „ce-ai rulat?" → jurnal real |
| db_tables / db_query | vede baza de date | „câți useri am?" → număr real din DB |
| system_health | sănătatea proprie | „ești bine?" → raport health real |
| server_logs | jurnalele serverului | „ai erori?" → erorile reale |
| ask_brain | raționament profund (cod, analiză) | cerere grea → răspuns corect |
| propose_tool | își cere singur o unealtă nouă | îi lipsește o unealtă → o propune, o aprobi, o folosește |

### 2.4 Browser live (9)
| Funcție | Ce face | DOVADA finală |
|---|---|---|
| browser_open/click/type/read/back/scroll/close/key/click_at | navighează un site real, ca un om | „intră pe X și fă Y" → o face, vizibil |

### 2.5 Memorie, note, inbox propriu
| Funcție | Ce face | DOVADA finală |
|---|---|---|
| save_note / list_notes / delete_note | notițe | „ține minte asta" → o regăsește |
| list_memories / forget_memory | memoria lui de lungă durată | „ce știi despre mine?" → real |
| read_inbox (NOU) | își citește propria cutie poștală | azi NU putea — va putea |

### 2.6 Vedere & loc
| Funcție | Ce face | DOVADA finală |
|---|---|---|
| look | camera (te vede pe tine / ce-i arăți) | „ce vezi pe cameră?" → descrie real |
| get_monitor | ce e FAPTIC pe monitor | „ce e pe ecran?" → citește ce e afișat |
| get_location | GPS-ul real al dispozitivului | „unde sunt?" → locul real |

### 2.7 Bani & stare
| Funcție | Ce face | DOVADA finală |
|---|---|---|
| get_real_cost | costul real | „cât m-a costat?" → cifra reală |
| list_updates | ce update-uri a primit | „ce nou ai?" → lista reală |
| prepare_promo_clip | pregătește un clip promo | cere un clip → scenariul armat |

## 3. Ancorat în realitate (nu poate fi păcălit)
La FIECARE tură, pe scris ȘI pe voce, creierul primește:
- **data + ora reală** (gata cu „bună seara" dimineața),
- **locul** (GPS), **ce e pe monitor**, **starea lui** (health).

Regulă fermă: **nu inventa** fapte / vreme / date / prețuri / rezultate pe care
o unealtă nu i le-a întors. Dacă nu știe → o spune sincer. Minciuna declarativă
(„am făcut" fără unealtă) e interzisă.

**DOVADA:** îl întreb ora prin voce dimineața → spune „bună dimineața" + ora
corectă. Îi cer un fapt fără unealtă → spune sincer că nu știe, nu inventează.

## 4. Ce va FACE (comportament) — AI VIU, CU CREIER, TOTAL INDEPENDENT
- Gândește înainte să acționeze; **cheamă unealta**, nu declară că a făcut.
- Duce o cerință până la capăt **singur, total independent**: caută → încearcă → verifică → livrează, fără să ceară voie la fiecare pas.
- **Conștient de ce-i lipsește:** dacă o sarcină cere ceva ce nu are (o dependență, o unealtă, un pas), **își dă seama singur, și-l instalează / și-l cere (`propose_tool`, constructor, `npm install`, runbook), apoi termină sarcina** — nu se oprește cu „nu pot".
- Același creier pe voce și pe scris.
- Când chiar nu poate (imposibil, nu doar lipsă), spune sincer și de ce.

## 5. Garanția că ține TOT (paznicul cerut de owner)
O verificare automată compară **lista funcțiilor softului** cu **ce ține
creierul**. Dacă o funcție există și creierul nu ajunge la ea → verificarea
**pică roșu** (în CI). Deci „adormit" devine imposibil, nu o promisiune.

**DOVADA:** rulez testul de completitudine → toate funcțiile softului = în
creier, zero adormite. Ieșirea testului ți-o arăt.

## 6. Compromisul real (unul singur, spus de la început)
Ca vocea să țină TOATE funcțiile — fără creier de voce separat, fără dispecer —
vocea devine urechile+gura ACELUIAȘI creier: ce auzi → creierul complet → ce
vorbește. Poate adăuga o fracțiune de întârziere față de vocea ultra-rapidă de
azi. Ăsta e prețul real ca vocea să fie la fel de deșteaptă ca scrisul.

## 7. Cum livrez (pas cu pas, cu dovadă la fiecare)
Nu tot deodată. Miezul se rescrie mic și curat, cu aplicația vie tot timpul.
La FIECARE pas: build + deploy + **verificat live cu dovadă reală** (curl,
măsurare, înregistrare) — regula ta. Fără „gata" pe cuvânt.

La final: **tabelul de mai sus, fiecare rând bifat cu dovada lui.**

## 8. STAREA LIVRĂRII (dovezi — 29 iul)

**Fundația (LIVRATĂ, merge-uită, teste verzi):**
| Ce | Dovada |
|---|---|
| §5 Registrul unic (`brainCapabilities.ts`) + paznicul de completitudine | PR #501; paznicul verifică registrul față de `google.ts`/`runbooks.ts` REALE |
| §3 Ancorarea vocii în timp + anti-inventare pe voce (fix „bună seara" dimineața) | PR #501 |
| §1 Vocea derivă lista din registru (fără duplicare) | PR #502 |
| §5 Paznicul verifică completitudinea față de sursele reale | PR #503 |

**Capabilități adormite ACTIVATE (LIVRATE — creierul ajunge acum la ele):**
| Funcție | Dovada |
|---|---|
| `read_inbox` — își citește propria cutie poștală | PR #505 |
| `read_email` — corpul COMPLET al unui email | PR #506 |
| `delete_calendar_event` — șterge un eveniment | PR #507 |
| `complete_task` — bifează un task terminat | PR #507 |
| `read_drive_file` — citește conținutul unui fișier Drive | PR #508 |

Paznicul azi: registrul are **69 capabilități** — **chat 66**, **voce 31** (plafon măsurat), pe categorii (google 22, cod 15, browser 9, afișare 6, memorie 6, ops 3, vedere 3, bani 3, diverse 2), toate verificate contra codului real. **76 teste verzi.**

**MIEZUL — creier unic + ancorare (LIVRAT + LIVE, dovedit — 29 iul):**
| Ce | Dovada |
|---|---|
| §3 GPS „pune-mă pe hartă" — `get_location` deschide harta pe poziția reală | PR #514, LIVE; marker `openstreetmap.org/?mlat=` absent în bundle vechi, prezent în cel nou |
| §6 Vocea = ACELAȘI creier ca scrisul (escaladarea grea pe `runOrchestrator`, nu pe motor separat) | PR #515, LIVE (`3f11d51`); typecheck 0 + teste verzi |
| Audio pe căști Bluetooth (`setSinkId` + `devicechange`) | PR #516, LIVE (`9211629`); marker `setSinkId`+`devicechange` prezent în bundle |
| §1 Definițiile uneltelor de introspecție/constructor mutate în sursa comună (`brainToolDefs`) — fără duplicare | PR #517, LIVE (`7dd3ac3`) |
| §7 Tabelul de dovezi — fiecare funcție cu proba ei (`KELION-DOVEZI.md`) | PR #517, LIVE |
| §4 Auto-instalarea dependențelor — creierul le adaugă singur prin constructor (package.json/Dockerfile → PR → rebuild), NU prin apt live arbitrar (decizia owner-ului) | PR #518, LIVE (`9241b71`) |
| §6 COMPLET — TOATE turele cu conținut trec prin creierul unic; modelul de voce e doar urechile+gura + acțiunile de dispozitiv (ordinul „fă-l complet") | PR #519, LIVE (`a3285a6`) |
| Creierul NU mai e FORȚAT să cheme o unealtă la orice verb — ascultă cerința, decide singur (cauza „face ce vrea el, hardcodat"); poarta faptei rămâne plasa | PR #520, LIVE (`f06486c`) |
| CALEA AUTONOMIEI COMPLETĂ PE VOCE — vocea are acum aceleași unelte ca scrisul (repo_write/open_pr/merge_pr, run_runbook/status/log, request_repair): de la cererea ta până la deploy final, pe toate rutele | această livrare |

**§4 CREIERUL PLĂTIT — CORECȚIE DE ADEVĂR (30 iul, LIVE `8a5e32e`):**
| Ce | Dovada |
|---|---|
| **Minciună corectată:** intrarea veche zicea „owner-ul a setat un model PLĂTIT performant". FALS în practică: chiar dacă env-ul era setat, ruta ownerului **cădea pe modele `:free`** (gemma-4-26b / nemotron-nano / gemini-flash-free) prin override-ul `geminiWork` + `resolveModel('work', null)` la orchestrator. De-aia „creierul plătit era prost ca free" — chiar ERA free. §4 (a raționa) era rupt, nu §3. | Owner a testat live: oră greșită după 2 corecții, vreme→Abingdon (IP), „nu ascultă" |
| **FIX:** `bestPaidWorkModel()` (openrouter.ts) — ownerul primește ÎNTOTDEAUNA cel mai bun model PLĂTIT cu vedere+unelte din catalogul LIVE (preferă Claude/Anthropic), pe chat ȘI voce (§6). Gardă anti-spargere: punga goală → rămâne free funcțional. Public/demo NEATINSE (§5 cost demo). | PR #527, LIVE `8a5e32e`; `/api/version` 16b4a41→8a5e32e + health 200 |
| **Principiul permanent unic-fără-duplicate:** clone reale scoase (openrouter/stripe/google/db/auth/... + module comune githubApi/sse/clientIp), jscpd **50→16** (1.51%→0.59%). Cele 16 rămase sunt inevitabile (tipuri de contract backend↔frontend, semnături de interfață, CSS/JSX) — explicat, NU forțat. | PR #527, LIVE; `npx jscpd` la fiecare PR (CI) |

**§1 „CE POATE SCRISUL, POATE ȘI VOCEA" — ÎNCHIS (30 iul, LIVE `4442d2b`):**
| Ce | Dovada |
|---|---|
| **Golul măsurat:** registrul avea 66 capabilități pe scris și doar **31 pe voce** → **38 adormite**. Cauza: sesiunea OpenAI Realtime e plafonată la 31 de unelte — dar plafonul se aplică DOAR listei directe a modelului de voce; creierul ESCALADAT (același `runOrchestrator`, §6) nu are limita asta, și nimeni nu-i dăduse uneltele. | `dormantOnVoice()` din registru, măsurat înainte/după |
| **Google complet pe voce** (`read_email`, `delete_calendar_event`, `complete_task`, `read_drive_file`) — executate cu `runGoogleTool` pe tokenul userului, exact ca la scris | PR #529, LIVE `93d5e0e` |
| **Unelte legate de user** (`list_updates`, `read_inbox`, `server_logs`, `get_real_cost`, `list_memories`, `forget_memory`, `log_unsupported_request`) — executor comun NOU `execUserScopedTool`, sursă unică folosită de chat ȘI de voce | PR #529, LIVE `93d5e0e` |
| **Browserul live pe voce (9 unelte)** — definițiile erau LOCALE în `chat.ts` (deci vocea nu avea cum să le ceară); mutate în `brainToolDefs`, executor unic `runBrowserTool`, screenshot pe monitor prin câmpul `screen` al răspunsului `ask_brain` | PR #530, LIVE `4442d2b` |
| **`show_document` + `propose_tool` pe voce** | PR #530, LIVE `4442d2b` |
| **REZULTAT: adormite pe voce 38 → 1.** Vocea ajunge la **68 din 69** capabilități (scrisul: 66). Singura rămasă: `prepare_promo_clip` — cere butonul Rec din client, e legată fizic de interfață. | registru + paznicul §5, 74/74 teste |

**RĂMAS (onest — NU „gata"):**
- **Testul LIVE al owner-ului pe creierul plătit:** dă-i o sarcină de RAȚIONAMENT + mai mulți pași (§4), nu „cât e ceasul" (aia e podeaua/§3). Se confirmă că gândește DOAR pe rezultat.
- **Dependențe reale ale locației/creierului plătit:** (1) sold pe OpenRouter — punga goală ține creierul pe free; (2) permisiunea GPS din browser — refuzată → cade pe IP (Abingdon). Astea NU le repară modelul; se verifică separat.
- Skill-uri cu scope-uri Google NOI (Photos, YouTube personal) → cer re-conectarea Google.
- Restul rândurilor din §2: fiecare are nevoie de proba LIVE a owner-ului pentru bifă.
