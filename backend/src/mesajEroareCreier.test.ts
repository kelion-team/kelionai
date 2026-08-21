import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── USERUL PLĂTITOR NU VEDE NICIODATĂ MODELE / PLAFOANE / BANI ─────────────
//
// Adrian, Aug 1: "mesajul asta nu trebuie sa apara nici o data la useri
// platitori" + "userul free plateste la aplicatie, prin credite […] lui
// trebuie sa functioneze permanent fara mesaje de genul acela".
//
// REGULA (adaptată la Gemini-only, 3 aug — extirparea totală OpenRouter):
// erorile creierului (429, răspuns gol, model căzut) se absorb prin
// REÎNCERCĂRI pe ACELAȘI creier Gemini. Userul aude un mesaj NEUTRU
// ("încearcă din nou") ABIA dacă toate încercările pică. Detaliile tehnice
// rămân doar în logul serverului. NU mai există rotire pe alt furnizor.
//
// Testul citește codul REAL. Dacă cineva repune un mesaj despre modele /
// plafon / bani în calea vizibilă userului, cade aici.
const sursa = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('reîncercările tăcute pe creierul Gemini (fără alt furnizor)', () => {
  it('un model gol sau picat NU închide turul din prima — se reîncearcă', () => {
    expect(sursa).toMatch(/reîncercare/)
    expect(sursa).toMatch(/brain_gemini_exhausted/)
  })

  it('textul parțial ajuns la user oprește reîncercarea (nu dublăm răspunsul)', () => {
    expect(sursa).toMatch(/if \(textFlowed\) throw ge/)
  })

  it('nu mai există pool/catalog de alt furnizor pe calea creierului', () => {
    expect(sursa).not.toMatch(/getCatalog|listaCandidati|classifyCost|blendedPerM/)
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

  it('eroarea NE-tranzitorie nu mai promite fals că „din nou în câteva secunde" ajută (registrul backend #4) — mesajul rămâne neutru, dar onest', () => {
    expect(sursa).toMatch(/const eNetranzitorie =/)
    // cazul măsurat: modelul pensionat (not found) a tăcut zile întregi cu „încearcă din nou"
    expect(sursa).toMatch(/not.?found/)
    expect(sursa).toContain('Cererea asta nu a putut fi dusă la capăt')
    expect(sursa).toContain('This request could not be completed')
  })
})
