import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  getSpeechLang,
  setSpeechLangPref,
  getMeserieActiva,
  setMeserieActivaPref,
  getDisabledGestures,
  saveKv,
  loadKv,
  saveNote,
  userKey,
  getVoicePref,
  setVoicePref,
} from '../db.js'
import { config } from '../config.js'
import { getMeserie } from '../services/meserii.js'

// THE AVATAR'S LAYOUT (Adrian, 11 Jul: "save Kelion's current size"): the
// corner position (vw/vh) and scale, saved ON THE SERVER per user — they
// survive browser cleanup and are found again on any device, not just in
// one single Chrome's localStorage.
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
  // "SAVE" FROM THE MONITOR → PERMANENT STORAGE (Adrian, 27 Jul: "the save
  // button is not functional" — it only downloaded a local file, leaving no
  // trace in Kelion). The document goes into notes (DB) → Kelion finds it
  // again anytime through his notes tools, on any device.
  app.post<{ Body: { title?: string; content?: string } }>('/api/notes', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const content = String(req.body?.content ?? '').trim()
    const title = String(req.body?.title ?? '').trim() || undefined
    if (!content) return reply.code(400).send({ error: 'continut_gol' })
    const id = await saveNote(user.email, content.slice(0, 200_000), title)
    if (!id) return reply.code(500).send({ error: 'db_indisponibil' })
    return reply.send({ ok: true, id })
  })
  // The gestures state (the disabled list) — PUBLIC, so that ANY user's
  // avatar doesn't play the gestures removed by Adrian. Not sensitive
  // (cosmetic behaviour).
  app.get('/api/gestures/state', async (_req, reply) => {
    return reply.send({ disabled: await getDisabledGestures() })
  })

  app.get('/api/prefs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    let avatarBox: AvatarBox | null = null
    try {
      const raw = await loadKv(`avatar_box:${userKey(user.email)}`)
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
      avatarBox,
      // HIS VOICE, REMEMBERED ONLY FOR HIM (Adrian, 30 Jul: "he can set the
      // app to whatever voice he wants… it is remembered per user. Must not
      // get mixed up with another user or affect another account").
      // `null` = the app's default voice.
      voice: await getVoicePref(user.email),
      // The list he can choose from — it comes from the server, so the UI
      // doesn't keep a parallel list that goes stale when the env changes.
      voices: config.openai.realtimeVoices,
    })
  })

  app.put<{
    Body: {
      speechLang?: string
      meserieActiva?: number | null
      avatarBox?: AvatarBox
      voice?: string | null
    }
  }>(
    '/api/prefs',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })

    if (req.body?.speechLang !== undefined) {
      const lang = req.body.speechLang?.trim()
      // ALL languages are accepted on the user's EXPLICIT choice (Adrian's
      // order, 25 Jul: "leave me all the languages"). The guard on the 7
      // languages stays ONLY on automatic detection (services/lang.ts), which
      // is where the real problem was — the drift, not a client's conscious
      // choice.
      if (!lang || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await setSpeechLangPref(user.email, lang)
    }

    if (req.body?.voice !== undefined) {
      const v = req.body.voice
      // Only from the known list, or null ("the app's default"). A free-form
      // name would reach the OpenAI session and return 400 — meaning the
      // person's voice would die because of a text field.
      if (v !== null && !config.openai.realtimeVoices.includes(v)) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await setVoicePref(user.email, v)
    }

    if (req.body?.meserieActiva !== undefined) {
      const id = req.body.meserieActiva
      if (id !== null && (typeof id !== 'number' || !getMeserie(id))) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await setMeserieActivaPref(user.email, id)
    }

    if (req.body?.avatarBox !== undefined) {
      const b = req.body.avatarBox
      if (!validAvatarBox(b)) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await saveKv(`avatar_box:${userKey(user.email)}`, JSON.stringify({ x: b.x, y: b.y, s: b.s }))
    }

    return reply.send({ ok: true })
  })
}
