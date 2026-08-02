// ── THE OWNER'S ACCOUNTING: MEASURED USD, NO HAND-WRITTEN FX RATE ─────────
//
// getAdminAccount used to convert the REAL provider costs (USD, from
// cost_events) into £ with the hand-written USD_TO_CURRENCY rate (default
// 0.8) before handing them to the admin panel. A converted figure is not a
// measured one — punga.ts killed the same lie for the pocket ("OpenRouter
// $9.99" in the header vs "Punga £7.99" in the Money tab, the SAME money).
// With the rate gone from config, the owner's cost view is USD end to end.
//
// Tested here: (1) the conversion is GONE from the money path, and (2) the
// function returns exactly the measured sums — 3.5 USD of cost is 3.5, not
// "3.5 × someone's rate".
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

vi.mock('pg', () => {
  class Pool {
    async query(sql: string) {
      // Only the two measured sums are allowed through; anything else THROWS
      // (a query this test doesn't know must not pass "green" unexecuted).
      if (sql.includes('FROM cost_events')) return { rows: [{ t: '3.5' }], rowCount: 1 }
      if (sql.includes("kind = 'profit'")) return { rows: [{ t: '2.5' }], rowCount: 1 }
      throw new Error(`unexpected query: ${sql}`)
    }
    async connect() {
      return { query: this.query.bind(this), release: () => {} }
    }
  }
  return { default: { Pool } }
})

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test@localhost:5432/test?sslmode=disable',
    geminiKey: '',
    billing: { currency: 'gbp', userShare: 0.75, creditValue: 0.1 },
  },
}))

const { getAdminAccount } = await import('./db.js')

describe('contabilitatea ownerului: cifre măsurate, nu convertite', () => {
  it('spent e EXACT suma USD din jurnal, fără curs scris de mână', async () => {
    const acc = await getAdminAccount()
    // 3.5 USD measured. The old code would have returned 3.5 × 0.8 = 2.8 "£"
    // — a figure no provider ever measured.
    expect(acc.spent).toBeCloseTo(3.5, 6)
    expect(acc.profit).toBeCloseTo(2.5, 6)
  })

  it('cursul USD_TO_CURRENCY a dispărut din codul de bani și din config', () => {
    const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8')
    const config = readFileSync(fileURLToPath(new URL('./config.ts', import.meta.url)), 'utf8')
    expect(db).not.toContain('usdToCurrency')
    expect(config).not.toContain('usdToCurrency')
    expect(config).not.toContain('USD_TO_CURRENCY')
  })
})
