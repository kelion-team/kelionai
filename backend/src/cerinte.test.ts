// ── EVALUATING SOLUTIONS: the choice must not be a whim ───────────────────
//
// Adrian, Jul 30: "advanced evaluations of the offered solutions" · "the
// analysis and continuous improvement of the implementation possibilities".
//
// Why a CALCULATED score is needed, not "the model says this one is better":
// today I chose the wrong road three times, from the gut — email, then a
// portal with an expiring consent, then an API that doesn't exist for his
// account. Every time a better variant was on the table; nobody laid them
// side by side.
//
// The weights say what matters in THIS project, in the order the owner said
// them: SOLVE it, don't ask HIM for time, don't break what works, be fast,
// don't cost. The test guards exactly that order — if someone changes it in
// secret, the choices move and nobody sees why.
import { describe, it, expect } from 'vitest'
import { scor, alege, type Varianta } from './services/cerinte.js'

const v = (nume: string, p: Partial<Varianta>): Varianta => ({
  nume,
  cum: '…',
  rezolva: 5,
  rapid: 5,
  sigur: 5,
  ieftin: 5,
  independent: 5,
  risc: 'necunoscut',
  ...p,
})

describe('evaluarea soluțiilor', () => {
  it('„rezolvă complet" cântărește cel mai mult — altfel n-are rost', () => {
    const completa = v('rezolvă tot', { rezolva: 10 })
    const frumoasa = v('elegantă dar parțială', { rezolva: 4, rapid: 10, ieftin: 10, sigur: 10 })
    expect(scor(completa)).toBeGreaterThan(scor(frumoasa))
  })

  it('o soluție care cere timpul ownerului pierde în fața uneia care nu-i cere', () => {
    // The lesson of the day: "don't send him through portals" — he lost a day that way.
    const cereOmului = v('portal manual', { rezolva: 9, independent: 1 })
    const singura = v('o face el', { rezolva: 9, independent: 10 })
    expect(scor(singura)).toBeGreaterThan(scor(cereOmului))
  })

  it('alege câștigătoarea ȘI spune de ce, comparând cu a doua', () => {
    const r = alege([v('A', { rezolva: 9, independent: 9 }), v('B', { rezolva: 4 })])!
    expect(r.castigatoare.nume).toBe('A')
    expect(r.motiv).toContain('bate')
    expect(r.motiv).toContain('B')
    expect(r.motiv).toContain('Risc') // the risk is not hidden
  })

  it('cu o singură variantă spune limpede că a fost singura — nu se laudă cu o alegere', () => {
    const r = alege([v('singura', {})])!
    expect(r.motiv).toContain('singura variantă')
  })

  it('fără variante nu inventează una', () => {
    expect(alege([])).toBeNull()
  })

  it('note stricate (negative, peste 10, lipsă) nu pot umfla scorul', () => {
    const trisor = v('trișorul', { rezolva: 999, independent: -50 } as Partial<Varianta>)
    expect(scor(trisor)).toBeLessThanOrEqual(10)
    expect(scor(trisor)).toBeGreaterThanOrEqual(0)
  })
})
