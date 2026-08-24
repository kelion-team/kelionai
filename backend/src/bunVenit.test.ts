import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GUSTAREA GRATIS (owner, 14 aug: „e o afacere până la urmă") ──────────────
// Zidul de plată există; testele de aici țin promisiunile CADOULUI: o singură
// dată per cont, mărime reglabilă (0 = oprit), ownerul nu primește, iar semnul
// se scrie DOAR după ce creditul chiar a intrat.

const kv = new Map<string, string>()
const acordate: { email: string; sumaMinor: number; ref: string }[] = []

vi.mock('./db.js', () => ({
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => {
    kv.set(k, v)
  },
  grantCreditMinor: async (email: string, sumaMinor: number, ref: string) => {
    acordate.push({ email, sumaMinor, ref })
    return true
  },
}))

import { acordaBunVenit, crediteBunVenit } from './services/bunVenit.js'
import { config } from './config.js'

beforeEach(() => {
  kv.clear()
  acordate.length = 0
  delete process.env.CREDITE_BUN_VENIT
})

describe('creditul de bun-venit — o gustare, nu un robinet', () => {
  it('prima venire → primește creditele implicite (3), cu semn scris', async () => {
    const dat = await acordaBunVenit('client@example.com')
    expect(dat).toBe(true)
    expect(acordate).toHaveLength(1)
    expect(acordate[0].sumaMinor).toBe(3 * config.billing.creditMinor)
    expect(acordate[0].ref).toBe('welcome:client@example.com')
    expect(kv.has('bunvenit:client@example.com')).toBe(true)
  })

  it('a doua venire → NIMIC (o dată per cont, pe veci)', async () => {
    await acordaBunVenit('client@example.com')
    const aDoua = await acordaBunVenit('client@example.com')
    expect(aDoua).toBe(false)
    expect(acordate).toHaveLength(1)
  })

  it('CREDITE_BUN_VENIT=0 → cadoul e OPRIT complet', async () => {
    process.env.CREDITE_BUN_VENIT = '0'
    expect(crediteBunVenit()).toBe(0)
    const dat = await acordaBunVenit('altcineva@example.com')
    expect(dat).toBe(false)
    expect(acordate).toHaveLength(0)
  })

  it('mărimea e reglabilă din env, fără deploy', async () => {
    process.env.CREDITE_BUN_VENIT = '10'
    await acordaBunVenit('generos@example.com')
    expect(acordate[0].sumaMinor).toBe(10 * config.billing.creditMinor)
  })

  it('ownerul NU primește cadou (e scutit de plată oricum)', async () => {
    const dat = await acordaBunVenit(config.adminEmail)
    expect(dat).toBe(false)
    expect(acordate).toHaveLength(0)
  })

  it('email gol → nimic, fără aruncat', async () => {
    expect(await acordaBunVenit('')).toBe(false)
  })
})
