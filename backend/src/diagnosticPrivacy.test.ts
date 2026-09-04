import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { redactDiagnostic, sanitizeDiagnosticUrl } from './shared/diagnosticRedaction.js'

const state = vi.hoisted(() => ({ saved: [] as Array<Record<string, unknown>> }))
vi.mock('./session.js', () => ({
  getSessionUser: () => ({ email: 'owner@example.com', role: 'customer', name: 'Owner', picture: '', locale: 'en', authProvider: 'local' }),
}))
vi.mock('./db.js', () => ({
  getOrCreateClientStorageId: vi.fn(async () => '123e4567-e89b-42d3-a456-426614174000'),
  saveClientError: vi.fn(async (entry: Record<string, unknown>) => { state.saved.push(entry) }),
}))

const { clientErrorRoutes, recentClientErrors } = await import('./routes/clientErrors.js')

beforeEach(() => { state.saved = [] })

describe('diagnostic privacy', () => {
  it('redacts credentials, identifiers and URL queries before use', () => {
    const raw = 'owner@example.com Bearer abcdefghijkl sk-proj-abcdefgh token=topsecret ' +
      'https://example.com/path?access_token=bad 127.0.0.1 4242 4242 4242 4242 C:\\Users\\Adrian\\app.ts'
    const clean = redactDiagnostic(raw)
    expect(clean).not.toContain('owner@example.com')
    expect(clean).not.toContain('abcdefghijkl')
    expect(clean).not.toContain('topsecret')
    expect(clean).not.toContain('access_token')
    expect(clean).not.toContain('127.0.0.1')
    expect(clean).not.toContain('4242 4242')
    expect(clean).not.toContain('Adrian')
    expect(clean).toContain('https://example.com/path')
    expect(sanitizeDiagnosticUrl('https://example.com/a?token=x#secret')).toBe('https://example.com/a')
  })

  it('uses the same redacted value in memory and durable storage', async () => {
    const app = Fastify()
    await app.register(clientErrorRoutes)
    const response = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: { errors: ['failed for owner@example.com with sk-proj-abcdefgh at 10.0.0.2'] },
    })
    expect(response.statusCode).toBe(200)
    expect(String(state.saved[0]?.message)).not.toContain('owner@example.com')
    expect(String(state.saved[0]?.message)).not.toContain('sk-proj-')
    expect(String(state.saved[0]?.message)).not.toContain('10.0.0.2')
    expect(recentClientErrors('owner@example.com').join(' ')).toContain(String(state.saved[0]?.message))
  })

  // Fără linia asta, textul erorii de browser exista NUMAI în tabela
  // `client_errors` din baza externă: cine se uita la `docker logs` vedea doar
  // că a sosit un POST, nu și ce scria în el — exact orbirea care a ținut
  // diagnosticul „chatul audio live crapă aplicația" pe loc.
  it('scrie eroarea (redactată) și în jurnalul serverului, nu doar în tabelă', async () => {
    const linii: string[] = []
    const app = Fastify({
      logger: {
        level: 'warn',
        stream: { write: (linie: string) => { linii.push(linie) } },
      },
    })
    await app.register(clientErrorRoutes)
    const response = await app.inject({
      method: 'POST',
      url: '/api/client-errors',
      payload: { errors: ['[voce] sesiune vocala indisponibila la owner@example.com'] },
    })
    expect(response.statusCode).toBe(200)
    const jurnal = linii.join('\n')
    expect(jurnal).toContain('client-error: [voce] sesiune vocala indisponibila')
    // Jurnalul primește exact textul REDACTAT, nu cel brut.
    expect(jurnal).not.toContain('owner@example.com')
  })

  it('păstrează stiva trimisă de browser (plafon peste vechii 400 de caractere)', async () => {
    const app = Fastify()
    await app.register(clientErrorRoutes)
    const stiva = `TypeError: boom | ${'at redaFloat32 (vocalLive.ts) '.repeat(30)}`
    expect(stiva.length).toBeGreaterThan(400)
    const response = await app.inject({
      method: 'POST', url: '/api/client-errors', payload: { errors: [stiva] },
    })
    expect(response.statusCode).toBe(200)
    expect(String(state.saved[0]?.message).length).toBeGreaterThan(400)
  })

  it('rejects oversized batches instead of silently truncating them', async () => {
    const app = Fastify()
    await app.register(clientErrorRoutes)
    const response = await app.inject({ method: 'POST', url: '/api/client-errors', payload: { errors: Array(11).fill('x') } })
    expect(response.statusCode).toBe(413)
  })
})
