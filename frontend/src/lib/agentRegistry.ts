import type { AdminAgentRegistrySnapshot, AgentRegistryEntry } from '../../../backend/src/shared/agentRegistry'
import { apiFetch } from './transport'

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0

function entry(value: unknown): value is AgentRegistryEntry {
  return object(value) && text(value.id) && text(value.nume) && text(value.rol)
    && (value.source === 'integrated' || value.source === 'custom')
    && (value.efort === 'low' || value.efort === 'high')
    && typeof value.doarAdmin === 'boolean' && value.status === null
}

/** The server owns origin and authorization; missing privileged metadata is NOT an empty custom roster. */
export function parseAdminAgentRegistry(value: unknown): AdminAgentRegistrySnapshot | null {
  if (!object(value) || !object(value.adminRegistry)) return null
  const registry = value.adminRegistry
  if (!text(registry.checkedAt) || !Number.isFinite(Date.parse(registry.checkedAt))
    || !Array.isArray(registry.agents) || !registry.agents.every(entry)
    || new Set(registry.agents.map((agent) => agent.id)).size !== registry.agents.length) return null
  const entries = registry.agents
  if (value.count !== entries.length || !Array.isArray(value.agents) || value.agents.length !== value.count
    || !value.agents.every((agent) => object(agent) && entries.some((entry) => entry.id === agent.id))
    || new Set(value.agents.map((agent) => (agent as Record<string, unknown>).id)).size !== value.count) return null
  return registry as unknown as AdminAgentRegistrySnapshot
}

export async function fetchAdminAgentRegistry(signal: AbortSignal): Promise<AdminAgentRegistrySnapshot | null> {
  try {
    const response = await apiFetch('/api/a2a', { credentials: 'include', cache: 'no-store', signal })
    return response.ok ? parseAdminAgentRegistry(await response.json()) : null
  } catch {
    return null
  }
}
