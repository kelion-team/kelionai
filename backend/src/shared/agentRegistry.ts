/** Owner-only configuration inventory, not evidence of agent execution. */
export interface AgentRegistryEntry {
  id: string
  nume: string
  rol: string
  source: 'integrated' | 'custom'
  efort: 'low' | 'high'
  doarAdmin: boolean
  status: null
}

export interface AdminAgentRegistrySnapshot {
  checkedAt: string
  agents: AgentRegistryEntry[]
}
