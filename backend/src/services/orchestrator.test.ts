import { describe, expect, it } from 'vitest'
import { executaApeluriCoordonate, iesireEsteEroare, pasProgres, stareProgresInitiala } from './orchestrator.js'

describe('garda de progres (fail-fast pe erori, nu 65s de măcinat)', () => {
  it('recunoaște ieșirile de eroare, nu confundă succesul cu eroarea', () => {
    expect(iesireEsteEroare('tool_error: boom')).toBe(true)
    expect(iesireEsteEroare('{"ok":false,"why":"x"}')).toBe(true)
    expect(iesireEsteEroare('{"error":"bad sql"}')).toBe(true)
    expect(iesireEsteEroare('Error: nope')).toBe(true)
    expect(iesireEsteEroare('{"ok":true,"rows":3}')).toBe(false)
    expect(iesireEsteEroare('rezultat normal')).toBe(false)
  })

  it('oprește după 2 runde consecutive numai cu erori', () => {
    let st = stareProgresInitiala()
    let r = pasProgres(st, ['db_query'], ['tool_error: bad sql'])
    expect(r.stop).toBeNull() // prima rundă cu erori: încă nu oprim
    st = r.st
    r = pasProgres(st, ['constructor_command'], ['tool_error: exit 1'])
    expect(r.stop).toMatch(/runde consecutive/) // a doua la rând → stop
  })

  it('o rundă cu progres real resetează contorul de runde-eroare', () => {
    let st = stareProgresInitiala()
    st = pasProgres(st, ['db_query'], ['tool_error: x']).st // 1 rundă eroare
    st = pasProgres(st, ['db_query'], ['{"ok":true}']).st // progres → reset
    const r = pasProgres(st, ['db_query'], ['tool_error: y']) // iar 1 eroare
    expect(r.stop).toBeNull() // nu 2 la rând (a fost reset) → nu oprim
  })

  it('oprește dacă ACEEAȘI unealtă eșuează de 3× în tură (chiar cu narațiune între)', () => {
    let st = stareProgresInitiala()
    // Între erorile pe db_query intervin runde cu succes pe altă unealtă (nu resetează
    // contorul PER-UNEALTĂ, doar pe cel de runde-numai-erori).
    st = pasProgres(st, ['db_query', 'system_health'], ['tool_error: a', '{"ok":true}']).st
    st = pasProgres(st, ['db_query', 'system_health'], ['tool_error: b', '{"ok":true}']).st
    const r = pasProgres(st, ['db_query'], ['tool_error: c'])
    expect(r.stop).toMatch(/db_query.*3×/)
  })
})

describe('executaApeluriCoordonate', () => {
  it('păstrează ordinea efectelor din același grup', async () => {
    const ordine: string[] = []
    const rezultat = await executaApeluriCoordonate(
      ['scriere-1', 'scriere-2'],
      () => 'efect',
      async (apel) => {
        ordine.push(`start:${apel}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        ordine.push(`end:${apel}`)
        return apel
      },
    )
    expect(rezultat).toEqual(['scriere-1', 'scriere-2'])
    expect(ordine).toEqual(['start:scriere-1', 'end:scriere-1', 'start:scriere-2', 'end:scriere-2'])
  })

  it('nu introduce latență artificială între citirile independente', async () => {
    let active = 0
    let maxim = 0
    await executaApeluriCoordonate(
      ['citire-1', 'citire-2'],
      () => undefined,
      async () => {
        active += 1
        maxim = Math.max(maxim, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return 'ok'
      },
    )
    expect(maxim).toBe(2)
  })
})
