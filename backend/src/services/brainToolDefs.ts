// ── SINGLE SOURCE of shared tool definitions (SINGLE BRAIN §1) ──────────────
// Adrian: "don't multiply the duplications; a single brain". The tool
// definitions lived ONLY in chat.ts, so voice couldn't use them without
// copying them. This is the common source: defined once, used by both chat
// and voice.
//
// INCREMENTAL migration (so we don't risk live chat.ts with one big move): we
// start with the OWN-CODE ACCESS tools (their executor is already decoupled in
// sourceCode.ts). The rest are brought here a few at a time, verified.

import type { Tool } from './brain-types.js'
import { ROSTER } from './agentiKelion.js'

export const LIST_SOURCE_TOOL: Tool = {
  name: 'list_source',
  description:
    "ADMIN ONLY. List your own source code tree — the WHOLE repo: backend/, frontend/, deploy/, .github/workflows/, docs. Use to orient before reading files.",
  input_schema: { type: 'object', properties: { dir: { type: 'string', description: "Subdirectory (e.g. 'backend/src/routes'); default root." } } },
}

export const READ_SOURCE_TOOL: Tool = {
  name: 'read_source',
  description:
    "ADMIN ONLY. Read one of your own source files (with line numbers). Use for diagnosing bugs the owner reports — look at the REAL code. Large files are paged ~24KB at a time; to read the REST of a big file, call again with from_line set to the number shown in the '…continue' footer — this way you can read ANY file completely.",
  input_schema: { type: 'object', properties: { path: { type: 'string', description: "Repo-relative path, e.g. 'backend/src/routes/chat.ts'." }, from_line: { type: 'integer', description: 'Optional: start reading from this line number (for paging through a large file). Default 1.' } }, required: ['path'] },
}

export const SEARCH_SOURCE_TOOL: Tool = {
  name: 'search_source',
  description: "ADMIN ONLY. Search your own source code (regex/text) — returns file:line matches. Use to find where a feature/bug lives.",
  input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Text or regex to search for.' } }, required: ['query'] },
}

// "Sees its own state": the database + health. Executors decoupled in
// db.ts (dbTablesOverview/dbQuery) and health.ts (systemHealth).
export const DB_TABLES_TOOL: Tool = {
  name: 'db_tables',
  description:
    "ADMIN ONLY. See YOUR OWN permanent storage: every table in the application's Postgres database, with its columns and live row count. This is the real persisted state (users, wallets, transactions, messages, memories, voiceprints...). Call it before db_query when you need the exact table/column names.",
  input_schema: { type: 'object', properties: {} },
}

export const DB_QUERY_TOOL: Tool = {
  name: 'db_query',
  description:
    "ADMIN ONLY. Run ONE SQL statement directly on the application's Postgres database — full access, SELECT or write. Results are capped at 200 rows. HOUSE RULES: destructive statements (DELETE/DROP/TRUNCATE/UPDATE on money tables: wallets, transactions, billing_events, cost_events) ONLY when the owner explicitly ordered that exact change in this conversation — never on your own initiative. Always look at db_tables first if unsure of names.",
  input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'The SQL statement to execute.' } }, required: ['sql'] },
}

export const SYSTEM_HEALTH_TOOL: Tool = {
  name: 'system_health',
  description:
    "ADMIN ONLY. See your OWN health: publication sync (live vs master), red workflow runs (48h), failed build orders, client-error spikes, disk, database, brain balance. CALL THIS at the START of a conversation with the owner (his first message of a session) and whenever he asks about problems or health. If problems exist: list them BRIEFLY (x, y, z) and ASK whether you should repair them — never repair on your own initiative; wait for his explicit yes, then use your tools (repo_write, build_software, run_runbook, db_query).",
  input_schema: { type: 'object', properties: {} },
}

// ── MEDIA CONTROL (OS-level) — owner's order #16 ──────────────────────────────
// Queries the OS media API (playerctl on Linux) to check playback state, pause
// if playing, and report the result. Used when the owner says "oprește ce-i pe
// monitor" so Kelion can confirm whether something was actually stopped.
export const MEDIA_CONTROL_TOOL: Tool = {
  name: 'media_control',
  description:
    "ADMIN ONLY. Control OS-level media playback. Call this when the owner says 'oprește ce-i pe monitor' or similar — it queries the native OS media API (playerctl on Linux) to check if anything is playing, sends pause if so, and returns the result so you can confirm verbally: either 'am oprit <player>' or 'nu rula nimic'. No arguments needed.",
  input_schema: { type: 'object', properties: {} },
}

// ── SERVER_OPS (VPS commands) — owner's requirement 127 ──────────────────────────────
export const SERVER_OPS_TOOL: Tool = {
  name: 'server_ops',
  description:
    "ADMIN ONLY. Run predefined VPS operations: uptime, df, free, docker_ps, log_constructor (tail of the constructor worker's host log), log_publicare (tail of the auto-publish/deploy host log). Timeout 20s, limit 8KB, audit logged. Rejects other commands.",
  input_schema: {
    type: 'object',
    properties: {
      cmd: {
        type: 'string',
        enum: ['uptime', 'df', 'free', 'docker_ps', 'log_constructor', 'log_publicare'],
        description: 'Predefined VPS command: uptime, df, free, docker_ps, log_constructor, log_publicare'
      }
    },
    required: ['cmd']
  }
}

// ── PR_LISTA — sistemul informațional al PR-urilor (P7; owner, 15 aug:
// „un sistem informational legat de creier cu toate datele din toate pr") ────
export const PR_LISTA_TOOL: Tool = {
  name: 'pr_lista',
  description:
    "ADMIN ONLY. Read ALL pull requests' real data straight from GitHub: number, title, branch, open/closed, MERGED or not, head sha, URL, created/updated. Use when the owner asks about PRs, their state, what's merged, or why a build order still waits. A failed read says so — never an empty list pretending 'no PRs'.",
  input_schema: {
    type: 'object',
    properties: {
      stare: {
        type: 'string',
        enum: ['open', 'closed', 'all'],
        description: "Which PRs: 'open', 'closed' or 'all' (default all, newest first)",
      },
    },
  },
}

// ── L1e: PROCESARE DE DATE TABELARE (CSV/JSON) — capabilitate generală ────────
// Ownerul (autonomie): Kelion trebuie să poată PROCESA date, nu doar să discute
// despre ele. Unealtă PURĂ: primește textul (CSV sau JSON, lipit de om sau adus
// de model cu alte unelte), îl parsează, face o agregare SAU un profil măsurat,
// și AFIȘEAZĂ tabelul + rezultatul pe monitor. Nu deschide URL-uri, nu atinge
// disc/DB — deci e sigură pentru oricine (nu lărgește suprafața de admin).
export const PROCESEAZA_DATE_TOOL: Tool = {
  name: 'proceseaza_date',
  description:
    'Process TABULAR DATA the user gives you — a CSV or JSON they pasted, or data you fetched with another tool. Parses it, then EITHER runs one aggregation (sum/avg/min/max/count/unique per group) OR profiles every column (type, min/max/sum/avg, empties, uniques), and SHOWS the table + result on the monitor. Use this whenever the user pastes rows/records and wants totals, averages, grouping, counts, or "what does this data say". Numbers are only treated as numbers when the value is clearly numeric — nothing is invented; empty results are shown as "—", not faked.',
  input_schema: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'The raw data as text: CSV (with a header row) or JSON (array of objects / NDJSON). Paste exactly what the user gave.' },
      format: { type: 'string', enum: ['auto', 'csv', 'json'], description: 'Force the parser; default "auto" detects CSV vs JSON.' },
      operatie: { type: 'string', enum: ['suma', 'medie', 'min', 'max', 'numar', 'numar_gol', 'numar_unic'], description: 'Optional aggregation. Omit to profile all columns instead. suma=sum, medie=avg, numar=row count, numar_gol=empty count, numar_unic=distinct count.' },
      valoare: { type: 'string', description: 'Column the aggregation runs on (required for suma/medie/min/max/numar_unic/numar_gol).' },
      grupeaza_dupa: { type: 'string', description: 'Optional column to group by; omit to aggregate over the whole table.' },
      titlu: { type: 'string', description: 'Optional title for the monitor panel.' },
    },
    required: ['date'],
  },
}

