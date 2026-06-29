import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import { config } from './config.js'
import { authRoutes } from './routes/auth.js'
import { chatRoutes } from './routes/chat.js'
import { ttsRoutes } from './routes/tts.js'
import { adminRoutes } from './routes/admin.js'
import { initDb } from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// bodyLimit raised so a base64 camera frame (permanent vision) fits the POST.
const app = Fastify({ logger: true, bodyLimit: 8_000_000 })

await app.register(cookie)
await app.register(cors, {
  origin: config.frontendOrigin,
  credentials: true,
})

// Health — must return exactly 200 (200-only rule + Railway healthcheck)
app.get('/health', async () => ({ status: 'ok' }))

await app.register(authRoutes)
await app.register(chatRoutes)
await app.register(ttsRoutes)
await app.register(adminRoutes)

// Create tables if a database is configured (non-fatal if it isn't / is down).
try {
  await initDb()
} catch (err) {
  app.log.error({ err }, 'initDb failed — chat persistence disabled')
}

// In production, serve the built frontend (SPA) from FRONTEND_DIST.
const distPath = path.resolve(__dirname, '..', config.frontendDist)
if (config.isProd && fs.existsSync(distPath)) {
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
  await app.listen({ port: config.port, host: '0.0.0.0' })
  app.log.info(`Kelionai backend on :${config.port}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}
