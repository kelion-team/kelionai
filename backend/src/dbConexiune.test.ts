// Testele pentru CAUZA REALĂ a ordinului de autovindecare din 21 aug 2026:
//   `route error err: connect ECONNREFUSED 127.0.0.1:5432`
// Măsurat pe `pg` 8: cu o țintă goală sau stricată (ghilimele din env-file),
// driverul NU se plânge — inventează `localhost:5432` și lovește un Postgres
// fantomă, cu `AggregateError` cu mesaj GOL. Aici prindem exact asta.
import { describe, it, expect } from 'vitest'
import {
  citesteTintaDb,
  motivConexiune,
  politicaDinEnv,
  descrieEroareConexiune,
  BazaIndisponibila,
  esteBazaIndisponibila,
  creeazaPoolDb,
  type TintaDbBuna,
} from './dbConexiune.js'

const buna = (brut: string): TintaDbBuna => {
  const t = citesteTintaDb(brut)
  if (!t.ok) throw new Error(`țintă respinsă pe nedrept: ${t.motiv}`)
  return t
}

describe('citesteTintaDb — ținta goală/stricată se RAPORTEAZĂ, nu se ghicește', () => {
  it('respinge ținta goală (asta e cauza ECONNREFUSED 127.0.0.1:5432)', () => {
    for (const gol of ['', '   ', undefined, null]) {
      const t = citesteTintaDb(gol)
      expect(t.ok).toBe(false)
      if (!t.ok) expect(t.motiv).toContain('goală')
    }
  })

  it('respinge o adresă care nu e postgres (nu deschide nimic „pe încercare")', () => {
    for (const rea of ['localhost:5432/kelion', 'mysql://u:p@h:3306/d', 'postgres://']) {
      expect(citesteTintaDb(rea).ok).toBe(false)
    }
  })

  it('curăță ghilimelele din env-file (clasa de stricăciuni care a rupt deja adminul)', () => {
    const t = buna('"postgres://u:p@10.0.0.5:5432/kelion?sslmode=disable"')
    expect(t.gazda).toBe('10.0.0.5')
    expect(t.baza).toBe('kelion')
    expect(t.url.startsWith('postgres://')).toBe(true)
  })

  it('citește gazda, portul, baza și eticheta fără parolă', () => {
    const t = buna('postgres://user:parolaSecreta@db.exemplu.ro:6543/kelion')
    expect({ gazda: t.gazda, port: t.port, baza: t.baza }).toEqual({ gazda: 'db.exemplu.ro', port: 6543, baza: 'kelion' })
    expect(t.eticheta).toBe('db.exemplu.ro:6543/kelion')
    expect(t.eticheta).not.toContain('parolaSecreta')
  })

  it('portul implicit Postgres se completează când lipsește', () => {
    expect(buna('postgres://u:p@db.exemplu.ro/kelion').port).toBe(5432)
  })

  it('TLS: local sau sslmode=disable → fără TLS; orice altă țintă → cu TLS', () => {
    expect(buna('postgres://u:p@127.0.0.1:5432/kelion').tls).toBe(false)
    expect(buna('postgres://u:p@localhost:5432/kelion').tls).toBe(false)
    expect(buna('postgres://u:p@db.exemplu.ro:5432/kelion?sslmode=disable').tls).toBe(false)
    expect(buna('postgres://u:p@db.exemplu.ro:5432/kelion').tls).toBe(true)
  })
})

describe('motivConexiune — doar erorile de CONECTARE (nicio interogare plecată)', () => {
  it('vede codul chiar și îngropat în AggregateError (mesaj GOL, cum îl lasă pg)', () => {
    const agg = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED ::1:5432'), { code: 'ECONNREFUSED' }),
        Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }),
      ],
      '',
    )
    expect(motivConexiune(agg)).toBe('ECONNREFUSED')
  })

  it('vede și cauza înlănțuită, DNS-ul și Postgres-ul care abia pornește', () => {
    expect(motivConexiune(new Error('x', { cause: Object.assign(new Error('dns'), { code: 'EAI_AGAIN' }) }))).toBe('EAI_AGAIN')
    expect(motivConexiune(Object.assign(new Error('nu rezolvă'), { code: 'ENOTFOUND' }))).toBe('ENOTFOUND')
    expect(motivConexiune(Object.assign(new Error('cannot connect now'), { code: '57P03' }))).toBe('57P03')
    expect(motivConexiune(new Error('timeout exceeded when trying to connect'))).toBe('ECONNREFUSED')
  })

  it('NU atinge erorile de SQL/date (acolo interogarea a plecat deja)', () => {
    expect(motivConexiune(Object.assign(new Error('duplicate key'), { code: '23505' }))).toBeNull()
    expect(motivConexiune(new Error('syntax error at or near'))).toBeNull()
    expect(motivConexiune(undefined)).toBeNull()
  })
})

describe('politicaDinEnv — nimic înfipt în cod, cu margini', () => {
  it('implicit: răbdare scurtă, ca să nu strice latența chat/voce', () => {
    const p = politicaDinEnv({})
    expect(p.reincercari).toBeGreaterThan(0)
    expect(p.reincercari * p.pauzaMs).toBeLessThan(1000)
  })

  it('citește env-ul și taie valorile absurde la margini', () => {
    expect(politicaDinEnv({ DB_CONNECT_RETRIES: '4', DB_RETRY_DELAY_MS: '50' })).toMatchObject({ reincercari: 4, pauzaMs: 50 })
    expect(politicaDinEnv({ DB_CONNECT_RETRIES: '999' }).reincercari).toBeLessThanOrEqual(10)
    expect(politicaDinEnv({ DB_CONNECT_RETRIES: 'ceva' }).reincercari).toBe(politicaDinEnv({}).reincercari)
  })
})

describe('BazaIndisponibila — 503 „infrastructură", cu ținta REALĂ în mesaj', () => {
  it('spune unde a încercat, ca logul să nu mai fie gol', () => {
    const msg = descrieEroareConexiune('ECONNREFUSED', buna('postgres://u:p@10.0.0.5:5432/kelion'), 3, 400)
    expect(msg).toContain('ECONNREFUSED')
    expect(msg).toContain('10.0.0.5:5432/kelion')
  })

  it('e recunoscută ca 503 și NU se confundă cu o eroare oarecare', () => {
    const e = new BazaIndisponibila('baza nu răspunde')
    expect(e.statusCode).toBe(503)
    expect(esteBazaIndisponibila(e)).toBe(true)
    expect(esteBazaIndisponibila(new Error('altceva'))).toBe(false)
  })

  it('creeazaPoolDb pe țintă goală ARUNCĂ, în loc să lovească 127.0.0.1:5432', () => {
    let prins: unknown
    try {
      creeazaPoolDb('')
    } catch (e) {
      prins = e
    }
    expect(esteBazaIndisponibila(prins)).toBe(true)
    expect((prins as Error).message).toContain('goală')
  })
})
