import Fastify from 'fastify'
// parity-verified-13jul
import cookie from '@fastify/cookie'
import websocket from '@fastify/websocket'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { config } from './config.js'
import { authRoutes } from './routes/auth.js'
import { chatRoutes } from './routes/chat.js'
import { ttsRoutes } from './routes/tts.js'
import { adminRoutes } from './routes/admin.js'
import { prefsRoutes } from './routes/prefs.js'
import { asrRoutes } from './routes/asr.js'
import { vocalLiveRoutes } from './routes/vocalLive.js'
import { apelRoutes } from './routes/apel.js'
import { legalRoutes } from './routes/legal.js'
import { imageRoutes } from './routes/image.js'
import { billingRoutes } from './routes/billing.js'
import { meRoutes } from './routes/me.js'
import { demoRoutes } from './routes/demo.js'
import { mapviewRoutes } from './routes/mapview.js'
import { ingestRoutes } from './routes/ingest.js'
import { browserRoutes } from './routes/browser.js'
import { opsRoutes } from './routes/ops.js'
import { constructorRoutes } from './routes/constructor.js'
import { authLocalRoutes } from './routes/authLocal.js'
import { contactRoutes } from './routes/contact.js'
import { startMailbox } from './services/mailbox.js'
import { startCitirePlati } from './services/openBanking.js'
import { startPlatiEmail } from './services/platiEmail.js'
import { startAutonomie } from './services/autonomie.js'
import { autonomActiv } from './services/autonomActiv.js'
import { incarcaModelUnic, startAutoUpgradeModel } from './services/modelAutoUpgrade.js'
import { startAutoInvatare } from './services/autoInvatare.js'
import { triageGaps } from './services/gapsTriage.js'
import { runSelfHeal } from './services/selfHeal.js'
import { pornesteIscoadele } from './services/iscoada.js'
import { pornestePietarul } from './services/pietar.js'
import { voiceprintRoutes } from './routes/voiceprint.js'
import { clientErrorRoutes } from './routes/clientErrors.js'
import { manualRoutes } from './routes/manual.js'
import { enterpriseRoutes } from './routes/enterprise.js'
import { a2aRoutes } from './routes/a2a.js'
import { tranzactiiRoutes } from './routes/tranzactii.js'
import { realtimeRoutes } from './routes/realtime.js'
import { modelRoutes } from './routes/models.js'
import { pingRoutes } from './routes/ping.js'
import { jobsRoutes } from './routes/jobs.js'
import { initDb, recordDownload, initAppFiles, getAppFile, backfillMemoryEmbeddings } from './db.js'
import { getSessionUser } from './session.js'
import { isArmed, hasUnlock } from './services/adminLock.js'
import { buildLinuxZip } from './services/linuxPackage.js'
import { makeLogTee } from './services/logbuffer.js'

// Content types for the download endpoint (installers + QR images + manifest).
const DL_TYPES: Record<string, string> = {
  exe: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  png: 'image/png',
  json: 'application/json',
  zip: 'application/zip',
}

// The Linux package is not a stored binary, but a launcher generated on the
// spot — always the live version, so /dl/Kelionai-linux.zip can never 404
// (Adrian, 9 Jul).
const LINUX_ZIP = 'Kelionai-linux.zip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GLOBAL body limit kept MODEST (25MB) so no endpoint can be flooded with huge
// payloads — covers audio buffers, documents and camera frames. The /api/chat
// route raises its own limit to 100MB per-route for camera frames (see chat.ts).
// THE SERVER'S F12 (Adrian, 27 Jul: "the logs must reach Kelion like F12"): the
// logger writes everything to stdout (docker logs untouched) AND keeps the
// errors/warnings in a memory ring read by the server_logs tool.
const app = Fastify({ logger: { stream: makeLogTee() }, bodyLimit: 25_000_000 })

// GLOBAL SAFETY NET (audit 6 Jul): on modern Node, a single rejected promise
// without `.catch` (e.g. a corrupt `JSON.parse` in a `.then`) kills the WHOLE
// process → restart-loop on the host. We catch and log them, so the live app
// does NOT fall from an isolated error. (The real fix stays `.catch` on every
// `.then`.)
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandledRejection — caught globally, the process stays alive')
})
process.on('uncaughtException', (err) => {
  app.log.error({ err }, 'uncaughtException — caught globally, the process stays alive')
})

await app.register(cookie)
// WebSocket for the full-duplex microphone (STT stream) and the live voice.
await app.register(websocket)
await app.register(cors, {
  origin: config.frontendOrigin,
  credentials: true,
})

