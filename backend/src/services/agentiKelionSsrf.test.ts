import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { rationeazaMesaje } = vi.hoisted(() => ({
  rationeazaMesaje: vi.fn(),
}))

vi.mock('./creierRationament.js', () => ({ rationeazaMesaje }))
vi.mock('../config.js', () => ({
  config: {
    adminEmail: 'admin@example.invalid',
    publicOrigin: 'https://example.invalid',
    openai: { heavy: 'model-heavy', luna: 'model-fast' },
  },
}))
vi.mock('../db.js', () => ({
  listaAgentiCustom: vi.fn(async () => []),
  searchMemories: vi.fn(async () => []),
  getGoogleRefreshToken: vi.fn(async () => null),
  adaugaAgentCustom: vi.fn(async () => true),
}))
vi.mock('./google.js', () => ({
  webSearch: vi.fn(async () => '[]'),
  googleTools: [],
  runGoogleTool: vi.fn(async () => '{"error":"disabled_in_test"}'),
  refreshGoogleAccessToken: vi.fn(async () => null),
}))

const { cheamaAgent } = await import('./agentiKelion.js')

const AGENT = { id: 'test', nume: 'Test', rol: 'verificare' }
const URL_URI_PERICULOASE = [
  'http://127.0.0.1:5432/',
  'http://[::1]/',
  'http://[::ffff:127.0.0.1]/',
  'http://10.0.0.1/',
  'http://169.254.169.254/latest/meta-data/',
  'http://user:password@example.com/',
  'https://public.example/redirect-to-private',
  'https://huge.example/chunked',
]

describe('agenții A2A nu pot prelua URL-uri în procesul web', () => {
  beforeEach(() => {
    rationeazaMesaje.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.each(URL_URI_PERICULOASE)('respinge apelul fabricat pentru %s fără acces la rețea', async (url) => {
    const fetchDinProces = vi.fn(() => {
      throw new Error('fetch nu trebuie apelat')
    })
    vi.stubGlobal('fetch', fetchDinProces)

    rationeazaMesaje
      .mockResolvedValueOnce({
        text: '',
        toolCalls: [{
          id: 'call-1',
          type: 'function',
          function: { name: 'citeste_pagina', arguments: JSON.stringify({ url }) },
        }],
        model: 'model-fast',
      })
      .mockResolvedValueOnce({
        text: 'Nu pot deschide URL-ul în această suprafață.',
        toolCalls: [],
        model: 'model-fast',
      })

    const rezultat = await cheamaAgent(AGENT, 'citește această adresă', false, 'user@example.invalid')

    const primaConfigurare = rationeazaMesaje.mock.calls[0]?.[1] as {
      tools?: Array<{ name: string }>
    }
    expect(primaConfigurare.tools?.map((tool) => tool.name)).not.toContain('citeste_pagina')
    expect(fetchDinProces).not.toHaveBeenCalled()
    expect(rezultat.doveziUnelte).toContainEqual(expect.objectContaining({
      nume: 'citeste_pagina',
      stare: 'failed',
    }))
  })
})
