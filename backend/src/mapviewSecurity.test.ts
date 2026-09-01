import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { coordonateValide, jsonPentruScript, mapviewRoutes } from './routes/mapview.js'

describe('mapview security boundary', () => {
  it('neutralises script-closing text before embedding JSON in HTML', () => {
    const encoded = jsonPentruScript('</script><script>globalThis.pwned=true</script>&')
    expect(encoded).not.toContain('</script>')
    expect(encoded).toContain('\\u003c/script\\u003e')
    expect(encoded).toContain('\\u0026')
  })

  it('accepts only real latitude/longitude pairs', () => {
    expect(coordonateValide([51.5, -0.12])).toBe(true)
    expect(coordonateValide([91, 0])).toBe(false)
    expect(coordonateValide([0, 181])).toBe(false)
    expect(coordonateValide([Number.NaN, 0])).toBe(false)
  })

  it('serves the embedded map with a nonce CSP and escaped query data', async () => {
    const app = Fastify()
    await app.register(mapviewRoutes)
    const attack = '</script><script>globalThis.pwned=true</script>'
    const response = await app.inject({
      method: 'GET',
      url: `/api/route?punct=51.5,-0.12&nume=${encodeURIComponent(attack)}`,
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['content-security-policy']).toMatch(/script-src 'self' 'nonce-[^']+'/)
    expect(response.headers['content-security-policy']).not.toContain("'unsafe-inline'")
    expect(response.body).not.toContain(`var nume="${attack}`)
    expect(response.body).toContain('\\u003c/script\\u003e')
  })

  it('rejects tile coordinates outside the selected zoom grid', async () => {
    const app = Fastify()
    await app.register(mapviewRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/tile/2/4/0' })
    expect(response.statusCode).toBe(400)
    expect(response.json()).toEqual({ error: 'bad_tile' })
  })
})
