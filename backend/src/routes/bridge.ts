import type { FastifyInstance, FastifyRequest } from 'fastify'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { superviseDecision, escalationText, DEFAULT_SUPERVISE } from '../services/supervisor.js'
import { buildBrainReport, fallbackLine, type AgentOutcome } from '../services/feedback.js'
import { decideDeployFailure, isDuplicateOrder, composeOrdersReport } from '../services/orders.js'
import { budgetCheck, sameFailure, DEFAULT_AUTONOMY } from '../services/autonomy.js'
import {
  saveMessage,
  getRecentHistory,
  getSharedMemory,
  appendSharedMemory,
  saveWorkOrder,
  pullPendingWorkOrders,
  listWorkOrders,
  setWorkOrderStatus,
  finalizeStaleWorkOrders,
  saveStagedRelease,
  listStagedReleases,
  setReleaseStatus,
  addMemory,
  saveKv,
  loadKv,
  putAppFile,
  getCostToday,
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
  // PUBLIC (ordin direct Adrian, 10 iul: „peste tot abonamentul mare"): jobul
  // vine de la un VIZITATOR, nu de la proprietar. Workerul NU atașează
  // contextul privat (context.md) și folosește personajul neutru Kelion —
  // proiectul proprietarului nu se scurge niciodată către străini.
  persona?: 'public'
  // SESIUNI CALDE PER-VIZITATOR (#7 latență, 11 iul): cheia stabilă a
  // vizitatorului (emailul sesiunii — unic per demo/client). Workerul ține câte
  // o sesiune caldă IZOLATĂ pentru fiecare cheie: turele 2+ nu mai plătesc
  // pornirea + re-amorsarea → primul cuvânt ca la admin. Fără cheie → proces
  // proaspăt ca până acum.
  visitor?: string
}

