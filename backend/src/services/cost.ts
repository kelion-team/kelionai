// Real-cost metering. The REAL cost of brain calls now comes straight from
// OpenRouter (usage.cost, in chat.ts) — it is no longer estimated from
// tokens. Only the residual utilities remain here: Gemini (used in the
// proofreading), Chirp TTS/STT, Serper, images. The figures are ADMIN-ONLY
// (the real money underneath), separate from the credit shown to the user.

interface ModelPrice {
  input: number // $ per input token
  output: number // $ per output token
}

const PRICES: Record<string, ModelPrice> = {
  'gemini-2.5-flash': { input: 0.3 / 1e6, output: 2.5 / 1e6 },
}

// Residual per-token estimation (used only where we don't have the real
// cost). Without a known price → 0 (the brain's real cost is taken from
// OpenRouter usage.cost).
export function brainCost(model: string, inputTokens: number, outputTokens: number): number {
  const base = model.replace(/-\d{6,}$/, '')
  const p = PRICES[base] ?? PRICES[model] ?? { input: 0, output: 0 }
  return inputTokens * p.input + outputTokens * p.output
}

export const TTS_USD_PER_CHAR = 30 / 1e6
export function ttsCost(chars: number): number {
  return chars * TTS_USD_PER_CHAR
}

export const ASR_USD_PER_CALL = 0.0015

export const SERPER_USD_PER_CALL = 0.001

export const IMAGE_USD_PER_CALL = 0.04

// VOICE BILLING PER MINUTE (Adrian, 25 Jul: "when users use voice/extra
// payments, take the costs out of their credits"). The OpenAI Realtime live
// audio is the most expensive component (STT+model+TTS per minute). The
// client "pulses" while the voice is active; the server debits per REALLY
// connected second. Editable from env.
export const VOICE_USD_PER_MINUTE = Number(process.env.VOICE_USD_PER_MINUTE ?? 0.35)

