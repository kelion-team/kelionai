import { describe, it, expect, vi, beforeEach } from 'vitest'

// The key must exist BEFORE the config import so geminiDirectChat doesn't
// short-circuit with `no_key` and never reaches the (mocked) network.
// (3 aug — extirparea OpenRouter: adaptorul merge acum pe Gemini direct.)
vi.stubEnv('GEMINI_API_KEY', 'test-gemini-key')

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const { brain } = await import('./brain.js')

beforeEach(() => fetchMock.mockReset())

describe('brain.messages.create — adaptorul NU mai fabulează usage-ul', () => {
  it('usage vine din usageMetadata REAL al lui Gemini, nu {0,0} literal', async () => {
    // Before the fix, this adapter returned literal zeros for both token
    // counts — the memory agent's ledger silently recorded $0 forever. Pin
    // the honest shape down: the provider's own usageMetadata travels through.
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: '["fapt"]' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 321, candidatesTokenCount: 9 },
        }),
        { status: 200 },
      ),
    )
    const res = await brain.messages.create({
      model: 'google-direct/gemini-2.5-flash',
      max_tokens: 50,
      messages: [{ role: 'user', content: 'extrage fapte' }],
    })
    expect(res.usage.input_tokens).toBe(321)
    expect(res.usage.output_tokens).toBe(9)
    // Gemini nu itemizează un cost per apel → 0 e MĂSURĂTOAREA (free tier /
    // cheia ownerului), nu o fabricație.
    expect(res.costUsd).toBe(0)
    expect(res.content[0]).toEqual({ type: 'text', text: '["fapt"]' })
  })
})
