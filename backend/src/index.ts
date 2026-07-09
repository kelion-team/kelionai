import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { config } from './config.js'
import { bridgeRoutes } from './routes/bridge.js'

const app = Fastify({ logger: true })

process.on('unhandledRejection', (reason) => {
  console.error('MINIMAL unhandledRejection:', reason)
})
process.on('uncaughtException', (err) => {
  console.error('MINIMAL uncaughtException:', err)
})

async function start() {
  const port = Number(process.env.PORT) || 8080
  
  app.get('/health', async () => ({ status: 'ok', minimal: true }))

  try {
    await app.register(websocket)
    await app.register(bridgeRoutes, { prefix: '/api/bridge' })
    
    await app.listen({ host: '0.0.0.0', port })
    console.log(`[MINIMAL] Server listening on port ${port}`)
  } catch (err) {
    console.error('[MINIMAL] FATAL STARTUP ERROR:', err)
    process.exit(1)
  }
}

start()
