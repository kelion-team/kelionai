// PULSUL LUI KELION (Adrian, 26 iul: „verificare automată dar să nu coste sau
// să mănânce resurse" + „toate punctele" pentru autonomie deplină). Sentinela
// LOCALĂ de pe VPS (deploy/sentinela-locala.sh, cron la 3 min) bate AICI cu
// secretul punții. Totul e DETERMINIST — zero apeluri de model, zero cost:
// verificări de sănătate + email către admin DOAR la anomalie, cu prag anti-spam
// (kv). Repornirea containerului o face sentinela bash (aplicația moartă nu-și
// poate face singură restart); aici doar raportăm și verificăm interiorul.
import type { FastifyInstance } from 'fastify'
import fs from 'node:fs/promises'
import { config } from '../config.js'
import { getPool, dbEnabled, saveKv, loadKv } from '../db.js'
import { sendMail } from '../services/mail.js'
import { memorieGazda, descrieMemoria, PRAG_MEMORIE_PCT } from '../services/memorie.js'

// Un email pe subiect cel mult o dată pe fereastră — altfel un disc plin ar
// bombarda inboxul adminului la fiecare 3 minute.
async function alertOnce(key: string, windowMs: number, subject: string, body: string): Promise<boolean> {
  try {
    const last = Number((await loadKv(`ops_alert_${key}`)) ?? '0')
    if (Date.now() - last < windowMs) return false
    await saveKv(`ops_alert_${key}`, String(Date.now()))
  } catch {
    /* fără kv (DB moartă) tot trimitem — mai bine dublu decât deloc */
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

    // Sentinela tocmai a REPORNIT aplicația (a găsit /health mort de 2 ori la
    // rând) — adminul află imediat, nu la următorul test manual.
    if (req.body?.event === 'restart') {
      await alertOnce(
        'restart',
        30 * 60_000,
        'am repornit automat aplicația',
        `Aplicația nu a răspuns la /health de două verificări la rând, așa că am repornit-o automat. Acum răspunde. Detaliu: ${req.body?.detail ?? '-'}. Dacă se repetă des, e o problemă reală — vezi docker logs kelionai-app.`,
      )
      findings.push('restart_raportat')
    }

    // 1. Baza de date răspunde? (SELECT 1 — dacă pică, e anomalia cea mare.)
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

    // 2. Discul: peste 90% ocupat → alertă (o dată la 6 ore).
    try {
      const s = await fs.statfs('/')
      const usedPct = 100 - Math.round((Number(s.bavail) / Number(s.blocks)) * 100)
      if (usedPct >= 90) {
        findings.push(`disc_${usedPct}%`)
        await alertOnce('disk', 6 * 3600_000, `discul VPS e ${usedPct}% plin`, `Spațiul pe disc a ajuns la ${usedPct}%. Curăță imaginile Docker vechi (docker system prune) sau logurile.`)
      }
    } catch {
      /* statfs indisponibil — nu e critic */
    }

    // 2b. Memoria: sub prag → alertă (o dată la 6 ore, ca la disc).
    //
    // Discul avea pază de la început, memoria n-avea niciuna. Diferența dintre
    // ele e că discul plin dă erori pe care le vezi, iar memoria plină îți taie
    // procesul fără o vorbă: kernelul alege o victimă, containerul moare,
    // sentinela îl repornește la următoarea bătaie — și în jurnal rămâne doar
    // „a repornit", niciodată „de ce". Mailul ăsta scrie cauza.
    const mem = await memorieGazda()
    if (mem && mem.liberPct <= PRAG_MEMORIE_PCT) {
      findings.push(`memorie_${mem.liberPct}%`)
      await alertOnce(
        'memory',
        6 * 3600_000,
        `memoria VPS e la ${mem.liberPct}% liber`,
        `Memorie: ${descrieMemoria(mem)}. Sub pragul ăsta kernelul începe să omoare procese, iar aplicația e cea mai mare — o repornire fără cauză aparentă e cel mai probabil asta. Oprește ce nu-ți trebuie pe VPS sau curăță cu docker system prune.`,
      )
    }

    // 3. Val de erori client (>20 în ultima oră) → ceva e stricat în browser
    //    pentru useri reali; adminul află fără să aștepte plângeri.
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
        /* interogarea a picat — db_moarta e deja raportată mai sus */
      }
    }

    return reply.send({ ok: true, findings })
  })

  // ALERTĂ GENERICĂ DE LA PAZNICII DETERMINIȘTI (27 iul, pentru vindecătorul
  // de rulări roșii): orice script de pe VPS cu secretul punții poate cere un
  // email către admin — tot prin alertOnce, deci cu prag anti-spam pe cheie
  // (6h). Nu e pentru useri, nu e pentru AI — doar mașinăria internă.
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
