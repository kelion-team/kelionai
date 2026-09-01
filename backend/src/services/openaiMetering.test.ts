import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const metering = vi.hoisted(() => ({ record: vi.fn() }))

vi.mock('../config.js', () => ({
  config: {
    sessionSecret: 'test-only-session-secret-not-for-production',
    openai: {
      key: 'not-a-real-key',
      luna: 'configured-luna',
      medium: 'configured-terra',
      heavy: 'configured-sol',
    },
  },
}))
vi.mock('../db.js', () => ({ recordProviderUsage: metering.record }))

const { openaiHealth, openaiResponses } = await import('./openaiResponses.js')

beforeEach(() => {
  metering.record.mockReset().mockResolvedValue(undefined)
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    id: 'resp_meter_1',
    model: 'configured-terra-2026-08-01',
    service_tier: 'priority',
    status: 'completed',
    output_text: 'gata',
    usage: {
      input_tokens: 120,
      output_tokens: 45,
      total_tokens: 165,
      input_tokens_details: { cached_tokens: 70 },
      output_tokens_details: { reasoning_tokens: 12 },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Responses durable usage metering', () => {
  it('persists response id, served model, tier and every token class without content', async () => {
    const result = await openaiResponses(
      'configured-terra',
      [{ role: 'user', content: 'mesaj privat' }],
      [],
      { usageContext: { userEmail: 'user@example.com', surface: 'chat' } },
    )
    expect(result).toMatchObject({
      responseId: 'resp_meter_1',
      model: 'configured-terra-2026-08-01',
      serviceTier: 'priority',
      inputTokens: 120,
      outputTokens: 45,
      cachedInputTokens: 70,
      reasoningOutputTokens: 12,
    })
    expect(result).not.toHaveProperty('costUsd')
    expect(metering.record).toHaveBeenCalledWith({
      responseId: 'resp_meter_1',
      userEmail: 'user@example.com',
      surface: 'chat',
      model: 'configured-terra-2026-08-01',
      serviceTier: 'priority',
      inputTokens: 120,
      outputTokens: 45,
      cachedInputTokens: 70,
      reasoningOutputTokens: 12,
    })
    expect(JSON.stringify(metering.record.mock.calls)).not.toContain('mesaj privat')
  })

  it('fails visibly when raw usage cannot be made durable', async () => {
    metering.record.mockRejectedValueOnce(new Error('db down'))
    await expect(openaiResponses(
      'configured-terra',
      [{ role: 'user', content: 'salut' }],
      [],
      { usageContext: { userEmail: 'user@example.com', surface: 'chat' } },
    )).rejects.toThrow('db down')
  })

  it.each([
    { input_tokens: 2, output_tokens: 1, total_tokens: 4 },
    { input_tokens: 2, output_tokens: 1, total_tokens: 3, input_tokens_details: { cached_tokens: 3 } },
    { input_tokens: 2, output_tokens: 1, total_tokens: 3, output_tokens_details: { reasoning_tokens: 2 } },
  ])('rejects incoherent provider usage instead of persisting it: %j', async (invalidUsage) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'resp_invalid_usage',
      model: 'configured-terra-2026-08-01',
      status: 'completed',
      output_text: 'gata',
      usage: invalidUsage,
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await expect(openaiResponses(
      'configured-terra',
      [{ role: 'user', content: 'salut' }],
      [],
      { usageContext: { userEmail: 'user@example.com', surface: 'chat' } },
    )).rejects.toThrow('openai_usage_invalid')
    expect(metering.record).not.toHaveBeenCalled()
  })

  it('uses a reasoning-safe health budget, meters once and deduplicates concurrent pollers', async () => {
    const fetchMock = vi.mocked(fetch)
    const [first, second] = await Promise.all([openaiHealth(), openaiHealth()])

    expect(first).toMatchObject({ serving: true, class: 'ok' })
    expect(second).toEqual(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const request = fetchMock.mock.calls[0]?.[1]
    const body = JSON.parse(String(request?.body)) as Record<string, unknown>
    expect(body).toMatchObject({
      model: 'configured-luna',
      max_output_tokens: 64,
      stream: false,
      store: false,
    })
    expect(body.max_output_tokens).not.toBe(8)
    expect(metering.record).toHaveBeenCalledTimes(1)
    expect(metering.record).toHaveBeenCalledWith(expect.objectContaining({
      userEmail: 'system',
      surface: 'openai_health',
      responseId: 'resp_meter_1',
    }))
  })

  it('meters a billable incomplete 2xx health response before rejecting its semantic verdict', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'resp_health_incomplete',
      model: 'configured-luna-2026-08-01',
      status: 'incomplete',
      usage: { input_tokens: 4, output_tokens: 1, total_tokens: 5 },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    vi.resetModules()
    const { openaiHealth: freshOpenAIHealth } = await import('./openaiResponses.js')

    await expect(freshOpenAIHealth()).resolves.toMatchObject({
      serving: false,
      status: 200,
      class: 'bad_request',
    })
    expect(metering.record).toHaveBeenCalledTimes(1)
    expect(metering.record).toHaveBeenCalledWith(expect.objectContaining({
      responseId: 'resp_health_incomplete',
      userEmail: 'system',
      surface: 'openai_health',
      inputTokens: 4,
      outputTokens: 1,
    }))
  })

  it('fails health closed when a 2xx response omits core usage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      id: 'resp_health_without_usage',
      model: 'configured-luna-2026-08-01',
      status: 'completed',
      output_text: 'ok',
    }), { status: 200, headers: { 'content-type': 'application/json' } })))
    vi.resetModules()
    const { openaiHealth: freshOpenAIHealth } = await import('./openaiResponses.js')

    await expect(freshOpenAIHealth()).resolves.toEqual({
      ok: true,
      serving: false,
      status: 200,
      class: 'metering_unavailable',
    })
    expect(metering.record).not.toHaveBeenCalled()
  })

  it('fails health closed on a bounded deadline when durable metering never settles', async () => {
    vi.useFakeTimers()
    metering.record.mockImplementationOnce(() => new Promise<void>(() => undefined))
    vi.resetModules()
    const { openaiHealth: freshOpenAIHealth } = await import('./openaiResponses.js')

    const pending = freshOpenAIHealth()
    await vi.advanceTimersByTimeAsync(5_000)
    await expect(pending).resolves.toEqual({
      ok: true,
      serving: false,
      status: 200,
      class: 'metering_unavailable',
    })
  })
})
