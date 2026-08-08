// KELION'S PULSE (Adrian, 26 Jul: "automatic checking but it must not cost
// or eat resources" + "all the points" for full autonomy). The LOCAL sentinel
// on the VPS (deploy/sentinela-locala.sh, cron every 3 min) beats HERE with
// the bridge secret. Everything is DETERMINISTIC — zero model calls, zero
// cost: health checks + email to the admin ONLY on anomaly, with an
// anti-spam threshold (kv). The container restart is done by the bash
// sentinel (a dead application cannot restart itself); here we only report
// and check the inside.
import type { FastifyInstance } from 'fastify'
import fs from 'node:fs/promises'
import { config } from '../config.js'
import { getPool, dbEnabled, saveKv, loadKv } from '../db.js'
import { sendMail } from '../services/mail.js'
import { resurseGazda, descrieResurse, PRAG_MEMORIE_PCT, PRAG_INCARCARE_PCT } from '../services/resurse.js'

// One email per subject at most once per window — otherwise a full disk
// would bombard the admin's inbox every 3 minutes.
async function alertOnce(key: string, windowMs: number, subject: string, body: string): Promise<boolean> {
  try {
    const last = Number((await loadKv(`ops_alert_${key}`)) ?? '0')
    if (Date.now() - last < windowMs) return false
    await saveKv(`ops_alert_${key}`, String(Date.now()))
  } catch {
    /* without kv (dead DB) we still send — better duplicated than never */
  }
  return sendMail({
    to: config.adminEmail,
    subject: `[Kelion sentinelă] ${subject}`,
    html: `<p style="white-space:pre-wrap">${body}</p><p>— sentinela locală (verificare deterministă, fără AI)</p>`,
    text: `${body}\n— sentinela locală`,
  })
}

export async function opsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { event?: string; detail?: string } }>('/api/ops/pulse', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(403).send({ error: 'forbidden' })

    const findings: string[] = []

    // The sentinel has just RESTARTED the application (it found /health
    // dead twice in a row) — the admin finds out immediately, not at the
    // next manual test.
    if (req.body?.event === 'restart') {
      await alertOnce(
        'restart',
        30 * 60_000,
        'am repornit automat aplicația',
        `Aplicația nu a răspuns la /health de două verificări la rând, așa că am repornit-o automat. Acum răspunde. Detaliu: ${req.body?.detail ?? '-'}. Dacă se repetă des, e o problemă reală — vezi docker logs kelionai-app.`,
      )
      findings.push('restart_raportat')
    }

    // 1. Does the database answer? (SELECT 1 — if it fails, that's the big anomaly.)
    let dbOk = false
    try {
      if (dbEnabled()) {
        await getPool().query('SELECT 1')
        dbOk = true
      }
    } catch {
      findings.push('db_moarta')
      await alertOnce('db', 60 * 60_000, 'baza de date nu răspunde', 'SELECT 1 a eșuat din aplicație. Verifică serviciul postgres pe VPS (systemctl status postgresql).')
    }

    // 2. Disk: over 90% used → alert (once every 6 hours).
    try {
      const s = await fs.statfs('/')
      const usedPct = 100 - Math.round((Number(s.bavail) / Number(s.blocks)) * 100)
      if (usedPct >= 90) {
        findings.push(`disc_${usedPct}%`)
        await alertOnce('disk', 6 * 3600_000, `discul VPS e ${usedPct}% plin`, `Spațiul pe disc a ajuns la ${usedPct}%. Curăță imaginile Docker vechi (docker system prune) sau logurile.`)
      }
    } catch {
      /* statfs unavailable — not critical */
    }

    // 2b. Memory and load → alert (once every 6 hours, like the disk).
    //
    // The disk had a guard from the start, these two had none. The
    // difference is that a full disk gives errors you can see, while the
    // other two say nothing: full memory kills your process (the kernel
    // picks a victim, the container dies, the sentinel restarts it — and
    // the log is left with only "restarted", never "why"), and high load
    // kills nothing, it just makes everything slow. These emails write down
    // the cause.
    const res = await resurseGazda()
    if (res && res.liberPct <= PRAG_MEMORIE_PCT) {
      findings.push(`memorie_${res.liberPct}%`)
      await alertOnce(
        'memory',
        6 * 3600_000,
        `memoria VPS e la ${res.liberPct}% liber`,
        `${descrieResurse(res)}. Sub pragul ăsta kernelul începe să omoare procese, iar aplicația e cea mai mare — o repornire fără cauză aparentă e cel mai probabil asta. Oprește ce nu-ți trebuie pe VPS sau curăță cu docker system prune.`,
      )
    }
    if (res && res.incarcarePct >= PRAG_INCARCARE_PCT) {
      findings.push(`incarcare_${res.incarcarePct}%`)
      await alertOnce(
        'load',
        6 * 3600_000,
        `VPS-ul e încărcat ${res.incarcarePct}% de 15 minute`,
        `${descrieResurse(res)}. Nu moare nimic, dar tot ce face casa devine încet — inclusiv chatul, care are țintă sub o secundă. Vezi ce rulează pe VPS și oprește ce nu e necesar, sau mărește mașina.`,
      )
    }

    // 3. Wave of client errors (>20 in the last hour) → something is
    //    broken in the browser for real users; the admin finds out without
    //    waiting for complaints.
    if (dbOk) {
      try {
        const r = await getPool().query<{ n: string }>(
          "SELECT count(*) AS n FROM client_errors WHERE created_at > now() - interval '1 hour'",
        )
        const n = Number(r.rows[0]?.n ?? 0)
        if (n > 20) {
          findings.push(`erori_client_${n}`)
          await alertOnce('client_errors', 3 * 3600_000, `${n} erori de client în ultima oră`, `S-au strâns ${n} erori în client_errors în ultima oră — ceva e rupt în interfață pentru utilizatori. Vezi Admin sau tabela client_errors.`)
        }
      } catch {
        /* the query failed — db_moarta is already reported above */
      }
    }

    return reply.send({ ok: true, findings })
  })

  // GENERIC ALERT FROM THE DETERMINISTIC GUARDS (27 Jul, for the red-run
  // healer): any script on the VPS holding the bridge secret can request an
  // email to the admin — still through alertOnce, so with an anti-spam
  // threshold per key (6h). Not for users, not for AI — internal machinery
  // only.
  app.post<{ Body: { key?: string; subject?: string; body?: string } }>('/api/ops/alert', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(403).send({ error: 'forbidden' })
    const key = String(req.body?.key ?? '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64)
    const subject = String(req.body?.subject ?? '').slice(0, 200)
    const body = String(req.body?.body ?? '').slice(0, 4000)
    if (!key || !subject) return reply.code(400).send({ error: 'key_sau_subiect_lipsa' })
    const sent = await alertOnce(key, 6 * 3600_000, subject, body || subject)
    return reply.send({ ok: true, sent })
  })
}
