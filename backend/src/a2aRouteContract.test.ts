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
  adminAgentRegistry: vi.fn((agents: typeof specialist[]) => ({ checkedAt:new Date().toISOString(),agents:agents.map((agent) => ({
    ...agent,source:agent.id === specialist.id ? 'integrated' : 'custom',efort:'high',status:null,
  })) })),
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
  return email ? { email,role:req.headers['x-test-role'] ?? (email === 'owner@example.test' ? 'admin' : 'customer'),authProvider:req.headers['x-test-provider'] ?? 'google' } : null
}) }))
vi.mock('./services/adminIdentity.js', () => ({ esteAdminKelion: vi.fn((email: string) => email === 'owner@example.test') }))
vi.mock('./db.js', () => ({
  debitWalletMinorAtomar: vi.fn(),
  grantCreditMinor: vi.fn(),
  recordCost: vi.fn(),
}))
vi.mock('./config.js', () => ({ config: { billing: { chatTurnMinor: 1 } } }))

const { a2aRoutes } = await import('./routes/a2a.js')
const { cheamaAgent,rosterViu } = await import('./services/agentiKelion.js')
const { debitWalletMinorAtomar,grantCreditMinor,recordCost } = await import('./db.js')

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
    expect(list.json().adminRegistry.agents.map((agent: { id:string }) => agent.id)).toEqual(list.json().agents.map((agent: { id:string }) => agent.id))
    expect(list.json().adminRegistry.agents.every((agent: { status:unknown }) => agent.status === null)).toBe(true)
    expect(rosterViu).toHaveBeenCalledWith(true)
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

  it('does not expose owner metadata to local identity or customers', async () => {
    const server = await app()
    for (const headers of [{ 'x-test-user':'owner@example.test','x-test-provider':'local' },{ 'x-test-user':'customer@example.test' }]) {
      const result = await server.inject({ method:'GET',url:'/api/a2a',headers })
      expect(result.statusCode).toBe(200)
      expect(result.json()).not.toHaveProperty('adminRegistry')
      expect(result.body).not.toContain(privateSpecialist.id)
    }
    await server.close()
  })

  it('reports owner registry read failure without leaking exception or pretending an empty list', async () => {
    const server = await app()
    vi.mocked(rosterViu).mockRejectedValueOnce(new Error('private database connection details'))
    const result = await server.inject({ method:'GET',url:'/api/a2a',headers:{ 'x-test-user':'owner@example.test' } })
    expect(result.statusCode).toBe(503)
    expect(result.json()).toEqual({ error:'agent_registry_unavailable' })
    expect(result.headers['cache-control']).toBe('private, no-store')
    expect(cheamaAgent).not.toHaveBeenCalled()
    await server.close()
  })

  it('never grants private cards, execution, personal tools or billing exemption by owner email alone', async () => {
    const server = await app()
    for (const headers of [
      { 'x-test-user':'owner@example.test','x-test-provider':'local' },
      { 'x-test-user':'owner@example.test','x-test-role':'customer' },
    ]) {
      for (const suffix of ['', '/.well-known/agent-card.json']) {
        const response = await server.inject({ method:'GET',url:`/api/a2a/${privateSpecialist.id}${suffix}`,headers })
        expect(response.statusCode).toBe(404)
        expect(response.body).not.toContain(privateSpecialist.rol)
      }
      for (const agent of [specialist,privateSpecialist]) {
        const response = await server.inject({ method:'POST',url:`/api/a2a/${agent.id}`,headers,payload:{ text:'Test neautorizat',id:'local-identity-test' } })
        expect(response.statusCode).toBe(403)
        expect(response.json()).toEqual({ error:'forbidden' })
        const rpc = await server.inject({ method:'POST',url:`/api/a2a/${agent.id}`,headers,payload:{ jsonrpc:'2.0',method:'message/send',id:'local-identity-rpc',text:'Test RPC neautorizat' } })
        expect(rpc.json().error.code).toBe(-32003)
        expect(rpc.json()).not.toHaveProperty('result')
      }
    }
    expect(cheamaAgent).not.toHaveBeenCalled()
    expect(debitWalletMinorAtomar).not.toHaveBeenCalled()
    expect(grantCreditMinor).not.toHaveBeenCalled()
    expect(recordCost).not.toHaveBeenCalled()
    await server.close()
  })

  it('preserves zero-debit Google owner execution and ordinary customer billing without personal tools', async () => {
    const server = await app()
    const payload = { text:'Test specialist',id:'authorized-registry-test' }
    expect((await server.inject({ method:'POST',url:`/api/a2a/${specialist.id}`,headers:{ 'x-test-user':'owner@example.test' },payload })).statusCode).toBe(200)
    expect(cheamaAgent).toHaveBeenLastCalledWith(specialist,payload.text,true,'owner@example.test')
    expect(debitWalletMinorAtomar).not.toHaveBeenCalled()
    vi.mocked(debitWalletMinorAtomar).mockResolvedValueOnce({ ok:true,debitedMinor:1 })
    expect((await server.inject({ method:'POST',url:`/api/a2a/${specialist.id}`,headers:{ 'x-test-user':'customer@example.test' },payload })).statusCode).toBe(200)
    expect(debitWalletMinorAtomar).toHaveBeenCalledWith('customer@example.test',1,`a2a:${specialist.id}:${payload.id}`,`a2a:${specialist.id}`)
    expect(cheamaAgent).toHaveBeenLastCalledWith(specialist,payload.text,false,'customer@example.test')
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
