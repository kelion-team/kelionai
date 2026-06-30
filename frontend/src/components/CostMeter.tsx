import { useEffect, useState } from 'react'
import { fetchCosts, type CostSummary } from '../lib/admin'

// Live credit/cost monitor for the top bar (admin only). Polls the real provider
// cost every few seconds and shows the running total plus a per-AI breakdown
// (Claude chat, voice, hearing, search, etc.), in real time as Kelion is used.
const LABELS: Record<string, string> = {
  chat: 'Claude',
  memory: 'memory',
  tts: 'voice',
  asr: 'hearing',
  correct: 'Gemini',
  search: 'search',
}

export default function CostMeter() {
  const [c, setC] = useState<CostSummary | null>(null)
  useEffect(() => {
    let alive = true
    const load = (): void => {
      void fetchCosts().then((v) => {
        if (alive) setC(v)
      })
    }
    load()
    const id = globalThis.setInterval(load, 4000)
    return () => {
      alive = false
      globalThis.clearInterval(id)
    }
  }, [])
  if (!c) return null
  const parts = Object.entries(c.byKind)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  return (
    <div className="cost-meter" title="Real provider cost (live)">
      <span className="cost-total">💲 ${c.total.toFixed(4)}</span>
      <span className="cost-today">today ${c.today.toFixed(4)}</span>
      {parts.length > 0 && (
        <span className="cost-kinds">
          {parts.map(([k, v]) => `${LABELS[k] ?? k} $${v.toFixed(3)}`).join(' · ')}
        </span>
      )}
    </div>
  )
}
