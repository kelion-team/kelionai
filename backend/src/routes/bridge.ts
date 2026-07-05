import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID } from 'node:crypto'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { superviseDecision, escalationText, DEFAULT_SUPERVISE } from '../services/supervisor.js'
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
  // THREAD MEMORY (urgența 2, Adrian 4 iul): the small per-turn packet (fresh
  // context + the NEW message only). When present and the worker holds a live
  // claude session, it resumes it (--resume) — real conversational memory
  // instead of a fresh process fed 15 truncated messages.
  turn?: string
}

const queue: PendingJob[] = []
const waiters = new Map<string, (text: string | null) => void>()
// FIFO of pending worker long-polls. It was a SINGLE slot: a second concurrent
// pull silently overwrote the first, whose request then hung FOREVER (its
// timeout guard no longer matched) — freezing that worker and losing the
// admin's messages (4 iul). Every waiting poll now gets served or released.
const pullWaiters: ((job: PendingJob | null) => void)[] = []
// Jobs handed to a worker but not yet confirmed (no ack/chunk/reply). If the
// long-poll connection died exactly as the job was served, the job used to
// vanish — the admin's message was simply never answered. Now it is redelivered
// ONCE to the next poll while its turn is still waiting.
interface InFlight {
  job: PendingJob
  at: number
  tries: number
  confirmed: boolean
}
const inFlight = new Map<string, InFlight>()
// Redelivery arms itself only once a worker has EVER acked (feature-detect the
// new worker) — an old worker that never acks must not get every job twice.
let ackSeen = false
function markServed(job: PendingJob): void {
  lastJobDispatched = Date.now()
  const prev = inFlight.get(job.id)
  inFlight.set(job.id, { job, at: Date.now(), tries: (prev?.tries ?? 0) + 1, confirmed: false })
}
// A served-but-unconfirmed job whose turn is still waiting → serve it again.
function staleJob(): PendingJob | null {
  if (!ackSeen) return null
  const now = Date.now()
  for (const [id, e] of inFlight) {
    if (!waiters.has(id)) {
      inFlight.delete(id) // turn finished or timed out — nothing to redeliver
      continue
    }
    if (!e.confirmed && e.tries < 2 && now - e.at > 15_000) return e.job
  }
  return null
}
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
// THE PROCESS PROGRESS BAR (Adrian's real requirement, 4 iul): the current job,
// 0→100%, from intake to finish — NOT server resources. chat/builder/deployer
// push the percentage as the process moves through its stages.
let procPct = 0
let procLabel = ''
let procFile = ''
let procAt = 0
export function setProgress(pct: number, label: string, file = ''): void {
  procPct = Math.max(0, Math.min(100, Math.round(pct)))
  procLabel = label.slice(0, 80)
  procFile = file.slice(0, 80)
  procAt = Date.now()
}
// CE ANALIZEAZĂ CREIERUL (ordinul din 5 iul): la click pe bara „Creierul
// analizează" Adrian deschide detaliul — cererea aflată în analiză. Ținută
// separat de eticheta barei ca să rămână aceeași cerere pe toate etapele
// procesului (analiză → compunere → gata), nu doar pe prima.
let procDetail = ''
let procDetailAt = 0
export function setAnalysisDetail(text: string): void {
  procDetail = text.slice(0, 600)
  procDetailAt = Date.now()
}

// ── OK → DEPLOY (Adrian, 4 iul): NO approval tab. A finished fix is "ready";
// Adrian just replies "ok" in chat and the server publishes it immediately.
// The builder stages a fix when it built clean; an "ok" in chat sets
// `deployWanted`; the server deployer polls, runs railway up, marks done.
// COADĂ, nu sertar unic (5 iul): două fixuri gata în același timp se călcau pe
// picior — al doilea îl SUPRASCRIA pe primul și un „da" publica altceva decât
// credea Adrian. Acum fiecare fix stă la rând; fiecare „da" publică PRIMUL.
const readyDeploys: { branch: string; summary: string; at: number }[] = []
let deployWanted: { branch: string; summary: string } | null = null
// FĂRĂ AMNEZIE LA RESTART (Adrian, 5 iul: „da"-ul lui a căzut în gol după un
// restart Railway care a uitat sertarul din RAM): coada de release se persistă
// în Postgres la fiecare schimbare și se reîncarcă la pornire.
function persistReady(): void {
  void saveKv('ready_deploys', JSON.stringify(readyDeploys)).catch(() => {})
}
void loadKv('ready_deploys')
  .then((v) => {
    if (!v) return
    const arr = JSON.parse(v) as { branch?: string; summary?: string; at?: number }[]
    for (const r of arr) {
      if (r && typeof r.branch === 'string' && !readyDeploys.some((x) => x.branch === r.branch)) {
        readyDeploys.push({ branch: r.branch, summary: String(r.summary ?? ''), at: Number(r.at ?? Date.now()) })
      }
    }
  })
  .catch(() => {})
