// ── AUTO-EXTINDEREA LUI KELION — unelte dinamice, propuse de el, aprobate de owner ──
// Kelion își poate propune unelte NOI (definiții de apel HTTP, nu cod), pe care
// owner-ul le aprobă cu un click. O unealtă aprobată devine ACTIVĂ instant (fără
// redeploy): apare în lista de unelte a creierului, iar execuția o face runnerul
// generic de mai jos. Siguranță: DOAR HTTPS, fără gazde interne/IP-uri private,
// timeout scurt, corp mărginit — Kelion nu poate rula decât ce a aprobat adminul.

import { listKelionTools, type KelionTool } from '../db.js'
import type { AnthropicTool } from './openrouter.js'

// Cache scurt (10s) ca să nu lovim DB-ul la fiecare tură.
let cache: { at: number; tools: KelionTool[] } = { at: 0, tools: [] }
async function approved(): Promise<KelionTool[]> {
  if (Date.now() - cache.at < 10_000) return cache.tools
  const tools = await listKelionTools('approved').catch(() => [])
  cache = { at: Date.now(), tools }
  return tools
}

/** Uneltele dinamice aprobate, în formatul creierului (ca uneltele fixe). */
export async function dynamicToolDefs(): Promise<AnthropicTool[]> {
  const tools = await approved()
  return tools.map((t) => {
    let schema: Record<string, unknown> = { type: 'object', properties: {}, required: [] }
    try {
      const p = JSON.parse(t.paramsJson) as Record<string, unknown>
      if (p && typeof p === 'object') schema = p
    } catch {
      /* params invalizi → obiect gol */
    }
    return { name: t.name, description: t.description, input_schema: schema }
  })
}

/** Numele uneltelor dinamice aprobate (ca să știm în runTool ce e dinamic). */
export async function dynamicToolNames(): Promise<Set<string>> {
  return new Set((await approved()).map((t) => t.name))
}

// Blochează gazdele interne / IP-uri private (SSRF): Kelion nu poate lovi rețeaua
// internă a serverului, doar internetul public prin HTTPS.
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

/** Execută o unealtă dinamică aprobată: apel HTTP cu parametrii substituiți. */
export async function runDynamicTool(name: string, args: Record<string, unknown>): Promise<string> {
  const t = (await approved()).find((x) => x.name === name)
  if (!t) return JSON.stringify({ error: 'unknown_dynamic_tool' })
  // Substituie {param} în URL și headere din argumente.
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