// RATE LIMITING — the first line of defence against cost-abuse and DoS. Keyed on
// the REAL client IP (Cloudflare puts it in cf-connecting-ip; req.ip is only the
// CF edge, shared by everyone). A generous global cap absorbs legitimate polling
// (dev-status, presence) while stopping floods; the expensive /api/chat
// route sets a tighter per-route limit of its own (see chat.ts).
await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: '1 minute',
  // Exempt the HIGH-FREQUENCY legitimate pollers so they never trip the limit:
  // the health check, the dev-status/heartbeat presence, the admin chat-incoming
  // poll. The cost-sensitive /api/chat keeps its own tighter cap.
  allowList: (req) => {
    const u = (req.url || '').split('?')[0]
    return (
      // STATIC FILES (avatar .glb, face-api models, JS/CSS bundles, images):
      // NEVER rate-limited. The cause of "the mic starts but doesn't hear"
      // (14 Jul): a single page load requests DOZENS of /anim/*.glb + /models/*
      // at once, exceeded 120/min and returned 429 on EVERYTHING — including
      // the microphone WebSocket. Any non-/api/ path = static file → exempted;
      // the API keeps its cap.
      !u.startsWith('/api/') ||
      u === '/health' ||
      u === '/api/health' || // connectivity-recovery poll (ChatPanel) — never throttled
      u === '/api/version' || // polled every 45s by every client for the update routine
      u === '/api/visit/ping'
    )
  },
  keyGenerator: (req) => {
    const hdr = (n: string): string =>
      ((req.headers[n] as string | undefined) ?? '').split(',')[0]?.trim() ?? ''
    return (
      hdr('cf-connecting-ip') || hdr('true-client-ip') || hdr('x-forwarded-for') || req.ip || 'unknown'
    )
  },
})

// Parse JSON ourselves so a malformed body is a CLIENT error (400), never a
// 500 server crash.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  try {
    done(null, body ? JSON.parse(body as string) : {})
  } catch (err) {
    ;(err as Error & { statusCode?: number }).statusCode = 400
    done(err as Error, undefined)
  }
})

// Security headers on every response: force HTTPS (HSTS), block clickjacking of
// our pages (the login screen especially), stop MIME sniffing, and trim the
// referrer. CSP is intentionally left off for now — the app uses WebGL, camera/
// mic media and embeds arbitrary https pages in the monitor iframe, which a
// strict CSP would break; add it later in report-only mode first.
app.addHook('onRequest', async (_req, reply) => {
  reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'SAMEORIGIN')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)')
})

// THE ADMIN LOCK — A SECOND FACTOR ON ALL /api/admin/* (Adrian, 27 Jul: "if
// the print doesn't match, even the admin button must not activate"). A single
// choke point, not 40 handlers: once ARMED (the secret is set), the admin
// session is NO LONGER enough — the unlock is also needed (matching
// voiceprint or the typed secret → 12h signed cookie). 423 = the distinct
// signal to the client that the panel is locked (403 stays "you're not
// admin"). Exceptions: the unlock routes themselves (otherwise the lock could
// never open).
app.addHook('preHandler', async (req, reply) => {
  const u = (req.raw.url ?? '').split('?')[0]
  if (!u.startsWith('/api/admin/')) return
  if (u.startsWith('/api/admin/unlock')) return
  const user = getSessionUser(req)
  if (!user || user.role !== 'admin') return // the route's 403 stays the authority
  if (!(await isArmed())) return
  if (hasUnlock(req, user.email)) return
  return reply.code(423).send({ error: 'admin_locked' })
})

