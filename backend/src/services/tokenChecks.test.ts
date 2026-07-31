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
    expect(names).toContain('OpenRouter API key')
    expect(names).toContain('Revolut pay link')
    expect(names).toContain('Enable Banking (citire plăți)')
    expect(names).toContain('Google service account')
    expect(names).toContain('OpenAI API key (voce/STT/TTS)')
    expect(names).toContain('Gemini API key')
    expect(names).toContain('Mail SMTP')
    expect(names).toContain('Mail IMAP')
    expect(names).toContain('PostgreSQL')
    expect(names).toContain('Google OAuth (login)')
    expect(names).toContain('SESSION_SECRET')

    // Verificările locale (doar prezență/config, fără apel extern) pot fi ok și
    // fără chei externe — le excludem din testul „nimic extern configurat".
    const local = new Set(['SESSION_SECRET', 'Google OAuth (login)', 'PostgreSQL'])
    const configured = checks.filter((c) =>
      c.status !== 'not_configured' && !local.has(c.name),
    )
    // Fără chei externe configurate, niciun token extern nu ar trebui să fie ok/fail.
    expect(configured).toEqual([])

    const session = checks.find((c) => c.name === 'SESSION_SECRET')
    expect(session).toBeDefined()
    expect(session!.status === 'ok' || session!.status === 'not_configured').toBe(true)
  })
})
