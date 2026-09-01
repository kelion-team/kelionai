import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('./config.js', () => ({
  config: {
    revolutMerchant: { enabled: false },
    push: { enabled: false },
  },
  ENV_ALIASES: {
    databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
    openaiKey: ['OPENAI_API_KEY'],
    openaiAdminKey: ['OPENAI_ADMIN_KEY'],
    sessionSecret: ['SESSION_SECRET'],
    googleTokenEncryptionKey: ['GOOGLE_TOKEN_ENCRYPTION_KEY'],
    serperKey: ['SERPER_API_KEY', 'SERPER_KEY'],
    mailPass: ['MAIL_PASS', 'MAIL_PASSWORD'],
    codexWorkerSecret: ['CODEX_WORKER_SECRET'],
    constructorPublisherSecret: ['CONSTRUCTOR_PUBLISHER_SECRET'],
    constructorReleaseSecret: ['CONSTRUCTOR_RELEASE_SECRET'],
    constructorModelControlSecret: ['CONSTRUCTOR_MODEL_CONTROL_SECRET'],
    githubReleaseOAuthToken: ['GITHUB_RELEASE_OAUTH_TOKEN'],
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
    delete process.env.OPENAI_ADMIN_KEY
    delete process.env.OPENAI_ADMIN_KEY_FILE
    delete process.env.SERPER_API_KEY
    delete process.env.SERPER_KEY
    delete process.env.KELION_ALT_KEY
    delete process.env.CODEX_WORKER_SECRET_FILE
    delete process.env.CONSTRUCTOR_PUBLISHER_SECRET_FILE
    delete process.env.CONSTRUCTOR_RELEASE_SECRET_FILE
    delete process.env.CONSTRUCTOR_MODEL_CONTROL_SECRET_FILE
    delete process.env.GITHUB_RELEASE_OAUTH_TOKEN_FILE
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

  it('includes all privileged Constructor identities in summary and never reports their file variants as orphans', () => {
    const secretDir = mkdtempSync(join(tmpdir(), 'kelion-env-check-'))
    const constructorFiles = {
      CODEX_WORKER_SECRET_FILE: join(secretDir, 'codex-worker-secret'),
      CONSTRUCTOR_PUBLISHER_SECRET_FILE: join(secretDir, 'constructor-publisher-secret'),
      CONSTRUCTOR_RELEASE_SECRET_FILE: join(secretDir, 'constructor-release-secret'),
      CONSTRUCTOR_MODEL_CONTROL_SECRET_FILE: join(secretDir, 'constructor-model-control-secret'),
      GITHUB_RELEASE_OAUTH_TOKEN_FILE: join(secretDir, 'github-release-oauth-token'),
    }
    try {
      for (const path of Object.values(constructorFiles)) writeFileSync(path, `${SECRET}\n`, { mode: 0o600 })
      Object.assign(process.env, constructorFiles)

      const report = envCheck()
      const summary = envSummary()
      for (const [fileName] of Object.entries(constructorFiles)) {
        const canonical = fileName.replace(/_FILE$/, '')
        expect(report.find((entry) => entry.name === canonical)).toMatchObject({
          present: true,
          length: SECRET.length,
          foundAs: fileName,
        })
        expect(summary.nume).not.toContain(canonical)
        expect(envOrphans()).not.toContain(fileName)
      }

      process.env.GITHUB_RELEASE_OAUTH_TOKEN_FILE = secretDir
      expect(envCheck().find((entry) => entry.name === 'GITHUB_RELEASE_OAUTH_TOKEN')).toMatchObject({
        present: true,
        length: 0,
      })
      expect(envSummary().nume).toContain('GITHUB_RELEASE_OAUTH_TOKEN')
      expect(envOrphans()).not.toContain('GITHUB_RELEASE_OAUTH_TOKEN_FILE')
    } finally {
      rmSync(secretDir, { recursive: true, force: true })
    }
  })
})
