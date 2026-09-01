// ── P8: NUMELE ORDINULUI = FAPTA, PE ȘABLOANELE REALE ───────────────────────
// (owner, 15 aug, cu #306 în față: „nu apare sugestiv ce face, trebuie sa fie
// foarte clar ce executa"). Testele rulează EXACT formele de ordin pe care le
// produc cerințele și ordinele directe —
// dacă un șablon se schimbă și fapta nu se mai extrage, pică aici, nu în
// panoul ownerului.
import { describe, expect, it } from 'vitest'
import { numeleOrdinului } from './services/numeOrdin.js'

describe('numele ordinului e fapta, nu ambalajul', () => {
  it('cerință (forma #306): fapta vine din „CE A CERUT", nu din pin', () => {
    const ordin =
      `NIVEL DE DIFICULTATE: 3/5\n\n` +
      `CERINȚA OWNERULUI #34. Ai analizat-o deja și ai ALES un drum — ăsta e.\n\n` +
      `CE A CERUT: Opțiuni schimbare limbă bara admin\n\n` +
      `VARIANTA ALEASĂ DE TINE, ȘI DE CE:\nselector compact\n\n` +
      `Fă-o cap-coadă...`
    expect(numeleOrdinului(ordin)).toBe('Opțiuni schimbare limbă bara admin')
  })

  it('gol de capabilitate: fapta e ce a cerut omul, fără ghilimele', () => {
    const ordin =
      `NIVEL DE DIFICULTATE: 4/5\n\n` +
      `CAPABILITATE CARE ÎȚI LIPSEȘTE — ai marcat-o TU „de implementat", nimeni nu ți-a cerut-o acum.\n\n` +
      `CE A CERUT OMUL ȘI N-AI PUTUT FACE: "să pot exporta conversațiile"\n` +
      `De câte ori s-a cerut: 3.\n`
    expect(numeleOrdinului(ordin)).toBe('să pot exporta conversațiile')
  })

  it('ordin direct al ownerului: chiar vorbele lui, fără dificultate în față', () => {
    expect(numeleOrdinului('NIVEL DE DIFICULTATE: 2/5\n\nrepară butonul de mute de pe mobil')).toBe(
      'repară butonul de mute de pe mobil',
    )
  })

  it('reluare cu escaladare: ambalajul „AI ÎNCERCAT DEJA" nu ajunge nume', () => {
    const ordin =
      `NIVEL DE DIFICULTATE: 3/5\n\n` +
      `⚠ AI ÎNCERCAT DEJA DE 2 ORI ȘI N-A IEȘIT. SCRIE ÎNTÂI CE FACI ALTFEL — SCHIMBĂ METODA.\n\n` +
      `CERINȚA OWNERULUI #34. Pinul vechi a fost înlocuit.\n\n` +
      `CE A CERUT: Opțiuni schimbare limbă bara admin\n`
    expect(numeleOrdinului(ordin)).toBe('Opțiuni schimbare limbă bara admin')
  })

  it('numele e scurt (≤110) și pe un singur rând, oricât de lung e ordinul', () => {
    const lung = `CE A CERUT: ${'vorbă '.repeat(60)}\n\nrest`
    const nume = numeleOrdinului(lung)
    expect(nume.length).toBeLessThanOrEqual(110)
    expect(nume.includes('\n')).toBe(false)
  })
})
