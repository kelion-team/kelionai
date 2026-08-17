import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { constructorViuRoutes } from './routes/constructorViu.js'

describe('GET /api/constructor/viu', () => {
  it('returns the expected shape: configurat (boolean), model (string|null), ora (ISO string)', async () => {
    const app = Fastify()
    await app.register(constructorViuRoutes)
    await app.ready()

    const res = await app.inject({ method: 'GET', url: '/api/constructor/viu' })
    expect(res.statusCode).toBe(200)

    const body = res.json()
    expect(typeof body.configurat).toBe('boolean')
    expect(body.model === null || typeof body.model === 'string').toBe(true)
    expect(typeof body.ora).toBe('string')
    // ora should be a valid ISO 8601 date string
    expect(new Date(body.ora).toISOString()).toBe(body.ora)
  })
})
