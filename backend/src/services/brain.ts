import { config } from '../config.js'
import { GEMINI_DIRECT_PREFIX, geminiDirectChat, geminiDirectAvailable } from './geminiDirect.js'
import { openaiChat, openaiAvailable } from './openaiChat.js'
import { modelOpenAIExista, scaraOpenAI } from './openaiModele.js'
import type { AnthropicTool, OrChatResult, OrMessage } from './brainContract.js'
import type { Message } from './brain-types.js'
import { loadKv } from '../db.js'

// ── THE BRAIN — MULTI-PROVIDER CU COMUTATOR (23 aug 2026) ───────────────────
// Lacătul Gemini-only (3 aug) a fost DESCHIS de owner (23 aug: „oprește lacătul
// de pe gemeni, momentan" + „trebuie un comutator de creier in admin"). Doi
// provider-i pe prefix:
//   google-direct/*  → Gemini (default, are vedere + audio)
//   openai/*         → OpenAI ChatGPT (chat + vedere + reasoning)
// Vocea rămâne pe Gemini Live (are cameră în sesiune). Comutatorul alege
// provider-ul pentru CHAT/TEXT, nu pentru voce.

// A TRANSIENT error (provider saturated/down) — worth a pause before the next
// rung. 400/401/404 (our request/key) are NOT here: they're not transient, but
// we still move to the next model (a wrong name must not kill the expert).
export function isTransientBrainError(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err)
  return /\b429\b|rate.?limit|resourceexhausted|degraded|gemini (5\d\d|408|409)|timed? ?out|econnreset|etimedout|fetch failed/i.test(
    s,
  )
}

// COMUTATOR REAL (owner, 23 aug: „când e unul, trage după el tot; când e
// celălalt, trage tot"). Ladder-ul respectă creier_activ din KV. Pe OpenAI
// returnează treptele OpenAI (luna → medium → heavy → max); pe Gemini
// rămâne scară veche (flash → Pro → ultra). Modelul custom din KV vine primul.
export async function creierActivKv(): Promise<string> {
  try {
    return (await loadKv('creier_activ')) ?? 'google-direct'
  } catch {
    return 'google-direct'
  }
}

export async function creierModelCustomKv(): Promise<string> {
  try {
    return (await loadKv('creier_model')) ?? ''
  } catch {
    return ''
  }
}

// The expert's model ladder — respectă comutatorul (23 aug 2026). Pe Gemini:
// flash → Pro → ultra. Pe OpenAI: luna → medium → heavy → max. Modelul custom
// din KV vine PRIMUL (prioritate maximă). Extra rungs din env acceptate.
export async function expertModelLadder(): Promise<string[]> {
  const activ = await creierActivKv()
  if (activ === 'openai') {
    const custom = await creierModelCustomKv()
    const customValid = custom && await modelOpenAIExista(custom) ? [`openai/${custom.replace(/^openai\//, '')}`] : []
    const rungs = [...customValid, ...(await scaraOpenAI()).map((m) => `openai/${m}`)]
    const unice: string[] = []
    for (const r of rungs) {
      if (r && !unice.includes(r)) unice.push(r)
    }
    return unice
  }
  // Gemini (default): 4 trepte flash → Pro → ultra
  const rungs = [config.brain.workDefault, config.brain.profundDefault, config.brain.ultraDefault]
  const unice: string[] = []
  for (const r of rungs) {
    if (!unice.includes(r)) unice.push(r)
  }
  return unice
}

// Prefixele provider-elor (23 aug 2026 — comutator de creier).
export const OPENAI_PREFIX = 'openai/'

// The one call every rung goes through: dispatch pe prefix.
//   google-direct/* → Gemini (default)
//   openai/*        → OpenAI ChatGPT
export function brainChat(
  model: string,
  messages: OrMessage[],
  tools: AnthropicTool[] = [],
  opts: { maxTokens?: number; temperature?: number; reasoning?: 'low' | 'medium' | 'high' } = {},
): Promise<OrChatResult> {
  if (model.startsWith(GEMINI_DIRECT_PREFIX)) {
    return geminiDirectChat(model.slice(GEMINI_DIRECT_PREFIX.length), messages, tools, opts)
  }
  if (model.startsWith(OPENAI_PREFIX)) {
    return openaiChat(model.slice(OPENAI_PREFIX.length), messages, tools, opts)
  }
  return Promise.reject(new Error(`model_necunoscut: „${model}" — prefix necunoscut (acceptă: google-direct/ openai/)`))
}

