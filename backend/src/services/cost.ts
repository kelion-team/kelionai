// ── COST ACCOUNTING: WHAT IS MEASURED vs WHAT IS ESTIMATED ─────────────────
//
// The owner's standing order: "the cost table is not real — show REAL, stop
// fabricating". So every figure in this file is one of two honest things:
//
//   1. MEASURED — read from the provider's own response (the `costUsd` field
//      of every brain result — see brainContract.ts). Nothing here replaces
//      it; this file only handles the residual utilities. (Gemini free-tier
//      reports cost 0, and that IS the measurement.)
//   2. ESTIMATE — a fixed rate or a published list price, LABELED as such
//      here AND downstream (db.ts getCostSummary splits every kind into
//      `masurat`/`estimat`, so the Money tab can never present an estimate as
//      a measurement). The live OpenRouter price catalog is GONE (extirpat,
//      3 aug) — there is no per-token live price source anymore.
//
// A number whose source cannot be named does not belong in this file.

export type CostSource = 'static_estimate' | 'unknown'

export interface BrainCostEstimate {
  usd: number
  /** Where the price came from — the caller decides the ledger label from
   *  this, so an estimate is never booked as a measurement. */
  source: CostSource
}

// ── STATIC PRICE TABLE — LABELED ESTIMATE, NOT A MEASUREMENT ───────────────
// The figures are the provider's published list prices at the time they were
// noted; they can drift, which is exactly why every result from here is
// labeled 'static_estimate', never presented as a measured cost.
const STATIC_FALLBACK_PRICES: Record<string, { input: number; output: number }> = {
  // Google published list price for Gemini 2.5 Flash ($0.30/1M in, $2.50/1M
  // out), noted 2026-07 — estimate, kept only for the no-catalog case.
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 }, // hardcod-permis: cheia tabelului oficial de prețuri Google — tabelul E sursa
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
 * (today: the background memory agent). The only price source left is the
 * static table above (the live OpenRouter catalog is gone — extirpat, 3 aug),
 * and the result says so. `unknown` = we have no price at all — better an
 * honest 0 labeled "unknown" than a made-up one.
 */
export async function brainCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<BrainCostEstimate> {
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

// Image generation FALLBACK rate, used only when the generator did not report
// the call's real `usage.cost` (geminiImage reports 0 — Google's image
// endpoints itemize no per-call cost). Hand-set ESTIMATE; override with
// IMAGE_USD_PER_CALL.
export const IMAGE_USD_PER_CALL = Number(process.env.IMAGE_USD_PER_CALL ?? 0.04)

// VOICE BILLING PER MINUTE (Adrian, 25 Jul: "when users use voice/extra
// payments, take the costs out of their credits"). This is OUR price to the
// user — a product decision, not a provider measurement.
// The ledger marks `voice_minutes` as an estimate (db.ts COSTURI_MASURATE).
// Editable from env.
export const VOICE_USD_PER_MINUTE = Number(process.env.VOICE_USD_PER_MINUTE ?? 0.35)