const queue: PendingJob[] = []
const waiters = new Map<string, (text: string | null) => void>()
// FIFO of pending worker long-polls. It was a SINGLE slot: a second concurrent
// pull silently overwrote the first, whose request then hung FOREVER (its
// timeout guard no longer matched) — freezing that worker and losing the
// admin's messages (4 iul). Every waiting poll now gets served or released.
// Fiecare așteptător de pull vine cu CAPABILITĂȚILE declarate de worker.
// GARD DE SCURGERE (Adrian, 10 iul — poza cu demo-ul tratat ca „Adrian"): un
// job PUBLIC se dă DOAR unui worker care a declarat cap "persona" la pull.
// Workerul vechi/zombie de pe VPS (din afara repo-ului) nu declară nimic →
// nu mai poate primi NICIODATĂ un job de vizitator (ar fi răspuns cu context.md).
const pullWaiters: { caps: Set<string>; resolve: (job: PendingJob | null) => void }[] = []
const canServe = (job: PendingJob, caps: Set<string>): boolean =>
  job.persona !== 'public' || caps.has('persona')
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
// Relivrarea respectă ACELEAȘI capabilități — un job public nu se relivrează
// niciodată unui worker care nu știe de persona.
function staleJob(caps: Set<string>): PendingJob | null {
  if (!ackSeen) return null
  const now = Date.now()
  for (const [id, e] of inFlight) {
    if (!waiters.has(id)) {
      inFlight.delete(id) // turn finished or timed out — nothing to redeliver
      continue
    }
    if (!e.confirmed && e.tries < 2 && now - e.at > 15_000 && canServe(e.job, caps)) return e.job
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
// Motorul de lucru raportat de constructor (max/kimi/glm) — ultima valoare
// cunoscută, afișată permanent în admin. PERSISTENT peste restarturi (11 iul,
// dovadă live: după deploy-ul din 19:17 indicatorul era gol, deși Adrian a
// cerut „afișat permanent" — constructorul anunță doar SCHIMBĂRILE de treaptă,
// deci fără persistență fiecare deploy îl golea până la următoarea comutare).
let workEngine = ''
void loadKv('work_engine')
  .then((v) => {
    if (v && !workEngine) workEngine = v
  })
  .catch(() => {})
// Codul scris de constructor, bucată cu bucată — arătat SUB bara de progres
// la click (Adrian, 11 iul). Plafonat la ultimele 120 de editări.
const workCode: { ts: number; file: string; text: string }[] = []
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

// ── CRONOMETRUL CREIERULUI (Adrian, 10 iul: „calculează viteza lui, afișează
// timpii pe chat simplu / chat cu cerință") ──────────────────────────────────
// Măsurăm FIECARE tură: când a intrat, când a venit PRIMUL cuvânt (viteza reală
// a creierului Linux) și cât a durat totul. `turnActive` e adevărat DOAR între
// intrarea comenzii și terminarea ei — bara de proces se arată doar când chiar
// se lucrează, nu 120s după (bug „lucru fals 30%"). `lastTurn` rămâne ca dovadă:
// tipul turei (chat/lucru) + timpii, afișat pe monitor și după ce bara se stinge.
let turnStartAt = 0
let firstWordAt = 0
let turnActive = false
let procDoneAt = 0
let lastTurn: { kind: 'chat' | 'lucru'; totalMs: number; firstMs: number; at: number } | null = null

export function startTurnClock(): void {
  turnStartAt = Date.now()
  firstWordAt = 0
  turnActive = true
}
// Primul cuvânt real de la creier → asta e VITEZA lui (cât a stat „pe gânduri").
export function markFirstWord(): void {
  if (turnActive && turnStartAt && !firstWordAt) firstWordAt = Date.now()
}
// E o tură ÎN LUCRU chiar acum? Filtrul anti-ecou din chat înghite un mesaj
// identic DOAR cât timp Kelion chiar răspunde/vorbește (ecoul de microfon apare
// atunci). Când e liniște, un mesaj retrimis identic e Adrian care insistă
// fiindcă n-a primit răspuns — pornește o tură reală, nu-l mai arunca.
export function brainTurnActive(): boolean {
  return turnActive
}
// Tura s-a terminat. `chat` = proces COMPLET (bara ajunge la 100 și apoi se
// stinge). `lucru` = predat constructorului (bara continuă de la el). În ambele
// cazuri stampilăm timpii și îi afișăm pe monitor — Adrian VEDE viteza reală.
export function finishBrainTurn(kind: 'chat' | 'lucru'): void {
  if (!turnActive) return // deja închisă — nu stampila de două ori aceeași tură
  const now = Date.now()
  const totalMs = turnStartAt ? now - turnStartAt : 0
  const firstMs = firstWordAt && turnStartAt ? firstWordAt - turnStartAt : 0
  lastTurn = { kind, totalMs, firstMs, at: now }
  turnActive = false
  procDoneAt = now
  const s = (ms: number): string => (ms / 1000).toFixed(1)
  const timing = firstMs
    ? `${s(totalMs)}s (primul cuvânt ${s(firstMs)}s)`
    : `${s(totalMs)}s`
  if (kind === 'lucru') {
    noteBrainActivity(`🛠 Trimis la constructor · ${timing}`)
  } else {
    setProgress(100, `Gata · ${s(totalMs)}s`)
    noteBrainActivity(`✅ Răspuns trimis · ${timing}`)
  }
  turnStartAt = 0
  firstWordAt = 0
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
    const msg = `Mai am ${readyDeploys.length} la rând de publicat — următorul: ${readyDeploys[0].summary.slice(0, 120)}. Zi „da" din nou când vrei.`
    sayQueue.push(msg)
    persistSay()
    void saveMessage(config.adminEmail, 'assistant', msg)
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
    persistSay()
    void saveMessage(config.adminEmail, 'assistant', msg)
    noteBrainActivity('🟢 PUBLICAT + VERIFICAT LIVE (200)')
    if (ownedReq?.orderId) void setWorkOrderStatus(ownedReq.orderId, 'published')
    const r = ownedRequirement()
    if (r) {
      // LEGEA 200 PE CERINȚĂ (Adrian, 5 iul): site-ul sus NU închide cerința.
      // Comportamentul ei e verificat pe live de tester; închiderea vine DOAR
      // pe verdict PASS (endpointul requirement-verdict). FAIL → auto-reparat.
      updateRequirement('verific comportamentul pe live (tester)')
      setProgress(97, 'Verific comportamentul cerinței')
      bridgeRepair(
        `VERIFICARE PE CERINȚĂ (auto, după deploy verificat live): testează pe kelionai.app că cerința „${r.summary}" chiar se comportă conform — dovezi reale (curl, codul livrat, încercare concretă), nu presupuneri. Apoi raportează verdictul cu: curl -s -X POST https://kelionai.app/api/bridge/requirement-verdict -H "x-bridge-secret: $(cat /root/kelion/bridge-secret.txt)" -H "content-type: application/json" -d '{"pass":true,"detail":"dovada scurtă"}' — sau pass:false cu motivul exact. INTERZIS verdict fără dovadă.`,
        { autonomous: true },
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
    persistSay()
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
  orderId?: string // ordinul din work_orders legat de cerință (pt stadiu real)
  lastFailDetail?: string // ultimul motiv de eșec (pt oprirea pe aceeași eroare)
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
export function openRequirement(summary: string, task?: string, orderId?: string): void {
  ownedReq = {
    summary: summary.slice(0, 120),
    status: 'primită',
    at: Date.now(),
    opened: Date.now(),
    nudged: 0,
    attempts: 0,
    task: (task ?? summary).slice(0, 4000),
    orderId,
  }
  persistOwned()
  // Adrian pornește o sarcină nouă → e prezent și conduce: dă autonomiei loc
  // proaspăt de lucru (reset la plafonul rulant).
  resetAutonomyBudget()
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
      const newOrderId = bridgeRepair(
        `SUPERVIZOR — încercarea ${r.attempts}/${max}: agentul anterior N-A dus la capăt „${r.summary}". ` +
          `${escalationText(r.attempts, max)}\n\nSARCINA: ${r.task || r.summary}`,
        { autonomous: true },
      )
      // BUG REAL (Adrian, 6 iul: „stadiu real, nu în lucru pe veci"): fiecare
      // reasignare crea un ORDIN NOU în registru dar `ownedReq.orderId` rămânea
      // legat de PRIMUL ordin — la publicare `confirmLiveThenAnnounce` marca
      // "published" ordinul vechi, iar ordinul reasignat (cel care CHIAR se
      // execută și ajunge să fie construit/publicat) rămânea "delivered" (în
      // lucru) în registru pentru totdeauna, orice s-ar fi întâmplat cu el.
      // Legăm cerința deținută de ordinul NOU, ca stadiul să urmeze agentul activ.
      // ÎNCHIDEM ordinul înlocuit (Adrian, 8 iul): lanțul de reasignări lăsa
      // ordinul vechi „delivered" (în lucru) pe veci. Acum, când agentul e
      // înlocuit, ordinul lui precedent trece pe `finalized` (închis, înlocuit) —
      // stadiul urmează realitatea, nu rămâne blocat.
      if (newOrderId) {
        if (r.orderId && r.orderId !== newOrderId) void setWorkOrderStatus(r.orderId, 'finalized')
        r.orderId = newOrderId
      }
      updateRequirement(`re-asignat unui agent proaspăt (încercarea ${r.attempts}/${max})`)
      noteBrainActivity(
        `🔁 Supervizor: „${r.summary}" re-asignată — agent proaspăt, escaladat (${r.attempts}/${max})`,
      )
      return
    }
    // giveup: gata cu re-asignările automate → NU buclează la infinit, decizia lui Adrian.
    // Ordinul trece pe `failed` (Adrian, 8 iul): onest — după max încercări chiar
    // NU s-a dus la capăt; nu-l mai lăsăm „în lucru" pe veci în registru.
    if (ownedReq?.orderId) void setWorkOrderStatus(ownedReq.orderId, 'failed')
    updateRequirement(`BLOCAT după ${max} încercări — decizia lui Adrian`)
    const msg =
      `🛑 „${r.summary}": ${max} agenți la rând n-au dus-o la capăt. Nu mai re-asignez automat. ` +
      `Vrei s-o simplific, s-o las, sau îmi dai alt unghi?`
    sayQueue.push(msg)
    persistSay()
    void saveMessage(config.adminEmail, 'assistant', msg)
    noteBrainActivity(`🛑 Supervizor: „${r.summary}" blocată după ${max} încercări — la decizia lui Adrian`)
    r.nudged = Date.now() + 24 * 3600_000 // oprește re-verificarea automată până se schimbă ceva
    persistOwned()
  })()
}, 60_000).unref()

// RECONCILIERE PERIODICĂ A REGISTRULUI (Adrian, 8 iul: „procedura e defectă dacă
// rămân în «preluat» pe veci — reparat, iar când e gata → finalizat"). Plasa de
// siguranță generică: orice ordin `delivered` care NU e cel activ deținut acum și
// stă abandonat de peste 30 min (lanț SUPERVIZOR vechi, verificare auto terminată,
// agent picat fără raport) e trecut pe `finalized` = închis. NU șterge nimic — doar
// scoate din „în lucru" pe veci, ca registrul să spună adevărul. Rulează la 5 min.
setInterval(() => {
  void finalizeStaleWorkOrders(ownedReq?.orderId ?? null, 30 * 60_000)
    .then((ids) => {
      if (ids.length) noteBrainActivity(`🧹 Registru: ${ids.length} ordine blocate închise (finalizat) — reconciliere`)
    })
    .catch(() => {})
}, 5 * 60_000).unref()
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
// FĂRĂ AMNEZIE LA RESTART (Adrian, 6 iul): jurnalul era doar în RAM și dispărea
// la fiecare deploy/restart Railway — de-aia părea mereu gol. Persistat în
// Postgres ca sayQueue/readyDeploys/ownedReq: se salvează la fiecare linie
// nouă și se reîncarcă la pornire.
void loadKv('dev_log')
  .then((v) => {
    if (!v) return
    const arr = JSON.parse(v) as unknown[]
    if (Array.isArray(arr)) {
      for (const l of arr) if (typeof l === 'string' && l) devLog.push(l)
    }
  })
  .catch(() => {})
// Ora din jurnal/monitor/admin trebuie să fie ACEEAȘI oră pe care Adrian o
// vede în chat (ora lui locală), nu UTC-ul serverului. Fusul lui e reținut din
// fiecare tură de chat și PERSISTAT în kv_state („da"-ul lui, 5 iul: aceeași
// oră și în admin) — un restart/redeploy Railway nu-l mai uită; Europe/Bucharest
// doar până se află prima dată. (Fixul original, 226d248, rămăsese pe un branch
// nemergeuit — de-aia „s-a schimbat ora iar" la fiecare deploy.)
let ownerTz = 'Europe/Bucharest'
export function setOwnerTz(tz: string): void {
  if (!tz || tz === ownerTz) return
  try {
    new Intl.DateTimeFormat('ro-RO', { timeZone: tz })
    ownerTz = tz
    void saveKv('owner_tz', tz).catch(() => {})
  } catch {
    /* fus invalid de la client — păstrăm ultimul bun */
  }
}
void loadKv('owner_tz')
  .then((tz) => {
    // Doar dacă între timp nu a sosit deja unul viu dintr-o tură de chat.
    if (tz && ownerTz === 'Europe/Bucharest') setOwnerTz(tz)
  })
  .catch(() => {})
function stampHM(): string {
  return new Date().toLocaleTimeString('ro-RO', {
    timeZone: ownerTz,
    hour: '2-digit',
    minute: '2-digit',
  })
}
// Words Claude wants to say FIRST in the admin's chat (delivered by poll).
const sayQueue: string[] = []
// FĂRĂ AMNEZIE LA RESTART (Adrian, 5 iul): un mesaj gata de livrat („gata!"/
// verdict) care nu apucă să fie pollat înainte de restart-ul provocat chiar de
// deploy-ul lui era ȘTERS definitiv din memorie — Adrian nu-l mai vedea
// niciodată. Coada se persistă în Postgres la fiecare schimbare, la fel ca
// readyDeploys/ownedReq, și se reîncarcă la pornire.
function persistSay(): void {
  void saveKv('say_queue', JSON.stringify(sayQueue)).catch(() => {})
}
void loadKv('say_queue')
  .then((v) => {
    if (!v) return
    const arr = JSON.parse(v) as unknown[]
    if (Array.isArray(arr)) {
      for (const m of arr) if (typeof m === 'string' && m) sayQueue.push(m)
    }
  })
  .catch(() => {})
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
  let added = false
  for (const l of lines) {
    if (devLogSeen.has(l)) continue
    devLogSeen.add(l)
    devLog.push(`${stampHM()} ${l}`)
    added = true
  }
  if (devLog.length > 600) devLog.splice(0, devLog.length - 600)
  if (devLogSeen.size > 2000) devLogSeen.clear()
  if (added) void saveKv('dev_log', JSON.stringify(devLog)).catch(() => {})
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
  // KELION ANUNȚĂ (Adrian, 10 iul: „cu mențiune că Kelion anunță că e ceva de
  // aprobat"): spune-i lui Adrian în chat + cu voce că are ceva de aprobat, ca
  // să nu-i scape release-ul agățat în tabul Release-uri.
  sayToAdmin(`Am ceva de aprobat: „${title.slice(0, 120)}". Deschide Release-uri și aprobă sau respinge.`)
  return id
}

