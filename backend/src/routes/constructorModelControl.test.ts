import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class ConstructorModelControlError extends Error {
    constructor(readonly statusCode: 409 | 503, readonly publicCode: string) {
      super(publicCode)
    }
  }
  return {
    ConstructorModelControlError,
    readConstructorModelSnapshot: vi.fn(),
    requestConstructorModelSwitch: vi.fn(),
    noteazaAuditStrict: vi.fn(),
  }
})

vi.mock('../services/constructorModelControl.js', () => ({
  ConstructorModelControlError: mocks.ConstructorModelControlError,
  readConstructorModelSnapshot: mocks.readConstructorModelSnapshot,
  requestConstructorModelSwitch: mocks.requestConstructorModelSwitch,
}))
vi.mock('../db.js', () => ({ noteazaAuditStrict: mocks.noteazaAuditStrict }))
vi.mock('../session.js', () => ({
  cerAdmin: (
    req: { headers: Record<string, unknown> },
    reply: { code: (status: number) => { send: (body: unknown) => unknown } },
  ) => {
    if (req.headers['x-test-admin'] === 'google') return { email: 'owner@example.test' }
    if (req.headers['x-test-admin'] === 'customer') {
      reply.code(403).send({ error: 'forbidden' })
      return null
    }
    reply.code(401).send({ error: 'unauthorized' })
    return null
  },
}))

const { constructorModelControlRoutes } = await import('./constructorModelControl.js')

const SNAPSHOT = {
  mode: 'manual' as const,
  defaultProfile: 'fast' as const,
  profiles: [
    { id: 'fast' as const, label: 'Rapid', model: 'qwen3.6-35b-a3b-local', installed: true },
    { id: 'powerful' as const, label: 'Puternic', model: 'qwen3.5-122b-a10b-local', installed: true },
  ],
  activeProfile: 'fast' as const,
  activeModel: 'qwen3.6-35b-a3b-local',
  state: 'ready' as const,
  requestedProfile: null,
  requestId: null,
  verifiedAt: '2026-09-01T12:00:00.000Z',
  error: null,
}

async function testApp() {
  const app = Fastify()
  await app.register(constructorModelControlRoutes)
  return app
}

