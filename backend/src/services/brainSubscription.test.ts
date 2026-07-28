import { describe, it, expect } from 'vitest'
import { parseBrainSub, subActive, voiceSubActive, type BrainSub } from './brainSubscription.js'

// Auditul de acoperire de teste (28 iul) a semnalat astea ca fiind cea mai
// gravă gaură: subActive/voiceSubActive sunt SINGURA barieră între un user
// plătitor obișnuit și cheia/creditul propriu al ownerului. O regresie de un
// caracter aici (ex: || în loc de &&, sau lipsa lui isAdmin) ar lăsa turele
// unui user oarecare să plătească din punga ownerului, tăcut.

function sub(overrides: Partial<BrainSub> = {}): BrainSub {
  return { mode: 'subscription', model: 'anthropic/claude-sonnet-5', key: 'sk-or-abc', voiceKey: 'sk-oai-xyz', ...overrides }
}

describe('subActive', () => {
  it('is active only for admin, subscription mode, with a key and a model', () => {
    expect(subActive(sub(), true)).toBe(true)
  })

  it('is never active for a non-admin, even in subscription mode with a key', () => {
    expect(subActive(sub(), false)).toBe(false)
  })

  it('is inactive when mode is free, even for admin with a key', () => {
    expect(subActive(sub({ mode: 'free' }), true)).toBe(false)
  })

  it('is inactive when the key is empty', () => {
    expect(subActive(sub({ key: '' }), true)).toBe(false)
  })

  it('is inactive when the model is empty', () => {
    expect(subActive(sub({ model: '' }), true)).toBe(false)
  })
})

describe('voiceSubActive', () => {
  it('is active only for admin, subscription mode, with a voice key', () => {
    expect(voiceSubActive(sub(), true)).toBe(true)
  })

  it('is never active for a non-admin', () => {
    expect(voiceSubActive(sub(), false)).toBe(false)
  })

  it('is inactive when mode is free', () => {
    expect(voiceSubActive(sub({ mode: 'free' }), true)).toBe(false)
  })

  it('is inactive when the voice key is empty (degrades to the shared pool, not an error)', () => {
    expect(voiceSubActive(sub({ voiceKey: '' }), true)).toBe(false)
  })

  it('does not require the OpenRouter key — voice and chat keys are independent', () => {
    expect(voiceSubActive(sub({ key: '' }), true)).toBe(true)
  })
})

describe('parseBrainSub', () => {
  it('falls back to a safe free/empty state on null, undefined, or invalid JSON', () => {
    for (const raw of [null, undefined, 'not json', '']) {
      const s = parseBrainSub(raw)
      expect(s.mode).toBe('free')
      expect(s.key).toBe('')
      expect(s.voiceKey).toBe('')
    }
  })

  it('rejects any mode other than the literal "subscription"', () => {
    const s = parseBrainSub(JSON.stringify({ mode: 'admin', key: 'sk-or-x' }))
    expect(s.mode).toBe('free')
  })

  it('round-trips a full valid record', () => {
    const s = parseBrainSub(JSON.stringify({ mode: 'subscription', model: 'x/y', key: 'sk-or-1', voiceKey: 'sk-oai-2' }))
    expect(s).toEqual({ mode: 'subscription', model: 'x/y', key: 'sk-or-1', voiceKey: 'sk-oai-2' })
  })
})
