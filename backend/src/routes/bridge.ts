import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import {
  saveMessage,
  getRecentHistory,
  getSharedMemory,
  appendSharedMemory,
  saveWorkOrder,
  pullPendingWorkOrders,
  listWorkOrders,
  saveStagedRelease,
  listStagedReleases,
  setReleaseStatus,
  saveKv,
  loadKv,
  putAppFile,
} from '../db.js'

// Admin bridge — the owner's Kelion chat answered by HIS OWN local Claude Code
// (subscription) instead of the paid API. Flow: the chat route enqueues the
// admin's prompt with bridgeAsk() and awaits; the worker on the owner's PC
// long-polls /api/bridge/pull, runs Claude locally, and posts the answer to
// /api/bridge/reply. The web service is single-instance, so an in-memory queue
// is enough. If the worker is offline or slow, bridgeAsk resolves null and the
// chat route falls back to the normal brain — admin chat never hangs.

// Any file the admin attaches rides the bridge: photo, text, archive, video —
// base64 payload + name/type; the worker writes it to disk and lets Claude
// read it. Voice arrives as TEXT already (Kelion's ear transcribes first).
export interface BridgeFile {
  name: string
  type: string
  data: string
}

interface PendingJob {
  id: string
  // 'chat' — answer the admin's message with local Claude (blocks the turn,
  // awaits a reply). 'repair' — a fix task handed to local Claude Code in the
  // project repo (fire-and-forget; the turn doesn't wait for the fix to finish).
  kind: 'chat' | 'repair'
  prompt: string
  files?: BridgeFile[]
}

const queue: PendingJob[] = []
const waiters = new Map<string, (text: string | null) => void>()
let pullWaiter: ((job: PendingJob | null) => void) | null = null
let lastWorkerSeen = 0
// The beat SURVIVES restarts: persisted (throttled) to Postgres and restored at
// boot — so a deploy never blinks the Bridge light while the worker is alive.
let lastBeatSaved = 0
function workerBeat(): void {
  lastWorkerSeen = Date.now()
  if (Date.now() - lastBeatSaved > 15_000) {
    lastBeatSaved = Date.now()
    void saveKv('last_worker_seen', String(lastWorkerSeen)).catch(() => {})
  }
}
void loadKv('last_worker_seen')
  .then((v) => {
    const t = Number(v)
    if (Number.isFinite(t) && t > lastWorkerSeen) lastWorkerSeen = t
  })
  .catch(() => {})

// AUTO-WAKE: the moment the app sees an ADMIN user it fires a wake request here.
// A tiny always-running laptop agent polls wakePending() and, when true, launches
// the builder (Claude Code) — so opening the app activates the builder itself,
// no manual switch. Held for 2 minutes so a just-launched agent still catches it.
let wakeRequestedAt = 0
export function wakePending(): boolean {
  return Date.now() - wakeRequestedAt < 120_000
}

// Dev-presence: the laptop Claude Code session sends a heartbeat while it is
// actively writing code. The admin UI lights the "Claude" indicator ORANGE so
// the owner can SEE when code is being written on his behalf. The heartbeat also
// carries a short "activity" line (which file, build, deploy…) so the owner can
// watch the work steps live on the monitor.
let lastDevBeat = 0
// Real Linux server load, posted by the VPS paznic every ~2s.
let srvLoad = ''
let srvLoadAt = 0
// Real numeric telemetry (0–100) for the LIVE bar graphs on Adrian's monitor.
// These are measured on the VPS (paznic) — never invented on the client.
let srvCpu = 0
let srvMem = 0
let srvDisk = 0

