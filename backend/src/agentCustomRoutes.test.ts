import Fastify from 'fastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_CUSTOM_ROLE_MAX_LENGTH } from './shared/agentCustomPolicy.js'

const { adaugaAgentCustom, listaAgentiCustom } = vi.hoisted(() => ({ adaugaAgentCustom: vi.fn(), listaAgentiCustom: vi.fn() }))
vi.mock('./db.js', () => ({ adaugaAgentCustom, listaAgentiCustom, searchMemories: vi.fn(), getGoogleRefreshToken: vi.fn() }))
vi.mock('./services/creierRationament.js', () => ({ rationeazaMesaje: vi.fn() }))
vi.mock('./services/google.js', () => ({ webSearch: vi.fn(), googleTools: [], runGoogleTool: vi.fn(), refreshGoogleAccessToken: vi.fn() }))
vi.mock('./config.js', () => ({ config: { publicOrigin: 'https://example.test', openai: { heavy: 'fixture', luna: 'fixture' } } }))
vi.mock('./session.js', () => ({
  cerAdmin: (req: { headers: Record<string, unknown> }, reply: { code: (status: number) => unknown }) => {
    if (req.headers['x-test-user'] === 'owner') return { email: 'owner@example.test' }
    reply.code(req.headers['x-test-user'] === 'customer' ? 403 : 401)
    return null
  },
}))

const { enterpriseRoutes } = await import('./routes/enterprise.js')
const { ROSTER, executaAgentNou, rosterViu,adminAgentRegistry } = await import('./services/agentiKelion.js')

async function app() {
  const server = Fastify()
  await server.register(enterpriseRoutes)
  return server
}

describe('specialist creation uses one validated live-roster contract', () => {
  beforeEach(() => {
    adaugaAgentCustom.mockReset().mockResolvedValue(null)
    listaAgentiCustom.mockReset().mockResolvedValue([])
  })

  it('keeps creation admin-only before validating or persisting any content', async () => {
    const server = await app()
    for (const [identity, status] of [['', 401], ['customer', 403]] as const) {
      const response = await server.inject({ method: 'POST', url: '/api/enterprise/agent-nou', headers: { 'x-test-user': identity }, payload: { nume: 'Agent nou', rol: 'Rol verificat de test' } })
      expect(response.statusCode).toBe(status)
    }
    expect(adaugaAgentCustom).not.toHaveBeenCalled()
    await server.close()
  })

  it('rejects every reserved built-in ID through the API and the chat tool without writing a phantom agent', async () => {
    const server = await app()
    for (const agent of ROSTER) {
      const payload = { nume: `Agent ${agent.id}`, rol: 'Alt rol care nu trebuie salvat' }
      const response = await server.inject({ method: 'POST', url: '/api/enterprise/agent-nou', headers: { 'x-test-user': 'owner' }, payload })
      expect(response.statusCode, agent.id).toBe(409)
      expect(response.json().error).toContain('rezervat')
      expect(JSON.parse(await executaAgentNou(payload.nume, payload.rol, false)).error).toContain('rezervat')
    }
    expect(adaugaAgentCustom).not.toHaveBeenCalled()
    await server.close()
  })

  it('rejects 501-character roles rather than silently discarding limits at the end', async () => {
    const server = await app()
    const rol = 'x'.repeat(AGENT_CUSTOM_ROLE_MAX_LENGTH + 1)
    const response = await server.inject({ method: 'POST', url: '/api/enterprise/agent-nou', headers: { 'x-test-user': 'owner' }, payload: { nume: 'Agent nou verificat', rol } })
    expect(response.statusCode).toBe(400)
    expect(response.json().error).toContain(String(AGENT_CUSTOM_ROLE_MAX_LENGTH))
    expect(JSON.parse(await executaAgentNou('Agent nou verificat', rol, true)).error).toContain(String(AGENT_CUSTOM_ROLE_MAX_LENGTH))
    expect(adaugaAgentCustom).not.toHaveBeenCalled()
    await server.close()
  })

  it('persists the complete allowed role and requested options, then exposes that exact custom agent in the live roster', async () => {
    const server = await app()
    const rol = `${'x'.repeat(AGENT_CUSTOM_ROLE_MAX_LENGTH - 10)}LIMITA-XYZ`
    const payload = { nume: 'Agent măsurat nou', rol, efort: 'high', doarAdmin: true }
    const response = await server.inject({ method: 'POST', url: '/api/enterprise/agent-nou', headers: { 'x-test-user': 'owner' }, payload })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ ok: true, id: 'masurat-nou' })
    expect(adaugaAgentCustom).toHaveBeenCalledWith({ id: 'masurat-nou', nume: payload.nume, rol, efort: 'high', doarAdmin: true })
    const persisted = adaugaAgentCustom.mock.calls[0][0]
    listaAgentiCustom.mockResolvedValue([persisted])
    expect((await rosterViu()).find((agent) => agent.id === 'masurat-nou')).toEqual(persisted)
    await server.close()
  })

  it('does not report success for an existing custom ID or malformed fields', async () => {
    const server = await app()
    adaugaAgentCustom.mockResolvedValue('există deja un agent cu acest id')
    const duplicate = await server.inject({ method: 'POST', url: '/api/enterprise/agent-nou', headers: { 'x-test-user': 'owner' }, payload: { nume: 'Agent nou verificat', rol: 'Rol verificat de test' } })
    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json()).not.toHaveProperty('ok', true)
    adaugaAgentCustom.mockClear()
    for (const payload of [{ nume: 123, rol: 'Rol verificat de test' }, { nume: 'Agent nou verificat', rol: {} }]) {
      const response = await server.inject({ method: 'POST', url: '/api/enterprise/agent-nou', headers: { 'x-test-user': 'owner' }, payload })
      expect(response.statusCode).toBe(400)
    }
    expect(adaugaAgentCustom).not.toHaveBeenCalled()
    await server.close()
  })

  it('keeps explicit low effort and inventories the same deduplicated roster without an execution claim', async () => {
    const server = await app()
    const payload = { nume:'Agent standard verificat',rol:'Rol standard de test',efort:'low',doarAdmin:true }
    const response = await server.inject({ method:'POST',url:'/api/enterprise/agent-nou',headers:{ 'x-test-user':'owner' },payload })
    expect(response.statusCode).toBe(200)
    const persisted = adaugaAgentCustom.mock.calls[0][0]
    expect(persisted.efort).toBe('low')
    listaAgentiCustom.mockResolvedValue([ { ...ROSTER[0],rol:'Nu înlocuiește codul integrat' },persisted,persisted ])
    const roster = await rosterViu(true)
    expect(listaAgentiCustom).toHaveBeenLastCalledWith(true)
    expect(new Set(roster.map((agent) => agent.id)).size).toBe(roster.length)
    expect(roster[0]).toEqual(ROSTER[0])
    const registry = adminAgentRegistry(roster)
    expect(Number.isFinite(Date.parse(registry.checkedAt))).toBe(true)
    expect(registry.agents.find((agent) => agent.id === persisted.id)).toEqual({ ...persisted,source:'custom',status:null })
    for (const builtin of ROSTER) expect(registry.agents.find((agent) => agent.id === builtin.id))
      .toMatchObject({ source:'integrated',efort:builtin.efort ?? 'high',doarAdmin:builtin.doarAdmin === true,status:null })
    await server.close()
  })
})
