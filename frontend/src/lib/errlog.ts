// JURNALUL ERORILOR DE CONSOLĂ (Adrian, 11 iul: „Kelion trebuie să poată
// deschide să vadă erorile astea de consolă, permanent"). Tot ce moare în
// consola browserului — erori JS, promisiuni respinse, console.error — se
// strânge aici și pleacă la pachet către server, unde Kelion le deschide
// oricând prin puntea lui:
//   curl -H "x-bridge-secret: $(cat /root/kelion/bridge-secret.txt)" \
//        https://kelionai.app/api/bridge/client-errors
// Ieftin și tăcut: tampon mic, un singur POST la 10s DOAR dacă există erori.

type Entry = { ts: string; kind: string; msg: string }
const buf: Entry[] = []
let timer: number | null = null

function push(kind: string, msg: string): void {
  const m = msg.trim()
  if (!m) return
  buf.push({ ts: new Date().toISOString(), kind, msg: m.slice(0, 500) })
  if (buf.length > 40) buf.splice(0, buf.length - 40)
  if (timer == null) timer = window.setTimeout(flush, 10_000)
}

function flush(): void {
  timer = null
  if (buf.length === 0) return
  const batch = buf.splice(0, buf.length)
  void fetch('/api/client-errors', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ errors: batch }),
    keepalive: true,
  }).catch(() => {
    /* jurnalul erorilor nu are voie să producă el însuși zgomot */
  })
}

export function installErrLog(): void {
  window.addEventListener('error', (e) => {
    push('error', `${e.message} @ ${e.filename || '?'}:${e.lineno || 0}`)
  })
  window.addEventListener('unhandledrejection', (e) => {
    const r: unknown = e.reason
    push(
      'promise',
      r instanceof Error ? `${r.message} | ${(r.stack ?? '').slice(0, 300)}` : String(r).slice(0, 300),
    )
  })
  // console.error rămâne funcțional — doar copiem mesajul în jurnal.
  const orig = console.error.bind(console)
  console.error = (...args: unknown[]): void => {
    try {
      push(
        'console',
        args
          .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
          .join(' ')
          .slice(0, 500),
      )
    } catch {
      /* niciodată nu stricăm consola reală */
    }
    orig(...args)
  }
  // La părăsirea paginii, ce a rămas în tampon pleacă totuși (keepalive).
  window.addEventListener('pagehide', flush)
}