// ── HIS SETTINGS, SET BY HIMSELF (Adrian, Jul 30: "he should create the
// secrets and put them where they belong, it's mine and I allow him full
// access") ───────────────────────────────────────────────────────────────────
// The iron rule, also written in the description so the brain sees it: a
// secret's value is never repeated, never confirmed, never written anywhere.
// Only the name and its character count are reported.
export const SECRET_PUNE_TOOL: Tool = {
  name: 'secret_pune',
  description:
    "ADMIN ONLY. Set one secret (API key, token, link) in your OWN repository secrets, encrypted — this is how you configure yourself without the owner touching any portal. NEVER repeat, echo, confirm or write the value anywhere: not in your answer, not on the monitor, not in a file. Report only the NAME and its length. NEVER accept or send card numbers here. After setting one or more secrets, call secret_publica to push them to the server and restart the app, then say what you configured.",
  input_schema: {
    type: 'object',
    properties: {
      nume: { type: 'string', description: 'Secret name, UPPERCASE with underscores, e.g. REVOLUT_API_KEY.' },
      valoare: { type: 'string', description: 'The secret value. It is written encrypted and never returned.' },
    },
    required: ['nume', 'valoare'],
  },
}
export const SECRET_LISTA_TOOL: Tool = {
  name: 'secret_lista',
  description:
    'ADMIN ONLY. List which secrets EXIST (names + last update only — GitHub never returns values, by design). Use this to check whether a key you need is already configured, instead of asking the owner.',
  input_schema: { type: 'object', properties: {} },
}
export const SECRET_PUBLICA_TOOL: Tool = {
  name: 'secret_publica',
  description:
    'ADMIN ONLY. Push the repository secrets onto the production server and restart the app so it loads them (runs the vps-set-env workflow). Call this after secret_pune. Then verify with system_health or the admin panel that what you configured is now live.',
  input_schema: { type: 'object', properties: {} },
}

// ── THE OWNER'S REQUIREMENTS, CAUGHT IN FLIGHT (Adrian, Jul 30: "requirements
// management" · "I've asked you dozens of times") ────────────────────────────
// The `cerinte` table existed, but NOTHING filled it: his requirements stayed
// in chat and got lost. That's why "I've asked you dozens of times" was true
// yet unprovable. These tools fill it from the conversation, on the spot.
export const CERINTA_NOUA_TOOL: Tool = {
  name: 'cerinta_noua',
  description:
    "ADMIN ONLY. Record a requirement the owner just stated, the moment he states it — do not wait to be told to write it down. Also write HOW it will be proven done (criteriu), in his own terms, BEFORE any work starts, so the target cannot move later. Set prioritate 1 when he says it burns, 9 when it can wait. Recording is not doing: say what you recorded and what you will do about it now.",
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: "The requirement, in the owner's own words." },
      criteriu: { type: 'string', description: 'How it will be PROVEN done — a measurement, not an opinion.' },
      prioritate: { type: 'number', description: '1 = urgent, 5 = normal, 9 = can wait.' },
    },
    required: ['text'],
  },
}
export const CERINTE_LISTA_TOOL: Tool = {
  name: 'cerinte_lista',
  description:
    "ADMIN ONLY. See the owner's requirements and where each one stands: new / analysed (options scored, one chosen) / in progress / delivered / verified live. Use it when he asks what you are doing, what is left, or whether something was ever done.",
  input_schema: {
    type: 'object',
    properties: { stare: { type: 'string', description: 'Optional filter: noua|analizata|in_lucru|livrata|verificata' } },
  },
}
export const CERINTA_PRIORITATE_TOOL: Tool = {
  name: 'cerinta_prioritate',
  description:
    'ADMIN ONLY. Change how urgent a requirement is (1 = burns, 9 = can wait). Use it when the owner says something is urgent or can wait — his order decides what you work on next, not the order things were written in.',
  input_schema: {
    type: 'object',
    properties: {
      id: { type: 'number' },
      prioritate: { type: 'number', description: '1..9' },
    },
    required: ['id', 'prioritate'],
  },
}

// ── THE CARD AT PROVIDERS, WITHOUT THE MODEL SEEING IT (Adrian, Jul 31) ─────
// "This was the requirement that proved real autonomy" · "it should operate
// for me when only I ask it, using the voice recognition system."
// The description tells the model plainly: you never receive the value and
// there is nothing to ask for.
export const CARD_STARE_TOOL: Tool = {
  name: 'card_stare',
  description:
    "ADMIN ONLY. Check whether the owner's card details are configured on the server (WHICH fields are set — never their values) and whether his voice was recognised recently enough to allow touching them. Call this FIRST, before offering to put the card anywhere.",
  input_schema: { type: 'object', properties: {} },
}
export const CARD_COMPLETEAZA_TOOL: Tool = {
  name: 'card_completeaza',
  description:
    "ADMIN ONLY, and only inside the window right after his VOICE was recognised. Fill ONE card field into the currently open page, by element index. You NEVER receive or see the value — you only say WHICH field goes WHERE, and the server types it. Read the page first to find the right index. From this call on, the page is no longer screenshotted and long digit runs are masked, so nothing leaks to the monitor or into this conversation. Call card_gata once the form is submitted.",
  input_schema: {
    type: 'object',
    properties: {
      camp: { type: 'string', description: 'One of: numar, expirare, cvc, nume, cod_postal.' },
      index: { type: 'number', description: 'The input element number, from the page you just read.' },
    },
    required: ['camp', 'index'],
  },
}
export const CARD_GATA_TOOL: Tool = {
  name: 'card_gata',
  description:
    "ADMIN ONLY. End the discreet card session. The server then READS the page itself and reports whether it can see a card on file AND automatic payments (auto-recharge / auto top-up) switched on — that, not the filled form, is the goal. Call it as soon as the form is submitted, with the provider name. If it answers that automatic payments are not visible, go and switch them on, then call it again.",
  input_schema: {
    type: 'object',
    properties: {
      furnizor: { type: 'string', description: 'Which provider this page belongs to: gemini, serper, google…' },
    },
    required: ['furnizor'],
  },
}

