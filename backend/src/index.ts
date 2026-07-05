import Fastify from 'fastify'
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
import { asrStreamRoutes } from './routes/asr-stream.js'
import { correctRoutes } from './routes/correct.js'
import { legalRoutes } from './routes/legal.js'
import { imageRoutes } from './routes/image.js'
import { billingRoutes } from './routes/billing.js'
import { demoRoutes } from './routes/demo.js'
import { mapviewRoutes } from './routes/mapview.js'
import { ingestRoutes } from './routes/ingest.js'
import { browserRoutes } from './routes/browser.js'
import { bridgeRoutes } from './routes/bridge.js'
import { contactRoutes } from './routes/contact.js'
import { startMailbox } from './services/mailbox.js'
import { greetRoutes } from './routes/greet.js'
import { initDb, recordDownload, initAppFiles, getAppFile } from './db.js'
import { getSessionUser } from './session.js'

// Content types for the download endpoint (installers + QR images + manifest).
const DL_TYPES: Record<string, string> = {
  exe: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  png: 'image/png',
  json: 'application/json',
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GLOBAL body limit kept MODEST (25MB) so no endpoint can be flooded with huge
// payloads — covers audio buffers, documents and camera frames. The ONE route
// that legitimately needs big bodies (the admin bridge carrying photos/archives/
// video to Claude) raises its own limit to 100MB per-route (see chat.ts).
const app = Fastify({ logger: true, bodyLimit: 25_000_000 })

await app.register(cookie)
// CANALUL PERMANENT al punții (Adrian, 4 iul): minim 5 benzi WebSocket
// full-duplex, mereu deschise, între server și creierul de pe Linux.
await app.register(websocket)
await app.register(cors, {
  origin: config.frontendOrigin,
  credentials: true,
  // The landing greeting returns the spoken line in this header so the client
  // can drive the avatar's mouth; expose it for cross-origin reads.
  exposedHeaders: ['X-Greet-Text'],
})

// RATE LIMITING — the first line of defence against cost-abuse and DoS. Keyed on
// the REAL client IP (Cloudflare puts it in cf-connecting-ip; req.ip is only the
// CF edge, shared by everyone). A generous global cap absorbs legitimate polling
// (dev-status, presence, bridge) while stopping floods; the expensive /api/chat
// route sets a tighter per-route limit of its own (see chat.ts).
await app.register(rateLimit, {
  global: true,
  max: 120,
  timeWindow: '1 minute',
  // Exempt the HIGH-FREQUENCY legitimate pollers so they never trip the limit
  // (which would flicker the Bridge/Server lights): the health check, the
  // dev-status/heartbeat presence, the admin chat-incoming poll, and every
  // secret-protected /api/bridge/* endpoint (already gated by the shared secret,
  // not an abuse vector). The cost-sensitive /api/chat keeps its own tighter cap.
  allowList: (req) => {
    const u = (req.url || '').split('?')[0]
    return (
      u === '/health' ||
      u === '/api/dev/status' ||
      u === '/api/dev/heartbeat' ||
      u === '/api/chat/incoming' ||
      u === '/api/visit/ping' ||
      u.startsWith('/api/bridge/')
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

// Keep the raw JSON body around (Stripe webhook signature verification needs the
// exact bytes) while still parsing JSON for every other route.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  ;(req as unknown as { rawBody?: string }).rawBody = body as string
  try {
    done(null, body ? JSON.parse(body as string) : {})
  } catch (err) {
    // Malformed JSON is a CLIENT error → 400, never a 500 server crash.
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

// Health — must return exactly 200 (200-only rule + Railway healthcheck)
app.get('/health', async () => ({ status: 'ok' }))

// Test/verification endpoint for the SDK constructor
app.get('/api/sdk-ping', async () => ({ ok: true, by: 'sdk-constructor' }))

await app.register(authRoutes)
await app.register(chatRoutes)
await app.register(ttsRoutes)
await app.register(adminRoutes)
await app.register(prefsRoutes)
await app.register(asrRoutes)
await app.register(asrStreamRoutes)
await app.register(correctRoutes)
await app.register(legalRoutes)
await app.register(imageRoutes)
await app.register(billingRoutes)
await app.register(demoRoutes)
await app.register(mapviewRoutes)
await app.register(ingestRoutes)
await app.register(browserRoutes)
await app.register(bridgeRoutes)
await app.register(contactRoutes)
await app.register(greetRoutes)

// Where the built frontend + baked-in download defaults live.
const distPath = path.resolve(__dirname, '..', config.frontendDist)

// Create tables if a database is configured (non-fatal if it isn't / is down).
try {
  await initDb()
  await initAppFiles() // load installer masters (uploaded from Linux) into cache
} catch (err) {
  app.log.error({ err }, 'initDb failed — chat persistence disabled')
}

// Download endpoint: the installer MASTER lives on the Linux server and is
// pushed into app_files, so this serves the LATEST bytes with NO app redeploy.
// DB first (fresh, from the server) → disk fallback (baked-in defaults). The
// onSend hook adds no-store + logs the download; a single flat segment only.
app.get<{ Params: { file: string } }>('/dl/:file', async (req, reply) => {
  const file = req.params.file
  if (file.includes('/') || file.includes('..')) return reply.code(404).send({ error: 'not_found' })
  const ext = file.split('.').pop()?.toLowerCase() ?? ''
  const type = DL_TYPES[ext] ?? 'application/octet-stream'
  const db = getAppFile(file)
  if (db) {
    reply.header('Content-Type', db.type || type)
    return reply.send(db.buf)
  }
  const onDisk = path.resolve(distPath, 'downloads', file)
  if (onDisk.startsWith(path.resolve(distPath, 'downloads')) && fs.existsSync(onDisk)) {
    reply.header('Content-Type', type)
    return reply.send(fs.createReadStream(onDisk))
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
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
