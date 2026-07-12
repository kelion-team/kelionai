import { describe, it, expect } from 'vitest'
import Fastify from 'fastify'
import { bridgeRoutes } from './routes/bridge.js'

async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: false })
  // Mirror production JSON parser so tests exercise the same path.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      done(null, body ? JSON.parse(body as string) : {})
    } catch (err) {
      done(err as Error, undefined)
    }
  })
  await app.register(bridgeRoutes)
  return app
}

describe('POST /api/bridge/client-errors', () => {
  it('accepts a single JSON object body', async () => {
    const app = await buildApp()
    const res = await app.inject({
      method: 'POST',
      url: '/api/bridge/client-errors',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ type: 'console-error', message: 'Something failed', url: '/' }),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ ok: true })
  })

  it('accepts a batched JSON body', async () => {
    const app = await buildApp()
    const batch = [
      { type: 'console-warn', message: 'Deprecation A', url: '/' },
      { type: 'console-warn', message: 'Deprecation B', url: '/' },
    ]
    const res = await app.inject({
      method: 'POST',
      url: '/api/bridge/client-errors',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ batch: JSON.stringify(batch) }),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ ok: true })
  })

  it('accepts a raw string body (sendBeacon text/plain)', async () => {
    const app = await buildApp()
    const body = JSON.stringify({ type: 'console-error', message: 'Beacon error', url: '/' })
    const res = await app.inject({
      method: 'POST',
      url: '/api/bridge/client-errors',
      headers: { 'content-type': 'text/plain' },
      payload: body,
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.payload)).toEqual({ ok: true })
  })
})
