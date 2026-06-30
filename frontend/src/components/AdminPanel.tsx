import { useEffect, useState } from 'react'
import {
  fetchUsers,
  fetchHistory,
  fetchCosts,
  type UserSummary,
  type HistoryRow,
  type CostSummary,
} from '../lib/admin'

export default function AdminPanel({ onClose }: { readonly onClose: () => void }) {
  const [users, setUsers] = useState<UserSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [costs, setCosts] = useState<CostSummary | null>(null)

  useEffect(() => {
    void fetchUsers().then(setUsers)
  }, [])

  // Live real-cost counter — refresh every 5s while the panel is open.
  useEffect(() => {
    const load = (): void => {
      void fetchCosts().then(setCosts)
    }
    load()
    const id = globalThis.setInterval(load, 5000)
    return () => globalThis.clearInterval(id)
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    void fetchHistory(selected).then((h) => {
      setHistory(h)
      setLoading(false)
    })
  }, [selected])

  return (
    <div className="admin-overlay">
      <div className="admin-panel">
        <header className="admin-head">
          <strong>Admin — chat history</strong>
          {costs && (
            <span className="admin-cost" title="Real provider cost (live)">
              💲 ${costs.total.toFixed(4)} total · ${costs.today.toFixed(4)} today
              {Object.keys(costs.byKind).length > 0 && (
                <span className="admin-cost-kinds">
                  {' '}
                  ({Object.entries(costs.byKind)
                    .map(([k, v]) => `${k} $${v.toFixed(3)}`)
                    .join(' · ')})
                </span>
              )}
            </span>
          )}
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
        </header>
        <div className="admin-body">
          <aside className="admin-users">
            {users.length === 0 && <p className="chat-hint">No history yet.</p>}
            {users.map((u) => (
              <button
                key={u.email}
                type="button"
                className={`admin-user ${selected === u.email ? 'sel' : ''}`}
                onClick={() => setSelected(u.email)}
              >
                <span className="admin-user-email">{u.email}</span>
                <span className="admin-user-meta">
                  {u.count} msg · ${u.cost.toFixed(4)}
                </span>
              </button>
            ))}
          </aside>
          <section className="admin-history">
            {!selected && <p className="chat-hint">Select a user to view their history.</p>}
            {loading && <p className="chat-hint">Loading…</p>}
            {selected &&
              !loading &&
              history.map((h, i) => (
                <div key={i} className={`bubble ${h.role === 'user' ? 'user' : 'assistant'}`}>
                  {h.content}
                </div>
              ))}
          </section>
        </div>
      </div>
    </div>
  )
}