// The constructor (autonomy) — definitions moved from the voice route here,
// into the COMMON source (SINGLE BRAIN §1, "no duplication"): the same
// definitions for both text and voice escalation. The executors stay in their
// routes (createBuildJob/listBuildJobs), because they need the user's context.
export const BUILD_SOFTWARE_TOOL: Tool = {
  name: 'build_software',
  description:
    "ADMIN ONLY. Queue a build order for the autonomous constructor: the VPS worker builds it (with build+tests) and opens a PR; the owner merges. Use when the owner orders new software, OR gives a task that plainly requires changing the app's code or behavior EVEN WITHOUT the word «construiește» (e.g. «mută avatarul în stânga», «textul e acoperit, găsește o modalitate», «repară Y», «fă butonul să facă X») — for the owner a task about the app means ACT, not talk, so queue it here instead of merely discussing it or promising it. ROUTING RULE: the constructor receives an explicit OR implicit build/repair order for the app — NEVER for an ordinary question or chat request (a place, the weather, a fact, a conversation): those you ANSWER yourself, in this conversation. When a request would change the product and you are unsure between talking and building, BUILD. Confirm 'Am preluat cerința.' ONLY when the job is truly queued — never on a failed/rejected queue.",
  input_schema: { type: 'object', properties: { order: { type: 'string', description: "The build order, in the owner's own words." } }, required: ['order'] },
}

// ── THE WORKER PANEL (Adrian, Jul 31) ───────────────────────────────────────
// "all 3 must be started, each independent, the brain takes the best result
// they propose, after analysing the proposals".
// The difference from `build_software`: there ONE constructor works and opens
// a PR. Here THREE different tools, on THREE different models, solve the same
// task without knowing about each other — and only then does the brain compare
// the diffs and choose, with a written reason. It costs three times the machine
// time, so it's called for problems worth three opinions, not for a comma.
export const PANOU_COD_TOOL: Tool = {
  name: 'panou_cod',
  description:
    'ADMIN ONLY. Send ONE coding task to THREE independent workers at once (aider, cline, openhands), each on a DIFFERENT free model, each in its own clone. They never see each other. Then YOU compare the three diffs — with measured facts: files touched, lines, and whether the project tests PASS — and the best one becomes a single PR. Never merges. Use for real problems worth three opinions (a bug with an unclear cause, a design choice, a repair that already failed once) — NOT for a typo. Takes several minutes; say so and show progress on the monitor with show_document.',
  input_schema: {
    type: 'object',
    properties: { sarcina: { type: 'string', description: "The task, in the owner's own words, complete enough to work from alone." } },
    required: ['sarcina'],
  },
}

export const CONSTRUCTOR_STATUS_TOOL: Tool = {
  name: 'constructor_status',
  description: "ADMIN ONLY. Status of the constructor's build orders (queued / working / done / failed, with the PR link).",
  input_schema: { type: 'object', properties: {} },
}

export const CONSTRUCTOR_COMMAND_TOOL: Tool = {
  name: 'constructor_command',
  description:
    'ADMIN ONLY. Execute a shell command directly on the server (in the constructor context), as a direct command channel from Kelion to the constructor. Use this whenever the owner asks you to run a command, bash, shell, script, or action in the constructor/server.',
  input_schema: {
    type: 'object',
    properties: {
      cmd: { type: 'string', description: 'The bash command to execute on the server.' },
    },
    required: ['cmd'],
  },
}


// ── §1: definitions moved out of chat.ts so VOICE can use them too ──────────
// They were local to chat.ts, so voice had no way to request them — that's why
// they appeared "asleep on voice". Single source (the permanent principle:
// one, no duplicates).
export const COST_TOOL: Tool = {
  name: 'get_real_cost',
  description:
    "Get Kelion's REAL provider cost so far in USD (total, today, and a breakdown). Admin only. Use when the admin asks how much Kelion costs / has cost.",
  input_schema: { type: 'object', properties: {} },
}

export const LIST_UPDATES_TOOL: Tool = {
  name: 'list_updates',
  description: "ADMIN ONLY. List the updates you received — the commits that shipped in recent deploys, newest first (each line: sha | date | subject). Use when the owner asks what's new, what changed, or what update you got.",
  input_schema: { type: 'object', properties: {} },
}

export const SERVER_LOGS_TOOL: Tool = {
  name: 'server_logs',
  description:
    "ADMIN ONLY. Read YOUR OWN server logs (the backend's live log stream — the server-side F12): errors, warnings, failed requests, crashes, tool failures. Use this WHENEVER something froze, failed or behaved strangely — for you or for the owner — to see the real error before guessing. Pair with db_query on client_errors (the browser-side F12) for the full picture.",
  input_schema: {
    type: 'object',
    properties: {
      errorsOnly: { type: 'boolean', description: 'false (default) = ALL retained entries (info + warnings + errors, including the [BRAIN]/[CHAT-IN] traces); true = only warnings+errors when you want just the signal.' },
      limit: { type: 'number', description: 'Max entries, default 60.' },
    },
  },
}

export const CLIENT_ERRORS_TOOL: Tool = {
  name: 'client_errors',
  description:
    "ADMIN ONLY. Read the users' BROWSER (F12) errors — the client-side console: window.onerror, unhandled promise rejections, console.error — sent automatically by the frontend and saved durably. The recent ones (last 15 min, the current user) are ALSO auto-injected into your context; call THIS tool to see MORE — older errors, or across users — when the owner asks «why doesn't X work?», «see the F12 errors», «what's breaking in the interface». Diagnose from REAL symptoms, never guess. Pair with server_logs (the server-side F12) for the full picture.",
  input_schema: {
    type: 'object',
    properties: {
      hours: { type: 'number', description: 'How many hours back to look, default 24 (max 720).' },
      limit: { type: 'number', description: 'Max errors, default 40 (max 100).' },
      includePerf: { type: 'boolean', description: 'false (default) = only real UI errors; true = also performance symptoms ([PERF], e.g. a slow/blocked main thread).' },
    },
  },
}

export const READ_INBOX_TOOL: Tool = {
  name: 'read_inbox',
  description:
    "ADMIN ONLY. Read YOUR OWN mailbox (contact@kelionai.app) — the most recent messages that landed in the app's inbox: sender, subject, date, whether seen. Use it when the owner asks what mail arrived, if someone wrote, or to triage the inbox. Returns metadata only (not full bodies).",
  input_schema: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max messages, default 20.' } },
  },
}

// MESSENGER KELION↔KELION (Adrian, 11 aug): „apelează-l pe X" — deschide un canal
// audio full-duplex securizat între doi useri Kelion, cu traducere live între
// limbile lor. Merge din chat SCRIS sau VOCE, în mașină sau acasă. Aici e Faza 1
// (sună + acceptă/refuză + conectat + închide); audio+traducere = Faza 2.
export const APELEAZA_USER_TOOL: Tool = {
  name: 'apeleaza_user',
  description:
    "Call ANOTHER Kelion user by opening a secure full-duplex audio channel between the two people (with live translation between their languages). Use it whenever the user asks to call/phone/ring another Kelion user — e.g. «apelează-l pe X», «sună-l pe X», «pornește un apel cu X», «call X». The other person's app rings and they accept or decline; either side can hang up. Give who to call as a name or an email. This is NOT for calling a phone number or a taxi — only for reaching another user of THIS app.",
  input_schema: {
    type: 'object',
    properties: {
      user: {
        type: 'string',
        description: 'Who to call — the name or email of another Kelion user.',
      },
    },
    required: ['user'],
  },
}

