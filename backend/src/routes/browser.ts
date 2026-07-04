import type { FastifyInstance } from 'fastify'
import { getShot, browserOpen, browserClose } from '../services/browser.js'
import { config } from '../config.js'

// Serves the live browser's latest screenshot, so the monitor iframe can show
// it (mirrors routes/image.ts's pattern for generated images).
export async function browserRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/api/browser/shot/:id', async (req, reply) => {
    const shot = getShot(req.params.id)
    if (!shot) return reply.code(404).send({ error: 'not_found' })
    return reply
      .header('Content-Type', shot.mime)
      .header('Cache-Control', 'no-store')
      .send(shot.buf)
  })

  // Owner diagnostics (bridge-secret protected): launches the real production
  // Chromium against example.com and returns the actual error text on failure —
  // so a broken browser is diagnosable from outside instead of a silent iframe.
  app.post('/api/browser/diag', async (req, reply) => {
    if (!config.bridgeSecret || req.headers['x-bridge-secret'] !== config.bridgeSecret)
      return reply.code(401).send({ error: 'unauthorized' })
    const result = await browserOpen('diag@internal', `https://${req.headers.host}`, 'https://example.com')
    void browserClose('diag@internal')
    if ('error' in result) return { ok: false, error: result.error }
    return { ok: true, title: result.title, textChars: result.text.length }
  })
}
