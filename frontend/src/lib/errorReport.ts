// ── RAPORTAREA ERORILOR DIN BROWSER CĂTRE KELION (F12 → server) ──────────────
// Adrian (24 iul): „el trebuie să aibă acces la logurile F12". Prindem erorile
// consolei (onerror, unhandledrejection, console.error) și le trimitem batch la
// /api/client-errors; serverul le injectează în contextul lui Kelion, care le
// poate ANALIZA când e întrebat de ce nu merge ceva. Dedup + limită, ca să nu
// inunde nici rețeaua, nici contextul.

const queue: string[] = []
let timer: number | null = null
const seen = new Set<string>()

export function reportClientError(msg: string): void {
  const m = (msg ?? '').slice(0, 400).trim()
  if (!m || seen.has(m)) return
  seen.add(m)
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
