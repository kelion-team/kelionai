import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { config } from './config.js'
import { bridgeRoutes } from './routes/bridge.js'
import { initDb, initAppFiles } from './db.js'

const app = Fastify({ 
  logger: true,
  disableRequestLogging: false 
})

async function bootstrap() {
  const port = Number(process.env.PORT) || 8080
  
  // Healthcheck pentru Railway
  app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

  try {
    await app.register(websocket)
    await app.register(bridgeRoutes, { prefix: '/api/bridge' })
    
    // Pornim ascultarea înainte de DB pentru a trece healthcheck-ul Railway rapid
    await app.listen({ host: '0.0.0.0', port })
    console.log(`[BOOTSTRAP] Server listening on port ${port}`)

    // Inițializare asincronă DB (nu blochează pornirea)
    setImmediate(async () => {
      try {
        if (config.databaseUrl) {
          await initDb()
          await initAppFiles()
          console.log('[DB] Initialized successfully')
        }
      } catch (err) {
        console.error('[DB] Deferred initialization failed:', err)
      }
    })

  } catch (err) {
    console.error('[BOOTSTRAP] Fatal error:', err)
    process.exit(1)
  }
}

bootstrap()
