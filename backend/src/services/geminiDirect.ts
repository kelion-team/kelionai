import { config } from '../config.js'
import type { AnthropicTool, OrChatResult, OrMessage, OrToolCall } from './openrouter.js'

// ── CREIERUL PRINCIPAL: GEMINI DIRECT DE LA GOOGLE (Adrian, 27 iul: „comută la
// celălalt free... gemini... principal, și ce e acum secundar") ───────────────
// Treapta gratuită REALĂ de vârf: cheia gratuită din AI Studio (contul Google al
// ownerului) dă gemini-2.5-flash cu vedere+unelte+gândire, peste orice model
// :free din OpenRouter. Aici e clientul direct pe API-ul Google (generatelanguage),
// cu ACELEAȘI forme de intrare/ieșire ca openrouterChat/Stream — orchestratorul
// nu știe diferența. Nemotron :free rămâne SECUNDARUL: chat.ts cade automat pe
// el la cotă epuizată/eroare Gemini. Vocea (OpenAI Realtime) nu trece pe aici.

const G_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export function geminiDirectAvailable(): boolean {
  return Boolean(config.geminiKey)
}

/** Prefixul intern care rutează orchestratorul spre Google în loc de OpenRouter. */
export const GEMINI_DIRECT_PREFIX = 'google-direct/'

interface GPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
  functionResponse?: { name: string; response: Record<string, unknown> }
  inline_data?: { mime_type: string; data: string }
}
interface GContent {
  role: 'user' | 'model'
  parts: GPart[]
}

// Schema JSON a uneltelor → schema acceptată de Gemini (păstrăm doar cheile
// suportate; restul se aruncă în tăcere, nu strică apelul).
function cleanSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(cleanSchema)
  if (!s || typeof s !== 'object') return s
  const keep = ['type', 'description', 'properties', 'required', 'items', 'enum', 'nullable']
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (!keep.includes(k)) continue
    out[k] = k === 'properties' && v && typeof v === 'object'
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([pk, pv]) => [pk, cleanSchema(pv)]))
      : cleanSchema(v)
  }
  return out
}

/** OrMessage[] (formatul casei) → corpul Gemini. Exportat pentru teste. */
export function toGeminiPayload(
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required' } = {},
): Record<string, unknown> {
  const sys: string[] = []
  const contents: GContent[] = []
  // functionResponse cere NUMELE funcției; mesajele role:'tool' au doar id-ul —
  // reconstruim harta id→nume din tool_calls-urile asistentului dinainte.
  const idToName = new Map<string, string>()
  for (const m of messages) {
    for (const c of m.tool_calls ?? []) idToName.set(c.id, c.function.name)
  }
  for (const m of messages) {
    if (m.role === 'system') {
      sys.push(typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
      continue
    }
    if (m.role === 'tool') {
      const name = idToName.get(m.tool_call_id ?? '') ?? 'tool'
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: { result: String(m.content ?? '') } } }],
      })
      continue
    }
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user'
    const parts: GPart[] = []
    if (typeof m.content === 'string') {
      if (m.content) parts.push({ text: m.content })
    } else if (Array.isArray(m.content)) {
      // Multimodal în format OpenAI (text + image_url cu data-URI) → părți Gemini.
      for (const b of m.content as { type: string; text?: string; image_url?: { url?: string } }[]) {
        if (b.type === 'text' && b.text) parts.push({ text: b.text })
        else if (b.type === 'image_url' && b.image_url?.url) {
          const mm = /^data:([^;]+);base64,(.+)$/.exec(b.image_url.url)
          if (mm) parts.push({ inline_data: { mime_type: mm[1], data: mm[2] } })
        }
      }
    }
    for (const c of m.tool_calls ?? []) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>
      } catch {
        /* argumente corupte — mergem cu {} */
      }
      parts.push({ functionCall: { name: c.function.name, args } })
    }
    if (!parts.length) continue
    contents.push({ role, parts })
  }

  const body: Record<string, unknown> = {
    contents,
    generationConfig: {
      maxOutputTokens: opts.maxTokens ?? 1024,
      temperature: opts.temperature ?? 0.7,
      // Gândirea internă a lui gemini-2.5: buget mic implicit ca primul cuvânt
      // să vină REPEDE (regula de latență); mai mult doar pe turele grele.
      thinkingConfig: {
        thinkingBudget: opts.reasoning === 'high' ? 4096 : opts.reasoning === 'medium' ? 1024 : opts.reasoning === 'low' ? 512 : 0,
      },
    },
  }
  if (sys.length) body.systemInstruction = { parts: [{ text: sys.join('\n\n') }] }
  if (tools.length) {
    body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: cleanSchema(t.input_schema) })) }]
    body.toolConfig = { functionCallingConfig: { mode: opts.toolChoice === 'required' ? 'ANY' : 'AUTO' } }
  }
  return body
}

interface GResp {
  candidates?: { content?: { parts?: GPart[] }; finishReason?: string }[]
  error?: { code?: number; message?: string; status?: string }
}

function partsToResult(parts: GPart[], model: string, stop: string): OrChatResult {
  let text = ''
  const toolCalls: OrToolCall[] = []
  for (const p of parts) {
    if (p.text) text += p.text
    if (p.functionCall) {
      toolCalls.push({
        id: `g_${toolCalls.length}_${Math.random().toString(36).slice(2, 8)}`,
        type: 'function',
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
      })
    }
  }
  // Gratuit real: Google nu taxează cheia free-tier → costul e 0, și așa îl raportăm.
  return { text, toolCalls, costUsd: 0, model, stop }
}

export async function geminiDirectChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required' } = {},
): Promise<OrChatResult> {
  if (!config.geminiKey) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const r = await fetch(`${G_BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify(toGeminiPayload(messages, tools, opts)),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)
  const j = (await r.json()) as GResp
  const cand = j.candidates?.[0]
  return partsToResult(cand?.content?.parts ?? [], model, cand?.finishReason ?? 'stop')
}

// Varianta STREAMING (SSE): textul curge prin onText (primul cuvânt instant),
// apelurile de unelte se strâng din chunk-uri — aceeași formă ca la OpenRouter.
export async function geminiDirectChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high'; toolChoice?: 'auto' | 'required' } = {},
): Promise<OrChatResult> {
  if (!config.geminiKey) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const r = await fetch(`${G_BASE}/models/${model}:streamGenerateContent?alt=sse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify(toGeminiPayload(messages, tools, opts)),
    signal: AbortSignal.timeout(120_000),
  })
  if (!r.ok || !r.body) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)

  let text = ''
  const collected: GPart[] = []
  let stop = 'stop'
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
      if (!data || data === '[DONE]') continue
      let ev: GResp
      try {
        ev = JSON.parse(data) as GResp
      } catch {
        continue
      }
      const cand = ev.candidates?.[0]
      if (cand?.finishReason) stop = cand.finishReason
      for (const p of cand?.content?.parts ?? []) {
        if (p.text) {
          text += p.text
          onText(p.text)
        }
        if (p.functionCall) collected.push(p)
      }
    }
  }
  const res = partsToResult(collected, model, stop)
  return { ...res, text }
}

/** Cota gratuită epuizată / serviciu indisponibil — semnalul pentru căderea pe
 *  SECUNDAR (nemotron :free prin OpenRouter). */
export function isGeminiQuotaError(e: unknown): boolean {
  return /gemini (429|500|503)|RESOURCE_EXHAUSTED|quota/i.test(String(e))
}
