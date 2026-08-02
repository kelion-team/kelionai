import { describe, it, expect } from 'vitest'
// The VPS constructor is plain Node ESM with no type declarations; the
// tsconfig excludes test files from `tsc --noEmit`, so the untyped import is
// safe here and the module is exercised FOR REAL (the paid-brain guard is too
// important to check "on trust").
// @ts-expect-error -- plain .mjs, no declaration file
import { cereCreierFable, modelePentruOrdin, FABLE_MODEL } from '../../deploy/constructor-agent.mjs'

// ── FABLE 5, ONLY ON EXPRESS REQUEST (Adrian, Aug 2: "Everywhere FREE. The
// admin can EXPRESSLY request the paid brain Fable 5 for the CONSTRUCTOR only.
// Nothing else paid, ever.") ─────────────────────────────────────────────────
// These tests pin the structural rule: the ONLY way a constructor order runs
// on a paid model is the marker written in the order's own text. Every other
// path — default ladder, env-configured lists, escalation leftovers — must
// resolve to :free models only.

describe('marcajul „Fable 5" din textul ordinului', () => {
  it('recunoaște variantele acceptate, indiferent de caz', () => {
    expect(cereCreierFable('Construiește X, cu fable 5')).toBe(true)
    expect(cereCreierFable('Fable 5 — repară loginul')).toBe(true) // prefixul pus de toggle-ul din Admin
    expect(cereCreierFable('folosește FABLE5')).toBe(true)
    expect(cereCreierFable('pune creier fable')).toBe(true)
  })

  it('NU se declanșează pe text obișnuit', () => {
    expect(cereCreierFable('repară butonul de login')).toBe(false)
    expect(cereCreierFable('')).toBe(false)
    expect(cereCreierFable(null)).toBe(false)
    expect(cereCreierFable(undefined)).toBe(false)
    expect(cereCreierFable('o poveste despre o fable')).toBe(false) // „fable" singur nu ajunge
  })
})

describe('rezoluția modelului per ordin', () => {
  it('(a) ordin cu „fable 5" ⇒ capul scării e modelul PLĂTIT anthropic/claude-fable-5', () => {
    const scara = modelePentruOrdin('Te rog construiește portalul, cu fable 5')
    expect(scara[0]).toBe('anthropic/claude-fable-5')
    expect(FABLE_MODEL).toBe('anthropic/claude-fable-5')
  })

  it('(a2) sub Fable rămân doar gratuitele, ca plasă — nu ALT model plătit', () => {
    const scara = modelePentruOrdin('fable5: refac onboardingul')
    expect(scara.length).toBeGreaterThan(1)
    for (const m of scara.slice(1)) expect(m.endsWith(':free')).toBe(true)
  })

  it('(b) ordin fără marcaj ⇒ ÎNTREAGA scară e :free, mereu', () => {
    for (const ordin of ['repară typo-ul din footer', 'NIVEL DE DIFICULTATE: 5 — migrează baza', '']) {
      const scara = modelePentruOrdin(ordin)
      expect(scara.length).toBeGreaterThan(0)
      for (const m of scara) expect(m.endsWith(':free')).toBe(true)
    }
  })

  it('(c) o listă „de escaladare" din env cu modele plătite e curățată la :free pentru ordine nemarcate', () => {
    // Simulates an env-configured/escalation list that still contains paid
    // models (the old CONSTRUCTOR_MODEL_CAPABIL/GREU/MEDIU defaults). For an
    // unmarked order they must NOT leak into the ladder.
    const listaDinEnv = ['anthropic/claude-sonnet-5', 'anthropic/claude-opus-5', 'google/gemma-4-31b-it:free']
    const scara = modelePentruOrdin('ordin obișnuit, fără marcaj', listaDinEnv)
    expect(scara).toEqual(['google/gemma-4-31b-it:free'])
    for (const m of scara) expect(m.endsWith(':free')).toBe(true)
  })

  it('(c2) nici cu marcaj Fable nu reapare alt plătit din lista de bază', () => {
    const listaDinEnv = ['anthropic/claude-sonnet-5', 'google/gemma-4-31b-it:free']
    const scara = modelePentruOrdin('creier fable, te rog', listaDinEnv)
    expect(scara).toEqual(['anthropic/claude-fable-5', 'google/gemma-4-31b-it:free'])
  })
})
