import { describe, it, expect } from 'vitest'
import { crediteAI } from './services/creditAI.js'

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
