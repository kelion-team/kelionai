import { config } from '../config.js'

export type RealtimeHealth = {
  ok: boolean
  reason: 'configured' | 'missing_configuration' | 'provider_unreachable' | 'model_unavailable'
}

/** Candidates are intentionally inert. Provider reachability becomes a hard
 * readiness gate only for the active generation, where deployment rollback
 * can safely restore the last known-good version. */
export function realtimeReadinessSatisfied(sideEffectsActive: boolean, health: RealtimeHealth): boolean {
  return !sideEffectsActive || health.ok
}

let cache: { at: number; value: RealtimeHealth } | null = null
let inFlight: Promise<RealtimeHealth> | null = null

async function probe(): Promise<RealtimeHealth> {
  if (!config.openai.key || !config.openai.realtime || !config.openai.realtimeTranscription) {
    return { ok: false, reason: 'missing_configuration' }
  }
  try {
    const timeout = AbortSignal.timeout(5_000)
    const ids = [config.openai.realtime, config.openai.realtimeTranscription]
    const results = await Promise.all(ids.map(async (id) => fetch(
      `${config.openai.apiBaseUrl}/models/${encodeURIComponent(id)}`,
      { headers: { Authorization: `Bearer ${config.openai.key}` }, signal: timeout },
    )))
    if (results.every((response) => response.ok)) return { ok: true, reason: 'configured' }
    if (results.some((response) => response.status === 404 || response.status === 403)) {
      return { ok: false, reason: 'model_unavailable' }
    }
    return { ok: false, reason: 'provider_unreachable' }
  } catch {
    return { ok: false, reason: 'provider_unreachable' }
  }
}

/** Cached, low-cost account-level model availability proof. This does not open
 * a billable realtime conversation and never returns provider response text. */
export async function realtimeHealth(): Promise<RealtimeHealth> {
  if (cache && Date.now() - cache.at < 30_000) return cache.value
  if (!inFlight) {
    inFlight = probe().then((value) => {
      cache = { at: Date.now(), value }
      return value
    }).finally(() => { inFlight = null })
  }
  return inFlight
}