describe('Constructor model Admin routes', () => {
  beforeEach(() => {
    mocks.readConstructorModelSnapshot.mockReset().mockResolvedValue(SNAPSHOT)
    mocks.requestConstructorModelSwitch.mockReset()
    mocks.noteazaAuditStrict.mockReset().mockResolvedValue(undefined)
  })

  it('refuses both routes without the central Google Admin authority', async () => {
    const app = await testApp()
    const anonymous = await app.inject({ method: 'GET', url: '/api/admin/constructor/model' })
    const customer = await app.inject({
      method: 'POST', url: '/api/admin/constructor/model',
      headers: { 'x-test-admin': 'customer' }, payload: { profile: 'fast' },
    })
    expect(anonymous.statusCode).toBe(401)
    expect(customer.statusCode).toBe(403)
    expect(mocks.readConstructorModelSnapshot).not.toHaveBeenCalled()
    expect(mocks.requestConstructorModelSwitch).not.toHaveBeenCalled()
    expect(mocks.noteazaAuditStrict).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns only the measured snapshot with no-store and fails closed on read errors', async () => {
    const app = await testApp()
    const ok = await app.inject({
      method: 'GET', url: '/api/admin/constructor/model', headers: { 'x-test-admin': 'google' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['cache-control']).toBe('no-store')
    expect(ok.json()).toEqual(SNAPSHOT)

    mocks.readConstructorModelSnapshot.mockRejectedValueOnce(new Error('socket down'))
    const unavailable = await app.inject({
      method: 'GET', url: '/api/admin/constructor/model', headers: { 'x-test-admin': 'google' },
    })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toEqual({ error: 'constructor_model_control_unavailable' })
    await app.close()
  })

  it('accepts only an exact fast/powerful body before any side effect', async () => {
    const app = await testApp()
    for (const payload of [
      {},
      { profile: 'auto' },
      { profile: 'fast', force: true },
      { profile: 1 },
      ['fast'],
    ]) {
      const response = await app.inject({
        method: 'POST', url: '/api/admin/constructor/model',
        headers: { 'x-test-admin': 'google' }, payload,
      })
      expect(response.statusCode).toBe(400)
      expect(response.json()).toEqual({ error: 'invalid_constructor_model_profile' })
    }
    expect(mocks.readConstructorModelSnapshot).not.toHaveBeenCalled()
    expect(mocks.noteazaAuditStrict).not.toHaveBeenCalled()
    expect(mocks.requestConstructorModelSwitch).not.toHaveBeenCalled()
    await app.close()
  })

  it('persists the actor and requested transition before accepting the switch', async () => {
    mocks.requestConstructorModelSwitch.mockImplementation(async (_profile: string, requestId: string) => ({
      statusCode: 202,
      snapshot: {
        ...SNAPSHOT,
        state: 'switching',
        requestedProfile: 'powerful',
        requestId,
      },
    }))
    const app = await testApp()
    const response = await app.inject({
      method: 'POST', url: '/api/admin/constructor/model',
      headers: { 'x-test-admin': 'google' }, payload: { profile: 'powerful' },
    })
    expect(response.statusCode).toBe(202)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json()).toMatchObject({
      mode: 'manual', state: 'switching', requestedProfile: 'powerful',
    })
    const requestId = response.json().requestId as string
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.noteazaAuditStrict).toHaveBeenCalledWith(
      'owner@example.test',
      'constructor-model-switch-requested',
      'constructor_runtime',
      requestId,
      'fast',
      'powerful',
    )
    expect(mocks.noteazaAuditStrict.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.requestConstructorModelSwitch.mock.invocationCallOrder[0])
    expect(mocks.requestConstructorModelSwitch).toHaveBeenCalledWith('powerful', requestId, SNAPSHOT)
    await app.close()
  })

  it('does not contact the host when strict audit persistence fails', async () => {
    mocks.noteazaAuditStrict.mockRejectedValueOnce(new Error('db down'))
    const app = await testApp()
    const response = await app.inject({
      method: 'POST', url: '/api/admin/constructor/model',
      headers: { 'x-test-admin': 'google' }, payload: { profile: 'powerful' },
    })
    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ error: 'constructor_model_audit_unavailable' })
    expect(mocks.requestConstructorModelSwitch).not.toHaveBeenCalled()
    await app.close()
  })

  it.each(['switching', 'failed', 'unavailable'] as const)(
    'refuses a new switch from measured state %s before audit or host contact',
    async (state) => {
      mocks.readConstructorModelSnapshot.mockResolvedValueOnce({
        ...SNAPSHOT,
        state,
        ...(state === 'switching'
          ? { requestedProfile: 'powerful', requestId: '123e4567-e89b-42d3-a456-426614174000' }
          : state === 'failed'
            ? { error: 'constructor_model_switch_failed' }
            : { activeProfile: null, activeModel: null, verifiedAt: null, error: 'constructor_model_unavailable' }),
      })
      const app = await testApp()
      const response = await app.inject({
        method: 'POST', url: '/api/admin/constructor/model',
        headers: { 'x-test-admin': 'google' }, payload: { profile: 'powerful' },
      })
      expect(response.statusCode).toBe(409)
      expect(response.json()).toEqual({ error: 'constructor_model_not_ready' })
      expect(mocks.noteazaAuditStrict).not.toHaveBeenCalled()
      expect(mocks.requestConstructorModelSwitch).not.toHaveBeenCalled()
      await app.close()
    },
  )

  it('preserves controller 200/409 semantics without inventing success', async () => {
    const app = await testApp()
    const alreadyActive = await app.inject({
      method: 'POST', url: '/api/admin/constructor/model',
      headers: { 'x-test-admin': 'google' }, payload: { profile: 'fast' },
    })
    expect(alreadyActive.statusCode).toBe(200)
    expect(alreadyActive.json()).toEqual(SNAPSHOT)
    expect(mocks.requestConstructorModelSwitch).not.toHaveBeenCalled()
    expect(mocks.noteazaAuditStrict).not.toHaveBeenCalled()

    mocks.requestConstructorModelSwitch.mockRejectedValueOnce(
      new mocks.ConstructorModelControlError(409, 'model_switch_in_progress'),
    )
    const conflict = await app.inject({
      method: 'POST', url: '/api/admin/constructor/model',
      headers: { 'x-test-admin': 'google' }, payload: { profile: 'powerful' },
    })
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toEqual({ error: 'model_switch_in_progress' })
    await app.close()
  })
})
