import { FastifyInstance } from 'fastify'

export async function pingRoutes(app: FastifyInstance): Promise<void> {
  // Sondă publică simplă: confirmă că serviciul e viu (folosită la verificări rapide).
  app.get('/api/ping', async () => ({ ok: true, service: 'kelion' }))
}
