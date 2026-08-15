// ── FABLE 5 (Claude) = REZERVA CONSTRUCTORULUI (owner, 14 aug 2026) ──────────
// Owner, verbatim: „schimbă-mi constructorul cu gemeni ultra… și când nu merge
// repara vreau să cadă pe fable 5". Constructorul cere creierul PRIN APP
// (/api/constructor/creier): principal = Gemini (creierul aplicației, cheia +
// creditul stau AICI, nu în constructor). Când Gemini nu poate repara, aceeași
// rută cade pe Fable 5 — tot AICI, în app, ca și cheia Anthropic să stea în app
// (constructorul NU ține chei de furnizor, regula din 13 aug).
//
// Suportă:
// 1) Anthropic direct (https://api.anthropic.com/v1/messages cu x-api-key și anthropic-version)
// 2) Endpoint OpenAI-compatibil dacă CONSTRUCTOR_FABLE_URL sau ANTHROPIC_BASE_URL indică un proxy.
//
// Răspunsul iese în formatul cerut de constructor (OpenAI-compatible), compatibil
// cu creierul 2 Gemini.

import { recordCost } from '../db.js'
import { config, ENV_ALIASES } from '../config.js'
import type { OrMessage, OrToolCall } from './brainContract.js'

const FABLE_URL = process.env.CONSTRUCTOR_FABLE_URL || ''
// MODEL LADDER — the recurring 404 in server.logbuffer (count=29) said it all:
// «model: claude-3-haiku-20240307 not_found_error». That RETIRED 2024 model was
// never in this file's list — it came from the ANTHROPIC_MODEL /
// CONSTRUCTOR_FABLE_MODEL env vars, which sat ABOVE the ladder and were trusted
// blindly, unfiltered. A stale env value therefore poisoned the FIRST rung on
// every escalation (attempt 2 always burned on a dead model before falling to
// a live one — or straight to the Gemini net). Fix the CAUSE, not the symptom:
// env overrides are still honoured (tuning without deploy), but any env value
// naming a RETIRED Claude 3.x model is discarded with the same logic the
// credit-bubble lesson taught (15 Aug): never let a stale setting outrank
// reality. The ladder itself stays the live Claude 5 family, Fable 5 first.
const RETIRED_MODEL = /^claude-3(\.|-)/i
function modelDinEnv(v: string | undefined): string | undefined {
  const m = (v || '').trim()
  if (!m) return undefined
  // Retired 2024-era models 404 on the API — a stale env var must not poison the ladder.
  if (RETIRED_MODEL.test(m)) return undefined
  return m
}
const CANDIDATE_MODELS = [
  modelDinEnv(process.env.CONSTRUCTOR_FABLE_MODEL),
  modelDinEnv(process.env.ANTHROPIC_MODEL),
  'claude-fable-5',
  'claude-opus-5',
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
].filter((m): m is string => Boolean(m && m.trim()))

const FABLE_MODEL = CANDIDATE_MODELS[0] || 'claude-fable-5'

/** Cheia Fable 5 (Claude). Stă în app, NU în constructor — și se citește prin
 *  ALIASURILE din config (lecția creditului, 30 iul → reaplicată 15 aug):
 *  orice nume rezonabil scris de owner e găsit, nu doar unul fix. Config-ul
 *  (înghețat la boot) e primul; env-ul la apel, pe ACELEAȘI aliasuri, acoperă
 *  cheia pusă la cald și testele — sursa listei rămâne una: ENV_ALIASES. */
export function fable5Key(): string {
  if (config.anthropicKey) return config.anthropicKey
  for (const nume of ENV_ALIASES.anthropicKey) {
    const v = process.env[nume]
    if (v && v.trim()) return v.trim()
  }
  return ''
}

/** Rezerva Fable 5 e configurată (cheie pusă)? Fără ea, ruta rămâne pe Gemini. */
export function fable5Disponibil(): boolean {
  return Boolean(fable5Key())
}

// ── PROBA DE VALIDITATE A CHEII ──────────────────────────────────────────────
// Dovada se cere de la Anthropic: GET /v1/models e gratuit și trece doar cu cheie bună.
const FABLE_MODELS_URL = 'https://api.anthropic.com/v1/models'
const PROBA_CACHE_MS = 10 * 60_000
let probaFable: { la: number; ok: boolean; motiv: string } | null = null

/** Doar pentru teste: golește cache-ul probei. */
export function _resetProbaFable(): void {
  probaFable = null
}

