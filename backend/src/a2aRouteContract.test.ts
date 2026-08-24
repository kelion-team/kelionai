import Fastify from 'fastify'
import { describe, expect, it, vi } from 'vitest'

const specialist = {
  id: 'cautator',
  nume: 'Căutător',
  rol: 'documentare',
  doarAdmin: false,
}

vi.mock('./services/agentiKelion.js', () => ({
  rosterViu: vi.fn(async () => [specialist]),
  gasesteAgentViu: vi.fn(async (id: string) => id === specialist.id ? specialist : null),
  carteAgent: vi.fn((agent: typeof specialist) => ({
    name: agent.nume,
    url: `/api/a2a/${agent.id}`,
    skills: [{ id: agent.id }],
  })),
  cheamaAgent: vi.fn(),
}))

vi.mock('./session.js', () => ({ getSessionUser: vi.fn(() => null) }))
vi.mock('./services/adminIdentity.js', () => ({ esteAdminKelion: vi.fn(() => false) }))
vi.mock('./db.js', () => ({
  debitWalletMinorAtomar: vi.fn(),
  grantCreditMinor: vi.fn(),
  recordCost: vi.fn(),
}))
vi.mock('./config.js', () => ({ config: { billing: { chatTurnMinor: 1 } } }))

const { a2aRoutes } = await import('./routes/a2a.js')

async function app() {
  const server = Fastify()
  await server.register(a2aRoutes)
  return server
}

describe('public A2A discovery contract', () => {
  it('lists the live roster without executing an agent', async () => {
    const response = await (await app()).inject({ method: 'GET', url: '/api/a2a' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      count: 1,
      agents: [{ id: specialist.id, nume: specialist.nume, rol: specialist.rol, url: '/api/a2a/cautator' }],
    })
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
