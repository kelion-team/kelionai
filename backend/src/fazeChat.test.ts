import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fazaTurei, permisaLaVorbire, UNELTE_VORBIRE, INTERZISE_LA_VORBIRE } from './services/fazeChat.js'

// ── TURA PE FAZE (Adrian, 8 aug 2026) ──────────────────────────────────────
//
// Ordinul, verbatim: „chatul este doar chat, depistarea cerinței este
// depistarea cerinței, decizia ce unealtă se face cu creierul, aplicarea și
// măsurarea rezultatelor, deploy dacă e cazul" + „orice chat trebuie să fie
// default chat, fără să poarte nimic cu el".
//
// Verdictul de fază e o funcție PURĂ — deci se probează pe cazurile reale, fără
// rețea, fără model, fără bază de date. Asta e și motivul pentru care a fost
// scoasă din mijlocul rutei: acolo nu se putea rula pe nimic.

describe('ce fază e tura — probat pe cazurile reale', () => {
  const de_baza = { text: '', areAudio: false, areImagine: false, cereActiune: false }

  it('conversație simplă → VORBIRE, fără instrucțiuni de lucru', () => {
    const r = fazaTurei({ ...de_baza, text: 'cât e ceasul?' })
    expect(r.faza).toBe('vorbire')
    expect(r.instructiuniDeLucru, 'regulamentul de reparat cod nu are ce căuta la „cât e ceasul"').toBe(false)
  })

  it('FRAZĂ ROSTITĂ → tot VORBIRE: are de DECIS dacă i se vorbește, nu de executat', () => {
    // Cazul cel mai ușor de greșit. O tură vocală pare „specială", dar decizia
    // „mi se vorbește mie?" e o judecată, nu o execuție — deci nu cară unelte.
    const r = fazaTurei({ ...de_baza, areAudio: true })
    expect(r.faza).toBe('vorbire')
    expect(r.instructiuniDeLucru).toBe(false)
    expect(r.motiv).toContain('nu cară nimic')
  })

  it('cerere de acțiune → DECIZIE, cu tot inventarul și instrucțiunile de lucru', () => {
    const r = fazaTurei({ ...de_baza, text: 'repară ruta de plăți', cereActiune: true })
    expect(r.faza).toBe('decizie')
    expect(r.instructiuniDeLucru).toBe(true)
  })

  it('creierul a escaladat singur (ask_brain) → DECIZIE', () => {
    const r = fazaTurei({ ...de_baza, aEscaladat: true })
    expect(r.faza).toBe('decizie')
    expect(r.instructiuniDeLucru).toBe(true)
  })

  it('tura poartă o imagine → DECIZIE (vederea se folosește ca să FACĂ ceva)', () => {
    expect(fazaTurei({ ...de_baza, areImagine: true }).faza).toBe('decizie')
  })

  it('fiecare verdict spune DE CE — altfel nu se poate contesta', () => {
    for (const t of [
      { ...de_baza },
      { ...de_baza, areAudio: true },
      { ...de_baza, cereActiune: true },
      { ...de_baza, areImagine: true },
      { ...de_baza, aEscaladat: true },
    ]) {
      expect(fazaTurei(t).motiv.length).toBeGreaterThan(20)
    }
  })
})

describe('faza de vorbire nu cară nimic scump', () => {
  it('cele opt secunde: system_health e INTERZIS pe drumul unei fraze', () => {
    // Măsurat în cod: `system_health` face 2 apeluri la GitHub (timeout 10 s)
    // ȘI sondează endpointul fiecărui buton din Admin (timeout 8 s, în paralel)
    // — ~8 s în cel mai rău caz. Exact cifra reclamată de owner.
    expect(permisaLaVorbire('system_health')).toBe(false)
    for (const scump of INTERZISE_LA_VORBIRE) {
      expect(permisaLaVorbire(scump), `„${scump}" a scăpat pe faza de vorbire`).toBe(false)
    }
  })

  it('ușa spre restul RĂMÂNE deschisă — fără ea, faza de vorbire ar fi o cușcă', () => {
    expect(permisaLaVorbire('ask_brain'), 'fără ask_brain, ce nu e în listă n-ar mai putea fi cerut deloc').toBe(true)
    expect(UNELTE_VORBIRE.includes('ask_brain')).toBe(true)
  })

  it('lista de vorbire e SCURTĂ și nu se intersectează cu cea interzisă', () => {
    expect(UNELTE_VORBIRE.length).toBeLessThanOrEqual(14)
    for (const u of UNELTE_VORBIRE) {
      expect(INTERZISE_LA_VORBIRE.includes(u), `„${u}" e și permisă și interzisă — listele s-au contrazis`).toBe(false)
    }
  })

  it('o unealtă necunoscută NU trece implicit (lista e albă, nu neagră)', () => {
    // Dacă mâine apare o unealtă nouă și scumpă, ea NU are voie să intre pe
    // drumul unei fraze doar fiindcă nimeni n-a apucat s-o pună pe lista neagră.
    expect(permisaLaVorbire('o_unealta_noua_si_scumpa')).toBe(false)
  })
})

describe('ruta chiar folosește modulul — nu are propria copie a listei', () => {
  const chat = fs.readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')

  it('faza se cere din fazeChat.ts, nu se recalculează în rută', () => {
    expect(/fazaTurei\(\{/.test(chat), 'ruta își face iar propriul verdict de fază').toBe(true)
    expect(/const turaUsoara = incarcatura\.faza === 'vorbire'/.test(chat)).toBe(true)
  })

  it('uneltele se filtrează prin gardul comun, nu printr-o listă locală', () => {
    expect(/permisaLaVorbire\(t\.name\)/.test(chat)).toBe(true)
    expect(
      /const UNELTE_CONVERSATIE = new Set/.test(chat),
      'a rămas o a doua listă în rută — două liste diverg, iar prima care divergea tăcut lăsa system_health înapoi',
    ).toBe(false)
  })

  it('faza se scrie în jurnal, cu motivul ei', () => {
    expect(/\[FAZĂ\]/.test(chat), 'nu se vede din log pe ce fază a mers tura').toBe(true)
    expect(/incarcatura\.motiv/.test(chat)).toBe(true)
  })
})
