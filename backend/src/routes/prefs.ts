import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref } from '../db.js'

// Per-user preferences. Currently the speech language (what Kelion hears +
// speaks), persisted for as long as the user exists. Auth-gated to the session
// user — each user only ever reads/writes their own.
export async function prefsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/prefs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send({ speechLang: await getSpeechLang(user.email) })
  })

  app.put<{ Body: { speechLang?: string } }>('/api/prefs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const lang = req.body?.speechLang?.trim()
    if (!lang || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
      return reply.code(400).send({ error: 'bad_request' })
    }
    await setSpeechLangPref(user.email, lang)
    return reply.send({ ok: true })
  })
}
