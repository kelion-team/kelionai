import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  user: null as { email: string } | null,
  shots: new Map<string, { owner: string; mime: string; buf: Buffer }>(),
}))

vi.mock('./session.js', () => ({
  getSessionUser: () => state.user,
}))

vi.mock('./services/browser.js', () => ({
  getShot: vi.fn((id: string, email: string) => {
    const shot = state.shots.get(id)
    return shot?.owner === email.toLowerCase() ? shot : null
  }),
}))

const { browserRoutes } = await import('./routes/browser.js')

beforeEach(() => {
  state.user = null
  state.shots.clear()
  state.shots.set('shot-a', {
    owner: 'a@example.test',
    mime: 'image/jpeg',
    buf: Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  })
})

async function app() {
  const server = Fastify()
  await server.register(browserRoutes)
  return server
}

describe('browser screenshot ownership contract', () => {
  it('does not reveal whether a screenshot exists without authentication', async () => {
    const server = await app()
    const response = await server.inject({ method: 'GET', url: '/api/browser/shot/shot-a' })
    expect(response.statusCode).toBe(401)
    expect(response.json()).toEqual({ error: 'unauthorized' })
  })

  it('returns private no-store bytes only to the owning account', async () => {
    const server = await app()
    state.user = { email: 'b@example.test' }
    expect((await server.inject({ method: 'GET', url: '/api/browser/shot/shot-a' })).statusCode).toBe(404)

    state.user = { email: 'A@example.test' }
    const response = await server.inject({ method: 'GET', url: '/api/browser/shot/shot-a' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/jpeg')
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.rawPayload).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))
  })
})
