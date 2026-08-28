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
import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { authRoutes } from './routes/auth.js'
import { chatRoutes } from './routes/chat.js'
import { ttsRoutes } from './routes/tts.js'
import { adminRoutes } from './routes/admin.js'
import { prefsRoutes } from './routes/prefs.js'
import { vocalLiveRoutes } from './routes/vocalLive.js'
import { apelRoutes } from './routes/apel.js'
import { legalRoutes } from './routes/legal.js'
import { imageRoutes } from './routes/image.js'
import { billingRoutes } from './routes/billing.js'
import { meRoutes } from './routes/me.js'
import { pushRoutes } from './routes/push.js'
import { clientIp, demoRoutes } from './routes/demo.js'
import { mapviewRoutes } from './routes/mapview.js'
import { ingestRoutes } from './routes/ingest.js'
import { browserRoutes } from './routes/browser.js'
import { constructorRoutes } from './routes/constructor.js'
import { authLocalRoutes } from './routes/authLocal.js'
import { contactRoutes } from './routes/contact.js'
import { startMailbox } from './services/mailbox.js'
import { startAutoInvatare } from './services/autoInvatare.js'
import { incarcaReprosuri } from './services/feedbackImplicit.js'
import { voiceprintRoutes } from './routes/voiceprint.js'
import { clientErrorRoutes } from './routes/clientErrors.js'
import { embedCheckRoutes } from './routes/embedCheck.js'
import { manualRoutes } from './routes/manual.js'
import { enterpriseRoutes } from './routes/enterprise.js'
import { a2aRoutes } from './routes/a2a.js'
import { tranzactiiRoutes } from './routes/tranzactii.js'
import { pingRoutes } from './routes/ping.js'
import { jobsRoutes } from './routes/jobs.js'
import { offlineRoutes } from './routes/offline.js'
import { auzRoutes } from './routes/auz.js'
import { deployRoutes } from './routes/deploy.js'
import { arhiveazaBuildJobsVechi, cleanupExpiredAuthState, curataJurnaleVechi, dbEnabled, deblocheazaJoburileClaimate, getPool, initDb, recordSimptomLive } from './db.js'
import { hydrateSession, trustedMutationOrigin } from './session.js'
import { isOperationalHealthRequest } from './services/operationalHealth.js'
import { makeLogTee, capturaConsole } from './services/logbuffer.js'
import { releaseSideEffectsEnabled, shutdownDeactivatedRelease } from './services/releaseActivation.js'
import { curataTextJurnal } from './services/jurnalOperational.js'
import { expireChatReplayResults } from './services/chatTurnReplay.js'
import { realtimeHealth } from './services/realtimeHealth.js'
import { isSubscriptionMode } from './services/chatgptSubscription.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Expensive media endpoints define smaller route-specific limits. This global
// ceiling is only a final guard; authenticated streaming/upload routes must not
// rely on it as their primary quota.
// THE SERVER'S F12 (Adrian, 27 Jul: "the logs must reach Kelion like F12"): the
// logger writes everything to stdout (docker logs untouched) AND keeps the
// errors/warnings in a memory ring read by the server_logs tool.
// console.* → inelul server_logs (owner, 13 aug: „Kelion nu vede toate logurile").
// Cât mai devreme, ca să prindă și logurile de pornire; idempotent.
capturaConsole()
const app = Fastify({ logger: { stream: makeLogTee() }, bodyLimit: 25_000_000 })
let schemaReady = false

let fatalShutdownStarted = false
function shutdownAfterFatal(kind: 'unhandledRejection' | 'uncaughtException', value: unknown): void {
  if (fatalShutdownStarted) return
  fatalShutdownStarted = true
  schemaReady = false
  const message = curataTextJurnal(value instanceof Error ? value.message : value, 240)
  app.log.fatal({ kind, message }, 'fatal process error; stopping for supervised restart')
  const deadline = setTimeout(() => process.exit(1), 10_000)
  deadline.unref()
  void app.close().finally(() => process.exit(1))
}
process.on('unhandledRejection', (reason: unknown) => shutdownAfterFatal('unhandledRejection', reason))
process.on('uncaughtException', (err: Error) => shutdownAfterFatal('uncaughtException', err))

app.setErrorHandler((err, req, reply) => {
  const e = err as { statusCode?: number; message?: string }
  const cod = e.statusCode ?? 500
  if (cod === 503) {
    app.log.warn({ method: req.method, route: (req.url || '').split('?')[0] }, 'service unavailable')
    reply.code(503).send({ error: 'service_unavailable' })
    return
  }
  if (cod >= 500) {
    const ruta = (req.url || '').split('?')[0]
    const correlationId = randomUUID()
    void recordSimptomLive('route_failure', `${req.method} ${ruta} [${correlationId}]`).catch(() => {})
    app.log.error({ correlationId, method: req.method, route: ruta, error: curataTextJurnal(e.message, 240) }, 'route error')
    reply.code(500).send({ error: 'internal_error', correlationId })
    return
  }
  reply.code(cod).send({ error: cod === 429 ? 'rate_limited' : (e.message || 'request_failed') })
})

