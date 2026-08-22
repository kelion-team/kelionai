// ── ORDINELE VII NU SE ȘTERG ÎN GRUP ────────────────────────────────────────
//
// OWNER, 20 aug: „a avut multe ordine de lucru și au dispărut, le-a șters când a
// trecut forțat pe bani." Cauza reală: `deleteBuildJobsByScope('all')` rula un
// `DELETE FROM build_jobs` GOL — mătura și ordinele 'queued'/'running' (munca în
// așteptare), nu doar istoricul. Regula #3: nicio operație în masă pe ceva ce nu
// te-ai uitat. Aici lăcătuim GARDUL: NICIUN scope de ștergere-în-grup (nici 'all')
// nu are voie să atingă ordinele VII. Un ordin viu se șterge DOAR țintit, pe id.
//
// Rulează pe un „pg" fals care DOAR înregistrează SQL-ul + parametrii — nu ne
// trebuie o bază reală ca să dovedim CE interogare pleacă.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const spion = vi.hoisted(() => ({ apeluri: [] as { sql: string; params?: unknown[] }[] }))

// Dublură fidelă: pg.Pool și clientul împrumutat sunt EventEmitter-e (dbPool.ts
// pune ureche pe „error" pe amândouă).
vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events')
  const query = (sql: string, params?: unknown[]) => {
    spion.apeluri.push({ sql, params })
    return Promise.resolve({ rowCount: 0, rows: [] })
  }
  class Pool extends EventEmitter {
    query = query
    async connect() {
      return Object.assign(new EventEmitter(), { query, release: () => {} })
    }
  }
  return { default: { Pool } }
})

vi.mock('./config.js', () => ({
  config: {
    databaseUrl: 'postgres://test@localhost:5432/test?sslmode=disable',
    geminiKey: '',
    billing: { userShare: 0.75, creditValue: 0.1, usdToCurrency: 1, currency: 'gbp' },
  },
}))

const { deleteBuildJobsByScope } = await import('./db.js')

/** SQL-ul (unic) al ultimei ștergeri de build_jobs + parametrii lui. */
function ultimaStergere(): { sql: string; params: unknown[] } {
  const del = spion.apeluri.filter((a) => /DELETE\s+FROM\s+build_jobs/i.test(a.sql))
  expect(del.length).toBe(1) // exact o ștergere per apel
  return { sql: del[0].sql, params: (del[0].params ?? []) as unknown[] }
}

beforeEach(() => {
  spion.apeluri = []
})

describe('deleteBuildJobsByScope — ordinele VII (queued/running) NU se șterg în grup', () => {
  it('„all" NU e un DELETE gol și NU include queued/running (nu mai mătură munca vie)', async () => {
    await deleteBuildJobsByScope('all')
    const { sql, params } = ultimaStergere()
    // NICIODATĂ un DELETE fără filtru — ăsta era bugul care ștergea tot.
    expect(sql).toMatch(/WHERE\s+status\s*=\s*ANY/i)
    const stari = (params[0] ?? []) as string[]
    expect(stari).not.toContain('queued')
    expect(stari).not.toContain('running')
    // „tot" = tot istoricul.
    expect(stari).toEqual(expect.arrayContaining(['failed', 'done', 'cancelled']))
  })

  it.each(['failed', 'done', 'failed_done'] as const)('„%s" atinge doar stări de istoric, niciodată vii', async (scope) => {
    await deleteBuildJobsByScope(scope)
    const { params } = ultimaStergere()
    const stari = (params[0] ?? []) as string[]
    expect(stari).not.toContain('queued')
    expect(stari).not.toContain('running')
    expect(stari.length).toBeGreaterThan(0)
  })
})
