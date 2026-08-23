import { describe, it, expect, vi } from 'vitest'

// Minimal environment so the config.js import (pulled by brain.ts) does not complain.
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'test-uri')
vi.stubEnv('SESSION_SECRET', 'test-session-secret')

// Mock loadKv — brain.ts îl folosește pentru comutatorul de creier. În teste
// nu avem DB, deci returnăm null (creier_activ = google-direct default).
vi.mock('./db.js', () => ({ loadKv: () => Promise.resolve(null) }))

import { isTransientBrainError, expertModelLadder, runBrainLadder } from './services/brain.js'

describe('Expertul fiabil — clasificarea erorilor', () => {
  // (3 aug — extirparea OpenRouter: mesajele de eroare sunt acum ale lui
  // Gemini, „gemini <status>: …" — vezi geminiDirectChat.)
  it('recunoaște 429 / rate-limit / RESOURCE_EXHAUSTED ca trecătoare (merită alt model)', () => {
    expect(isTransientBrainError(new Error('gemini 429: rate limited'))).toBe(true)
    expect(isTransientBrainError('Rate limit exceeded: RESOURCE_EXHAUSTED')).toBe(true)
    expect(isTransientBrainError(new Error('gemini 503: upstream'))).toBe(true)
    expect(isTransientBrainError(new Error('fetch failed'))).toBe(true)
  })
  it('NU marchează ca trecătoare o cerere greșită (400/401) — dar tot se sare la următorul model', () => {
    expect(isTransientBrainError(new Error('gemini 400: bad request'))).toBe(false)
    expect(isTransientBrainError(new Error('gemini 401: invalid key'))).toBe(false)
  })
})

describe('Expertul fiabil — scara de modele', () => {
  it('e deduplicată, ordinea păstrată — un singur model e valid (3.6-flash face tot)', async () => {
    // 4 aug: work și top sunt același model (gemini-3.6-flash) — ownerul: „dacă e
    // bun, ieftin și face tot, de ce 2 trepte?". Scara deduplicată are atunci o
    // singură treaptă, ceea ce e corect; păstrăm doar garanția „fără duplicate".
    const ladder = await expertModelLadder()
    expect(ladder.length).toBeGreaterThanOrEqual(1)
    expect(new Set(ladder).size).toBe(ladder.length) // fără duplicate
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
        if (m === 'm1') throw new Error('gemini 429: rate limit')
        return `raspuns de la ${m}`
      },
      { sleep: noSleep },
    )
    expect(out).toBe('raspuns de la m2')
    expect(tried).toEqual(['m1', 'm2']) // stopped at the first good one
  })

  it('încearcă TOATE treptele înainte să arunce, dacă toate pică', async () => {
    const tried: string[] = []
    await expect(
      runBrainLadder(
        ['a', 'b', 'c'],
        async (m) => {
          tried.push(m)
          throw new Error('gemini 429: saturat')
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
