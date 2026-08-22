// ── M5: PROBA CAP-COADĂ A BANILOR — cod → plată → credit, EXACT o dată ─────
//
// Proba autonomiei, în cuvintele lui Adrian: „un user plătește și primește
// creditele fără ca cineva să miște un deget". Până azi (2 aug) testul ăsta NU
// exista — ce purta numele fluxului (fluxPlati.test.ts) citea SURSA și verifica
// că verigile sunt NUMITE, nu că banii curg. Aici banii chiar curg, prin
// funcțiile REALE (creeazaCodPlata → proceseazaIntrare → topUpUser), pe motorul
// fake-pg (BEGIN/ROLLBACK reale, indexuri unice reale — vezi db.bani.test.ts).
//
// Tot aici se probează PLASA (M2): o intrare fără cod sau cu cod greșit ajunge
// în `plati_neatribuite` — nu dispare — exact o dată, oricâte citiri o revăd;
// iar atribuirea manuală creditează prin ACEEAȘI cale idempotentă.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { creeazaFakePg } from './testing/fake-pg.js'

const pgFals = vi.hoisted(() => {
  const cutie: { motor: ReturnType<typeof import('./testing/fake-pg.js').creeazaFakePg> | null } = { motor: null }
  return cutie
})

// Dublură fidelă: pg.Pool și clientul împrumutat sunt EventEmitter-e (dbPool.ts
// pune ureche pe „error" pe amândouă).
vi.mock('pg', async () => {
  const { EventEmitter } = await import('node:events')
  const query = (sql: string, params?: unknown[]) => pgFals.motor!.query(sql, params)
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
    enableBanking: { appId: '', privateKeyB64: '', accountUid: '', aspspName: '', aspspCountry: '' },
  },
}))

const motor = creeazaFakePg()
pgFals.motor = motor

const { creeazaCodPlata, atribuiePlataNeatribuita, listeazaPlatiNeatribuite, rezumatPlati } = await import('./db.js')
const { proceseazaIntrare } = await import('./services/openBanking.js')

const sold = (email: string): number => motor.baza.wallets.get(email.toLowerCase())?.balance ?? 0

beforeEach(() => motor.reset())

describe('M5 — fluxul fericit: cod emis → plată cu cod → credit exact', () => {
  it('creditează 75% din sumă, o singură dată, și închide codul', async () => {
    const cod = await creeazaCodPlata('ana@test.ro', 20)
    expect(cod).not.toBeNull()

    // The bank reference arrives glued to other text, lowercase — the real shape.
    const r = await proceseazaIntrare({
      id: 'tx-100',
      referinta: `Top up kelion ${cod!.code.toLowerCase()}`,
      amount: 20,
      currency: 'gbp',
    })
    expect(r).toEqual({ fel: 'creditat', email: 'ana@test.ro' })
    expect(sold('ana@test.ro')).toBeCloseTo(15, 6) // 75% din £20
    expect(motor.baza.coduri[0].status).toBe('paid')
    expect(motor.baza.coduri[0].bank_ref).toBe('tx-100')
    expect(motor.baza.neatribuite).toHaveLength(0) // nimic în plasă
  })

  it('ACEEAȘI tranzacție recitită NU creditează a doua oară și NU intră în plasă', async () => {
    const cod = await creeazaCodPlata('ana@test.ro', 20)
    const t = { id: 'tx-101', referinta: `plata ${cod!.code}`, amount: 20, currency: 'gbp' }
    await proceseazaIntrare(t)
    // The 5-minute reader re-sees the same transaction on every pass, forever.
    const aDoua = await proceseazaIntrare(t)
    expect(aDoua).toEqual({ fel: 'vechi' })
    expect(sold('ana@test.ro')).toBeCloseTo(15, 6) // nu 30
    // Fără garda `refCreditatDeja`, plata REUȘITĂ ar fi reapărut aici ca
    // „problemă" la fiecare trecere — plasa rămâne goală.
    expect(motor.baza.neatribuite).toHaveLength(0)
  })
})

describe('M2 — plasa: ce nu se potrivește NU dispare', () => {
  it('plata fără cod ajunge în plasă, exact o dată, oricâte citiri o revăd', async () => {
    const t = { id: 'tx-200', referinta: 'transfer de la mama', amount: 50, currency: 'gbp' }
    expect(await proceseazaIntrare(t)).toEqual({ fel: 'plasa' })
    expect(await proceseazaIntrare(t)).toEqual({ fel: 'vechi' }) // ON CONFLICT
    const plasa = await listeazaPlatiNeatribuite()
    expect(plasa).toHaveLength(1)
    expect(plasa[0].amount).toBeCloseTo(50, 6)
    expect(plasa[0].referinta).toBe('transfer de la mama')
  })

  it('codul GREȘIT (formă KLN dar inexistent) ajunge tot în plasă', async () => {
    const r = await proceseazaIntrare({ id: 'tx-201', referinta: 'KLN-XXXX-YYYY', amount: 10, currency: 'gbp' })
    expect(r).toEqual({ fel: 'plasa' })
    expect(await listeazaPlatiNeatribuite()).toHaveLength(1)
  })

  it('atribuirea manuală creditează EXACT o dată, prin aceeași cale idempotentă', async () => {
    await proceseazaIntrare({ id: 'tx-202', referinta: 'fara cod', amount: 40, currency: 'gbp' })
    const [rand] = await listeazaPlatiNeatribuite()

    expect(await atribuiePlataNeatribuita(rand.id, 'ion@test.ro')).toBe('creditat')
    expect(sold('ion@test.ro')).toBeCloseTo(30, 6) // 75% din £40
    expect(await listeazaPlatiNeatribuite()).toHaveLength(0) // rândul s-a închis

    // A doua atribuire pe același rând: nu mai există unul deschis.
    expect(await atribuiePlataNeatribuita(rand.id, 'alt@test.ro')).toBe('negasit')
    // Și chiar dacă aceeași tranzacție ar reintra pe calea automată, ledger-ul
    // o refuză (ref unic) — soldul nu se mișcă.
    expect(sold('ion@test.ro')).toBeCloseTo(30, 6)
  })
})

describe('M3 — rezumatul e o numărătoare din bază, nu o afirmație', () => {
  it('numără emise/plătite/în așteptare/plasă exact', async () => {
    const c1 = await creeazaCodPlata('ana@test.ro', 20)
    await creeazaCodPlata('ion@test.ro', 30) // rămâne pending
    await proceseazaIntrare({ id: 'tx-300', referinta: c1!.code, amount: 20, currency: 'gbp' })
    await proceseazaIntrare({ id: 'tx-301', referinta: 'fara cod', amount: 5, currency: 'gbp' })

    const r = await rezumatPlati()
    expect(r).not.toBeNull()
    expect(r!.emise).toBe(2)
    expect(r!.platite).toBe(1)
    expect(r!.inAsteptare).toBe(1)
    expect(r!.neatribuite).toBe(1)
    expect(r!.recente[0].code).toBeTruthy()
  })
})
