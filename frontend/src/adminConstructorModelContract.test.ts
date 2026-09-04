import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  fetchConstructorModelAdmin,
  switchConstructorModelAdmin,
} from './lib/admin'
import { parseAdminConstructorModelSnapshot } from './lib/adminConstructorContract'

const verifiedAt = '2026-09-01T12:00:00.000Z'
const requestId = '123e4567-e89b-42d3-a456-426614174000'
const profiles = [
  { id: 'fast', label: 'Rapid', model: 'qwen3.6-35b-a3b-local', installed: true },
  { id: 'powerful', label: 'Puternic', model: 'qwen3.5-122b-a10b-local', installed: true },
] as const

const readyFast = {
  mode: 'manual',
  defaultProfile: 'fast',
  profiles,
  activeProfile: 'fast',
  activeModel: profiles[0].model,
  state: 'ready',
  requestedProfile: null,
  requestId: null,
  verifiedAt,
  error: null,
} as const

const switchingPowerful = {
  ...readyFast,
  state: 'switching',
  requestedProfile: 'powerful',
  requestId,
} as const

afterEach(() => vi.unstubAllGlobals())

describe('contractul modelului Constructor controlat manual', () => {
  it('acceptă numai snapshoturi manuale coerente pentru fast, powerful și switching', () => {
    expect(parseAdminConstructorModelSnapshot(readyFast)?.activeProfile).toBe('fast')
    expect(parseAdminConstructorModelSnapshot({
      ...readyFast,
      activeProfile: 'powerful',
      activeModel: profiles[1].model,
    })?.activeProfile).toBe('powerful')
    expect(parseAdminConstructorModelSnapshot(switchingPowerful)?.requestedProfile).toBe('powerful')
  })

  it('respinge mod automat, catalog contradictoriu, model nepotrivit și metadata nesigură', () => {
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, mode: 'auto' })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, defaultProfile: 'powerful' })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, profiles: [profiles[0], profiles[0]] })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, activeModel: profiles[1].model })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, verifiedAt: 'ieri' })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, command: 'systemctl restart private-ai-llm' })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({
      ...readyFast,
      profiles: [{ ...profiles[0], model: 'qwen\nsecret' }, profiles[1]],
    })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({
      ...readyFast,
      state: 'failed',
      error: '/root/private-ai/controller.log',
    })).toBeNull()
  })

  it('respinge stări incomplete sau combinații care ar prezenta ținta drept activă', () => {
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, activeProfile: null })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...readyFast, requestId })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...switchingPowerful, requestId: null })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({ ...switchingPowerful, requestedProfile: 'fast' })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({
      ...switchingPowerful,
      profiles: [profiles[0], { ...profiles[1], installed: false }],
    })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({
      ...readyFast,
      state: 'failed',
      error: null,
    })).toBeNull()
    expect(parseAdminConstructorModelSnapshot({
      ...readyFast,
      state: 'unavailable',
      error: 'controller_unavailable',
      requestedProfile: 'powerful',
    })).toBeNull()
  })

  it('citește GET fail-closed și elimină orice payload în afara contractului exact', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(readyFast), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...readyFast, token: 'secret' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchConstructorModelAdmin()).resolves.toMatchObject({ activeProfile: 'fast' })
    await expect(fetchConstructorModelAdmin()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/admin/constructor/model', expect.objectContaining({
      credentials: 'include',
      cache: 'no-store',
    }))
  })

  it('trimite numai profilul ales prin click și acceptă 202 doar cu stare switching verificată', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(switchingPowerful), {
      status: 202,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(switchConstructorModelAdmin('powerful')).resolves.toMatchObject({
      kind: 'accepted',
      snapshot: { requestedProfile: 'powerful', activeProfile: 'fast' },
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/admin/constructor/model', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profile: 'powerful' }),
    })
  })

  it('nu transformă statusuri sau ACK-uri contradictorii în succes', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(readyFast), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(switchingPowerful), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'switch_in_progress' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'controller_unavailable' }), { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(switchConstructorModelAdmin('powerful')).resolves.toEqual({ kind: 'failed' })
    await expect(switchConstructorModelAdmin('powerful')).resolves.toEqual({ kind: 'failed' })
    await expect(switchConstructorModelAdmin('powerful')).resolves.toEqual({ kind: 'conflict' })
    await expect(switchConstructorModelAdmin('powerful')).resolves.toEqual({ kind: 'unavailable' })
  })
})
