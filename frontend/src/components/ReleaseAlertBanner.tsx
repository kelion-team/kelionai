import { useEffect, useRef, useState } from 'react'
import type { User } from '../lib/api'

interface ReleaseAlert {
  id: string
  title: string
  at: string
}

const DISMISSED_KEY = 'kelion:dismissed-release-alerts'

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_KEY)
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch {
    return new Set()
  }
}

function saveDismissed(ids: Set<string>): void {
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(ids)))
  } catch {
    // ignore
  }
}

export default function ReleaseAlertBanner({
  user,
  onOpenReleases,
}: {
  readonly user: User
  readonly onOpenReleases: () => void
}) {
  const [alerts, setAlerts] = useState<ReleaseAlert[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(loadDismissed)
  const spokenRef = useRef<Set<string>>(new Set())
  const isAdmin = user.role === 'admin'

  useEffect(() => {
    if (!isAdmin) return
    let alive = true

    const poll = async (): Promise<void> => {
      try {
        const r = await fetch('/api/admin/release-alerts', { credentials: 'include' })
        if (!r.ok) return
        const j = (await r.json()) as { alerts?: ReleaseAlert[] }
        if (!alive) return
        const arr = (j.alerts ?? []).filter((a) => !dismissedIds.has(a.id))
        setAlerts(arr)
        // FĂRĂ VOCE la release-uri (Adrian, 11 iul seara: „scoate vocea când
        // se fac release-uri") — anunțul rămâne vizual: bannerul de aici +
        // becul 💡 care pâlpâie lângă cipul de mod. Setul spokenRef rămâne ca
        // să nu re-anunțăm vizual aceeași alertă la fiecare poll.
        for (const a of arr) spokenRef.current.add(a.id)
      } catch {
        // notificarea e non-critică; eșecul rețelei nu deranjează UI-ul
      }
    }

    void poll()
    const id = window.setInterval(poll, 5_000)
    return () => {
      alive = false
      window.clearInterval(id)
    }
  }, [isAdmin, dismissedIds])

  const dismiss = (id: string): void => {
    setDismissedIds((prev) => {
      const next = new Set(prev)
      next.add(id)
      saveDismissed(next)
      return next
    })
    setAlerts((cur) => cur.filter((a) => a.id !== id))
    void fetch('/api/admin/release-alerts/dismiss', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id }),
    }).catch(() => {
      // ignore
    })
  }

  const openAndDismiss = (id: string): void => {
    dismiss(id)
    onOpenReleases()
  }

  if (!isAdmin || alerts.length === 0) return null

  const label =
    alerts.length === 1
      ? `Release de aprobat: „${alerts[0].title}"`
      : `${alerts.length} release-uri de aprobat`

  return (
    <div className="release-alert-banner" role="alert" aria-live="assertive">
      <button
        type="button"
        className="release-alert-close"
        onClick={() => dismiss(alerts[0].id)}
        aria-label="Închide"
        title="Închide"
      >
        ×
      </button>
      <div className="release-alert-content">
        <span className="release-alert-icon" aria-hidden="true">
          🔔
        </span>
        <span className="release-alert-text">{label}</span>
        <div className="release-alert-actions">
          <button
            type="button"
            className="release-alert-btn primary"
            onClick={() => openAndDismiss(alerts[0].id)}
          >
            Deschide Release-uri
          </button>
          <button
            type="button"
            className="release-alert-btn"
            onClick={() => void dismiss(alerts[0].id)}
          >
            Am văzut
          </button>
        </div>
      </div>
    </div>
  )
}