export function getReadyDeploy(): { branch: string; summary: string } | null {
  const r = readyDeploys[0]
  return r ? { branch: r.branch, summary: r.summary } : null
}
// Called from chat.ts when Adrian says "ok/da/publică…" and a fix is ready.
export function triggerDeploy(): { summary: string } | null {
  const r = readyDeploys.shift()
  if (!r) return null
  persistReady()
  deployWanted = { branch: r.branch, summary: r.summary }
  noteBrainActivity('🚀 Public pe producție — pornesc deploy-ul')
  updateRequirement('deploy pornit')
  if (readyDeploys.length > 0) {
    // Mai e ceva la rând — spune-i clar că un nou „da" publică următorul.
    sayQueue.push(`Mai am ${readyDeploys.length} la rând de publicat — următorul: ${readyDeploys[0].summary.slice(0, 120)}. Zi „da" din nou când vrei.`)
  }
  return { summary: r.summary }
}

// ── VERIFICARE LIVE (Adrian, 5 iul: „trimis ≠ gata") ───────────────────────
// Creierul NU declară „publicat" pe cuvântul deployerului. După ce deployerul
// zice că a terminat, creierul verifică EL însuși că producția răspunde 200 și
// abia atunci confirmă. Dacă nu răspunde, rămâne angajat (nu declară gata).
async function verifyLive(): Promise<boolean> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const r = await fetch('https://kelionai.app/api/dev/status', {
      signal: ctrl.signal,
      headers: { 'cache-control': 'no-store' },
    })
    clearTimeout(t)
    return r.ok
  } catch {
    return false
  }
}

// Rulează asincron DUPĂ deploy-done (nu blochează răspunsul către deployer):
// probează live-ul până la ~30s, apoi anunță în chat DOAR ce a verificat.
async function confirmLiveThenAnnounce(summary: string): Promise<void> {
  noteBrainActivity('🔎 Verific live pe kelionai.app (nu cred pe cuvânt)…')
  setProgress(92, 'Verific live (fetch → 200)')
  let live = false
  for (let i = 0; i < 10 && !live; i++) {
    await new Promise((r) => setTimeout(r, 3000))
    live = await verifyLive()
  }
  if (live) {
    const msg = `Gata — VERIFICAT live pe kelionai.app (răspunde 200): ${summary || 'modificarea'}. Reîmprospătează pagina.`
    sayQueue.push(msg)
    void saveMessage(config.adminEmail, 'assistant', msg)
    noteBrainActivity('🟢 PUBLICAT + VERIFICAT LIVE (200)')
    const r = ownedRequirement()
    if (r) {
      // LEGEA 200 PE CERINȚĂ (Adrian, 5 iul): site-ul sus NU închide cerința.
      // Comportamentul ei e verificat pe live de tester; închiderea vine DOAR
      // pe verdict PASS (endpointul requirement-verdict). FAIL → auto-reparat.
      updateRequirement('verific comportamentul pe live (tester)')
      setProgress(97, 'Verific comportamentul cerinței')
      bridgeRepair(
        `VERIFICARE PE CERINȚĂ (auto, după deploy verificat live): testează pe kelionai.app că cerința „${r.summary}" chiar se comportă conform — dovezi reale (curl, codul livrat, încercare concretă), nu presupuneri. Apoi raportează verdictul cu: curl -s -X POST https://kelionai.app/api/bridge/requirement-verdict -H "x-bridge-secret: $(cat /root/kelion/bridge-secret.txt)" -H "content-type: application/json" -d '{"pass":true,"detail":"dovada scurtă"}' — sau pass:false cu motivul exact. INTERZIS verdict fără dovadă.`,
      )
    } else {
      // 100% ADEVĂRAT: bara ajunge la capăt DOAR când producția e verificată
      // live, nu la „trimis" (Adrian, 5 iul).
      setProgress(100, 'Verificat live')
    }
  } else {
    const msg =
      'Deployerul raportează publicat, dar verificarea mea live a picat — kelionai.app nu răspunde 200 după 30s. NU confirm ca publicat; rămân pe cerință și investighez.'
    sayQueue.push(msg)
    void saveMessage(config.adminEmail, 'assistant', msg)
    noteBrainActivity('🟠 Deploy raportat OK, dar verificarea live a picat — rămân angajat')
    // NU 100%: cerința rămâne deschisă, bara NU minte că e gata.
    setProgress(95, 'Verificarea live a picat — investighez')
    updateRequirement('verificarea live a picat — investighez')
  }
}

