import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { getSpeechLang, setSpeechLangPref, getMeserieActiva, setMeserieActivaPref } from '../db.js'
import { getMeserie } from '../services/meserii.js'

// Per-user preferences: the speech language (what Kelion hears + speaks) and
// the active "meserie" (role/persona), both persisted for as long as the user
// exists. Auth-gated to the session user — each user only ever reads/writes
// their own.
export async function prefsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/prefs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send({
      speechLang: await getSpeechLang(user.email),
      meserieActiva: await getMeserieActiva(user.email),
    })
  })

  app.put<{ Body: { speechLang?: string; meserieActiva?: number | null } }>('/api/prefs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    if (req.body?.speechLang !== undefined) {
      const lang = req.body.speechLang?.trim()
      if (!lang || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await setSpeechLangPref(user.email, lang)
    }

    if (req.body?.meserieActiva !== undefined) {
      const id = req.body.meserieActiva
      if (id !== null && (typeof id !== 'number' || !getMeserie(id))) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await setMeserieActivaPref(user.email, id)
    }

    return reply.send({ ok: true })
  })
}
