// ── COST ACCOUNTING: WHAT IS MEASURED vs WHAT IS ESTIMATED ─────────────────
//
// The owner's standing order: "the cost table is not real — show REAL, stop
// fabricating". So every figure in this file is one of three honest things:
//
//   1. MEASURED — read from the provider's own response. The real cost of a
//      brain call comes from OpenRouter's `usage.cost` (see chat.ts / the
//      `costUsd` field of every result in openrouter.ts). Nothing here
//      replaces it; this file only handles the residual utilities.
//   2. LIVE PRICE — a per-token price read from the live OpenRouter /models
//      catalog (cached 10 min), used only where the provider billed us but
//      did not itemize the call (the background memory agent, which runs on
//      the chat-default model through a non-streaming adapter).
//   3. ESTIMATE — a fixed rate, LABELED as such here AND downstream
//      (db.ts getCostSummary splits every kind into `masurat`/`estimat`, so
//      the Money tab can never present an estimate as a measurement).
//
// A number whose source cannot be named does not belong in this file.

import { getLiveModelPricePerM } from './openrouter.js'

export type CostSource = 'live_openrouter' | 'static_estimate' | 'unknown'

export interface BrainCostEstimate {
  usd: number
  /** Where the price came from — the caller decides the ledger label from
   *  this, so an estimate is never booked as a measurement. */
  source: CostSource
}

// ── STATIC FALLBACK TABLE — LAST-RESORT ESTIMATE, NOT A PRICE LIST ─────────
// Used ONLY when the live OpenRouter catalog is unreadable (no key, network
// down, provider renamed the model). The figures were the provider's
// published list prices at the time they were noted; they can drift, which is
// exactly why they are a labeled fallback, never the primary source.
// Adding a model here is NOT the way to price it — the live catalog is.
const STATIC_FALLBACK_PRICES: Record<string, { input: number; output: number }> = {
  // Google published list price for Gemini 2.5 Flash ($0.30/1M in, $2.50/1M
  // out), noted 2026-07 — estimate, kept only for the no-catalog case.
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 },
}

/** Pure per-token math from a price pair. Exported for tests. */
export function costFromPrice(
  promptPerM: number,
  completionPerM: number,
  inputTokens: number,
  outputTokens: number,
): number {
  return (inputTokens * promptPerM + outputTokens * completionPerM) / 1e6
}

/**
 * The cost of a brain call whose provider did NOT itemize `usage.cost`
 * (today: the background memory agent). The price is read LIVE from the
 * OpenRouter catalog first; only if the catalog is unreadable do we fall back
 * to the static estimate table, and the result says so. `unknown` = we have
 * no price at all — better an honest 0 labeled "unknown" than a made-up one.
 */
export async function brainCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<BrainCostEstimate> {
  // try/catch (not .catch): a synchronous throw from the lookup must fall back
  // just the same — the ledger never breaks because a price source hiccuped.
  let live: { promptPerM: number; completionPerM: number } | null = null
  try {
    live = await getLiveModelPricePerM(model)
  } catch {
    live = null
  }
  if (live) {
    return { usd: costFromPrice(live.promptPerM, live.completionPerM, inputTokens, outputTokens), source: 'live_openrouter' }
  }
  const base = model.replace(/-\d{6,}$/, '')
  const bare = base.split('/').pop() ?? base
  const p = STATIC_FALLBACK_PRICES[base] ?? STATIC_FALLBACK_PRICES[bare]
  if (p) return { usd: inputTokens * p.input + outputTokens * p.output, source: 'static_estimate' }
  return { usd: 0, source: 'unknown' }
}

// ── RESIDUAL UTILITY RATES (estimates; the providers don't itemize these) ──
// Every rate below is overridable from env, so the owner corrects the figure
// with a variable, never with a code edit. The defaults keep their source in
// the comment; where no public source exists the default says "estimate".

// Google Cloud TTS, Chirp 3 HD voices: published list price $30 per 1M
// characters (cloud.google.com/text-to-speech/pricing). The TTS API does not
// return the cost of a call, so this stays an ESTIMATE on the ledger.
export const TTS_USD_PER_CHAR = Number(process.env.TTS_USD_PER_CHAR ?? 30 / 1e6)
export function ttsCost(chars: number): number {
  return chars * TTS_USD_PER_CHAR
}

// Speech-to-text: NO public per-call price source wired in — hand-set
// ESTIMATE, override with ASR_USD_PER_CALL when the real bill says otherwise.
export const ASR_USD_PER_CALL = Number(process.env.ASR_USD_PER_CALL ?? 0.0015)

// Serper: published plan price ≈ $1 per 1000 queries (serper.dev pricing).
// The /account endpoint gives the REAL remaining balance (serperBalance.ts)
// but not a per-call cost, so the ledger entry stays an ESTIMATE.
export const SERPER_USD_PER_CALL = Number(process.env.SERPER_USD_PER_CALL ?? 0.001)

// Image generation FALLBACK rate, used only when OpenRouter did not return
// the call's real `usage.cost` (openrouterImage reports it — chat.ts books
// the REAL figure whenever it exists and reaches for this only as a labeled
// estimate). Hand-set ESTIMATE; override with IMAGE_USD_PER_CALL.
export const IMAGE_USD_PER_CALL = Number(process.env.IMAGE_USD_PER_CALL ?? 0.04)

// VOICE BILLING PER MINUTE (Adrian, 25 Jul: "when users use voice/extra
// payments, take the costs out of their credits"). This is OUR price to the
// user — a product decision, not a provider measurement; the OpenAI Realtime
// spend underneath is read separately from the provider (openaiCosts.ts).
// The ledger marks `voice_minutes` as an estimate (db.ts COSTURI_MASURATE).
// Editable from env.
export const VOICE_USD_PER_MINUTE = Number(process.env.VOICE_USD_PER_MINUTE ?? 0.35)