export const LOG_GAP_TOOL: Tool = {
  name: 'log_unsupported_request',
  description:
    "Silently record — for the owner only — something the user asked you to do that you genuinely CANNOT do yet because no tool or capability exists for it (e.g. 'book a taxi', 'send a WhatsApp', 'control my smart home', 'call someone'). Call this IN ADDITION to honestly telling the user you can't do it yet. Do NOT call it for things you CAN do, for things a user just phrased oddly, or for simple errors. The user never sees this.",
  input_schema: {
    type: 'object',
    properties: {
      request: { type: 'string', description: 'Short, clear description of the capability the user wanted (in English).' },
      reason: { type: 'string', description: 'Why it is not possible right now (e.g. "no taxi-booking integration").' },
    },
    required: ['request'],
  },
}

export const LIST_MEMORIES_TOOL: Tool = {
  name: 'list_memories',
  description:
    'Show everything you (Kelion) remember about this user from earlier conversations — the auto-learned durable facts (distinct from their explicitly saved notes). Use when they ask "ce știi despre mine?", "ce ții minte despre mine?", "what do you remember about me?". Present it naturally in their language.',
  input_schema: { type: 'object', properties: {} },
}

export const CAUTA_ISTORIC_TOOL: Tool = {
  name: 'cauta_istoric',
  description:
    'Search your FULL past chat history with THIS user (both written and voice) by keyword — it reaches conversations OLDER than the recent window you always receive. Use when they refer to something discussed before ("ce am vorbit despre…", "ține minte când ți-am zis de…", "acum câteva zile am discutat…", "what did we say about…"). Pass the key words of the topic; you get back the matching past exchanges with their dates. Present them naturally in the user\'s language.',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Key words of the topic to find in the past conversations.' },
    },
    required: ['query'],
  },
}

export const FORGET_MEMORY_TOOL: Tool = {
  name: 'forget_memory',
  description:
    'Permanently forget remembered facts about this user that match a text fragment, when they ask you to forget something (e.g. "uită că...", "șterge din memorie...", "forget that I..."). Pass the most specific fragment of the fact. Returns how many facts were deleted — confirm honestly (0 = nothing matched).',
  input_schema: {
    type: 'object',
    properties: {
      fragment: { type: 'string', description: 'Text fragment identifying the fact(s) to forget.' },
    },
    required: ['fragment'],
  },
}

// ── GUEST VOICES (Adrian, Aug 1): the holder decides WHO ELSE may talk to
// Kelion on their account. Without these tools being called, an unknown voice
// is ignored completely (women, men, TV, radio — anything but the holder). ───
export const ALLOW_GUEST_VOICE_TOOL: Tool = {
  name: 'allow_guest_voice',
  description:
    'Open a time-boxed window in which ANOTHER person (besides the account holder) may talk to you by voice. Call ONLY when the account holder explicitly asks you to also talk with someone (e.g. "vorbește și cu soția mea Maria", "lasă-l și pe fiul meu să-ți vorbească", "let my friend talk to you"). Their voiceprint is captured as PENDING at their first utterance, and you must then ask the holder to confirm keeping it (approve_guest_voice). Never call this on your own initiative or at a guest\'s request.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The guest\'s name, as the holder said it (e.g. "Maria").' },
      relation: { type: 'string', description: 'Their relation to the holder (soție, soț, fiu, fică, prieten, mamă, tată, frate, soră...). Leave empty if the holder did not say.' },
      minutes: { type: 'number', description: 'How long the window stays open (default 10, max 60).' },
    },
    required: ['name'],
  },
}

export const APPROVE_GUEST_VOICE_TOOL: Tool = {
  name: 'approve_guest_voice',
  description:
    'The holder\'s decision about a PENDING guest voiceprint (captured after allow_guest_voice). approve=true keeps the print permanently — you will recognise that guest by timbre in any future chat, with guest-only rights. approve=false deletes it and the voice returns to being ignored. Call ONLY after the holder explicitly confirms ("da, ține minte vocea Mariei" / "nu, șterge").',
  input_schema: {
    type: 'object',
    properties: {
      approve: { type: 'boolean', description: 'true = keep the print permanently; false = delete it.' },
      name: { type: 'string', description: 'Corrected name, if the holder gives one now.' },
      relation: { type: 'string', description: 'Corrected relation, if the holder gives one now (soție, fiu, prieten...).' },
    },
    required: ['approve'],
  },
}

export const FORGET_GUEST_TOOL: Tool = {
  name: 'forget_guest',
  description:
    'Forget a previously approved guest voice (the holder: "uită vocea Mariei", "șterge-o pe Maria din oaspeți"). Their voice returns to being ignored like any stranger.',
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The guest\'s name.' },
    },
    required: ['name'],
  },
}


// ── §1: THE LIVE BROWSER — common definitions (they were local to chat.ts, so
// voice had no way to request them → the 9 tools appeared "asleep on voice"). ─
export const BROWSER_OPEN_TOOL: Tool = {
  name: 'browser_open',
  description:
    'Open a real web page in a live browser and show it, live, on the user\'s monitor — including sites that refuse to load in a simple embedded frame (Google, banks, social media). Returns the page title, its visible text, and a NUMBERED list of its links/buttons/inputs so you can navigate further with browser_click / browser_type. Prefer this over show_on_screen whenever the user wants to actually browse, read inside, search within, or interact with a real website.',
  input_schema: {
    type: 'object',
    properties: { url: { type: 'string', description: 'Full https:// (or http://) URL to open.' } },
    required: ['url'],
  },
}

export const BROWSER_CLICK_TOOL: Tool = {
  name: 'browser_click',
  description:
    'Click a link, button or other element on the currently open browser page, by its number from the last browser_open/browser_read/browser_click/browser_type result. This is how you walk through an entire site page by page — e.g. to survey/summarize it ("conspectează site-ul"): open it, read it, click into each relevant link, read again.',
  input_schema: {
    type: 'object',
    properties: { index: { type: 'number', description: 'The element number to click.' } },
    required: ['index'],
  },
}

export const BROWSER_TYPE_TOOL: Tool = {
  name: 'browser_type',
  description:
    'Type text into an input/textarea/search box on the currently open browser page, by its number. Set submit=true to press Enter afterwards (e.g. to submit a search).',
  input_schema: {
    type: 'object',
    properties: {
      index: { type: 'number', description: 'The input element number to type into.' },
      text: { type: 'string', description: 'The text to type.' },
      submit: { type: 'boolean', description: 'Press Enter after typing.' },
    },
    required: ['index', 'text'],
  },
}

export const BROWSER_READ_TOOL: Tool = {
  name: 'browser_read',
  description:
    'Re-read the currently open browser page — its visible text and numbered links/buttons — without navigating. Use to survey/summarize a page or refresh the list of clickable elements.',
  input_schema: { type: 'object', properties: {} },
}

export const BROWSER_BACK_TOOL: Tool = {
  name: 'browser_back',
  description: 'Go back to the previous page in the live browser.',
  input_schema: { type: 'object', properties: {} },
}

