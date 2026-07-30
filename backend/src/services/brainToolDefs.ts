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

// ── SETĂRILE LUI, PUSE DE EL (Adrian, 30 iul: „să creeze secretele și să le
// pună unde trebuie, e al meu și îi permit full acces") ───────────────────────
// Regula de fier, scrisă și în descriere ca s-o vadă și creierul: valoarea unui
// secret nu se repetă, nu se confirmă, nu se scrie nicăieri. Se raportează
// numele și câte caractere are.
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


// ── §1: BROWSERUL LIVE — definiții comune (erau locale în chat.ts, deci vocea
// nu avea cum să le ceară → cele 9 unelte apăreau „adormite pe voce"). ───────
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


// ── Lotul C: panoul aplicatiei — o SINGURA declaratie ────────────────────────
// Unealta asta era scrisa de DOUA ori: aici in format Anthropic (pentru scris)
// si inca o data, litera cu litera, in services/realtime.ts in formatul OpenAI
// Realtime (pentru voce) — aceleasi enum-uri, aceeasi descriere. Daca se adauga
// un panou nou, trebuia editat in ambele, altfel vocea si scrisul stiau lucruri
// diferite. Acum: o declaratie, iar vocea o CONVERTESTE (realtimeTools).
export const OPEN_APP_VIEW_TOOL: Tool = {
  name: 'open_app_view',
  description:
    "Open a panel/tab INSIDE the Kelionai app on the user's screen (not a web page). Use when the user asks to open settings, their wallet/credits, contact, the admin panel, or go back to the main screen. For the admin panel you may also pass a section.",
  input_schema: {
    type: 'object',
    properties: {
      view: {
        type: 'string',
        enum: ['settings', 'wallet', 'contact', 'admin', 'home'],
        description:
          'Which app panel to open: settings, wallet (credits & top-up), contact, admin (owner only), or home (close panels).',
      },
      section: {
        type: 'string',
        enum: ['finance', 'users', 'visitors', 'vchat', 'history', 'gaps', 'share', 'stores', 'inbox', 'voiceprints', 'gesturi', 'tokenuri', 'constructor', 'recuperare'],
        description: 'Optional admin section (only when view=admin).',
      },
    },
    required: ['view'],
  },
}
