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
import { meseriiRoutes } from './routes/meserii.js'
import { initDb, recordDownload, initAppFiles, getAppFile } from './db.js'
import { getSessionUser } from './session.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: true, bodyLimit: 25_000_000 })

// GLOBAL body limit kept MODEST (25MB) so no endpoint can be flooded with huge
// payloads — covers audio buffers, documents and camera frames. The ONE route
// that legitimately needs big bodies (the admin bridge carrying photos/archives/
// video to Claude) raises its own limit to 100MB per-route (see chat.ts).

// PLASĂ GLOBALĂ (audit 6 iul): pe Node modern, o singură promisiune respinsă
// fără `.catch` (ex. un `JSON.parse` corupt într-un `.then`) omoară TOT procesul
// → restart-loop pe Railway. Le prindem și le logăm, ca aplicația live să NU cadă
// dintr-o eroare izolată. (Fixul de fond rămâne `.catch` pe fiecare `.then`.)
process.on('unhandledRejection', (reason) => {
  console.error('unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('uncaughtException:', err)
})

async function bootstrap() {
  try {
    await app.register(cookie)
    await app.register(websocket)
    await app.register(cors, {
      origin: config.frontendOrigin,
      credentials: true,
      exposedHeaders: ['X-Greet-Text'],
    })

    await app.register(rateLimit, {
      global: true,
      max: 120,
      timeWindow: '1 minute',
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

    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      ;(req as unknown as { rawBody?: string }).rawBody = body as string
      try {
        done(null, body ? JSON.parse(body as string) : {})
      } catch (err) {
        ;(err as Error & { statusCode?: number }).statusCode = 400
        done(err as Error, undefined)
      }
    })

    // Register all routes
    await app.register(authRoutes, { prefix: '/api/auth' })
    await app.register(chatRoutes, { prefix: '/api/chat' })
    await app.register(ttsRoutes, { prefix: '/api/tts' })
    await app.register(adminRoutes, { prefix: '/api/admin' })
    await app.register(prefsRoutes, { prefix: '/api/prefs' })
    await app.register(asrRoutes, { prefix: '/api/asr' })
    await app.register(asrStreamRoutes, { prefix: '/api/asr-stream' })
    await app.register(correctRoutes, { prefix: '/api/correct' })
    await app.register(legalRoutes, { prefix: '/api/legal' })
    await app.register(imageRoutes, { prefix: '/api/image' })
    await app.register(billingRoutes, { prefix: '/api/billing' })
    await app.register(demoRoutes, { prefix: '/api/demo' })
    await app.register(mapviewRoutes, { prefix: '/api/mapview' })
    await app.register(ingestRoutes, { prefix: '/api/ingest' })
    await app.register(browserRoutes, { prefix: '/api/browser' })
    await app.register(bridgeRoutes, { prefix: '/api/bridge' })
    await app.register(contactRoutes, { prefix: '/api/contact' })
    await app.register(greetRoutes, { prefix: '/api/greet' })
    await app.register(meseriiRoutes, { prefix: '/api/meserii' })

    const distPath = path.resolve(__dirname, '..', config.frontendDist)
    if (fs.existsSync(distPath)) {
      await app.register(fastifyStatic, {
        root: distPath,
        prefix: '/',
        wildcard: false,
      })
      app.get('/*', (req, reply) => {
        reply.sendFile('index.html')
      })
    }

    app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }))

    // Start listening
    const port = Number(process.env.PORT) || 8080
    await app.listen({ host: '0.0.0.0', port })
    app.log.info(`Server listening on port ${port}`)

    // Deferred initialization
    setImmediate(async () => {
      console.log('Starting deferred DB initialization...')
      try {
        if (config.databaseUrl) {
          await initDb()
          await initAppFiles()
          console.log('DB and files initialized successfully')
        }
        startMailbox()
      } catch (err) {
        console.error('Deferred initDb failed:', err)
      }
    })

  } catch (err) {
    console.error('FATAL: Bootstrap failed:', err)
    process.exit(1)
  }
}

bootstrap()
