import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── USERUL PLĂTITOR NU VEDE NICIODATĂ MODELE / PLAFOANE / BANI ─────────────
//
// Adrian, Aug 1: "mesajul asta nu trebuie sa apara nici o data la useri
// platitori" + "userul free plateste la aplicatie, prin credite […] lui
// trebuie sa functioneze permanent fara mesaje de genul acela".
//
// REGULA: erorile creierului (429 rate-limit, 402 fonduri, model mort,
// răspuns gol) se absorb prin ROTIRE SILENȚIOASĂ în pool-ul de modele free
// din catalogul live. Userul aude un mesaj NEUTRU ("încearcă din nou") ABIA
// dacă tot pool-ul pică. Detaliile tehnice rămân doar în logul serverului.
//
// Testul citește codul REAL. Dacă cineva repune un mesaj despre modele /
// plafon / bani în calea vizibilă userului, cade aici.
const sursa = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('rotirea silențioasă între modelele free', () => {
  it('parcurge pool-ul free din catalogul live', () => {
    expect(sursa).toMatch(/nextCandidate[\s\S]{0,400}getCatalog/)
    expect(sursa).toMatch(/m\.id\.endsWith\(':free'\)/)
  })

  // Adrian, Aug 1 — punga de rezervă aprobată („da"): când TOT pool-ul free
  // pică, tura trece pe cele mai ieftine modele plătite din catalog. Userul
  // NU află nimic — aplicația pur și simplu nu se oprește.
  it('după pool-ul free cade pe modelele plătite IEFTINE (punga comună)', () => {
    expect(sursa).toMatch(/classifyCost\(m\.promptPerM, m\.completionPerM\) === 'cheap'/)
    expect(sursa).toMatch(/blendedPerM\(a\.promptPerM/)
  })

  it('un model gol sau picat NU închide turul — se rotește', () => {
    expect(sursa).toMatch(/silent rotation/)
    expect(sursa).toMatch(/brain_rotation_exhausted/)
  })

  it('textul parțial ajuns la user oprește rotirea (nu dublăm răspunsul)', () => {
    expect(sursa).toMatch(/if \(textFlowed\) throw ge/)
  })
})

describe('mesajele vizibile userului sunt neutre', () => {
  it('NU există mesaje user-facing despre modele gratuite sau plafoane', () => {
    expect(sursa).not.toContain('Modelul gratuit a atins plafonul')
    expect(sursa).not.toContain('free model hit its per-minute')
  })

  it('NU există mesaje user-facing despre „creier gol" sau instrucțiuni de model/Setări', () => {
    expect(sursa).not.toContain('creierul a răspuns gol')
    expect(sursa).not.toContain('the brain returned empty')
    expect(sursa).not.toContain('schimbă modelul din Setări')
    expect(sursa).not.toContain('switch the model in Settings')
  })

  it('NU există mesaje user-facing care cer bani sau menționează creditul creierului', () => {
    expect(sursa).not.toContain('Am epuizat momentan creditul creierului')
    expect(sursa).not.toContain('run out of brain credit')
    expect(sursa).not.toContain('nu e o problemă de bani')
    expect(sursa).not.toContain('not a money problem')
  })

  it('mesajul neutru există în ambele limbi', () => {
    expect(sursa).toContain('Încearcă din nou în câteva secunde.')
    expect(sursa).toContain('Try again in a few seconds.')
  })

  it('clasificarea 429/402/refusal rămâne DOAR pentru log', () => {
    expect(sursa).toMatch(/console\.error\('\[CHAT ERROR\]'[\s\S]{0,120}isRateLimit/)
  })
})
