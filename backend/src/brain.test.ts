import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

import { config } from './config.js'
import { isTransientBrainError, expertModelLadder, runBrainLadder } from './services/brain.js'
import {
  isOpenAIProviderThrottleError,
  openaiResponses,
  OpenAIProviderRequestError,
} from './services/openaiResponses.js'

describe('Expertul fiabil — clasificarea erorilor', () => {
  it('nu propagă un 429 pe scară după retry-ul unic al adaptorului', () => {
    expect(isTransientBrainError(new OpenAIProviderRequestError(429, 'rate_limit_exceeded'))).toBe(false)
    expect(isTransientBrainError(new OpenAIProviderRequestError(429, 'credit_balance_exhausted'))).toBe(false)
    expect(isTransientBrainError(new Error('openai 429: rate limited'))).toBe(false)
    expect(isTransientBrainError('Rate limit exceeded')).toBe(false)
  })
  it('recunoaște numai erorile tranzitorii de capacitate sau transport', () => {
    expect(isTransientBrainError(new Error('openai 503: upstream'))).toBe(true)
    expect(isTransientBrainError(new Error('fetch failed'))).toBe(true)
  })
  it('nu clasifică drept tranzitorii erorile de cerere sau autentificare', () => {
    expect(isTransientBrainError(new Error('openai 400: bad request'))).toBe(false)
    expect(isTransientBrainError(new Error('openai 401: invalid key'))).toBe(false)
  })
})

describe('Politica terminală partajată de chat și brain', () => {
  it('oprește scara pe marcajul separat fără să transforme eroarea locală în 429', async () => {
    const initialKey = config.openai.key
    config.openai.key = 'cheie-brain-test'
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'rate_limit_exceeded', message: 'private' },
      }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '0' },
      }))
      .mockResolvedValueOnce(new Response('{not-json', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const pending = openaiResponses('model-luna', [{ role: 'user', content: 'salut' }])
      const errorPromise = pending.catch((caught: unknown) => caught)
      await vi.advanceTimersByTimeAsync(250)
      const localError = await errorPromise
      const tried: string[] = []

      expect(localError).toBeInstanceOf(SyntaxError)
      expect(localError).toMatchObject({ rateLimitRetryConsumed: true })
      expect(isOpenAIProviderThrottleError(localError)).toBe(true)
      await expect(runBrainLadder(
        ['m1', 'm2'],
        async (model) => {
          tried.push(model)
          throw localError
        },
        { sleep: () => Promise.resolve() },
      )).rejects.toBe(localError)
      expect(localError).not.toHaveProperty('status')
      expect(tried).toEqual(['m1'])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      config.openai.key = initialKey
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})

describe('sonda cheii OpenAI', () => {
  it('are buget suficient și păstrează codul HTTP fără a expune răspunsul providerului', () => {
    const source = readFileSync(new URL('./services/brain.ts', import.meta.url), 'utf8')
    const verify = source.slice(source.indexOf('export async function verifyKeys'))
    expect(verify).toContain('maxTokens: 64')
    expect(verify).not.toContain('maxTokens: 8')
    expect(verify).toContain('`fail_${failureStatus}`')
    expect(verify).toContain("diag: { provider: 'openai'")
  })
})

describe('Expertul fiabil — scara de modele', () => {
  it('este deduplicată și acceptă numai identificatori OpenAI validați', async () => {
    const initial = { ...config.openai }
    config.openai.key = 'cheie-brain-test'
    config.openai.luna = 'model-luna'
    config.openai.medium = 'model-terra'
    config.openai.heavy = 'model-terra'
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'model-luna' }, { id: 'model-terra' }, { id: 'model-neconfigurat' }],
    }), { status: 200 })))
    try {
      const ladder = await expertModelLadder()
      expect(ladder).toEqual(['openai/model-luna', 'openai/model-terra'])
      expect(new Set(ladder).size).toBe(ladder.length)
    } finally {
      Object.assign(config.openai, initial)
      vi.unstubAllGlobals()
    }
  })

  it('are exact cele trei roluri Luna, Terra și Sol, fără o treaptă duplicată', () => {
    const source = readFileSync(new URL('./services/brain.ts', import.meta.url), 'utf8')
    const rationament = readFileSync(new URL('./services/creierRationament.ts', import.meta.url), 'utf8')
    expect(source).toContain('const rungs = (await scaraOpenAI())')
    expect(rationament).toContain("export type TreaptaRationament = 'rapid' | 'lucru' | 'profund' | 'plan'")
  })
})

describe('Expertul fiabil — runBrainLadder', () => {
  const noSleep = (): Promise<void> => Promise.resolve()

  it('oprește scara pe primul 429, fără un apel suplimentar de memorie pe alt model', async () => {
    const tried: string[] = []
    await expect(runBrainLadder(
      ['m1', 'm2', 'm3'],
      async (m) => {
        tried.push(m)
        throw new OpenAIProviderRequestError(429, 'rate_limit_exceeded')
      },
      { sleep: noSleep },
    )).rejects.toMatchObject({ status: 429, providerCode: 'rate_limit_exceeded' })
    expect(tried).toEqual(['m1'])
  })

  it('păstrează scara pentru erori temporare 5xx', async () => {
    const tried: string[] = []
    await expect(
      runBrainLadder(
        ['a', 'b', 'c'],
        async (m) => {
          tried.push(m)
          throw new Error('openai 503: indisponibil')
        },
        { sleep: noSleep },
      ),
    ).rejects.toThrow(/503/)
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