// Runs a call across the model ladder: tries each rung, skips the saturated/
// dead ones, returns the FIRST good result; throws the last error only if ALL
// failed. `sleep`/`now` injectable for tests. Short total budget — the user is
// waiting for the expert, we don't keep him hanging on the ladder forever.
export async function runBrainLadder<T>(
  models: string[],
  call: (model: string) => Promise<T>,
  opts: { budgetMs?: number; sleep?: (ms: number) => Promise<void>; now?: () => number } = {},
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const now = opts.now ?? ((): number => Date.now())
  const budgetMs = opts.budgetMs ?? 30_000
  const start = now()
  let lastErr: unknown = new Error('expert indisponibil (scară goală)')
  for (let i = 0; i < models.length; i++) {
    if (i > 0 && now() - start > budgetMs) break
    try {
      return await call(models[i])
    } catch (e) {
      lastErr = e
      // Small pause ONLY on saturation (429) — gives the provider a moment; on
      // a definitive error (wrong model) we move instantly to the next one.
      if (i < models.length - 1 && isTransientBrainError(e)) await sleep(500)
    }
  }
  throw lastErr
}

// Minimal adapter compatible with the old client (used by services/agents.ts):
// `.messages.create({ model, max_tokens, system?, messages })` → Message with a
// single text block. No streaming (memory/summaries run in the background).
export const brain = {
  messages: {
    create: async (params: {
      model?: string
      max_tokens?: number
      system?: string
      messages: { role: string; content: string }[]
    }): Promise<Message> => {
      const msgs: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
      if (params.system) msgs.push({ role: 'system', content: params.system })
      for (const m of params.messages) {
        msgs.push({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: typeof m.content === 'string' ? m.content : '',
        })
      }
      // The model ladder here too (memory/summaries in the background): a 429
      // no longer leaves memory without learning. If a specific model was
      // requested, it is tried first.
      const ladder = params.model
        ? [params.model, ...(await expertModelLadder()).filter((m) => m !== params.model)]
        : await expertModelLadder()
      const r = await runBrainLadder(ladder, (m) => brainChat(m, msgs, [], { maxTokens: params.max_tokens }))
      return {
        id: '',
        role: 'assistant',
        model: r.model,
        content: [{ type: 'text', text: r.text }],
        stop_reason: null,
        stop_sequence: null,
        // REAL usage, as reported by the provider on the very call that
        // answered (the previous version returned literal zeros — a fabricated
        // measurement that silently zeroed the memory agent's cost ledger).
        usage: { input_tokens: r.inputTokens, output_tokens: r.outputTokens },
        // The REAL cost of the call, next to the Message so the caller books a
        // measurement, not an estimate. (Gemini free-tier reports 0.)
        costUsd: r.costUsd,
      }
    },
  },
}

// (describeScene — „vederea delegată" pentru creierele OARBE din pool-ul
// OpenRouter — a fost ȘTEARSĂ, 3 aug: creierul e Gemini-only și VEDE nativ
// (toGeminiPayload → inline_data), deci nu mai există niciun creier orb căruia
// să-i descrii poza.)

// A short text answer from the brain (mailbox, admin). Empty on failure —
// never throws. onCost (Jul 25): voice must DEBIT the real cost of the
// escalation — without the callback, the cost was lost and the user consumed
// brain for free.
export async function brainComplete(
  prompt: string,
  maxTokens = 1024,
  onCost?: (usd: number) => void,
): Promise<string> {
  try {
    // reasoning medium (Jul 25): the escalation brain THINKS for real before
    // answering — Adrian's requirement "true, complete reasoning".
    // The model LADDER (Jul 29): on 429 on the current rung, it moves to the
    // next one instead of going silent on the first attempt.
    const r = await runBrainLadder(await expertModelLadder(), (m) =>
      brainChat(m, [{ role: 'user', content: prompt }], [], { maxTokens, reasoning: 'medium' }),
    )
    if (onCost && r.costUsd > 0) onCost(r.costUsd)
    return r.text.trim()
  } catch {
    return ''
  }
}

/** Parsează argumentele unui tool call cu fallback curat pentru erori de serializare. */
export function parseazaArgumenteTool(argumentsStr: string | null | undefined): Record<string, unknown> {
  if (!argumentsStr || typeof argumentsStr !== 'string') {
    return {}
  }
  try {
    const parsed = JSON.parse(argumentsStr) as Record<string, unknown>
    // Fallback dacă nu e obiect valid
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }
    return parsed
  } catch {
    // Eroare de parsing JSON → returnează obiect gol, nu aruncă
    return {}
  }
}

