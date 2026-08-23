import { config } from '../config.js'
import { readSSE } from './sse.js'
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrMessage, OrToolCall } from './brainContract.js'

// ── OPENROUTER — PROVIDER FALLBACK PENTRU COMUTATORUL DE CREIER ──────────────
// (Reintrodus 23 aug 2026 — owner: „trebuie un comutator de creier in admin".)
// OpenRouter e UNUL din cele 3 provider-e ale creierului (google-direct /
// openrouter / ollama). NU e primar — Gemini rămâne default; OpenRouter intră
// doar când ownerul comută din admin. Cheia din env (OPENROUTER_API_KEY).
//
// Ce PĂSTREZĂ din codul vechi (extirpat 3 aug): funcția de chat + tools +
// streaming. Ce NU mai am: catalogul live, clasificarea de cost, cursa/rotația
// — erau pentru vechiul sistem multi-model, acum comutatorul alege UN model.

const OR_BASE = 'https://openrouter.ai/api/v1'

export function openrouterAvailable(): boolean {
  return Boolean(config.openrouter.key)
}

function toolsToOpenAI(tools: AnthropicTool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

// Audio brut (audio_url) e înțeles NATIV doar de Gemini. Modelele de pe
// OpenRouter NU acceptă audio → îl scoatem, lăsăm textul (transcriptul) ca
// rezervă. Astfel același messages merge la ambele căi.
function faraAudioParts(messages: OrMessage[]): OrMessage[] {
  let aScos = false
  const out = messages.map((m) => {
    if (!Array.isArray(m.content)) return m
    const blocuri = m.content as { type: string }[]
    const filtrate = blocuri.filter((b) => b.type !== 'audio_url')
    if (filtrate.length === blocuri.length) return m
    aScos = true
    const content = (filtrate.length ? filtrate : '(voce)') as OrMessage['content']
    return { ...m, content }
  })
  return aScos ? out : messages
}

function orBody(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: faraAudioParts(messages),
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    usage: { include: true },
  }
  if (stream) {
    body.stream = true
    body.stream_options = { include_usage: true }
  }
  if (opts.reasoning) body.reasoning = { effort: opts.reasoning }
  if (tools.length) {
    body.tools = toolsToOpenAI(tools)
    body.tool_choice = opts.toolChoice ?? 'auto'
  }
  return body
}

function orFetch(body: unknown, timeoutMs = 120_000): Promise<Response> {
  return fetch(`${OR_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openrouter.key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kelionai.app',
      'X-Title': 'Kelionai',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function orCall(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Promise<Response | OrChatResult> {
  if (!config.openrouter.key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key', inputTokens: 0, outputTokens: 0 }
  return orFetch(orBody(model, messages, tools, opts, stream))
}

/** Chat non-streaming cu tool-use (format OpenAI). Returnează textul, tool
 *  calls, și costul REAL (din usage.cost). */
export async function openrouterChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const call = await orCall(model, messages, tools, opts, false)
  if (!(call instanceof Response)) return call
  const r = call
  if (!r.ok) throw new Error(`openrouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const j = (await r.json()) as {
    choices?: { message?: { content?: string; tool_calls?: OrToolCall[] }; finish_reason?: string }[]
    usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
    model?: string
  }
  const choice = j.choices?.[0]
  return {
    text: choice?.message?.content ?? '',
    toolCalls: choice?.message?.tool_calls ?? [],
    costUsd: Number(j.usage?.cost ?? 0),
    model: j.model ?? model,
    stop: choice?.finish_reason ?? 'stop',
    inputTokens: Number(j.usage?.prompt_tokens ?? 0) || 0,
    outputTokens: Number(j.usage?.completion_tokens ?? 0) || 0,
  }
}

/** Chat streaming — textul curge prin `onText` (prima vorbă instant), tool
 *  calls se asamblează din delta-uri pe index. */
export async function openrouterChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const call = await orCall(model, messages, tools, opts, true)
  if (!(call instanceof Response)) return call
  const r = call
  if (!r.ok || !r.body) {
    throw new Error(`openrouter ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  }

  let text = ''
  let costUsd = 0
  let inputTokens = 0
  let outputTokens = 0
  let served = model
  let stop = 'stop'
  const calls = new Map<number, { id: string; name: string; args: string }>()

  await readSSE(r.body, (raw) => {
    const ev = raw as {
      choices?: {
        delta?: { content?: string; tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[] }
        finish_reason?: string
      }[]
      usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number }
      model?: string
    }
    if (ev.model) served = ev.model
    if (ev.usage?.cost != null) costUsd = Number(ev.usage.cost)
    if (ev.usage?.prompt_tokens != null) inputTokens = Number(ev.usage.prompt_tokens) || 0
    if (ev.usage?.completion_tokens != null) outputTokens = Number(ev.usage.completion_tokens) || 0
    const choice = ev.choices?.[0]
    if (!choice) return
    if (choice.finish_reason) stop = choice.finish_reason
    const d = choice.delta
    if (d?.content) {
      text += d.content
      onText(d.content)
    }
    if (d?.tool_calls) {
      for (const tc of d.tool_calls) {
        const idx = tc.index ?? 0
        const existing = calls.get(idx) ?? { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' }
        if (tc.id) existing.id = tc.id
        if (tc.function?.name) existing.name = tc.function.name
        if (tc.function?.arguments) existing.args += tc.function.arguments
        calls.set(idx, existing)
      }
    }
  })

  const toolCalls = Array.from(calls.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, c]) => ({ id: c.id || `call_${c.name}`, type: 'function' as const, function: { name: c.name, arguments: c.args } }))
  return { text, toolCalls, costUsd, model: served, stop, inputTokens, outputTokens }
}
