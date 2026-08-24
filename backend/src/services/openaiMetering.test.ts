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

const { openaiResponses } = await import('./openaiResponses.js')

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
      input_tokens_details: { cached_tokens: 70 },
      output_tokens_details: { reasoning_tokens: 12 },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } })))
})

afterEach(() => vi.unstubAllGlobals())

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
})
