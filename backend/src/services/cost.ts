// Real-cost metering. Computes the actual provider cost (USD) of each AI call so
// the admin can see live spend and Kelion can report its real cost. Token-based
// where we have exact usage (Kimi/GLM, Gemini); per-unit estimates for Chirp
// TTS/STT. Prices are USD per token/char/call — update if provider pricing
// changes. These are ADMIN-ONLY figures (the true money underneath), separate
// from any user-facing credit.

interface ModelPrice {
  input: number // $ per input token
  output: number // $ per output token
}

const PRICES: Record<string, ModelPrice> = {
  'kimi-for-coding': { input: 0, output: 0 },
  'kimi-k2-thinking': { input: 0, output: 0 },
  'kimi-k2-thinking-turbo': { input: 0, output: 0 },
  'glm-4.6': { input: 0, output: 0 },
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 },
}

export function brainCost(model: string, inputTokens: number, outputTokens: number): number {
  const base = model.replace(/-\d{6,}$/, '')
  const p = PRICES[base] ?? PRICES[model] ?? PRICES['kimi-for-coding']
  return inputTokens * p.input + outputTokens * p.output
}

export function geminiCost(inputTokens: number, outputTokens: number): number {
  const p = PRICES['gemini-2.5-flash']
  return inputTokens * p.input + outputTokens * p.output
}

export const TTS_USD_PER_CHAR = 30 / 1e6
export function ttsCost(chars: number): number {
  return chars * TTS_USD_PER_CHAR
}

export const ASR_USD_PER_CALL = 0.0015

export const SERPER_USD_PER_CALL = 0.001

export const IMAGE_USD_PER_CALL = 0.04
