import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { cheiePublicaPush, aboneazaPush, dezaboneazaPush } from '../services/pushTelefon.js'
import type { AbonarePush } from '../services/pushTelefon.js'

// Ușile Web Push (abonarea telefonului la notificări). Cheia publică e liberă
// (e publică prin definiție); abonarea/dezabonarea cer sesiune — abonarea se
// leagă de emailul REAL din sesiune, nu de unul declarat de client.
export async function pushRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/push/cheie', async (_req, reply) => {
    const cheie = await cheiePublicaPush()
    if (!cheie)
      return reply.code(503).send({ error: 'push_nepornit', motiv: 'Baza de date e oprită — cheile push nu au unde trăi.' })
    return { cheie }
  })

  app.post('/api/push/aboneaza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const abonare = (req.body as { abonare?: AbonarePush })?.abonare
    if (!abonare?.endpoint)
      return reply.code(400).send({ error: 'abonare_lipsa', motiv: 'Corpul trebuie să conțină abonarea din pushManager.subscribe().' })
    const ok = await aboneazaPush(user.email, abonare)
    if (!ok) return reply.code(503).send({ error: 'abonare_picata', motiv: 'Nu am putut salva abonarea (baza de date).' })
    return { ok: true }
  })

  app.post('/api/push/dezaboneaza', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const endpoint = (req.body as { endpoint?: string })?.endpoint ?? ''
    const ok = await dezaboneazaPush(user.email, endpoint)
    return { ok }
  })
}