/** Cheia chiar POATE servi? Probă reală la Anthropic, nu „e pusă în env". */
export async function fable5Valida(): Promise<{ ok: boolean; motiv: string }> {
  const key = fable5Key()
  if (!key) return { ok: false, motiv: 'cheia (ANTHROPIC_API_KEY) nu e pusă — rezervă inactivă' }
  if (probaFable && Date.now() - probaFable.la < PROBA_CACHE_MS) return probaFable

  try {
    const isCustomOpenAi = FABLE_URL.includes('/chat/completions') || FABLE_URL.includes('openrouter')
    const url = isCustomOpenAi ? FABLE_URL : FABLE_MODELS_URL
    const headers: Record<string, string> = isCustomOpenAi
      ? { authorization: `Bearer ${key}` }
      : { 'x-api-key': key, 'anthropic-version': '2023-06-01' }

    const r = await fetch(url, {
      method: isCustomOpenAi ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', ...headers },
      body: isCustomOpenAi
        ? JSON.stringify({ model: FABLE_MODEL, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 })
        : undefined,
      signal: AbortSignal.timeout(8_000),
    })

    // VERDICT PRECIS, nu „pune o cheie nouă" la orice (regula #1 + lecția
    // creditului): doar 401 înseamnă cheie nerecunoscută; restul statusurilor
    // au alte cauze și se spun pe numele lor — altfel dăm vina pe cheia
    // omului pentru rate-limit, drepturi sau căderea furnizorului.
    const motivRefuz =
      r.status === 401
        ? 'Anthropic NU recunoaște cheia (401) — abia ASTA cere o cheie nouă din console.anthropic.com'
        : r.status === 403
          ? 'cheia e recunoscută, dar fără drepturi pe resursa cerută (403) — verifică planul/permisiunile, NU e de înlocuit cheia'
          : r.status === 429
            ? 'cheia e validă dar limitată ACUM (429 rate-limit/credit) — nu e problemă de cheie'
            : r.status >= 500
              ? `Anthropic are probleme (HTTP ${r.status}) — nu e cheia ta`
              : `Anthropic a răspuns HTTP ${r.status} — de citit corpul răspunsului, nu de schimbat cheia orbește`
    probaFable = {
      la: Date.now(),
      ok: r.ok,
      motiv: r.ok ? 'cheie VALIDĂ — probă reală la Anthropic (GET /v1/models, gratuit)' : motivRefuz,
    }
    return probaFable
  } catch (e) {
    return { ok: false, motiv: `nu pot proba cheia (rețea): ${String((e as Error)?.message ?? e).slice(0, 80)}` }
  }
}

interface OpenAiToolCall {
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

/** Răspunsul pe care-l așteaptă constructorul, IDENTIC cu al creierului 2 Gemini. */
export interface RaspunsCreier {
  choices: { message: { role: 'assistant'; content: string; tool_calls?: OpenAiToolCall[] } }[]
  usage: { total_tokens: number }
  modelServit: string
}

/** Transformă uneltele din format OpenAI JSON Schema în format Anthropic tools */
function toAnthropicTools(toolsRaw: unknown[]): unknown[] {
  if (!Array.isArray(toolsRaw) || !toolsRaw.length) return []
  return toolsRaw.map((t: any) => {
    if (t?.type === 'function' && t?.function) {
      return {
        name: t.function.name,
        description: t.function.description || '',
        input_schema: t.function.parameters || { type: 'object', properties: {} },
      }
    }
    return t
  })
}

/** Transformă mesajele OpenAI în format Anthropic messages */
function toAnthropicMessages(messages: unknown[]): { system?: string; messages: any[] } {
  let system = ''
  const msgs: any[] = []

  for (const m of (messages as OrMessage[]) ?? []) {
    if (m.role === 'system') {
      system += (system ? '\n\n' : '') + (m.content || '')
    } else if (m.role === 'user') {
      msgs.push({ role: 'user', content: m.content || '' })
    } else if (m.role === 'assistant') {
      const content: any[] = []
      if (m.content) content.push({ type: 'text', text: m.content })
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          let input = {}
          try {
            input = JSON.parse(tc.function.arguments || '{}')
          } catch {
            input = {}
          }
          content.push({
            type: 'tool_use',
            id: tc.id || `tool_${Math.random().toString(36).slice(2, 8)}`,
            name: tc.function.name,
            input,
          })
        }
      }
      msgs.push({ role: 'assistant', content: content.length ? content : (m.content || '') })
    } else if (m.role === 'tool') {
      msgs.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: m.tool_call_id || 'unknown_tool',
            content: m.content || '',
          },
        ],
      })
    }
  }

  if (msgs.length === 0) {
    msgs.push({ role: 'user', content: 'Ready.' })
  }

  return { system: system || undefined, messages: msgs }
}

