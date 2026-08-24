import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { dateSimbol } = vi.hoisted(() => ({ dateSimbol: vi.fn() }))

vi.mock('./session.js', () => ({
  cerAdmin: (req: { headers: Record<string, unknown> }, reply: { code: (status: number) => { send: (body: unknown) => unknown } }) => {
    if (req.headers['x-test-admin'] === 'yes') return { email: 'admin@example.invalid' }
    reply.code(401).send({ error: 'unauthorized' })
    return null
  },
}))
vi.mock('./db.js', () => ({ addMemory: vi.fn(), searchMemories: vi.fn() }))
vi.mock('./services/agentiKelion.js', () => ({ gasesteAgent: vi.fn(), cheamaAgent: vi.fn() }))
vi.mock('./services/piete.js', () => ({
  cererePiata: (simbolBrut: unknown, intervalBrut: unknown) => {
    const simbol = typeof simbolBrut === 'string' ? simbolBrut.trim().toUpperCase() : ''
    const interval = typeof intervalBrut === 'string' ? intervalBrut : ''
    if (!/^[A-Z0-9.^]{1,14}$/.test(simbol)) return { error: 'simbol invalid' }
    if (!['1m', '15m', '1h', '4h', '1d'].includes(interval)) return { error: 'interval invalid' }
    return { simbol, interval }
  },
  dateSimbol,
  rezumatPentruAgent: vi.fn(),
}))
vi.mock('./config.js', () => ({ config: {
  publicOrigin: 'https://kelion.example',
  adminEmail: 'admin@example.invalid',
  endpoints: { binanceWebSocketBase: 'wss://market-stream.example:9443' },
} }))

const { tranzactiiRoutes } = await import('./routes/tranzactii.js')

describe('trading centre browser boundary', () => {
  beforeEach(() => dateSimbol.mockReset())

  it('does not expose the trading page without an admin session', async () => {
    const app = Fastify()
    await app.register(tranzactiiRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/tranzactii' })
    expect(response.statusCode).toBe(401)
    await app.close()
  })

  it('serves a nonce-locked same-origin frame and binds both directions of postMessage', async () => {
    const app = Fastify()
    await app.register(tranzactiiRoutes)
    const response = await app.inject({ method: 'GET', url: '/api/tranzactii', headers: { 'x-test-admin': 'yes' } })
    expect(response.statusCode).toBe(200)
    const csp = String(response.headers['content-security-policy'])
    const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(csp)?.[1]
    expect(nonce).toBeTruthy()
    expect(csp).toContain("style-src-attr 'none'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).not.toContain("script-src 'unsafe-inline'")
    expect(response.body).toContain(`<script nonce="${nonce}">`)
    expect(response.body).toContain(`<style nonce="${nonce}">`)
    expect(response.body).toContain('var PARENT_ORIGIN="https://kelion.example"')
    expect(response.body).toContain('var BINANCE_WS_BASE="wss://market-stream.example:9443"')
    expect(csp).toContain('connect-src \'self\' wss://market-stream.example:9443')
    expect(response.body).toContain('ev.origin!==PARENT_ORIGIN||ev.source!==window.parent')
    expect(response.body).not.toContain(",'*')")
    await app.close()
  })

  it('rejects invalid market requests before calling a provider', async () => {
    const app = Fastify()
    await app.register(tranzactiiRoutes)
    const response = await app.inject({
      method: 'GET',
      url: `/api/tranzactii/date?simbol=${encodeURIComponent('BTCUSDT<script>')}&interval=1h`,
      headers: { 'x-test-admin': 'yes' },
    })
    expect(response.statusCode).toBe(400)
    expect(dateSimbol).not.toHaveBeenCalled()
    await app.close()
  })

  it('returns validated provider data without allowing shared caches', async () => {
    dateSimbol.mockResolvedValue({
      simbol: 'BTCUSDT', sursa: 'Binance', interval: '1h', assetClass: 'crypto', intervalMode: 'intraday',
      liveFeed: { provider: 'binance', symbol: 'BTCUSDT' }, pret: 10, variatie24h: 1,
      lumanari: [
        { t: 1, deschis: 9, maxim: 11, minim: 8, inchis: 10, volum: 1 },
        { t: 2, deschis: 10, maxim: 12, minim: 9, inchis: 11, volum: 2 },
      ],
    })
    const app = Fastify()
    await app.register(tranzactiiRoutes)
    const response = await app.inject({
      method: 'GET', url: '/api/tranzactii/date?simbol=BTCUSDT&interval=1h', headers: { 'x-test-admin': 'yes' },
    })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('no-store')
    expect(response.json().liveFeed).toEqual({ provider: 'binance', symbol: 'BTCUSDT' })
    await app.close()
  })
})
