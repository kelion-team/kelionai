import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { saveMessage, getRecentHistory, getSharedMemory, appendSharedMemory } from '../db.js'

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
export interface StagedRelease {
  id: string
  title: string
  detail: string
  status: 'pending' | 'approved' | 'rejected' | 'deployed'
  at: string
}
const releases: StagedRelease[] = []

export function stageRelease(title: string, detail: string): string {
  const r: StagedRelease = {
    id: randomUUID(),
    title: title.slice(0, 200),
    detail: detail.slice(0, 12000),
    status: 'pending',
    at: new Date().toISOString(),
  }
  releases.unshift(r)
  if (releases.length > 50) releases.length = 50
  return r.id
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

// WORK ORDERS for laptop-Claude (the builder): build/fix/change tasks decided
// by the chat brain (or escalated from the admin panel) land here; the laptop
// session polls them (secret-protected), executes, and reports back in chat +
// on the monitor. Fire-and-forget — the chat turn never waits for a build.
export interface WorkOrder {
  id: string
  text: string
  at: string
}
const workOrders: WorkOrder[] = []

export function bridgeRepair(description: string): string | null {
  const order: WorkOrder = {
    id: randomUUID(),
    text: description.slice(0, 4000),
    at: new Date().toISOString(),
  }
  workOrders.push(order)
  if (workOrders.length > 100) workOrders.splice(0, workOrders.length - 100)
  // OBLIGATORY monitor display: the moment a repair/dev task is created it shows
  // on the monitor by itself — the owner SEES the work, no click, no waiting.
  const line = `[${new Date().toISOString().slice(11, 16)}] În execuție: ${order.text.slice(0, 140)}`
  devActivity = [...devActivity, line].slice(-40)
  lastRichFeed = Date.now()
  lastDevBeat = Date.now()
  logDevLines([line])
  return order.id
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
  // once): the build/fix tasks the chat decided are for the builder.
  app.get('/api/bridge/workorders', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { orders: workOrders.splice(0, workOrders.length) }
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
    return { releases: releases.filter((r) => r.status === 'approved') }
  })
  // Builder → mark an approved release as actually deployed.
  app.post<{ Body: { id?: string } }>('/api/bridge/release-deployed', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const r = releases.find((x) => x.id === req.body?.id)
    if (r) r.status = 'deployed'
    return { ok: true }
  })
  // Admin → see all releases (pending first) in the "Releases" tab.
  app.get('/api/admin/releases', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return { releases }
  })
  // Admin → approve or reject a staged release (the human gate).
  app.post<{ Body: { id?: string; decision?: 'approve' | 'reject' } }>(
    '/api/admin/releases/decide',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
      const r = releases.find((x) => x.id === req.body?.id)
      if (!r) return reply.code(404).send({ error: 'not_found' })
      if (r.status === 'pending') r.status = req.body?.decision === 'approve' ? 'approved' : 'rejected'
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
  app.get('/api/dev/status', async () => {
    const active = Date.now() - lastDevBeat < 60_000
    return { active, bridge: bridgeOnline(), activity: active ? devActivity : [] }
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
    lastWorkerSeen = Date.now()
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
    lastWorkerSeen = Date.now()
    if (job) lastJobDispatched = Date.now()
    return { job }
  })

  // Worker → server: the finished answer for a job. Posting a reply is proof
  // of life — refresh the presence clock here too.
  app.post('/api/bridge/reply', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    lastWorkerSeen = Date.now()
    const body = (req.body ?? {}) as { id?: string; text?: string }
    const resolve = body.id ? waiters.get(body.id) : undefined
    if (!resolve || !body.id) return { accepted: false }
    waiters.delete(body.id)
    resolve(typeof body.text === 'string' ? body.text : '')
    return { accepted: true }
  })
}
