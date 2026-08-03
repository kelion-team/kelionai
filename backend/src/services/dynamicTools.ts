// ── KELION'S SELF-EXPANSION — dynamic tools, proposed by him, owner-approved ─
// Kelion can propose NEW tools for himself (HTTP call definitions, not code),
// which the owner approves with one click. An approved tool becomes ACTIVE
// instantly (no redeploy): it appears in the brain's tool list, and the
// generic runner below executes it. Safety: HTTPS ONLY, no internal
// hosts/private IPs, short timeout, bounded body — Kelion can only run what
// the admin approved.

import { listKelionTools, type KelionTool } from '../db.js'
import type { AnthropicTool } from './brainContract.js'

// A short cache (10s) so we don't hit the DB on every turn.
let cache: { at: number; tools: KelionTool[] } = { at: 0, tools: [] }
async function approved(): Promise<KelionTool[]> {
  if (Date.now() - cache.at < 10_000) return cache.tools
  const tools = await listKelionTools('approved').catch(() => [])
  cache = { at: Date.now(), tools }
  return tools
}

/** The approved dynamic tools, in the brain's format (like the fixed tools). */
export async function dynamicToolDefs(): Promise<AnthropicTool[]> {
  const tools = await approved()
  return tools.map((t) => {
    let schema: Record<string, unknown> = { type: 'object', properties: {}, required: [] }
    try {
      const p = JSON.parse(t.paramsJson) as Record<string, unknown>
      if (p && typeof p === 'object') schema = p
    } catch {
      /* invalid params → empty object */
    }
    return { name: t.name, description: t.description, input_schema: schema }
  })
}

/** The names of the approved dynamic tools (so runTool knows what is dynamic). */
export async function dynamicToolNames(): Promise<Set<string>> {
  return new Set((await approved()).map((t) => t.name))
}

// Blocks internal hosts / private IPs (SSRF): Kelion cannot hit the
// server's internal network, only the public internet over HTTPS.
function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false
    if (h === '::1' || h.startsWith('fd') || h.startsWith('fe80')) return false
    return true
  } catch {
    return false
  }
}

/** Executes an approved dynamic tool: an HTTP call with the parameters substituted. */
export async function runDynamicTool(name: string, args: Record<string, unknown>): Promise<string> {
  const t = (await approved()).find((x) => x.name === name)
  if (!t) return JSON.stringify({ error: 'unknown_dynamic_tool' })
  // Substitutes {param} in the URL and headers from the arguments.
  const subst = (s: string): string =>
    s.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, k) => encodeURIComponent(String(args[k] ?? '')))
  const url = subst(t.httpUrl)
  if (!isSafeUrl(url)) return JSON.stringify({ error: 'unsafe_url_blocked' })
  let headers: Record<string, string> = {}
  try {
    const h = JSON.parse(t.httpHeaders) as Record<string, string>
    for (const [k, v] of Object.entries(h)) headers[k] = subst(String(v))
  } catch {
    headers = {}
  }
  try {
    const method = (t.httpMethod || 'GET').toUpperCase()
    const init: RequestInit = { method, headers, signal: AbortSignal.timeout(12_000) }
    if (method !== 'GET' && method !== 'HEAD') {
      init.body = JSON.stringify(args)
      headers['content-type'] = headers['content-type'] || 'application/json'
    }
    const r = await fetch(url, init)
    const body = (await r.text().catch(() => '')).slice(0, 4000)
    return JSON.stringify({ status: r.status, body })
  } catch (e) {
    return JSON.stringify({ error: String(e).slice(0, 200) })
  }
}
