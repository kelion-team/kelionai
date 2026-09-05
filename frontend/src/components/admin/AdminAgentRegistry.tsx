import { useEffect, useRef, useState } from 'react'
import type { AdminAgentRegistrySnapshot } from '../../../../backend/src/shared/agentRegistry'
import { fetchAdminAgentRegistry } from '../../lib/agentRegistry'
import { formatLondonTimestamp } from '../../lib/versionEvidence'

export function AgentRegistryList({ snapshot }: { snapshot: AdminAgentRegistrySnapshot | null | 'loading' }) {
  if (snapshot === 'loading') return <p role="status" className="chat-hint">Se citește registrul agenților…</p>
  if (snapshot === null) return <p role="alert" className="chat-hint">Registrul agenților nu poate fi citit. Nu pot confirma lista celor creați; aceasta nu este o listă goală.</p>
  return <>
    <p className="chat-hint">Registru citit la {formatLondonTimestamp(snapshot.checkedAt) ?? 'un moment neconfirmat'}. Configurația unui rol nu dovedește execuția reușită și nu pornește un proces permanent.</p>
    {(['custom', 'integrated'] as const).map((source) => {
      const agents = snapshot.agents.filter((agent) => agent.source === source)
      return <section key={source} aria-label={source === 'custom' ? 'Agenți creați de administrator' : 'Agenți integrați în aplicație'}>
        <h4>{source === 'custom' ? 'Agenți creați de administrator' : 'Agenți integrați în aplicație'} ({agents.length})</h4>
        {agents.length === 0 ? <p className="chat-hint">Niciun agent în acest grup al registrului citit.</p>
          : <ul className="admin-agent-registry-list" tabIndex={0} aria-label={source === 'custom' ? 'Lista agenților creați' : 'Lista agenților integrați'}>
            {agents.map((agent) => <li key={agent.id}>
              <b>{agent.nume}</b> <code>{agent.id}</code>
              <p className="chat-hint">Rol configurat: {agent.rol}</p>
              <p className="chat-hint">
                {agent.doarAdmin ? 'Numai administrator' : 'Disponibil și utilizatorilor conform drepturilor lor'}
                {' · '}Efort: {agent.efort === 'high' ? 'aprofundat (high)' : 'standard (low)'}
                {' · '}Stare de execuție: nemăsurată.
              </p>
            </li>)}
          </ul>}
      </section>
    })}
  </>
}

/** Reloads persistence after creation; never fabricates a row from the submitted draft. */
export function AdminAgentRegistry({ refreshRevision }: { refreshRevision: number }) {
  const [snapshot, setSnapshot] = useState<AdminAgentRegistrySnapshot | null | 'loading'>('loading')
  const refresh = useRef({ generation: 0, controller: null as AbortController | null })
  const read = (): void => {
    refresh.current.controller?.abort()
    const controller = new AbortController()
    const generation = ++refresh.current.generation
    refresh.current.controller = controller
    setSnapshot('loading')
    void fetchAdminAgentRegistry(controller.signal).then((next) => {
      if (!controller.signal.aborted && generation === refresh.current.generation) setSnapshot(next)
    })
  }
  useEffect(() => {
    const pending = refresh.current
    read()
    return () => { ++pending.generation; pending.controller?.abort() }
  }, [refreshRevision])
  return <div className="admin-subcard">
    <div className="admin-card-head admin-card-head-row">
      <span>Registrul agenților aplicației</span>
      <button type="button" className="ghost" onClick={read}>Reîmprospătează agenții</button>
    </div>
    <AgentRegistryList snapshot={snapshot} />
  </div>
}