// ── OK → DEPLOY (Adrian, 4 iul): NO approval tab. A finished fix is "ready";
// Adrian just replies "ok" in chat and the server publishes it immediately.
// The builder sets `readyDeploy` when a fix built clean; an "ok" in chat sets
// `deployWanted`; the server deployer polls, runs railway up, marks done.
let readyDeploy: { branch: string; summary: string; at: number } | null = null
let deployWanted: { branch: string; summary: string } | null = null
export function getReadyDeploy(): { branch: string; summary: string } | null {
  return readyDeploy ? { branch: readyDeploy.branch, summary: readyDeploy.summary } : null
}
// Called from chat.ts when Adrian says "ok/da/publică…" and a fix is ready.
export function triggerDeploy(): { summary: string } | null {
  if (!readyDeploy) return null
  deployWanted = { branch: readyDeploy.branch, summary: readyDeploy.summary }
  const s = readyDeploy.summary
  readyDeploy = null
  noteBrainActivity('🚀 Public pe producție — pornesc deploy-ul')
  return { summary: s }
}
let devActivity: string[] = []
// When two senders beat at once (the rich live work feed from the laptop and a
// bare generic presence beat), the LAST write used to win and the monitor
// flickered down to one generic line. Rule: a generic (≤1-line) beat may only
// replace the feed after the rich feed has gone silent for 60s.
let lastRichFeed = 0
// FULL work journal — every activity line ever received, in order. The MONITOR
// shows only the current work; the history lives HERE and is read in the admin
// panel ("Jurnal Claude"). In-memory, capped; survives until the next deploy.
const devLog: string[] = []
const devLogSeen = new Set<string>()
// Words Claude wants to say FIRST in the admin's chat (delivered by poll).
const sayQueue: string[] = []
// TOTAL chat access for laptop-Claude: the admin's latest attachments (photos,
// pasted screenshots, archives, video…) are stashed here so the builder can
// fetch them while executing a work order. Newest first, memory-capped.
const adminFiles: { name: string; type: string; at: string; data: string }[] = []
export function stashAdminFiles(files: BridgeFile[]): void {
  for (const f of files) adminFiles.unshift({ ...f, at: new Date().toISOString() })
  let total = 0
  for (let i = 0; i < adminFiles.length; i++) {
    total += adminFiles[i].data.length
    if (i >= 10 || total > 120_000_000) {
      adminFiles.length = i + 1
      break
    }
  }
}
// Today's work, for the bridge prompt: the Claude answering in chat gets the
// live journal so he KNOWS what laptop-Claude did and what's in progress.
export function recentDevLog(n = 15): string[] {
  return devLog.slice(-n)
}

function logDevLines(lines: string[]): void {
  for (const l of lines) {
    if (devLogSeen.has(l)) continue
    devLogSeen.add(l)
    devLog.push(`${new Date().toISOString().slice(11, 16)} ${l}`)
  }
  if (devLog.length > 600) devLog.splice(0, devLog.length - 600)
  if (devLogSeen.size > 2000) devLogSeen.clear()
}

// ── APPROVAL GATE (professional CD) ───────────────────────────────────────
// The headless server builder does the work (edit, build, test) then STAGES a
// release here — it never publishes on its own. The owner reviews it in the
// admin "Releases" tab and approves; only then does the builder deploy it. This
// is the human-in-the-loop gate that keeps autonomous building SAFE.
// PERSISTED IN POSTGRES: a pending release must survive backend restarts.
export interface StagedRelease {
  id: string
  title: string
  detail: string
  status: 'pending' | 'approved' | 'rejected' | 'deployed'
  at: string
}

export function stageRelease(title: string, detail: string): string {
  const id = randomUUID()
  void saveStagedRelease(id, title.slice(0, 200), detail.slice(0, 12000)).catch(() => {})
  return id
}

function dispatch(job: PendingJob): void {
  if (pullWaiter) {
    const w = pullWaiter
    pullWaiter = null
    w(job)
  } else {
    queue.push(job)
  }
}

// The worker polls every ≤30s; seen within 75s = online. CRUCIAL nuance: while
// the worker is BUSY answering a job it does not poll — that must count as
// ALIVE, not dead (otherwise the second of two back-to-back admin messages got
// a false "bridge down"). A job dispatched recently with its waiter still
// pending = the bridge is right there, working.
let lastJobDispatched = 0
export function bridgeOnline(): boolean {
  if (config.bridgeSecret === '') return false
  if (Date.now() - lastWorkerSeen < 75_000) return true
  return waiters.size > 0 && Date.now() - lastJobDispatched < 300_000
}