// ── CANAL PERMANENT FULL-DUPLEX (ordinul lui Adrian, 4 iul) ────────────────
// Workerul ține MINIM 5 canale WebSocket permanent deschise. Un job e ÎMPINS pe
// un canal liber ÎN CLIPA în care apare (zero drum de long-poll); bucățile de
// text, pulsul de viață și răspunsul final curg înapoi pe ACELAȘI canal.
// Long-poll-ul HTTP rămâne DOAR plasă de siguranță când niciun canal nu e sus.
// ── CALEA WEBSOCKET E PENSIONATĂ (9 iul, „legătura la creier e ruptă") ──────
// NICIUN worker din repo nu mai vorbește WebSocket — toți merg pe long-poll
// HTTP. Cele „10 benzi" vii veneau de la un proces VECHI de pe VPS (script
// din afara repo-ului) care ținea canalele deschise cu beat-uri și chiar
// confirma primirea joburilor, dar NU livra niciodată răspunsul — mesajele
// lui Adrian mureau acolo, cu becul verde. De aceea: joburile pleacă EXCLUSIV
// pe calea HTTP (unde stau workerii reali), conexiunile WS sunt refuzate la
// ușă, iar becul „Bridge" arată doar legătura HTTP reală.
function dispatch(job: PendingJob): void {
  // Alege PRIMUL așteptător care POATE servi jobul: jobul PUBLIC cere cap
  // "persona" (gard de scurgere — zombiul nu declară nimic); al adminului
  // merge la oricine.
  const i = pullWaiters.findIndex((w) => canServe(job, w.caps))
  if (i !== -1) {
    const [w] = pullWaiters.splice(i, 1)
    w.resolve(job)
  } else if (!queue.some((j) => j.id === job.id)) {
    // PRIORITATE: mesajele PROPRIETARULUI sar în fața cozii — un val de
    // vizitatori (joburi publice) nu-l poate face pe Adrian să aștepte după ei.
    if (job.persona === 'public') queue.push(job)
    else queue.unshift(job)
  }
}

// Calitatea legăturii pentru becul din UI (fostul număr de benzi WS, 0–10):
// acum e prospețimea workerului HTTP — 10 = a dat semn chiar acum, scade cu
// vârsta ultimului semn, 0 = punte jos. Frontend-ul colorează verde→roșu→gri.
export function wsLaneCount(): number {
  if (config.bridgeSecret === '') return 0
  const age = Date.now() - lastWorkerSeen
  if (age < 20_000) return 10
  if (age < 40_000) return 7
  if (age < 60_000) return 4
  if (age < 75_000) return 2
  return 0
}

