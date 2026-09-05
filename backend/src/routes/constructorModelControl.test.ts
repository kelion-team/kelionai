import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const { readSnapshot } = vi.hoisted(() => ({ readSnapshot: vi.fn() }))
vi.mock('../services/constructorModelControl.js', () => ({ readConstructorModelSnapshot: readSnapshot }))
vi.mock('../session.js', () => ({
  cerAdmin: (req: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (req.headers['x-test-admin'] === 'google') return { email: 'owner@example.test' }
    reply.code(req.headers['x-test-admin'] === 'customer' ? 403 : 401).send({ error: 'forbidden' })
    return null
  },
}))
const { constructorModelControlRoutes } = await import('./constructorModelControl.js')
describe('Constructor engine Admin routes', () => {
  beforeEach(() => { readSnapshot.mockReset() })
  async function app() { const server = Fastify(); await server.register(constructorModelControlRoutes); return server }
  it('protects status and retired writes with central admin authorization', async () => {
    const server = await app()
    for (const method of ['GET', 'POST'] as const) {
      expect((await server.inject({ method, url: '/api/admin/constructor/model' })).statusCode).toBe(401)
      expect((await server.inject({ method, url: '/api/admin/constructor/model', headers: { 'x-test-admin': 'customer' } })).statusCode).toBe(403)
    }
    expect(readSnapshot).not.toHaveBeenCalled()
    await server.close()
  })
  it('reads the measured snapshot without caching and fails closed on unavailable state', async () => {
    const server = await app()
    readSnapshot.mockResolvedValue({ model: { id: 'fixture/model' }, state: 'ready' })
    const result = await server.inject({ method: 'GET', url: '/api/admin/constructor/model', headers: { 'x-test-admin': 'google' } })
    expect(result.statusCode).toBe(200)
    expect(result.headers['cache-control']).toBe('no-store')
    expect(result.json().model.id).toBe('fixture/model')
    readSnapshot.mockRejectedValue(new Error('private detail'))
    const unavailable = await server.inject({ method: 'GET', url: '/api/admin/constructor/model', headers: { 'x-test-admin': 'google' } })
    expect(unavailable.statusCode).toBe(503)
    expect(unavailable.json()).toEqual({ error: 'constructor_model_control_unavailable' })
    await server.close()
  })
  it('retires every local model switch without invoking the controller or launching work', async () => {
    const server = await app()
    for (const profile of ['fast', 'powerful', 'arbitrary']) {
      const result = await server.inject({ method: 'POST', url: '/api/admin/constructor/model', headers: { 'x-test-admin': 'google' }, payload: { profile } })
      expect(result.statusCode).toBe(410)
      expect(result.json()).toEqual({ error: 'constructor_model_switch_retired' })
    }
    expect(readSnapshot).not.toHaveBeenCalled()
    await server.close()
  })
})