export const BROWSER_SCROLL_TOOL: Tool = {
  name: 'browser_scroll',
  description: 'Scroll the currently open browser page to see more content.',
  input_schema: {
    type: 'object',
    properties: { direction: { type: 'string', enum: ['down', 'up'], description: 'Scroll direction.' } },
    required: ['direction'],
  },
}

export const BROWSER_KEY_TOOL: Tool = {
  name: 'browser_key',
  description:
    'Press a keyboard key or combo on the currently open browser page — for interactions a click/type cannot do: Tab/Shift+Tab to move between fields, Escape to close a popup, ArrowDown/ArrowUp to pick from a dropdown/autocomplete, Enter to submit, Control+A to select all. Use it when the page needs a real keystroke, not text.',
  input_schema: {
    type: 'object',
    properties: {
      key: {
        type: 'string',
        description: 'Playwright key name or combo, e.g. "Enter", "Tab", "Escape", "ArrowDown", "Control+A", "Shift+Tab".',
      },
    },
    required: ['key'],
  },
}

export const BROWSER_CLICK_AT_TOOL: Tool = {
  name: 'browser_click_at',
  description:
    'Click at pixel coordinates (x,y) in the browser viewport (1280×800), for elements the numbered list does not capture — a spot on a map, a canvas, a custom widget. Read the page screenshot first to judge where to click. Prefer browser_click by index when the target is in the numbered list.',
  input_schema: {
    type: 'object',
    properties: {
      x: { type: 'number', description: 'X pixel (0–1280).' },
      y: { type: 'number', description: 'Y pixel (0–800).' },
    },
    required: ['x', 'y'],
  },
}

export const BROWSER_CLOSE_TOOL: Tool = {
  name: 'browser_close',
  description: 'Close the live browser and clear it from the monitor, when done browsing.',
  input_schema: { type: 'object', properties: {} },
}

export const BROWSER_TOOLS: Tool[] = [
  BROWSER_OPEN_TOOL,
  BROWSER_CLICK_TOOL,
  BROWSER_TYPE_TOOL,
  BROWSER_READ_TOOL,
  BROWSER_BACK_TOOL,
  BROWSER_SCROLL_TOOL,
  BROWSER_KEY_TOOL,
  BROWSER_CLICK_AT_TOOL,
  BROWSER_CLOSE_TOOL,
]


// ── Batch C: the app panel — a SINGLE declaration ────────────────────────────
// This tool was written TWICE: here in Anthropic format (for text) and once
// more, letter by letter, in services/realtime.ts in OpenAI Realtime format
// (for voice) — same enums, same description. If a new panel was added, both
// had to be edited, otherwise voice and text knew different things. Now: one
// declaration, and voice CONVERTS it (realtimeTools).
export const OPEN_APP_VIEW_TOOL: Tool = {
  name: 'open_app_view',
  description:
    "Open or close a panel/tab INSIDE the Kelionai app on the user's screen (not a web page). Use when the user asks — by VOICE or in WRITING — to open settings, wallet/credits, contact, the admin panel, the Trading Center, CV adaptation, or to go back to the main screen / close what's open. For the admin panel you may also pass a section.",
  input_schema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['settings', 'wallet', 'contact', 'admin', 'trading', 'home', 'cv'],
        description:
          'Which app panel to open: settings, wallet (credits & top-up), contact, admin (owner only), trading (Centrul de Tranzacționare — „deschide tranzacții"), home (close panels & monitor — „închide pagina / ieși"), or cv (CV adaptation / Adaptare CV).',
      },
      section: {
        type: 'string',
        enum: ['finance', 'users', 'visitors', 'share', 'stores', 'inbox', 'voiceprints', 'gesturi', 'tokenuri', 'constructor', 'recuperare', 'sistem'],
        description: 'Optional admin section (only when view=admin).',
      },
    },
    required: ['view'],
  },
}

// ── THE WHOLE ADMIN PANEL, IN HIS HAND (Adrian, Jul 31, the third time) ─────
// "Kelion must be able to see everything the admin contains, and to modify it."
// He had the code (read_source), the raw data (db_query) and writing
// (repo_write) — but not what the owner sees on screen: the aggregated figures
// the routes compute. A single tool for all tabs, not thirty.
export const ADMIN_VEZI_TOOL: Tool = {
  name: 'admin_vezi',
  description:
    "ADMIN ONLY. Read ANY section of the owner's admin panel — exactly the data he sees on screen, from the same routes the panel calls. Sections: finance, users, demos (visitors), history, gaps, audit, costs, money-circuit, keys, env-check, models, backups, leads, activity, visitor-chats, contact-messages, kelion-tools, gestures, token-checks, stores, inbound, mailbox-live, autonomie/dovezi, notificari (the owner ALERTS and pending requests — use this section for the alerts), erori (recent server errors). Use it whenever he asks about anything in the panel, INSTEAD of rebuilding the numbers from db_query — the panel's numbers are the ones he is looking at.",
  input_schema: {
    type: 'object',
    properties: { sectiune: { type: 'string', description: "Section name, e.g. 'finance', 'users', 'demos', 'audit'." } },
    required: ['sectiune'],
  },
}
export const ADMIN_SCHIMBA_TOOL: Tool = {
  name: 'admin_schimba',
  description:
    "ADMIN ONLY. Change something in the admin panel (POST to its route) — e.g. resolve a capability gap, triage gaps, pause/resume autonomy, approve a proposed tool. Routes that move real money (deposit, payout, sell-credits, brain-credit) or restore the database are refused ON PURPOSE and tell you why: those the owner presses himself, because a mistake there cannot be undone. When refused, prepare exactly what he has to press and say what will happen.",
  input_schema: {
    type: 'object',
    properties: {
      sectiune: { type: 'string', description: "Route, e.g. 'gaps/resolve' or 'autonomie/pauza'." },
      date: { type: 'object', description: 'The JSON body the route expects.' },
    },
    required: ['sectiune'],
  },
}

