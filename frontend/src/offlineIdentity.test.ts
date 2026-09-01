import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { cachedOfflineMe, fetchMe } from './lib/api'
import { purgeOfflineDatabase } from './lib/offlineStore'

function storageStub(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => values.set(key, value)),
    removeItem: vi.fn((key: string) => values.delete(key)),
    value: (key: string) => values.get(key),
  }
}

afterEach(async () => {
  await purgeOfflineDatabase()
  vi.unstubAllGlobals()
})

describe('offline identity boundary', () => {
  it('downgrades a tampered cached admin to an anonymous local customer', async () => {
    const storage = storageStub({
      kelion_last_user: JSON.stringify({
        email: 'victim@example.test',
        name: 'Admin',
        picture: 'https://example.test/private.jpg',
        role: 'admin',
        locale: 'ro',
      }),
    })
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))

    const me = await fetchMe()

    expect(me).toEqual({
      authenticated: true,
      offline: true,
      user: { email: '', name: 'Offline', picture: '', role: 'customer', locale: 'en' },
    })
    expect(storage.value('kelion_last_user')).toBe('1')
  })

  it('persists only a presence marker after an authenticated online response', async () => {
    const storage = storageStub()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      authenticated: true,
      user: {
        email: 'person@example.test',
        name: 'Person',
        picture: 'https://example.test/person.jpg',
        role: 'customer',
        locale: 'en',
        clientStorageId: '11111111-1111-4111-8111-111111111111',
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } })))

    await expect(fetchMe()).resolves.toMatchObject({ authenticated: true })
    expect(storage.value('kelion_last_user')).toBe('1')
    expect(storage.value('kelion.client.active-scope')).toBe('11111111-1111-4111-8111-111111111111')
    expect(JSON.stringify([...storage.setItem.mock.calls])).not.toContain('person@example.test')
  })

  it('does not touch the network when booting in airplane mode', () => {
    const storage = storageStub({ kelion_last_user: '1' })
    const network = vi.fn()
    vi.stubGlobal('localStorage', storage)
    vi.stubGlobal('fetch', network)

    expect(cachedOfflineMe()).toMatchObject({
      authenticated: true,
      offline: true,
      user: { role: 'customer', email: '' },
    })
    expect(network).not.toHaveBeenCalled()
  })

  it('keeps opaque offline data on expired session and purges only after another account is confirmed', async () => {
    const accountA = '11111111-1111-4111-8111-111111111111'
    const accountB = '22222222-2222-4222-8222-222222222222'
    const queueKey = `kelion.offline.sync:${accountA}`
    const storage = storageStub({
      kelion_last_user: '1',
      'kelion.client.active-scope': accountA,
      [queueKey]: '[{"id":"offline-a"}]',
    })
    vi.stubGlobal('localStorage', storage)
    const network = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authenticated: true,
        user: {
          email: 'same@example.test', name: 'Same', picture: '', role: 'customer', locale: 'en',
          clientStorageId: accountA,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        authenticated: true,
        user: {
          email: 'other@example.test', name: 'Other', picture: '', role: 'customer', locale: 'en',
          clientStorageId: accountB,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', network)

    await expect(fetchMe()).resolves.toEqual({ authenticated: false })
    expect(storage.value(queueKey)).toContain('offline-a')
    await expect(fetchMe()).resolves.toMatchObject({ authenticated: true })
    expect(storage.value(queueKey)).toContain('offline-a')
    await expect(fetchMe()).resolves.toMatchObject({ authenticated: true })
    expect(storage.value(queueKey)).toBeUndefined()
  })

  it('propagates offline mode and gates every admin surface', () => {
    const root = dirname(fileURLToPath(import.meta.url))
    const app = readFileSync(join(root, 'App.tsx'), 'utf8')
    const stage = readFileSync(join(root, 'pages/Stage.tsx'), 'utf8')
    expect(app).toContain('const effectiveOffline = !online || offlineSession')
    expect(app).toContain('<Stage user={user} offline={effectiveOffline} />')
    expect(app).toContain('const request = online ? fetchMe() : Promise.resolve(cachedOfflineMe())')
    expect(stage).toContain("const isAdmin = !offline && user.role === 'admin'")
    expect(stage).toContain('<ChatPanel lang={lang} isAdmin={isAdmin} forceOffline={offline} />')
    expect(readFileSync(join(root, 'components/ChatPanel.tsx'), 'utf8'))
      .toContain('const online = useConectat() && !forceOffline')
    expect(stage).not.toMatch(/<AdminPanel[\s\S]{0,200}user\.role === 'admin'/)
  })
})
