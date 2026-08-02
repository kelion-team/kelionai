import { describe, it, expect, vi, beforeEach } from 'vitest'

// The key must exist BEFORE the config import, otherwise orCall short-circuits
// with `no_key` and never reaches the (mocked) network.
vi.stubEnv('OPENROUTER_API_KEY', 'test-or-key')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { openrouterChat } = await import('./openrouter.js')

beforeEach(() => fetchMock.mockReset())

const chatResponse = (usage: Record<string, number>) =>
  new Response(
    JSON.stringify({
      choices: [{ message: { content: 'salut', tool_calls: [] }, finish_reason: 'stop' }],
      model: 'google/gemini-2.5-flash',
      usage,
    }),
    { status: 200 },
  )

describe('openrouterChat — usage REAL din răspuns, nu zerouri tastate', () => {
  it('costUsd ȘI tokenii vin din același usage al providerului', async () => {
    fetchMock.mockResolvedValue(chatResponse({ cost: 0.0042, prompt_tokens: 1234, completion_tokens: 56 }))
    const r = await openrouterChat('google/gemini-2.5-flash', [{ role: 'user', content: 'bună' }])
    expect(r.costUsd).toBeCloseTo(0.0042, 9)
    expect(r.inputTokens).toBe(1234)
    expect(r.outputTokens).toBe(56)
  })

  it('providerul nu trimite usage → 0 peste tot, dar STOP-ul și textul rămân reale', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }),
        { status: 200 },
      ),
    )
    const r = await openrouterChat('google/gemini-2.5-flash', [{ role: 'user', content: 'bună' }])
    expect(r.text).toBe('ok')
    expect(r.costUsd).toBe(0)
    expect(r.inputTokens).toBe(0)
    expect(r.outputTokens).toBe(0)
  })
})
