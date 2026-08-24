import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const stare = vi.hoisted(() => ({ email: '', sterse: [] as string[] }))

vi.mock('./session.js', () => ({
  getSessionUser: () => stare.email
    ? { email: stare.email, name: '', picture: '', locale: 'ro', role: 'customer', authProvider: 'google' }
    : null,
}))
vi.mock('./db.js', () => ({
  deleteFaceprint: vi.fn(async (email: string) => {
    stare.sterse.push(email)
    return true
  }),
}))

const { meRoutes } = await import('./routes/me.js')

beforeEach(() => { stare.email = ''; stare.sterse = [] })

describe('DELETE /api/faceprint/me', () => {
  it('cere sesiune', async () => {
    const app = Fastify()
    await app.register(meRoutes)
    const r = await app.inject({ method: 'DELETE', url: '/api/faceprint/me' })
    expect(r.statusCode).toBe(401)
    expect(stare.sterse).toEqual([])
  })

  it('șterge numai referința contului din sesiune, fără email controlat de client', async () => {
    stare.email = 'a@example.test'
    const app = Fastify()
    await app.register(meRoutes)
    const r = await app.inject({
      method: 'DELETE', url: '/api/faceprint/me', payload: { email: 'b@example.test' },
    })
    expect(r.statusCode).toBe(200)
    expect(stare.sterse).toEqual(['a@example.test'])
  })
})
