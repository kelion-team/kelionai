import type { AnthropicTool, OrChatResult, OrMessage, OrToolCall } from './openrouter.js'

// ── CREIERUL DE ABONAMENT: CLAUDE DIRECT DE LA ANTHROPIC (Adrian, 28 iul: „la ab
// trebuie de la cloude nu openrouter") ───────────────────────────────────────
// Comutatorul „abonament" al ownerului rulează acum pe API-ul Anthropic DIRECT
// (api.anthropic.com), cu cheia lui de la consola Claude (sk-ant-…) și creditul
// lui — NU prin OpenRouter. Motiv concret: cheia de la Anthropic era respinsă de
// OpenRouter cu 401 („Sold indisponibil (http_401)"), fiindcă ruta veche o dădea
// unui alt furnizor. Aici e clientul direct, cu ACELEAȘI forme de intrare/ieșire
// ca openrouterChat/Stream și geminiDirect — orchestratorul nu vede diferența.
// Vocea (OpenAI Realtime) rămâne separată, pe cheia OpenAI proprie.

const A_BASE = 'https://api.anthropic.com/v1'
const A_VERSION = '2023-06-01'

/** Prefixul intern care rutează orchestratorul spre Anthropic în loc de OpenRouter. */
export const ANTHROPIC_DIRECT_PREFIX = 'anthropic-direct/'

// Catalogul de modele Claude oferit în selectorul de abonament (id-uri REALE de
// API Anthropic). Toate din familia Claude 5 văd imagini → vedere garantată pe
// turele cu poză/cameră. Implicitul e Sonnet (echilibru putere/cost).
export interface ClaudeModel {
  id: string
  name: string
  vision: boolean
}
export const CLAUDE_MODELS: ClaudeModel[] = [
  { id: 'claude-opus-5', name: 'Claude Opus 5 (cel mai puternic)', vision: true },
  { id: 'claude-sonnet-5', name: 'Claude Sonnet 5 (echilibrat)', vision: true },
  { id: 'claude-fable-5', name: 'Claude Fable 5 (rapid)', vision: true },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5 (cel mai ieftin)', vision: true },
]
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5'

/** Un model Claude ales vede imagini? Necunoscut → presupunem că da (familia 5 vede). */
export function claudeModelHasVision(id: string): boolean {
  const m = CLAUDE_MODELS.find((c) => c.id === id)
  return m ? m.vision : true
}

// Preț ESTIMAT per milion de tokeni (in/out), USD — Anthropic nu întoarce costul
// în bani pe răspuns (doar tokeni), spre deosebire de OpenRouter. E folosit DOAR
// pentru raportul de cost al ownerului (adminul e scutit de debit din portofel),
// deci o estimare rezonabilă e suficientă; model nelistat → tariful Sonnet.
const PRICE_PER_MTOK: Record<string, [number, number]> = {
  'claude-opus-5': [15, 75],
  'claude-sonnet-5': [3, 15],
  'claude-fable-5': [1, 5],
  'claude-haiku-4-5-20251001': [1, 5],
}
function estimateCost(model: string, inTok: number, outTok: number): number {
  const [pin, pout] = PRICE_PER_MTOK[model] ?? PRICE_PER_MTOK['claude-sonnet-5']
  return (inTok / 1e6) * pin + (outTok / 1e6) * pout
}

interface ABlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string
  source?: { type: 'base64'; media_type: string; data: string }
}
interface AMessage {
  role: 'user' | 'assistant'
  content: ABlock[]
}

