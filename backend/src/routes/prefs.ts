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
  // „SALVEAZĂ" DE PE MONITOR → STOCAREA PERMANENTĂ (Adrian, 27 iul: „butonul
  // salvează nu e funcțional" — descărca doar un fișier local, fără nicio urmă
  // în Kelion). Documentul intră în notes (DB) → Kelion îl regăsește oricând
  // prin uneltele lui de notițe, pe orice dispozitiv.
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
  // Starea gesturilor (lista dezactivată) — PUBLIC, ca avatarul ORICĂRUI user să
  // nu joace gesturile scoase de Adrian. Nu e sensibil (comportament cosmetic).
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
      // VOCEA LUI, ȚINUTĂ MINTE DOAR PENTRU EL (Adrian, 30 iul: „își poate seta
      // aplicația cu ce voce dorește… se ține minte per user. A nu se încurca cu
      // alt user sau să afecteze alt cont"). `null` = vocea implicită a aplicației.
      voice: await getVoicePref(user.email),
      // Lista din care poate alege — vine de la server, ca interfața să nu aibă
      // o listă paralelă care se învechește când se schimbă env-ul.
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
      // TOATE limbile sunt acceptate la alegerea EXPLICITĂ a userului (ordinul
      // lui Adrian, 25 iul: „îmi lași toate limbile"). Garda pe cele 7 limbi
      // rămâne DOAR pe detecția automată (services/lang.ts), unde era problema
      // reală — deriva, nu alegerea conștientă a unui client.
      if (!lang || !/^[a-z]{2}(-[A-Z]{2})?$/.test(lang)) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      await setSpeechLangPref(user.email, lang)
    }

    if (req.body?.voice !== undefined) {
      const v = req.body.voice
      // Doar din lista cunoscută, sau null („implicita aplicației"). Un nume
      // liber ar ajunge în sesiunea OpenAI și ar întoarce 400 — adică vocea
      // omului ar muri din cauza unui câmp de text.
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
