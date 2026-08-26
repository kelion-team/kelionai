import { config } from '../config.js'
import { openaiChat, openaiAvailable } from './openaiChat.js'
import { modelOpenAIExista, scaraOpenAI } from './openaiModele.js'
import type { BrainTool, BrainCallOpts, OrChatResult, OrMessage } from './brainContract.js'
import type { Message } from './brain-types.js'

// The only product brain is OpenAI Responses. The `openai/` prefix remains an
// internal routing marker, not a second provider switch.

// A TRANSIENT error (provider saturated/down) — worth a pause before the next
// rung. 400/401/404 (our request/key) are NOT here: they're not transient, but
// we still move to the next model (a wrong name must not kill the expert).
export function isTransientBrainError(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err)
  return /\b429\b|rate.?limit|degraded|openai (5\d\d|408|409)|timed? ?out|econnreset|etimedout|fetch failed/i.test(
    s,
  )
}

function isAllowedOpenAIModel(model: string): boolean {
  return /^[a-z0-9][a-z0-9._:-]{0,199}$/i.test(model)
}

// Preserve the workload roles: Luna (fast/high-volume), Terra (balanced), Sol
// (frontier). Model identifiers come only from validated runtime configuration.
export async function expertModelLadder(): Promise<string[]> {
  const rungs = (await scaraOpenAI())
    .filter(isAllowedOpenAIModel)
    .map((model) => `openai/${model}`)
  const unice: string[] = []
  for (const r of rungs) {
    if (!unice.includes(r)) unice.push(r)
  }
  return unice
}

export const OPENAI_PREFIX = 'openai/'

function openAIModelCode(model: string): string {
  const code = model.startsWith(OPENAI_PREFIX) ? model.slice(OPENAI_PREFIX.length) : model
  if (!isAllowedOpenAIModel(code)) throw new Error(`model_necunoscut: „${model}" — este permis doar un model OpenAI configurat`)
  return code
}

export async function brainChat(
  model: string,
  messages: OrMessage[],
  tools: BrainTool[] = [],
  opts: BrainCallOpts = {},
): Promise<OrChatResult> {
  const code = openAIModelCode(model)
  if (!(await modelOpenAIExista(code))) {
    throw new Error(`model_openai_nevalidat_catalog: ${code}`)
  }
  return openaiChat(code, messages, tools, opts)
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
      // Invalid request/auth/configuration errors are terminal. Escalation is
      // only valid for clearly transient availability or capacity failures.
      if (!isTransientBrainError(e)) throw e
      if (i < models.length - 1) await sleep(500)
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
        // measurement, not a fabricated zero.
        costUsd: r.costUsd,
      }
    },
  },
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

// ESCALATION WITH TOOLS (Adrian, Jul 27: "Kelion cannot see all of his source
// code, why?" — voice escalated to a brain WITHOUT tools, which denied the
// access). A small tool-calling loop on the same work model: the model calls
// the tools it received (source/DB/constructor...), gets the results and only
// then formulates the final answer.
export async function brainCompleteWithTools(
  prompt: string,
  tools: BrainTool[],
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
      if (opts.onCost && typeof r.costUsd === 'number' && r.costUsd > 0) opts.onCost(r.costUsd)
      if (!r.toolCalls.length) return r.text.trim()
      // Stateless Responses requires the exact prior output, including opaque
      // encrypted reasoning, before function_call_output items.
      messages.push({ role: 'assistant', content: '', response_items: r.responseItems })
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
    if (opts.onCost && typeof last.costUsd === 'number' && last.costUsd > 0) opts.onCost(last.costUsd)
    return last.text.trim()
  } catch {
    return ''
  }
}

// Checks the configured OpenAI workload models with a real Responses call.
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
    [config.openai.luna]: await ping(`${OPENAI_PREFIX}${config.openai.luna}`),
    [config.openai.medium]: await ping(`${OPENAI_PREFIX}${config.openai.medium}`),
    [config.openai.heavy]: await ping(`${OPENAI_PREFIX}${config.openai.heavy}`),
  }
}

// Checks the API key without exposing it in diagnostics.
export async function verifyKeys(): Promise<{
  primary: string
  reserve: string
  diag: Record<string, unknown>
}> {
  if (!openaiAvailable()) {
    return { primary: 'not_configured', reserve: 'not_configured', diag: { provider: 'openai' } }
  }
  let primary = 'fail'
  let failureStatus: number | undefined
  try {
    const r = await brainChat(`${OPENAI_PREFIX}${config.openai.luna}`, [{ role: 'user', content: 'ping' }], [], {
      // Modelele cu raționament pot consuma bugetul înainte să emită text;
      // aceeași limită dovedită de verifyModels evită un „fail” fals la cheie.
      maxTokens: 64,
    })
    primary = r.model ? 'ok' : 'fail'
  } catch (error) {
    const match = /\bopenai\s+([45]\d{2})\b/i.exec(error instanceof Error ? error.message : String(error))
    failureStatus = match ? Number(match[1]) : undefined
    primary = failureStatus ? `fail_${failureStatus}` : 'fail'
  }
  return {
    primary,
    reserve: primary,
    diag: { provider: 'openai', ...(failureStatus ? { status: failureStatus } : {}) },
  }
}
