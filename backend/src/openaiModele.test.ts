import { readFile } from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { config } from './config.js'
import {
  catalogOpenAI,
  modelOpenAI,
  modelOpenAIExista,
  motivCatalogOpenAI,
  reimprospateazaCatalogOpenAI,
  scaraOpenAI,
} from './services/openaiModele.js'

// Modul abonament ChatGPT nu e activ în teste — testăm calea cheie API
vi.mock('./services/chatgptSubscription.js', () => ({
  isSubscriptionMode: () => false,
  hasChatGptSubscription: () => false,
  getSubscriptionCredentials: async () => null,
}))

function raspunsCatalog(iduri: string[]): Response {
  return new Response(JSON.stringify({ data: iduri.map((id) => ({ id })) }), { status: 200 })
}

describe('catalogul live OpenAI', () => {
  let serialCheie = 0
  let cheieTest = ''
  const initial = {
    key: config.openai.key,
    apiBaseUrl: config.openai.apiBaseUrl,
    luna: config.openai.luna,
    medium: config.openai.medium,
    heavy: config.openai.heavy,
  }

  beforeEach(() => {
    vi.stubEnv('OPENAI_CATALOG_TTL_MS', '60000')
    cheieTest = `cheie-catalog-test-${++serialCheie}`
    config.openai.key = cheieTest
    config.openai.apiBaseUrl = 'https://catalog.example.test/v1'
    config.openai.luna = 'model-luna'
    config.openai.medium = 'model-terra'
    config.openai.heavy = 'model-sol'
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    Object.assign(config.openai, initial)
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  it('folosește numai rolurile configurate pe care cheia le servește', async () => {
    vi.mocked(fetch).mockResolvedValue(raspunsCatalog([
      'model-terra',
      'model-neconfigurat-mai-nou',
      'model-luna',
    ]))

    await expect(scaraOpenAI()).resolves.toEqual(['model-luna', 'model-terra'])
    await expect(modelOpenAI('luna')).resolves.toBe('model-luna')
    await expect(modelOpenAI('heavy')).resolves.toBe('')
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('nu fabrică modele și nu face rețea când cheia lipsește', async () => {
    config.openai.key = ''

    await expect(scaraOpenAI()).resolves.toEqual([])
    await expect(modelOpenAI('luna')).resolves.toBe('')
    expect(motivCatalogOpenAI()).toContain('cheia OpenAI lipsește')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('folosește cache-ul în TTL și permite o reîmprospătare explicită', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(raspunsCatalog(['model-luna']))
      .mockResolvedValueOnce(raspunsCatalog(['model-terra']))

    await expect(catalogOpenAI()).resolves.toEqual(['model-luna'])
    await expect(catalogOpenAI()).resolves.toEqual(['model-luna'])
    expect(fetch).toHaveBeenCalledTimes(1)
    await expect(reimprospateazaCatalogOpenAI()).resolves.toEqual(['model-terra'])
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('păstrează catalogul verificat când reîmprospătarea din fundal eșuează', async () => {
    vi.useFakeTimers()
    vi.stubEnv('OPENAI_CATALOG_TTL_MS', '1000')
    vi.mocked(fetch)
      .mockResolvedValueOnce(raspunsCatalog(['model-luna']))
      .mockRejectedValueOnce(new Error('rețea indisponibilă'))
    await expect(catalogOpenAI()).resolves.toEqual(['model-luna'])

    vi.advanceTimersByTime(1001)
    await expect(catalogOpenAI()).resolves.toEqual(['model-luna'])
    await vi.waitFor(() => expect(motivCatalogOpenAI()).toContain('rețea indisponibilă'))
    await expect(catalogOpenAI()).resolves.toEqual(['model-luna'])
  })

  it('validează un model solicitat numai în catalogul live', async () => {
    vi.mocked(fetch).mockResolvedValue(raspunsCatalog(['model-sol']))

    await expect(modelOpenAIExista('openai/model-sol')).resolves.toBe(true)
    await expect(modelOpenAIExista('model-inexistent')).resolves.toBe(false)
  })

  it('apelează endpointul configurat fără să expună cheia în URL', async () => {
    vi.mocked(fetch).mockResolvedValue(raspunsCatalog(['model-luna']))

    await catalogOpenAI()

    expect(fetch).toHaveBeenCalledWith(
      'https://catalog.example.test/v1/models',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: `Bearer ${cheieTest}` },
      }),
    )
    expect(vi.mocked(fetch).mock.calls[0][0]).not.toContain(cheieTest)
  })

  it('respinge integral un catalog cu ID-uri invalide', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: 'model-luna' }, { id: '' }],
    }), { status: 200 }))

    await expect(catalogOpenAI()).resolves.toEqual([])
    expect(motivCatalogOpenAI()).toContain('modele fără ID valid')
  })

  it('nu conține ID-uri OpenAI scrise în config', async () => {
    const sursa = await readFile(new URL('./config.ts', import.meta.url), 'utf8')
    expect(sursa).not.toMatch(/\b(?:gpt-\d+(?:\.\d+)?|o\d+(?:\.\d+)?)(?:[-_][a-z0-9.-]+)?\b/i)
  })
})
