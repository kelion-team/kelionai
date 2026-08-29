import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  config: { serperKey: '', openai: { key: '' } },
  openaiHealth: vi.fn(),
  openaiAvailable: vi.fn(),
}))

vi.mock('./config.js', () => ({
  config: mocks.config,
}))
vi.mock('./db.js', () => ({
  cheltuialaLunaPeKinduri: async () => ({ ok: false, usd: 0 }),
}))
vi.mock('./services/serperBalance.js', () => ({
  getSerperBalance: async () => ({ ok: false, error: 'not_configured' }),
}))
vi.mock('./services/openaiResponses.js', () => ({
  openaiHealth: mocks.openaiHealth,
  openaiAvailable: mocks.openaiAvailable,
}))

import { beculCredit, crediteAI, FELURI_OPENAI, type CreditAI } from './services/creditAI.js'

describe('raportul de credit al integrărilor plătite', () => {
  beforeEach(() => {
    mocks.config.openai.key = ''
    mocks.openaiAvailable.mockReset().mockReturnValue(false)
    mocks.openaiHealth.mockReset().mockResolvedValue({
      ok: false,
      serving: false,
      status: null,
      class: 'no_key',
    })
  })

  it('listează numai OpenAI și căutarea distinctă, fără cifre inventate', async () => {
    const report = await crediteAI()
    expect(report.map((row) => row.furnizor)).toEqual(['Serper', 'OpenAI'])
    for (const row of report) {
      expect(row.ramas.masurat).toBe(false)
      expect(row.cheltuitLuna.masurat).toBe(false)
      expect(row.facturare).toMatch(/^https:\/\//)
    }
  })

  it('catalogul de metering include toate suprafețele OpenAI relevante', () => {
    expect(FELURI_OPENAI).toEqual(expect.arrayContaining([
      'openai', 'chat', 'memory', 'image', 'video', 'asr_openai', 'realtime',
    ]))
  })

  it('propagă numai statusul, clasa sigură și acțiunea controlată pentru owner', async () => {
    mocks.config.openai.key = 'configured-for-test'
    mocks.openaiAvailable.mockReturnValue(true)
    mocks.openaiHealth.mockResolvedValue({
      ok: true,
      serving: false,
      status: 429,
      class: 'insufficient_quota',
      providerMessage: 'PRIVATE_PROVIDER_TEXT_MUST_NOT_ESCAPE',
    })

    const openai = (await crediteAI()).find((row) => row.furnizor === 'OpenAI')
    expect(openai?.serveste).toMatchObject({
      masurat: true,
      valoare: {
        da: false,
        status: 429,
        clasa: 'insufficient_quota',
        detaliu: expect.stringMatching(/Creditul|Billing|Limits/),
      },
    })
    expect(JSON.stringify(openai)).not.toContain('PRIVATE_PROVIDER_TEXT_MUST_NOT_ESCAPE')
  })

  it('spune explicit când cheia API de proiect lipsește', async () => {
    mocks.openaiAvailable.mockReturnValue(false)
    mocks.openaiHealth.mockResolvedValue({ ok: false, serving: false, status: null, class: 'no_key' })

    const openai = (await crediteAI()).find((row) => row.furnizor === 'OpenAI')
    expect(openai?.cheieConfigurata).toBe(false)
    expect(openai?.ramas).toMatchObject({
      masurat: false,
      motiv: 'OPENAI_API_KEY de proiect nu este configurată',
    })
  })
})

type Measurement = CreditAI['ramas']
const citit = (cantitate: number): Measurement => ({
  masurat: true,
  cum: 'test',
  valoare: { cantitate, unitate: 'unități' },
  ms: 1,
  la: '2026-08-24T00:00:00.000Z',
})
const necitit = (): Measurement => ({
  masurat: false,
  cum: 'test',
  motiv: 'sold indisponibil',
  ms: 1,
  la: '2026-08-24T00:00:00.000Z',
})
const row = (partial: Partial<CreditAI>): CreditAI => ({
  furnizor: 'test',
  alimenteaza: 'test',
  cheieConfigurata: true,
  ramas: necitit(),
  cheltuitLuna: {
    masurat: false,
    cum: 'test',
    motiv: 'indisponibil',
    ms: 1,
    la: '2026-08-24T00:00:00.000Z',
  },
  ...partial,
})

describe('becul de credit nu transformă necunoscutul într-un fapt', () => {
  it('sold real pozitiv/zero devine verde/roșu', () => {
    expect(beculCredit(row({ soldReal: true, ramas: citit(1) }))).toBe('verde')
    expect(beculCredit(row({ soldReal: true, ramas: citit(0) }))).toBe('rosu')
  })

  it('un health check verde sau o cotă epuizată decid numai când soldul real nu există', () => {
    expect(beculCredit(row({ serveste: { masurat: true, cum: 'ping', valoare: { da: true, status: 200, clasa: 'ok' }, ms: 1, la: 'now' } }))).toBe('verde')
    expect(beculCredit(row({ serveste: { masurat: true, cum: 'ping', valoare: { da: false, status: 429, clasa: 'insufficient_quota' }, ms: 1, la: 'now' } }))).toBe('rosu')
  })

  it.each([
    'no_key',
    'transport',
    'invalid_key',
    'invalid_credentials',
    'rate_limited',
    'model_access',
    'bad_request',
    'provider_5xx',
    'metering_unavailable',
  ] as const)('nu prezintă %s drept lipsă de credit', (clasa) => {
    expect(beculCredit(row({
      serveste: {
        masurat: true,
        cum: 'ping',
        valoare: { da: false, status: null, clasa },
        ms: 1,
        la: 'now',
      },
    }))).toBe('gri')
  })

  it('lipsa măsurătorii rămâne gri', () => {
    expect(beculCredit(row({ ramas: necitit() }))).toBe('gri')
  })
})