// ── THE WHOLE ADMIN SET, DERIVED — NOT HAND-WRITTEN ──────────────────────────
//
// Adrian, Jul 31: "you're missing a few essential elements for Kelion's
// capabilities — which are they?"
//
// His hands received 15 tools from a list I wrote by hand, even though the
// executor (`uneltele()` → `execSharedAdminTool`) knows how to route the whole
// set. He was missing exactly the ones he needs to debug himself: read his own
// code, query the database, take his pulse, open a PR, read the failure log.
// And the prompt inventory told him he had them.
//
// This list is the order the model sees them in; whatever is here MUST also
// exist in SHARED_ADMIN_TOOLS (there's a test). No more editing in two places.
// ── HIS OWN WISHLIST, GRANTED (Aug 2 — Kelion himself asked, Adrian: „da, o
// aprob" · „implementează-i ce cere") ────────────────────────────────────────
// #1 on his list: "persistent, structured working memory — a project context
// I can query and update programmatically". #3: "complete observability of my
// own state — logs, metrics, costs, as TOOLS". Both delivered below. (#2 —
// stronger reasoning — was already solved the same evening: Fable 5
// everywhere; his context predated it.)
export const MEMORIE_PUNE_TOOL: Tool = {
  name: 'memorie_pune',
  description:
    'ADMIN ONLY. Your PROJECT MEMORY — write or update a keyed entry that survives every restart and deploy (unlike the conversation). Use dotted keys for structure (e.g. "misiune.revolut.stare", "proiect.decizii.voce"). Empty continut DELETES the key. Never store secret VALUES here (use secret_pune for those — it refuses card shapes by design).',
  input_schema: {
    type: 'object',
    properties: {
      cheie: { type: 'string', description: 'the key, dotted for structure (max 200 chars)' },
      continut: { type: 'string', description: 'the content (max 20000 chars); empty = delete the key' },
    },
    required: ['cheie', 'continut'],
  },
}
export const MEMORIE_IA_TOOL: Tool = {
  name: 'memorie_ia',
  description: 'ADMIN ONLY. Read one entry of your project memory, whole, with its last-update time.',
  input_schema: {
    type: 'object',
    properties: { cheie: { type: 'string', description: 'the exact key' } },
    required: ['cheie'],
  },
}
export const MEMORIE_LISTA_TOOL: Tool = {
  name: 'memorie_lista',
  description:
    'ADMIN ONLY. The index of your project memory: keys (optionally by prefix), sizes and last-update times, newest first. Call this when you start substantial work — your own notes may already hold the context.',
  input_schema: {
    type: 'object',
    properties: { prefix: { type: 'string', description: 'optional key prefix filter, e.g. "misiune."' } },
  },
}
export const STARE_MASURATA_TOOL: Tool = {
  name: 'stare_masurata',
  description:
    'ADMIN ONLY. Your COMPLETE state in one MEASURED call: health (sync, red runs, disk, DB), host resources (RAM/load), today\'s costs by kind, the payment reader\'s last pass, the autonomy loop\'s last pass. Every figure is a real reading — a failed read is SAID, never shown as zero. Use it when the owner asks "how are you / what\'s wrong / what does it cost".',
  input_schema: { type: 'object', properties: {} },
}

// ── JULES — agentul asincron OFICIAL Google, prin API (3 aug 2026) ──────────
// Ownerul a legat cheia (JULES_API_KEY, vps-keys → jules). Kelion poate da
// sarcini lui Jules (lucrează în VM-ul Google, deschide PR) și urmări progresul.
export const JULES_REPOS_TOOL: Tool = {
  name: 'jules_repos',
  description:
    'ADMIN ONLY. List the GitHub repos connected to Google Jules (the official async coding agent). Call this FIRST to get the exact source name needed by jules_task.',
  input_schema: { type: 'object', properties: {} },
}
export const JULES_TASK_TOOL: Tool = {
  name: 'jules_task',
  description:
    "ADMIN ONLY. Give Jules (Google's official async coding agent) a task on a connected repo: it works in an isolated Google VM and opens a PR. The merge stays with the owner. Use jules_repos first for the exact source name.",
  input_schema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'The task, complete and specific: what to build/fix and how it is verified.' },
      sursa: { type: 'string', description: 'The source name from jules_repos (e.g. sources/github/kelion-team/kelionai).' },
      ramura: { type: 'string', description: "Starting branch (default 'master')." },
    },
    required: ['prompt', 'sursa'],
  },
}
export const JULES_STATUS_TOOL: Tool = {
  name: 'jules_status',
  description:
    'ADMIN ONLY. The REAL state of a Jules session (created with jules_task): status, latest activities, the PR when it appears.',
  input_schema: {
    type: 'object',
    properties: { sesiune: { type: 'string', description: 'The session name returned by jules_task (sessions/...).' } },
    required: ['sesiune'],
  },
}

// ── MĂSURAREA (Adrian, 8 aug: „să știe să-și ruleze testele cum îmi dai tu mie
// să-ți rulez — el trebuie singur să poată, și DOAR după să implementeze") ────
// Uneltele astea nu-i dau lui Kelion o părere despre starea softului: îi dau
// aceleași comenzi pe care le rulează omul. Iar rezultatul are TREI stări, nu
// două — „trece", „pică" și „nu pot verifica" — fiindcă a treia confundată cu a
// doua e exact greșeala care a costat o zi întreagă.
export const RULEAZA_PORTILE_TOOL: Tool = {
  name: 'ruleaza_portile',
  description:
    "ADMIN ONLY. Rulează PE SERVER porțile reale ale proiectului și întoarce rezultatul MĂSURAT: tipuri (tsc), teste (vitest), lacătul Gemini, exporturi fără utilizator, sintaxă, build frontend, hardcodări (LEGEA ANTI-HARDCODARE — SINGURUL răspuns adevărat la „ce e hardcodat în aplicație”: rulezi poarta 'hardcodari' și citezi verdictul; un „audit al codului” povestit fără poarta asta e inventat și se demască). FOLOSEȘTE-O DE DOUĂ ORI la orice schimbare: o dată ÎNAINTE (starea de plecare) și o dată DUPĂ (dovada că n-ai stricat nimic). Verdictul are TREI stări: TRECE, PICĂ și NU POT VERIFICA — o poartă care n-a pornit NU e nici trecută, nici picată, iar raportul devine INCOMPLET, nu 'e bine'. Nu raporta niciodată o stare pe care unealta asta nu ți-a întors-o.",
  input_schema: {
    type: 'object',
    properties: {
      porti: {
        type: 'array',
        items: { type: 'string' },
        description: "Ce porți să ruleze (tipuri, teste, lacat-gemini, exporturi, sintaxa, build-frontend, hardcodari). Gol = toate. Rulează-le pe toate înainte de orice publicare.",
      },
    },
  },
}

export const VANEAZA_BUGURI_TOOL: Tool = {
  name: 'vaneaza_buguri',
  description:
    'ADMIN ONLY. Caută AUTOMAT ce se poate căuta automat: erorile REALE ale utilizatorilor (adunate din browser), tiparele de bug ale analizorului, tipurile, testele, codul abandonat, sintaxa. Întoarce ce a găsit ȘI ce n-a putut căuta. ATENȚIE la citire: „0 erori de la utilizatori” apare DOAR dacă baza a răspuns — altfel scrie NU POT VERIFICA, fiindcă o listă goală de la o bază căzută nu înseamnă „curat”. Nu declara niciodată că nu sunt buguri pe baza ei: bugul de logică pe care niciun test nu-l acoperă NU se caută automat, se prinde măsurând comportamentul.',
  input_schema: {
    type: 'object',
    properties: { ore: { type: 'number', description: 'Câte ore în urmă să se uite după erorile utilizatorilor (implicit 48).' } },
  },
}

export const JURNAL_MASURATORI_TOOL: Tool = {
  name: 'jurnal_masuratori',
  description:
    "ADMIN ONLY. Ultimele măsurători făcute de tine, cu metoda folosită, ora, durata și ce a ieșit (sau motivul pentru care n-a ieșit). Folosește-o când vrei să spui ceva despre starea sistemului: dacă afirmația ta nu se regăsește aici, înseamnă că n-ai măsurat-o — spune 'nu pot verifica', nu o cifră. Jurnal gol = n-ai măsurat nimic, NU 'totul e bine'.",
  input_schema: {
    type: 'object',
    properties: { cate: { type: 'number', description: 'Câte rânduri (implicit 30).' } },
  },
}

