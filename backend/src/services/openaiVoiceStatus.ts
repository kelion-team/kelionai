import type { VocalLiveCapability, VocalLiveFailureCode } from '../shared/api-types.js'
import {
  classifyOpenAIError,
  type OpenAIHealthClass,
  type OpenAIHealthResult,
} from './openaiHealth.js'

export function codVocalDinClasaOpenAI(code: OpenAIHealthClass): VocalLiveFailureCode | null {
  if (code === 'ok') return null
  if (code === 'invalid_key') return 'invalid_key'
  if (code === 'invalid_credentials') return 'invalid_key'
  if (code === 'insufficient_quota') return 'quota'
  if (code === 'rate_limited') return 'rate_limit'
  if (code === 'model_access') return 'model_access'
  if (code === 'bad_request') return 'configuration'
  if (code === 'provider_5xx') return 'provider_5xx'
  if (code === 'transport') return 'transport'
  if (code === 'metering_unavailable') return 'billing_unavailable'
  return 'not_configured'
}

export function eroareVocalaEsteTranzitorie(code: VocalLiveFailureCode): boolean {
  return code === 'rate_limit' || code === 'provider_5xx' || code === 'transport'
}

export function eroareOpenAIRealtimeEsteGlobala(code: VocalLiveFailureCode): boolean {
  return code === 'invalid_key' || code === 'quota' || code === 'model_access'
}

export function capabilitateVocalaDinHealth(
  configured: boolean,
  model: string,
  voce: string,
  health?: OpenAIHealthResult,
): VocalLiveCapability {
  if (!configured) {
    return { disponibil: false, model, voce, code: 'not_configured', retryable: false }
  }
  if (!health || health.serving || ![
    'invalid_key',
    'invalid_credentials',
    'insufficient_quota',
    'metering_unavailable',
    'no_key',
  ].includes(health.class)) {
    // Luna's model/access/transient verdict is not authoritative for the
    // separately configured Realtime service. Only universal terminal account
    // or durable-metering failures block here; the real WS handshake classifies
    // Realtime model access, rate-limit, 5xx and transport independently.
    return { disponibil: true, model, voce, retryable: false }
  }
  const code = health ? (codVocalDinClasaOpenAI(health.class) ?? 'transport') : 'transport'
  return {
    disponibil: false,
    model,
    voce,
    code,
    retryable: eroareVocalaEsteTranzitorie(code),
  }
}

function textSemnalRealtime(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 300).toLowerCase()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  const raw = value as Record<string, unknown>
  return [raw.code, raw.type, raw.message]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .slice(0, 600)
    .toLowerCase()
}

/** Realtime sends a structured error without an HTTP status after the WS
 * handshake. Infer only a status class, then delegate the actual provider
 * classification to the same closed classifier used by Responses health. */
export function clasificaEroareOpenAIRealtime(providerError: unknown): VocalLiveFailureCode {
  const signal = textSemnalRealtime(providerError)
  let status = 400
  if (/invalid[_ -]?api[_ -]?key|authentication|unauthorized|incorrect api key/.test(signal)) status = 401
  else if (/insufficient[_ -]?quota|billing|credit|balance|spend(?:ing)?[_ -]?limit|current quota|(?:organization[_ -]?)?usage[_ -]?limit[_ -]?exceeded/.test(signal)) status = 429
  else if (/rate[_ -]?limit|requests per minute|tokens per minute/.test(signal)) status = 429
  else if (/model[_ -]?not[_ -]?found|model.*access|permission|forbidden/.test(signal)) status = 403
  else if (/server[_ -]?error|provider[_ -]?error|overload|temporarily unavailable/.test(signal)) status = 500
  return codVocalDinClasaOpenAI(classifyOpenAIError(status, providerError, 'api_key')) ?? 'configuration'
}

export function clasificaStatusOpenAIRealtime(
  status: number,
  providerError?: unknown,
): VocalLiveFailureCode {
  return codVocalDinClasaOpenAI(classifyOpenAIError(status, providerError, 'api_key')) ?? 'configuration'
}
