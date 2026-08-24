import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  balanceMinor: 200,
  refs: new Set<string>(),
  calls: 0,
  frozenReason: null as string | null,
  tail: Promise.resolve() as Promise<void>,
  walletRow: null as null | {
    balance_minor: string
    topup_ref_minor: string
    debt_minor?: string
    currency: string
    frozen_reason?: string | null
  },
}))

const configMock = vi.hoisted(() => ({
  databaseUrl: 'postgres://test',
  adminEmail: 'owner@example.com',
  billing: { currency: 'GBP', policyVersion: 'policy-v1', minorUnit: 2 },
}))

vi.mock('./config.js', () => ({ config: configMock }))
vi.mock('./dbPool.js', () => ({
  getPool: () => ({
    query: async (sql: string) => {
      if (!sql.includes('SELECT balance_minor, topup_ref_minor, debt_minor, currency, frozen_reason FROM wallets')) {
        throw new Error(`unexpected pool sql: ${sql.slice(0, 80)}`)
      }
      return { rows: state.walletRow ? [state.walletRow] : [], rowCount: state.walletRow ? 1 : 0 }
    },
  }),
  starePool: vi.fn(),
  inchidePool: vi.fn(),
  conexiuneDb: async () => {
    let unlock: (() => void) | null = null
    return {
      query: async (sql: string, params: unknown[] = []) => {
        state.calls++
        if (sql === 'BEGIN') {
          const before = state.tail
          state.tail = new Promise<void>((resolve) => { unlock = resolve })
          await before
          return { rows: [], rowCount: 0 }
        }
        if (sql === 'COMMIT' || sql === 'ROLLBACK') {
          unlock?.()
          unlock = null
          return { rows: [], rowCount: 0 }
        }
        if (sql.includes('INSERT INTO wallets')) return { rows: [], rowCount: 1 }
        if (sql.includes('SELECT balance_minor')) {
          return {
            rows: [{ balance_minor: String(state.balanceMinor), debt_minor: '0', frozen_reason: state.frozenReason }],
            rowCount: 1,
          }
        }
        if (sql.includes('SELECT 1 FROM billing_events')) {
          return { rows: [], rowCount: state.refs.has(String(params[0])) ? 1 : 0 }
        }
        if (sql.includes('UPDATE wallets SET balance_minor')) {
          state.balanceMinor -= Number(params[1])
          return { rows: [], rowCount: 1 }
        }
        if (sql.includes('INSERT INTO billing_events')) {
          state.refs.add(String(params[4]))
          return { rows: [], rowCount: 1 }
        }
        throw new Error(`unexpected sql: ${sql.slice(0, 60)}`)
      },
      release: vi.fn(),
    }
  },
}))

const { citestePortofel, debitWalletMinorAtomar } = await import('./db.js')

beforeEach(() => {
  state.balanceMinor = 200
  state.refs.clear()
  state.calls = 0
  state.frozenReason = null
  state.tail = Promise.resolve()
  state.walletRow = null
  configMock.databaseUrl = 'postgres://test'
})

describe('atomic minor-unit wallet ledger', () => {
  it('serializes concurrent charges and never permits a negative balance', async () => {
    const [first, second] = await Promise.all([
      debitWalletMinorAtomar('user@example.com', 150, 'turn-1'),
      debitWalletMinorAtomar('user@example.com', 150, 'turn-2'),
    ])
    expect([first.ok, second.ok].sort()).toEqual([false, true])
    expect(state.balanceMinor).toBe(50)
  })

  it('makes a retry with the same event key idempotent', async () => {
    expect((await debitWalletMinorAtomar('user@example.com', 100, 'turn-same')).ok).toBe(true)
    const retry = await debitWalletMinorAtomar('user@example.com', 100, 'turn-same')
    expect(retry).toMatchObject({ ok: true, duplicate: true, debitedMinor: 0 })
    expect(state.balanceMinor).toBe(100)
  })

  it('fails closed when persistence is unavailable', async () => {
    configMock.databaseUrl = ''
    expect(await debitWalletMinorAtomar('user@example.com', 10, 'turn-db-down'))
      .toMatchObject({ ok: false, code: 'unavailable' })
  })

  it('charges admin zero centrally without touching the database', async () => {
    expect(await debitWalletMinorAtomar('OWNER@EXAMPLE.COM', 200, 'admin-turn'))
      .toEqual({ ok: true, debitedMinor: 0, duplicate: false })
    expect(state.calls).toBe(0)
    expect(state.balanceMinor).toBe(200)
  })

  it('fails closed while a verified Merchant dispute freezes the wallet', async () => {
    state.frozenReason = 'merchant_dispute'
    expect(await debitWalletMinorAtomar('user@example.com', 10, 'turn-disputed'))
      .toMatchObject({ ok: false, code: 'insufficient' })
    expect(state.balanceMinor).toBe(200)
  })

  it('never exposes a negative or dimensionally invalid available balance', async () => {
    state.walletRow = { balance_minor: '-102800', topup_ref_minor: '2000', currency: 'GBP' }
    await expect(citestePortofel('user@example.com')).resolves.toEqual({ citit: false, motiv: 'ledger_invalid' })

    state.walletRow = { balance_minor: '100', topup_ref_minor: '2000', currency: 'USD' }
    await expect(citestePortofel('user@example.com')).resolves.toEqual({ citit: false, motiv: 'ledger_invalid' })

    state.walletRow = {
      balance_minor: '100', topup_ref_minor: '100', currency: 'GBP', frozen_reason: 'merchant_dispute',
    }
    await expect(citestePortofel('user@example.com')).resolves.toEqual({
      citit: true, balanceMinor: 0, topupRefMinor: 0,
    })
  })
})