/** Serializare sigură a argumentelor pentru tool call — garantează string JSON valid pentru API. */
function serializeazaArgumenteToolCall(args: Record<string, unknown>): string {
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    return '{}'
  }
  try {
    return JSON.stringify(args)
  } catch {
    return '{}'
  }
}

// ESCALATION WITH TOOLS (Adrian, Jul 27: "Kelion cannot see all of his source
// code, why?" — voice escalated to a brain WITHOUT tools, which denied the
// access). A small tool-calling loop on the same work model: the model calls
// the tools it received (source/DB/constructor...), gets the results and only
// then formulates the final answer.
export async function brainCompleteWithTools(
  prompt: string,
  tools: AnthropicTool[],
  execTool: (name: string, args: Record<string, unknown>) => Promise<string>,
  opts: {
    maxTokens?: number
    maxRounds?: number
    onCost?: (usd: number) => void
    /** FORCED LADDER — for heavy tasks (Adrian, Jul 31: "difficulty level set
     *  automatically per requirement"). Without it, the usual ladder is used,
     *  which starts with the WORK model; a difficulty-5 task deserves the best
     *  hand from the start, not after it has wasted its turns. */
    models?: string[]
  } = {},
): Promise<string> {
  const maxRounds = opts.maxRounds ?? 6
  const messages: OrMessage[] = [{ role: 'user', content: prompt }]
  // The same model ladder as brainComplete — every ROUND tries it, so a 429
  // on one rung no longer breaks the expert's whole tool loop.
  const ladder = opts.models?.length ? opts.models : await expertModelLadder()
  try {
    for (let round = 0; round < maxRounds; round++) {
      const r = await runBrainLadder(ladder, (m) =>
        brainChat(m, messages, tools, { maxTokens: opts.maxTokens ?? 2000, reasoning: 'medium' }),
      )
      if (opts.onCost && r.costUsd > 0) opts.onCost(r.costUsd)
      if (!r.toolCalls.length) return r.text.trim()
      // S2: Tool call formatting — serialize arguments as valid JSON string
      messages.push({ 
        role: 'assistant', 
        content: r.text || '', 
        tool_calls: r.toolCalls.map((tc) => ({
          ...tc,
          function: {
            name: tc.function.name,
            arguments: serializeazaArgumenteToolCall(parseazaArgumenteTool(tc.function.arguments)),
          },
        }))
      })
      for (const c of r.toolCalls) {
        // Parse curat cu fallback pentru argumente malformate (S2)
        const args = parseazaArgumenteTool(c.function.arguments || '{}')
        const out = await execTool(c.function.name, args).catch((e: Error) => JSON.stringify({ error: e.message }))
        messages.push({ role: 'tool', tool_call_id: c.id, content: out.slice(0, 60_000) })
      }
    }
    // round ceiling reached — we ask for the final answer without more tools
    const last = await runBrainLadder(ladder, (m) =>
      brainChat(m, messages, [], { maxTokens: opts.maxTokens ?? 2000 }),
    )
    if (opts.onCost && last.costUsd > 0) opts.onCost(last.costUsd)
    return last.text.trim()
  } catch {
    return ''
  }
}

// Checks the default models (chat + work) with a real ping through Gemini.
export async function verifyModels(): Promise<Record<string, string>> {
  const ping = async (model: string): Promise<string> => {
    try {
      // 64, not 16: thinking models spend budget tokens ON THINKING before the
      // answer — with a tiny cap the content comes out empty and the ping
      // falsely reports "fail" on a live model.
      const r = await brainChat(model, [{ role: 'user', content: 'Reply with the single word: ok' }], [], {
        maxTokens: 64,
      })
      return r.text ? `ok (served by ${r.model})` : 'fail'
    } catch {
      return 'fail'
    }
  }
  return {
    [config.brain.chatDefault]: await ping(config.brain.chatDefault),
    [config.brain.workDefault]: await ping(config.brain.workDefault),
    [config.brain.profundDefault]: await ping(config.brain.profundDefault),
  }
}

// Checks the Gemini key (a single key for the whole brain).
export async function verifyKeys(): Promise<{
  primary: string
  reserve: string
  diag: Record<string, unknown>
}> {
  if (!geminiDirectAvailable()) {
    return { primary: 'not_configured', reserve: 'not_configured', diag: { geminiKeyLen: 0 } }
  }
  let primary = 'fail'
  try {
    const r = await brainChat(config.brain.chatDefault, [{ role: 'user', content: 'ping' }], [], {
      maxTokens: 1,
    })
    primary = r.model ? 'ok' : 'fail'
  } catch {
    primary = 'fail'
  }
  return { primary, reserve: primary, diag: { geminiKeyLen: config.geminiKey.length } }
}
