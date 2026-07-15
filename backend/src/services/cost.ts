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

// QUOTA TRACKER — înregistrează fiecare apel la creier (succes/eșec) și calculează
// procentul de disponibilitate în ultimele 10 min. Mutat aici ca să fie accesibil
// din services (cost/quota) fără a importa din routes.
class QuotaTracker {
  private events: { model: string; success: boolean; ts: number }[] = []
  private readonly maxAge = 10 * 60 * 1000
  private readonly maxSize = 2000
  record(model: string, success: boolean): void {
    const now = Date.now()
    this.events.push({ model, success, ts: now })
    const cutoff = now - this.maxAge
    this.events = this.events.filter((e) => e.ts > cutoff)
    if (this.events.length > this.maxSize) this.events = this.events.slice(-this.maxSize)
  }
  percent(model: string): number {
    const now = Date.now()
    const cutoff = now - this.maxAge
    const recent = this.events.filter((e) => e.model === model && e.ts > cutoff)
    if (recent.length === 0) return 100 // fără istoric → 100%
    const successes = recent.filter((e) => e.success).length
    return Math.round((successes / recent.length) * 100)
  }
}

export const quotaTracker = new QuotaTracker()

export function getQuotaPercent(): { kimi: number; glm: number } {
  return {
    kimi: quotaTracker.percent('kimi'),
    glm: quotaTracker.percent('glm'),
  }
}
