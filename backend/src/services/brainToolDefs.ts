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
