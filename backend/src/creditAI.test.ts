import { describe, it, expect } from 'vitest'
import { crediteAI, beculCredit, type CreditAI } from './services/creditAI.js'

// ── CREDITUL RĂMAS PE FIECARE AI, FĂRĂ ZEROURI INVENTATE (8 aug 2026) ───────
//
// Adrian: „adaugă și raportarea reală a creditului rămas pe fiecare AI".
//
// Partea grea nu e să citesc soldul de la Serper — ăla chiar se poate citi. E
// ce scriu în celulele pe care NU le pot citi: Google nu expune „cât mai ai"
// nici prin Gemini API, nici prin Cloud Billing. Acolo se năștea „£0.00".
//
// Testele rulează pe mediul de test, unde NU sunt chei de furnizor și NU e
// bază de date — adică exact situația în care un zero ar arăta cel mai
// convingător. Ce se cere aici: NICIUN rând nu are voie să întoarcă o cifră.

describe('creditul rămas pe fiecare AI', () => {
  it('acoperă toți furnizorii pe care se dau bani, nu doar pe cei ușor de citit', async () => {
    const r = await crediteAI()
    const nume = r.map((x) => x.furnizor).join(' | ')
    // Gemini și Serper aveau deja pastile în bară; Google Cloud (voce,
    // traducere, agenți) și Jules nu erau raportate NICĂIERI.
    expect(nume).toContain('Gemini')
    expect(nume).toContain('Serper')
    expect(nume).toContain('Google Cloud')
    expect(nume).toContain('Jules')
  })

  it('fără chei și fără bază de date: nicio cifră, doar motive — zero rânduri „măsurate"', async () => {
    for (const f of await crediteAI()) {
      expect(f.ramas.masurat, `„${f.furnizor}" pretinde că a măsurat un sold pe care n-avea cum să-l citească`).toBe(
        false,
      )
      // Tipul `Masuratoare` face asta imposibil de încălcat, dar gardul e aici
      // ca refacerea lui în altă formă (un `{ok, valoare}` de mână) să pice.
      expect('valoare' in f.ramas, 'o măsurătoare picată a ieșit cu o valoare lipită pe ea').toBe(false)
      expect(f.ramas.masurat === false && f.ramas.motiv.length > 10, 'motivul e prea scurt ca să ajute pe cineva').toBe(
        true,
      )
    }
  })

  it('fiecare rând spune CUM s-ar citi, ca cifra să poată fi controlată', async () => {
    for (const f of await crediteAI()) {
      expect(f.ramas.cum.length, `„${f.furnizor}" nu spune din ce ar ieși cifra`).toBeGreaterThan(15)
      expect(f.cheltuitLuna.cum.length).toBeGreaterThan(15)
    }
  })

  it('un furnizor care nu se poate citi RĂMÂNE în listă, cu motivul lui', async () => {
    // Dispariția tăcută a unui rând e tot o minciună: pagina ar arăta „tot ce
    // se vede e tot ce există". Google Cloud n-are endpoint de sold — și
    // tocmai de-aia trebuie să se vadă, cu explicația.
    const gc = (await crediteAI()).find((x) => x.furnizor.startsWith('Google Cloud'))
    expect(gc, 'furnizorul fără sold citibil a fost ascuns din raport').toBeTruthy()
    expect(gc?.facturare, 'dacă nu pot citi soldul, omul trebuie măcar trimis unde se vede factura').toContain('http')
  })
})

// ── BECUL DE CREDIT — verde/roșu/gri, ONEST (owner, 13 aug) ──────────────────
// „un bec roșu/verde care indică credit sau lipsă… 402 înseamnă că nu are credit."
// Regula #1: necunoscutul NU se maschează în verde. Probăm cele trei stări pe
// măsurători, ca becul din admin să nu poată minți.

const citit = <T>(valoare: T): CreditAI['ramas'] =>
  ({ masurat: true, cum: 'test', valoare, ms: 1, la: 'now' }) as CreditAI['ramas']
const servesteM = (da: boolean): CreditAI['serveste'] =>
  ({ masurat: true, cum: 'ping', valoare: { da }, ms: 1, la: 'now' })
const picat = (motiv: string) => ({ masurat: false as const, cum: 'test', motiv, ms: 0, la: 'now' })

function furnizor(over: Partial<CreditAI>): CreditAI {
  return {
    furnizor: 'X',
    alimenteaza: '',
    cheieConfigurata: true,
    ramas: picat('necunoscut'),
    cheltuitLuna: picat('n/a'),
    ...over,
  }
}

describe('beculCredit', () => {
  it('SOLD REAL > 0 (Serper/RunPod) → VERDE', () => {
    expect(beculCredit(furnizor({ soldReal: true, ramas: citit({ cantitate: 12.5, unitate: 'USD' }) }))).toBe('verde')
  })

  it('SOLD REAL 0 (RunPod 402 / Serper gol) → ROȘU', () => {
    expect(beculCredit(furnizor({ soldReal: true, ramas: citit({ cantitate: 0, unitate: 'USD' }) }))).toBe('rosu')
  })

  it('SOLD REAL necitibil (citirea a picat) → GRI, NU roșu fals', () => {
    expect(beculCredit(furnizor({ soldReal: true, ramas: picat('citirea a picat') }))).toBe('gri')
  })

  // BUG-UL REAL (owner, 13 aug): Gemini avea £9.59 + auto-reload ON, dar becul ieșea
  // ROȘU fiindcă estimarea „declarat − cheltuit" nu vedea top-up-ul. Fără sold real,
  // becul TREBUIE să vină din ping: servește = are credit = VERDE, nu roșu pe estimare.
  it('Gemini SERVEȘTE dar estimarea e 0 → VERDE (nu roșu fals — bug £9.59)', () => {
    expect(
      beculCredit(furnizor({ ramas: citit({ cantitate: 0, unitate: 'GBP' }), serveste: servesteM(true) })),
    ).toBe('verde')
  })

  it('Gemini NU servește (depleted) → ROȘU', () => {
    expect(beculCredit(furnizor({ ramas: picat('Google nu dă sold'), serveste: servesteM(false) }))).toBe('rosu')
  })

  it('nimic măsurabil (Google Cloud / Jules) → GRI, NU verde fals', () => {
    expect(beculCredit(furnizor({ ramas: picat('fără endpoint de sold') }))).toBe('gri')
  })
})
