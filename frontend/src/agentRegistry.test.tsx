import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AdminAgentRegistrySnapshot } from '../../backend/src/shared/agentRegistry'
const { request } = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./lib/transport', () => ({ apiFetch: request }))
import { fetchAdminAgentRegistry, parseAdminAgentRegistry } from './lib/agentRegistry'
import { AgentRegistryList } from './components/admin/AdminAgentRegistry'

const snapshot: AdminAgentRegistrySnapshot = {
  checkedAt: '2026-09-05T07:20:00Z', agents: [
    { id: 'integrated-example', nume: 'Integrated example', rol: 'Configured built-in role', source: 'integrated', efort: 'low', doarAdmin: false, status: null },
    { id: 'custom-example', nume: 'Custom example', rol: 'Configured admin-only role', source: 'custom', efort: 'high', doarAdmin: true, status: null },
  ],
}
const payload = { count: snapshot.agents.length, agents: snapshot.agents.map(({ id, nume, rol }) => ({ id, nume, rol, url: `/api/a2a/${id}` })), adminRegistry: snapshot }
afterEach(() => request.mockReset())

describe('canonical owner agent registry', () => {
  it('accepts authoritative provenance and effective configuration without duplicating the roster', () => {
    expect(parseAdminAgentRegistry(payload)).toEqual(snapshot)
    expect(parseAdminAgentRegistry({ count: 0, agents: [], adminRegistry: { ...snapshot, agents: [] } })?.agents).toEqual([])
  })
  it('rejects missing owner metadata, duplicate IDs, unknown sources and invented online status', () => {
    for (const invalid of [null, {}, { count: 0, agents: [] }, { ...payload, adminRegistry: null },
      { ...payload, adminRegistry: { ...snapshot, checkedAt: null } },
      { ...payload, adminRegistry: { ...snapshot, agents: [snapshot.agents[0], snapshot.agents[0]] } },
      { ...payload, adminRegistry: { ...snapshot, agents: [{ ...snapshot.agents[0], source: undefined }, snapshot.agents[1]] } },
      { ...payload, adminRegistry: { ...snapshot, agents: [{ ...snapshot.agents[0], status: 'online' }, snapshot.agents[1]] } },
      { ...payload, adminRegistry: { ...snapshot, agents: [{ ...snapshot.agents[0], doarAdmin: undefined }, snapshot.agents[1]] } },
      { ...payload, count: 0 }, { ...payload, agents: [payload.agents[0], payload.agents[0]] },
    ]) expect(parseAdminAgentRegistry(invalid)).toBeNull()
  })
  it('reads the existing A2A API no-store and reloads the authoritative persisted list', async () => {
    const signal = new AbortController().signal
    request.mockImplementation(async () => new Response(JSON.stringify(payload)))
    await expect(fetchAdminAgentRegistry(signal)).resolves.toEqual(snapshot)
    await expect(fetchAdminAgentRegistry(signal)).resolves.toEqual(snapshot)
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith('/api/a2a', { credentials: 'include', cache: 'no-store', signal })
  })
  it('does not turn DB/network failure or a public-only response into an empty custom list', async () => {
    const signal = new AbortController().signal
    for (const response of [new Response('{}', { status: 503 }), new Response('null'), new Response(JSON.stringify({ count: 0, agents: [] })), new Response('broken')]) {
      request.mockResolvedValueOnce(response)
      await expect(fetchAdminAgentRegistry(signal)).resolves.toBeNull()
    }
    request.mockRejectedValueOnce(new Error('network'))
    await expect(fetchAdminAgentRegistry(signal)).resolves.toBeNull()
  })
})

describe('agent registry UI remains configuration, not fabricated execution proof', () => {
  it('shows integrated and custom groups with names, roles, authority and effort', () => {
    const html = renderToStaticMarkup(<AgentRegistryList snapshot={snapshot} />)
    for (const expected of ['Agenți creați de administrator (1)', 'Agenți integrați în aplicație (1)',
      'Integrated example', 'Custom example', 'Configured admin-only role', 'Numai administrator', 'aprofundat (high)', 'standard (low)',
      'Stare de execuție: nemăsurată', 'nu pornește un proces permanent']) expect(html).toContain(expected)
    expect(html).not.toContain('online')
  })
  it('keeps unreadable distinct from an empty group and does not infer uptime from role text', () => {
    const html = renderToStaticMarkup(<AgentRegistryList snapshot={null} />)
    expect(html).toContain('aceasta nu este o listă goală')
    expect(html).not.toContain('(0)')
    const role = { ...snapshot, agents: [{ ...snapshot.agents[1], rol: 'Sarcină cerută: rulează 24/7' }] }
    const roleHtml = renderToStaticMarkup(<AgentRegistryList snapshot={role} />)
    expect(roleHtml).toContain('Rol configurat: Sarcină cerută: rulează 24/7')
    expect(roleHtml).toContain('Stare de execuție: nemăsurată')
  })
  it('refreshes only after explicit creation ACK and leaves the list owned by server reads', () => {
    const source = readFileSync(new URL('./components/admin/AdminProductie.tsx', import.meta.url), 'utf8')
    expect(source).toContain("body?.ok !== true || typeof body.id !== 'string'")
    expect(source).toContain('setAgentsRefreshRevision((revision) => revision + 1)')
    expect(source).toContain('<AdminAgentRegistry refreshRevision={agentsRefreshRevision} />')
    expect(source).toContain('if (agentBusyRef.current')
    const registry = readFileSync(new URL('./components/admin/AdminAgentRegistry.tsx', import.meta.url), 'utf8')
    expect(registry).toContain('fetchAdminAgentRegistry(controller.signal)')
    expect(registry).toContain('[refreshRevision]')
    expect(registry).not.toContain('ROSTER')
  })
})
