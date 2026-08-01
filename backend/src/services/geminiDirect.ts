import { config } from '../config.js'
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrMessage, OrToolCall } from './openrouter.js'
import { readSSE } from './sse.js'

// ── THE MAIN BRAIN: GEMINI DIRECT FROM GOOGLE (Adrian, 27 Jul: "switch to
// the other free one... gemini... as primary, and what's now primary becomes
// secondary") ──────────────────────────────────────────────────────────────
// The REAL top free tier: the free key from AI Studio (the owner's Google
// account) gives gemini-2.5-flash with vision+tools+thinking, above any :free
// model on OpenRouter. Here is the direct client on the Google API
// (generatelanguage), with the SAME input/output shapes as
// openrouterChat/Stream — the orchestrator can't tell the difference.
// Nemotron :free stays SECONDARY: chat.ts falls back to it automatically on
// Gemini quota exhaustion/error. The voice (OpenAI Realtime) doesn't go
// through here.

const G_BASE = 'https://generativelanguage.googleapis.com/v1beta'

export function geminiDirectAvailable(): boolean {
  return Boolean(config.geminiKey)
}

/** The internal prefix that routes the orchestrator to Google instead of OpenRouter. */
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

// The tools' JSON schema → the schema Gemini accepts (we keep only the
// supported keys; the rest is silently dropped, it doesn't break the call).
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

/** OrMessage[] (the house format) → the Gemini body. Exported for tests. */
export function toGeminiPayload(
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts = {},
): Record<string, unknown> {
  const sys: string[] = []
  const contents: GContent[] = []
  // functionResponse requires the function NAME; role:'tool' messages only
  // have the id — we rebuild the id→name map from the assistant's earlier
  // tool_calls.
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
      // Multimodal in OpenAI format (text + image_url with data-URI) → Gemini parts.
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
        /* corrupted arguments — we go with {} */
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
      // gemini-2.5's internal thinking: small budget by default so the
      // first word comes FAST (the latency rule); more only on heavy turns.
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
  // Really free: Google doesn't charge the free-tier key → the cost is 0, and that's how we report it.
  return { text, toolCalls, costUsd: 0, model, stop }
}

// The shared Gemini call (non-stream + stream): x-goog-api-key headers +
// toGeminiPayload body + timeout. It differs ONLY by the method suffix
// (generateContent vs streamGenerateContent?alt=sse). Single source (the
// permanent principle: unique, no duplicates).
function geminiFetch(
  model: string,
  method: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
): Promise<Response> {
  return fetch(`${G_BASE}/models/${model}:${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': config.geminiKey },
    body: JSON.stringify(toGeminiPayload(messages, tools, opts)),
    signal: AbortSignal.timeout(120_000),
  })
}

export async function geminiDirectChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  if (!config.geminiKey) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const r = await geminiFetch(model, 'generateContent', messages, tools, opts)
  if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)
  const j = (await r.json()) as GResp
  const cand = j.candidates?.[0]
  return partsToResult(cand?.content?.parts ?? [], model, cand?.finishReason ?? 'stop')
}

// The STREAMING variant (SSE): the text flows through onText (first word
// instantly), the tool calls are collected from chunks — same shape as at
// OpenRouter.
export async function geminiDirectChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  if (!config.geminiKey) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key' }
  const r = await geminiFetch(model, 'streamGenerateContent?alt=sse', messages, tools, opts)
  if (!r.ok || !r.body) throw new Error(`gemini ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}`)

  let text = ''
  const collected: GPart[] = []
  let stop = 'stop'
  // The SSE stream reading comes from the shared source (services/sse.ts);
  // the event processing (Gemini format: candidates/parts) stays here.
  await readSSE(r.body, (raw) => {
    const ev = raw as GResp
    const cand = ev.candidates?.[0]
    if (cand?.finishReason) stop = cand.finishReason
    for (const p of cand?.content?.parts ?? []) {
      if (p.text) {
        text += p.text
        onText(p.text)
      }
      if (p.functionCall) collected.push(p)
    }
  })
  const res = partsToResult(collected, model, stop)
  return { ...res, text }
}

/** Free quota exhausted / service unavailable — the signal to fall back to
 *  the SECONDARY (nemotron :free through OpenRouter). */
export function isGeminiQuotaError(e: unknown): boolean {
  return /gemini (429|500|503)|RESOURCE_EXHAUSTED|quota/i.test(String(e))
}