/** OrMessage[] (formatul casei) → corpul Anthropic Messages. Exportat pentru teste. */
export function toAnthropicPayload(
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: { maxTokens?: number; temperature?: number; toolChoice?: 'auto' | 'required' } = {},
): Record<string, unknown> {
  const systemParts: string[] = []
  const out: AMessage[] = []
  // Anthropic cere: rezultatele uneltelor (tool_result) stau într-un mesaj USER
  // imediat după mesajul ASISTENT cu tool_use. Orchestratorul emite un mesaj
  // role:'tool' per unealtă → le CONTOPIM în același mesaj user (blocuri lipite),
  // ca perechea tool_use↔tool_result să fie validă.
  const pushMerged = (role: 'user' | 'assistant', blocks: ABlock[]): void => {
    if (!blocks.length) return
    const last = out[out.length - 1]
    if (last && last.role === role) last.content.push(...blocks)
    else out.push({ role, content: blocks })
  }
  for (const m of messages) {
    if (m.role === 'system') {
      systemParts.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      continue
    }
    if (m.role === 'tool') {
      pushMerged('user', [
        { type: 'tool_result', tool_use_id: m.tool_call_id ?? '', content: String(m.content ?? '') },
      ])
      continue
    }
    const role: 'user' | 'assistant' = m.role === 'assistant' ? 'assistant' : 'user'
    const blocks: ABlock[] = []
    if (typeof m.content === 'string') {
      if (m.content) blocks.push({ type: 'text', text: m.content })
    } else if (Array.isArray(m.content)) {
      // Multimodal în format OpenAI (text + image_url cu data-URI) → blocuri Anthropic.
      for (const b of m.content as { type: string; text?: string; image_url?: { url?: string } }[]) {
        if (b.type === 'text' && b.text) blocks.push({ type: 'text', text: b.text })
        else if (b.type === 'image_url' && b.image_url?.url) {
          const mm = /^data:([^;]+);base64,(.+)$/.exec(b.image_url.url)
          if (mm) blocks.push({ type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } })
        }
      }
    }
    for (const c of m.tool_calls ?? []) {
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>
      } catch {
        /* argumente corupte → obiect gol */
      }
      blocks.push({ type: 'tool_use', id: c.id, name: c.function.name, input })
    }
    pushMerged(role, blocks)
  }
  // Anthropic cere ca primul mesaj să fie 'user'. Dacă din vreun motiv istoricul
  // începe cu asistent, punem un mesaj user minimal în față (nu strică firul).
  if (out.length && out[0].role === 'assistant') {
    out.unshift({ role: 'user', content: [{ type: 'text', text: '(continuă)' }] })
  }

  const body: Record<string, unknown> = {
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    messages: out,
  }
  if (systemParts.length) body.system = systemParts.join('\n\n')
  if (tools.length) {
    // Uneltele sunt DEJA în format Anthropic (name/description/input_schema) —
    // exact ce cere API-ul, fără nicio conversie.
    body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }))
    // 'any' = modelul TREBUIE să cheme o unealtă (turele de acțiune forțate);
    // altfel 'auto'.
    body.tool_choice = opts.toolChoice === 'required' ? { type: 'any' } : { type: 'auto' }
  }
  return body
}

function headers(key: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'x-api-key': key,
    'anthropic-version': A_VERSION,
  }
}

interface AResp {
  model?: string
  content?: ABlock[]
  stop_reason?: string
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { type?: string; message?: string }
}

function contentToResult(model: string, content: ABlock[], stop: string, inTok: number, outTok: number): OrChatResult {
  let text = ''
  const toolCalls: OrToolCall[] = []
  for (const b of content) {
    if (b.type === 'text' && b.text) text += b.text
    if (b.type === 'tool_use') {
      toolCalls.push({
        id: b.id || `toolu_${toolCalls.length}`,
        type: 'function',
        function: { name: b.name ?? 'tool', arguments: JSON.stringify(b.input ?? {}) },
      })
    }
  }
  return { text, toolCalls, costUsd: estimateCost(model, inTok, outTok), model, stop }
}