// Enqueue a prompt for the local worker and wait for its answer (or null on
// timeout / worker gone — callers must fall back to the normal brain).
export function bridgeAsk(
  prompt: string,
  files: BridgeFile[] = [],
  timeoutMs = 150_000,
): Promise<string | null> {
  const job: PendingJob = { id: randomUUID(), kind: 'chat', prompt, files }
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(job.id)
      resolve(null)
    }, timeoutMs)
    waiters.set(job.id, (text) => {
      clearTimeout(timer)
      resolve(text)
    })
    dispatch(job)
  })
}

// ── STREAMING bridge (viteza sunetului, Adrian 4 iul) ───────────────────────
// The worker posts text CHUNKS as the model writes them; the chat route
// forwards them straight into the open reply, so Kelion starts writing AND
// speaking within ~2s instead of holding the whole answer for 10–30s.
const chunkSinks = new Map<string, (text: string) => void>()

export function bridgeAskStream(
  prompt: string,
  files: BridgeFile[] = [],
  onChunk: (text: string) => void,
  timeoutMs = 240_000,
): Promise<string | null> {
  const job: PendingJob = { id: randomUUID(), kind: 'chat', prompt, files }
  return new Promise((resolve) => {
    // Stall guard: chunks reset it — a stream that keeps flowing never dies.
    let timer: ReturnType<typeof setTimeout>
    const arm = (ms: number): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        waiters.delete(job.id)
        chunkSinks.delete(job.id)
        resolve(null)
      }, ms)
    }
    arm(timeoutMs)
    chunkSinks.set(job.id, (text) => {
      arm(90_000) // flowing — allow generous continuation windows
      onChunk(text)
    })
    waiters.set(job.id, (text) => {
      clearTimeout(timer)
      chunkSinks.delete(job.id)
      resolve(text)
    })
    dispatch(job)
  })
}

// WORK ORDERS for laptop-Claude (the builder): build/fix/change tasks decided
// by the chat brain (or escalated from the admin panel) land here; the laptop
// session polls them (secret-protected), executes, and reports back in chat +
// on the monitor. Fire-and-forget — the chat turn never waits for a build.
export interface WorkOrder {
  id: string
  text: string
  at: string
}

// PERSISTED IN POSTGRES: the old in-memory queue was wiped by every deploy —
// the admin's "am trimis la execuție" orders vanished into thin air. Never
// again: an order survives any restart and stays visible (with its status) in
// the admin panel even after the builder picked it up.
export function bridgeRepair(description: string): string | null {
  const id = randomUUID()
  const text = description.slice(0, 4000)
  void saveWorkOrder(id, text).catch(() => {})
  // OBLIGATORY monitor display: the moment a repair/dev task is created it shows
  // on the monitor by itself. Adrian's rule (4 iul): his RAW message never
  // appears in the bar — the full text lives in the Admin order registry; the
  // bar only announces that an order entered execution.
  const line = `[${new Date().toISOString().slice(11, 16)}] Ordin nou primit — intrat în execuție (textul complet: Admin → Jurnal)`
  devActivity = [...devActivity, line].slice(-40)
  lastRichFeed = Date.now()
  lastDevBeat = Date.now()
  logDevLines([line])
  return id
}

// LIVE brain activity → the monitor console. Every real action the Linux brain
// takes in chat (shows weather/a page, generates an image, answers) pushes a
// human line here, so Adrian SEES on the monitor exactly what the brain is
// doing right now — not a fake laptop ticker.
export function noteBrainActivity(line: string): void {
  const stamped = `[${new Date().toISOString().slice(11, 16)}] ${line.slice(0, 160)}`
  devActivity = [...devActivity, stamped].slice(-40)
  lastRichFeed = Date.now()
  lastDevBeat = Date.now()
  logDevLines([stamped])
}

function authed(req: FastifyRequest): boolean {
  return config.bridgeSecret !== '' && req.headers['x-bridge-secret'] === config.bridgeSecret
}

