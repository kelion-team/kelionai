// Contractele push-ului pe telefon: cheile se nasc O DATĂ și se refolosesc
// (o pereche nouă la fiecare boot ar amuți tăcut toate telefoanele abonate),
// trimiterea întoarce cifra MĂSURATĂ (nu speranța), iar un endpoint mort se
// curăță singur — tabelul nu adună cadavre.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const kv = new Map<string, string>()
const query = vi.fn()

vi.mock('../db.js', () => ({
  dbEnabled: () => true,
  getPool: () => ({ query }),
  saveKv: vi.fn(async (k: string, v: string) => void kv.set(k, v)),
  loadKv: vi.fn(async (k: string) => kv.get(k) ?? null),
}))

const sendNotification = vi.fn()
const generateVAPIDKeys = vi.fn(() => ({ publicKey: 'pub-1', privateKey: 'priv-1' }))
vi.mock('web-push', () => ({
  default: { get sendNotification() { return sendNotification }, get generateVAPIDKeys() { return generateVAPIDKeys } },
}))

vi.mock('../config.js', () => ({ config: { adminEmail: 'owner@test' } }))

beforeEach(() => {
  vi.resetModules()
  kv.clear()
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 })
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201 })
  generateVAPIDKeys.mockClear()
})

describe('cheile VAPID', () => {
  it('se generează o singură dată și se refolosesc din kv', async () => {
    const { cheiePublicaPush } = await import('./pushTelefon.js')
    expect(await cheiePublicaPush()).toBe('pub-1')
    expect(await cheiePublicaPush()).toBe('pub-1')
    expect(generateVAPIDKeys).toHaveBeenCalledTimes(1)
    expect(kv.get('push:vapid')).toContain('priv-1')
  })

  it('perechea deja salvată NU se regenerează la boot nou', async () => {
    kv.set('push:vapid', JSON.stringify({ publicKey: 'pub-vechi', privateKey: 'priv-vechi' }))
    const { cheiePublicaPush } = await import('./pushTelefon.js')
    expect(await cheiePublicaPush()).toBe('pub-vechi')
    expect(generateVAPIDKeys).not.toHaveBeenCalled()
  })
})

describe('trimitePushAdmin', () => {
  const abonat = { endpoint: 'https://push/e1', p256dh: 'p', auth: 'a' }

  it('trimite la abonații ownerului și întoarce cifra reală', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT endpoint') ? { rows: [abonat] } : { rows: [], rowCount: 0 },
    )
    const { trimitePushAdmin } = await import('./pushTelefon.js')
    expect(await trimitePushAdmin('Titlu', 'Mesaj', { pr: 7 })).toBe(1)
    const [sub, corp] = sendNotification.mock.calls[0]
    expect(sub.endpoint).toBe('https://push/e1')
    expect(JSON.parse(corp)).toMatchObject({ titlu: 'Titlu', mesaj: 'Mesaj', pr: 7 })
  })

  it('endpoint mort (410) → șters din tabel, cifra NU îl numără', async () => {
    query.mockImplementation(async (sql: string) =>
      sql.includes('SELECT endpoint') ? { rows: [abonat] } : { rows: [], rowCount: 0 },
    )
    sendNotification.mockRejectedValue(Object.assign(new Error('gone'), { statusCode: 410 }))
    const { trimitePushAdmin } = await import('./pushTelefon.js')
    expect(await trimitePushAdmin('T', 'M')).toBe(0)
    const stersuri = query.mock.calls.filter(([sql]) => String(sql).startsWith('DELETE FROM push_subscriptions'))
    expect(stersuri).toHaveLength(1)
    expect(stersuri[0][1]).toEqual(['https://push/e1'])
  })
})

describe('abonarea', () => {
  it('refuză corpuri fără endpoint/chei — nu salvează jumătăți', async () => {
    const { aboneazaPush } = await import('./pushTelefon.js')
    expect(await aboneazaPush('x@y', { endpoint: '', keys: { p256dh: 'p', auth: 'a' } })).toBe(false)
    expect(await aboneazaPush('x@y', { endpoint: 'e' } as never)).toBe(false)
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO push_subscriptions'))).toHaveLength(0)
  })

  it('dezabonarea șterge DOAR perechea email+endpoint proprie', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 1 })
    const { dezaboneazaPush } = await import('./pushTelefon.js')
    expect(await dezaboneazaPush('x@y', 'https://push/e1')).toBe(true)
    const st = query.mock.calls.find(([sql]) => String(sql).includes('DELETE FROM push_subscriptions WHERE endpoint=$1 AND email=$2'))
    expect(st?.[1]).toEqual(['https://push/e1', 'x@y'])
  })
})