// The worker polls every ≤30s; seen within 75s = online. CRUCIAL nuance: while
// the worker is BUSY answering a job it does not poll — that must count as
// ALIVE, not dead (otherwise the second of two back-to-back admin messages got
// a false "bridge down"). A job dispatched recently with its waiter still
// pending = the bridge is right there, working.
let lastJobDispatched = 0
export function bridgeOnline(): boolean {
  if (config.bridgeSecret === '') return false
  // DOAR legătura HTTP reală contează (pull/ack/chunk/reply de la worker).
  // Beat-urile WS nu mai există — nu mai poate lumina becul un proces mut.
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
  persona: 'public' | '' = '',
  visitor = '',
): Promise<string | null> {
  const job: PendingJob = {
    id: randomUUID(),
    kind: 'chat',
    prompt,
    files,
    turn: turn || undefined,
    persona: persona || undefined,
    visitor: visitor || undefined,
  }
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
// METODA DE UNICAT (Adrian, 5 iul: „scoate 1 Influencer… creiază metoda de
// unicat"): același ordin nu se mai construiește de două ori. Ținem textele
// recente în memorie și sărim duplicatele înainte să ajungă la constructor.
const recentOrderTexts: string[] = []

// ── AUTONOMIE ÎN LESĂ (Adrian, 9 iul: „să nu mă aducă în sapă de lemn") ───────
// Întrerupătorul PRINCIPAL peste TOATE reparațiile autonome: un plafon rulant pe
// 24h. Sub plafon, autonomia lucrează liber; la plafon ÎNGHEAȚĂ și Kelion cere
// OK (chatul lui Adrian nu se blochează niciodată). Contorul se persistă
// (supraviețuiește restartului) și se resetează când Adrian pornește EL o sarcină
// nouă — semn că e prezent și conduce, deci nu-l mai ținem în frâu.
const autonomyCfg = { windowMs: DEFAULT_AUTONOMY.windowMs, maxRuns: config.autonomyDailyMax }
let autonomyRuns: number[] = []
let autonomyFrozenAt = 0
function persistAutonomy(): void {
  void saveKv('autonomy_runs', JSON.stringify(autonomyRuns)).catch(() => {})
}
void loadKv('autonomy_runs')
  .then((v) => {
    if (!v) return
    const a = JSON.parse(v) as unknown[]
    if (Array.isArray(a)) autonomyRuns = a.filter((n): n is number => typeof n === 'number')
  })
  .catch(() => {})
// Adrian pornește o sarcină nouă (calea lui [EXECUT]) → e prezent și conduce:
// resetează plafonul autonom, ca autonomia să aibă din nou loc de lucru.
export function resetAutonomyBudget(): void {
  if (autonomyRuns.length === 0 && autonomyFrozenAt === 0) return
  autonomyRuns = []
  autonomyFrozenAt = 0
  persistAutonomy()
}

export function bridgeRepair(description: string, opts: { autonomous?: boolean } = {}): string | null {
  const text = description.slice(0, 4000)
  if (isDuplicateOrder(text, recentOrderTexts)) {
    noteBrainActivity('↩️ Ordin duplicat — deja în lucru/făcut, nu-l repet')
    return null
  }
  // ÎNTRERUPĂTORUL AUTONOM: doar acțiunile autonome (supervizor / verificare) trec
  // pe la plafon; cererile lui Adrian (chat, panou, request_repair) nu sunt
  // îngrădite NICIODATĂ — el decide, el cheltuie cât vrea.
  if (opts.autonomous) {
    const chk = budgetCheck(autonomyRuns, Date.now(), autonomyCfg)
    autonomyRuns = chk.recent
    if (!chk.allowed) {
      persistAutonomy()
      // Anunță o dată pe oră cât e înghețat, ca să nu spameze chatul.
      if (Date.now() - autonomyFrozenAt > 3600_000) {
        autonomyFrozenAt = Date.now()
        const msg =
          `🧯 Am atins plafonul autonom (${chk.count}/${autonomyCfg.maxRuns} reparații automate în 24h). ` +
          `Îngheț reparațiile automate ca să nu consum aiurea. Zi „continuă" sau pornește o sarcină nouă și reiau.`
        sayQueue.push(msg)
        persistSay()
        void saveMessage(config.adminEmail, 'assistant', msg)
        noteBrainActivity('🧯 Plafon autonom atins — autonomie înghețată, aștept OK')
      }
      return null
    }
    autonomyRuns = [...chk.recent, Date.now()]
    persistAutonomy()
  }
  recentOrderTexts.push(text)
  if (recentOrderTexts.length > 30) recentOrderTexts.shift()
  const id = randomUUID()
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
  // Pornim cronometrul turei chiar la intrare — de aici măsurăm viteza reală.
  startTurnClock()
}

// Kelion speaks a line into the admin's chat by himself (delivered by the
// /api/chat/incoming poll, spoken aloud, and saved to history). Used to deliver
// a LATE answer to a request that stalled — so no request ends without a reply.
export function sayToAdmin(text: string): void {
  const t = text.trim().slice(0, 4000)
  if (!t) return
  sayQueue.push(t)
  persistSay()
  void saveMessage(config.adminEmail, 'assistant', t)
}

// RAPORTUL ZILNIC DE BANI (Adrian, 11 iul, aprobat: „6 da"): o dată pe zi,
// seara după ora 21 (ora lui Adrian), Kelion spune singur în chat cât a costat
// ziua pe fiecare motor plătit la consum — Adrian știe mereu unde se duc banii
// fără să întrebe. Abonamentele fixe (Max/Kimi/GLM) nu apar — nu variază.
setInterval(() => {
  void (async () => {
    const h = Number(
      new Date().toLocaleString('en-GB', { timeZone: ownerTz, hour: '2-digit', hour12: false }),
    )
    if (Number.isNaN(h) || h < 21) return
    const day = new Date().toLocaleDateString('en-CA', { timeZone: ownerTz })
    const last = await loadKv('cost_report_day').catch(() => null)
    if (last === day) return
    await saveKv('cost_report_day', day).catch(() => {})
    const rows = await getCostToday()
    const total = rows.reduce((s, r) => s + r.sum, 0)
    const parts = rows
      .filter((r) => r.sum > 0.0005)
      .map((r) => `${r.kind} $${r.sum.toFixed(2)}`)
      .join(' · ')
    sayToAdmin(
      `💰 Banii zilei (API la consum): $${total.toFixed(2)}${parts ? ` — ${parts}` : ' — nimic azi'}. Abonamentele (Max/Kimi/GLM) sunt fixe și nu intră aici.`,
    )
  })()
}, 10 * 60_000).unref()

// ÎNCHIDE BUCLA ÎN CREIER (Adrian, 5 iul: „kelion nu primește niciodată în chat").
// În loc să împingem un text gata-făcut în chat (creier orb), RE-CHEMĂM creierul
// cu rezultatul agentului ca să-l raporteze cu VOCEA lui, verificat, cu dovada —
// astfel Kelion PRIMEȘTE rezultatul (îl are în sesiune, îl poate discuta). E
// fire-and-forget: handlerul HTTP al constructorului NU așteaptă. Dacă puntea e
// offline SAU creierul nu răspunde la timp → mesajul de rezervă (comportamentul de
// azi), ca notificarea să nu se piardă NICIODATĂ. Vezi services/feedback.ts.
async function reportToAdmin(o: AgentOutcome): Promise<void> {
  const deliver = (text: string): void => {
    const t = text.trim().slice(0, 4000)
    if (!t) return
    sayQueue.push(t)
    persistSay()
    void saveMessage(config.adminEmail, 'assistant', t)
  }
  if (!bridgeOnline()) {
    deliver(fallbackLine(o))
    return
  }
  try {
    const reply = await bridgeAsk(buildBrainReport(o), [], 60_000)
    deliver(reply && reply.trim() ? reply : fallbackLine(o))
  } catch {
    deliver(fallbackLine(o))
  }
}

// Diagnoza eșecurilor de autentificare, throttled (max 1/min): istoricul punții
// a arătat că o nepotrivire de secret tăcută lasă componentele de pe VPS
// (paznic, deployer, constructor) fără acces și pe nimeni fără indiciu — de-aia
// s-a ajuns la dezactivarea de urgență. Se loghează DOAR lungimile, niciodată
// conținutul secretului.
let lastAuthFailLog = 0

function authed(req: FastifyRequest): boolean {
  // Header-ul se normalizează (trim) fiindcă scripturile de pe VPS citesc
  // secretul din fișier și pot aduce spații/CRLF — exact nepotrivirea care a
  // dus la „testul de urgență" ce lăsase toate endpoint-urile fără apărare.
  const got = String(req.headers['x-bridge-secret'] ?? '').trim()
  const want = config.bridgeSecret
  // Comparație în timp constant: `===` iese la primul octet diferit → scurgere
  // de timing pe secretul cu putere totală (upload installer, cozi, deploy).
  const ok = want !== '' && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))
  if (!ok && got !== '' && Date.now() - lastAuthFailLog > 60_000) {
    lastAuthFailLog = Date.now()
    console.log(`[bridge] auth fail: header ${got.length} chars vs secret ${want.length}`)
  }
  return ok
}

