import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    revolutMerchant: { enabled: false },
    push: { enabled: false },
  },
  ENV_ALIASES: {
    databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
    openaiKey: ['OPENAI_API_KEY'],
    sessionSecret: ['SESSION_SECRET'],
    googleTokenEncryptionKey: ['GOOGLE_TOKEN_ENCRYPTION_KEY'],
    serperKey: ['SERPER_API_KEY', 'SERPER_KEY'],
    mailPass: ['MAIL_PASS', 'MAIL_PASSWORD'],
    codexWorkerSecret: ['CODEX_WORKER_SECRET'],
    revolutMerchantSecretKey: ['REVOLUT_MERCHANT_SECRET_KEY'],
    revolutWebhookSigningSecret: ['REVOLUT_WEBHOOK_SIGNING_SECRET'],
    vapidPublicKey: ['VAPID_PUBLIC_KEY'],
  },
}))

const { envCheck, envSummary, envOrphans } = await import('./services/envCheck.js')
const SECRET = ['fixture', 'invalid', 'credential'].join('_')

describe('env-check secret minimisation', () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = SECRET
    process.env.SERPER_API_KEY = '   '
  })

  afterEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.SERPER_API_KEY
    delete process.env.SERPER_KEY
    delete process.env.KELION_ALT_KEY
  })

  it('reports presence and length but never a secret value or prefix', () => {
    const report = envCheck()
    const brain = report.find((entry) => entry.name === 'OPENAI_API_KEY')
    expect(brain).toMatchObject({ present: true, length: SECRET.length, foundAs: 'OPENAI_API_KEY' })
    const serialised = JSON.stringify(report)
    expect(serialised).not.toContain(SECRET)
    expect(serialised).not.toContain(SECRET.slice(0, 8))
  })

  it('treats whitespace-only values as present but empty', () => {
    const search = envCheck().find((entry) => entry.name === 'SERPER_API_KEY')
    expect(search).toMatchObject({ present: true, length: 0 })
    expect(envSummary().nume).toContain('SERPER_API_KEY')
  })

  it('recognises canonical aliases and returns orphan names only', () => {
    delete process.env.SERPER_API_KEY
    process.env.SERPER_KEY = 'x'
    process.env.KELION_ALT_KEY = SECRET
    expect(envCheck().find((entry) => entry.name === 'SERPER_API_KEY')?.foundAs).toBe('SERPER_KEY')
    expect(envOrphans()).toContain('KELION_ALT_KEY')
    expect(JSON.stringify(envOrphans())).not.toContain(SECRET)
  })
})
