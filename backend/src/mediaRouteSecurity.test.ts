import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ email: '' }))

vi.mock('./session.js', () => ({
  getSessionUser: () => state.email
    ? { email: state.email, name: 'Test', role: 'customer', picture: '', locale: 'en', authProvider: 'local' }
    : null,
}))
vi.mock('./services/image.js', () => ({
  getImage: vi.fn(async (_id: string, owner: string) => owner === 'owner@example.com'
    ? { mime: 'image/png', buf: Buffer.from('png') }
    : null),
}))
vi.mock('./services/video.js', () => ({
  getVideo: vi.fn(async (_id: string, owner: string) => owner === 'owner@example.com'
    ? { mime: 'video/mp4', buf: Buffer.from('mp4') }
    : null),
}))

const { imageRoutes } = await import('./routes/image.js')
const ID = '123e4567-e89b-42d3-a456-426614174000'

beforeEach(() => { state.email = '' })

describe('generated media object authorization', () => {
  it('does not expose bytes to an unauthenticated request', async () => {
    const app = Fastify()
    await app.register(imageRoutes)
    const response = await app.inject({ method: 'GET', url: `/api/image/${ID}` })
    expect(response.statusCode).toBe(401)
  })

  it('serves only the authenticated owner with private, non-sniffable headers', async () => {
    state.email = 'owner@example.com'
    const app = Fastify()
    await app.register(imageRoutes)
    const response = await app.inject({ method: 'GET', url: `/api/image/${ID}` })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, max-age=3600')
    expect(response.headers['x-content-type-options']).toBe('nosniff')
    expect(response.headers['cross-origin-resource-policy']).toBe('same-origin')
  })

  it('returns the same opaque 404 for another account and malformed ids', async () => {
    state.email = 'other@example.com'
    const app = Fastify()
    await app.register(imageRoutes)
    expect((await app.inject({ method: 'GET', url: `/api/video/${ID}` })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/image/not-an-id' })).statusCode).toBe(404)
  })
})
