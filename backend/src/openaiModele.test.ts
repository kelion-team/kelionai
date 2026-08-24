import { readFile } from 'node:fs/promises'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { config } from './config.js'
import {
  catalogOpenAI,
  clasificaCatalogOpenAI,
  modelOpenAI,
  modelOpenAIExista,
  reseteazaCatalogOpenAI,
  scaraOpenAI,
} from './services/openaiModele.js'

function raspunsCatalog(iduri: string[]): Response {
  return new Response(JSON.stringify({ data: iduri.map((id) => ({ id })) }), { status: 200 })
}

describe('catalogul live OpenAI', () => {
  const overrideInitial = { ...config.openai.override }

  beforeEach(() => {
    vi.stubEnv('OPENAI_API_KEY', 'cheie-test')
    vi.stubEnv('OPENAI_CATALOG_TTL_MS', '60000')
    config.openai.key = 'cheie-test'
    config.openai.override = { luna: '', medium: '', heavy: '', max: '' }
    reseteazaCatalogOpenAI()
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    config.openai.key = ''
    config.openai.override = { ...overrideInitial }
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
    reseteazaCatalogOpenAI()
  })

  it('clasifică patru trepte prezente, în ordine și fără duplicate', async () => {
    const ids = ['gpt-9.7-max', 'gpt-9.7-mini', 'gpt-9.7-nano', 'gpt-9.7-pro', 'gpt-9.6-max']
    vi.mocked(fetch).mockResolvedValue(raspunsCatalog(ids))

    const scara = await scaraOpenAI()
    expect(scara).toEqual(['gpt-9.7-nano', 'gpt-9.7-mini', 'gpt-9.7-pro', 'gpt-9.7-max'])
    expect(new Set(scara).size).toBe(scara.length)
    expect(scara.every((id) => ids.includes(id))).toBe(true)
    expect(clasificaCatalogOpenAI([...ids, 'gpt-9.7-mini'])).toEqual({
      luna: 'gpt-9.7-nano',
      medium: 'gpt-9.7-mini',
      heavy: 'gpt-9.7-pro',
      max: 'gpt-9.7-max',
    })
  })

  it('ignoră override-ul absent și îl onorează pe cel prezent în catalog', async () => {
    vi.mocked(fetch).mockResolvedValue(raspunsCatalog(['gpt-9.7-mini', 'gpt-9.7-pro', 'gpt-9.7-max']))

    config.openai.override.luna = 'model-care-nu-exista'
    await expect(modelOpenAI('luna')).resolves.toBe('gpt-9.7-mini')
    config.openai.override.luna = 'gpt-9.7-pro'
    await expect(modelOpenAI('luna')).resolves.toBe('gpt-9.7-pro')
  })

  it('nu fabrică modele când catalogul este necitibil sau cheia lipsește', async () => {
    config.openai.key = ''

    await expect(Promise.all([
      modelOpenAI('luna'),
      modelOpenAI('medium'),
      modelOpenAI('heavy'),
      modelOpenAI('max'),
      scaraOpenAI(),
    ])).resolves.toEqual(['', '', '', '', []])
    expect(fetch).not.toHaveBeenCalled()
  })

  it('folosește cache-ul în TTL și reia citirea după resetare', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(raspunsCatalog(['gpt-9.7-mini']))
      .mockResolvedValueOnce(raspunsCatalog(['gpt-9.8-pro']))

    await expect(catalogOpenAI()).resolves.toEqual(['gpt-9.7-mini'])
    await expect(catalogOpenAI()).resolves.toEqual(['gpt-9.7-mini'])
    expect(fetch).toHaveBeenCalledTimes(1)
    reseteazaCatalogOpenAI()
    await expect(catalogOpenAI()).resolves.toEqual(['gpt-9.8-pro'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('returnează catalogul expirat și reîmprospătează în fundal', async () => {
    vi.useFakeTimers()
    vi.stubEnv('OPENAI_CATALOG_TTL_MS', '1000')
    vi.mocked(fetch).mockResolvedValueOnce(raspunsCatalog(['gpt-9.7-mini']))
    await expect(catalogOpenAI()).resolves.toEqual(['gpt-9.7-mini'])

    let rezolvaCatalogulNou!: (raspuns: Response) => void
    const citireNoua = new Promise<Response>((resolve) => {
      rezolvaCatalogulNou = resolve
    })
    vi.mocked(fetch).mockReturnValueOnce(citireNoua)
    vi.advanceTimersByTime(1001)

    await expect(catalogOpenAI()).resolves.toEqual(['gpt-9.7-mini'])
    expect(fetch).toHaveBeenCalledTimes(2)

    rezolvaCatalogulNou(raspunsCatalog(['gpt-9.8-pro']))
    await citireNoua
    await vi.waitFor(async () => {
      await expect(catalogOpenAI()).resolves.toEqual(['gpt-9.8-pro'])
    })
    vi.useRealTimers()
  })

  it('validează modelele custom numai în catalogul live', async () => {
    vi.mocked(fetch).mockResolvedValue(raspunsCatalog(['gpt-9.7-pro']))

    await expect(modelOpenAIExista('gpt-9.7-pro')).resolves.toBe(true)
    await expect(modelOpenAIExista('gpt-9.7-nu-exista')).resolves.toBe(false)
  })

  it('nu conține ID-uri OpenAI scrise în config', async () => {
    const sursa = await readFile(new URL('./config.ts', import.meta.url), 'utf8')
    expect(sursa).not.toMatch(/\b(?:gpt-\d+(?:\.\d+)?|o\d+(?:\.\d+)?)(?:[-_][a-z0-9.-]+)?\b/i)
  })
})
