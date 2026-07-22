import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { runAllTokenChecks } from './tokenChecks.js'

describe('Token checks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    vi.stubEnv('VPS_GITHUB_TOKEN', '')
    vi.stubEnv('GITHUB_TOKEN', '')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('reports not_configured when no external keys are set', async () => {
    const checks = await runAllTokenChecks()
    const names = checks.map((c) => c.name)
    expect(names).toContain('Kimi API key')
    expect(names).toContain('GLM API key')
    expect(names).toContain('Stripe secret key')
    expect(names).toContain('Google service account')
    expect(names).toContain('Serper API key')
    expect(names).toContain('Gemini API key')
    expect(names).toContain('Mail SMTP')
    expect(names).toContain('Mail IMAP')
    expect(names).toContain('LiveKit API key/secret')
    expect(names).toContain('GitHub token')
    expect(names).toContain('SESSION_SECRET')

    const configured = checks.filter((c) =>
      c.status !== 'not_configured' && c.name !== 'SESSION_SECRET',
    )
    // Fără chei externe configurate, niciun token extern nu ar trebui să fie ok/fail.
    expect(configured).toEqual([])

    const session = checks.find((c) => c.name === 'SESSION_SECRET')
    expect(session).toBeDefined()
    expect(session!.status === 'ok' || session!.status === 'not_configured').toBe(true)
  })

  it('marks GitHub token ok when /user returns 200', async () => {
    vi.stubEnv('VPS_GITHUB_TOKEN', 'gh_test_token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('api.github.com/user')) {
          return Promise.resolve(new Response('{}', { status: 200 }))
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )
    const checks = await runAllTokenChecks()
    const github = checks.find((c) => c.name === 'GitHub token')
    expect(github).toBeDefined()
    expect(github!.status).toBe('ok')
    expect(github!.detail).toContain('GET /user OK')
  })

  it('marks GitHub token fail_401 when /user returns 401', async () => {
    vi.stubEnv('VPS_GITHUB_TOKEN', 'gh_bad_token')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        if (typeof url === 'string' && url.includes('api.github.com/user')) {
          return Promise.resolve(new Response(JSON.stringify({ message: 'Bad credentials' }), { status: 401 }))
        }
        return Promise.resolve(new Response('{}', { status: 200 }))
      }),
    )
    const checks = await runAllTokenChecks()
    const github = checks.find((c) => c.name === 'GitHub token')
    expect(github!.status).toBe('fail_401')
  })
})
