// ── TESTE PENTRU VIAȚA CONEXIUNILOR POSTGRES (dbPool.ts) ────────────────────
//
// Regresia pe care o păzesc: `uncaughtException: terminating connection due to
// administrator command`. Cauza era un `pg.Pool` fără ascultător pe `error` —
// un `EventEmitter` care emite `error` fără ureche ARUNCĂ, iar eroarea venea
// de pe socketul unui client în repaus, deci în afara oricărui `try/catch`.
import { EventEmitter } from 'node:events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type pg from 'pg'
import {
  esteConexiunePierduta,
  optiuniPool,
  imbracaClientImprumutat,
  getPool,
  inchidePool,
  starePool,
} from './dbPool.js'

describe('dbPool — clasificarea erorilor de conexiune', () => {
  it('mesajul care a doborât procesul e recunoscut ca conexiune pierdută', () => {
    expect(esteConexiunePierduta(new Error('terminating connection due to administrator command'))).toBe(true)
  })

  it('celelalte forme de închidere din partea serverului, la fel', () => {
    for (const m of [
      'the database system is shutting down',
      'Connection terminated unexpectedly',
      'server closed the connection unexpectedly',
    ]) {
      expect(esteConexiunePierduta(new Error(m))).toBe(true)
    }
  })

  it('codurile de socket/Postgres contează chiar fără mesaj cunoscut', () => {
    expect(esteConexiunePierduta(Object.assign(new Error('read'), { code: 'ECONNRESET' }))).toBe(true)
    expect(esteConexiunePierduta(Object.assign(new Error('bum'), { code: '57P01' }))).toBe(true)
  })

  it('un bug adevărat NU e mascat drept conexiune pierdută', () => {
    expect(esteConexiunePierduta(new Error('duplicate key value violates unique constraint'))).toBe(false)
    expect(esteConexiunePierduta(Object.assign(new Error('sintaxă'), { code: '42601' }))).toBe(false)
    expect(esteConexiunePierduta(undefined)).toBe(false)
  })
})

describe('dbPool — opțiunile pool-ului', () => {
  it('Postgres local / sslmode=disable merge fără TLS', () => {
    expect(optiuniPool('postgres://u:p@localhost:5432/k').ssl).toBe(false)
    expect(optiuniPool('postgres://u:p@db.intern:5432/k?sslmode=disable').ssl).toBe(false)
  })

  it('orice altă țintă primește TLS (certificat self-signed acceptat)', () => {
    expect(optiuniPool('postgres://u:p@gazda.externa:5432/k').ssl).toEqual({ rejectUnauthorized: false })
  })

  it('conexiunile se reciclează și au timeout-uri (nu trăiesc la infinit)', () => {
    const o = optiuniPool('postgres://u:p@localhost:5432/k')
    expect(o.max).toBeGreaterThan(0)
    expect(o.idleTimeoutMillis).toBeGreaterThan(0)
    expect(o.connectionTimeoutMillis).toBeGreaterThan(0)
    expect(o.statement_timeout).toBeGreaterThan(0)
    expect(o.lock_timeout).toBeGreaterThan(0)
    expect(o.idle_in_transaction_session_timeout).toBeGreaterThan(0)
    expect(o.query_timeout).toBeGreaterThan(0)
    expect(o.maxLifetimeSeconds).toBeGreaterThan(0)
    expect(o.keepAlive).toBe(true)
  })
})

describe('dbPool — pool-ul are ureche pe „error" (regresia care ucidea procesul)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(async () => {
    await inchidePool()
    vi.restoreAllMocks()
  })

  it('o eroare emisă de pool NU mai aruncă, doar se notează', () => {
    const pool = getPool()
    expect(pool.listenerCount('error')).toBeGreaterThan(0)
    const inainte = starePool().conexiuniPierdute
    expect(() =>
      pool.emit('error', new Error('terminating connection due to administrator command'), {} as pg.PoolClient),
    ).not.toThrow()
    expect(starePool().conexiuniPierdute).toBe(inainte + 1)
  })
})

/** Client fals, cât să verificăm îmbrăcarea împrumutului fără Postgres. */
function clientFals(): pg.PoolClient & { eliberari: Array<Error | undefined> } {
  const c = new EventEmitter() as unknown as pg.PoolClient & { eliberari: Array<Error | undefined> }
  c.eliberari = []
  c.release = ((err?: Error) => {
    c.eliberari.push(err)
  }) as pg.PoolClient['release']
  return c
}

describe('dbPool — clientul împrumutat e acoperit pe toată durata împrumutului', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('o eroare între două query-uri nu mai urcă necuprinsă', () => {
    const c = clientFals()
    imbracaClientImprumutat(c)
    expect(() => c.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow()
  })

  it('clientul rupt e predat pool-ului CU eroarea (deci distrus, nu reciclat)', () => {
    const c = clientFals()
    imbracaClientImprumutat(c)
    c.emit('error', new Error('terminating connection due to administrator command'))
    c.release()
    expect(c.eliberari).toHaveLength(1)
    expect(c.eliberari[0]).toBeInstanceOf(Error)
  })

  it('un client sănătos se eliberează curat, o singură dată', () => {
    const c = clientFals()
    imbracaClientImprumutat(c)
    c.release()
    c.release()
    expect(c.eliberari).toEqual([undefined])
  })

  it('după eliberare, urechea e scoasă (nu ținem ascultători pe clienți reciclați)', () => {
    const c = clientFals()
    imbracaClientImprumutat(c)
    expect(c.listenerCount('error')).toBe(1)
    c.release()
    expect(c.listenerCount('error')).toBe(0)
  })
})
