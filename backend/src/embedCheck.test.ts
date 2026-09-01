import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { callBrowserWorker } = vi.hoisted(() => ({ callBrowserWorker: vi.fn() }))
vi.mock('./services/browserWorker.js', () => ({ callBrowserWorker }))
vi.mock('./session.js', () => ({
  getSessionUser: (req: { headers: Record<string, unknown> }) =>
    req.headers['x-test-user'] === 'yes' ? { email: 'reader@example.invalid', role: 'customer' } : null,
}))

const { citestePagina, embedCheckRoutes } = await import('./routes/embedCheck.js')

describe('isolated readable-page boundary', () => {
  beforeEach(() => callBrowserWorker.mockReset())

  it('rejects malformed, credential-bearing and non-HTTP targets before the worker', async () => {
    await expect(citestePagina('file:///etc/passwd')).resolves.toMatchObject({ ok: false, status: 422 })
    await expect(citestePagina('https://user:pass@example.com/')).resolves.toMatchObject({ ok: false, status: 422 })
    await expect(citestePagina('x'.repeat(2_049))).resolves.toMatchObject({ ok: false, status: 422 })
    expect(callBrowserWorker).not.toHaveBeenCalled()
  })

  it('sends the URL only to the authenticated worker and accepts bounded readable text', async () => {
    callBrowserWorker.mockResolvedValue({
      ok: true,
      status: 200,
      finalUrl: 'https://article.example/read',
      title: 'Measured title',
      text: 'Measured body',
    })
    await expect(citestePagina('https://article.example/read')).resolves.toEqual({
      ok: true,
      titlu: 'Measured title',
      text: 'Measured body',
      urlFinal: 'https://article.example/read',
    })
    expect(callBrowserWorker).toHaveBeenCalledWith('/v1/fetch', {
      url: 'https://article.example/read',
      mode: 'readable',
      maxBytes: 2 * 1024 * 1024,
    }, expect.objectContaining({ maxResponseBytes: 256 * 1024 }))
  })

  it('fails closed on target rejection and distinguishes worker downtime', async () => {
    callBrowserWorker.mockRejectedValueOnce(new Error('browser_worker_request_rejected'))
    await expect(citestePagina('https://blocked.example/path?case=one')).resolves.toEqual({
      ok: false,
      status: 422,
      motiv: 'pagina a fost refuzată de poarta de rețea',
    })
    callBrowserWorker.mockRejectedValueOnce(new Error('internal_service_timeout'))
    await expect(citestePagina('https://offline.example/path?case=two')).resolves.toEqual({
      ok: false,
      status: 503,
      motiv: 'cititorul izolat nu este disponibil',
    })
  })

  it('exposes only authenticated POST JSON; query-string GET is retired', async () => {
    callBrowserWorker.mockResolvedValue({
      ok: true,
      status: 200,
      finalUrl: 'https://route.example/',
      title: 'Route',
      text: 'Body',
    })
    const app = Fastify()
    await app.register(embedCheckRoutes)
    expect((await app.inject({ method: 'GET', url: '/api/citeste-pagina?url=https://route.example/' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'POST', url: '/api/citeste-pagina', payload: { url: 'https://route.example/' } })).statusCode).toBe(401)
    const ok = await app.inject({
      method: 'POST',
      url: '/api/citeste-pagina',
      headers: { 'x-test-user': 'yes' },
      payload: { url: 'https://route.example/' },
    })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['cache-control']).toBe('no-store')
    expect(ok.json()).toMatchObject({ ok: true, titlu: 'Route' })
    await app.close()
  })
})
