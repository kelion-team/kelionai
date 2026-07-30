// ── EVALUAREA SOLUȚIILOR: alegerea nu are voie să fie o toană ────────────────
//
// Adrian, 30 iul: „evaluări avansate pe soluțiile oferite" · „analiza și
// îmbunătățirea continuă a posibilităților de implementare".
//
// De ce e nevoie de un scor CALCULAT, nu de „modelul zice că asta e mai bună":
// azi am ales de trei ori, din burtă, drumul greșit — email, apoi portal cu
// consimțământ care expiră, apoi un API care nu există pentru contul lui. De
// fiecare dată exista pe masă o variantă mai bună; nu a pus-o nimeni alături.
//
// Ponderile spun ce contează în proiectul ĂSTA, în ordinea în care le-a spus
// ownerul: să REZOLVE, să nu-i mai ceară LUI timp, să nu strice ce merge, să
// fie repede, să nu coste. Testul apără exact ordinea aia — dacă cineva o
// schimbă pe ascuns, alegerile se mută și nimeni nu vede de ce.
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
    // Lecția zilei: „nu-l trimite pe el prin portaluri" — a pierdut o zi așa.
    const cereOmului = v('portal manual', { rezolva: 9, independent: 1 })
    const singura = v('o face el', { rezolva: 9, independent: 10 })
    expect(scor(singura)).toBeGreaterThan(scor(cereOmului))
  })

  it('alege câștigătoarea ȘI spune de ce, comparând cu a doua', () => {
    const r = alege([v('A', { rezolva: 9, independent: 9 }), v('B', { rezolva: 4 })])!
    expect(r.castigatoare.nume).toBe('A')
    expect(r.motiv).toContain('bate')
    expect(r.motiv).toContain('B')
    expect(r.motiv).toContain('Risc') // riscul nu se ascunde
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
