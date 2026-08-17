import { FastifyInstance } from 'fastify'

export async function pingRoutes(app: FastifyInstance): Promise<void> {
  // Simple public probe: confirms the service is alive (used for quick checks).
  app.get('/api/ping', async () => ({ ok: true, service: 'kelion' }))
}
