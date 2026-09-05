import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const specialist = {
  id: 'cautator',
  nume: 'Căutător',
  rol: 'documentare',
  doarAdmin: false,
}
const privateSpecialist = { id: 'admin-custom', nume: 'Agent privat', rol: 'Instrucțiune administrativă privată', doarAdmin: true }

vi.mock('./services/agentiKelion.js', () => ({
  rosterViu: vi.fn(async () => [specialist, privateSpecialist]),
  gasesteAgentViu: vi.fn(async (id: string) => [specialist, privateSpecialist].find((agent) => agent.id === id) ?? null),
  carteAgent: vi.fn((agent: typeof specialist) => ({
    name: agent.nume,
    description: agent.rol,
    url: `/api/a2a/${agent.id}`,
    skills: [{ id: agent.id }],
  })),
  cheamaAgent: vi.fn(async () => ({ agent: 'admin-custom', model: 'fixture', text: 'rezultat' })),
}))

vi.mock('./session.js', () => ({ getSessionUser: vi.fn((req: { headers: Record<string, string> }) => {
  const email = req.headers['x-test-user']
  return email ? { email } : null
}) }))
vi.mock('./services/adminIdentity.js', () => ({ esteAdminKelion: vi.fn((email: string) => email === 'owner@example.test') }))
vi.mock('./db.js', () => ({
  debitWalletMinorAtomar: vi.fn(),
  grantCreditMinor: vi.fn(),
  recordCost: vi.fn(),
}))
vi.mock('./config.js', () => ({ config: { billing: { chatTurnMinor: 1 } } }))

const { a2aRoutes } = await import('./routes/a2a.js')
const { cheamaAgent } = await import('./services/agentiKelion.js')

async function app() {
  const server = Fastify()
  await server.register(a2aRoutes)
  return server
}

describe('public A2A discovery contract', () => {
  beforeEach(() => vi.clearAllMocks())
  it('lists the live roster without executing an agent', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/api/a2a' })
    expect(response.statusCode).toBe(200)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.json()).toEqual({
      count: 1,
      agents: [{ id: specialist.id, nume: specialist.nume, rol: specialist.rol, url: '/api/a2a/cautator' }],
    })
  })

  it('hides admin-only roster entries and cards from anonymous users and ordinary sessions', async () => {
    const server = await app()
    for (const headers of [{}, { 'x-test-user': 'customer@example.test' }]) {
      const list = await server.inject({ method: 'GET', url: '/api/a2a', headers })
      expect(list.json().count).toBe(1)
      expect(list.body).not.toContain(privateSpecialist.id)
      expect(list.body).not.toContain(privateSpecialist.rol)
      for (const suffix of ['', '/.well-known/agent-card.json']) {
        const card = await server.inject({ method: 'GET', url: `/api/a2a/${privateSpecialist.id}${suffix}`, headers })
        expect(card.statusCode).toBe(404)
        expect(card.headers['cache-control']).toBe('private, no-store')
        expect(card.body).not.toContain(privateSpecialist.rol)
      }
    }
    expect(cheamaAgent).not.toHaveBeenCalled()
    await server.close()
  })

  it('allows only the owner to discover the private role without caching it', async () => {
    const server = await app()
    const headers = { 'x-test-user': 'owner@example.test' }
    const list = await server.inject({ method: 'GET', url: '/api/a2a', headers })
    expect(list.json().agents).toContainEqual(expect.objectContaining({ id: privateSpecialist.id, rol: privateSpecialist.rol }))
    expect(list.headers['cache-control']).toBe('private, no-store')
    for (const suffix of ['', '/.well-known/agent-card.json']) {
      const card = await server.inject({ method: 'GET', url: `/api/a2a/${privateSpecialist.id}${suffix}`, headers })
      expect(card.statusCode).toBe(200)
      expect(card.json().description).toBe(privateSpecialist.rol)
      expect(card.headers['cache-control']).toBe('private, no-store')
    }
    expect(cheamaAgent).not.toHaveBeenCalled()
    await server.close()
  })

  it('preserves 401/403 execution authorization and owner execution for private agents', async () => {
    const server = await app()
    const request = { method: 'POST' as const, url: `/api/a2a/${privateSpecialist.id}`, payload: { text: 'Sarcină de verificare' } }
    expect((await server.inject(request)).statusCode).toBe(401)
    expect((await server.inject({ ...request, headers: { 'x-test-user': 'customer@example.test' } })).statusCode).toBe(403)
    expect(cheamaAgent).not.toHaveBeenCalled()
    expect((await server.inject({ ...request, headers: { 'x-test-user': 'owner@example.test' } })).statusCode).toBe(200)
    expect(cheamaAgent).toHaveBeenCalledOnce()
    expect(cheamaAgent).toHaveBeenCalledWith(privateSpecialist, request.payload.text, true, 'owner@example.test')
    await server.close()
  })

  it('serves the well-known card and returns 404 for an unknown specialist', async () => {
    const server = await app()
    const card = await server.inject({
      method: 'GET',
      url: '/api/a2a/cautator/.well-known/agent-card.json',
    })
    expect(card.statusCode).toBe(200)
    expect(card.json()).toMatchObject({ name: specialist.nume, url: '/api/a2a/cautator' })

    const missing = await server.inject({
      method: 'GET',
      url: '/api/a2a/inexistent/.well-known/agent-card.json',
    })
    expect(missing.statusCode).toBe(404)
    expect(missing.json()).toEqual({ error: 'agent necunoscut' })
  })
})
