import type { FastifyInstance } from 'fastify'
import { synthesize } from '../services/tts.js'

// PUBLIC hover-to-greet for the marketing landing. The 3D Kelion greets a
// visitor (time-appropriate, in English) the moment the mouse touches him.
// SAFE by construction: no user input — only four canned English lines chosen
// by a `slot` param. Each line is synthesised ONCE via Chirp 3 HD and cached in
// memory forever, so this costs at most four TTS calls for the whole app's life
// and cannot be abused as a free TTS endpoint. The audio drives the SAME avatar
// lip-sync pipeline on the client, so his mouth moves as he speaks.

type Slot = 'morning' | 'afternoon' | 'evening' | 'night'

const LINES: Record<Slot, string> = {
  morning: "Good morning! I'm Kelion, your brilliant assistant. Lovely to see you.",
  afternoon: "Good afternoon! I'm Kelion, your brilliant assistant. Lovely to see you.",
  evening: "Good evening! I'm Kelion, your brilliant assistant. Lovely to see you.",
  night: "Hello there! I'm Kelion, your brilliant assistant. Up late, I see — welcome.",
}

function isSlot(s: string | undefined): s is Slot {
  return s === 'morning' || s === 'afternoon' || s === 'evening' || s === 'night'
}

// slot → cached MP3 (generated on first request, kept forever).
const cache = new Map<Slot, Buffer>()

export async function greetRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { slot?: string } }>('/api/greet', async (req, reply) => {
    const slot: Slot = isSlot(req.query?.slot) ? req.query.slot : 'morning'
    const line = LINES[slot]

    let audio = cache.get(slot)
    if (!audio) {
      try {
        const r = await synthesize(line, 'en-US')
        if (!r.ok) return reply.code(r.status).send({ error: r.error })
        audio = r.audio
        cache.set(slot, audio)
      } catch (err) {
        // synthesize poate arunca (token/fetch/json) — pe ruta publică nu lăsăm
        // să devină 500 necaptat; răspundem curat 502.
        app.log.error(err)
        return reply.code(502).send({ error: 'greet_failed' })
      }
    }

    // The client needs the EXACT spoken text to drive the mouth — return it in a
    // header so there is a single source of truth (no drift between the two).
    reply.header('X-Greet-Text', line)
    reply.header('Content-Type', 'audio/mpeg')
    // Canned + stable → let the browser and edge cache it hard.
    reply.header('Cache-Control', 'public, max-age=86400')
    return reply.send(audio)
  })
}
