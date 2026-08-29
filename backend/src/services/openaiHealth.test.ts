import { describe, expect, it } from 'vitest'
import {
  cacheOpenAIHealthProbe,
  classifyOpenAIHealthResponse,
  openaiHealthAction,
  probeOpenAIHealth,
  type OpenAIHealthClass,
  type OpenAIHealthResult,
  type OpenAIAuthMode,
} from './openaiHealth.js'

const PRIVATE_PROVIDER_TEXT = 'PRIVATE_PROVIDER_TEXT_MUST_NOT_ESCAPE'

function providerResponse(status: number, error?: Record<string, unknown>): Response {
  return new Response(JSON.stringify(error ? { error } : { id: 'health-check' }), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function classify(
  status: number,
  error?: Record<string, unknown>,
  authMode: OpenAIAuthMode = 'unknown',
): Promise<OpenAIHealthResult> {
  return classifyOpenAIHealthResponse(providerResponse(status, error), authMode)
}

describe('OpenAI health classification boundary', () => {
  it('accepts a 200 response as serving', async () => {
    await expect(classify(200)).resolves.toEqual({
      ok: true,
      serving: true,
      status: 200,
      class: 'ok',
    })
  })

  it.each<[string, number, Record<string, unknown>, OpenAIHealthClass]>([
    ['400', 400, { code: 'invalid_request_error', message: PRIVATE_PROVIDER_TEXT }, 'bad_request'],
    ['401 generic', 401, { code: 'invalid_api_key', message: PRIVATE_PROVIDER_TEXT }, 'invalid_credentials'],
    ['403', 403, { code: 'permission_denied', message: PRIVATE_PROVIDER_TEXT }, 'model_access'],
    ['404 model', 404, { code: 'model_not_found', message: `Model unavailable ${PRIVATE_PROVIDER_TEXT}` }, 'model_access'],
    ['429 quota', 429, { code: 'insufficient_quota', message: `Current quota exhausted ${PRIVATE_PROVIDER_TEXT}` }, 'insufficient_quota'],
    ['429 organization quota', 429, { code: 'organization_usage_limit_exceeded', message: PRIVATE_PROVIDER_TEXT }, 'insufficient_quota'],
    ['429 rate', 429, { code: 'rate_limit_exceeded', message: `Requests per minute ${PRIVATE_PROVIDER_TEXT}` }, 'rate_limited'],
    ['5xx', 503, { code: 'internal_error', message: PRIVATE_PROVIDER_TEXT }, 'provider_5xx'],
  ])('classifies %s without exposing provider content', async (_name, status, error, expectedClass) => {
    const result = await classify(status, error)

    expect(result).toEqual({ ok: true, serving: false, status, class: expectedClass })
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PROVIDER_TEXT)
    expect(Object.keys(result).sort()).toEqual(['class', 'ok', 'serving', 'status'])
  })

  it('distinge cheia API de o autentificare neclasificată fără recomandare greșită', async () => {
    await expect(classify(401, { code: 'unauthorized' }, 'api_key')).resolves.toMatchObject({
      class: 'invalid_key',
    })
    const unknown = await classify(401, { code: 'unauthorized' }, 'unknown')
    expect(unknown.class).toBe('invalid_credentials')
    expect(openaiHealthAction(unknown.class)).not.toContain('OPENAI_API_KEY')
  })

  it('turns transport failures into a safe code without exposing the thrown message', async () => {
    const result = await probeOpenAIHealth(true, async () => {
      throw new Error(PRIVATE_PROVIDER_TEXT)
    })

    expect(result).toEqual({ ok: false, serving: false, status: null, class: 'transport' })
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PROVIDER_TEXT)
  })

  it('reports a missing key without making a request', async () => {
    let called = false
    const result = await probeOpenAIHealth(false, async () => {
      called = true
      return providerResponse(200)
    })

    expect(result).toEqual({ ok: false, serving: false, status: null, class: 'no_key' })
    expect(called).toBe(false)
  })

  it('fails closed when a successful billable probe cannot be durably metered', async () => {
    const result = await probeOpenAIHealth(true, async () => providerResponse(200), {
      onServing: async () => { throw new Error(PRIVATE_PROVIDER_TEXT) },
    })
    expect(result).toEqual({
      ok: true,
      serving: false,
      status: 200,
      class: 'metering_unavailable',
    })
    expect(JSON.stringify(result)).not.toContain(PRIVATE_PROVIDER_TEXT)
  })

  it('deduplică apelurile simultane și păstrează rezultatul în cache până la TTL', async () => {
    let now = 1_000
    let calls = 0
    let release: ((result: OpenAIHealthResult) => void) | undefined
    const pending = new Promise<OpenAIHealthResult>((resolve) => { release = resolve })
    const cachedProbe = cacheOpenAIHealthProbe(async () => {
      calls++
      return pending
    }, 60_000, () => now)

    const first = cachedProbe()
    const concurrent = cachedProbe()
    expect(calls).toBe(1)
    release?.({ ok: true, serving: true, status: 200, class: 'ok' })
    await expect(Promise.all([first, concurrent])).resolves.toHaveLength(2)
    now += 59_999
    await expect(cachedProbe()).resolves.toMatchObject({ serving: true })
    expect(calls).toBe(1)
    now += 1
    await expect(cachedProbe()).resolves.toMatchObject({ serving: true })
    expect(calls).toBe(2)
  })

  it.each<OpenAIHealthClass>([
    'invalid_key',
    'invalid_credentials',
    'insufficient_quota',
    'rate_limited',
    'model_access',
    'bad_request',
    'provider_5xx',
    'transport',
    'metering_unavailable',
    'no_key',
  ])('provides application-owned remediation for %s', (code) => {
    const action = openaiHealthAction(code)
    expect(action).toBeTruthy()
    expect(action).not.toContain(PRIVATE_PROVIDER_TEXT)
  })
})