await app.register(cookie)
// WebSocket for the full-duplex microphone (STT stream) and the live voice.
await app.register(websocket)
await app.register(cors, {
  origin: (origin, callback) => {
    // Requests without Origin (server-to-server/health) do not need CORS.
    // Browser UI and approved native shells are the only reflected origins.
    if (!origin || origin === config.publicOrigin || config.product.nativeOrigins.includes(origin)) {
      callback(null, true)
      return
    }
    callback(null, false)
  },
  // Production browser traffic is same-origin; native shells use an explicit
  // bearer. Never authorize ambient cross-site cookies in production.
  credentials: !config.isProd,
  allowedHeaders: ['content-type', 'authorization', 'idempotency-key'],
})

// RATE LIMITING — the first line of defence against cost-abuse and DoS. Keyed on
// IP-ul sanitizat de Caddy (vezi deploy/Caddyfile + routes/demo.clientIp), nu pe
// antete Cloudflare/XFF furnizate direct de client. A generous global cap absorbs legitimate polling
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
      u === '/api/release-proof' || // dovada atomică a orchestratorului de release
      u === '/api/tts/status' // polled by frontend to decide which mouth to open
    )
  },
  keyGenerator: (req) => clientIp(req) || 'unknown',
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

// Baseline headers also protect direct/internal responses. Caddy adds the
// authoritative enforced CSP and cross-origin policy at the public boundary;
// keeping CSP out of this hook avoids two policies that can silently diverge.
app.addHook('onRequest', async (req, reply) => {
  reply.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  reply.header('X-Content-Type-Options', 'nosniff')
  reply.header('X-Frame-Options', 'SAMEORIGIN')
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin')
  reply.header('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=(self)')

  // Readiness is a machine-to-machine contract.  Do not touch the session
  // store here: CI and release probes have no browser credentials, and an
  // unrelated session failure must be reported by /readyz itself, never 403.
  if (isOperationalHealthRequest(req.method, req.raw.url)) return

  await hydrateSession(req)

  // Cookie-authenticated mutations require an exact first-party Origin. CORS
  // controls reads; this check is the CSRF boundary. Native bearer sessions
  // will use their own explicit transport contract rather than this cookie.
  if (!trustedMutationOrigin(req)) {
    return reply.code(403).send({ error: 'origin_forbidden' })
  }
})

// Dynamic shells and HTML must not be retained by an intermediary cache.
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
})

// Health — must return exactly 200 (200-only rule + the host's healthcheck)
app.get('/health', async () => ({ status: 'ok' }))
app.get('/livez', async () => ({ status: 'alive' }))
// ALIAS `/api/health` (bug găsit 3 aug): ChatPanel, când un tur pică cu
// `server_down`, pinguie `/api/health` ca să afle CÂND revine serverul și să
// reia mesajul singur. Backend-ul servea doar `/health` → `/api/health` da 404,
// deci reveniirea nu se detecta NICIODATĂ, iar bannerul „Serverul nu răspunde"
// rămânea agățat pe un server VIU. Aceeași rută, sub ambele căi.
app.get('/api/health', async () => ({ status: 'ok' }))

async function readinessSnapshot() {
  const requiredConfig = Boolean(
    config.adminEmail
    && config.publicOrigin
    && (config.openai.key || isSubscriptionMode())
    && config.openai.luna
    && config.openai.medium
    && config.openai.heavy
    && config.openai.realtime
    && config.openai.realtimeTranscription
  )
  const realtime = await realtimeHealth()
  let database = false
  let migrations = false
  if (dbEnabled() && schemaReady) {
    try {
      const result = await getPool().query<{ count: string }>(
        'SELECT count(*)::text AS count FROM schema_migrations',
      )
      database = true
      const expected = fs.readdirSync(path.resolve(__dirname, '..', 'migrations'))
        .filter((name) => /^\d{8}_[a-z0-9_]+\.sql$/.test(name)).length
      migrations = Number(result.rows[0]?.count ?? 0) === expected && expected > 0
    } catch {
      database = false
      migrations = false
    }
  }
  const browserWorker = Boolean(
    config.browserWorker.socket
    && config.browserWorker.secret.length >= 32
    && fs.existsSync(config.browserWorker.socket),
  )
  const converterWorker = Boolean(
    config.converterWorker.socket
    && config.converterWorker.secret.length >= 32
    && fs.existsSync(config.converterWorker.socket),
  )
  const ready = requiredConfig && realtime.ok && database && migrations && browserWorker && converterWorker
  return {
    ready,
    checks: {
      config: requiredConfig,
      realtime: { ok: realtime.ok, reason: realtime.reason },
      database,
      migrations,
      browserWorker,
      converterWorker,
    },
    release: {
      candidate: config.release.candidateMode,
      sideEffectsActive: releaseSideEffectsEnabled(),
    },
  }
}