// ── SUPERVIZOR PER-CERINȚĂ (Adrian, 5 iul: „stă implicat până la verificat") ──
// O cerință de execuție rămâne DEȚINUTĂ (deschisă) până e verificată live — nu
// se închide la „Răspuns trimis". Dacă stagnează prea mult, creierul se
// REANGAJEAZĂ singur: re-verifică live (poate deploy-ul a reușit tăcut) și
// anunță — în loc să intre în idle. NU redeployează singur (poarta umană
// rămâne); watchdog-ul e read-only (fetch de stare + anunț), nu autonom-periculos.
interface OwnedReq {
  summary: string
  status: string
  at: number
  opened: number
  nudged: number
  attempts: number // câți agenți proaspeți a re-asignat supervizorul
  task: string // sarcina completă (pt re-asignare cu escaladare)
}
let ownedReq: OwnedReq | null = null
// Cerința deținută supraviețuiește restartului (Postgres) — o cerință deschisă
// nu se pierde când Railway repornește backendul (Adrian, 5 iul).
function persistOwned(): void {
  void saveKv('owned_req', ownedReq ? JSON.stringify(ownedReq) : '').catch(() => {})
}
void loadKv('owned_req')
  .then((v) => {
    if (!v || ownedReq) return
    const r = JSON.parse(v) as OwnedReq
    if (r && typeof r.summary === 'string') ownedReq = r
  })
  .catch(() => {})
export function openRequirement(summary: string, task?: string): void {
  ownedReq = {
    summary: summary.slice(0, 120),
    status: 'primită',
    at: Date.now(),
    opened: Date.now(),
    nudged: 0,
    attempts: 0,
    task: (task ?? summary).slice(0, 4000),
  }
  persistOwned()
}
export function updateRequirement(status: string): void {
  if (ownedReq) {
    ownedReq.status = status.slice(0, 80)
    ownedReq.at = Date.now()
    persistOwned()
  }
}
export function resolveRequirement(): void {
  ownedReq = null
  persistOwned()
}
export function ownedRequirement(): { summary: string; status: string; ageMs: number } | null {
  return ownedReq ? { summary: ownedReq.summary, status: ownedReq.status, ageMs: Date.now() - ownedReq.opened } : null
}

// Watchdog: o cerință deschisă care stagnează >4 min primește o reangajare —
// re-verific live (poate a devenit live între timp) și, dacă da, o închid; altfel
// notez că e blocată și rămân pe ea. Max o reangajare la 4 min, ca să nu spameze.
setInterval(() => {
  const r = ownedReq
  if (!r) return
  const action = superviseDecision(
    { status: r.status, at: r.at, nudged: r.nudged, attempts: r.attempts ?? 0 },
    Date.now(),
    lastBuildBeat,
  )
  if (action === 'wait') return
  r.nudged = Date.now()
  const max = DEFAULT_SUPERVISE.maxAttempts
  void (async () => {
    if (action === 'deploy-check') {
      // Publică — un 200 NU închide cerința (o face confirmLiveThenAnnounce); doar raportăm.
      const live = await verifyLive()
      noteBrainActivity(
        live
          ? `⏳ „${r.summary}" — deploy pornit, serverul răspunde; aștept confirmarea verificată`
          : `🟠 „${r.summary}" — deploy pornit dar serverul nu răspunde; rămân pe ea`,
      )
      return
    }
    if (action === 'active') {
      // Constructorul CHIAR lucrează (build beat recent) — NU-l înlocuim.
      noteBrainActivity(`⏳ „${r.summary}" — constructorul lucrează activ, aștept`)
      return
    }
    if (action === 'reassign') {
      // NU performează (stagnat + fără activitate) → ÎNLOCUIESC agentul cu unul
      // PROASPĂT, cu instrucțiune escaladată. Un work-order nou = agent nou.
      r.attempts = (r.attempts ?? 0) + 1
      bridgeRepair(
        `SUPERVIZOR — încercarea ${r.attempts}/${max}: agentul anterior N-A dus la capăt „${r.summary}". ` +
          `${escalationText(r.attempts, max)}\n\nSARCINA: ${r.task || r.summary}`,
      )
      updateRequirement(`re-asignat unui agent proaspăt (încercarea ${r.attempts}/${max})`)
      noteBrainActivity(
        `🔁 Supervizor: „${r.summary}" re-asignată — agent proaspăt, escaladat (${r.attempts}/${max})`,
      )
      return
    }
    // giveup: gata cu re-asignările automate → NU buclează la infinit, decizia lui Adrian.
    updateRequirement(`BLOCAT după ${max} încercări — decizia lui Adrian`)
    const msg =
      `🛑 „${r.summary}": ${max} agenți la rând n-au dus-o la capăt. Nu mai re-asignez automat. ` +
      `Vrei s-o simplific, s-o las, sau îmi dai alt unghi?`
    sayQueue.push(msg)
    void saveMessage(config.adminEmail, 'assistant', msg)
    noteBrainActivity(`🛑 Supervizor: „${r.summary}" blocată după ${max} încercări — la decizia lui Adrian`)
    r.nudged = Date.now() + 24 * 3600_000 // oprește re-verificarea automată până se schimbă ceva
    persistOwned()
  })()
}, 60_000).unref()
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
// Ora din jurnal/monitor trebuie să fie ACEEAȘI oră pe care Adrian o vede în
// chat (ora lui locală), nu UTC-ul serverului. Fusul lui e reținut din fiecare
// tură de chat; Europe/Bucharest până sosește prima.
let ownerTz = 'Europe/Bucharest'
export function setOwnerTz(tz: string): void {
  if (!tz || tz === ownerTz) return
  try {
    new Intl.DateTimeFormat('ro-RO', { timeZone: tz })
    ownerTz = tz
  } catch {
    /* fus invalid de la client — păstrăm ultimul bun */
  }
}
function stampHM(): string {
  return new Date().toLocaleTimeString('ro-RO', {
    timeZone: ownerTz,
    hour: '2-digit',
    minute: '2-digit',
  })
}
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
    devLog.push(`${stampHM()} ${l}`)
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

