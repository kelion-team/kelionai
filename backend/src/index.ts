import Fastify from 'fastify'
// paritate-verificata-13iul
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
import { meRoutes } from './routes/me.js'
import { demoRoutes } from './routes/demo.js'
import { mapviewRoutes } from './routes/mapview.js'
import { ingestRoutes } from './routes/ingest.js'
import { browserRoutes } from './routes/browser.js'
import { opsRoutes } from './routes/ops.js'
import { authLocalRoutes } from './routes/authLocal.js'
import { contactRoutes } from './routes/contact.js'
import { startMailbox } from './services/mailbox.js'
import { triageGaps } from './services/gapsTriage.js'
import { reconcileStripePayments } from './services/stripeReconcile.js'
import { checkOpenRouterBalance } from './services/openrouterAlert.js'
import { autoFundIssuing } from './services/stripe.js'
import { greetRoutes } from './routes/greet.js'
import { meseriiRoutes } from './routes/meserii.js'
import { voiceprintRoutes } from './routes/voiceprint.js'
import { clientErrorRoutes } from './routes/clientErrors.js'
import { realtimeRoutes } from './routes/realtime.js'
import { modelRoutes } from './routes/models.js'
import { initDb, recordDownload, initAppFiles, getAppFile, backfillMemoryEmbeddings } from './db.js'
import { getSessionUser } from './session.js'
import { isArmed, hasUnlock } from './services/adminLock.js'
import { buildLinuxZip } from './services/linuxPackage.js'

// Content types for the download endpoint (installers + QR images + manifest).
const DL_TYPES: Record<string, string> = {
  exe: 'application/octet-stream',
  apk: 'application/vnd.android.package-archive',
  png: 'image/png',
  json: 'application/json',
  zip: 'application/zip',
}

// Pachetul Linux nu e un binar depozitat, ci un lansator generat pe loc — mereu
// versiunea live, deci /dl/Kelionai-linux.zip nu poate 404 (Adrian, 9 iul).
const LINUX_ZIP = 'Kelionai-linux.zip'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// GLOBAL body limit kept MODEST (25MB) so no endpoint can be flooded with huge
// payloads — covers audio buffers, documents and camera frames. The /api/chat
// route raises its own limit to 100MB per-route for camera frames (see chat.ts).
const app = Fastify({ logger: true, bodyLimit: 25_000_000 })

// PLASĂ GLOBALĂ (audit 6 iul): pe Node modern, o singură promisiune respinsă
// fără `.catch` (ex. un `JSON.parse` corupt într-un `.then`) omoară TOT procesul
// → restart-loop pe gazdă. Le prindem și le logăm, ca aplicația live să NU cadă
// dintr-o eroare izolată. (Fixul de fond rămâne `.catch` pe fiecare `.then`.)
process.on('unhandledRejection', (reason) => {
  app.log.error({ reason }, 'unhandledRejection — prins global, procesul rămâne viu')
})
process.on('uncaughtException', (err) => {
  app.log.error({ err }, 'uncaughtException — prins global, procesul rămâne viu')
})

await app.register(cookie)
// WebSocket pentru microfonul full-duplex (STT stream) și vocea live.
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
      // FIȘIERE STATICE (avatar .glb, modele face-api, bundle JS/CSS, imagini):
      // NICIODATĂ rate-limited. Cauza „microfonul pleacă dar nu aude" (14 iul):
      // o singură încărcare de pagină cere ZECI de /anim/*.glb + /models/* deodată,
      // depășea 120/min și dădea 429 pe TOT — inclusiv WebSocket-ul microfonului.
      // Orice cale non-/api/ = fișier static → exceptată; API-ul îți păstrează capul.
      !u.startsWith('/api/') ||
      // MICROFONUL (voce): WebSocket-ul de STT — calea critică, nu poate fi throttled.
      u === '/api/asr-stream' ||
      u === '/health' ||
      u === '/api/version' || // sondat la 45s de fiecare client pentru rutina de update
      u === '/api/dev/status' ||
      u === '/api/dev/heartbeat' ||
      u === '/api/chat/incoming' ||
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

