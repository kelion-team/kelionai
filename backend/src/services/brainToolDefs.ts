// Single source for model-visible tool definitions shared by chat and voice.
// The public web process deliberately has no source-tree, shell, repository,
// deployment, raw SQL or secret-management tools. Product changes are queued
// through BUILD_SOFTWARE_TOOL into build_jobs for OpenCode (motor configurat separat).

import type { Tool } from './brain-types.js'
import { ROSTER } from './agentiKelion.js'
import { config } from '../config.js'

export const SYSTEM_HEALTH_TOOL: Tool = {
  name: 'system_health',
  description:
    "ADMIN ONLY. Read the application's bounded health summary. This never executes commands or exposes database contents. For a requested product repair, enqueue a separate Constructor job with build_software.",
  input_schema: { type: 'object', properties: {} },
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

// The web process only enqueues a validated order. A separate, authenticated
// OpenCode (motor configurat separat) owns the worktree and reports progress for the same jobId.
export const BUILD_SOFTWARE_TOOL: Tool = {
  name: 'build_software',
  description:
    "ADMIN ONLY. Validate and write a product build or repair directly to the canonical build_jobs queue for the separate OpenCode Constructor worker using its validated deployed engine. The web application never edits the repository, runs a shell, merges or deploys. Report success only when the order was persisted, include its jobId, and use constructor_status for measured progress through gates, commit, master, deploy and live-version verification.",
  input_schema: { type: 'object', properties: { order: { type: 'string', description: "The build order, in the owner's own words." } }, required: ['order'] },
}

export const CONSTRUCTOR_STATUS_TOOL: Tool = {
  name: 'constructor_status',
  description:
    "ADMIN ONLY. Read measured Constructor progress for build_jobs handled by OpenCode (motor configurat separat), including jobId, worker state, stage, commit and live version. A missing heartbeat or unverified gate is reported as such; never infer completion.",
  input_schema: { type: 'object', properties: {} },
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
    "ADMIN ONLY. Read the backend's bounded live log stream: errors, warnings, failed requests and tool failures. Pair with client_errors for browser-side diagnostics.",
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
    `ADMIN ONLY. Read YOUR OWN mailbox (${config.product.supportEmail}) — the most recent messages that landed in the app's inbox: sender, subject, date, whether seen. Use it when the owner asks what mail arrived, if someone wrote, or to triage the inbox. Returns metadata only (not full bodies).`,
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
// Text and Realtime consume the same declaration so their enums and
// descriptions cannot drift.
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
    'ADMIN ONLY. Your COMPLETE state in one MEASURED call: health (sync, red runs, disk, DB), host resources (RAM/load), today\'s costs by kind, the payment reader\'s last pass, the autonomy loop\'s last pass. Every figure is a real reading — a failed read is SAID, never shown as zero. Use it when the owner asks "how are you / what\'s wrong / what does it cost". On voice, NEVER read the raw JSON aloud — answer the question asked in one or two short spoken sentences.',
  input_schema: { type: 'object', properties: {} },
}

export const DOVADA_FAPTELOR_TOOL: Tool = {
  name: 'dovada_faptelor',
  description:
    "Pull the SAVED operational record of your past deeds for THIS user: each task's objective, final state (completed/unverified/failed/…) and the measured tool events behind it. This is your ace up the sleeve — use it when the user asks for PROOF or challenges a claim (\"de unde știi că ai făcut\", \"arată-mi dovada\", \"chiar ai trimis emailul?\"). Present it honestly: an 'unverified' state means the tool reported success but no independent check confirmed the effect — say so. An EMPTY list means no deed was RECORDED — not that nothing ever happened; older deeds may predate the journal. On voice, NEVER read the raw record aloud: give a one-sentence summary; if the user wants the detail on screen, pass the request through the brain door (cere_creierului — the brain has show_document; the live session itself does NOT, so never promise a screen you cannot fill).",
  input_schema: {
    type: 'object',
    properties: {
      cate: { type: 'number', description: 'How many recent tasks to return (default 10, max 30).' },
      cauta: { type: 'string', description: 'Optional keyword filtered against the task objectives (e.g. "email", "calendar").' },
    },
  },
}

export const TOATE_UNELTELE_ADMIN: Tool[] = [
  SYSTEM_HEALTH_TOOL,
  CERINTA_NOUA_TOOL, CERINTE_LISTA_TOOL, CERINTA_PRIORITATE_TOOL,
  // About HIMSELF: memory, notes, logs, cost, the mailbox, and the right to
  // ask for a missing tool on his own. Without these he remembers nothing from
  // one turn to the next — that's why he repeated the same mistakes.
  LIST_MEMORIES_TOOL, CAUTA_ISTORIC_TOOL, FORGET_MEMORY_TOOL, SERVER_LOGS_TOOL, CLIENT_ERRORS_TOOL, READ_INBOX_TOOL,
  COST_TOOL, LIST_UPDATES_TOOL, LOG_GAP_TOOL, DOVADA_FAPTELOR_TOOL,
  // The whole admin panel — he sees what you see, and can change what can be undone.
  // His own wishlist, granted (Aug 2): project memory + measured observability.
  MEMORIE_PUNE_TOOL, MEMORIE_IA_TOOL, MEMORIE_LISTA_TOOL, STARE_MASURATA_TOOL,
]

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

// Constructorul primește numai joburi validate prin coada workerului separat;
// procesul web nu expune un inventar generic de shell/repository tools.