/** Cheamă Fable 5 (Anthropic Claude). Mesajele + uneltele sunt convertite conform endpoint-ului. */
export async function fable5Chat(
  messages: unknown[],
  tools: unknown[],
  opts: { timeoutMs?: number } = {},
): Promise<RaspunsCreier> {
  const key = fable5Key()
  if (!key) throw new Error('fable5_neconfigurat: lipsește ANTHROPIC_API_KEY în app')

  const isCustomOpenAi = FABLE_URL.includes('/chat/completions') || FABLE_URL.includes('openrouter')

  if (isCustomOpenAi) {
    const body: Record<string, unknown> = {
      model: FABLE_MODEL,
      messages,
      max_tokens: 8192,
      temperature: 0.7,
    }
    if (Array.isArray(tools) && tools.length) {
      body.tools = tools
      body.tool_choice = 'required'
    }

    const r = await fetch(FABLE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.max(30_000, opts.timeoutMs ?? 120_000)),
    })
    if (!r.ok) {
      const errText = await r.text().catch(() => '')
      throw new Error(`fable5 HTTP ${r.status}: ${errText.slice(0, 200)}`)
    }
    const data = (await r.json()) as any
    const message = data?.choices?.[0]?.message
    if (!message) throw new Error('fable5: răspuns fără candidați')
    const total = Number(data?.usage?.total_tokens)
    const cost = (total / 1000) * 0.015
    if (cost > 0) void recordCost('kelion-constructor', 'fable5', cost)
    return {
      choices: [{ message }],
      usage: { total_tokens: Number.isFinite(total) ? total : 0 },
      modelServit: `fable5/${FABLE_MODEL}`,
    }
  }

  // Anthropic Official /v1/messages
  const { system, messages: anthropicMsgs } = toAnthropicMessages(messages)
  const anthropicTools = toAnthropicTools(tools as unknown[])

  const endpoint = 'https://api.anthropic.com/v1/messages'
  const modelsToTry = Array.from(new Set([FABLE_MODEL, ...CANDIDATE_MODELS]))
  let lastErr = ''
  let parsed: any
  let usedModel = FABLE_MODEL

  for (const modelName of modelsToTry) {
    const payload: Record<string, unknown> = {
      model: modelName,
      messages: anthropicMsgs,
      max_tokens: 8192,
    }
    if (system) payload.system = system
    if (anthropicTools.length) {
      payload.tools = anthropicTools
      payload.tool_choice = { type: 'any' }
    }

    let r: Response
    try {
      r = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(Math.max(30_000, opts.timeoutMs ?? 120_000)),
      })
    } catch (e) {
      throw new Error(`fable5 rețea: ${String((e as Error)?.message ?? e).slice(200)}`)
    }

    const text = await r.text().catch(() => '')
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) {
        // Același verdict precis ca proba (15 aug, lecția creditului): 401 =
        // cheia nu e recunoscută; 403 = recunoscută dar fără drepturi — NU
        // „schimbă cheia" la orice.
        probaFable = {
          la: Date.now(),
          ok: false,
          motiv:
            r.status === 401
              ? 'Anthropic NU recunoaște cheia (401) — abia ASTA cere o cheie nouă din console.anthropic.com'
              : 'cheia e recunoscută, dar fără drepturi pe resursa cerută (403) — verifică planul/permisiunile, NU e de înlocuit cheia',
        }
        throw new Error(`fable5 ${r.status}: ${text.slice(0, 200)}`)
      }
      // If 404 (model not found), try next fallback model
      if (r.status === 404 && text.includes('not_found_error')) {
        lastErr = `fable5 ${r.status}: ${text.slice(0, 200)}`
        continue
      }
      throw new Error(`fable5 ${r.status}: ${text.slice(0, 200)}`)
    }

    try {
      parsed = JSON.parse(text)
      usedModel = modelName
      break
    } catch {
      throw new Error(`fable5 JSON rupt (${text.length} caractere)`)
    }
  }

  if (!parsed) {
    throw new Error(lastErr || 'fable5: niciun model valid disponibil')
  }

  let outText = ''
  const toolCalls: OpenAiToolCall[] = []

  if (Array.isArray(parsed.content)) {
    for (const block of parsed.content) {
      if (block.type === 'text') {
        outText += block.text
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: {
            name: block.name,
            arguments: JSON.stringify(block.input || {}),
          },
        })
      }
    }
  }

  const inTok = parsed?.usage?.input_tokens ?? 0
  const outTok = parsed?.usage?.output_tokens ?? 0
  const totalTokens = inTok + outTok
  const cost = (inTok * 3 + outTok * 15) / 1_000_000
  if (cost > 0) void recordCost('kelion-constructor', 'fable5', cost)

  const outMsg: RaspunsCreier['choices'][0]['message'] = {
    role: 'assistant',
    content: outText,
  }
  if (toolCalls.length) outMsg.tool_calls = toolCalls

  return {
    choices: [{ message: outMsg }],
    usage: { total_tokens: totalTokens },
    modelServit: `fable5/${usedModel}`,
  }
}