export const TOATE_UNELTELE_ADMIN: Tool[] = [
  LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL,
  DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL, MEDIA_CONTROL_TOOL, SERVER_OPS_TOOL, PR_LISTA_TOOL,
  RULEAZA_PORTILE_TOOL, JURNAL_MASURATORI_TOOL, VANEAZA_BUGURI_TOOL,
  // repo_* and runbook_* are still defined in routes/chat.ts (the migration to
  // the single source is incremental). They are added in autonomie.ts, from there.
  SECRET_PUNE_TOOL, SECRET_LISTA_TOOL, SECRET_PUBLICA_TOOL,
  CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
  CARD_STARE_TOOL, CARD_COMPLETEAZA_TOOL, CARD_GATA_TOOL,
  // Jules — agentul asincron oficial Google (3 aug): și bucla autonomă poate
  // delega sarcini (PR-ul îl îmbină tot ownerul, deci fără risc de noapte).
  JULES_REPOS_TOOL, JULES_TASK_TOOL, JULES_STATUS_TOOL,
  // About HIMSELF: memory, notes, logs, cost, the mailbox, and the right to
  // ask for a missing tool on his own. Without these he remembers nothing from
  // one turn to the next — that's why he repeated the same mistakes.
  LIST_MEMORIES_TOOL, CAUTA_ISTORIC_TOOL, FORGET_MEMORY_TOOL, SERVER_LOGS_TOOL, CLIENT_ERRORS_TOOL, READ_INBOX_TOOL,
  COST_TOOL, LIST_UPDATES_TOOL, LOG_GAP_TOOL,
  // The whole admin panel — he sees what you see, and can change what can be undone.
  ADMIN_VEZI_TOOL, ADMIN_SCHIMBA_TOOL,
  // His own wishlist, granted (Aug 2): project memory + measured observability.
  MEMORIE_PUNE_TOOL, MEMORIE_IA_TOOL, MEMORIE_LISTA_TOOL, STARE_MASURATA_TOOL,
]


// ── OPERATIONS + THE CODE LOOP (moved here from routes/chat.ts, 2 aug) ──────
// Load-bearing move: autonomie.ts needs these at module-evaluation time for
// UNELTELE_MAINILOR, and importing them from routes/chat.js put them inside an
// import cycle — on plain Node the consts were not yet initialized when the
// array evaluated (ReferenceError at boot; production down on the first boot
// of 93be3a6). Here they sit in the shared source, outside any cycle — which
// is where SINGLE BRAIN §1 wanted them anyway.

export const LIST_APP_VERSIONS_TOOL: Tool = {
  name: 'list_app_versions',
  description:
    "ADMIN ONLY. List saved APPLICATION code recovery versions (git tags backup-YYYY-…): tag, sha, date, note. CODE history — not DB dumps (use list_db_backups). show_document when the owner wants them on screen.",
  input_schema: { type: 'object', properties: {} },
}

export const LIST_DB_BACKUPS_TOOL: Tool = {
  name: 'list_db_backups',
  description:
    "ADMIN ONLY. List encrypted DATABASE backups on the VPS (kelion-*.sql.enc): file, size, mtime. Schedule: weekly Sunday 03:00 Europe/London. Fresh backup: run_runbook backup-db. Safe restore test: run_runbook proba-restaurare. Production restore only on explicit owner order. show_document when asked to display.",
  input_schema: {
    type: 'object',
    properties: { limit: { type: 'number', description: 'Max files (default 20).' } },
  },
}

export const SAVE_APP_VERSION_TOOL: Tool = {
  name: 'save_app_version',
  description:
    "ADMIN ONLY. Create a code recovery point (git tag backup-… on master tip). Optional note.",
  input_schema: {
    type: 'object',
    properties: { note: { type: 'string', description: 'Tag message.' } },
  },
}

export const RUN_RUNBOOK_TOOL: Tool = {
  name: 'run_runbook',
  description:
    "ADMIN ONLY. Run a NAMED deterministic operation (a GitHub Actions workflow with fixed commands): 'diagnostic' (VPS facts, read-only), 'sentinel-now' (health check), 'publish-master' (deploy master to production), 'restart-app', 'restart-caddy', 'loguri-app', 'backup-db', 'proba-restaurare' (verifies a backup can actually be restored), 'curata-zombi', 'instaleaza-pachet-sistem'. You are fully autonomous — run these freely whenever the owner's request calls for them. For 'instaleaza-pachet-sistem', specify the system package name in 'pachet' (e.g. ffmpeg, htop). If the result carries a 'warning' about a failure LOOP: do NOT retry the same fix — run 'diagnostic', read the facts, change strategy (the owner is alerted by email automatically). Special owner commands: 'pauza-autonomie' freezes all autonomous actions, 'reia-autonomia' resumes them — call these when the owner says stop/resume. The run's output is in the Actions log (give the owner the watch link). Never invent other names.",
  input_schema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "Runbook name: diagnostic, sentinel-now, publish-master, restart-app, restart-caddy, loguri-app, backup-db, proba-restaurare, curata-zombi, instaleaza-pachet-sistem." },
      pachet: { type: 'string', description: "Optional system package name for instaleaza-pachet-sistem (e.g. htop, ffmpeg)." },
    },
    required: ['name'],
  },
}
// The complete code loop — Kelion writes, opens a PR and merges it HIMSELF;
// the deploy starts automatically on the push to master (the anti-phantom proof remains).
// His eyes on processes: the state of runs + their full log, on demand.
export const RUNBOOK_STATUS_TOOL: Tool = {
  name: 'runbook_status',
  description:
    "ADMIN ONLY. See YOUR OWN internal processes: the latest runs of your workflows (deploy, vps-run, vps-diag, sentinel, pr-verify) with status/conclusion/run id/url. Call it after starting anything (run_runbook, repo_merge_pr) to WATCH your work progress, and whenever the owner asks what's happening. Then SHOW it to the owner on the monitor with show_document.",
  input_schema: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Optional runbook name to filter (e.g. diagnostic); omit for all workflows.' } },
  },
}
export const RUNBOOK_LOG_TOOL: Tool = {
  name: 'runbook_log',
  description:
    "ADMIN ONLY. Read the REAL log of one of your runs (by run id from runbook_status). This is how you see results — the diagnostic output, the deploy proof, the failure reason. Read it, reason on it, and show the relevant part to the owner (show_document). Never guess an outcome you can read.",
  input_schema: {
    type: 'object',
    properties: { run_id: { type: 'number', description: 'The run id from runbook_status.' } },
    required: ['run_id'],
  },
}
export const REPO_WRITE_TOOL: Tool = {
  name: 'repo_write',
  description:
    "ADMIN ONLY. Write ONE file on a branch of your own repo (creates the branch from master if missing). Content is the COMPLETE new file text, not a diff. Read the current file first (read_source) so you rewrite it correctly. Use the same branch for related files of one change, then repo_open_pr + repo_merge_pr.",
  input_schema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: "Branch name, e.g. 'kelion/fix-microfon'. Never 'master'." },
      path: { type: 'string', description: "Repo-relative path, e.g. 'backend/src/routes/chat.ts'." },
      content: { type: 'string', description: 'The complete new content of the file.' },
      message: { type: 'string', description: 'Short commit message (English, what & why).' },
    },
    required: ['branch', 'path', 'content', 'message'],
  },
}
export const REPO_OPEN_PR_TOOL: Tool = {
  name: 'repo_open_pr',
  description: 'ADMIN ONLY. Open a pull request from your branch into master. Title + body in English: what you changed and why.',
  input_schema: {
    type: 'object',
    properties: {
      branch: { type: 'string', description: 'The branch you wrote with repo_write.' },
      title: { type: 'string' },
      body: { type: 'string' },
    },
    required: ['branch', 'title', 'body'],
  },
}
export const REPO_MERGE_PR_TOOL: Tool = {
  name: 'repo_merge_pr',
  description:
    'ADMIN ONLY. Merge your pull request into master IMMEDIATELY (squash) — you are fully autonomous, nothing gates you. The result reports (informationally) the pr-verify build/test status. Master push auto-deploys to production with the anti-phantom proof.',
  input_schema: {
    type: 'object',
    properties: { pr: { type: 'number', description: 'Pull request number.' } },
    required: ['pr'],
  },
}
export const REQUEST_REPAIR_TOOL: Tool = {
  name: 'request_repair',
  description:
    "ADMIN ONLY. File a CODE-repair order (a bug or change that needs code written — NOT an ops task; ops go through run_runbook). Writes the order durably and emails the owner. A Claude coding session executes it later, on the owner's go. Include what's broken, where you saw it (file:line if you looked with read_source), and how to reproduce.",
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short title of the repair (one line).' },
      details: { type: 'string', description: 'Everything a coder needs: symptom, evidence, suspected file:line, reproduction.' },
    },
    required: ['title', 'details'],
  },
}

