// ── RAPORTAREA ERORILOR DIN BROWSER CĂTRE KELION (F12 → server) ──────────────
// Adrian (24 iul): „el trebuie să aibă acces la logurile F12". Prindem erorile
// consolei (onerror, unhandledrejection, console.error) și le trimitem batch la
// /api/client-errors; serverul le injectează în contextul lui Kelion, care le
// poate ANALIZA când e întrebat de ce nu merge ceva. Dedup + limită, ca să nu
// inunde nici rețeaua, nici contextul.

const queue: string[] = []
let timer: number | null = null
// Dedup CU EXPIRARE (audit 24 iul, P1-4): vechiul Set pe viață trimitea o eroare
// RECURENTĂ o singură dată per sesiune de pagină — după fereastra serverului de
// 15 min, Kelion n-o mai vedea deși încă se producea. Acum retrimitem după 5 min.
const seen = new Map<string, number>()
const RESEND_AFTER_MS = 5 * 60_000

export function reportClientError(msg: string): void {
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
    /* offline — erorile rămân doar în consola locală */
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
  // console.error e canalul prin care și codul nostru raportează simptome
  // (ex: refuzul conexiunii de voce) — le prindem fără să stricăm consola.
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      reportClientError(
        args
          .map((a) => (typeof a === 'string' ? a : a instanceof Error ? a.message : JSON.stringify(a)))
          .join(' '),
      )
    } catch {
      /* raportarea nu are voie să arunce */
    }
    orig(...args)
  }
}