export async function bridgeRoutes(app: FastifyInstance): Promise<void> {
  // ── CANALUL WEBSOCKET — PENSIONAT ──────────────────────────────────────────
  // Un proces vechi de pe VPS (din afara repo-ului) ținea 10 canale WS deschise,
  // „viu" la beat-uri, dar mut la joburi — mesajele lui Adrian mureau pe el cu
  // becul verde. Endpoint-ul rămâne doar ca să-i închidă ușa politicos: orice
  // conexiune e refuzată imediat, ca serverul lui să nu mai pară nimănui punte.
  app.get('/api/bridge/ws', { websocket: true }, (socket) => {
    socket.close(4410, 'ws-retired: puntea merge exclusiv pe long-poll HTTP')
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
    persistSay()
    void saveMessage(config.adminEmail, 'assistant', text.slice(0, 4000))
    return { ok: true }
  })

  // The admin's ChatPanel polls this — Claude's waiting words, delivered once.
  app.get('/api/chat/incoming', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const messages = sayQueue.splice(0, sayQueue.length)
    persistSay()
    return { messages }
  })

  // Laptop-Claude picks up its WORK ORDERS here (secret-protected, delivered
  // once): the build/fix tasks the chat decided are for the builder. Pulling
  // marks them 'delivered' in Postgres — never deletes, so the admin can always
  // SEE what was sent and when it was picked up.
  app.get('/api/bridge/workorders', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const rows = await pullPendingWorkOrders()
    // Adrian, 11 iul: „de ce nu apare la ce se lucrează?" — caseta „Cererea în
    // analiză" se umplea DOAR din chat; ordinele lucrate de constructor n-o
    // atingeau niciodată, deci în plin lucru scria „nicio cerere activă".
    // Livrarea e chiar momentul în care constructorul se apucă de ordin —
    // exact atunci textul lui devine cererea afișată.
    if (rows.length > 0 && rows[0].text) {
      const rest = rows.length > 1 ? ` (+${rows.length - 1} în coadă)` : ''
      setAnalysisDetail(`⚒ La constructor: ${rows[0].text}${rest}`)
    }
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
      noteBrainActivity(`✅ Reparat, gata de publicare: ${summary || branch}${proof ? ` — dovada: ${proof.slice(0, 80)}` : ''}`)
      // Rezultatul se întoarce prin CREIER (cu dovada + cererea de „da"), nu ca
      // text gata-făcut — ca Kelion să-l primească, nu doar să-l afișeze.
      void reportToAdmin({ kind: 'ready', summary: summary || branch, proof, queued: readyDeploys.length })
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
        if (ownedReq?.orderId) void setWorkOrderStatus(ownedReq.orderId, 'certified')
        resolveRequirement()
        setProgress(100, 'Certificat pe cerință (PASS)')
        void reportToAdmin({ kind: 'pass', summary: r.summary, detail })
        noteBrainActivity('🟢 200 — cerință certificată (tester PASS)')
        // ARHIVĂ APELABILĂ (Adrian, 10 iul: „joburile finalizate se arhivează
        // într-o memorie apelabilă"): lucrarea terminată intră în memoria pe care
        // creierul o RECHEAMĂ — când Adrian întreabă „ce ai făcut / ce s-a
        // rezolvat", Kelion răspunde direct din ea. Datată, indexată prin conținut.
        void addMemory(
          config.adminEmail,
          `Lucrare terminată și certificată (test PASS): ${r.summary.slice(0, 200)}${detail ? ` — ${detail.slice(0, 150)}` : ''}`,
        )
      } else {
        // BUG REAL (Adrian, 6 iul): FAIL apela bridgeRepair() necondiționat, de
        // fiecare dată — o cerință fără sens (ex. scurgere ASR) primea FAIL la
        // infinit și genera ordine noi identice la nesfârșit, ocolind complet
        // plafonul de re-încercări pe care watchdog-ul de stagnare îl respectă
        // deja (DEFAULT_SUPERVISE.maxAttempts). Unificăm contorul: FAIL crește
        // ACELAȘI `ownedReq.attempts`, iar peste prag nu mai reasignăm automat.
        const max = DEFAULT_SUPERVISE.maxAttempts
        // OPRIRE PE LIPSĂ DE PROGRES (Adrian, 9 iul): aceeași eroare de două ori
        // la rând = împotmolit, nu progres. NU mai cheltui pe același fix —
        // oprește-te ÎNAINTE de plafon și cere alt unghi. (Prinde bucla care
        // pică identic mai devreme decât contorul de 3 încercări.)
        if (ownedReq && sameFailure(ownedReq.lastFailDetail ?? '', detail)) {
          updateRequirement('BLOCAT — aceeași eroare de două ori, nu mai reîncerc')
          const msg =
            `🛑 „${r.summary}": a picat de două ori cu ACEEAȘI eroare (${detail || 'fără detaliu'}). ` +
            `Nu mai cheltui pe același fix — pare o problemă care cere alt unghi sau decizia ta. Ce facem?`
          sayQueue.push(msg)
          persistSay()
          void saveMessage(config.adminEmail, 'assistant', msg)
          noteBrainActivity(`🛑 „${r.summary}" — aceeași eroare de două ori, opresc reparația automată`)
          // ÎNVĂȚARE DIN GREȘELI (Adrian, 11 iul, aprobat: „1 da"): eșecul
          // terminal devine LECȚIE durabilă în caietul comun — Kelion o
          // recitește la fiecare tură, iar veghea îl trezește pe Claude.
          void appendSharedMemory(
            'lecție-eșec',
            `LECȚIE (aceeași eroare de 2 ori): „${r.summary.slice(0, 180)}" — ${detail?.slice(0, 300) || 'fără detaliu'}. Nu repeta același drum: alt unghi sau decizia lui Adrian.`,
          )
          ownedReq.nudged = Date.now() + 24 * 3600_000
          persistOwned()
          void reportToAdmin({ kind: 'fail', summary: r.summary, detail })
          return { ok: true }
        }
        if (ownedReq) {
          ownedReq.attempts = (ownedReq.attempts ?? 0) + 1
          ownedReq.lastFailDetail = detail
          persistOwned()
        }
        const attempts = ownedReq?.attempts ?? 0
        if (ownedReq && attempts > max) {
          updateRequirement(`BLOCAT după ${attempts} eșecuri de verificare — decizia lui Adrian`)
          const msg =
            `🛑 „${r.summary}": a picat verificarea de ${attempts} ori la rând (ultimul motiv: ${detail || 'fără detaliu'}). ` +
            `Nu mai re-încerc automat — pare o cerință neclară sau imposibil de implementat ca specificație, nu un bug de cod. ` +
            `Vrei s-o reformulez, s-o las, sau îmi dai alt unghi?`
          sayQueue.push(msg)
          persistSay()
          void saveMessage(config.adminEmail, 'assistant', msg)
          noteBrainActivity(`🛑 „${r.summary}" blocată după ${attempts} eșecuri de verificare — la decizia lui Adrian`)
          // Lecție durabilă și aici (Adrian, 11 iul): blocajul după N încercări
          // e cunoștință, nu doar mesaj trecător în chat.
          void appendSharedMemory(
            'lecție-eșec',
            `LECȚIE (blocat după ${attempts} încercări): „${r.summary.slice(0, 180)}" — ultimul motiv: ${detail?.slice(0, 300) || 'fără detaliu'}. Specificație neclară sau drum greșit — nu se reîncearcă automat; cere reformulare/alt unghi.`,
          )
          ownedReq.nudged = Date.now() + 24 * 3600_000 // oprește re-verificarea automată (watchdog) până se schimbă ceva
          persistOwned()
        } else {
          updateRequirement('FAIL la tester — trimisă automat la reparat')
          noteBrainActivity('🔴 fără 200 — cerința a picat la tester → reparat automat')
          const newOrderId = bridgeRepair(
            `LEGEA 200 (auto): cerința „${r.summary}" a picat verificarea pe live: ${detail || 'fără detaliu'}. Găsește cauza, repar-o și re-publică prin fluxul normal.`,
            { autonomous: true },
          )
          // ACELAȘI BUG (Adrian, 6 iul): FAIL-ul trimite reparația la un ordin NOU,
          // dar `ownedReq.orderId` rămânea legat de ordinul VECHI (cel picat) — un
          // PASS ulterior ar fi certificat ordinul greșit, iar cel care CHIAR a
          // reparat problema rămânea „delivered" (în lucru) pe veci în registru.
          // NOTĂ: `r` de mai sus vine din `ownedRequirement()`, care întoarce o
          // COPIE (fără orderId) — realinierea trebuie făcută pe `ownedReq` direct.
          if (ownedReq && newOrderId) {
            ownedReq.orderId = newOrderId
            persistOwned()
          }
        }
        void reportToAdmin({ kind: 'fail', summary: r.summary, detail })
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
        // DECIZIE LA EȘEC (Adrian, 5 iul: „la conflict decide singur, nu buclă"):
        // conflict de merge = ramură veche/duplicat → a reîncerca ACELAȘI pică la
        // infinit. NU re-cozăm — retrimitem la reconstruit pe master proaspăt.
        // Alt eșec (build/rețea) poate fi trecător → cerem „ok" ca înainte.
        const detail = String(req.body?.detail || '').slice(0, 200)
        const decision = decideDeployFailure(detail, failedSummary)
        if (decision.action === 'rebuild') {
          const newOrderId = bridgeRepair(
            `RECONSTRUIRE (deploy picat pe conflict): „${failedSummary}" s-a ciocnit cu masterul curent (ramură veche/duplicat). Reconstruiește de la zero pe origin/master proaspăt și re-publică prin flux; dacă e deja făcut, las-o.`,
            { autonomous: true },
          )
          // ACELAȘI BUG (Adrian, 6 iul): reconstrucția pleacă pe un ordin NOU, dar
          // cerința deținută rămânea legată de ordinul vechi (cel picat pe
          // conflict) — realiniem, ca „published"/„certified" să cadă pe ordinul
          // care CHIAR a reconstruit și publicat.
          if (ownedReq && newOrderId) {
            ownedReq.orderId = newOrderId
            persistOwned()
          }
          noteBrainActivity('🔁 Deploy picat pe conflict → retrimis la reconstruit (fără buclă pe „ok")')
        } else {
          if (failedBranch && !readyDeploys.some((r) => r.branch === failedBranch)) {
            readyDeploys.unshift({ branch: failedBranch, summary: failedSummary, at: Date.now() })
            persistReady()
          }
          noteBrainActivity('🔴 Deploy eșuat — aștept „ok" să reîncerc')
        }
        sayQueue.push(decision.message)
        persistSay()
        void saveMessage(config.adminEmail, 'assistant', decision.message)
      }
      return { ok: true }
    },
  )

  // REGISTRU DE ORDINE (Adrian, 5 iul): Kelion cere raportul cu toate cererile
  // și stadiile lor — ca să știe și el, și Adrian, ce s-a făcut cu fiecare ordin.
  app.get('/api/bridge/orders-report', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const orders = await listWorkOrders(50)
    const owned = ownedRequirement()
    return { report: composeOrdersReport(orders, owned?.summary ?? null) }
  })

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
  // GARD ANTI-COADĂ-MOARTĂ (Adrian, 11 iul): la 18:15, repornirea
  // deployer-ului a drenat aprobări VECHI din 5–8 iulie și a încercat să le
  // publice pe toate ("Deploy eșuat" în lanț pe monitor) — dacă vreo una
  // reușea, publica pe producție cod mai vechi decât master (deploy fantomă).
  // O aprobare are termen de valabilitate: peste 6 ore nepublicată = EXPIRATĂ
  // (marcată failed, vizibilă în admin) — nu se mai servește NICIODATĂ
  // deployer-ului, indiferent ce cod rulează pe VPS. Gardul stă în server,
  // la sursa cozii — singurul loc pe care repo-ul îl garantează.
  app.get('/api/bridge/approved-releases', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const all = await listStagedReleases(50)
    const MAX_APPROVAL_AGE_MS = 6 * 3600_000
    const fresh: typeof all = []
    for (const r of all) {
      if (r.status !== 'approved') continue
      if (Date.now() - new Date(r.at).getTime() > MAX_APPROVAL_AGE_MS) {
        await setReleaseStatus(r.id, 'failed')
        app.log.warn(`release ${r.id} („${r.title.slice(0, 60)}") EXPIRAT — aprobat de peste 6h, nu se mai publică`)
        continue
      }
      fresh.push(r)
    }
    return { releases: fresh }
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
        // ARHIVĂ APELABILĂ INDEXATĂ (Adrian, 10 iul): decizia iese din câmpul de
        // aprobat și intră în memoria pe care creierul o recheamă — ce s-a aprobat
        // și ce s-a respins, datat. Câmpul „Release-uri" arată apoi doar pending-ul.
        void addMemory(
          config.adminEmail,
          `Release ${r.status === 'approved' ? 'APROBAT' : 'RESPINS'}: „${r.title.slice(0, 200)}"`,
        )
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

  // OGLINDA VEGHERII (Adrian, 11 iul: „implementează și lui Kelion sistemul —
  // să se uite dacă a primit de la tine ceva"): veghea de pe VPS (timer, 1 min)
  // găsește în caiet note NOI de la Claude (claude-cloud) și le aduce aici, iar
  // creierul e RE-CHEMAT cu ele — Kelion le primește în sesiune în același
  // minut, nu abia când se întâmplă să scrie Adrian. Răspunsul lui intră în
  // chatul adminului (același drum ca reportToAdmin). Plătit DOAR la eveniment
  // — zero cost pe liniște (regula banilor). Dacă puntea e offline, răspundem
  // ok:false și veghea NU avansează reperul — reîncearcă la minutul următor.
  app.post<{ Body: { notes?: string } }>('/api/bridge/caiet-alert', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, 4000) : ''
    if (!notes) return reply.code(400).send({ error: 'bad_request' })
    if (!bridgeOnline()) return { ok: false }
    void bridgeAsk(
      'VEGHEA CAIETULUI (automată, la 1 minut): Claude ți-a lăsat în caietul comun notele de mai jos ' +
        'și nu le-ai citit încă. Citește-le ACUM și execută ce îți cer (sau notează durabil regula). ' +
        'Răspunde-i lui Adrian SCURT cu ce ai făcut. NU scrie în caiet doar ca să confirmi — ' +
        'confirmarea e răspunsul tău din chat.\n\n' +
        notes,
      [],
      90_000,
    )
      .then((r) => {
        if (r && r.trim()) sayToAdmin(r)
      })
      .catch(() => {
        // Creierul n-a răspuns la timp: nota NU se pierde — rămâne în caiet
        // (o vede la următoarea tură), iar Adrian află că livrarea a șchiopătat.
        sayToAdmin(`📓 Notă nouă de la Claude în caiet (creierul n-a răspuns la veghe): ${notes.slice(0, 300)}`)
      })
    return { ok: true }
  })

  // ERORILE DIN CONSOLA CLIENTULUI (Adrian, 11 iul: „Kelion trebuie să poată
  // deschide să vadă erorile astea de consolă, permanent"). Aplicația trimite
  // aici, la pachet, tot ce moare în consola browserului (lib/errlog.ts);
  // fereastra PERMANENTĂ a lui Kelion e endpoint-ul de mai jos, cu secretul
  // lui de pe disc:
  //   curl -H "x-bridge-secret: $(cat /root/kelion/bridge-secret.txt)" \
  //        https://kelionai.app/api/bridge/client-errors
  const clientErrors: { at: string; ua: string; kind: string; msg: string }[] = []
  app.post<{ Body: { errors?: { ts?: string; kind?: string; msg?: string }[] } }>(
    '/api/client-errors',
    async (req) => {
      const list = Array.isArray(req.body?.errors) ? req.body.errors.slice(0, 40) : []
      const ua = String(req.headers['user-agent'] ?? '').slice(0, 60)
      for (const e of list) {
        const msg = String(e?.msg ?? '').slice(0, 500)
        if (!msg) continue
        clientErrors.push({
          at: String(e?.ts ?? new Date().toISOString()).slice(0, 32),
          ua,
          kind: String(e?.kind ?? '?').slice(0, 12),
          msg,
        })
      }
      // Tampon circular — nu crește veșnic, oricâte erori ar produce clienții.
      if (clientErrors.length > 300) clientErrors.splice(0, clientErrors.length - 300)
      return { ok: true }
    },
  )
  app.get('/api/bridge/client-errors', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    return { errors: clientErrors.slice(-200) }
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

  // MOTORUL DE LUCRU ACTIV (Adrian, 11 iul: „să fie afișat permanent pe
  // interfața admin care constructor lucrează"). Constructorul de pe VPS
  // raportează treapta la fiecare pornire de lucru (max/kimi/glm); ultima
  // valoare rămâne afișată permanent — nu expiră.
  app.post<{ Body: { engine?: string } }>(
    '/api/bridge/work-engine',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const e = typeof req.body?.engine === 'string' ? req.body.engine.trim().slice(0, 20) : ''
      if (e) {
        workEngine = e
        void saveKv('work_engine', e).catch(() => {})
      }
      return { ok: true }
    },
  )

  app.get('/api/dev/status', async () => {
    const active = Date.now() - lastDevBeat < 60_000
    const owned = ownedRequirement()
    // Bara de proces se arată DOAR când chiar se lucrează: o tură e în curs
    // (turnActive), o cerință e deschisă la constructor (owned), sau tocmai s-a
    // terminat (fulgerul „Gata · Xs", 6s). Altfel NULL — niciun „lucru fals"
    // agățat la 30% când Adrian deschide pagina (bug 10 iul: „dacă e fals lucru
    // nu e ok"). Vechiul geam de 120s arăta un procent vechi ca și cum ar lucra.
    const showProc = turnActive || !!owned || (procDoneAt && Date.now() - procDoneAt < 6_000)
    return {
      active,
      bridge: bridgeOnline(),
      // CALITATEA LEGĂTURII (Adrian, 7 iul): câte din cele 10 benzi WS sunt sus —
      // frontend-ul colorează becul verde→roșu→stins după asta, nu hardcodat.
      lanes: wsLaneCount(),
      activity: active ? devActivity : [],
      srv: Date.now() - srvLoadAt < 180_000 ? srvLoad : '',
      // Motorul de lucru activ (max/kimi/glm) — permanent, ultima valoare.
      workEngine,
      // VITEZA REALĂ a creierului Linux: timpii ultimei ture (tip + total +
      // primul cuvânt) și, cât o tură e în curs, cronometrul viu. Adrian VEDE cât
      // durează un chat simplu vs o cerință de lucru (cerut 10 iul).
      lastTurn: lastTurn
        ? { kind: lastTurn.kind, totalMs: lastTurn.totalMs, firstMs: lastTurn.firstMs }
        : null,
      elapsedMs: turnActive && turnStartAt ? Date.now() - turnStartAt : 0,
      // THE process bar 0→100% (what's executing, start→finish). Shown only while
      // work is genuinely happening (see showProc) — never a stale lingering %.
      progress:
        showProc && procAt
          ? { pct: procPct, label: procLabel, file: procFile }
          : null,
      // CERINȚA DEȚINUTĂ: ce cerință de execuție e încă deschisă (neverificată
      // live). Rămâne aici până creierul o verifică — dovada că nu „trimite și
      // uită". null = nicio cerință deschisă (Adrian, 5 iul).
      owned: ownedRequirement(),
      // MODUL DE LUCRU (Adrian): derivat din starea reală, comutabil automat.
      // 'chat' = doar conversație; 'lucru' = o cerință de execuție e în lucru;
      // 'raport' = cerința e în faza de verificare/publicare (raportare rezultat).
      mode: (() => {
        const o = ownedRequirement()
        if (!o) return 'chat'
        return /verific|deploy|live|publicat|gata/i.test(o.status) ? 'raport' : 'lucru'
      })(),
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
      // Codul scris SUB bară, live (ultimele editări ale constructorului).
      code: workCode.slice(-30).map((c) => ({ file: c.file, text: c.text })),
    }
  })

  // CODUL SUB BARĂ (Adrian, 11 iul: „dacă dau clic pe bară să văd scriptic
  // softul care se scrie, tot ce se face sub bară"). Constructorul trimite
  // aici CONȚINUTUL fiecărei editări (fișier + textul scris); panoul de detaliu
  // al barei îl arată live. Tampon circular, plafonat — nu crește veșnic.
  app.post<{ Body: { file?: string; text?: string } }>(
    '/api/bridge/work-detail',
    async (req, reply) => {
      if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
      const text = typeof req.body?.text === 'string' ? req.body.text.slice(0, 2000) : ''
      if (text) {
        workCode.push({ ts: Date.now(), file: String(req.body?.file ?? '').slice(0, 80), text })
        if (workCode.length > 120) workCode.splice(0, workCode.length - 120)
      }
      return { ok: true }
    },
  )

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
  // ALERTĂ INSTANT DE PUBLICARE (Adrian, 10 iul: „kelion trebuie să primească
  // instant err de la railway" — nu tu să-mi arăți poze din dashboard). Chemat
  // de pipeline-ul deploy.yml (GitHub Actions) la orice eșec — țintă negăsită,
  // build picat, sau kelionai.app nu răspunde 200 după publicare. Kelion îi
  // spune lui Adrian pe loc, în chat, fără să mai caute el singur.
  app.post('/api/bridge/deploy-alert', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    const body = (req.body ?? {}) as { stage?: string; detail?: string; runUrl?: string }
    const stage = String(body.stage ?? 'necunoscută').slice(0, 200)
    const detail = String(body.detail ?? '').slice(0, 1200)
    const runUrl = String(body.runUrl ?? '').slice(0, 300)
    sayToAdmin(
      `🔴 Publicarea pe Railway a eșuat — etapa „${stage}".${detail ? `\n${detail}` : ''}${runUrl ? `\nJurnal: ${runUrl}` : ''}`,
    )
    return { ok: true }
  })

  app.post('/api/bridge/pull', async (req, reply) => {
    if (!authed(req)) return reply.code(401).send({ error: 'unauthorized' })
    workerBeat()
    // Capabilitățile declarate de worker în corpul pull-ului. Workerul nou
    // trimite {"caps":["persona"]}; cel vechi/zombie trimite {} → nu poate primi
    // joburi publice (gard de scurgere, vezi canServe).
    const rawCaps = (req.body as { caps?: unknown } | null)?.caps
    const caps = new Set(
      Array.isArray(rawCaps) ? rawCaps.filter((c): c is string => typeof c === 'string') : [],
    )
    const readyIdx = queue.findIndex((j) => canServe(j, caps))
    const ready = staleJob(caps) ?? (readyIdx !== -1 ? queue.splice(readyIdx, 1)[0] : undefined)
    if (ready) {
      markServed(ready)
      return { job: ready }
    }
    const job = await new Promise<PendingJob | null>((resolve) => {
      pullWaiters.push({ caps, resolve })
      // Release exactly once: on the 25s long-poll expiry OR the moment the
      // worker's connection drops — a job must never be served into a socket
      // that is already dead. The drop signal is 'close' on the RESPONSE (fires
      // early only on premature termination); on the request it fires as soon
      // as the body is consumed and would kill every long-poll instantly.
      const release = (): void => {
        const i = pullWaiters.findIndex((w) => w.resolve === resolve)
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

  // GARDĂ LA POARTĂ (dovedit 9 iul, 21:52–22:17): scuza „mi s-a rupt legătura
  // cu creierul… mai trimite-l o dată" NU e produsă de niciun cod din repo —
  // o trimite un worker VECHI de pe VPS care renunță în ~6s (niciun apel real
  // la model nu se termină atât de repede). Garda din chat.ts o prindea doar
  // pe calea nebufferizată; aici se taie LA INTRARE, pe ambele căi (reply și
  // reply-chunk), orice ar mai rula pe VPS. Semnătura cere AMBELE bucăți ale
  // frazei + text scurt, ca un răspuns legitim care conține „trimite" să nu
  // fie atins niciodată.
  const isWorkerExcuse = (text: string): boolean => {
    const t = text.trim()
    if (!t || t.length > 220) return false
    const norm = t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    return /rupt.{0,15}legatura/.test(norm) && /trimite/.test(norm)
  }

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
      // Scuza falsă devine puls gol: ceasul de stall rămâne armat, iar chatul
      // re-cozează cinstit în loc să-i ceară lui Adrian „mai trimite-l o dată".
      sink(isWorkerExcuse(body.text) ? '' : body.text)
    }
    // ANULARE LA ABANDON (Adrian, 10 iul: „se blochează"): `gone` îi spune
    // workerului că NIMENI nu mai ascultă tura asta (nici sink de stream, nici
    // waiter de răspuns final — serverul a renunțat la 75s/240s). Workerul taie
    // pe loc procesul claude și eliberează banda, în loc să macine minute în șir
    // pe un job mort care ținea mesajul următor al lui Adrian la coadă.
    return { accepted: !!sink, gone: !!body.id && !sink && !waiters.has(body.id) }
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
    const text = typeof body.text === 'string' ? body.text : ''
    // Răspuns = scuza falsă → tratat ca „fără răspuns": chatul re-cozează și
    // răspunde EL, nu-i mai arată lui Adrian minciuna „mi s-a rupt legătura".
    resolve(isWorkerExcuse(text) ? '' : text)
    return { accepted: true }
  })
}