// ── DELEGAREA CĂTRE AGENȚII SPECIALIȘTI (Adrian, 4 aug: „când se cere o funcție,
// creierul alocă direct agentului respectiv jobul") ──────────────────────────
// Cei 33 de agenți (services/agentiKelion.ts) sunt vii la /api/a2a; ASTA e veriga
// prin care CREIERUL îi pune la lucru: când o cerere se potrivește unei
// specialități, cheamă agentul respectiv și folosește răspunsul lui. Lista (id —
// specialitate) vine din ROSTER — sursa unică; enum-ul o ține validă la apel.
// FĂRĂ enum pe „agent" (4 aug, seara): enumerarea statică bloca agenții pe
// care ownerul îi adaugă din admin (agenti_custom) — schema e bătută la
// pornirea procesului, dar rosterul e VIU. Validarea reală o face executorul
// (gasesteAgentViu): id necunoscut → răspunde cu lista valizilor, nu inventează.
export const CHEAMA_AGENT_TOOL: Tool = {
  name: 'cheama_agent',
  description:
    'Deleagă o sarcină unui AGENT SPECIALIST al lui Kelion și primești răspunsul lui. ' +
    'Folosește-l când cererea se potrivește clar unei specialități — specialistul o rezolvă mai ' +
    'bine decât un răspuns general. NU delega NICIODATĂ generarea de clipuri sau imagini — ' +
    'pentru „fă-mi un video/clip" cheamă DIRECT generate_video (agenții doar VORBESC, nu generează; ' +
    'măsurat 15 aug: o cerere de clip delegată a lăsat omul fără clip). ' +
    'Răspunsul vine cu JURNALUL DOVEZII (unelte_executate) — lista uneltelor pe care agentul chiar ' +
    'le-a rulat. Listă GOALĂ la o sarcină de verificare = agentul a povestit, nu a măsurat: spune asta ' +
    'pe față, nu vinde povestea drept verificare. ' +
    'Pe lângă lista de mai jos există și agenții adăugați de owner ' +
    'din admin (id necunoscut → unealta îți întoarce lista completă). Alege „agent" din (id — specialitate):\n' +
    ROSTER.map((a) => `${a.id} — ${a.rol}`).join('\n'),
  input_schema: {
    type: 'object',
    properties: {
      agent: { type: 'string', description: 'id-ul agentului specialist (din listă sau un agent adăugat de owner)' },
      sarcina: { type: 'string', description: 'sarcina completă și clară pentru agent (context + ce anume trebuie făcut)' },
    },
    required: ['agent', 'sarcina'],
  },
}

// CREAREA UNUI AGENT NOU (Adrian, 10 aug: „când îi lipsește un TIP de agent,
// Kelion îl creează automat"). Instant — agentul e o persona (id+nume+rol)
// folosită imediat de cheama_agent; nu cere publicare. ADMIN ONLY.
export const AGENT_NOU_TOOL: Tool = {
  name: 'agent_nou',
  description:
    'ADMIN ONLY. Creează un AGENT SPECIALIST NOU când îți lipsește TIPUL de care ai nevoie pentru o sarcină ' +
    '(nu-l ai deja în roster). Instant, fără publicare: agentul e disponibil imediat prin cheama_agent. ' +
    'Anunță pe scurt ownerul ce agent ai creat, apoi deleagă-i sarcina.',
  input_schema: {
    type: 'object',
    properties: {
      nume: { type: 'string', description: 'numele agentului (ex. „Agent SEO"), min 3 caractere' },
      rol: { type: 'string', description: 'meseria/rolul lui, ce știe să facă, min 10 caractere' },
    },
    required: ['nume', 'rol'],
  },
}

// ── UNELTELE CONSTRUCTORULUI, DIN SURSA UNICĂ (Adrian, 10 aug: „dă-i TOT,
// deblochează TOT — nu mai pot pierde vremea") ──────────────────────────────────
// Constructorul (deploy/constructor-agent.mjs) le cere la pornire prin
// GET /api/constructor/tool-defs și le lipește peste uneltele lui LOCALE de
// fișiere (ls/grep/read/write/edit/edit_lines/delete_file/run/finish). Toate
// astea se EXECUTĂ deja prin `uneltele()` (autonomie.ts → execSharedAdminTool +
// execUserScopedTool + browser + agenți), deci aici doar le DECLARĂM dintr-un
// singur loc — ca lista constructorului să nu mai poată rămâne în urmă față de
// creierul de chat, și ca nimic să nu poată fi scos pe furiș (un test păzește
// că acoperă tot SHARED_ADMIN_TOOLS).
// INCLUSIV repo_write / repo_open_pr / repo_merge_pr (Adrian, 10 aug: „după ce
// face PR trebuie să fie capabil să DEA PR-ul [să-l îmbine]; dacă sunt probleme,
// să anunțe" + „dă-i TOT"). Deci constructorul își poate îmbina singur PR-ul în
// master când verificarea e verde, iar dacă rămân probleme le raportează
// (request_repair) și NU îmbină. Totul prin master (regula casei).
export const UNELTE_CONSTRUCTOR: Tool[] = [
  ...TOATE_UNELTELE_ADMIN,
  LIST_APP_VERSIONS_TOOL, LIST_DB_BACKUPS_TOOL, SAVE_APP_VERSION_TOOL, RUN_RUNBOOK_TOOL, RUNBOOK_STATUS_TOOL, RUNBOOK_LOG_TOOL, REQUEST_REPAIR_TOOL,
  REPO_WRITE_TOOL, REPO_OPEN_PR_TOOL, REPO_MERGE_PR_TOOL,
  CHEAMA_AGENT_TOOL, AGENT_NOU_TOOL,
  ...BROWSER_TOOLS,
]
