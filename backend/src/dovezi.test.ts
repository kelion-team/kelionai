import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dovezileAutonomiei } from './services/dovezi.js'

// ── LACĂTUL DOVEZILOR DE AUTONOMIE (Adrian, 5 aug) ───────────────────────────
// „după ce e 100%, nimic dar absolut nimic și nimeni să nu mai poată modifica
// asta". Paznicul ăsta rulează în porți pe ORICE PR: dacă cineva — om, AI sau
// constructorul însuși — slăbește criteriile, șterge un nivel sau scoate
// persistența consemnărilor, poarta PICĂ. Bifele nu se pun din pix și nu se
// șterg pe tăcute: și-au primit lacăt.
const SRC = readFileSync(fileURLToPath(new URL('./services/dovezi.ts', import.meta.url)), 'utf8')

describe('dovezi — lacătul celor 8 dovezi de autonomie', () => {
  it('scala are EXACT 8 niveluri, 1..8, fiecare cu înțeles și criteriu scrise', async () => {
    const r = await dovezileAutonomiei()
    expect(r.din).toBe(8)
    expect(r.dovezi.map((d) => d.nivel)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    for (const d of r.dovezi) {
      expect(d.ce, `nivel ${d.nivel} fără înțeles`).toBeTruthy()
      expect(d.cum, `nivel ${d.nivel} fără criteriu scris DINAINTE`).toBeTruthy()
    }
  })

  it('înțelesul nivelurilor e cel stabilit de owner — nu se rescrie ca să fie mai ușor', () => {
    // Ancorele scalei din 30-31 iul: cine schimbă un nivel ca să-l bifeze mai
    // ieftin pică AICI, la vedere, nu pe tăcute.
    for (const ancora of [
      'duce o sarcină întreagă la ordin',
      'pornește singur',
      'se repară singur',
      'își face singur setările',
      'se verifică singur pe live',
      'vede ce îi lipsește și construiește',
      'își reanalizează soluțiile livrate',
      'lanțul ÎNTREG, fără nicio atingere de om',
    ]) {
      expect(SRC, `nivelul „${ancora}" a dispărut sau a fost rescris`).toContain(ancora)
    }
  })

  it('criteriile stau pe URME reale (PR, autor-buclă, reîncercare, verificare), nu pe afirmații', () => {
    expect(SRC).toContain('prUrl') // nivelul 1: ordin terminat CU PR
    expect(SRC).toContain('attempts > 1') // nivelul 3: reușit din a doua încercare
    expect(SRC).toContain("startsWith('kelion')") // nivelurile 2/7: autorul e bucla, nu un om
    expect(SRC).toContain('verificata') // nivelul 5: cerință VERIFICATĂ, cu măsurătoarea ei
  })

  it('o dovadă întâmplată NU se dez-întâmplă: persistența consemnărilor există și nu se șterge', () => {
    // Mecanismul din 5 aug („a avut 3 bifate, acum are doar 1"): consemnarea
    // permanentă în kv a fiecărei dovezi găsite. Cine o scoate, pică poarta.
    expect(SRC).toContain('autonomie:dovada:')
    expect(SRC).toContain('saveKv')
    expect(SRC).toContain('urmă consemnată la')
  })

  it('nicăieri în backend nu se șterg consemnările dovezilor', () => {
    // Plasa contra ștergerii „din greșeală" (curățenii, migrări): singurul loc
    // unde cheia consemnărilor are voie să apară e dovezi.ts (+ testul ăsta).
    const surse = ['db.ts', 'routes/admin.ts', 'services/autonomie.ts', 'services/health.ts']
    for (const f of surse) {
      const s = readFileSync(fileURLToPath(new URL(`./${f}`, import.meta.url)), 'utf8')
      const foloseste = s.includes('autonomie:dovada:')
      expect(foloseste, `${f} umblă la consemnările dovezilor — interzis`).toBe(false)
    }
  })
})