// Installers and the self-update manifest must ALWAYS be the latest version —
// the QR codes and the in-app updater depend on it. fastify-static's setHeaders
// proved unreliable here (the default `public, max-age=0` leaked through and
// Cloudflare edge-cached the .exe/.apk for 4 hours). onSend runs LAST on every
// reply, so nothing can override it; `no-store` makes Cloudflare bypass its
// cache entirely for /dl/*.
// Same hook LOGS every real installer download (the admin's "who downloaded"
// view): email when signed in, else IP + country. Full GETs only — Range
// resumes and HEAD probes don't double-count.
app.addHook('onSend', async (req, reply) => {
  const u = (req.raw.url ?? '').split('?')[0]
  // The service worker + the PWA manifest: ALWAYS fresh. Cloudflare kept them
  // at the edge for 4 hours (max-age=14400 from static) — so installs
  // (PWA/TWA/iOS/desktop, all loading the live site) stayed glued to the old
  // shell for up to 4 hours after a deploy. no-store = the update reaches
  // EVERYONE at the first open.
  if (u === '/sw.js' || u === '/manifest.webmanifest') {
    reply.header('Cache-Control', 'no-store')
    return
  }
  // THE MAIN HTML: ALWAYS fresh (Adrian, 26 Jul: "the apps under the barcode
  // don't automatically pick up the latest update... they don't pick up the
  // features from the web page"). The same disease as sw.js, left unsolved at
  // index.html: Cloudflare kept it at the edge for up to 4 hours, so the
  // installed SHELLS (exe/APK/TWA — all opening the live site at kelionai.app/)
  // got the OLD HTML with the old bundles. Browsers escaped through the
  // "/?_v=timestamp" routine; the shell that simply opens "/" stayed glued to
  // the old version. no-store on ANY text/html response (/, /login, /credite,
  // SPA fallback) = every open gets the new page; hashed bundles stay cached
  // normally.
  const ct = String(reply.getHeader('content-type') ?? '')
  if (ct.includes('text/html')) {
    reply.header('Cache-Control', 'no-store')
    return
  }
  if (!u.startsWith('/dl/')) return
  reply.header('Cache-Control', 'no-store')
  if (
    reply.statusCode === 200 &&
    req.method === 'GET' &&
    !req.headers.range &&
    (u.endsWith('.exe') || u.endsWith('.apk'))
  ) {
    const hdr = (n: string): string =>
      ((req.headers[n] as string | undefined) ?? '').split(',')[0]?.trim() ?? ''
    const email = getSessionUser(req)?.email ?? ''
    void recordDownload(
      u.slice('/dl/'.length),
      email,
      hdr('cf-connecting-ip') || req.ip || '',
      hdr('cf-ipcountry'),
      (req.headers['user-agent'] as string | undefined) ?? '',
    ).catch(() => {})
  }
})

// Health — must return exactly 200 (200-only rule + the host's healthcheck)
app.get('/health', async () => ({ status: 'ok' }))
// ALIAS `/api/health` (bug găsit 3 aug): ChatPanel, când un tur pică cu
// `server_down`, pinguie `/api/health` ca să afle CÂND revine serverul și să
// reia mesajul singur. Backend-ul servea doar `/health` → `/api/health` da 404,
// deci reveniirea nu se detecta NICIODATĂ, iar bannerul „Serverul nu răspunde"
// rămânea agățat pe un server VIU. Aceeași rută, sub ambele căi.
app.get('/api/health', async () => ({ status: 'ok' }))

// THE DEPLOY VERSION (Adrian, 10 Jul: "on every new deploy the watermark
// updates, the browser restarts clean"). The host can inject the published
// commit sha through GIT_COMMIT_SHA; the frontend polls it and, when it
// changes, does the clean reset to the latest version. The watermark displays
// it — so it CHANGES on ANY publish, even if the interface wasn't touched.
const DEPLOY_SHA = (process.env.GIT_COMMIT_SHA ?? '').slice(0, 7)
const BOOT_AT = new Date().toISOString()
// Without an injected sha, the boot moment IS the version: it changes on every
// real publish.
const DEPLOY_V = DEPLOY_SHA || BOOT_AT
app.get('/api/version', async (_req, reply) => {
  reply.header('Cache-Control', 'no-store')
  // `adminCfg` (9 aug, „flux admin 403 — trebuie 200"): spune dacă emailul de
  // admin REZOLVAT pe server e cel implicit al ownerului (valoarea implicită e
  // deja publică, în repo — nu se scurge nimic). `false` = env-ul VPS cară un
  // ADMIN_EMAIL stricat/diferit → rolul iese „customer" cu sesiune validă.
  // Diagnostic măsurabil de oriunde cu un curl, fără SSH.
  return { v: DEPLOY_V, at: BOOT_AT, adminCfg: config.adminEmail === 'adrianenc11@gmail.com' }
})



await app.register(authRoutes)
await app.register(chatRoutes)
await app.register(ttsRoutes)
await app.register(adminRoutes)
await app.register(prefsRoutes)
await app.register(asrRoutes)
await app.register(vocalLiveRoutes)
await app.register(apelRoutes)
await app.register(legalRoutes)
await app.register(imageRoutes)
await app.register(billingRoutes)
await app.register(meRoutes)
await app.register(demoRoutes)
await app.register(mapviewRoutes)
await app.register(ingestRoutes)
await app.register(browserRoutes)
await app.register(opsRoutes)
await app.register(constructorRoutes)
await app.register(authLocalRoutes)
await app.register(contactRoutes)
await app.register(voiceprintRoutes)
await app.register(clientErrorRoutes)
await app.register(realtimeRoutes)
await app.register(modelRoutes)
await app.register(pingRoutes)
await app.register(jobsRoutes)
await app.register(manualRoutes)
await app.register(enterpriseRoutes)
await app.register(a2aRoutes)
await app.register(tranzactiiRoutes)

