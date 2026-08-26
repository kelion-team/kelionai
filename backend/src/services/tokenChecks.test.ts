import { describe, expect, it, vi } from 'vitest'

vi.mock('../config.js', () => ({
  config: {
    google: { clientId: '', clientSecret: '' },
    mail: { imapHost: '', imapPort: 993, smtpHost: '', smtpPort: 465, user: '', pass: '' },
    sessionSecret: '',
    googleTokenEncryptionKey: '',
    githubReleaseOAuthToken: '',
    githubRepo: 'kelion-team/kelionai',
  },
}))
vi.mock('../db.js', () => ({ dbEnabled: () => false, getPool: vi.fn() }))
vi.mock('./brain.js', () => ({
  verifyKeys: async () => ({ primary: 'not_configured', reserve: 'not_configured', diag: { provider: 'openai' } }),
}))
vi.mock('./mail.js', () => ({ mailEnabled: () => false, smtpTransport: vi.fn() }))
vi.mock('./serperBalance.js', () => ({ getSerperBalance: async () => ({ ok: false, error: 'not_configured' }) }))
vi.mock('./constructorChainStatus.js', () => ({
  getConstructorChainStatus: async () => ({
    state: 'setup_required',
    reason: 'fixture',
    lastHeartbeat: null,
    legs: {
      worker: { state: 'setup_required', lastHeartbeat: null, detail: null },
      publisher: { state: 'setup_required', lastHeartbeat: null, detail: null },
      release: { state: 'setup_required', lastHeartbeat: null, detail: null },
    },
  }),
}))

import { runAllTokenChecks } from './tokenChecks.js'

describe('tokenChecks', () => {
  it('raportează numai integrările runtime actuale și starea lor factuală', async () => {
    const checks = await runAllTokenChecks()
    const names = checks.map((check) => check.name)
    expect(names).toEqual(expect.arrayContaining([
      'Creierul OpenAI (Responses)',
      'Serper (căutarea web)',
      'Mail SMTP',
      'Mail IMAP',
      'PostgreSQL',
      'Google OAuth (login)',
      'SESSION_SECRET',
      'GOOGLE_TOKEN_ENCRYPTION_KEY',
      'GitHub OAuth (Admin release)',
      'Constructor worker (HMAC + heartbeat)',
      'Constructor publisher (HMAC + heartbeat)',
      'Constructor release (HMAC + heartbeat)',
    ]))
    expect(checks.every((check) => ['ok', 'not_configured', 'fail'].includes(check.status) || /^fail_\d+$/.test(check.status))).toBe(true)
    expect(checks.find((check) => check.name === 'Creierul OpenAI (Responses)')?.status).toBe('not_configured')
    expect(checks.find((check) => check.name === 'Serper (căutarea web)')?.status).toBe('not_configured')
    expect(checks.find((check) => check.name === 'GitHub OAuth (Admin release)')?.status).toBe('not_configured')
    expect(checks.filter((check) => check.status === 'not_configured')).toHaveLength(11)
    expect(checks.filter((check) => check.status === 'fail')).toHaveLength(1)
    expect(checks).toHaveLength(12)
  })
})
