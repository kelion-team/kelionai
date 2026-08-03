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
    const checks = await runAllTokenChecks()
    const names = checks.map((c) => c.name)
    // (3 aug — extirparea totală: verificările OpenRouter/OpenAI au dispărut
    // cu tot cu furnizorii; creierul e verificat prin pingul Gemini.)
    expect(names).toContain('Creierul Gemini (chat direct)')
    expect(names.some((n) => /OpenRouter|OpenAI/.test(n))).toBe(false)
    expect(names).toContain('Revolut pay link')
    expect(names).toContain('Enable Banking (citire plăți)')
    expect(names).toContain('Google service account')
    expect(names).toContain('Gemini API key')
    expect(names).toContain('Mail SMTP')
    expect(names).toContain('Mail IMAP')
    expect(names).toContain('PostgreSQL')
    expect(names).toContain('Google OAuth (login)')
    expect(names).toContain('SESSION_SECRET')

    // Local checks (presence/config only, no external call) can be ok even
    // without external keys — we exclude them from the "nothing external configured" test.
    const local = new Set(['SESSION_SECRET', 'Google OAuth (login)', 'PostgreSQL'])
    const configured = checks.filter((c) =>
      c.status !== 'not_configured' && !local.has(c.name),
    )
    // With no external keys configured, no external token should be ok/fail.
    expect(configured).toEqual([])

    const session = checks.find((c) => c.name === 'SESSION_SECRET')
    expect(session).toBeDefined()
    expect(session!.status === 'ok' || session!.status === 'not_configured').toBe(true)
  })
})