// LACĂTUL ADMIN — AL DOILEA FACTOR PE TOT /api/admin/* (Adrian, 27 iul: „dacă
// amprenta nu corespunde, nici butonul admin nu trebuie să se activeze").
// Un singur punct de strangulare, nu 40 de handler-e: odată ARMAT (secretul
// setat), sesiunea de admin NU mai e de-ajuns — trebuie și deblocarea (amprenta
// vocală potrivită sau secretul tastat → cookie semnat 12h). 423 = semnalul
// distinct pentru client că panoul e încuiat (403 rămâne „nu ești admin").
// Excepții: rutele de deblocare însele (altfel lacătul nu s-ar putea deschide).
app.addHook('preHandler', async (req, reply) => {
  const u = (req.raw.url ?? '').split('?')[0]
  if (!u.startsWith('/api/admin/')) return
  if (u.startsWith('/api/admin/unlock')) return
  const user = getSessionUser(req)
  if (!user || user.role !== 'admin') return // 403-ul din rută rămâne autoritatea
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
  // Service worker-ul + manifestul PWA: MEREU proaspete. Cloudflare le ținea
  // 4 ore la edge (max-age=14400 din static) — deci instalările (PWA/TWA/iOS/
  // desktop, toate încarcă site-ul live) rămâneau lipite de shell-ul vechi până
  // la 4 ore după deploy. no-store = update-ul ajunge la TOȚI la prima deschidere.
  if (u === '/sw.js' || u === '/manifest.webmanifest') {
    reply.header('Cache-Control', 'no-store')
    return
  }
  // HTML-UL PRINCIPAL: MEREU proaspăt (Adrian, 26 iul: „aplicațiile de sub
  // codul de bare nu preiau automat ultimul update... nu preiau funcțiile de pe
  // pagina web"). Aceeași boală ca la sw.js, rămasă nerezolvată la index.html:
  // Cloudflare îl ținea la edge până la 4 ore, deci SHELL-urile instalate
  // (exe/APK/TWA — toate deschid site-ul live la kelionai.app/) primeau HTML-ul
  // VECHI cu bundle-urile vechi. Browserele scăpau prin rutina „/?_v=timestamp";
  // coaja care deschide simplu „/" rămânea lipită de versiunea veche. no-store
  // pe ORICE răspuns text/html (/, /login, /credite, fallback SPA) = fiecare
  // deschidere ia pagina nouă; bundle-urile cu hash rămân cache-uite normal.
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

// Health — must return exactly 200 (200-only rule + healthcheck-ul gazdei)
app.get('/health', async () => ({ status: 'ok' }))

// VERSIUNEA DEPLOY-ULUI (Adrian, 10 iul: „la orice deploy nou se actualizează
// filigranul, browserul repornește curat"). Gazda poate injecta sha-ul
// commitului publicat prin GIT_COMMIT_SHA; frontend-ul îl sondează și, când se
// schimbă, face resetul curat la ultima versiune. Filigranul îl afișează —
// deci SE SCHIMBĂ la ORICE publicare, chiar dacă interfața n-a fost atinsă.
const DEPLOY_SHA = (process.env.GIT_COMMIT_SHA ?? '').slice(0, 7)
const BOOT_AT = new Date().toISOString()
// Fără sha injectat, momentul pornirii E versiunea: se schimbă la fiecare
// publicare reală.
const DEPLOY_V = DEPLOY_SHA || BOOT_AT
app.get('/api/version', async (_req, reply) => {
  reply.header('Cache-Control', 'no-store')
  return { v: DEPLOY_V, at: BOOT_AT }
})

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
await app.register(meRoutes)
await app.register(demoRoutes)
await app.register(mapviewRoutes)
await app.register(ingestRoutes)
await app.register(browserRoutes)
await app.register(opsRoutes)
await app.register(authLocalRoutes)
await app.register(contactRoutes)
await app.register(greetRoutes)
await app.register(meseriiRoutes)
await app.register(voiceprintRoutes)
await app.register(clientErrorRoutes)
await app.register(realtimeRoutes)
await app.register(modelRoutes)

// Where the built frontend + baked-in download defaults live.
const distPath = path.resolve(__dirname, '..', config.frontendDist)

// Create tables if a database is configured (non-fatal if it isn't / is down).
try {
  await initDb()
  await initAppFiles() // load installer masters (uploaded from Linux) into cache
} catch (err) {
  app.log.error({ err }, 'initDb failed — chat persistence disabled')
}

// MEMORIE SEMANTICĂ — backfill lent (12 iul): amintirile vechi primesc vector
// de înțeles în loturi mici, la 10 minute; fără cheie Gemini e un no-op ieftin.
setTimeout(() => {
  const tick = (): void => {
    void backfillMemoryEmbeddings(40).catch(() => {})
  }
  tick()
  setInterval(tick, 10 * 60_000)
}, 30_000)

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
  // Linux: dacă nu s-a urcat un binar real în DB/pe disc, servește lansatorul
  // generat pe loc — mereu 200, mereu versiunea live (un binar urcat ulterior în
  // DB are prioritate, fiindcă e verificat mai sus).
  if (file === LINUX_ZIP) {
    reply.header('Content-Type', 'application/zip')
    reply.header('Content-Disposition', `attachment; filename="${LINUX_ZIP}"`)
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
  // PLASA BANILOR (Adrian, 24 iul: „nu e de joacă cu banii userilor"):
  // reconciliere Stripe la boot + la fiecare oră — orice plată reală rămasă
  // necreditată (webhook pierdut/respins) se aplică singură, idempotent.
  setTimeout(() => {
    const run = (): void => {
      void reconcileStripePayments()
        .then((r) => { if (r.credited > 0) app.log.warn(r, 'stripe reconcile: plăți recuperate') })
        .catch(() => {})
    }
    run()
    setInterval(run, 60 * 60 * 1000)
  }, 20_000)
  // ALIMENTAREA AUTOMATĂ A PUNGII CARDULUI (Adrian, 24 iul: „tot prin Stripe,
  // circuit unificat, nimic extern"): când punga cardului scade sub prag și
  // punga plăților are bani, transferăm prin Balance Transfer API — banii
  // userilor curg singuri spre cardul care hrănește AI-ul. La 60s după boot,
  // apoi orar. (Endpoint beta la Stripe — starea apare în Circuitul banilor.)
  setTimeout(() => {
    void autoFundIssuing().catch(() => {})
    setInterval(() => { void autoFundIssuing().catch(() => {}) }, 60 * 60 * 1000)
  }, 60_000)
  // ALERTĂ SOLD OPENROUTER (Adrian, 24 iul: „se anunță admin că e nevoie să
  // depună bani"): creierul e alimentat CENTRAL din punga lui Kelion; când
  // soldul real scade sub prag, îl anunțăm pe admin pe email (o dată/zi).
  // La 40s după boot, apoi la fiecare 30 min. Best-effort.
  setTimeout(() => {
    void checkOpenRouterBalance().catch(() => {})
    setInterval(() => { void checkOpenRouterBalance().catch(() => {}) }, 30 * 60 * 1000)
  }, 40_000)
  // TRIAJ AUTONOM zilnic al cererilor neacoperite (Adrian, 24 iul): Kelion
  // decide singur ce aduce valoare (rămâne „DE IMPLEMENTAT") și ce se închide
  // automat. La 1h după boot, apoi la 24h. Best-effort — nu blochează nimic.
  setTimeout(() => {
    void triageGaps().then((r) => app.log.info(r, 'gaps triage (autonom)')).catch(() => {})
    setInterval(() => {
      void triageGaps().then((r) => app.log.info(r, 'gaps triage (autonom)')).catch(() => {})
    }, 24 * 60 * 60 * 1000)
  }, 60 * 60 * 1000)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
