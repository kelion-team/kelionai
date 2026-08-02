import { describe, it, expect, vi, beforeEach } from 'vitest'

// The key must exist BEFORE the config import so orCall doesn't short-circuit.
vi.stubEnv('OPENROUTER_API_KEY', 'test-or-key')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { brain } = await import('./brain.js')

beforeEach(() => fetchMock.mockReset())

describe('brain.messages.create — adaptorul NU mai fabulează usage-ul', () => {
  it('usage și costUsd sunt cele RAPORTATE de provider, nu {0,0} literal', async () => {
    // Before the fix, this adapter returned literal zeros for both token
    // counts and dropped the real usage.cost — the memory agent's ledger
    // silently recorded $0 forever. Pin the honest shape down.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '["fapt"]' }, finish_reason: 'stop' }],
          model: 'nvidia/nemotron-ultra:free',
          usage: { cost: 0.0007, prompt_tokens: 321, completion_tokens: 9 },
        }),
        { status: 200 },
      ),
    )
    const res = await brain.messages.create({
      model: 'nvidia/nemotron-ultra:free',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'extrage fapte' }],
    })
    expect(res.usage.input_tokens).toBe(321)
    expect(res.usage.output_tokens).toBe(9)
    expect(res.costUsd).toBeCloseTo(0.0007, 9)
  })
})