// ── CANAL PERMANENT FULL-DUPLEX (ordinul lui Adrian, 4 iul) ────────────────
// Workerul ține MINIM 5 canale WebSocket permanent deschise. Un job e ÎMPINS pe
// un canal liber ÎN CLIPA în care apare (zero drum de long-poll); bucățile de
// text, pulsul de viață și răspunsul final curg înapoi pe ACELAȘI canal.
// Long-poll-ul HTTP rămâne DOAR plasă de siguranță când niciun canal nu e sus.
interface WsLane {
  socket: { send(data: string): void; close(code?: number, reason?: string): void }
  busy: string | null // id-ul jobului aflat pe canal (null = liber)
}
const wsLanes = new Set<WsLane>()
function freeLane(): WsLane | null {
  for (const l of wsLanes) if (!l.busy) return l
  return null
}
export function wsLaneCount(): number {
  return wsLanes.size
}

function dispatch(job: PendingJob): void {
  // 1) canal permanent liber → jobul pleacă INSTANT, full-duplex
  const lane = freeLane()
  if (lane) {
    lane.busy = job.id
    markServed(job)
    try {
      lane.socket.send(JSON.stringify({ type: 'job', job }))
      return
    } catch {
      lane.busy = null // canal mort — cade pe căile clasice
    }
  }
  // 2) plasa de siguranță: long-poll-ul HTTP / coada persistentă
  const w = pullWaiters.shift()
  if (w) w(job)
  else queue.push(job)
}

