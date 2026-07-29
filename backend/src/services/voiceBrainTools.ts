// ── §6 CREIER UNIC — UNELTELE + EXECUTORUL creierului de voce (DECUPLAT) ──────
// Pas 2-3 spre „vocea = același creier": setul de unelte și executorul lor, FĂRĂ
// dependență de HTTP (reply.raw). Acoperă:
//   • skill-urile Google (definiții googleTools + executor runGoogleTool)
//   • accesul la propriul cod: list/read/search_source (doar admin) — definiții
//     din sursa COMUNĂ brainToolDefs.ts, executor decuplat din sourceCode.ts.
// Definițiile vin dintr-o singură sursă (nu duplicate). Restul (DB/monitor) se
// adaugă când le mutăm în brainToolDefs, câteva odată.
//
// NECABLAT încă la sesiunea Realtime live — se construiește în paralel, verificat.

import { googleTools, runGoogleTool } from './google.js'
import {
  LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL,
  DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL,
} from './brainToolDefs.js'
import { listSource, readSource, searchSource } from './sourceCode.js'
import { dbTablesOverview, dbQuery } from '../db.js'
import { systemHealth } from './health.js'
import type { AnthropicTool } from './openrouter.js'
import type { Tool } from './brain-types.js'

// Uneltele ADMIN pe care le are creierul de voce (aceleași definiții ca scrisul,
// din sursa comună): acces la cod + vede-și starea proprie (DB + sănătate).
const ADMIN_TOOLS: Tool[] = [LIST_SOURCE_TOOL, READ_SOURCE_TOOL, SEARCH_SOURCE_TOOL, DB_TABLES_TOOL, DB_QUERY_TOOL, SYSTEM_HEALTH_TOOL]
const ADMIN_NAMES = new Set(ADMIN_TOOLS.map((t) => t.name))
const GOOGLE_NAMES = new Set(googleTools.map((t) => t.name))

// Uneltele pe care le are creierul de voce: Google mereu; uneltele sensibile
// (cod, DB, sănătate) DOAR pentru admin — ca în chat.
export function voiceBrainTools(isAdmin: boolean): AnthropicTool[] {
  const tools: Tool[] = [...googleTools]
  if (isAdmin) tools.push(...ADMIN_TOOLS)
  return tools as unknown as AnthropicTool[]
}

// Executor DECUPLAT: (name, argsJson) → rezultat text. Fără dependență de HTTP.
// Gate de admin pe uneltele sensibile; parsează argumentele în siguranță (bucla
// de voce nu cade pe input stricat); respinge ce nu cunoaște.
export function makeVoiceExecTool(token: string, isAdmin: boolean): (name: string, argsJson: string) => Promise<string> {
  return async (name: string, argsJson: string): Promise<string> => {
    let args: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(argsJson || '{}')
      if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>
    } catch {
      /* argumente ne-JSON → obiect gol */
    }
    if (GOOGLE_NAMES.has(name)) return runGoogleTool(name, args, token)
    if (ADMIN_NAMES.has(name)) {
      if (!isAdmin) return JSON.stringify({ error: 'admin_only', name })
      if (name === 'list_source') return listSource(String(args.dir ?? '.'))
      if (name === 'read_source') return readSource(String(args.path ?? ''), Number(args.from_line ?? 1) || 1)
      if (name === 'search_source') return searchSource(String(args.query ?? ''))
      if (name === 'db_tables') return dbTablesOverview()
      if (name === 'db_query') return dbQuery(String(args.sql ?? ''))
      if (name === 'system_health') return systemHealth()
    }
    return JSON.stringify({ error: 'unknown_tool', name })
  }
}
