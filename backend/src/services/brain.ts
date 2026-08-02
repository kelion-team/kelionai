import { config } from '../config.js'
import { openrouterChat } from './openrouter.js'
import type { AnthropicTool, OrMessage } from './openrouter.js'
import type { Message } from './brain-types.js'

// ── THE BRAIN — 100% OpenRouter ─────────────────────────────────────────────
// Kimi and GLM REMOVED FOR GOOD (Adrian: "0 kimi, 0 glm, never"). The whole
// brain goes through a single OpenRouter key (GPT/Gemini/Claude). The
// selectable chat model is managed in chat.ts (orchestrator); only the
// non-streaming utilities used outside the chat remain here: memory (agents),
// short summaries (mailbox/admin) and the key check.


// ── THE RELIABLE EXPERT (Stage 1, owner order Jul 29) ───────────────────────
// THE CAUSE (confirmed in code + the constructor's logs): brainComplete/
// WithTools called `workModel()` ONLY ONCE; on 429/`:free` saturation,
// openrouterChat threw, and `catch { return '' }` returned empty → "the expert
// doesn't answer" (exactly the symptom Kelion reported). Now the expert walks
// a LADDER of free models (work → top → reserves), skips the saturated/dead
// ones and answers from the first free rung. Only if the WHOLE ladder fails
// does it stay silent — but only after trying everything, not on the first
// attempt. The same cure as the constructor's.

// A TRANSIENT error (provider saturated/down) — worth moving to another model.
// 400/401/404 (our request/key) are NOT here: they're not transient, but we
// still move to the next model (a wrong name must not kill the expert).
export function isTransientBrainError(err: unknown): boolean {
  const s = String((err as { message?: string })?.message ?? err)
  return /\b429\b|rate.?limit|resourceexhausted|degraded|provider returned error|openrouter (5\d\d|408|409)|timed? ?out|econnreset|etimedout|fetch failed/i.test(
    s,
  )
}

// The expert's model ladder: work → top → free reserves. Editable from env
// (OPENROUTER_EXPERT_FALLBACKS) without a deploy. Deduplicated, order kept.
export function expertModelLadder(): string[] {
  const extra = (
    process.env.OPENROUTER_EXPERT_FALLBACKS ??
    'nvidia/nemotron-3-super-120b-a12b:free,google/gemma-4-31b-it:free,cohere/north-mini-code:free'
  )
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  for (const m of [config.openrouter.workDefault, config.openrouter.topDefault, ...extra]) {
    if (m && !out.includes(m)) out.push(m)
  }
  return out
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
        ? [params.model, ...expertModelLadder().filter((m) => m !== params.model)]
        : expertModelLadder()
      const r = await runBrainLadder(ladder, (m) => openrouterChat(m, msgs, [], { maxTokens: params.max_tokens }))
      return {
        id: '',
        role: 'assistant',
        model: r.model,
        content: [{ type: 'text', text: r.text }],
        stop_reason: null,
        stop_sequence: null,
        // REAL usage, as reported by OpenRouter on the very call that answered
        // (the previous version returned literal zeros — a fabricated
        // measurement that silently zeroed the memory agent's cost ledger).
        usage: { input_tokens: r.inputTokens, output_tokens: r.outputTokens },
        // The REAL cost of the call (usage.cost), next to the Message so the
        // caller books a measurement, not an estimate.
        costUsd: r.costUsd,
      }
    },
  },
}

// VISION IN VOICE (Adrian: "why can't he see?"). In the Realtime session
// (audio only) Kelion had no eyes. The client captures a camera frame and
// sends it here; we give it to a vision model (GPT/Gemini via OpenRouter) and
// return a short, natural description to speak aloud. Empty on failure —
// never throws.
export async function describeScene(
  imageDataUrl: string,
  question?: string,
  onCost?: (usd: number) => void,
): Promise<string> {
  try {
    const r = await openrouterChat(
      config.openrouter.chatDefault,
      [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text:
                question?.trim() ||
                'Privește prin camera utilizatorului și spune scurt și natural ce vezi ACUM, ca și cum te-ai uita chiar acum. Fără liste, fără markdown.',
            },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      [],
      { maxTokens: 400 },
    )
    if (onCost && r.costUsd > 0) onCost(r.costUsd)
    return r.text.trim()
  } catch {
    return ''
  }
}

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
    const r = await runBrainLadder(expertModelLadder(), (m) =>
      openrouterChat(m, [{ role: 'user', content: prompt }], [], { maxTokens, reasoning: 'medium' }),
    )
    if (onCost && r.costUsd > 0) onCost(r.costUsd)
    return r.text.trim()
  } catch {
    return ''
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
  const ladder = opts.models?.length ? opts.models : expertModelLadder()
  try {
    for (let round = 0; round < maxRounds; round++) {
      const r = await runBrainLadder(ladder, (m) =>
        openrouterChat(m, messages, tools, { maxTokens: opts.maxTokens ?? 2000, reasoning: 'medium' }),
      )
      if (opts.onCost && r.costUsd > 0) opts.onCost(r.costUsd)
      if (!r.toolCalls.length) return r.text.trim()
      messages.push({ role: 'assistant', content: r.text || '', tool_calls: r.toolCalls })
      for (const c of r.toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(c.function.arguments || '{}') as Record<string, unknown>
        } catch {
          /* broken arguments → the tool gets an empty object */
        }
        const out = await execTool(c.function.name, args).catch((e: Error) => JSON.stringify({ error: e.message }))
        messages.push({ role: 'tool', tool_call_id: c.id, content: out.slice(0, 60_000) })
      }
    }
    // round ceiling reached — we ask for the final answer without more tools
    const last = await runBrainLadder(ladder, (m) =>
      openrouterChat(m, messages, [], { maxTokens: opts.maxTokens ?? 2000 }),
    )
    if (opts.onCost && last.costUsd > 0) opts.onCost(last.costUsd)
    return last.text.trim()
  } catch {
    return ''
  }
}

// Checks the default models (chat + work) with a real ping through OpenRouter.
export async function verifyModels(): Promise<Record<string, string>> {
  const ping = async (model: string): Promise<string> => {
    try {
      // 64, not 16: models with internal reasoning (e.g. claude-fable-5) spend
      // budget tokens ON THINKING before the answer — live proof, Jul 25: with
      // 16 tokens, 11 went to "reasoning_tokens" and the content came out empty
      // (finish_reason:"length"), so the ping falsely reported "fail" on a live
      // model.
      const r = await openrouterChat(model, [{ role: 'user', content: 'Reply with the single word: ok' }], [], {
        maxTokens: 64,
      })
      return r.text ? `ok (served by ${r.model})` : 'fail'
    } catch {
      return 'fail'
    }
  }
  return {
    [config.openrouter.chatDefault]: await ping(config.openrouter.chatDefault),
    [config.openrouter.workDefault]: await ping(config.openrouter.workDefault),
  }
}

// Checks the OpenRouter key (a single key for the whole brain).
export async function verifyKeys(): Promise<{
  primary: string
  reserve: string
  diag: Record<string, unknown>
}> {
  if (!config.openrouter.key) {
    return { primary: 'not_configured', reserve: 'not_configured', diag: { openrouterKeyLen: 0 } }
  }
  let primary = 'fail'
  try {
    const r = await openrouterChat(config.openrouter.chatDefault, [{ role: 'user', content: 'ping' }], [], {
      maxTokens: 1,
    })
    primary = r.model ? 'ok' : 'fail'
  } catch {
    primary = 'fail'
  }
  return { primary, reserve: primary, diag: { openrouterKeyLen: config.openrouter.key.length } }
}
