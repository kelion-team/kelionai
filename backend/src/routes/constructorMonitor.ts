import type { FastifyInstance } from 'fastify'
import { cerAdmin } from '../session.js'
import { readConstructorMonitor } from '../services/constructorMonitor.js'

export async function constructorMonitorRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/admin/constructor/monitor',async (req,reply) => {
    const user=cerAdmin(req,reply)
    if (!user) return
    if (user.authProvider !== 'google') return reply.code(403).send({error:'forbidden'})
    reply.header('Cache-Control','private, no-store')
    try { return await readConstructorMonitor() }
    catch { return reply.code(503).send({ error:'constructor_monitor_unavailable',state:'unknown',activeExecution:false }) }
  })
}
