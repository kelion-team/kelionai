import { describe, expect, it } from 'vitest'
import {
  VOCAL_LIVE_RETRY_DELAYS_MS,
  cheieMesajEroareVocalLive,
  clasificaInchidereVocalLive,
  esteEroareVocalLiveTranzitorie,
  parseazaCapabilitateVocalLive,
  urmatoareaReluareVocalLive,
  type VocalLiveFailureCode,
} from './lib/vocalLiveAvailability'

describe('OpenAI Live — verdict terminal și retry mărginit', () => {
  it('nu permite reluare automată pentru cheia invalidă, cotă sau accesul la model', () => {
    for (const code of ['unauthorized', 'invalid_key', 'quota', 'model_access', 'not_configured', 'configuration', 'idle_timeout', 'session_limit', 'billing_conflict', 'billing_unavailable'] as const) {
      expect(esteEroareVocalLiveTranzitorie(code), code).toBe(false)
    }
    for (const code of ['rate_limit', 'provider_5xx', 'transport'] as const) {
      expect(esteEroareVocalLiveTranzitorie(code), code).toBe(true)
    }
  })

  it('oprește reluările tranzitorii după seria finită 1/2/4/8/15 secunde', () => {
    expect(VOCAL_LIVE_RETRY_DELAYS_MS).toEqual([1_000, 2_000, 4_000, 8_000, 15_000])
    for (let attempt = 0; attempt < VOCAL_LIVE_RETRY_DELAYS_MS.length; attempt++) {
      expect(urmatoareaReluareVocalLive(attempt)).toEqual({
        delayMs: VOCAL_LIVE_RETRY_DELAYS_MS[attempt],
        nextAttempt: attempt + 1,
      })
    }
    expect(urmatoareaReluareVocalLive(VOCAL_LIVE_RETRY_DELAYS_MS.length)).toBeNull()
  })

  it('alege un mesaj distinct pentru fiecare cauză terminală cerută', () => {
    const expected: Record<VocalLiveFailureCode, string> = {
      unauthorized: 'voiceNeedLogin',
      invalid_key: 'voiceInvalidKey',
      quota: 'voiceProviderQuota',
      model_access: 'voiceModelAccess',
      not_configured: 'voiceNotConfigured',
      configuration: 'voiceNotConfigured',
      idle_timeout: 'voiceIdleTimeout',
      session_limit: 'voiceSessionLimit',
      billing_conflict: 'voiceBillingConflict',
      billing_unavailable: 'voiceBillingUnavailable',
      rate_limit: 'voiceDownTemp',
      provider_5xx: 'voiceDownTemp',
      transport: 'voiceDownTemp',
    }
    for (const [code, key] of Object.entries(expected)) {
      expect(cheieMesajEroareVocalLive(code as VocalLiveFailureCode)).toBe(key)
    }
  })

  it('validează contractul serverului și ignoră retryable=true pentru o cauză terminală', () => {
    expect(parseazaCapabilitateVocalLive({
      disponibil: false,
      model: 'gpt-realtime',
      voce: 'cedar',
      code: 'invalid_key',
      retryable: true,
    })).toEqual({
      disponibil: false,
      model: 'gpt-realtime',
      voce: 'cedar',
      code: 'invalid_key',
      retryable: false,
    })
    expect(parseazaCapabilitateVocalLive({
      disponibil: false,
      model: 'gpt-realtime',
      voce: 'cedar',
      code: 'provider_body_leak',
      retryable: true,
    })).toBeNull()
  })

  it('nu confundă policy close-urile sigure cu o sesiune expirată', () => {
    expect(clasificaInchidereVocalLive(1008, 'fara_credit')).toBe('no_credit')
    expect(clasificaInchidereVocalLive(1008, 'session_limit')).toBe('session_limit')
    expect(clasificaInchidereVocalLive(1008, 'billing_unavailable')).toBe('billing_unavailable')
    expect(clasificaInchidereVocalLive(1008, 'billing_tick_reused')).toBe('billing_conflict')
    expect(clasificaInchidereVocalLive(1008, 'session_invalid')).toBe('unauthorized')
    expect(clasificaInchidereVocalLive(1000, 'idle_timeout')).toBe('idle_timeout')
  })
})
