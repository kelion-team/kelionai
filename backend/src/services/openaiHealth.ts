export type OpenAIHealthClass =
  | 'ok'
  | 'invalid_key'
  | 'invalid_credentials'
  | 'insufficient_quota'
  | 'rate_limited'
  | 'model_access'
  | 'bad_request'
  | 'provider_5xx'
  | 'transport'
  | 'metering_unavailable'
  | 'no_key'

export type OpenAIAuthMode = 'api_key' | 'unknown'

/** Documented provider codes safe to expose to an authenticated administrator. */
export type OpenAIProviderErrorCode =
  | 'rate_limit_exceeded'
  | 'credit_balance_exhausted'
  | 'project_spend_limit_exceeded'
  | 'organization_spend_limit_exceeded'
  | 'organization_usage_limit_exceeded'
  | 'insufficient_quota'

export interface OpenAIHealthResult {
  /** `ok` means the probe obtained an HTTP response, not that OpenAI serves. */
  ok: boolean
  serving: boolean
  /** Safe provider status only. `null` means no HTTP response existed. */
  status: number | null
  /** Closed, safe classification. Provider bodies/messages never cross this boundary. */
  class: OpenAIHealthClass
  /** Allowlisted `error.code` for a 429 response; never provider text. */
  providerCode?: OpenAIProviderErrorCode
}

const OPENAI_HEALTH_ACTIONS: Record<Exclude<OpenAIHealthClass, 'ok'>, string> = {
  invalid_key: 'Cheia OpenAI este respinsă. Verifică sau înlocuiește OPENAI_API_KEY.',
  invalid_credentials: 'Autentificarea OpenAI este respinsă. Verifică configurația furnizorului activ.',
  insufficient_quota: 'Creditul sau limita de cheltuieli OpenAI este epuizată. Verifică Billing și Limits.',
  rate_limited: 'OpenAI limitează temporar cererile. Redu ritmul și reîncearcă.',
  model_access: 'Proiectul nu are acces la modelul configurat. Verifică modelul și permisiunile proiectului.',
  bad_request: 'Cererea de verificare nu este acceptată. Verifică modelul și configurația OpenAI.',
  provider_5xx: 'OpenAI are o eroare temporară. Reîncearcă după câteva minute.',
  transport: 'Serverul nu poate ajunge la OpenAI. Verifică rețeaua, DNS și conexiunea TLS.',
  metering_unavailable: 'Utilizarea OpenAI nu poate fi înregistrată durabil. Verifică baza de date înainte de a relua traficul.',
  no_key: 'OPENAI_API_KEY nu este configurată pe server.',
}

/** Application-owned remediation text. It never includes provider content. */
export function openaiHealthAction(code: OpenAIHealthClass): string | undefined {
  return code === 'ok' ? undefined : OPENAI_HEALTH_ACTIONS[code]
}

interface OpenAIErrorSignal {
  code: string
  type: string
  message: string
}

function openaiErrorSignal(error: unknown): OpenAIErrorSignal {
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return { code: '', type: '', message: '' }
  }
  const record = error as Record<string, unknown>
  // Provider strings exist only long enough to classify the response. They are
  // bounded here and never returned, logged or persisted by this module.
  return {
    code: typeof record.code === 'string' ? record.code.slice(0, 160).toLowerCase() : '',
    type: typeof record.type === 'string' ? record.type.slice(0, 160).toLowerCase() : '',
    message: typeof record.message === 'string' ? record.message.slice(0, 800).toLowerCase() : '',
  }
}

const OPENAI_PROVIDER_ERROR_CODES = new Set<OpenAIProviderErrorCode>([
  'rate_limit_exceeded',
  'credit_balance_exhausted',
  'project_spend_limit_exceeded',
  'organization_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
  'insufficient_quota',
])

