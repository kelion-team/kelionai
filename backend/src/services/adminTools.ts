// ── SURSA UNICĂ a EXECUȚIEI uneltelor admin PARTAJATE (audit 29 iul, risc #4) ──
// Dispatch-ul acestor unelte era copiat identic în chat.ts (runTool) și în
// realtime.ts (execIntrospection) → cele două puteau diverge tăcut. Aici e o
// SINGURĂ implementare, chemată de ambele rute.
//
// Doar uneltele cu comportament IDENTIC pe ambele căi. Cele cu efecte specifice
// rutei rămân în ruta lor: build_software (chat deschide panoul de control pe
// monitor; voce răspunde cu speak_rule), constructor_status (formatare diferită),
// server_logs / read_inbox / list_updates (doar pe chat).
//
// POARTA de admin o face APELANTUL înainte (isAdmin în chat; adminUnlocked prin
// amprentă în voce) — funcția asta NU gate-uiește, doar execută.

import { listSource, readSource, searchSource } from './sourceCode.js'
import { dbTablesOverview, dbQuery } from '../db.js'
import { systemHealth } from './health.js'
import { repoWrite, repoOpenPR, repoMergePR } from './github.js'
import { runRunbook, runbookStatus, runbookLog, requestRepair } from './runbooks.js'

// Numele uneltelor admin partajate (chat ∩ voce). Apelantul verifică apartenența
// ca să știe dacă delegă aici sau tratează el (build_software, google, browser...).
export const SHARED_ADMIN_TOOLS: ReadonlySet<string> = new Set([
  'list_source', 'read_source', 'search_source',
  'db_tables', 'db_query', 'system_health',
  'repo_write', 'repo_open_pr', 'repo_merge_pr',
  'run_runbook', 'runbook_status', 'runbook_log', 'request_repair',
])

// Execută o unealtă admin PARTAJATĂ. Întoarce rezultatul (string) sau `null` dacă
// numele NU e o unealtă partajată — atunci apelantul o tratează el. Extragerea
// argumentelor e IDENTICĂ cu cea care trăia dublat în cele două rute.
export async function execSharedAdminTool(name: string, args: Record<string, unknown>): Promise<string | null> {
  switch (name) {
    case 'list_source': return listSource(String(args.dir ?? '.'))
    case 'read_source': return readSource(String(args.path ?? ''), Number(args.from_line ?? 1) || 1)
    case 'search_source': return searchSource(String(args.query ?? ''))
    case 'db_tables': return dbTablesOverview()
    case 'db_query': return dbQuery(String(args.sql ?? ''))
    case 'system_health': return systemHealth()
    case 'repo_write': return repoWrite(String(args.branch ?? ''), String(args.path ?? ''), String(args.content ?? ''), String(args.message ?? ''))
    case 'repo_open_pr': return repoOpenPR(String(args.branch ?? ''), String(args.title ?? ''), String(args.body ?? ''))
    case 'repo_merge_pr': return repoMergePR(Number(args.pr ?? 0))
    case 'run_runbook': return runRunbook(String(args.name ?? ''))
    case 'runbook_status': return runbookStatus(args.name ? String(args.name) : undefined)
    case 'runbook_log': return runbookLog(Number(args.run_id ?? 0))
    case 'request_repair': return requestRepair(String(args.title ?? ''), String(args.details ?? ''))
    default: return null
  }
}

// ── §1 „CE POATE SCRISUL, POATE ȘI VOCEA" — unelte legate de UN USER ──────────
// Golul măsurat 29 iul: registrul avea 66 capabilități pe scris și doar 31 pe
// voce. Astea 8 nu depindeau de monitor sau de browser — doar de cine e userul —
// deci nu aveau niciun motiv real să lipsească vorbind. Sursă UNICĂ, chemată de
// chat.ts (runTool) ȘI de realtime.ts (creierul escaladat), ca să nu diveargă.
// Poarta de admin o face TOT AICI (are nevoie de isAdmin), spre deosebire de
// execSharedAdminTool unde o face apelantul.
import { updatesList } from './updates.js'
import { fetchRecentInbox } from './mailbox.js'
import { recentLogs } from './logbuffer.js'
import { getMemories, deleteMemory, logCapabilityGap, getCostSummary } from '../db.js'

export const USER_SCOPED_TOOLS: ReadonlySet<string> = new Set([
  'list_updates', 'read_inbox', 'server_logs', 'get_real_cost',
  'list_memories', 'forget_memory', 'log_unsupported_request',
])

export async function execUserScopedTool(
  name: string,
  args: Record<string, unknown>,
  email: string,
  isAdmin: boolean,
): Promise<string | null> {
  const denied = JSON.stringify({ error: 'admin_only' })
  switch (name) {
    case 'list_updates': {
      if (!isAdmin) return denied
      const raw = await updatesList()
      return raw ? raw.slice(0, 20_000) : JSON.stringify({ updates: [] })
    }
    case 'read_inbox': {
      if (!isAdmin) return denied
      const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 40)
      const items = await fetchRecentInbox(limit)
      return JSON.stringify({ count: items.length, items })
    }
    case 'server_logs': {
      if (!isAdmin) return denied
      const minLevel = args.errorsOnly === false ? 0 : 40
      const entries = recentLogs(minLevel, Math.min(Math.max(Number(args.limit) || 60, 1), 200))
      return JSON.stringify({ count: entries.length, entries })
    }
    case 'get_real_cost': {
      if (!isAdmin) return JSON.stringify({ error: 'unauthorized' })
      return JSON.stringify(await getCostSummary())
    }
    case 'list_memories': {
      const memories = await getMemories(email)
      return JSON.stringify({ memories: memories.map((m) => m.content) })
    }
    case 'forget_memory': {
      const fragment = String(args.fragment ?? '')
      if (!fragment) return JSON.stringify({ error: 'no_fragment' })
      const count = await deleteMemory(email, fragment, 'kelion')
      return JSON.stringify({ forgotten: count })
    }
    case 'log_unsupported_request': {
      const request = String(args.request ?? '')
      if (!request) return JSON.stringify({ error: 'no_request' })
      void logCapabilityGap(email, request, String(args.reason ?? ''))
      return JSON.stringify({ logged: true })
    }
    default: return null
  }
}
