import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import { isTransientBrainError, expertModelLadder, runBrainLadder } from './services/brain.js'

describe('Expertul fiabil — clasificarea erorilor', () => {
  it('recunoaște numai erorile tranzitorii de capacitate sau transport', () => {
    expect(isTransientBrainError(new Error('openai 429: rate limited'))).toBe(true)
    expect(isTransientBrainError('Rate limit exceeded')).toBe(true)
    expect(isTransientBrainError(new Error('openai 503: upstream'))).toBe(true)
    expect(isTransientBrainError(new Error('fetch failed'))).toBe(true)
  })
  it('nu clasifică drept tranzitorii erorile de cerere sau autentificare', () => {
    expect(isTransientBrainError(new Error('openai 400: bad request'))).toBe(false)
    expect(isTransientBrainError(new Error('openai 401: invalid key'))).toBe(false)
  })
})

describe('Expertul fiabil — scara de modele', () => {
  it('este deduplicată și acceptă numai identificatori OpenAI validați', async () => {
    const ladder = await expertModelLadder()
    expect(new Set(ladder).size).toBe(ladder.length)
    expect(ladder.every((model) => model.startsWith('openai/gpt-'))).toBe(true)
  })

  it('are exact cele trei roluri Luna, Terra și Sol, fără o treaptă duplicată', () => {
    const source = readFileSync(new URL('./services/brain.ts', import.meta.url), 'utf8')
    const rationament = readFileSync(new URL('./services/creierRationament.ts', import.meta.url), 'utf8')
    expect(source).toContain('const configured = [config.openai.luna, config.openai.medium, config.openai.heavy]')
    expect(rationament).toContain("export type TreaptaRationament = 'rapid' | 'lucru' | 'profund' | 'plan'")
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
        if (m === 'm1') throw new Error('openai 429: rate limit')
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
          throw new Error('openai 429: saturat')
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

  it('oprește imediat scara la erori permanente de cheie/configurație', async () => {
    const tried: string[] = []
    await expect(
      runBrainLadder(
        ['x', 'y'],
        async (model) => {
          tried.push(model)
          throw new Error('openai 401: invalid key')
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/401/)
    expect(tried).toEqual(['x'])
  })
})
