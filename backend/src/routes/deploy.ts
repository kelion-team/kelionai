import { FastifyInstance, FastifyPluginAsync } from 'fastify'
import { readFile, stat } from 'node:fs/promises'

export interface DeployProgress {
  percent: number
  step: string
  timestamp: string
  active: boolean
  done: boolean
}

/**
 * Căi posibile pentru fișierul de progres al deploy-ului
 * (pe VPS, în container sau în test/dev).
 */
const POSSIBLE_STATUS_PATHS = [
  '/tmp/deploy-progress.json',
  '/host/kelion/deploy-progress.json',
  '/root/kelion/deploy-progress.json',
]

/**
 * Citește starea curentă a progresului de deploy din sistemul de fișiere.
 */
export async function getDeployProgress(): Promise<DeployProgress> {
  for (const path of POSSIBLE_STATUS_PATHS) {
    try {
      const content = await readFile(path, 'utf8')
      const parsed = JSON.parse(content.trim())
      const percent = typeof parsed.percent === 'number' ? Math.min(100, Math.max(0, parsed.percent)) : 0
      const step = typeof parsed.step === 'string' ? parsed.step : 'În desfășurare'
      const timestamp = typeof parsed.timestamp === 'string' ? parsed.timestamp : new Date().toISOString()
      const done = percent >= 100
      return {
        percent,
        step,
        timestamp,
        active: !done,
        done,
      }
    } catch {
      // Continuă la următoarea cale dacă fișierul nu există sau nu e parsabil
    }
  }

  // Stare implicită dacă nu rulează niciun deploy activ
  return {
    percent: 100,
    step: 'Deploy finalizat / sistem pregătit',
    timestamp: new Date().toISOString(),
    active: false,
    done: true,
  }
}

export const deployRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Snapshot JSON direct
  fastify.get('/api/deploy/progress', async (_req, reply) => {
    const progress = await getDeployProgress()
    return reply.send(progress)
  })

  // Server-Sent Events (SSE) streaming pentru progres în timp real
  fastify.get('/api/deploy/status', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    })

    // Trimite prima stare imediat
    const initial = await getDeployProgress()
    reply.raw.write(`data: ${JSON.stringify(initial)}\n\n`)

    let lastJson = JSON.stringify(initial)
    const interval = setInterval(async () => {
      try {
        const current = await getDeployProgress()
        const currentJson = JSON.stringify(current)
        if (currentJson !== lastJson) {
          lastJson = currentJson
          reply.raw.write(`data: ${currentJson}\n\n`)
        } else {
          // Keep-alive heartbeat comment
          reply.raw.write(`: ping\n\n`)
        }
      } catch (err) {
        fastify.log.error(err, 'Eroare la citirea progresului de deploy pentru SSE')
      }
    }, 1500)

    req.raw.on('close', () => {
      clearInterval(interval)
    })
  })
}
