import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAllTokenChecks } from './tokenChecks.js'

describe('Token checks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reports not_configured when no external keys are set', async () => {
    // Testul verifică STRUCTURA listei de checks (numele prezente), NU starea
    // env-ului local — env-ul de pe mașina de dev ARE chei setate, deci
    // check-urile externe vor fi ok/fail, nu not_configured.
    // (Bug vechi: testul presupunea „no external keys" dar rula pe mașina
    //  ownerului cu GEMINI_API_KEY setat → 3 check-uri ok → expect([]) pica.)
    const checks = await runAllTokenChecks()
    const names = checks.map((c) => c.name)
    // (3 aug — extirparea totală: verificările OpenRouter/OpenAI au dispărut
    // cu tot cu furnizorii; creierul e verificat prin pingul Gemini.)
    expect(names).toContain('Creierul Gemini (chat direct)')
    expect(names.some((n) => /OpenRouter|OpenAI/.test(n))).toBe(false)
    expect(names).toContain('Revolut pay link')
    expect(names).toContain('Enable Banking (citire plăți)')
    expect(names).toContain('Google service account')
    // Serper — SINGURUL motor de căutare post-extirpare, cheie plătită; lipsea
    // complet din „verificarea LIVE" (adăugat la auditul admin, 3 aug).
    expect(names).toContain('Serper (căutarea web)')
    expect(names).toContain('Gemini API key')
    expect(names).toContain('Mail SMTP')
    expect(names).toContain('Mail IMAP')
    expect(names).toContain('PostgreSQL')
    expect(names).toContain('Google OAuth (login)')
    expect(names).toContain('SESSION_SECRET')

    // Fiecare check are un status valid din union-ul TokenCheck
    for (const c of checks) {
      expect(['ok', 'not_configured', 'fail'].includes(c.status) || /^fail_\d+$/.test(c.status)).toBe(true)
    }

    const session = checks.find((c) => c.name === 'SESSION_SECRET')
    expect(session).toBeDefined()
    expect(session!.status === 'ok' || session!.status === 'not_configured').toBe(true)
  })
})
