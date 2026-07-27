import { Writable } from 'node:stream'

// ── F12-UL SERVERULUI (Adrian, 27 iul: „jurnalele astea trebuie obligatoriu să
// ajungă la Kelion ca și F12") ────────────────────────────────────────────────
// Erorile de CLIENT ajung deja la Kelion prin /api/client-errors (F12-ul
// browserului). Jurnalele de SERVER însă trăiau doar în `docker logs`, unde
// Kelion nu poate ajunge (rulează în container, fără docker.sock — și e corect
// așa). Soluția: un inel de memorie care reține ultimele intrări chiar din
// fluxul pino al aplicației; unealta admin `server_logs` (chat.ts) i le dă lui
// Kelion nativ, exact cum îi dă `db_query` erorile de client.

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

/** Stream pino: scrie ÎN CONTINUARE pe stdout (docker logs rămâne intact) și
 *  reține în inel. Reqid/req/res se comprimă la un rezumat scurt ca inelul să
 *  țină SEMNAL, nu zgomot de acces. */
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
          // Zgomotul de acces (request completed 2xx/3xx) NU intră în inel —
          // doar erori, avertismente și mesaje aplicative reale.
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
          push({
            t: new Date(j.time ?? Date.now()).toISOString(),
            level,
            msg: parts.join(' ').slice(0, 400) || line.slice(0, 400),
          })
        }
      } catch {
        // Linie ne-JSON (ex. output străin) — o reținem brută dacă pare eroare.
        const s = chunk.toString('utf8')
        if (/error|fail|exception/i.test(s)) push({ t: new Date().toISOString(), level: 50, msg: s.slice(0, 400) })
      }
      cb()
    },
  })
}

/** Ultimele intrări, opțional doar de la un nivel în sus (40 = warn+error). */
export function recentLogs(minLevel = 0, limit = 80): LogEntry[] {
  const out = ring.filter((e) => e.level >= minLevel)
  return out.slice(-Math.max(1, Math.min(limit, MAX_ENTRIES)))
}
