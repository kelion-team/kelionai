import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  getSpeechLang,
  setSpeechLangPref,
  getMeserieActiva,
  setMeserieActivaPref,
  getAnthropicKey,
  setAnthropicKey,
  saveKv,
  loadKv,
} from '../db.js'
import { getMeserie } from '../services/meserii.js'

// ARANJAREA AVATARULUI (Adrian, 11 iul: „salvează mărimea actuală a lui
// Kelion"): poziția (vw/vh) și scala colțului, salvate PE SERVER per
// utilizator — supraviețuiesc curățării browserului și se regăsesc pe orice
// dispozitiv, nu doar în localStorage-ul unui singur Chrome.
interface AvatarBox {
  x: number
  y: number
  s: number
}

function validAvatarBox(b: unknown): b is AvatarBox {
  const v = b as AvatarBox | null
  return (
    !!v &&
    typeof v.x === 'number' &&
    typeof v.y === 'number' &&
    typeof v.s === 'number' &&
    v.x >= -50 &&
    v.x <= 150 &&
    v.y >= -50 &&
    v.y <= 150 &&
    v.s >= 0.1 &&
    v.s <= 1
  )
}

// Per-user preferences: the speech language (what Kelion hears + speaks) and
// the active "meserie" (role/persona), both persisted for as long as the user
// exists. Auth-gated to the session user — each user only ever reads/writes
// their own.
export async function prefsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/prefs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    let avatarBox: AvatarBox | null = null
    try {
      const raw = await loadKv(`avatar_box:${user.email}`)
      if (raw) {
        const parsed: unknown = JSON.parse(raw)
        if (validAvatarBox(parsed)) avatarBox = parsed
      }
    } catch {
      avatarBox = null
    }
    return reply.send({
      speechLang: await getSpeechLang(user.email),
      meserieActiva: await getMeserieActiva(user.email),
      // NICIODATĂ cheia în clar către browser (audit 9 iul): un secret cu putere
      // de bani nu se trimite înapoi la client — doar DACĂ e setată. UI-ul
      // afișează „Modifică/Adaugă" din boolean; câmpul pornește gol, nu preumplut.
      anthropicKeySet: !!(await getAnthropicKey(user.email)),
      avatarBox,
    })
  })

  app.put<{
    Body: {
      speechLang?: string
      meserieActiva?: number | null
      anthropicKey?: string | null
      avatarBox?: AvatarBox
    }
  }>(
    '/api/prefs',
    async (req, reply) => {
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

    if (req.body?.anthropicKey !== undefined) {
      const key = req.body.anthropicKey
      if (key !== null && typeof key !== 'string') {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await setAnthropicKey(user.email, key)
    }

    if (req.body?.avatarBox !== undefined) {
      const b = req.body.avatarBox
      if (!validAvatarBox(b)) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await saveKv(`avatar_box:${user.email}`, JSON.stringify({ x: b.x, y: b.y, s: b.s }))
    }

    return reply.send({ ok: true })
  })
}