// Where the built frontend + baked-in download defaults live.
const distPath = path.resolve(__dirname, '..', config.frontendDist)

// The DB schema is VITAL when the database is configured (security audit 27
// Jul): initDb runs everything in a single implicit transaction — if ANY
// statement fails, EVERYTHING fails, including the unique
// anti-double-crediting index (uniq_billing_ref). Before, we just logged and
// moved on = payments could be credited twice in silence. Now: DB configured
// but schema failed → the process exits (the host restarts it; better a
// visible restart than invisible doubled money). Without DATABASE_URL, normal
// startup remains.
try {
  await initDb()
  await initAppFiles() // load installer masters (uploaded from Linux) into cache
  // MODELUL UNIC (sigilat) — reia din KV un eventual auto-upgrade validat de dinainte,
  // ÎNAINTE ca vreo rută să folosească creierul (altfel prima tură pornește pe default).
  await incarcaModelUnic().catch(() => {})
} catch (err) {
  if (config.databaseUrl) {
    app.log.error({ err }, 'initDb FAILED with DB configured — exiting (money protection requires the full schema)')
    process.exit(1)
  }
  app.log.error({ err }, 'initDb failed — chat persistence disabled')
}

// SEMANTIC MEMORY — slow backfill (12 Jul): old memories get a meaning vector
// in small batches, every 10 minutes; without a Gemini key it's a cheap no-op.
setTimeout(() => {
  // OFF BY DEFAULT (9 aug): embedding-urile de memorie ard Gemini la fiecare 10
  // min FĂRĂ user; fără comutatorul autonom pornit, tura e no-op (o citire KV).
  const tick = async (): Promise<void> => {
    if (!(await autonomActiv())) return
    await backfillMemoryEmbeddings(40).catch(() => {})
  }
  void tick()
  setInterval(() => { void tick() }, 10 * 60_000)
}, 30_000)

// Download endpoint: the installer MASTER lives on the Linux server and is
// pushed into app_files, so this serves the LATEST bytes with NO app redeploy.
// DB first (fresh, from the server) → disk fallback (baked-in defaults). The
// onSend hook adds no-store + logs the download; a single flat segment only.
app.get<{ Params: { file: string } }>('/dl/:file', async (req, reply) => {
  const file = req.params.file
  if (file.includes('/') || file.includes('..')) return reply.code(404).send({ error: 'not_found' })
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  // TIPUL vine din EXTENSIE, AUTORITAR — nu din ce tip s-a stocat în DB. Un tip
  // stocat greșit făcea browserul/OS-ul să salveze fișierul cu extensia greșită
  // (Adrian, 11 aug: „extensiile sunt greșite pe fiecare model"). Extensia din
  // URL e adevărul: .exe → Windows, .apk → Android, .zip → Linux.
  const type = DL_TYPES[ext] ?? 'application/octet-stream'
  // INSTALATOARELE se descarcă cu NUMELE + EXTENSIA exacte (Content-Disposition),
  // ca fișierul salvat să aibă mereu extensia corectă, pe ORICE browser/model —
  // înainte doar zip-ul de Linux avea antetul ăsta, deci exe/apk ieșeau cu
  // extensii greșite pe unele telefoane/download-managere. Imaginile QR (.png) și
  // JSON-urile RĂMÂN inline (fără attachment) — altfel QR-urile n-ar mai apărea.
  const eInstalator = ext === 'exe' || ext === 'apk' || ext === 'zip'
  if (eInstalator) reply.header('Content-Disposition', `attachment; filename="${file}"`)
  const db = getAppFile(file)
  if (db) {
    reply.header('Content-Type', type)
    return reply.send(db.buf)
  }
  const onDisk = path.resolve(distPath, 'downloads', file)
  if (onDisk.startsWith(path.resolve(distPath, 'downloads')) && fs.existsSync(onDisk)) {
    reply.header('Content-Type', type)
    return reply.send(fs.createReadStream(onDisk))
  }
  // Linux: if no real binary was uploaded to the DB/disk, serve the launcher
  // generated on the spot — always 200, always the live version (a binary
  // uploaded later to the DB takes priority, because it's checked above).
  if (file === LINUX_ZIP) {
    reply.header('Content-Type', 'application/zip')
    return reply.send(buildLinuxZip(distPath))
  }
  return reply.code(404).send({ error: 'not_found' })
})

