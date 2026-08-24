import { config } from '../config.js'
import { readSSE } from './sse.js'
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrMessage, OrToolCall } from './brainContract.js'

// ── OPENAI CHAT — PROVIDER PENTRU COMUTATORUL DE CREIER ─────────────────────
// (23 aug 2026 — owner a aprobat OpenAI/ChatGPT ca provider alternativ pentru
// chat/text. Nu e primar — Gemini rămâne default; OpenAI intră doar când
// ownerul comută din admin. Cheia din env (OPENAI_API_KEY).)

export const OPENAI_BASE = 'https://api.openai.com/v1'

export function openaiAvailable(): boolean {
  return Boolean(config.openai?.key)
}

function toolsToOpenAI(tools: AnthropicTool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

// Audio brut (audio_url) nu e înțeles de modelele OpenAI de chat. Scoatem
// audio-ul și lăsăm transcriptul ca rezervă — astfel aceleași messages merg
// la ambele provider-i.
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

function openaiBody(
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
    stream,
  }
  if (opts.reasoning) body.reasoning_effort = opts.reasoning
  if (tools.length) {
    body.tools = toolsToOpenAI(tools)
    body.tool_choice = opts.toolChoice ?? 'auto'
  }
  return body
}

function openaiFetch(body: unknown, timeoutMs = 120_000): Promise<Response> {
  return fetch(`${OPENAI_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.openai?.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function openaiCall(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Promise<Response | OrChatResult> {
  if (!config.openai?.key) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key', inputTokens: 0, outputTokens: 0 }
  return openaiFetch(openaiBody(model, messages, tools, opts, stream))
}

/** Chat non-streaming cu tool-use (format OpenAI). */
export async function openaiChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const call = await openaiCall(model, messages, tools, opts, false)
  if (!(call instanceof Response)) return call
  const r = call
  if (!r.ok) throw new Error(`openai ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const j = (await r.json()) as {
    choices?: { message?: { content?: string; tool_calls?: OrToolCall[]; refusal?: string }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    model?: string
  }
  const choice = j.choices?.[0]
  const text = choice?.message?.refusal ? `[refuz: ${choice.message.refusal}]` : (choice?.message?.content ?? '')
  const promptTokens = Number(j.usage?.prompt_tokens ?? 0) || 0
  const completionTokens = Number(j.usage?.completion_tokens ?? 0) || 0
  // Cost estimat — nu e în usage, calculăm din prețurile publicate.
  const costUsd = estimeazaCost(model, promptTokens, completionTokens)
  return {
    text,
    toolCalls: choice?.message?.tool_calls ?? [],
    costUsd,
    model: j.model ?? model,
    stop: choice?.finish_reason ?? 'stop',
    inputTokens: promptTokens,
    outputTokens: completionTokens,
  }
}

/** Estimează costul în USD din prețurile OpenAI (per 1M tokens). hardcod-permis:
 *  prețurile sunt date publice OpenAI, cu fallback — se pot suprascrie via env. */
function estimeazaCost(model: string, inputTokens: number, outputTokens: number): number {
  // hardcod-permis: fallback-ul este tariful public măsurat și documentat de OpenAI;
  // valorile venite prin env au prioritate fără a cere o publicare nouă.
  const m = model.replace(/-\d{4}(-α|-β)?$/g, '') // normalizează snapshot-uri
  const prices: Record<string, { in: number; out: number }> = {
    'gpt-5.5': { in: 5.00, out: 30.00 },
    'gpt-5.5-pro': { in: 30.00, out: 180.00 },
    'gpt-5.4': { in: 2.50, out: 15.00 },
    'gpt-5.4-mini': { in: 0.75, out: 4.50 },
    'gpt-5.4-nano': { in: 0.20, out: 1.25 },
    'gpt-5.4-pro': { in: 30.00, out: 180.00 },
    'gpt-5.2': { in: 1.75, out: 14.00 },
    'gpt-5.2-pro': { in: 21.00, out: 168.00 },
    'gpt-5.1': { in: 1.25, out: 10.00 },
    'gpt-5.1-codex': { in: 1.25, out: 10.00 },
    'gpt-5.1-codex-mini': { in: 1.25, out: 10.00 },
    'gpt-5.1-codex-max': { in: 1.25, out: 10.00 },
    'gpt-5.1-chat': { in: 1.25, out: 10.00 },
    'gpt-5': { in: 1.25, out: 10.00 },
    'gpt-5-mini': { in: 0.25, out: 2.00 },
    'gpt-5-nano': { in: 0.05, out: 0.40 },
    'gpt-5-pro': { in: 15.00, out: 120.00 },
    'gpt-4.1': { in: 2.00, out: 8.00 },
    'gpt-4.1-mini': { in: 0.40, out: 1.60 },
    'gpt-4.1-nano': { in: 0.10, out: 0.40 },
    'gpt-4o': { in: 2.50, out: 10.00 },
    'gpt-4o-mini': { in: 0.15, out: 0.60 },
    'o1': { in: 15.00, out: 60.00 },
    'o1-pro': { in: 150.00, out: 600.00 },
    'o3-pro': { in: 20.00, out: 80.00 },
    'o3': { in: 2.00, out: 8.00 },
    'o4-mini': { in: 1.10, out: 4.40 },
    'o3-mini': { in: 1.10, out: 4.40 },
    'gpt-3.5-turbo': { in: 0.50, out: 1.50 },
  }
  let suprascrieri: Record<string, { in: number; out: number }> = {}
  try {
    const parsed = JSON.parse(process.env.OPENAI_PRICES_JSON ?? '') as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [id, valoare] of Object.entries(parsed as Record<string, unknown>)) {
        if (!valoare || typeof valoare !== 'object' || Array.isArray(valoare)) continue
        const tarif = valoare as { in?: unknown; out?: unknown; input?: unknown; output?: unknown }
        const input = Number(tarif.in ?? tarif.input)
        const output = Number(tarif.out ?? tarif.output)
        if (Number.isFinite(input) && input >= 0 && Number.isFinite(output) && output >= 0) {
          suprascrieri[id] = { in: input, out: output }
        }
      }
    }
  } catch {
    suprascrieri = {}
  }
  const p = { ...prices, ...suprascrieri }[m] ?? { in: 0, out: 0 }
  return (inputTokens * p.in + outputTokens * p.out) / 1_000_000
}

/** Chat streaming — textul curge prin `onText`, tool calls se asamblează. */
export async function openaiChatStream(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  onText: (delta: string) => void,
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const call = await openaiCall(model, messages, tools, opts, true)
  if (!(call instanceof Response)) return call
  const r = call
  if (!r.ok || !r.body) {
    throw new Error(`openai ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  }

  let text = ''
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
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      model?: string
    }
    if (ev.model) served = ev.model
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
  const costUsd = estimeazaCost(served, inputTokens, outputTokens)
  return { text, toolCalls, costUsd, model: served, stop, inputTokens, outputTokens }
}
