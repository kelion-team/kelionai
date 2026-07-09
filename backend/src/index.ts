import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { bridgeRoutes } from './routes/bridge.js'

const PORT = Number(process.env.PORT) || 8080
const app = Fastify({ logger: true })

async function start() {
  app.get('/health', async () => ({ status: 'ok', auth: 'disabled-for-test' }))

  try {
    await app.register(websocket)
    await app.register(bridgeRoutes, { prefix: '/api/bridge' })
    
    await app.listen({ host: '0.0.0.0', port: PORT })
    console.log(`[TEST] Server listening on ${PORT} with AUTH DISABLED`)
  } catch (err) {
    console.error('[TEST] Startup crash:', err)
    process.exit(1)
  }
}

start()
