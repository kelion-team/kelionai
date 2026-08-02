import { describe, expect, it } from 'vitest'
import { primulCastigator } from './cursa.js'

// Cursa modelelor ușoare: primul răspuns BUN câștigă, nu cel mai lent
// (măsurat live 2 aug: Promise.all ținea omul 18,6s după un concurent mort).

describe('primulCastigator — cursa se închide la primul câștigător', () => {
  it('câștigă cel rapid, fără să aștepte concurentul lent', async () => {
    const t0 = Date.now()
    const rapid = new Promise<string | null>((res) => setTimeout(() => res('rapid'), 20))
    const lent = new Promise<string | null>((res) => setTimeout(() => res('lent'), 500))
    const castigator = await primulCastigator([lent, rapid])
    expect(castigator).toBe('rapid')
    // Dovada că NU a așteptat concurentul de 500ms (marja generoasă pentru CI).
    expect(Date.now() - t0).toBeLessThan(200)
  })

  it('sare peste concurentul care întoarce null și ia primul bun', async () => {
    const gol = new Promise<string | null>((res) => setTimeout(() => res(null), 10))
    const bun = new Promise<string | null>((res) => setTimeout(() => res('bun'), 60))
    expect(await primulCastigator([gol, bun])).toBe('bun')
  })

  it('toți concurenții goli → null (calea secvențială preia tura)', async () => {
    const a = Promise.resolve<string | null>(null)
    const b = Promise.resolve<string | null>(null)
    expect(await primulCastigator([a, b])).toBeNull()
  })

  it('un concurent respins nu omoară cursa — câștigă altul', async () => {
    const picat = new Promise<string | null>((_, rej) => setTimeout(() => rej(new Error('429')), 10))
    const bun = new Promise<string | null>((res) => setTimeout(() => res('bun'), 40))
    expect(await primulCastigator([picat, bun])).toBe('bun')
  })

  it('toți respinși → null, nu excepție', async () => {
    const a = Promise.reject<string | null>(new Error('x'))
    const b = Promise.reject<string | null>(new Error('y'))
    expect(await primulCastigator([a, b])).toBeNull()
  })

  it('fără concurenți → null imediat', async () => {
    expect(await primulCastigator([])).toBeNull()
  })
})
