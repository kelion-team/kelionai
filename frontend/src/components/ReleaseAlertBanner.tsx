import { useEffect, useRef, useState } from 'react'
import type { User } from '../lib/api'
import { resolveLang } from '../lib/i18n'

interface ReleaseAlert {
  id: string
  title: string
  at: string
}

export default function ReleaseAlertBanner({
  user,
  onOpenReleases,
}: {
  readonly user: User
  readonly onOpenReleases: () => void
}) {
  const [alerts, setAlerts] = useState<ReleaseAlert[]>([])
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
        const arr = j.alerts ?? []
        setAlerts(arr)
        for (const a of arr) {
          if (spokenRef.current.has(a.id)) continue
          spokenRef.current.add(a.id)
          void speak(`Ai un release de aprobat: ${a.title}`, resolveLang(user.locale))
        }
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
  }, [isAdmin])

  const dismiss = async (id: string): Promise<void> => {
    try {
      await fetch('/api/admin/release-alerts/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ id }),
      })
    } catch {
      // ignore
    }
    setAlerts((cur) => cur.filter((a) => a.id !== id))
  }

  const openAndDismiss = (id: string): void => {
    void dismiss(id)
    onOpenReleases()
  }

  if (!isAdmin || alerts.length === 0) return null

  const label =
    alerts.length === 1
      ? `Release de aprobat: „${alerts[0].title}"`
      : `${alerts.length} release-uri de aprobat`

  return (
    <div className="release-alert-banner" role="alert" aria-live="assertive">
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

// Adrian, 11 iul: „vocea care spune release de aprobat trebuie să fie în limba
// userului admin, Chirp 3" — anunțul trece prin sinteza de pe SERVER (aceeași
// voce Chirp 3 HD ca tot restul aplicației), nu prin vocea browserului
// (speechSynthesis e INTERZISĂ — dezinstalată din front pe 4 iul; reintrodusă
// din greșeală aici și scoasă la ordinul lui Adrian).
async function speak(text: string, lang: string): Promise<void> {
  try {
    const r = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ text, lang }),
    })
    if (!r.ok) return
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const audio = new Audio(url)
    audio.onended = () => URL.revokeObjectURL(url)
    void audio.play().catch(() => URL.revokeObjectURL(url))
  } catch {
    // anunțul vocal e best-effort; bannerul vizual rămâne oricum pe ecran
  }
}
