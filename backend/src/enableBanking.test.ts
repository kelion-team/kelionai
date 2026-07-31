// ── CITITORUL ENABLE BANKING, PROBAT FĂRĂ REȚEA ──────────────────────────────
//
// 31 iul 2026: GoCardless a murit pentru conturi noi, cititorul a fost rescris
// pe Enable Banking. Regulile care decid CE devine plată stau în
// `mapeazaTranzactii` — funcție pură, de-ia o testăm aici direct:
//   - DOAR intrări (CRDT): o ieșire nu creditează pe nimeni, niciodată;
//   - DOAR booked: o plată pending poate dispărea — creditul ei, nu;
//   - codul se caută în referință + numele plătitorului (unii scriu acolo);
//   - fără referință de bancă tranzacția nu există pentru noi (idempotența
//     creditării stă pe ea — fără id, am putea credita de două ori).
import { describe, it, expect, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    enableBanking: { appId: '', privateKeyB64: '', accountUid: '', aspspName: 'Revolut', aspspCountry: 'GB' },
  },
}))
vi.mock('./db.js', () => ({
  loadKv: vi.fn(async () => null),
  saveKv: vi.fn(async () => undefined),
  crediteazaDupaCod: vi.fn(async () => null),
}))

const { mapeazaTranzactii, startCitirePlati } = await import('./services/openBanking.js')

describe('mapeazaTranzactii — regulile care decid ce devine plată', () => {
  it('o intrare booked cu cod în referință ajunge plată', () => {
    const out = mapeazaTranzactii([
      {
        entry_reference: 'REF-1',
        transaction_amount: { amount: '10.00', currency: 'GBP' },
        credit_debit_indicator: 'CRDT',
        status: 'BOOK',
        remittance_information: ['plata KLN-AB12-CD34 credite'],
      },
    ])
    expect(out).toEqual([
      { id: 'REF-1', amount: 10, currency: 'gbp', referinta: 'plata KLN-AB12-CD34 credite' },
    ])
  })

  it('ieșirile (DBIT) nu creditează pe nimeni, chiar cu cod în referință', () => {
    const out = mapeazaTranzactii([
      {
        entry_reference: 'REF-2',
        transaction_amount: { amount: '-25.00', currency: 'GBP' },
        credit_debit_indicator: 'DBIT',
        status: 'BOOK',
        remittance_information: ['KLN-AB12-CD34'],
      },
    ])
    expect(out).toEqual([])
  })

  it('pending nu devine plată — banii se mai pot întoarce', () => {
    const out = mapeazaTranzactii([
      {
        entry_reference: 'REF-3',
        transaction_amount: { amount: '10.00', currency: 'GBP' },
        credit_debit_indicator: 'CRDT',
        status: 'PEND',
        remittance_information: ['KLN-AB12-CD34'],
      },
    ])
    expect(out).toEqual([])
  })

  it('numele plătitorului intră în textul căutat — unii scriu codul acolo', () => {
    const out = mapeazaTranzactii([
      {
        entry_reference: 'REF-4',
        transaction_amount: { amount: '5.00', currency: 'GBP' },
        credit_debit_indicator: 'CRDT',
        status: 'BOOK',
        remittance_information: ['transfer'],
        debtor: { name: 'KLN-XY78-ZW90 Popescu' },
      },
    ])
    expect(out[0]?.referinta).toContain('KLN-XY78-ZW90')
  })

  it('fără entry_reference cade pe transaction_id; fără niciun id e aruncată', () => {
    const out = mapeazaTranzactii([
      {
        transaction_id: 'TX-9',
        transaction_amount: { amount: '3.00', currency: 'GBP' },
        credit_debit_indicator: 'CRDT',
        status: 'BOOK',
        remittance_information: ['KLN-AB12-CD34'],
      },
      {
        transaction_amount: { amount: '3.00', currency: 'GBP' },
        credit_debit_indicator: 'CRDT',
        status: 'BOOK',
        remittance_information: ['KLN-AB12-CD34'],
      },
    ])
    expect(out).toHaveLength(1)
    expect(out[0]?.id).toBe('TX-9')
  })
})

describe('startCitirePlati — poarta care nu tace', () => {
  it('fără chei se oprește EXPLICIT și scrie de ce, o singură dată', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    try {
      startCitirePlati()
      const scris = spy.mock.calls.map((c) => String(c[0])).join('\n')
      expect(scris).toContain('[PLATI]')
      expect(scris).toMatch(/off|missing/i)
    } finally {
      spy.mockRestore()
    }
  })
})
