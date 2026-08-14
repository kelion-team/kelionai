import { useEffect, useState } from 'react'

export interface DeployStatusData {
  percent: number
  step: string
  timestamp: string
  active: boolean
  done: boolean
}

/**
 * Bară dinamică de progres pentru deploy pe monitor,
 * conectată în timp real prin Server-Sent Events (SSE) la /api/deploy/status.
 */
export function DeployProgressBar({
  onClose,
  standalone = false,
}: {
  onClose?: () => void
  standalone?: boolean
}) {
  const [status, setStatus] = useState<DeployStatusData>({
    percent: 0,
    step: 'Inițializare conexiune deploy...',
    timestamp: new Date().toISOString(),
    active: true,
    done: false,
  })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let es: EventSource | null = null
    let fallbackTimer: ReturnType<typeof setInterval> | null = null

    try {
      es = new EventSource('/api/deploy/status')

      es.onmessage = (event) => {
        try {
          const data: DeployStatusData = JSON.parse(event.data)
          setStatus(data)
          setError(null)
        } catch {
          // Ignoră mesaje neparsabile (ex. ping-uri)
        }
      }

      es.onerror = () => {
        // Dacă SSE e blocat temporar (ex: buffering), facem fallback la fetch periodic
        if (!fallbackTimer) {
          fallbackTimer = setInterval(async () => {
            try {
              const res = await fetch('/api/deploy/progress')
              if (res.ok) {
                const json: DeployStatusData = await res.json()
                setStatus(json)
                setError(null)
              }
            } catch {
              setError('Conexiune întreruptă cu serverul de deploy')
            }
          }, 2000)
        }
      }
    } catch {
      setError('EventSource nu este disponibil')
    }

    return () => {
      if (es) {
        es.close()
      }
      if (fallbackTimer) {
        clearInterval(fallbackTimer)
      }
    }
  }, [])

  const clampedPercent = Math.min(100, Math.max(0, status.percent))
  const isFinished = status.done || clampedPercent >= 100

  return (
    <div
      className={`deploy-progress-container ${standalone ? 'deploy-progress-standalone' : ''}`}
      style={{
        padding: '16px 20px',
        background: 'rgba(15, 23, 42, 0.92)',
        borderRadius: 12,
        border: '1px solid rgba(255, 255, 255, 0.12)',
        color: '#f8fafc',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
        backdropFilter: 'blur(8px)',
        minWidth: 300,
        maxWidth: 600,
        margin: '0 auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: isFinished ? '#22c55e' : error ? '#ef4444' : '#3b82f6',
              boxShadow: isFinished
                ? '0 0 8px #22c55e'
                : error
                ? '0 0 8px #ef4444'
                : '0 0 8px #3b82f6',
              animation: isFinished ? 'none' : 'pulse 1.5s infinite',
            }}
          />
          <strong style={{ fontSize: '0.95rem', letterSpacing: '0.02em' }}>
            {isFinished ? 'Deploy Finalizat' : 'Deploy în desfășurare'}
          </strong>
        </div>
        <span
          style={{
            fontSize: '1rem',
            fontWeight: 700,
            fontFamily: 'ui-monospace, monospace',
            color: isFinished ? '#4ade80' : '#60a5fa',
          }}
        >
          {clampedPercent}%
        </span>
      </div>

      {/* Bara de progres dinamică */}
      <div
        style={{
          width: '100%',
          height: 10,
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 6,
          overflow: 'hidden',
          position: 'relative',
          marginBottom: 10,
        }}
      >
        <div
          style={{
            width: `${clampedPercent}%`,
            height: '100%',
            backgroundColor: isFinished ? '#22c55e' : '#3b82f6',
            backgroundImage: isFinished
              ? 'linear-gradient(90deg, #16a34a, #22c55e)'
              : 'linear-gradient(90deg, #2563eb, #60a5fa)',
            borderRadius: 6,
            transition: 'width 0.4s ease-in-out',
            boxShadow: isFinished ? '0 0 12px rgba(34, 197, 94, 0.6)' : '0 0 12px rgba(59, 130, 246, 0.6)',
          }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.82rem', color: '#94a3b8' }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>
          {status.step || (isFinished ? 'Toate serviciile sunt sincronizate.' : 'Se execută pașii de deploy...')}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            type="button"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
              cursor: 'pointer',
              fontSize: '0.8rem',
              padding: '2px 6px',
            }}
          >
            Închide
          </button>
        )}
      </div>

      {error && (
        <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#f87171' }}>
          {error}
        </div>
      )}
    </div>
  )
}
