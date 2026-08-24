import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

const secrets = {
  worker: 'w'.repeat(32),
  publisher: 'p'.repeat(32),
  release: 'r'.repeat(32),
}

vi.mock('./config.js', () => ({
  config: {
    codexWorker: { enabled: true, secret: secrets.worker },
    constructorPublisher: { enabled: true, secret: secrets.publisher },
    constructorRelease: { enabled: true, secret: secrets.release },
  },
}))

vi.mock('./dbPool.js', () => ({
  getPool: vi.fn(),
  conexiuneDb: vi.fn(),
}))

const auth = await import('./services/constructorServiceAuth.js')

function request(prefix: string, secret: string, body: Record<string, unknown>, now: number) {
  const timestamp = String(Math.floor(now / 1000))
  const nonce = '123e4567-e89b-42d3-a456-426614174000'
  const path = '/api/internal/constructor-publisher/jobs/claim'
  const bodyHash = createHash('sha256').update(auth.canonicalJson(body)).digest('hex')
  const signature = createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${path}\n${bodyHash}`)
    .digest('hex')
  return {
    body,
    method: 'POST',
    url: path,
    raw: { url: path },
    headers: {
      [`${prefix}-timestamp`]: timestamp,
      [`${prefix}-nonce`]: nonce,
      [`${prefix}-signature`]: `v1=${signature}`,
    },
  }
}

describe('Constructor HMAC identity domains', () => {
  it('accepts the publisher domain and persists its nonce before success', async () => {
    const now = 1_787_536_800_000
    const consume = vi.fn(async () => true)
    const req = request('x-constructor-publisher', secrets.publisher, {}, now)
    await expect(auth.verifyConstructorServiceRequest(req as never, 'constructor-publisher', now, consume)).resolves.toBe(true)
    expect(consume).toHaveBeenCalledWith('constructor-publisher', '123e4567-e89b-42d3-a456-426614174000', new Date(now + 30_000))
  })

  it('does not accept a publisher signature as release authority', async () => {
    const now = 1_787_536_800_000
    const req = request('x-constructor-publisher', secrets.publisher, {}, now)
    const consume = vi.fn(async () => true)
    await expect(auth.verifyConstructorServiceRequest(req as never, 'constructor-release', now, consume)).resolves.toBe(false)
    expect(consume).not.toHaveBeenCalled()
  })

  it('rejects stale requests and fails closed when nonce persistence fails', async () => {
    const now = 1_787_536_800_000
    const req = request('x-constructor-publisher', secrets.publisher, {}, now)
    await expect(auth.verifyConstructorServiceRequest(req as never, 'constructor-publisher', now + 31_000, vi.fn(async () => true))).resolves.toBe(false)
    await expect(auth.verifyConstructorServiceRequest(req as never, 'constructor-publisher', now, vi.fn(async () => false))).resolves.toBe(false)
  })
})
