// ── §6 ONE BRAIN — THE VOICE = THE EARS AND MOUTH OF THE SAME BRAIN ──────
// Adrian: "the voice must reach ALL routes; nothing separate, no dispatcher".
// The clean path (spec §6): a voice turn run through the SAME orchestrator as
// typing, with ALL the tools from the registry — NOT through the separate
// voice brain, capped at 31. The flow: transcribed text (STT) → the full
// brain → text to speak (TTS).
//
// STATE: NOT WIRED yet to the LIVE Realtime session (built in parallel,
// verified by test, then switched over — so the live voice does NOT drop,
// the "owner tests live" lesson). The tools and the executor are INJECTED
// (dependency injection), so the module is decoupled from HTTP and from the
// hardcoded lists: the same tools typing uses can be given here too, from a
// single source.

import { runOrchestrator } from './orchestrator.js'
import type { AnthropicTool, OrMessage } from './openrouter.js'

export interface VoiceBrainTurnDeps {
  /** The brain's model (the same as for typing). */
  model: string
  /** The tools in Anthropic format — coming from the single registry (brainCapabilities). */
  tools: AnthropicTool[]
  /** Executes a tool: (name, argsJson) → text result. Decoupled from reply.raw. */
  execTool: (name: string, argsJson: string) => Promise<string>
  /** The brain's persona/instructions (the same as for typing, anchored in reality). */
  systemPrompt: string
  /** The conversation history (memory + recent replies). */
  history?: OrMessage[]
  /** Text broadcast as it flows (for incremental TTS synthesis). */
  onText?: (delta: string) => void
  /** The REAL cost of the turn (voice billing) — the orchestrator
   *  accumulates it across all rounds; without the callback, the escalation
   *  cost would be lost. */
  onCost?: (usd: number) => void
}

// ONE COMPLETE VOICE TURN through the single brain. Returns the text to speak.
export async function voiceBrainTurn(transcript: string, deps: VoiceBrainTurnDeps): Promise<string> {
  const messages: OrMessage[] = [
    { role: 'system', content: deps.systemPrompt },
    ...(deps.history ?? []),
    { role: 'user', content: transcript },
  ]
  const res = await runOrchestrator(deps.model, messages, deps.tools, deps.execTool, {
    maxRounds: 6,
    maxTokens: 1500,
    // THE SAME DEED RULE as typing: never declare an action without having done it.
    deedGate: true,
    onText: deps.onText,
  })
  // The real escalation cost (all rounds) → voice billing.
  if (res.costUsd > 0) deps.onCost?.(res.costUsd)
  return res.text
}