export async function anthropicDirectChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required'; apiKey?: string } = {},
): Promise<OrChatResult> {
  const key = (opts.apiKey ?? '').trim()
  if (!key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const body = { model, ...toAnthropicPayload(messages, tools, opts) }
  const r = await fetch(`${A_BASE}/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)
  const j = (await r.json()) as AResp
  return contentToResult(
    j.model ?? model,
    j.content ?? [],
    j.stop_reason ?? 'stop',
    j.usage?.input_tokens ?? 0,
    j.usage?.output_tokens ?? 0,
  )
}

// Varianta STREAMING (SSE Anthropic): textul curge prin onText (primul cuvânt
// instant), iar apelurile de unelte se asamblează din delte — aceeași formă de
// ieșire ca la OpenRouter/gemini.
export async function anthropicDirectChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required'; apiKey?: string } = {},
): Promise<OrChatResult> {
  const key = (opts.apiKey ?? '').trim()
  if (!key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const body = { model, stream: true, ...toAnthropicPayload(messages, tools, opts) }
  const r = await fetch(`${A_BASE}/messages`, {
    method: 'POST',
    headers: headers(key),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok || !r.body) {
    throw new Error(`anthropic ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)
  }

  let text = ''
  let served = model
  let stop = 'stop'
  let inTok = 0
  let outTok = 0
  // Blocurile vin pe index: text sau tool_use (cu argumentele JSON fragmentate în
  // delte 'input_json_delta'). Le asamblăm pe index, ca la OpenRouter.
  const blocks = new Map<number, { type: string; id: string; name: string; args: string; text: string }>()

  const reader = r.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (!data) continue
      let ev: {
        type?: string
        index?: number
        message?: { model?: string; usage?: { input_tokens?: number; output_tokens?: number } }
        content_block?: { type?: string; id?: string; name?: string }
        delta?: { type?: string; text?: string; partial_json?: string; stop_reason?: string }
        usage?: { output_tokens?: number }
      }
      try {
        ev = JSON.parse(data)
      } catch {
        continue
      }
      if (ev.type === 'message_start') {
        served = ev.message?.model ?? served
        inTok = ev.message?.usage?.input_tokens ?? inTok
      } else if (ev.type === 'content_block_start') {
        const idx = ev.index ?? 0
        blocks.set(idx, {
          type: ev.content_block?.type ?? 'text',
          id: ev.content_block?.id ?? '',
          name: ev.content_block?.name ?? '',
          args: '',
          text: '',
        })
      } else if (ev.type === 'content_block_delta') {
        const idx = ev.index ?? 0
        const cur = blocks.get(idx) ?? { type: 'text', id: '', name: '', args: '', text: '' }
        if (ev.delta?.type === 'text_delta' && ev.delta.text) {
          cur.text += ev.delta.text
          text += ev.delta.text
          onText(ev.delta.text)
        } else if (ev.delta?.type === 'input_json_delta' && ev.delta.partial_json) {
          cur.args += ev.delta.partial_json
        }
        blocks.set(idx, cur)
      } else if (ev.type === 'message_delta') {
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason
        outTok = ev.usage?.output_tokens ?? outTok
      }
    }
  }

  const toolCalls: OrToolCall[] = [...blocks.entries()]
    .sort((a, b) => a[0] - b[0])
    .filter(([, b]) => b.type === 'tool_use')
    .map(([, b]) => ({
      id: b.id || `toolu_${b.name}`,
      type: 'function' as const,
      function: { name: b.name, arguments: b.args || '{}' },
    }))
  return { text, toolCalls, costUsd: estimateCost(served, inTok, outTok), model: served, stop }
}

// Validează o cheie Anthropic FĂRĂ apel plătit: GET /v1/models întoarce 200 cu o
// cheie bună, 401 cu una greșită/expirată. Înlocuiește „soldul" (Anthropic n-are
// un endpoint public de credit rămas ca OpenRouter) cu un semnal cinstit
// „cheie validă / respinsă". Cache scurt per-cheie ca să nu lovim la fiecare bară.
export interface AnthropicKeyStatus {
  ok: boolean
  error?: string
}
const keyCache = new Map<string, { at: number; val: AnthropicKeyStatus }>()
export async function validateAnthropicKey(apiKey: string): Promise<AnthropicKeyStatus> {
  const key = (apiKey ?? '').trim()
  if (!key) return { ok: false, error: 'not_configured' }
  const id = key.slice(-8)
  const hit = keyCache.get(id)
  if (hit && Date.now() - hit.at < 60_000) return hit.val
  try {
    const r = await fetch(`${A_BASE}/models`, {
      headers: { 'x-api-key': key, 'anthropic-version': A_VERSION },
      signal: AbortSignal.timeout(12_000),
    })
    const val: AnthropicKeyStatus = r.ok ? { ok: true } : { ok: false, error: `http_${r.status}` }
    keyCache.set(id, { at: Date.now(), val })
    return val
  } catch (e) {
    return { ok: false, error: String(e).slice(0, 120) }
  }
}
