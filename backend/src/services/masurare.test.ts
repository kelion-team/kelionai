import { describe, it, expect } from 'vitest'
import { masoara, raport, raportPorti, compara, PORTI, type RezultatPoarta } from './masurare.js'

// ── GARANȚIA CENTRALĂ ────────────────────────────────────────────────────────
// Regula #1 a fost încălcată de trei ori într-o singură zi, mereu la fel: o
// CITIRE PICATĂ prezentată ca FAPT. Aici se probează că forma asta nu mai e
// posibilă — nu fiindcă cineva promite, ci fiindcă o măsurătoare eșuată NU ARE
// valoare, iar tot ce o formatează spune „NU POT VERIFICA".

describe('sistemul de măsurare — o citire picată nu poate deveni un număr', () => {
  it('măsurătoarea reușită are valoare; cea picată NU are câmpul deloc', async () => {
    const bun = await masoara('probă bună', async () => 42)
    expect(bun.masurat).toBe(true)
    if (bun.masurat) expect(bun.valoare).toBe(42)

    const rau = await masoara('probă picată', async () => {
      throw new Error('rețea căzută')
    })
    expect(rau.masurat).toBe(false)
    // Nu e „valoare 0" și nici „valoare null" — câmpul lipsește cu totul.
    expect('valoare' in rau).toBe(false)
    if (!rau.masurat) expect(rau.motiv).toContain('rețea căzută')
  })

  it('raportul unei măsurători picate spune „NU POT VERIFICA", fără nicio cifră de rezultat', async () => {
    const rau = await masoara('GET /api/sold', async () => {
      throw new Error('HTTP 500')
    })
    const text = raport(rau)
    expect(text).toContain('NU POT VERIFICA')
    expect(text).toContain('HTTP 500')
    // Exact capcana din 30 iul: „£0.00" scris când cererea picase.
    expect(text).not.toMatch(/[£$]\s?0([.,]00)?\b/)
    expect(text).not.toMatch(/\bnecreat\b/)
  })

  it('nu se compară cu o măsurătoare care n-a reușit', async () => {
    const bun = await masoara('latență', async () => 100)
    const rau = await masoara('latență', async () => {
      throw new Error('timeout')
    })
    expect(compara(rau, bun)).toContain('nu pot compara')
    expect(compara(bun, rau)).toContain('nu pot compara')
    // Amândouă reușite → diferență reală, cu procent.
    const dupa = await masoara('latență', async () => 60)
    const t = compara(bun, dupa)
    expect(t).toContain('100 → 60')
    expect(t).toContain('-40')
  })

  it('o eroare fără mesaj tot devine motiv, nu valoare', async () => {
    const rau = await masoara('ceva', async () => {
      throw 'ceva ciudat'
    })
    expect(rau.masurat).toBe(false)
    if (!rau.masurat) expect(rau.motiv).toContain('ciudat')
  })
})

describe('porțile — „nu pot verifica" nu se amestecă niciodată cu „trece"', () => {
  const r = (poarta: string, stare: RezultatPoarta['stare'], extra = 'x'): RezultatPoarta =>
    stare === 'NU POT VERIFICA'
      ? { poarta, stare, ms: 1, motiv: extra }
      : { poarta, stare, ms: 1, iesire: extra }

  it('o poartă nemăsurată face verdictul INCOMPLET, nu TRECE', () => {
    const text = raportPorti([r('tipuri', 'TRECE'), r('teste', 'NU POT VERIFICA', 'vitest: ENOENT')])
    expect(text).toContain('NU POT VERIFICA')
    expect(text).toContain('INCOMPLET')
    expect(text).toContain('NU pot spune că e bine')
    // Verdictul final NU are voie să fie „TRECE" când ceva n-a fost măsurat.
    expect(text).not.toMatch(/VERDICT: TRECE/)
  })

  it('o poartă picată dă PICĂ (verdict real), distinct de nemăsurat', () => {
    const text = raportPorti([r('tipuri', 'TRECE'), r('teste', 'PICĂ', '3 failed')])
    expect(text).toMatch(/VERDICT: PICĂ/)
    expect(text).not.toContain('INCOMPLET')
  })

  it('toate trecute → TRECE', () => {
    const text = raportPorti([r('tipuri', 'TRECE'), r('teste', 'TRECE')])
    expect(text).toMatch(/VERDICT: TRECE/)
  })

  it('porțile lui Kelion sunt exact cele pe care le rulează și omul, cu nume unice', () => {
    const nume = PORTI.map((p) => p.nume)
    expect(new Set(nume).size).toBe(nume.length)
    for (const cerut of ['tipuri', 'teste', 'lacat-gemini', 'exporturi', 'sintaxa', 'build-frontend']) {
      expect(nume).toContain(cerut)
    }
  })
})
