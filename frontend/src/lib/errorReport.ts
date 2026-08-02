// ── REPORTING BROWSER ERRORS TO KELION (F12 → server) ─────────────────────
// Adrian (Jul 24): "he must have access to the F12 logs". We catch console
// errors (onerror, unhandledrejection, console.error) and send them in batches
// to /api/client-errors; the server injects them into Kelion's context, so he
// can ANALYZE them when asked why something doesn't work. Dedup + cap, so it
// floods neither the network nor the context.

const queue: string[] = []
let timer: number | null = null
// Dedup WITH EXPIRY (Jul 24 audit, P1-4): the old lifetime Set sent a
// RECURRENT error only once per page session — after the server's 15-min
// window, Kelion no longer saw it even though it kept happening. Now we
// resend after 5 min.
const seen = new Map<string, number>()
const RESEND_AFTER_MS = 5 * 60_000

function reportClientError(msg: string): void {
  const m = (msg ?? '').slice(0, 400).trim()
  if (!m) return
  const now = Date.now()
  const last = seen.get(m)
  if (last !== undefined && now - last < RESEND_AFTER_MS) return
  seen.set(m, now)
  if (seen.size > 200) seen.clear() // resetăm dedupul, nu memoria
  queue.push(m)
  if (timer == null) timer = window.setTimeout(() => void flush(), 3000)
}

async function flush(): Promise<void> {
  timer = null
  const errors = queue.splice(0, 10)
  if (errors.length === 0) return
  try {
    await fetch('/api/client-errors', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ errors }),
    })
  } catch {
    /* offline — errors stay only in the local console */
  }
  if (queue.length > 0) timer = window.setTimeout(() => void flush(), 3000)
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
