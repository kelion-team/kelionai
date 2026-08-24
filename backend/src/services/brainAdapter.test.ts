import { describe, it, expect, vi, beforeEach } from 'vitest'

// The key must exist before config import so the adapter reaches mocked fetch.
vi.stubEnv('OPENAI_API_KEY', ['sk', 'proj-test', 'x'.repeat(48)].join('-'))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
vi.mock('../db.js', () => ({ recordProviderUsage: vi.fn(async () => undefined) }))

const { brain } = await import('./brain.js')

beforeEach(() => fetchMock.mockReset())

describe('brain.messages.create — adaptorul NU mai fabulează usage-ul', () => {
  it('usage vine din răspunsul REAL al providerului, nu {0,0} literal', async () => {
    // Before the fix, this adapter returned literal zeros for both token
    // counts — the memory agent's ledger silently recorded $0 forever. Pin
    // the honest shape down: the provider's own usageMetadata travels through.
    fetchMock.mockImplementation(async (input: string | URL | Request) => {
      if (String(input).endsWith('/models')) {
        return new Response(JSON.stringify({ data: [{ id: 'gpt-5.6-luna' }] }), { status: 200 })
      }
      return new Response(
        JSON.stringify({
          id: 'resp_test_usage',
          model: 'gpt-5.6-luna',
          status: 'completed',
          output: [{ type: 'message', content: [{ type: 'output_text', text: '["fapt"]' }] }],
          usage: { input_tokens: 321, output_tokens: 9 },
        }),
        { status: 200 },
      )
    })
    const res = await brain.messages.create({
      model: 'openai/gpt-5.6-luna',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'extrage fapte' }],
    })
    expect(res.usage.input_tokens).toBe(321)
    expect(res.usage.output_tokens).toBe(9)
    // Usage is measured here; financial cost is reconciled by the privileged
    // accounting worker and must not be fabricated from a local price table.
    expect(res.costUsd).toBeUndefined()
    expect(res.content[0]).toEqual({ type: 'text', text: '["fapt"]' })
  })
})
