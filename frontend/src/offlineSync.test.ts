import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({ apiFetch: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: transport.apiFetch }))

import { adaugaTureSync, citesteIstoricLocal, citesteSyncDurabil } from './lib/coadaOffline'
import { bindClientStateToAccount } from './lib/clientState'
import { drainOfflineSync } from './lib/offlineSync'
import { purgeOfflineDatabase } from './lib/offlineStore'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const ACCOUNT_B = '22222222-2222-4222-8222-222222222222'
const storage = new Map<string, string>()
vi.stubGlobal('localStorage', {
  get length() { return storage.size },
  key: (index: number) => [...storage.keys()][index] ?? null,
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
})

beforeEach(async () => {
  storage.clear()
  transport.apiFetch.mockReset()
  await purgeOfflineDatabase()
  await bindClientStateToAccount(ACCOUNT)
})

function authenticated(scope = ACCOUNT): Response {
  return new Response(JSON.stringify({
    authenticated: true,
    user: { clientStorageId: scope },
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function acknowledgeRequest(init?: RequestInit): Response {
  const body = JSON.parse(String(init?.body)) as { clientStorageId: string; ture: Array<{ id: string }> }
  return new Response(JSON.stringify({
    ok: true,
    clientStorageId: body.clientStorageId,
    ackedIds: body.ture.map((turn) => turn.id),
    rejected: [],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

function allowAuthenticatedSync(): void {
  transport.apiFetch.mockImplementation(async (url, init) =>
    String(url) === '/auth/me' ? authenticated() : acknowledgeRequest(init))
}

async function outbox() {
  return (await citesteSyncDurabil()).ture
}

async function addTurn(turn: { rol: 'user' | 'assistant'; text: string; t: number }) {
  return (await adaugaTureSync([turn]))?.[0] ?? null
}

describe('offline sync drain', () => {
  it('drenează la prima montare online și păstrează istoricul local', async () => {
    await addTurn({ rol: 'user', text: 'pornit direct online', t: 1 })
    allowAuthenticatedSync()

    await expect(drainOfflineSync()).resolves.toEqual({
      batches: 1, acknowledged: 1, quarantined: 0, complete: true,
    })
    expect(await outbox()).toEqual([])
    expect(await citesteIstoricLocal()).toMatchObject([{ text: 'pornit direct online' }])
  })

  it('împarte 200 de ture în două loturi exacte de 100', async () => {
    await adaugaTureSync(Array.from({ length: 200 }, (_, index) => ({
      rol: index % 2 === 0 ? 'user' as const : 'assistant' as const,
      text: `tura ${index}`,
      t: index + 1,
    })))
    allowAuthenticatedSync()

    await expect(drainOfflineSync()).resolves.toEqual({
      batches: 2, acknowledged: 200, quarantined: 0, complete: true,
    })
    const requests = transport.apiFetch.mock.calls.filter(([url]) => url === '/api/offline/sync')
    expect(requests.map(([, init]) =>
      (JSON.parse(String((init as RequestInit).body)) as { ture: unknown[] }).ture.length)).toEqual([100, 100])
    expect(requests.every(([, init]) =>
      (JSON.parse(String((init as RequestInit).body)) as { clientStorageId: string }).clientStorageId === ACCOUNT)).toBe(true)
  })

  it('oprește la primul eșec și reia fără pierderi', async () => {
    await adaugaTureSync(Array.from({ length: 150 }, (_, index) => ({
      rol: 'user' as const, text: `retry ${index}`, t: index + 1,
    })))
    let calls = 0
    transport.apiFetch.mockImplementation(async (url, init) => {
      if (String(url) === '/auth/me') return authenticated()
      calls++
      return calls === 1
        ? acknowledgeRequest(init)
        : new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 })
    })

    await expect(drainOfflineSync()).resolves.toEqual({
      batches: 1, acknowledged: 100, quarantined: 0, complete: false,
    })
    expect(await outbox()).toHaveLength(50)
    allowAuthenticatedSync()
    await expect(drainOfflineSync()).resolves.toEqual({
      batches: 1, acknowledged: 50, quarantined: 0, complete: true,
    })
  })

  it('deduplică declanșările suprapuse în același tab', async () => {
    await addTurn({ rol: 'user', text: 'o singură trimitere', t: 1 })
    let release: (() => void) | undefined
    transport.apiFetch.mockImplementation(async (url, init) => {
      if (String(url) === '/auth/me') return authenticated()
      await new Promise<void>((resolve) => { release = resolve })
      return acknowledgeRequest(init)
    })

    const first = drainOfflineSync()
    const second = drainOfflineSync()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    release?.()
    await Promise.all([first, second])
    expect(transport.apiFetch.mock.calls.filter(([url]) => url === '/api/offline/sync')).toHaveLength(1)
  })

  it('nu trimite nimic până când auth confirmă același UUID opac', async () => {
    await addTurn({ rol: 'user', text: 'private A', t: 1 })
    transport.apiFetch.mockResolvedValue(authenticated(ACCOUNT_B))

    await expect(drainOfflineSync()).resolves.toEqual({
      batches: 0, acknowledged: 0, quarantined: 0, complete: false,
    })
    expect(await outbox()).toHaveLength(1)
    expect(transport.apiFetch.mock.calls.filter(([url]) => url === '/api/offline/sync')).toHaveLength(0)
  })

  it('quarantinează poison fără să blocheze mesajul valid', async () => {
    const [poison, valid] = (await adaugaTureSync([
      { rol: 'user', text: 'prea vechi', t: 1 },
      { rol: 'assistant', text: 'mesaj nou', t: Date.now() },
    ]))!
    transport.apiFetch.mockImplementation(async (url, init) => {
      if (String(url) === '/auth/me') return authenticated()
      const body = JSON.parse(String(init?.body)) as { clientStorageId: string }
      return new Response(JSON.stringify({
        ok: true,
        clientStorageId: body.clientStorageId,
        ackedIds: [valid.id],
        rejected: [{ id: poison.id, code: 'timestamp_too_old', retryable: false }],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    await expect(drainOfflineSync()).resolves.toEqual({
      batches: 1, acknowledged: 1, quarantined: 1, complete: true,
    })
    expect(await outbox()).toEqual([])
  })

  it('schimbarea contului invalidează drain-ul vechi și nu amestecă namespace-uri', async () => {
    await addTurn({ rol: 'user', text: 'A', t: Date.now() })
    let releaseA: (() => void) | undefined
    transport.apiFetch.mockImplementation(async (url, init) => {
      if (String(url) === '/auth/me') {
        return authenticated(storage.get('kelion.client.active-scope') ?? ACCOUNT)
      }
      const body = JSON.parse(String(init?.body)) as { clientStorageId: string }
      if (body.clientStorageId === ACCOUNT) await new Promise<void>((resolve) => { releaseA = resolve })
      return acknowledgeRequest(init)
    })
    const drainA = drainOfflineSync()
    await vi.waitFor(() => expect(releaseA).toBeTypeOf('function'))

    await expect(bindClientStateToAccount(ACCOUNT_B)).resolves.toBe(true)
    await addTurn({ rol: 'user', text: 'B', t: Date.now() })
    const drainB = drainOfflineSync()
    await expect(drainB).resolves.toMatchObject({ complete: true, acknowledged: 1 })
    releaseA?.()
    await expect(drainA).resolves.toMatchObject({ complete: false })
  })

  it('migrează legacy în IDB și trimite UUID-ul stabil o singură dată', async () => {
    storage.set(`kelion.offline.sync:${ACCOUNT}`, JSON.stringify([
      { id: 'legacy', rol: 'user', text: 'nu trebuie duplicat', t: Date.now() },
    ]))
    allowAuthenticatedSync()
    await expect(drainOfflineSync()).resolves.toMatchObject({ complete: true, acknowledged: 1 })
    await expect(drainOfflineSync()).resolves.toMatchObject({ complete: true, acknowledged: 0 })
    expect(transport.apiFetch.mock.calls.filter(([url]) => url === '/api/offline/sync')).toHaveLength(1)
    expect(storage.has(`kelion.offline.sync:${ACCOUNT}`)).toBe(false)
  })
})
