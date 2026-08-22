// RĂBDAREA pool-ului, cu un `pg` fals: o repornire scurtă de Postgres nu mai
// trebuie să pică cererea, dar o eroare de SQL nu se reîncearcă NICIODATĂ (ar
// putea executa a doua oară o scriere de bani).
import { describe, it, expect, vi, beforeEach } from 'vitest'

const stare: { raspunsuri: unknown[]; apeluri: number } = { raspunsuri: [], apeluri: 0 }

vi.mock('pg', () => {
  class Pool {
    async query(): Promise<unknown> {
      const r = stare.raspunsuri[stare.apeluri++]
      if (r instanceof Error) throw r
      return r
    }
    async connect(): Promise<unknown> {
      return this.query()
    }
  }
  return { default: { Pool } }
})

const { creeazaPoolDb, esteBazaIndisponibila } = await import('./dbConexiune.js')

const TINTA = 'postgres://u:p@10.0.0.5:5432/kelion?sslmode=disable'
const refuz = (): Error => Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:5432'), { code: 'ECONNREFUSED' })
const politica = { reincercari: 2, pauzaMs: 1, timeoutConectareMs: 1000 }

beforeEach(() => {
  stare.raspunsuri = []
  stare.apeluri = 0
})

describe('pool — răbdare mărginită la conectare', () => {
  it('o repornire scurtă de Postgres NU mai pică cererea', async () => {
    stare.raspunsuri = [refuz(), { rows: [{ ok: 1 }] }]
    const pool = creeazaPoolDb(TINTA, politica)
    await expect(pool.query('SELECT 1')).resolves.toEqual({ rows: [{ ok: 1 }] })
    expect(stare.apeluri).toBe(2)
  })

  it('când baza rămâne moartă: BazaIndisponibila cu ținta reală, după exact atâtea încercări', async () => {
    stare.raspunsuri = [refuz(), refuz(), refuz(), refuz()]
    const pool = creeazaPoolDb(TINTA, politica)
    const err = await pool.query('SELECT 1').catch((e: unknown) => e)
    expect(esteBazaIndisponibila(err)).toBe(true)
    expect((err as Error).message).toContain('10.0.0.5:5432/kelion')
    expect(stare.apeluri).toBe(3) // prima + 2 reîncercări
  })

  it('o eroare de SQL NU se reîncearcă și rămâne exact cum e', async () => {
    const sql = Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' })
    stare.raspunsuri = [sql, { rows: [] }]
    const pool = creeazaPoolDb(TINTA, politica)
    await expect(pool.query('INSERT ...')).rejects.toBe(sql)
    expect(stare.apeluri).toBe(1)
  })

  it('connect() are aceeași răbdare (tranzacțiile de bani trec prin el)', async () => {
    stare.raspunsuri = [refuz(), { query: () => undefined, release: () => undefined }]
    const pool = creeazaPoolDb(TINTA, politica)
    await expect(pool.connect()).resolves.toBeTruthy()
    expect(stare.apeluri).toBe(2)
  })
})
