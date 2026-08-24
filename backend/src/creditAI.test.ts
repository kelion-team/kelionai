import { describe, expect, it, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: { serperKey: '', openai: { key: '' } },
}))
vi.mock('./db.js', () => ({
  cheltuialaLunaPeKinduri: async () => ({ ok: false, usd: 0 }),
}))
vi.mock('./services/serperBalance.js', () => ({
  getSerperBalance: async () => ({ ok: false, error: 'not_configured' }),
}))
vi.mock('./services/openaiResponses.js', () => ({
  openaiHealth: async () => ({ ok: false, serving: false, reason: 'not_configured' }),
}))

import { beculCredit, crediteAI, FELURI_OPENAI, type CreditAI } from './services/creditAI.js'

describe('raportul de credit al integrărilor plătite', () => {
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

  it('un health check măsurat decide numai când soldul real nu există', () => {
    expect(beculCredit(row({ serveste: { masurat: true, cum: 'ping', valoare: { da: true }, ms: 1, la: 'now' } }))).toBe('verde')
    expect(beculCredit(row({ serveste: { masurat: true, cum: 'ping', valoare: { da: false }, ms: 1, la: 'now' } }))).toBe('rosu')
  })

  it('lipsa măsurătorii rămâne gri', () => {
    expect(beculCredit(row({ ramas: necitit() }))).toBe('gri')
  })
})
