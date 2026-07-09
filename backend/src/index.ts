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
import { initDb, initAppFiles } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = Fastify({ logger: true, bodyLimit: 25_000_000 })

process.on('unhandledRejection', (reason) => {
  console.error('CRITICAL unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('CRITICAL uncaughtException:', err)
})

async function start() {
  const port = Number(process.env.PORT) || 8080
  
  // 1. Healthcheck minimal - răspunde IMEDIAT pentru Railway
  app.get('/health', async () => ({ status: 'ok', time: new Date().toISOString() }))

  try {
    // 2. Start server imediat
    await app.listen({ host: '0.0.0.0', port })
    console.log(`[BOOT] Server is listening on port ${port} - Healthcheck ACTIVE`)

    // 3. Înregistrare plugin-uri esențiale
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
        return u === '/health' || u.startsWith('/api/bridge/')
      },
    })

    app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      try {
        done(null, body ? JSON.parse(body as string) : {})
      } catch (err) {
        done(err as Error, undefined)
      }
    })

    // 4. Rute (înfășurate individual pentru a nu omorî procesul dacă una e coruptă)
    const routes = [
      { r: authRoutes, p: '/api/auth' },
      { r: chatRoutes, p: '/api/chat' },
      { r: ttsRoutes, p: '/api/tts' },
      { r: adminRoutes, p: '/api/admin' },
      { r: prefsRoutes, p: '/api/prefs' },
      { r: asrRoutes, p: '/api/asr' },
      { r: asrStreamRoutes, p: '/api/asr-stream' },
      { r: correctRoutes, p: '/api/correct' },
      { r: legalRoutes, p: '/api/legal' },
      { r: imageRoutes, p: '/api/image' },
      { r: billingRoutes, p: '/api/billing' },
      { r: demoRoutes, p: '/api/demo' },
      { r: mapviewRoutes, p: '/api/mapview' },
      { r: ingestRoutes, p: '/api/ingest' },
      { r: browserRoutes, p: '/api/browser' },
      { r: bridgeRoutes, p: '/api/bridge' },
      { r: contactRoutes, p: '/api/contact' },
      { r: greetRoutes, p: '/api/greet' },
      { r: meseriiRoutes, p: '/api/meserii' },
    ]

    for (const route of routes) {
      try {
        await app.register(route.r, { prefix: route.p })
      } catch (err) {
        console.error(`[BOOT] Failed to register route ${route.p}:`, err)
      }
    }

    // 5. Static files
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

    // 6. DB Initialization (deferred, non-blocking)
    setImmediate(async () => {
      console.log('[BOOT] Starting background DB init...')
      try {
        if (config.databaseUrl) {
          await initDb()
          await initAppFiles()
          console.log('[BOOT] DB and files ready')
        }
        startMailbox()
      } catch (err) {
        console.error('[BOOT] Background initialization failed:', err)
      }
    })

  } catch (err) {
    console.error('[BOOT] FATAL CRASH during startup:', err)
    process.exit(1)
  }
}

start()
