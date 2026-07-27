import { FastifyInstance } from 'fastify'
import { MESERII } from '../services/meserii.js'

export async function meseriiRoutes(app: FastifyInstance): Promise<void> {
  // Public route to list all available roles (used by UI to render cards)
  app.get('/api/meserii', async () => {
    return MESERII.map(m => ({
      id: m.id,
      nume: m.nume,
      descriere: m.descriere
    }))
  })
}
