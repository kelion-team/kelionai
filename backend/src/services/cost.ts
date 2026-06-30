// Real-cost metering. Computes the actual provider cost (USD) of each AI call so
// the admin can see live spend and Kelion can report its real cost. Token-based
// where we have exact usage (Claude, Gemini); per-unit estimates for Chirp
// TTS/STT. Prices are USD per token/char/call — update if provider pricing
// changes. These are ADMIN-ONLY figures (the true money underneath), separate
// from any user-facing credit.

interface ModelPrice {
  input: number // $ per input token
  output: number // $ per output token
}

const PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-8': { input: 5 / 1e6, output: 25 / 1e6 },
  'claude-haiku-4-5': { input: 1 / 1e6, output: 5 / 1e6 },
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 },
}

export function claudeCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model] ?? PRICES['claude-opus-4-8']
  return inputTokens * p.input + outputTokens * p.output
}

export function geminiCost(inputTokens: number, outputTokens: number): number {
  const p = PRICES['gemini-2.5-flash']
  return inputTokens * p.input + outputTokens * p.output
}

// Chirp 3 HD TTS — ~$30 per 1M characters (premium HD voices).
export const TTS_USD_PER_CHAR = 30 / 1e6
export function ttsCost(chars: number): number {
  return chars * TTS_USD_PER_CHAR
}

// Chirp STT — estimate per recognition call (~a few seconds of audio).
export const ASR_USD_PER_CALL = 0.0015
