import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'

// ȘTERGEREA DE CONT PRIN COMANDĂ E ÎNCHISĂ (ordinul ownerului, 14 aug:
// „baza de date de utilizatori trebuie să nu se poată șterge niciodată, prin
// nicio comandă" + „amprentele vocale trebuie să se păstreze"). Scutul din
// Postgres (scutulDatelor) oricum avorta tranzacția pe primul tabel protejat —
// vechiul buton ar fi „mers" doar pe jumătate, cel mai rău fel de a merge.
// Dreptul legal la ștergere (GDPR) NU dispare: cererea se trimite în scris la
// contact@kelionai.app și o hotărăște ownerul, cu procedura lui explicită —
// nu un buton generic. Ruta rămâne ca apelanții vechi să primească MOTIVUL.
export async function meRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/me/delete', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.code(403).send({
      error: 'stergerea_prin_comanda_inchisa',
      motiv:
        'Ștergerea contului prin aplicație e închisă. Pentru cererea legală de ștergere a datelor scrie la contact@kelionai.app — se rezolvă manual, cu confirmare.',
    })
  })
}
