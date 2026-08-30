import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const metering = vi.hoisted(() => ({ record: vi.fn() }))

vi.mock('../config.js', () => ({
  config: {
    sessionSecret: 'test-only-session-secret-not-for-production',
    openai: {
      key: 'not-a-real-key',
      apiBaseUrl: 'https://api.openai.com/v1',
      luna: 'configured-luna',
      medium: 'configured-terra',
      heavy: 'configured-sol',
    },
  },
}))
vi.mock('../db.js', () => ({ recordProviderUsage: metering.record }))

const {
  isOpenAIProviderThrottleError,
  openaiResponses,
  openaiResponsesStream,
  safeOpenAIRetryAfterMs,
} = await import('./openaiResponses.js')
const { brain } = await import('./brain.js')

const PRIVATE_PROVIDER_TEXT = 'PRIVATE_PROVIDER_TEXT_MUST_NOT_ESCAPE'

function successResponse(id = 'resp_retry_ok'): Response {
  return new Response(JSON.stringify({
    id,
    model: 'configured-luna',
    status: 'completed',
    output_text: 'ok',
    usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function limitResponse(code: string, retryAfter?: string): Response {
  return new Response(JSON.stringify({
    error: { code, message: PRIVATE_PROVIDER_TEXT },
  }), {
    status: 429,
    headers: {
      'content-type': 'application/json',
      ...(retryAfter == null ? {} : { 'retry-after': retryAfter }),
    },
  })
}

beforeEach(() => {
  metering.record.mockReset().mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('OpenAI 429 anti-amplification policy', () => {
  it.each([
    'credit_balance_exhausted',
    'project_spend_limit_exceeded',
    'organization_spend_limit_exceeded',
    'organization_usage_limit_exceeded',
    'insufficient_quota',
  ] as const)('does not retry or expose provider text for terminal code %s', async (code) => {
    const fetchMock = vi.fn().mockResolvedValue(limitResponse(code, '0'))
    vi.stubGlobal('fetch', fetchMock)

    const failure = openaiResponses('configured-luna', [{ role: 'user', content: 'salut' }])
      .catch((error: unknown) => error)
    const error = await failure
    expect(error).toMatchObject({
      name: 'OpenAIProviderRequestError',
      status: 429,
      providerCode: code,
    })
    expect(String(error)).not.toContain(PRIVATE_PROVIDER_TEXT)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries exact rate_limit_exceeded once after Retry-After and then succeeds', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '0.5'))
      .mockResolvedValueOnce(successResponse())
    vi.stubGlobal('fetch', fetchMock)

    const pending = openaiResponses('configured-luna', [{ role: 'user', content: 'salut' }])
    await vi.advanceTimersByTimeAsync(499)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)

    await expect(pending).resolves.toMatchObject({ text: 'ok', responseId: 'resp_retry_ok' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(metering.record).toHaveBeenCalledTimes(1)
  })

  it('stops after the single permitted rate-limit retry', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '0'))
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '0'))
    vi.stubGlobal('fetch', fetchMock)

    const pending = openaiResponses('configured-luna', [{ role: 'user', content: 'salut' }])
    const rejection = expect(pending).rejects.toMatchObject({
      status: 429,
      providerCode: 'rate_limit_exceeded',
    })
    await vi.advanceTimersByTimeAsync(250)

    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(metering.record).not.toHaveBeenCalled()
  })

  it('does not guess or retry an unknown 429 code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(limitResponse('future_private_limit', '0'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(openaiResponses(
      'configured-luna',
      [{ role: 'user', content: 'salut' }],
    )).rejects.toMatchObject({ status: 429, providerCode: undefined })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('uses only error.code, never type/message, to authorize a retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: {
        code: 'future_private_limit',
        type: 'rate_limit_exceeded',
        message: 'rate_limit_exceeded',
      },
    }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '0' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(openaiResponses(
      'configured-luna',
      [{ role: 'user', content: 'salut' }],
    )).rejects.toMatchObject({ status: 429, providerCode: undefined })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not retry a financial HTTP 402 and marks it terminal for outer layers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { code: 'billing_error', message: PRIVATE_PROVIDER_TEXT },
    }), { status: 402, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const error = await openaiResponses(
      'configured-luna',
      [{ role: 'user', content: 'salut' }],
    ).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 402 })
    expect(isOpenAIProviderThrottleError(error)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it.each([400, 401, 403, 404, 422])(
    'marks permanent provider HTTP %s terminal for outer layers',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
        status,
        headers: { 'content-type': 'application/json' },
      }))
      vi.stubGlobal('fetch', fetchMock)

      const error = await openaiResponses(
        'configured-luna',
        [{ role: 'user', content: 'salut' }],
      ).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ status })
      expect(isOpenAIProviderThrottleError(error)).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it.each([408, 409, 500, 503])(
    'keeps transient provider HTTP %s eligible for the existing outer policy',
    async (status) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
        status,
        headers: { 'content-type': 'application/json' },
      }))
      vi.stubGlobal('fetch', fetchMock)

      const error = await openaiResponses(
        'configured-luna',
        [{ role: 'user', content: 'salut' }],
      ).catch((caught: unknown) => caught)
      expect(error).toMatchObject({ status })
      expect(isOpenAIProviderThrottleError(error)).toBe(false)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    },
  )

  it('does not permit an outer retry when the one rate-limit retry returns 503', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '0'))
      .mockResolvedValueOnce(new Response('{}', {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    const pending = openaiResponses('configured-luna', [{ role: 'user', content: 'salut' }])
    const errorPromise = pending.catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(250)
    const error = await errorPromise
    expect(error).toMatchObject({ status: 503, rateLimitRetryConsumed: true })
    expect(isOpenAIProviderThrottleError(error)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not permit an outer retry when the one rate-limit retry loses transport', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '0'))
      .mockRejectedValueOnce(new Error(PRIVATE_PROVIDER_TEXT))
    vi.stubGlobal('fetch', fetchMock)

    const pending = openaiResponses('configured-luna', [{ role: 'user', content: 'salut' }])
    const errorPromise = pending.catch((caught: unknown) => caught)
    await vi.advanceTimersByTimeAsync(250)
    const error = await errorPromise
    expect(error).toMatchObject({
      status: 429,
      providerCode: 'rate_limit_exceeded',
      rateLimitRetryConsumed: true,
    })
    expect(String(error)).not.toContain(PRIVATE_PROVIDER_TEXT)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('applies the 10 second cap to the actual retry timer', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '999'))
      .mockResolvedValueOnce(successResponse('resp_capped_retry'))
    vi.stubGlobal('fetch', fetchMock)

    const pending = openaiResponses('configured-luna', [{ role: 'user', content: 'salut' }])
    await vi.advanceTimersByTimeAsync(9_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toMatchObject({ responseId: 'resp_capped_retry' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('bounds malformed, zero, numeric and date Retry-After values', () => {
    const now = Date.parse('2026-08-30T00:00:00Z')
    expect(safeOpenAIRetryAfterMs(null, now)).toBe(1_000)
    expect(safeOpenAIRetryAfterMs('invalid', now)).toBe(1_000)
    expect(safeOpenAIRetryAfterMs('0', now)).toBe(250)
    expect(safeOpenAIRetryAfterMs('0.5', now)).toBe(500)
    expect(safeOpenAIRetryAfterMs('999', now)).toBe(10_000)
    expect(safeOpenAIRetryAfterMs('Sat, 30 Aug 2026 00:00:03 GMT', now)).toBe(3_000)
  })
})

describe('OpenAI streaming 429 policy', () => {
  it.each([
    'credit_balance_exhausted',
    'project_spend_limit_exceeded',
    'organization_spend_limit_exceeded',
    'organization_usage_limit_exceeded',
    'insufficient_quota',
  ] as const)('does not retry terminal stream code %s', async (code) => {
    const fetchMock = vi.fn().mockResolvedValue(limitResponse(code, '999'))
    vi.stubGlobal('fetch', fetchMock)

    await expect(openaiResponsesStream(
      'configured-luna',
      [{ role: 'user', content: 'salut' }],
      [],
      vi.fn(),
    )).rejects.toMatchObject({ status: 429, providerCode: code })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries exact rate_limit_exceeded once with the same model and body', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '0'))
      .mockResolvedValueOnce(limitResponse('rate_limit_exceeded', '0'))
    vi.stubGlobal('fetch', fetchMock)

    const pending = openaiResponsesStream(
      'configured-luna',
      [{ role: 'user', content: 'salut' }],
      [],
      vi.fn(),
    )
    const rejection = expect(pending).rejects.toMatchObject({
      status: 429,
      providerCode: 'rate_limit_exceeded',
      rateLimitRetryConsumed: true,
    })
    await vi.advanceTimersByTimeAsync(250)
    await rejection

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstBody = fetchMock.mock.calls[0]?.[1]?.body
    const secondBody = fetchMock.mock.calls[1]?.[1]?.body
    expect(secondBody).toBe(firstBody)
    expect(JSON.parse(String(firstBody))).toMatchObject({ model: 'configured-luna', stream: true })
  })

  it('treats an exact quota error inside an SSE event as terminal', async () => {
    const body = [
      'event: error',
      `data: ${JSON.stringify({ type: 'error', error: { code: 'insufficient_quota', message: PRIVATE_PROVIDER_TEXT } })}`,
      '',
      '',
    ].join('\n')
    const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const error = await openaiResponsesStream(
      'configured-luna',
      [{ role: 'user', content: 'salut' }],
      [],
      vi.fn(),
    ).catch((caught: unknown) => caught)
    expect(error).toMatchObject({ status: 429, providerCode: 'insufficient_quota' })
    expect(String(error)).not.toContain(PRIVATE_PROVIDER_TEXT)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('Memory 429 policy', () => {
  function memoryFetch(code: string, responsesModels: string[]): ReturnType<typeof vi.fn> {
    return vi.fn().mockImplementation((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return Promise.resolve(new Response(JSON.stringify({
          data: [
            { id: 'configured-luna' },
            { id: 'configured-terra' },
            { id: 'configured-sol' },
          ],
        }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      responsesModels.push(String(JSON.parse(String(init?.body)).model))
      return Promise.resolve(limitResponse(code, '0'))
    })
  }

  it('uses one Luna Responses request for terminal quota, never Terra/Sol', async () => {
    const responseModels: string[] = []
    const fetchMock = memoryFetch('insufficient_quota', responseModels)
    vi.stubGlobal('fetch', fetchMock)

    await expect(brain.messages.create({
      model: 'openai/configured-luna',
      messages: [{ role: 'user', content: 'ține minte' }],
    })).rejects.toMatchObject({ status: 429, providerCode: 'insufficient_quota' })
    expect(responseModels).toEqual(['configured-luna'])
  })

  it('uses only the two permitted Luna attempts for rate limit, never Terra/Sol', async () => {
    vi.useFakeTimers()
    const responseModels: string[] = []
    const fetchMock = memoryFetch('rate_limit_exceeded', responseModels)
    vi.stubGlobal('fetch', fetchMock)

    const pending = brain.messages.create({
      model: 'openai/configured-luna',
      messages: [{ role: 'user', content: 'ține minte' }],
    })
    const rejection = expect(pending).rejects.toMatchObject({
      status: 429,
      providerCode: 'rate_limit_exceeded',
    })
    await vi.advanceTimersByTimeAsync(250)
    await rejection
    expect(responseModels).toEqual(['configured-luna', 'configured-luna'])
  })
})
