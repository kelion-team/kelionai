import Fastify from 'fastify'
import websocket from '@fastify/websocket'

// CONFIG MINIMALĂ (direct din env pentru a evita crash la import config.js)
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'k3l1on_br1dg3_5tr0ng_2026_99'
const PORT = Number(process.env.PORT) || 8080

const app = Fastify({ logger: true })

async function start() {
  app.get('/health', async () => ({ status: 'ok', mode: 'emergency-flat' }))

  // RUTA DE BRIDGE ÎNCORPORATĂ (pentru a evita erori de import ESM/NodeNext)
  app.all('/api/bridge/*', async (req, res) => {
    const got = String(req.headers['x-bridge-secret'] ?? '')
    if (!got || got !== BRIDGE_SECRET) {
      console.log(`[AUTH_FAIL] Minimal check failed`)
      return res.status(401).send({ error: 'Unauthorized' })
    }
    return res.status(200).send({ status: 'connected', msg: 'Bridge restored via flat index' })
  })

  try {
    await app.register(websocket)
    await app.listen({ host: '0.0.0.0', port: PORT })
    console.log(`[EMERGENCY] Server listening on ${PORT}`)
  } catch (err) {
    console.error('[EMERGENCY] Startup crash:', err)
    process.exit(1)
  }
}

start()