app.get('/readyz', async (_req, reply) => {
  const snapshot = await readinessSnapshot()
  return reply.code(snapshot.ready ? 200 : 503).send(snapshot)
})

// THE DEPLOY VERSION (Adrian, 10 Jul: "on every new deploy the watermark
// updates, the browser restarts clean"). The host can inject the published
// commit sha through GIT_COMMIT_SHA; the frontend polls it and, when it
// changes, does the clean reset to the latest version. The watermark displays
// it — so it CHANGES on ANY publish, even if the interface wasn't touched.
const RAW_DEPLOY_COMMIT = String(process.env.GIT_COMMIT_SHA ?? '').toLowerCase()
const DEPLOY_COMMIT = /^[0-9a-f]{40}$/.test(RAW_DEPLOY_COMMIT) ? RAW_DEPLOY_COMMIT : ''
const DEPLOY_SHA = DEPLOY_COMMIT.slice(0, 7)
const BOOT_AT = new Date().toISOString()
// Without an injected sha, the boot moment IS the version: it changes on every
// real publish.
const DEPLOY_V = DEPLOY_SHA || BOOT_AT
app.get('/api/release-proof', async (_req, reply) => {
  const snapshot = await readinessSnapshot()
  const proved = snapshot.ready && snapshot.release.sideEffectsActive && DEPLOY_COMMIT.length === 40
  reply.header('Cache-Control', 'no-store')
  return reply.code(proved ? 200 : 503).send({
    ready: snapshot.ready,
    release: snapshot.release,
    activeCommit: DEPLOY_COMMIT,
  })
})

// AUTO-VERSIUNE (owner, 13 aug: „se incrementează singură la fiecare publicare,
// +0.1"). Se calculează o dată la boot, din KV (vezi mai jos, după initDb) —
// V0.0, V0.1, V0.2 … Până când KV răspunde (sau fără DB), cade pe „1.0".
app.get('/api/version', async (_req, reply) => {
  reply.header('Cache-Control', 'no-store')
  // `adminCfg` (9 aug, „flux admin 403 — trebuie 200"): spune dacă emailul de
  // admin REZOLVAT pe server e cel implicit al ownerului (valoarea implicită e
  // deja publică, în repo — nu se scurge nimic). `false` = env-ul VPS cară un
  // ADMIN_EMAIL stricat/diferit → rolul iese „customer" cu sesiune validă.
  // Diagnostic măsurabil de oriunde cu un curl, fără SSH.
  return { v: DEPLOY_V, at: BOOT_AT, ver: DEPLOY_V }
})



await app.register(authRoutes)
await app.register(chatRoutes)
await app.register(ttsRoutes)
await app.register(adminRoutes)
await app.register(prefsRoutes)
await app.register(vocalLiveRoutes)
await app.register(apelRoutes)
await app.register(legalRoutes)
await app.register(imageRoutes)
await app.register(billingRoutes)
await app.register(meRoutes)
await app.register(pushRoutes)
await app.register(demoRoutes)
await app.register(mapviewRoutes)
await app.register(ingestRoutes)
await app.register(browserRoutes)
await app.register(constructorRoutes)
await app.register(offlineRoutes)
await app.register(auzRoutes)
await app.register(authLocalRoutes)
await app.register(contactRoutes)
await app.register(voiceprintRoutes)
await app.register(clientErrorRoutes)
await app.register(embedCheckRoutes)
await app.register(pingRoutes)
await app.register(jobsRoutes)
// Căile COMPLETE stau în deploy.ts (convenția întregului backend, pe care o
// citește și verifica-butoane): componenta DeployProgressBar chema
// /api/deploy/progress și /api/deploy/status, dar rutele fuseseră declarate
// FĂRĂ prefix (trăiau la rădăcină: /progress, /status) → bara era moartă din
// naștere, 404 la fiecare poll (prins de verifica-butoane pe merge-ul #1122;
// poarta VPS nu rulează încă verificatorul de butoane — de-aia a trecut).
await app.register(deployRoutes)
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
  schemaReady = true
} catch (err) {
  if (config.databaseUrl) {
    app.log.error({ err }, 'initDb FAILED with DB configured — exiting (money protection requires the full schema)')
    process.exit(1)
  }
  app.log.error({ err }, 'initDb failed — chat persistence disabled')
}

