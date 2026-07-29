import { describe, it, expect, vi } from 'vitest'

// Mediul minim ca importul config.js (tras de brain.ts) să nu se plângă.
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'test-uri')
vi.stubEnv('SESSION_SECRET', 'test-session-secret')

import { isTransientBrainError, expertModelLadder, runBrainLadder } from './services/brain.js'

describe('Expertul fiabil — clasificarea erorilor', () => {
  it('recunoaște 429 / rate-limit / DEGRADED ca trecătoare (merită alt model)', () => {
    expect(isTransientBrainError(new Error('openrouter 429: rate limited'))).toBe(true)
    expect(isTransientBrainError('Rate limit exceeded: free-models-per-min')).toBe(true)
    expect(isTransientBrainError(new Error('DEGRADED function cannot be invoked'))).toBe(true)
    expect(isTransientBrainError(new Error('openrouter 503: upstream'))).toBe(true)
    expect(isTransientBrainError(new Error('fetch failed'))).toBe(true)
  })
  it('NU marchează ca trecătoare o cerere greșită (400/401) — dar tot se sare la următorul model', () => {
    expect(isTransientBrainError(new Error('openrouter 400: bad request'))).toBe(false)
    expect(isTransientBrainError(new Error('openrouter 401: invalid key'))).toBe(false)
  })
})

describe('Expertul fiabil — scara de modele', () => {
  it('începe cu work + top și e deduplicată, ordinea păstrată', () => {
    const ladder = expertModelLadder()
    expect(ladder.length).toBeGreaterThanOrEqual(2)
    expect(new Set(ladder).size).toBe(ladder.length) // fără dubluri
  })
})

describe('Expertul fiabil — runBrainLadder', () => {
  const noSleep = (): Promise<void> => Promise.resolve()

  it('sare peste un model saturat (429) și răspunde de pe următorul', async () => {
    const tried: string[] = []
    const out = await runBrainLadder(
      ['m1', 'm2', 'm3'],
      async (m) => {
        tried.push(m)
        if (m === 'm1') throw new Error('openrouter 429: rate limit')
        return `raspuns de la ${m}`
      },
      { sleep: noSleep },
    )
    expect(out).toBe('raspuns de la m2')
    expect(tried).toEqual(['m1', 'm2']) // s-a oprit la primul bun
  })

  it('încearcă TOATE treptele înainte să arunce, dacă toate pică', async () => {
    const tried: string[] = []
    await expect(
      runBrainLadder(
        ['a', 'b', 'c'],
        async (m) => {
          tried.push(m)
          throw new Error('openrouter 429: saturat')
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/429/)
    expect(tried).toEqual(['a', 'b', 'c'])
  })

  it('primul model bun răspunde direct, fără să atingă restul', async () => {
    const tried: string[] = []
    const out = await runBrainLadder(
      ['x', 'y'],
      async (m) => {
        tried.push(m)
        return `ok ${m}`
      },
      { sleep: noSleep },
    )
    expect(out).toBe('ok x')
    expect(tried).toEqual(['x'])
  })
})
