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
  // CREIERUL e pe Kimi/GLM (planuri cu abonament FLAT, nu per-token) → costul
  // marginal per apel e ~0; le ținem la 0 ca să nu inventăm cifre false în
  // contabilitatea adminului. Anthropic scos complet (Adrian, 12 iul).
  'kimi-for-coding': { input: 0, output: 0 },
  'kimi-k2-thinking': { input: 0, output: 0 },
  'kimi-k2-thinking-turbo': { input: 0, output: 0 },
  'glm-4.6': { input: 0, output: 0 },
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 },
}

export function claudeCost(model: string, inputTokens: number, outputTokens: number): number {
  // Accept dated model ids (e.g. kimi-for-coding-20260101) by stripping the suffix.
  const base = model.replace(/-\d{6,}$/, '')
  const p = PRICES[base] ?? PRICES[model] ?? PRICES['kimi-for-coding']
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

// Serper.dev web/YouTube search — estimate per query (paid credits).
export const SERPER_USD_PER_CALL = 0.001

// Gemini image generation (gemini-2.5-flash-image) — approx per image.
export const IMAGE_USD_PER_CALL = 0.04