// In production, serve the built frontend (SPA) from FRONTEND_DIST.
// SERVESTE_FRONTEND=1 (P19): poarta E2E vrea SPA-ul servit FĂRĂ pretențiile
// producției (config-ul de prod cere secretele, iar poarta n-are secrete by
// design) — steagul pornește doar servirea, nimic altceva din prod.
if ((config.isProd || process.env.SERVESTE_FRONTEND === '1') && fs.existsSync(distPath)) {
  await app.register(fastifyStatic, { root: distPath, prefix: '/' })
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
  let targetPort = config.port
  let retries = 5
  while (retries > 0) {
    try {
      await app.listen({ port: targetPort, host: config.bindHost })
      break
    } catch (err: unknown) {
      const errCode = (err as { code?: string })?.code
      if (errCode === 'EADDRINUSE') {
        if (retries > 1) {
          app.log.warn(`Port ${targetPort} busy (EADDRINUSE), retrying in 1s (${retries - 1} left)...`)
          retries--
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } else if (process.env.NODE_ENV !== 'production' || targetPort !== 3001) {
          // Fallback to next port if test/gate port is occupied by a lingering process
          app.log.warn(`Port ${targetPort} unavailable, falling back to ${targetPort + 1}...`)
          targetPort += 1
          retries = 3
        } else {
          throw err
        }
      } else {
        throw err
      }
    }
  }
  app.log.info(`Kelionai backend on :${targetPort}`)
  let backgroundStarted = false
  let activationTimer: NodeJS.Timeout | null = null
  const startBackgroundWork = (): void => {
    if (backgroundStarted) return
    backgroundStarted = true
    startMailbox()
    startAutoInvatare()
    void incarcaReprosuri().catch(() => {})
    void curataJurnaleVechi().catch(() => undefined)
    void cleanupExpiredAuthState().catch(() => undefined)
    void expireChatReplayResults().catch((error) => {
      app.log.warn({ error: curataTextJurnal(error, 160) }, 'chat replay result retention failed')
    })
    const archiveCompletedConstructorJobs = async (): Promise<void> => {
      const archived = await arhiveazaBuildJobsVechi(1)
      if (archived > 0) app.log.info({ archived }, 'constructor terminal jobs archived')
    }
    void archiveCompletedConstructorJobs().catch((error) => {
      app.log.warn({ error: curataTextJurnal(error, 160) }, 'constructor archive retention failed')
    })
    const constructorWatchdog = async (): Promise<void> => {
      const result = await deblocheazaJoburileClaimate()
      if (result.repuse > 0 || result.abandonate > 0) {
        app.log.warn(result, 'constructor watchdog recovered stale jobs')
      }
    }
    void constructorWatchdog().catch((error) => {
      app.log.warn({ error: curataTextJurnal(error, 160) }, 'constructor watchdog failed')
    })
    const constructorWatchdogTimer = setInterval(() => {
      void constructorWatchdog().catch((error) => {
        app.log.warn({ error: curataTextJurnal(error, 160) }, 'constructor watchdog failed')
      })
    }, 60_000)
    constructorWatchdogTimer.unref()
    const retentionTimer = setInterval(() => {
      void curataJurnaleVechi().catch(() => undefined)
      void cleanupExpiredAuthState().catch(() => undefined)
      void expireChatReplayResults().catch((error) => {
        app.log.warn({ error: curataTextJurnal(error, 160) }, 'chat replay result retention failed')
      })
      void archiveCompletedConstructorJobs().catch((error) => {
        app.log.warn({ error: curataTextJurnal(error, 160) }, 'constructor archive retention failed')
      })
    }, 24 * 60 * 60 * 1000)
    retentionTimer.unref()

    const promo = async (): Promise<void> => {
      const { promoTick } = await import('./services/promoTimer.js')
      const result = await promoTick().catch((error) => ({
        rulat: false,
        motiv: `tick_failed: ${String(error).slice(0, 120)}`,
      }))
      if (result.rulat) app.log.info('promotion job completed')
    }
    setTimeout(() => {
      void promo()
      setInterval(() => { void promo() }, 5 * 60 * 1000)
    }, 4 * 60 * 1000)
  }

  if (!config.release.candidateMode) {
    startBackgroundWork()
  } else {
    activationTimer = setInterval(() => {
      const active = releaseSideEffectsEnabled()
      if (active && !backgroundStarted) startBackgroundWork()
      if (!active && backgroundStarted) {
        if (activationTimer) clearInterval(activationTimer)
        shutdownDeactivatedRelease(() => app.close())
      }
    }, 1_000)
    activationTimer.unref()
  }
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