// The worker polls every ≤30s; seen within 75s = online. CRUCIAL nuance: while
// the worker is BUSY answering a job it does not poll — that must count as
// ALIVE, not dead (otherwise the second of two back-to-back admin messages got
// a false "bridge down"). A job dispatched recently with its waiter still
// pending = the bridge is right there, working.
let lastJobDispatched = 0
export function bridgeOnline(): boolean {
  if (config.bridgeSecret === '') return false
  // Canale permanente deschise = puntea e sus, fără îndoială.
  if (wsLanes.size > 0) return true
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
      forgetJob(job.id)
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

// A turn that gave up (timeout / stall) must take its job WITH it. A dead job
// left in `queue` was still served to the worker LATER — which then burned
// minutes answering nobody while the admin's next real message waited behind
// it (the "te-am scris de 10 ori" pile-up). Forgetting removes every trace.
function forgetJob(id: string): void {
  waiters.delete(id)
  chunkSinks.delete(id)
  inFlight.delete(id)
  const i = queue.findIndex((j) => j.id === id)
  if (i !== -1) queue.splice(i, 1)
}

// Sentinel: no first word arrived within firstTokenMs → the caller RE-ANALYZES
// (Adrian's rule, 4 iul: a request never ends without a clear answer; at 30s
// with total silence it is retried, not left to rot for 4 minutes).
export const BRIDGE_STALL = '__BRIDGE_STALL__'

export function bridgeAskStream(
  prompt: string,
  files: BridgeFile[] = [],
  onChunk: (text: string) => void,
  timeoutMs = 240_000,
  firstTokenMs = 30_000,
  turn = '',
): Promise<string | null> {
  const job: PendingJob = { id: randomUUID(), kind: 'chat', prompt, files, turn: turn || undefined }
  return new Promise((resolve) => {
    let gotChunk = false
    // Stall guard: chunks reset it — a stream that keeps flowing never dies.
    let timer: ReturnType<typeof setTimeout>
    const arm = (ms: number): void => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        forgetJob(job.id)
        resolve(null)
      }, ms)
    }
    arm(timeoutMs)
    // FIRST-WORD deadline: if total silence for firstTokenMs, bail early with the
    // stall sentinel so the caller can re-analyze (fresh job / fresh worker poll).
    // Fires ONLY when nothing has streamed — a slow-but-flowing answer is left be.
    const firstTimer = setTimeout(() => {
      if (gotChunk) return
      forgetJob(job.id)
      clearTimeout(timer)
      resolve(BRIDGE_STALL)
    }, firstTokenMs)
    chunkSinks.set(job.id, (text) => {
      gotChunk = true
      clearTimeout(firstTimer)
      arm(90_000) // flowing — allow generous continuation windows
      onChunk(text)
    })
    waiters.set(job.id, (text) => {
      clearTimeout(timer)
      clearTimeout(firstTimer)
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
  const line = `[${stampHM()}] Ordin nou primit — intrat în execuție (textul complet: Admin → Jurnal)`
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
  const stamped = `[${stampHM()}] ${line.slice(0, 160)}`
  devActivity = [...devActivity, stamped].slice(-40)
  lastRichFeed = Date.now()
  lastDevBeat = Date.now()
  logDevLines([stamped])
}

// Adrian's rule (4 iul): EACH new command starts with an EMPTY monitor — the
// live execution feed is wiped so he sees ONLY the current command's flow. The
// full history is untouched (it lives in devLog / "Jurnal Claude") and the
// server-load bars keep pulsing (they're ambient telemetry, not command output).
// Set whenever a BUILDER/agent posts a live step (via /api/bridge/activity). If a
// build is actively streaming its code-writing, a new chat command must NOT wipe
// those steps off the monitor — otherwise the live demonstration ("uite cum scriu
// codul") is erased mid-write and only ever looks like narration (Adrian, 4 iul).
let lastBuildBeat = 0
export function noteBuildBeat(): void {
  lastBuildBeat = Date.now()
}

export function resetBrainActivity(): void {
  const stamped = `[${stampHM()}] 📥 Comandă nouă — pornesc curat`
  // A build is writing code RIGHT NOW → keep its live steps on the monitor; just
  // append the intake marker instead of wiping. Otherwise start clean as before.
  if (Date.now() - lastBuildBeat < 45_000) {
    devActivity = [...devActivity, stamped].slice(-40)
  } else {
    devActivity = [stamped]
  }
  lastRichFeed = Date.now()
  lastDevBeat = Date.now()
  logDevLines([stamped])
  setProgress(6, 'Preluare')
}

// Kelion speaks a line into the admin's chat by himself (delivered by the
// /api/chat/incoming poll, spoken aloud, and saved to history). Used to deliver
// a LATE answer to a request that stalled — so no request ends without a reply.
export function sayToAdmin(text: string): void {
  const t = text.trim().slice(0, 4000)
  if (!t) return
  sayQueue.push(t)
  void saveMessage(config.adminEmail, 'assistant', t)
}

function authed(req: FastifyRequest): boolean {
  return config.bridgeSecret !== '' && req.headers['x-bridge-secret'] === config.bridgeSecret
}

export async function bridgeRoutes(app: FastifyInstance): Promise<void> {
  // ── CANALUL PERMANENT (minim 5 benzi WS, full-duplex) ────────────────────
  // Workerul deschide wss://kelionai.app/api/bridge/ws de 5 ori și le ține
  // deschise permanent. Secretul călătorește pe subprotocol (clientul standard
  // WebSocket nu poate pune antete): new WebSocket(url, ['kelion-bridge', SECRET]).
  app.get('/api/bridge/ws', { websocket: true }, (socket, req) => {
    const proto = String(req.headers['sec-websocket-protocol'] ?? '')
    const okAuth =
      config.bridgeSecret !== '' &&
      proto
        .split(',')
        .map((s) => s.trim())
        .includes(config.bridgeSecret)
    if (!okAuth) {
      socket.close(4401, 'unauthorized')
      return
    }
    const lane: WsLane = { socket, busy: null }
    wsLanes.add(lane)
    workerBeat()
    socket.on('message', (raw: Buffer) => {
      workerBeat()
      let m: { type?: string; id?: string; text?: string }
      try {
        m = JSON.parse(String(raw))
      } catch {
        return
      }
      if (m.type === 'beat') return // doar ține canalul cald (Cloudflare taie idle)
      if (m.type === 'ack' && m.id) {
        ackSeen = true
        const e = inFlight.get(m.id)
        if (e) e.confirmed = true
        return
      }
      if (m.type === 'chunk' && m.id) {
        const e = inFlight.get(m.id)
        if (e) e.confirmed = true
        const sink = chunkSinks.get(m.id)
        if (sink && typeof m.text === 'string' && m.text) sink(m.text)
        return
      }
      if (m.type === 'keepalive' && m.id) {
        const sink = chunkSinks.get(m.id)
        if (sink) sink('') // pulsul de gândire — armează ceasurile anti-stall
        return
      }
      if (m.type === 'reply' && m.id) {
        if (lane.busy === m.id) lane.busy = null
        inFlight.delete(m.id)
        const resolve = waiters.get(m.id)
        if (resolve) {
          waiters.delete(m.id)
          resolve(typeof m.text === 'string' ? m.text : '')
        }
        // banda s-a eliberat → următorul job din coadă pleacă imediat pe ea
        const next = staleJob() ?? queue.shift()
        if (next) dispatch(next)
        return
      }
    })
    const bye = (): void => {
      wsLanes.delete(lane)
      // un job rămas pe canalul căzut se relivrează prin staleJob (ack-tracking)
    }
    socket.on('close', bye)
    socket.on('error', bye)
  })

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
    if (line) {
      noteBuildBeat() // mark a build is streaming, so chat won't wipe these steps
      noteBrainActivity(line)
    }
    return { ok: true }
  })

  // Builder → a fix is BUILT and READY (branch pushed). Kelion tells Adrian in
  // chat "gata, zi ok"; Adrian's "ok" then deploys it. No approval tab.
  // DOVADA (Adrian, 5 iul: „la nimic din ce zici că faci nu aduci dovada"):
  // constructorul trimite și `proof` — ce s-a schimbat concret + verdictele de
  // build — iar mesajul din chat o poartă; fără ea, anunțul spune cinstit că
  // fixul vine fără dovadă verificată.
  app.post<{ Body: { branch?: string; summary?: string; proof?: string } }>(
    '/api/bridge/ready-deploy',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const branch = typeof req.body?.branch === 'string' ? req.body.branch.trim() : ''
      const summary = typeof req.body?.summary === 'string' ? req.body.summary.trim() : ''
      const proof = typeof req.body?.proof === 'string' ? req.body.proof.trim().slice(0, 300) : ''
      if (!branch) return reply.code(400).send({ error: 'bad_request' })
      // COADĂ: un fix nou NU-l mai suprascrie pe cel care așteaptă — se așază
      // la rând (aceeași ramură nu se dublează, doar i se împrospătează sumarul).
      const dup = readyDeploys.find((r) => r.branch === branch)
      if (dup) {
        dup.summary = summary
        dup.at = Date.now()
      } else {
        readyDeploys.push({ branch, summary, at: Date.now() })
        if (readyDeploys.length > 10) readyDeploys.shift()
      }
      persistReady()
      const pos = readyDeploys.length > 1 ? ` (la rând: ${readyDeploys.length})` : ''
      const proofLine = proof ? ` Dovada: ${proof}.` : ' (fără dovadă de build atașată — cere-o dacă vrei să vezi ce s-a schimbat).'
      const msg = `Am reparat: ${summary || branch}.${proofLine} Aprobi deploy?${pos} Scrie „da" și public pe loc.`
      sayQueue.push(msg)
      void saveMessage(config.adminEmail, 'assistant', msg)
      noteBrainActivity(`✅ Reparat, gata de publicare: ${summary || branch}${proof ? ` — dovada: ${proof.slice(0, 80)}` : ''}`)
      return { ok: true }
    },
  )

  // Server deployer polls this: is there something to publish RIGHT NOW?
  app.get('/api/bridge/deploy-pending', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { deploy: deployWanted }
  })

  // UN SINGUR CUVÂNT, ORIUNDE (Adrian, 5 iul: „dacă scriu aici sau acolo
  // trebuie să fie același lucru"): aprobarea dată constructorului de pe laptop
  // apasă ACELAȘI buton ca „da"-ul din chatul Kelion. Publică DOAR ce e deja
  // pregătit și anunțat (readyDeploy) — nu poate lansa nimic nepregătit.
  app.post('/api/bridge/trigger-deploy', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const t = triggerDeploy()
    return { ok: !!t, summary: t ? t.summary : null }
  })

  // LEGEA 200 PE CERINȚĂ — verdictul testerului de pe server: PASS (cu dovadă)
  // → cerința se închide CERTIFICATĂ; FAIL → pleacă AUTOMAT la reparat și
  // rămâne deschisă. Singurul drum prin care o cerință deployată se închide.
  app.post<{ Body: { pass?: boolean; detail?: string } }>(
    '/api/bridge/requirement-verdict',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const r = ownedRequirement()
      if (!r) return { ok: false, reason: 'no_open_requirement' }
      const detail = String(req.body?.detail ?? '').slice(0, 300)
      if (req.body?.pass === true) {
        resolveRequirement()
        setProgress(100, 'Certificat pe cerință (PASS)')
        const msg = `✅ CERTIFICAT: „${r.summary}" verificată pe comportament (tester PASS)${detail ? ` — ${detail}` : ''}.`
        sayQueue.push(msg)
        void saveMessage(config.adminEmail, 'assistant', msg)
        noteBrainActivity('🟢 200 — cerință certificată (tester PASS)')
      } else {
        updateRequirement('FAIL la tester — trimisă automat la reparat')
        noteBrainActivity('🔴 fără 200 — cerința a picat la tester → reparat automat')
        bridgeRepair(
          `LEGEA 200 (auto): cerința „${r.summary}" a picat verificarea pe live: ${detail || 'fără detaliu'}. Găsește cauza, repar-o și re-publică prin fluxul normal.`,
        )
        const msg = `❌ „${r.summary}" a picat verificarea pe comportament (${detail || 'fără detaliu'}) — am trimis-o automat la reparat. Rămâne deschisă.`
        sayQueue.push(msg)
        void saveMessage(config.adminEmail, 'assistant', msg)
      }
      return { ok: true }
    },
  )

  // Server deployer → done publishing (ok or failed). Tells Adrian in chat.
  app.post<{ Body: { ok?: boolean; detail?: string } }>(
    '/api/bridge/deploy-done',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const failedBranch = deployWanted?.branch ?? ''
      const failedSummary = deployWanted?.summary ?? ''
      deployWanted = null
      const ok = req.body?.ok !== false
      if (ok) {
        // NU mai anunțăm „publicat" pe cuvântul deployerului. Creierul verifică
        // el însuși live-ul (fetch → 200) și abia apoi confirmă (Adrian, 5 iul:
        // „trimis ≠ gata"). Rulează asincron ca deployerul să primească răspuns
        // imediat. Ștergerea cererilor rămâne DUPĂ triajul creierului (4 iul).
        void confirmLiveThenAnnounce(failedSummary)
      } else {
        // Adrian's rule: if it doesn't work, ASK him BY VOICE to approve a retry
        // — never a silent auto-redeploy. Re-stage the branch so his "ok"
        // republishes it (the affirm path calls triggerDeploy → the deployer).
        if (failedBranch && !readyDeploys.some((r) => r.branch === failedBranch)) {
          readyDeploys.unshift({ branch: failedBranch, summary: failedSummary, at: Date.now() })
          persistReady()
        }
        const detail = String(req.body?.detail || '').slice(0, 200)
        const msg = `Deploy-ul a picat: ${detail}. Nu s-a publicat nimic — versiunea veche e tot live. Vrei să reîncerc? Zi „ok".`
        sayQueue.push(msg)
        void saveMessage(config.adminEmail, 'assistant', msg)
        noteBrainActivity('🔴 Deploy eșuat — aștept „ok" să reîncerc')
      }
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
  // shown bottom-left on the admin's work monitor as a text readout. (The old
  // numeric cpu/mem/disk bars were replaced by the process progress bar, so any
  // extra fields the paznic still sends are simply ignored.)
  app.post<{ Body: { line?: string } }>(
    '/api/bridge/server-load',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const b = req.body ?? {}
      const line = typeof b.line === 'string' ? b.line.slice(0, 200) : ''
      if (line) {
        srvLoad = line
        srvLoadAt = Date.now()
      }
      return { ok: true }
    },
  )

  app.get('/api/dev/status', async () => {
    const active = Date.now() - lastDevBeat < 60_000
    return {
      active,
      bridge: bridgeOnline(),
      activity: active ? devActivity : [],
      srv: Date.now() - srvLoadAt < 180_000 ? srvLoad : '',
      // THE process bar 0→100% (what's executing, start→finish). Kept for 2 min
      // after the last update so a just-finished job stays visible, then clears.
      progress:
        procAt && Date.now() - procAt < 120_000
          ? { pct: procPct, label: procLabel, file: procFile }
          : null,
      // CERINȚA DEȚINUTĂ: ce cerință de execuție e încă deschisă (neverificată
      // live). Rămâne aici până creierul o verifică — dovada că nu „trimite și
      // uită". null = nicio cerință deschisă (Adrian, 5 iul).
      owned: ownedRequirement(),
    }
  })

  // Detaliul analizei — DOAR pentru admin (textul cererii NU se dă publicului;
  // /api/dev/status rămâne fără el). Frontend-ul îl cere la click pe bara
  // „Creierul analizează" și arată: cererea în lucru, etapa curentă și ultimii
  // pași din jurnal — exact ce analizează creierul acum.
  app.get('/api/dev/analysis', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const fresh = procDetailAt && Date.now() - procDetailAt < 30 * 60_000
    return {
      request: fresh ? procDetail : '',
      at: fresh ? new Date(procDetailAt).toISOString() : null,
      stage:
        procAt && Date.now() - procAt < 120_000
          ? { pct: procPct, label: procLabel, file: procFile }
          : null,
      steps: devLog.slice(-20),
    }
  })

  // chat/builder/deployer → push the process progress (secret-protected).
  app.post<{ Body: { pct?: number; label?: string; file?: string } }>(
    '/api/bridge/progress',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const b = req.body ?? {}
      if (typeof b.pct === 'number') setProgress(b.pct, String(b.label ?? ''), String(b.file ?? ''))
      return { ok: true }
    },
  )

  // Watchdog probe (secret-protected): is the worker ACTUALLY polling? The
  // server-side watchdog restarts the worker when this says online:false —
  // catching the "process alive but hung" case systemd can't see.
  app.get('/api/bridge/health', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { online: bridgeOnline(), lastSeenMs: Date.now() - lastWorkerSeen, wsLanes: wsLaneCount() }
  })

  // Worker → server: "give me the next admin prompt" (long-poll up to 25s).
  app.post('/api/bridge/pull', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    const ready = staleJob() ?? queue.shift()
    if (ready) {
      markServed(ready)
      return { job: ready }
    }
    const job = await new Promise<PendingJob | null>((resolve) => {
      pullWaiters.push(resolve)
      // Release exactly once: on the 25s long-poll expiry OR the moment the
      // worker's connection drops — a job must never be served into a socket
      // that is already dead. The drop signal is 'close' on the RESPONSE (fires
      // early only on premature termination); on the request it fires as soon
      // as the body is consumed and would kill every long-poll instantly.
      const release = (): void => {
        const i = pullWaiters.indexOf(resolve)
        if (i !== -1) {
          pullWaiters.splice(i, 1)
          resolve(null)
        }
      }
      setTimeout(release, 25_000)
      reply.raw.once('close', release)
    })
    workerBeat()
    if (job) markServed(job)
    return { job }
  })

  // Worker → server: "I received job <id> and I'm on it." From this ack on, the
  // job is CONFIRMED delivered; without it, the server re-serves the job once
  // (see staleJob) — so a message can no longer die on a dropped long-poll.
  app.post('/api/bridge/ack', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    ackSeen = true
    const body = (req.body ?? {}) as { id?: string }
    const entry = body.id ? inFlight.get(body.id) : undefined
    if (entry) entry.confirmed = true
    return { ok: !!entry }
  })

  // Worker → server: a text CHUNK while the model is still writing (streaming).
  // Forwarded live into the admin's open reply — first words in ~2 seconds.
  app.post('/api/bridge/reply-chunk', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    const body = (req.body ?? {}) as { id?: string; text?: string; keepalive?: boolean }
    const flying = body.id ? inFlight.get(body.id) : undefined
    if (flying) flying.confirmed = true // a chunk is proof of delivery too
    const sink = body.id ? chunkSinks.get(body.id) : undefined
    if (sink && body.keepalive) {
      // PULS DE VIAȚĂ (urgența 3): the brain is THINKING (no text yet). Arm the
      // stall timers with an empty chunk so a hard question is never mistaken
      // for a dead bridge (which re-queued the job and threw the answer away).
      sink('')
    } else if (sink && typeof body.text === 'string' && body.text) {
      sink(body.text)
    }
    return { accepted: !!sink }
  })

  // Worker → server: the finished answer for a job. Posting a reply is proof
  // of life — refresh the presence clock here too.
  app.post('/api/bridge/reply', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    const body = (req.body ?? {}) as { id?: string; text?: string }
    if (body.id) inFlight.delete(body.id)
    const resolve = body.id ? waiters.get(body.id) : undefined
    if (!resolve || !body.id) return { accepted: false }
    waiters.delete(body.id)
    resolve(typeof body.text === 'string' ? body.text : '')
    return { accepted: true }
  })
}