export async function bridgeRoutes(app: FastifyInstance): Promise<void> {
  // Laptop Claude Code → server: "I'm actively writing code right now", plus an
  // optional short activity line (which file / build / deploy). Sent every ~15s
  // while a dev work session is engaged (secret-protected).
  app.post<{ Body: { activity?: string[] } }>('/api/dev/heartbeat', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    lastDevBeat = Date.now()
    const act = req.body?.activity
    if (Array.isArray(act)) {
      const lines = act.slice(-40).map((s) => String(s).slice(0, 200))
      if (lines.length > 1) {
        devActivity = lines
        lastRichFeed = Date.now()
        logDevLines(lines)
      } else if (Date.now() - lastRichFeed > 60_000) {
        devActivity = lines
      }
    }
    return { ok: true }
  })

  // Full work journal for the ADMIN PANEL ("Jurnal Claude") — the history the
  // monitor deliberately does NOT carry around.
  app.get('/api/admin/devlog', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return { log: devLog.slice(-400) }
  })

  // Claude WALKS INTO the admin's chat: a message posted here (bridge secret)
  // is delivered to the admin's open ChatPanel (poll below), spoken aloud and
  // persisted to his chat history — so Claude can call the owner first, not
  // only answer him ("când intri, mă strigi").
  app.post<{ Body: { text?: string } }>('/api/bridge/say', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!text) return reply.code(400).send({ error: 'bad_request' })
    sayQueue.push(text.slice(0, 4000))
    void saveMessage(config.adminEmail, 'assistant', text.slice(0, 4000))
    return { ok: true }
  })

  // The admin's ChatPanel polls this — Claude's waiting words, delivered once.
  app.get('/api/chat/incoming', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return { messages: sayQueue.splice(0, sayQueue.length) }
  })

  // Laptop-Claude picks up its WORK ORDERS here (secret-protected, delivered
  // once): the build/fix tasks the chat decided are for the builder. Pulling
  // marks them 'delivered' in Postgres — never deletes, so the admin can always
  // SEE what was sent and when it was picked up.
  app.get('/api/bridge/workorders', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const rows = await pullPendingWorkOrders()
    return { orders: rows.map((r) => ({ id: r.id, text: r.text, at: r.created_at })) }
  })

  // Enqueue a work order directly (secret) — lets the builder or a tool requeue
  // a task (e.g. one lost before the queue became persistent).
  app.post<{ Body: { text?: string } }>('/api/bridge/workorders', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : ''
    if (!text) return reply.code(400).send({ error: 'bad_request' })
    return { ok: true, id: bridgeRepair(text) }
  })

  // A parallel builder AGENT → its live step, shown on Adrian's monitor console
  // (each agent announces itself so he SEES all of them working at once).
  app.post<{ Body: { line?: string } }>('/api/bridge/activity', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const line = typeof req.body?.line === 'string' ? req.body.line.trim() : ''
    if (line) noteBrainActivity(line)
    return { ok: true }
  })

  // Builder → a fix is BUILT and READY (branch pushed). Kelion tells Adrian in
  // chat "gata, zi ok"; Adrian's "ok" then deploys it. No approval tab.
  app.post<{ Body: { branch?: string; summary?: string } }>(
    '/api/bridge/ready-deploy',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : ''
      const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : ''
      if (!branch) return reply.code(400).send({ error: 'bad_request' })
      readyDeploy = { branch, summary, at: Date.now() }
      const msg = `Am reparat: ${summary || branch}. Aprobi deploy? Scrie „da" și public pe loc.`
      sayQueue.push(msg)
      void saveMessage(config.adminEmail, 'assistant', msg)
      noteBrainActivity(`✅ Reparat, gata de publicare: ${summary || branch}`)
      return { ok: true }
    },
  )

  // Server deployer polls this: is there something to publish RIGHT NOW?
  app.get('/api/bridge/deploy-pending', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { deploy: deployWanted }
  })

  // Server deployer → done publishing (ok or failed). Tells Adrian in chat.
  app.post<{ Body: { ok?: boolean; detail?: string } }>(
    '/api/bridge/deploy-done',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      deployWanted = null
      const ok = req.body?.ok !== false
      const msg = ok
        ? 'Gata — e PUBLICAT live pe kelionai.app. Reîmprospătează pagina și verifică.'
        : `Deploy-ul a eșuat: ${String(req.body?.detail || '').slice(0, 200)}. Nu s-a publicat nimic.`
      sayQueue.push(msg)
      void saveMessage(config.adminEmail, 'assistant', msg)
      noteBrainActivity(ok ? '🟢 PUBLICAT LIVE' : '🔴 Deploy eșuat')
      return { ok: true }
    },
  )

  // Linux server → upload the freshest installer MASTER (.exe/.apk) into the
  // delivery store. From then on /dl/<name> serves THIS, over HTTPS+Cloudflare,
  // with no app redeploy — so the QR codes always hand out the latest version.
  app.post<{ Body: { name?: string; type?: string; data?: string } }>(
    '/api/bridge/upload-app',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const b = req.body ?? {}
      const name = typeof b.name === 'string' ? b.name.replace(/[^A-Za-z0-9._-]/g, '') : ''
      if (!name || typeof b.data !== 'string') return reply.code(400).send({ error: 'bad_request' })
      const buf = Buffer.from(b.data, 'base64')
      if (buf.length === 0) return reply.code(400).send({ error: 'empty' })
      await putAppFile(name, buf, b.type || 'application/octet-stream')
      return { ok: true, name, bytes: buf.length }
    },
  )

  // Admin → the FULL order book (pending + delivered, newest first): exactly
  // what was sent to execution, when, and whether the builder picked it up.
  app.get('/api/admin/workorders', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return { orders: await listWorkOrders(50) }
  })

  // ── APPROVAL GATE ──
  // Builder → stage a finished-but-unpublished release for the owner to review.
  app.post<{ Body: { title?: string; detail?: string } }>(
    '/api/bridge/stage-release',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const id = stageRelease(req.body?.title ?? 'Change', req.body?.detail ?? '')
      return { ok: true, id }
    },
  )
  // Builder → poll which releases the owner APPROVED (so it can deploy them).
  app.get('/api/bridge/approved-releases', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const all = await listStagedReleases(50)
    return { releases: all.filter((r) => r.status === 'approved') }
  })
  // Builder → mark an approved release as actually deployed.
  app.post<{ Body: { id?: string } }>('/api/bridge/release-deployed', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    if (req.body?.id) await setReleaseStatus(req.body.id, 'deployed')
    return { ok: true }
  })
  // Admin → see all releases (pending first) in the "Releases" tab.
  app.get('/api/admin/releases', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return { releases: await listStagedReleases(50) }
  })
  // Admin → approve or reject a staged release (the human gate).
  app.post<{ Body: { id?: string; decision?: 'approve' | 'reject' } }>(
    '/api/admin/releases/decide',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
      const all = await listStagedReleases(50)
      const r = all.find((x) => x.id === req.body?.id)
      if (!r) return reply.code(404).send({ error: 'not_found' })
      if (r.status === 'pending') {
        r.status = req.body?.decision === 'approve' ? 'approved' : 'rejected'
        await setReleaseStatus(r.id, r.status)
      }
      return { ok: true, status: r.status }
    },
  )

  // The app fires this the moment it sees an ADMIN user (admin session) — the
  // automatic "activate Claude" command. No manual step.
  app.post('/api/bridge/request-wake', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    wakeRequestedAt = Date.now()
    return { ok: true }
  })

  // The laptop wake-agent polls this (secret): should I launch the builder now?
  app.get('/api/bridge/wake-status', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { wake: wakePending(), builderOnline: Date.now() - lastDevBeat < 60_000 }
  })

  // TOTAL ACCESS for laptop-Claude (secret): the admin's recent chat exactly
  // as saved — voice arrives transcribed, copy-paste lands in the text…
  app.get('/api/bridge/chat-history', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { history: await getRecentHistory(config.adminEmail, 40) }
  })

  // …and his latest attachments (photos, screenshots, archives, video).
  app.get('/api/bridge/files', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { files: adminFiles }
  })

  // SHARED MEMORY ("caietul comun"): the laptop builder reads it at session
  // start (so it knows what happened in Kelion chat) and writes to it after
  // notable work (so the server brain knows what was built). One notebook,
  // both Claudes. Secret-protected.
  app.get('/api/bridge/memory', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { memory: await getSharedMemory(60) }
  })
  app.post<{ Body: { source?: string; content?: string } }>(
    '/api/bridge/memory',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const content = typeof req.body?.content === 'string' ? req.body.content : ''
      if (!content.trim()) return reply.code(400).send({ error: 'bad_request' })
      await appendSharedMemory(req.body?.source || 'laptop', content)
      return { ok: true }
    },
  )

  // Frontend polls this. The "Claude" LIGHT means THE BRIDGE: lit = Claude is
  // reachable on the bridge, OFF = bridge down (the owner sees it instantly),
  // pulsing = code is being written right now (dev heartbeat active).
  // REAL Linux server load (the paznic on the VPS posts it every minute) —
  // shown bottom-left on the admin's work monitor, in real percentages.
  app.post<{ Body: { line?: string; cpu?: number; mem?: number; disk?: number } }>(
    '/api/bridge/server-load',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const b = req.body ?? {}
      const line = typeof b.line === 'string' ? b.line.slice(0, 200) : ''
      const clamp = (n: unknown): number | null =>
        typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null
      const cpu = clamp(b.cpu)
      const mem = clamp(b.mem)
      const disk = clamp(b.disk)
      if (line || cpu !== null || mem !== null || disk !== null) {
        if (line) srvLoad = line
        if (cpu !== null) srvCpu = cpu
        if (mem !== null) srvMem = mem
        if (disk !== null) srvDisk = disk
        srvLoadAt = Date.now()
      }
      return { ok: true }
    },
  )

  app.get('/api/dev/status', async () => {
    const active = Date.now() - lastDevBeat < 60_000
    // Telemetry is "live" only if the paznic posted within the last 12s (it
    // posts every ~2s). Stale → send nulls so the monitor shows "no signal"
    // instead of a frozen bar pretending to be live.
    const fresh = Date.now() - srvLoadAt < 12_000
    return {
      active,
      bridge: bridgeOnline(),
      activity: active ? devActivity : [],
      srv: Date.now() - srvLoadAt < 180_000 ? srvLoad : '',
      // Real 0–100 metrics for the live bar graphs (null when no fresh signal).
      metrics: fresh
        ? { cpu: srvCpu, mem: srvMem, disk: srvDisk, bridge: bridgeOnline() ? 100 : 0, live: true }
        : { cpu: 0, mem: 0, disk: 0, bridge: bridgeOnline() ? 100 : 0, live: false },
    }
  })

  // Watchdog probe (secret-protected): is the worker ACTUALLY polling? The
  // server-side watchdog restarts the worker when this says online:false —
  // catching the "process alive but hung" case systemd can't see.
  app.get('/api/bridge/health', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { online: bridgeOnline(), lastSeenMs: Date.now() - lastWorkerSeen }
  })

  // Worker → server: "give me the next admin prompt" (long-poll up to 25s).
  app.post('/api/bridge/pull', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    const ready = queue.shift()
    if (ready) {
      lastJobDispatched = Date.now()
      return { job: ready }
    }
    const job = await new Promise<PendingJob | null>((resolve) => {
      pullWaiter = resolve
      setTimeout(() => {
        if (pullWaiter === resolve) {
          pullWaiter = null
          resolve(null)
        }
      }, 25_000)
    })
    workerBeat()
    if (job) lastJobDispatched = Date.now()
    return { job }
  })

  // Worker → server: a text CHUNK while the model is still writing (streaming).
  // Forwarded live into the admin's open reply — first words in ~2 seconds.
  app.post('/api/bridge/reply-chunk', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    const body = (req.body ?? {}) as { id?: string; text?: string }
    const sink = body.id ? chunkSinks.get(body.id) : undefined
    if (sink && typeof body.text === 'string' && body.text) sink(body.text)
    return { accepted: !!sink }
  })

  // Worker → server: the finished answer for a job. Posting a reply is proof
  // of life — refresh the presence clock here too.
  app.post('/api/bridge/reply', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    const body = (req.body ?? {}) as { id?: string; text?: string }
    const resolve = body.id ? waiters.get(body.id) : undefined
    if (!resolve || !body.id) return { accepted: false }
    waiters.delete(body.id)
    resolve(typeof body.text === 'string' ? body.text : '')
    return { accepted: true }
  })
}