// In production, serve the built frontend (SPA) from FRONTEND_DIST.
if (config.isProd && fs.existsSync(distPath)) {
  await app.register(fastifyStatic, { root: distPath, prefix: '/' })
  // NOTE: /dl/* is handled by the explicit route above (DB master → disk
  // fallback, no-store), NOT by static — so the QR always serves latest.
  // SPA fallback — any non-API route returns index.html
  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url ?? ''
    if (url.startsWith('/auth') || url.startsWith('/api') || url.startsWith('/health')) {
      return reply.code(404).send({ error: 'not_found' })
    }
    return reply.sendFile('index.html')
  })
}

try {
  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`Kelionai backend on :${config.port}`)
  // ROW 19: start reading the contact@ mailbox (no-op until MAIL_PASS is set).
  startMailbox()
  // AUTOMATIC CREDITING OF PAYMENTS VIA REVOLUT PRO (Adrian, 30 Jul): reads
  // the inflow transactions and matches the unique code in the reference with
  // the user waiting to pay. We read through Enable Banking (PSD2) at fixed
  // intervals. Without the Enable Banking keys it does nothing (and says so
  // once, at startup).
  startCitirePlati()
  // PLĂȚILE PE PRO, DIN EMAIL (Adrian, 3 aug): Revolut Pro n-are webhook și
  // Open Banking nu face UK, dar Revolut trimite email la fiecare încasare, iar
  // aplicația citește deja Gmailul owner-ului. Citim „Ai primit …", scoatem
  // suma + codul și credităm — fără cont nou, fără Stripe. Zero dacă Google nu
  // e conectat (și spune de ce).
  startPlatiEmail()
  // KELION GETS TO WORK BY ITSELF: every hour it takes the next undone row
  // from RAMAS-DE-FACUT.md and sends it to the builder. Without waiting for
  // anyone.
  startAutonomie()
  // Veghea de auto-upgrade a modelului unic (validat, doar Pro mai nou) — decizia
  // permanentă a ownerului „mereu cel mai bun, preluat automat, peste tot".
  startAutoUpgradeModel()
  // AUTO-ÎNVĂȚARE DIN TIMPI (Adrian, 3 aug): în spate, invizibil, citește
  // registrul task_timings și învață tiparele (lent/eșec) ca să nu le repete.
  startAutoInvatare()
  // SANTINELA DE SOLD OPENROUTER — EXTIRPATĂ DE TOT (Adrian, 3 aug, cu
  // mailurile în mână: „de ce încă îmi vin mesaje cu soldul care descrește?").
  // Creierul e Gemini-only; alarma „depune bani la OpenRouter" păzea un
  // furnizor scos. Serviciul openrouterAlert.ts a fost ȘTERS cu totul —
  // starea creierului se vede în pastila Gemini din bară + system_health.
  // Daily AUTONOMOUS TRIAGE of uncovered requests (Adrian, 24 Jul): Kelion
  // decides by itself what brings value (stays "TO IMPLEMENT") and what gets
  // closed automatically. 1h after boot, then every 24h. Best-effort — blocks
  // nothing.
  // OFF BY DEFAULT (9 aug): triajul cheamă creierul; fără comutator, no-op.
  const triaj = async (): Promise<void> => {
    if (!(await autonomActiv())) return
    await triageGaps().then((r) => app.log.info(r, 'gaps triage (autonomous)')).catch(() => {})
  }
  setTimeout(() => {
    void triaj()
    setInterval(() => { void triaj() }, 24 * 60 * 60 * 1000)
  }, 60 * 60 * 1000)
  // SELF-HEALING (Adrian, 27 Jul): Kelion collects the users' RECURRING errors
  // by itself and sends them to the builder for repair (PR → merge → all users
  // get the repaired version). 3 min after boot, then every 30 min.
  // OFF BY DEFAULT (9 aug): self-heal sondează Gemini + umple coada
  // constructorului; fără comutatorul autonom pornit, no-op (o citire KV).
  const vindeca = async (): Promise<void> => {
    if (!(await autonomActiv())) return
    await runSelfHeal().catch(() => {})
  }
  setTimeout(() => {
    void vindeca()
    setInterval(() => { void vindeca() }, 30 * 60 * 1000)
  }, 3 * 60 * 1000)
  // ISCOADELE (Adrian, 4 aug: „boti care bat netul 24 din 24 si aduc informati
  // lui kelion"): patrula periodică Serper→creier→memoria lui Kelion.
  pornesteIscoadele()
  // PIETARUL (Adrian, 4 aug: „el învață din realitate 24 din 24, din datele
  // agenților bursieri"): patrula piețelor → observații în memoria lui Kelion.
  pornestePietarul()
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