/** Returns only a closed, documented code; unknown provider strings stay private. */
export function allowlistedOpenAIProviderCode(
  status: number,
  providerError?: unknown,
): OpenAIProviderErrorCode | undefined {
  if (status !== 429) return undefined
  const code = openaiErrorSignal(providerError).code
  return OPENAI_PROVIDER_ERROR_CODES.has(code as OpenAIProviderErrorCode)
    ? code as OpenAIProviderErrorCode
    : undefined
}

/** Pure provider-error classifier. Its output is always a closed safe code. */
export function classifyOpenAIError(
  status: number,
  providerError?: unknown,
  authMode: OpenAIAuthMode = 'unknown',
): OpenAIHealthClass {
  if (status >= 200 && status < 300) return 'ok'
  if (status >= 500) return 'provider_5xx'
  if (status === 401) return authMode === 'api_key' ? 'invalid_key' : 'invalid_credentials'

  const signal = openaiErrorSignal(providerError)
  const providerSignal = `${signal.code} ${signal.type} ${signal.message}`
  if (status === 429) {
    return /insufficient[_ -]?quota|billing|credit|balance|spend(?:ing)?[_ -]?limit|current quota|(?:organization[_ -]?)?usage[_ -]?limit[_ -]?exceeded/.test(providerSignal)
      ? 'insufficient_quota'
      : 'rate_limited'
  }
  if (status === 402) return 'insufficient_quota'
  if (status === 403) return 'model_access'
  if (status === 404 && /model|deployment/.test(providerSignal)) return 'model_access'
  return 'bad_request'
}

export async function classifyOpenAIHealthResponse(
  response: Response,
  authMode: OpenAIAuthMode = 'unknown',
): Promise<OpenAIHealthResult> {
  const status = response.status
  if (response.ok) return { ok: true, serving: true, status, class: 'ok' }

  let providerError: unknown
  try {
    const payload = await response.json() as Record<string, unknown>
    providerError = payload?.error
  } catch {
    providerError = undefined
  }
  const providerCode = allowlistedOpenAIProviderCode(status, providerError)
  return {
    ok: true,
    serving: false,
    status,
    class: classifyOpenAIError(status, providerError, authMode),
    ...(providerCode ? { providerCode } : {}),
  }
}

interface OpenAIHealthProbeOptions {
  authMode?: OpenAIAuthMode
  /** Verifies and durably meters a successful, billable provider response. */
  onServing?: (response: Response) => Promise<OpenAIHealthClass | void>
}

/** Runs the probe boundary without leaking thrown transport errors. */
export async function probeOpenAIHealth(
  available: boolean,
  request: () => Promise<Response>,
  options: OpenAIHealthProbeOptions = {},
): Promise<OpenAIHealthResult> {
  if (!available) return { ok: false, serving: false, status: null, class: 'no_key' }
  let response: Response
  try {
    response = await request()
  } catch {
    return { ok: false, serving: false, status: null, class: 'transport' }
  }
  if (response.ok && options.onServing) {
    try {
      const failure = await options.onServing(response)
      if (failure && failure !== 'ok') {
        return { ok: true, serving: false, status: response.status, class: failure }
      }
    } catch {
      return { ok: true, serving: false, status: response.status, class: 'metering_unavailable' }
    }
  }
  return classifyOpenAIHealthResponse(response, options.authMode)
}

/** One process-wide cache prevents the 30 s and 60 s admin pollers from
 * issuing duplicate billable probes. Concurrent callers share one request. */
export function cacheOpenAIHealthProbe(
  probe: () => Promise<OpenAIHealthResult>,
  ttlMs = 60_000,
  now: () => number = Date.now,
): () => Promise<OpenAIHealthResult> {
  let cached: { at: number; result: OpenAIHealthResult } | null = null
  let inFlight: Promise<OpenAIHealthResult> | null = null
  return async () => {
    const timestamp = now()
    if (cached && timestamp - cached.at < ttlMs) return cached.result
    if (inFlight) return inFlight
    let current: Promise<OpenAIHealthResult>
    current = probe()
      .then((result) => {
        cached = { at: now(), result }
        return result
      })
      .finally(() => {
        if (inFlight === current) inFlight = null
      })
    inFlight = current
    return current
  }
}
