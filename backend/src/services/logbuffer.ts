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

const MAX_ENTRIES = 600
const ring: LogEntry[] = []

function push(e: LogEntry): void {
  ring.push(e)
  if (ring.length > MAX_ENTRIES) ring.splice(0, ring.length - MAX_ENTRIES)
}

// ── PLASA CEA MAI LARGĂ: ORICE eroare de server → simptom viu ────────────────
// Adrian, 12 aug: „sensul absolut orice err, să o vadă din toate logurile" ·
// „să ajungă la creier să le poată DECIDE, să le rezolve, nu doar să le vadă".
// Teul ăsta e SINGURA poartă prin care trece fiecare linie de log a serverului.
// În loc să aleg eu puncte de emisie, tapez AICI: orice linie de nivel eroare
// (50/60) devine simptom, deci ajunge la self-heal → constructor. Injectăm
// funcția din index.ts (setLogSymptomSink) ca să NU închidem un ciclu de import
// cu db.ts. Rate-limit pe semnătură ca o eroare în buclă să nu bombardeze baza.
type SimptomSink = (msg: string) => void
let simptomSink: SimptomSink | null = null
export function setLogSymptomSink(fn: SimptomSink | null): void {
  simptomSink = fn
}

const ultimaEroare = new Map<string, number>()
const REPETA_MS = 30_000
function trimiteSimptom(level: number, msg: string): void {
  if (level < 50 || !simptomSink || !msg) return
  // NU raportăm liniile despre ÎNSĂȘI înregistrarea simptomelor (anti-buclă).
  if (/client_errors|recordSimptom|simptom/i.test(msg)) return
  const sig = msg.replace(/\d+/g, '#').slice(0, 120)
  const now = Date.now()
  const last = ultimaEroare.get(sig)
  if (last !== undefined && now - last < REPETA_MS) return
  ultimaEroare.set(sig, now)
  if (ultimaEroare.size > 500) ultimaEroare.clear()
  try {
    simptomSink(msg)
  } catch {
    /* înregistrarea unui simptom nu are voie să rupă fluxul de log */
  }
}

/** Pino stream: keeps writing to stdout (docker logs stays intact) AND
 *  retains entries in the ring. Reqid/req/res are compressed to a short
 *  summary so the ring holds SIGNAL, not access noise. */
export function makeLogTee(): Writable {
  return new Writable({
    write(chunk: Buffer, _enc, cb) {
      process.stdout.write(chunk)
      try {
        for (const line of chunk.toString('utf8').split('\n')) {
          if (!line.trim()) continue
          const j = JSON.parse(line) as {
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
          if (j.reason !== undefined) parts.push(`reason: ${String(j.reason).slice(0, 200)}`)
          const msg = parts.join(' ').slice(0, 400) || line.slice(0, 400)
          push({ t: new Date(j.time ?? Date.now()).toISOString(), level, msg })
          trimiteSimptom(level, msg) // orice eroare (≥50) → simptom viu
        }
      } catch {
        // Non-JSON line (e.g. foreign output) — we keep it raw if it looks like an error.
        const s = chunk.toString('utf8')
        if (/error|fail|exception/i.test(s)) {
          const msg = s.slice(0, 400)
          push({ t: new Date().toISOString(), level: 50, msg })
          trimiteSimptom(50, msg)
        }
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
