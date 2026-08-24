import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const query = vi.fn()
vi.mock('../db.js', () => ({
  dbEnabled: () => true,
  getPool: () => ({ query }),
}))

const sendNotification = vi.fn()
vi.mock('web-push', () => ({
  default: { get sendNotification() { return sendNotification } },
}))

const PUBLIC_KEY = Buffer.alloc(65, 3).toString('base64url')
const PRIVATE_KEY = Buffer.alloc(32, 4).toString('base64url')
vi.mock('../config.js', () => ({
  config: {
    adminEmail: 'owner@test.example',
    product: { supportEmail: 'support@test.example' },
    push: {
      enabled: true,
      publicKey: PUBLIC_KEY,
      privateKey: PRIVATE_KEY,
      endpointHosts: ['push.example.test'],
      maxSubscriptions: 3,
    },
  },
}))

const P256DH = Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString('base64url')
const AUTH = Buffer.alloc(16, 2).toString('base64url')
const abonare = (endpoint = 'https://push.example.test/subscription/1') => ({
  endpoint,
  keys: { p256dh: P256DH, auth: AUTH },
})

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 })
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
})

describe('configurația VAPID', () => {
  it('expune numai cheia publică configurată, fără generare sau KV', async () => {
    const { cheiePublicaPush } = await import('./pushTelefon.js')
    expect(await cheiePublicaPush()).toBe(PUBLIC_KEY)
  })

  it('cheia privată nu este generată sau persistată de procesul web', () => {
    const service = readFileSync(fileURLToPath(new URL('./pushTelefon.ts', import.meta.url)), 'utf8')
    const configSource = readFileSync(fileURLToPath(new URL('../config.ts', import.meta.url)), 'utf8')
    expect(service).not.toMatch(/generateVAPIDKeys|saveKv|loadKv/)
    expect(configSource).toContain("fileOnlySecret('VAPID_PRIVATE_KEY')")
    expect(configSource).toContain('if (production && direct) throw new Error')
  })
})

describe('abonarea adminului', () => {
  it('validează HTTPS, hostul permis și cheile canonice înainte de DB', async () => {
    query.mockResolvedValue({ rows: [{ endpoint: abonare().endpoint }] })
    const { aboneazaPush } = await import('./pushTelefon.js')
    expect(await aboneazaPush('OWNER@Test.Example', abonare())).toBe(true)
    const apel = query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO push_subscriptions'))
    expect(apel?.[1]).toEqual([
      'owner@test.example', abonare().endpoint, P256DH, AUTH, 3,
    ])
    expect(String(apel?.[0])).toContain('pg_advisory_xact_lock')
  })

  it('refuză non-adminul, hosturile private și cheile malformate fără DB', async () => {
    const { aboneazaPush } = await import('./pushTelefon.js')
    expect(await aboneazaPush('customer@test.example', abonare())).toBe(false)
    expect(await aboneazaPush('owner@test.example', abonare('https://127.0.0.1/push'))).toBe(false)
    expect(await aboneazaPush('owner@test.example', { ...abonare(), keys: { p256dh: 'bad', auth: AUTH } })).toBe(false)
    expect(query).not.toHaveBeenCalled()
  })

  it('refuză înscrierea când plafonul atomic nu întoarce niciun rând', async () => {
    const { aboneazaPush } = await import('./pushTelefon.js')
    expect(await aboneazaPush('owner@test.example', abonare())).toBe(false)
  })

  it('revocarea este user-scoped și idempotentă', async () => {
    const { dezaboneazaPush } = await import('./pushTelefon.js')
    expect(await dezaboneazaPush('owner@test.example', abonare().endpoint)).toBe(true)
    const apel = query.mock.calls.find(([sql]) => String(sql).startsWith('DELETE FROM push_subscriptions'))
    expect(apel?.[1]).toEqual([abonare().endpoint, 'owner@test.example'])
    expect(await dezaboneazaPush('customer@test.example', abonare().endpoint)).toBe(false)
  })
})

describe('trimiterea notificării', () => {
  it('trimite numai abonările valide ale adminului și limitează payloadul', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT endpoint')
        ? { rows: [{ endpoint: abonare().endpoint, p256dh: P256DH, auth: AUTH }] }
        : { rows: [], rowCount: 0 },
    )
    const { trimitePushAdmin } = await import('./pushTelefon.js')
    expect(await trimitePushAdmin(' Titlu ', 'Mesaj', {
      url: 'https://evil.example/steal',
      safe_url: '/admin/jobs',
      nested: { secret: true },
    })).toBe(1)
    const [subscription, rawBody, options] = sendNotification.mock.calls[0]
    expect(subscription.endpoint).toBe(abonare().endpoint)
    expect(JSON.parse(rawBody)).toEqual({ titlu: 'Titlu', mesaj: 'Mesaj', safe_url: '/admin/jobs' })
    expect(options.vapidDetails).toMatchObject({
      subject: 'mailto:support@test.example', publicKey: PUBLIC_KEY, privateKey: PRIVATE_KEY,
    })
  })

  it('șterge endpointul expirat cu aceeași identitate admin', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.startsWith('SELECT endpoint')
        ? { rows: [{ endpoint: abonare().endpoint, p256dh: P256DH, auth: AUTH }] }
        : { rows: [], rowCount: 1 },
    )
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
    const { trimitePushAdmin } = await import('./pushTelefon.js')
    expect(await trimitePushAdmin('Titlu', 'Mesaj')).toBe(0)
    const apel = query.mock.calls.find(([sql]) => String(sql).startsWith('DELETE FROM push_subscriptions'))
    expect(apel?.[1]).toEqual([abonare().endpoint, 'owner@test.example'])
  })
})
