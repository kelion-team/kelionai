// ── SURSA UNICĂ a definițiilor de unelte partajate (CREIER UNIC §1) ──────────
// Adrian: „nu înzeci dublările; un singur creier". Definițiile uneltelor trăiau
// DOAR în chat.ts, deci vocea nu le putea folosi fără să le copieze. Aici e
// sursa comună: definiția o dată, folosită și de chat, și de voce.
//
// Migrare INCREMENTALĂ (ca să nu risc chat.ts live dintr-o mutare mare): începem
// cu uneltele de ACCES LA PROPRIUL COD (au executor deja decuplat în
// sourceCode.ts). Restul se aduc aici, câteva odată, verificate.

import type { Tool } from './brain-types.js'

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

// „Vede-și starea proprie": baza de date + sănătatea. Executori decupla ți în
// db.ts (dbTablesOverview/dbQuery) și health.ts (systemHealth).
export const DB_TABLES_TOOL: Tool = {
  name: 'db_tables',
  description:
    "ADMIN ONLY. See YOUR OWN permanent storage: every table in the application's Postgres database, with its columns and live row count. This is the real persisted state (users, wallets, transactions, messages, memories, voiceprints...). Call it before db_query when you need the exact table/column names.",
  input_schema: { type: 'object', properties: {} },
}

export const DB_QUERY_TOOL: Tool = {
  name: 'db_query',
  description:
    "ADMIN ONLY. Run ONE SQL statement directly on the application's Postgres database — full access, SELECT or write. Results are capped at 200 rows. HOUSE RULES: destructive statements (DELETE/DROP/TRUNCATE/UPDATE on money tables: wallets, transactions, billing_events, cost_events, admin_pool) ONLY when the owner explicitly ordered that exact change in this conversation — never on your own initiative. Always look at db_tables first if unsure of names.",
  input_schema: { type: 'object', properties: { sql: { type: 'string', description: 'The SQL statement to execute.' } }, required: ['sql'] },
}

export const SYSTEM_HEALTH_TOOL: Tool = {
  name: 'system_health',
  description:
    "ADMIN ONLY. See your OWN health: publication sync (live vs master), red workflow runs (48h), failed build orders, client-error spikes, disk, database, brain balance. CALL THIS at the START of a conversation with the owner (his first message of a session) and whenever he asks about problems or health. If problems exist: list them BRIEFLY (x, y, z) and ASK whether you should repair them — never repair on your own initiative; wait for his explicit yes, then use your tools (repo_write, build_software, run_runbook, db_query).",
  input_schema: { type: 'object', properties: {} },
}

// Constructorul (autonomie) — definiții mutate din ruta vocii aici, în sursa
// COMUNĂ (CREIER UNIC §1, „fără duplicare"): aceleași definiții și pentru scris,
// și pentru escaladarea vocii. Executorii rămân în rutele lor (createBuildJob/
// listBuildJobs), fiindcă au nevoie de contextul userului.
export const BUILD_SOFTWARE_TOOL: Tool = {
  name: 'build_software',
  description:
    "ADMIN ONLY. Queue a build order for the autonomous constructor: the VPS worker builds it (with build+tests) and opens a PR; the owner merges. Use when the owner orders new software, or a change/repair to yourself. Confirm 'Am preluat cerința.' ONLY when the job is truly queued — never on a failed/rejected queue.",
  input_schema: { type: 'object', properties: { order: { type: 'string', description: "The build order, in the owner's own words." } }, required: ['order'] },
}

export const CONSTRUCTOR_STATUS_TOOL: Tool = {
  name: 'constructor_status',
  description: "ADMIN ONLY. Status of the constructor's build orders (queued / working / done / failed, with the PR link).",
  input_schema: { type: 'object', properties: {} },
}


// ── §1: definiții mutate din chat.ts ca să le poată folosi ȘI vocea ──────────
// Erau locale în chat.ts, deci vocea nu avea cum să le ceară — de aceea apăreau
// „adormite pe voce". Sursă unică (principiul permanent: unic, fără duplicate).
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
      errorsOnly: { type: 'boolean', description: 'true (default) = only warnings+errors; false = all retained entries.' },
      limit: { type: 'number', description: 'Max entries, default 60.' },
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
