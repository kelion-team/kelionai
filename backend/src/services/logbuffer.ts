import { Writable } from 'node:stream'

// ── THE SERVER'S F12 (Adrian, 27 Jul: "these logs must absolutely reach
// Kelion like F12") ────────────────────────────────────────────────────────
// CLIENT errors already reach Kelion through /api/client-errors (the
// browser's F12). The SERVER logs, however, lived only in `docker logs`,
// which Kelion cannot reach (he runs in a container, without docker.sock —
// and that is correct). The solution: a memory ring that keeps the latest
// entries straight from the app's pino stream; the admin tool `server_logs`
// (chat.ts) hands them to Kelion natively, exactly as `db_query` hands him
// the client errors.

export interface LogEntry {
  t: string // ISO time
  level: number // pino: 30 info, 40 warn, 50 error, 60 fatal
  msg: string
}

const MAX_ENTRIES = 2000 // mărit 13 aug (era 600) — Kelion să aibă istoric real de citit
const ring: LogEntry[] = []

function push(e: LogEntry): void {
  ring.push(e)
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES)
}

function safeStringify(a: unknown): string {
  if (a === null || a === undefined) return String(a)
  if (typeof a === 'string') return a
  if (a instanceof Error) return a.stack || `${a.name}: ${a.message}`
  if (typeof a === 'symbol' || typeof a === 'bigint') return String(a)
  try {
    return JSON.stringify(a)
  } catch {
    try {
      return String(a)
    } catch {
      return '[Unserializable]'
    }
  }
}

/** Pino stream: keeps writing to stdout (docker logs stays intact) AND
 *  retains entries in the ring. Reqid/req/res are compressed to a short
 *  summary so the ring holds SIGNAL, not access noise. */
export function makeLogTee(): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, cb) {
      try {
        process.stdout.write(chunk)
      } catch {
        /* ignore write error to prevent server crash */
      }
      try {
        const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8')
        for (const line of text.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed) continue
          try {
            const j = JSON.parse(trimmed) as {
              time?: number
              level?: number
              msg?: string
              reqId?: string
              req?: { method?: string; url?: string }
              res?: { statusCode?: number }
              err?: { message?: string; stack?: string }
              reason?: unknown
            }
            const level = j.level ?? 30
            // Access noise (request completed 2xx/3xx) does NOT enter the
            // ring — only errors, warnings and real applicative messages.
            const code = j.res?.statusCode ?? 0
            const isAccessNoise =
              level <= 30 && (j.msg === 'request completed' || j.msg === 'incoming request') && code < 400
            if (isAccessNoise) continue
            const parts: string[] = []
            if (j.req?.method) parts.push(`${j.req.method} ${j.req.url ?? ''}`)
            if (code) parts.push(`→ ${code}`)
            if (j.msg) parts.push(j.msg)
            if (j.err?.message) parts.push(`err: ${j.err.message}`)
            if (j.reason !== undefined) parts.push(`reason: ${safeStringify(j.reason).slice(0, 200)}`)
            push({
              t: new Date(j.time ?? Date.now()).toISOString(),
              level,
              msg: parts.join(' ').slice(0, 500) || trimmed.slice(0, 500),
            })
          } catch {
            // Non-JSON line (e.g. foreign output or stack trace)
            if (/error|fail|exception|fatal|rejection/i.test(trimmed)) {
              push({ t: new Date().toISOString(), level: 50, msg: trimmed.slice(0, 500) })
            } else if (/warn/i.test(trimmed)) {
              push({ t: new Date().toISOString(), level: 40, msg: trimmed.slice(0, 500) })
            }
          }
        }
      } catch {
        /* buffer parsing must never throw */
      }
      cb()
    },
  })
}

/** The latest entries, optionally only from a level up (40 = warn+error). */
export function recentLogs(minLevel = 0, limit = 80): LogEntry[] {
  const out = ring.filter((e) => e.level >= minLevel)
  return out.slice(-Math.max(1, Math.min(limit, MAX_ENTRIES)))
}

// CAPTURA console.* ÎN INEL (owner, 13 aug: „Kelion nu vede toate logurile").
// Inelul era alimentat DOAR din stream-ul pino (`app.log.*`); toate apelurile
// `console.log/info/warn/error` din cod (ex. `[BRAIN]`/`[CHAT-IN]` din chat.ts)
// scriau DIRECT pe stdout, deci NU ajungeau niciodată la creier prin server_logs.
// Împachetăm console.* ca să scrie ȘI în inel — după ce cheamă originalul, deci
// stdout / `docker logs` rămân neatinse. Idempotent (o singură dată).
let consolaCapturata = false
export function capturaConsole(): void {
  if (consolaCapturata) return
  consolaCapturata = true
  const nivele: Array<['log' | 'info' | 'warn' | 'error', number]> = [
    ['log', 30],
    ['info', 30],
    ['warn', 40],
    ['error', 50],
  ]
  const c = console as unknown as Record<string, (...args: unknown[]) => void>
  let insideCapture = false
  for (const [metoda, level] of nivele) {
    const orig = c[metoda].bind(console)
    c[metoda] = (...args: unknown[]): void => {
      try {
        orig(...args)
      } catch {
        /* standard console output must not crash */
      }
      if (insideCapture) return
      insideCapture = true
      try {
        push({
          t: new Date().toISOString(),
          level,
          msg: args.map(safeStringify).join(' ').slice(0, 500),
        })
      } catch {
        /* logarea nu are voie să arunce */
      } finally {
        insideCapture = false
      }
    }
  }
}
