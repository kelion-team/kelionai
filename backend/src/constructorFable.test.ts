import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── FABLE 5 — THE RULE CHANGED THE SAME EVENING (Adrian, Aug 2, seara:
// „trebuie fable 5 peste tot") ───────────────────────────────────────────────
// The morning rule was "everywhere FREE, paid only on the express order-text
// marker". The evening order supersedes it: a paid model chosen CONSCIOUSLY in
// env (CONSTRUCTOR_MODEL + CONSTRUCTOR_ALLOW_PAID=1 — both, so never by
// accident) now heads the ladder for EVERY order, frees underneath as the
// net. WITHOUT that conscious env pair, everything below still holds: default
// ladder and env lists resolve to :free only, and the order-text marker stays
// the one-off escape hatch.
//
// HOW they run: the VPS constructor is plain Node ESM OUTSIDE the backend
// root — vite/vitest cannot load it in-process (SyntaxError at suite load).
// So we exercise it FOR REAL through a tiny node subprocess that imports the
// module natively and answers with JSON. The paid-brain guard is too
// important to check "on trust" (reading source text).

const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

interface Proba {
  fable: Record<string, boolean>
  capFaraLista: string
  capCuMarcaj: string
  toateFreeFaraMarcaj: boolean
  subFableDoarFree: boolean
  envCuratata: string[]
  envCuMarcaj: string[]
  envPlatitAles: string[]
  envPlatitFaraAllow: string[]
  envPlatitSiMarcaj: string[]
  modelConstanta: string
}

function ruleazaProbele(): Proba {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const out = {
      fable: {
        'Construiește X, cu fable 5': m.cereCreierFable('Construiește X, cu fable 5'),
        'Fable 5 — repară loginul': m.cereCreierFable('Fable 5 — repară loginul'),
        'folosește FABLE5': m.cereCreierFable('folosește FABLE5'),
        'pune creier fable': m.cereCreierFable('pune creier fable'),
        'repară butonul de login': m.cereCreierFable('repară butonul de login'),
        '': m.cereCreierFable(''),
        'null': m.cereCreierFable(null),
        'undefined': m.cereCreierFable(undefined),
        'o poveste despre o fable': m.cereCreierFable('o poveste despre o fable'),
      },
      capFaraLista: m.modelePentruOrdin('repară typo-ul din footer')[0],
      capCuMarcaj: m.modelePentruOrdin('Te rog construiește portalul, cu fable 5')[0],
      toateFreeFaraMarcaj: ['repară typo-ul din footer', 'NIVEL DE DIFICULTATE: 5 — migrează baza', '']
        .every((o) => m.modelePentruOrdin(o).every((x) => x.endsWith(':free'))),
      subFableDoarFree: m.modelePentruOrdin('fable5: refac onboardingul').slice(1).every((x) => x.endsWith(':free')),
      envCuratata: m.modelePentruOrdin('ordin obișnuit, fără marcaj', ['anthropic/claude-sonnet-5', 'anthropic/claude-opus-5', 'google/gemma-4-31b-it:free']),
      envCuMarcaj: m.modelePentruOrdin('creier fable, te rog', ['anthropic/claude-sonnet-5', 'google/gemma-4-31b-it:free']),
      // ORDINUL NOU (2 aug seara): plătit ales conștient în env ⇒ capul scării
      // pentru ORICE ordin; fără ALLOW_PAID rămâne totul :free.
      envPlatitAles: m.modelePentruOrdin('ordin obișnuit', ['google/gemma-4-31b-it:free'], 'anthropic/claude-fable-5', true),
      envPlatitFaraAllow: m.modelePentruOrdin('ordin obișnuit', ['google/gemma-4-31b-it:free'], 'anthropic/claude-fable-5', false),
      envPlatitSiMarcaj: m.modelePentruOrdin('cu fable 5', ['google/gemma-4-31b-it:free'], 'anthropic/claude-fable-5', true),
      modelConstanta: m.FABLE_MODEL,
    };
    console.log(JSON.stringify(out));
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000,
  })
  return JSON.parse(stdout.trim().split('\n').pop()!) as Proba
}

const proba = ruleazaProbele()

describe('marcajul „Fable 5" din textul ordinului', () => {
  it('recunoaște variantele acceptate, indiferent de caz', () => {
    expect(proba.fable['Construiește X, cu fable 5']).toBe(true)
    expect(proba.fable['Fable 5 — repară loginul']).toBe(true) // prefixul pus de toggle-ul din Admin
    expect(proba.fable['folosește FABLE5']).toBe(true)
    expect(proba.fable['pune creier fable']).toBe(true)
  })

  it('NU se declanșează pe text obișnuit', () => {
    expect(proba.fable['repară butonul de login']).toBe(false)
    expect(proba.fable['']).toBe(false)
    expect(proba.fable['null']).toBe(false)
    expect(proba.fable['undefined']).toBe(false)
    expect(proba.fable['o poveste despre o fable']).toBe(false) // „fable" singur nu ajunge
  })
})

describe('rezoluția modelului per ordin', () => {
  it('(a) ordin cu „fable 5" ⇒ capul scării e modelul PLĂTIT anthropic/claude-fable-5', () => {
    expect(proba.capCuMarcaj).toBe('anthropic/claude-fable-5')
    expect(proba.modelConstanta).toBe('anthropic/claude-fable-5')
  })

  it('(a2) sub Fable rămân doar gratuitele, ca plasă — nu ALT model plătit', () => {
    expect(proba.subFableDoarFree).toBe(true)
  })

  it('(b) ordin fără marcaj ⇒ ÎNTREAGA scară e :free, mereu', () => {
    expect(proba.toateFreeFaraMarcaj).toBe(true)
    expect(proba.capFaraLista.endsWith(':free')).toBe(true)
  })

  it('(c) o listă „de escaladare" din env cu modele plătite e curățată la :free pentru ordine nemarcate', () => {
    // Simulates an env-configured/escalation list that still contains paid
    // models (the old CONSTRUCTOR_MODEL_CAPABIL/GREU/MEDIU defaults). For an
    // unmarked order they must NOT leak into the ladder.
    expect(proba.envCuratata).toEqual(['google/gemma-4-31b-it:free'])
  })

  it('(c2) nici cu marcaj Fable nu reapare alt plătit din lista de bază', () => {
    expect(proba.envCuMarcaj).toEqual(['anthropic/claude-fable-5', 'google/gemma-4-31b-it:free'])
  })

  it('(d) ORDINUL NOU: plătit ales conștient în env ⇒ capul scării pentru ORICE ordin, gratuitele plasă', () => {
    expect(proba.envPlatitAles).toEqual(['anthropic/claude-fable-5', 'google/gemma-4-31b-it:free'])
  })

  it('(d2) fără ALLOW_PAID, modelul plătit din env NU intră — garda structurală ține', () => {
    expect(proba.envPlatitFaraAllow).toEqual(['google/gemma-4-31b-it:free'])
  })

  it('(d3) env plătit + marcaj în text ⇒ Fable o singură dată, nu dublat', () => {
    expect(proba.envPlatitSiMarcaj).toEqual(['anthropic/claude-fable-5', 'google/gemma-4-31b-it:free'])
  })
})
