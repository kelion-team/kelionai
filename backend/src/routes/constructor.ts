import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { createBuildJob, claimNextBuildJob, reportBuildJob, listBuildJobs, updateBuildJobProgress, listMonitorBuildJobs } from '../db.js'
import { isOpsPaused } from '../services/runbooks.js'
import { sendMail } from '../services/mail.js'
import { uneltele } from '../services/autonomie.js'

// ── CONSTRUCTORUL — conducta „ordin → cod → PR" (Adrian, 27 iul: „Kelion
// trebuie să poată crea orice soft îi cere admin, orice modificare, orice
// îmbunătățire") ─────────────────────────────────────────────────────────────
// Ordinul intră aici (din chat/voce prin unealta build_software sau din
// panoul Admin→Constructor); EXECUȚIA e pe VPS: deploy/constructor-worker.sh
// (cron la 2 min, flock, job-uri scurte cu timeout — NU demoni permanenți,
// lecția ecosistemului vechi care ardea abonamentul) cheamă
// deploy/constructor-agent.mjs — bucla agentică pe API-ul OpenRouter (plată
// per-folosire, plafoane dure), care lucrează într-o clonă separată (atelier),
// rulează build + teste și deschide PR-ul. MERGE-UL RĂMÂNE LA ADRIAN (regula
// lui, 27 iul: „modalitatea de a da eu merged e ok").
export async function constructorRoutes(app: FastifyInstance): Promise<void> {
  // Adminul (sau Kelion prin unealtă) pune un ordin în coadă.
  app.post<{ Body: { order?: string } }>('/api/admin/constructor', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const order = String(req.body?.order ?? '').trim()
    if (order.length < 8) return reply.code(400).send({ error: 'ordin_prea_scurt' })
    const id = await createBuildJob(user.email, order)
    if (!id) return reply.code(500).send({ error: 'db_indisponibil' })
    return reply.send({ ok: true, id })
  })

  app.get('/api/admin/constructor', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ jobs: await listBuildJobs(40) })
  })

  // ── Capătul lucrătorului de pe VPS (auth x-bridge-secret, ca ops/pulse) ──
  // „pauza-autonomie" a lui Adrian oprește și constructorul: cât e pauză, nu
  // se mai dau ordine lucrătorului (cele din coadă așteaptă, nu se pierd).
  app.get('/api/constructor/next', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    if (await isOpsPaused()) return reply.send({ job: null, paused: true })
    const job = await claimNextBuildJob()
    return reply.send({ job })
  })

  app.post<{
    Body: { id?: number; status?: string; branch?: string; prUrl?: string; tokens?: number; log?: string; ci?: string }
  }>('/api/constructor/report', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    const id = Number(req.body?.id ?? 0)
    const status = req.body?.status === 'done' ? 'done' : 'failed'
    if (!id) return reply.code(400).send({ error: 'id_lipsa' })
    // VERDICTUL VERIFICĂRII INDEPENDENTE (Etapa 6): 'verde' = CI a re-rulat
    // build+teste pe o mașină curată și a trecut; 'roșu' = a picat; 'în curs' =
    // nu s-a putut confirma în bugetul lucrătorului (atelierul trecuse oricum).
    const ci = ['verde', 'roșu', 'în curs'].includes(String(req.body?.ci)) ? String(req.body?.ci) : undefined
    await reportBuildJob(id, {
      status,
      branch: req.body?.branch,
      prUrl: req.body?.prUrl,
      tokens: Number(req.body?.tokens ?? 0),
      log: req.body?.log,
      ci,
    })
    // Raportul către Adrian — pe email, cu PR-ul de apăsat (merge-ul e al lui).
    const dovadaCI =
      ci === 'verde'
        ? 'Verificare INDEPENDENTĂ: CI verde pe o mașină curată (build + teste re-rulate). ✅'
        : ci === 'în curs'
          ? 'Verificare independentă (CI): încă rulează pe PR — atelierul trecuse deja build + teste.'
          : 'Build + teste verificate în atelier.'
    const subject =
      status === 'done'
        ? `[Kelion] Constructorul a terminat ordinul #${id} — PR gata de merge`
        : `[Kelion] Constructorul a EȘUAT la ordinul #${id}`
    const body =
      status === 'done'
        ? `Ordinul #${id} e construit. ${dovadaCI}\n\nPR: ${req.body?.prUrl ?? '(lipsă)'}\n\nDai merge → auto-publicarea îl duce live singură în ~3 minute.`
        : ci === 'roșu'
          ? `Ordinul #${id}: verificarea INDEPENDENTĂ (CI) a picat pe PR, deși atelierul trecuse.\n\nPR: ${req.body?.prUrl ?? '(lipsă)'}\n\nUltimele rânduri din jurnal:\n${String(req.body?.log ?? '').slice(-1500)}\n\nNU da merge până nu e verde — ordinul rămâne în panou.`
          : `Ordinul #${id} nu a putut fi finalizat.\n\nUltimele rânduri din jurnal:\n${String(req.body?.log ?? '').slice(-1500)}\n\nOrdinul rămâne în panou (Admin→Constructor); poți să-l repui cu alt enunț.`
    void sendMail({ to: config.adminEmail, subject, html: body.replace(/\n/g, '<br>'), text: body }).catch(() => {})
    return reply.send({ ok: true })
  })

  // ── PROGRES LIVE (Etapa 4 autonomie, 29 iul) ────────────────────────────────
  // Lucrătorul de pe VPS trimite AICI pasul curent (clonat → editez X → build →
  // deschid PR...), pe măsură ce lucrează — oglinda lui /report, aceeași auth
  // x-bridge-secret. NU schimbă statusul terminal (updateBuildJobProgress
  // scrie doar pe joburi `running`). Astfel starea nu mai e o cutie neagră între
  // „Preluat" și „Gata": monitorul o poate afișa, iar Kelion o poate NARA.
  app.post<{ Body: { id?: number; progress?: string } }>('/api/constructor/progress', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    const id = Number(req.body?.id ?? 0)
    const progress = String(req.body?.progress ?? '').trim()
    if (!id || !progress) return reply.code(400).send({ error: 'bad_request' })
    await updateBuildJobProgress(id, progress)
    return reply.send({ ok: true })
  })

  // ── UNELTELE GRELE, ÎN MÂNA CONSTRUCTORULUI (Adrian, 30 iul: „am cerut agenți
  // full echipați și tu i-ai dat doar ciurucuri") ─────────────────────────────
  // Avea dreptate. Constructorul avea 7 unelte — ls/grep/read/write/edit/run/
  // finish — deci putea scrie cod, dar nu putea deschide un site și nu putea
  // pune o cheie. Un ordin care cerea un portal era imposibil pentru el, și ar
  // fi picat de trei ori pe banii ownerului.
  //
  // Aici își ia browserul (cele 9 unelte reale, Playwright în proces) și
  // secretele (secret_pune/lista/publica). Dispatch-ul e ACELAȘI cu al buclei
  // autonome — o singură implementare, importată, nu copiată.
  //
  // Poarta: `x-bridge-secret`, ca restul capătului de lucrător. Dincolo de ea
  // stau unelte care ating internetul și cheile — deci nicio altă cale de acces.
  app.post<{ Body: { name?: string; args?: Record<string, unknown> } }>('/api/constructor/tool', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    const name = String(req.body?.name ?? '')
    if (!name) return reply.code(400).send({ error: 'bad_request' })
    const rezultat = await uneltele(name, req.body?.args ?? {}).catch((e: Error) =>
      JSON.stringify({ error: e.message }),
    )
    return reply.send({ rezultat })
  })

  // Joburile de afișat pe monitor (active + terminate recent) + pasul lor curent
  // — pentru panoul live din frontend (sesiune admin; Etapa 4b). Include și
  // `done`/`failed` din ultimele minute, ca panoul să arate FINALUL (Gata/Eșuat),
  // nu doar drumul până la el.
  app.get('/api/constructor/live', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const jobs = await listMonitorBuildJobs()
    return reply.send({
      jobs: jobs.map((j) => ({ id: j.id, status: j.status, order: j.orderText.slice(0, 120), progress: j.progress, ci: j.ci, prUrl: j.prUrl, attempts: j.attempts, updatedAt: j.updatedAt })),
    })
  })
}
