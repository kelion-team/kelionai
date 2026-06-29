import type { FastifyInstance } from 'fastify'
import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'

// Google Cloud Text-to-Speech — Chirp 3 HD (male, academic). Returns MP3 audio.
// Auth: service-account JSON (preferred — what the backup provides) via an OAuth
// access token, or a plain API key. When neither is configured, replies 503 so
// the frontend falls back to the browser voice. (Speech is Google-only per spec;
// no ElevenLabs.)

const TTS_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

let auth: GoogleAuth | null = null
function getAuth(): GoogleAuth | null {
  if (!config.googleServiceAccountJson) return null
  if (!auth) {
    auth = new GoogleAuth({
      credentials: JSON.parse(config.googleServiceAccountJson) as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return auth
}

export async function ttsRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { text?: string; lang?: string } }>('/api/tts', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    const a = getAuth()
    if (!a && !config.googleTtsKey) {
      return reply.code(503).send({ error: 'tts_not_configured' })
    }

    const text = req.body?.text?.trim()
    if (!text) return reply.code(400).send({ error: 'bad_request' })
    const lang = (req.body?.lang ?? 'en').toLowerCase().startsWith('ro') ? 'ro-RO' : 'en-US'
    const voiceName = `${lang}-Chirp3-HD-${config.ttsVoiceStyle}`

    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      let url = TTS_URL
      if (a) {
        const token = await a.getAccessToken()
        if (!token) return reply.code(502).send({ error: 'tts_auth_failed' })
        headers.Authorization = `Bearer ${token}`
      } else {
        url = `${TTS_URL}?key=${config.googleTtsKey}`
      }

      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          input: { text },
          voice: { languageCode: lang, name: voiceName },
          audioConfig: { audioEncoding: 'MP3' },
        }),
      })
      if (!res.ok) {
        app.log.warn({ status: res.status, detail: await res.text() }, 'google tts failed')
        return reply.code(502).send({ error: 'tts_failed' })
      }
      const j = (await res.json()) as { audioContent?: string }
      if (!j.audioContent) return reply.code(502).send({ error: 'tts_empty' })
      reply.header('Content-Type', 'audio/mpeg')
      reply.header('Cache-Control', 'no-store')
      return reply.send(Buffer.from(j.audioContent, 'base64'))
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'tts_failed' })
    }
  })
}
