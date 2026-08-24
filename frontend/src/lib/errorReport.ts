import { apiFetch } from './transport'
import { verificaConexiuneReala } from './conexiune'
import { redactDiagnostic } from '../../../backend/src/shared/diagnosticRedaction'

// Browser errors are sent in bounded, redacted batches only after connectivity
// is verified. Offline batches remain in memory until a verified reconnect.

const queue: string[] = []
let timer: number | null = null
let onlineListenerArmed = false
let flushing = false
const seen = new Map<string, number>()
const RESEND_AFTER_MS = 5 * 60_000

function reportClientError(msg: string): void {
  const m = redactDiagnostic(msg, 400)
  if (!m) return
  const now = Date.now()
  const last = seen.get(m)
  if (last !== undefined && now - last < RESEND_AFTER_MS) return
  seen.set(m, now)
  if (seen.size > 200) seen.clear() // resetăm dedupul, nu memoria
  queue.push(m)
  if (queue.length > 100) queue.splice(0, queue.length - 100)
  if (timer == null) timer = window.setTimeout(() => void flush(), 3000)
}

function armVerifiedReconnect(): void {
  if (onlineListenerArmed || typeof window === 'undefined') return
  onlineListenerArmed = true
  window.addEventListener('online', onOnline, { once: true })
}

function onOnline(): void {
  onlineListenerArmed = false
  if (timer == null) timer = window.setTimeout(() => void flush(), 0)
}

async function flush(): Promise<void> {
  timer = null
  if (flushing || queue.length === 0) return
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    armVerifiedReconnect()
    return
  }
  flushing = true
  try {
    if (!(await verificaConexiuneReala())) {
      armVerifiedReconnect()
      return
    }
    const errors = queue.slice(0, 10)
    const response = await apiFetch('/api/client-errors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ errors }),
    })
    if (!response.ok) throw new Error(`client_errors_${response.status}`)
    queue.splice(0, errors.length)
  } catch {
    // Păstrăm lotul pentru reconnect; nu îl marcăm trimis pe un răspuns ambiguu.
  } finally {
    flushing = false
  }
  if (queue.length > 0 && timer == null) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) armVerifiedReconnect()
    else timer = window.setTimeout(() => void flush(), 5000)
  }
}

// Simptomele de performanță folosesc același canal redacted și bounded.
export function raporteazaSimptom(msg: string): void {
  reportClientError(msg)
}

export function startErrorReporting(): void {
  window.addEventListener('error', (e) => {
    const src = (e.filename ?? '').split('/').pop()
    reportClientError(`${e.message}${src ? ` @${src}:${e.lineno}` : ''}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    reportClientError(`unhandledrejection: ${String(e.reason).slice(0, 300)}`)
  })
  // console.error is the channel through which our own code also reports
  // symptoms (e.g. voice connection refusal) — we catch them without breaking the console.
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      reportClientError(
        args
          .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)))
          .join(' '),
      )
    } catch {
      /* reporting must never throw */
    }
    orig(...args)
  }
}
