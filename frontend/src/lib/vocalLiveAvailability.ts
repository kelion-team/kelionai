import type { VocalLiveCapability, VocalLiveFailureCode } from '../../../backend/src/shared/api-types'

export type { VocalLiveCapability, VocalLiveFailureCode } from '../../../backend/src/shared/api-types'

export const VOCAL_LIVE_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000] as const

const FAILURE_CODES = new Set<VocalLiveFailureCode>([
  'unauthorized',
  'invalid_key',
  'quota',
  'model_access',
  'not_configured',
  'configuration',
  'idle_timeout',
  'session_limit',
  'billing_conflict',
  'billing_unavailable',
  'rate_limit',
  'provider_5xx',
  'transport',
])

export function esteCodEroareVocalLive(value: unknown): value is VocalLiveFailureCode {
  return typeof value === 'string' && FAILURE_CODES.has(value as VocalLiveFailureCode)
}

export function parseazaCapabilitateVocalLive(value: unknown): VocalLiveCapability | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const raw = value as Record<string, unknown>
  if (
    typeof raw.disponibil !== 'boolean'
    || typeof raw.model !== 'string'
    || typeof raw.voce !== 'string'
    || typeof raw.retryable !== 'boolean'
  ) return null

  if (raw.disponibil) {
    return {
      disponibil: true,
      model: raw.model,
      voce: raw.voce,
      retryable: false,
    }
  }
  if (!esteCodEroareVocalLive(raw.code)) return null
  return {
    disponibil: false,
    model: raw.model,
    voce: raw.voce,
    code: raw.code,
    // Decizia de reluare este și locală: un răspuns compromis nu poate cere
    // browserului să repete o eroare terminală la nesfârșit.
    retryable: esteEroareVocalLiveTranzitorie(raw.code),
  }
}

export function esteEroareVocalLiveTranzitorie(code: VocalLiveFailureCode): boolean {
  return code === 'rate_limit' || code === 'provider_5xx' || code === 'transport'
}

export type VocalLiveFailureMessageKey =
  | 'voiceNeedLogin'
  | 'voiceInvalidKey'
  | 'voiceProviderQuota'
  | 'voiceModelAccess'
  | 'voiceNotConfigured'
  | 'voiceIdleTimeout'
  | 'voiceSessionLimit'
  | 'voiceBillingConflict'
  | 'voiceBillingUnavailable'
  | 'voiceDownTemp'

export function cheieMesajEroareVocalLive(code: VocalLiveFailureCode): VocalLiveFailureMessageKey {
  if (code === 'unauthorized') return 'voiceNeedLogin'
  if (code === 'invalid_key') return 'voiceInvalidKey'
  if (code === 'quota') return 'voiceProviderQuota'
  if (code === 'model_access') return 'voiceModelAccess'
  if (code === 'not_configured' || code === 'configuration') return 'voiceNotConfigured'
  if (code === 'idle_timeout') return 'voiceIdleTimeout'
  if (code === 'session_limit') return 'voiceSessionLimit'
  if (code === 'billing_conflict') return 'voiceBillingConflict'
  if (code === 'billing_unavailable') return 'voiceBillingUnavailable'
  return 'voiceDownTemp'
}

export type VocalLiveCloseFailure = VocalLiveFailureCode | 'no_credit'

/** Mapează numai codurile/reasons fixe emise de backend. Textul liber primit
 * într-un close frame nu devine niciodată mesaj sau decizie în interfață.
 *
 * `null` = închidere CURATĂ (cod 1000 fără motiv de eroare cunoscut): nu e
 * eroare, nu se raportează, nu se reia. Înainte orice închidere, inclusiv cea
 * normală, devenea 'transport' → console.error → reluare inutilă. */
export function clasificaInchidereVocalLive(
  closeCode: number,
  reason: string,
): VocalLiveCloseFailure | null {
  if (closeCode === 1008) {
    if (reason === 'fara_credit') return 'no_credit'
    if (reason === 'session_limit') return 'session_limit'
    if (reason === 'billing_unavailable') return 'billing_unavailable'
    if (reason === 'billing_tick_reused') return 'billing_conflict'
    return 'unauthorized'
  }
  if (closeCode === 1011) {
    return reason === 'vocal_live_indisponibil' ? 'not_configured' : 'provider_5xx'
  }
  if (closeCode === 1006) return 'transport'
  if (closeCode === 1000) return reason === 'idle_timeout' ? 'idle_timeout' : null
  return 'transport'
}

export interface VocalLiveRetryDecision {
  delayMs: number
  nextAttempt: number
}

/** Un click explicit primește cel mult cinci reluări automate (30 s total).
 * După plafon, numai omul poate porni un ciclu nou. */
export function urmatoareaReluareVocalLive(attemptsUsed: number): VocalLiveRetryDecision | null {
  const attempt = Number.isInteger(attemptsUsed) && attemptsUsed >= 0 ? attemptsUsed : 0
  const delayMs = VOCAL_LIVE_RETRY_DELAYS_MS[attempt]
  return delayMs === undefined ? null : { delayMs, nextAttempt: attempt + 1 }
}
