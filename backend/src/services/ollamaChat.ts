import { config } from '../config.js'
import type { AnthropicTool, BrainCallOpts, OrChatResult, OrMessage, OrToolCall } from './brainContract.js'

// ── OLLAMA — PROVIDER LOCAL FREE PENTRU COMUTATORUL DE CREIER ────────────────
// (23 aug 2026 — owner: „trebuie un comutator de creier in admin".)
// Ollama rulează pe VPS (127.0.0.1:11434), FREE, fără internet. Modelul se
// alege din admin (comutator). Suportă format OpenAI (/v1/chat/completions)
// deci codul e aproape identic cu openrouter.ts — diferența e gazda + fără
// cost (costUsd mereu 0 — e local, nu se plătește nimic).

const OLLAMA_BASE = process.env.OLLAMA_API_BASE || 'http://127.0.0.1:11434' // hardcod-permis: gazda Ollama LOCALĂ implicită pe VPS, suprascrisă de env

export function ollamaAvailable(): boolean {
  return Boolean(OLLAMA_BASE)
}

function toolsToOpenAI(tools: AnthropicTool[]): unknown[] {
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }))
}

function ollamaBody(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
    temperature: opts.temperature ?? 0.7,
    stream,
  }
  if (tools.length) {
    body.tools = toolsToOpenAI(tools)
    body.tool_choice = opts.toolChoice ?? 'auto'
  }
  return body
}

async function ollamaFetch(body: unknown, timeoutMs = 120_000): Promise<Response> {
  return fetch(`${OLLAMA_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
}

async function ollamaCall(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[],
  opts: BrainCallOpts,
  stream: boolean,
): Promise<Response | OrChatResult> {
  if (!OLLAMA_BASE) return { text: '', toolCalls: [], costUsd: 0, model, stop: 'no_key', inputTokens: 0, outputTokens: 0 }
  return ollamaFetch(ollamaBody(model, messages, tools, opts, stream))
}

/** Chat non-streaming cu tool-use (format OpenAI compatibil Ollama). */
export async function ollamaChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const call = await ollamaCall(model, messages, tools, opts, false)
  if (!(call instanceof Response)) return call
  const r = call
  if (!r.ok) throw new Error(`ollama ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  const j = (await r.json()) as {
    choices?: { message?: { content?: string; tool_calls?: OrToolCall[] }; finish_reason?: string }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
    model?: string
  }
  const choice = j.choices?.[0]
  return {
    text: choice?.message?.content ?? '',
    toolCalls: choice?.message?.tool_calls ?? [],
    costUsd: 0, // local — fără cost
    model: j.model ?? model,
    stop: choice?.finish_reason ?? 'stop',
    inputTokens: Number(j.usage?.prompt_tokens ?? 0) || 0,
    outputTokens: Number(j.usage?.completion_tokens ?? 0) || 0,
  }
}

/** Verifică dacă Ollama răspunde pe VPS (ping simplu). */
export async function ollamaPing(): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) })
    return r.ok
  } catch {
    return false
  }
}
