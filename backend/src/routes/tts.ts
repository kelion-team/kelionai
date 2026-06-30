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

// Default region per language for 2-letter shorthand (the frontend normally
// sends a full BCP-47 tag; this is a safety net).
const DEFAULT_REGION: Record<string, string> = {
  en: 'US', ro: 'RO', fr: 'FR', de: 'DE', es: 'ES', it: 'IT', pt: 'BR', nl: 'NL',
  pl: 'PL', ru: 'RU', uk: 'UA', tr: 'TR', ar: 'XA', hi: 'IN', ja: 'JP', ko: 'KR',
  zh: 'CN', sv: 'SE', da: 'DK', nb: 'NO', fi: 'FI', cs: 'CZ', el: 'GR', hu: 'HU',
  id: 'ID', th: 'TH', vi: 'VN',
}

// Normalise a locale to a BCP-47 `ll-RR` tag (e.g. "ro" → "ro-RO", "fr-fr" →
// "fr-FR"). Falls back to en-US for anything malformed.
function normalizeLang(raw: string | undefined): string {
  const s = (raw ?? '').trim()
  const m = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/i.exec(s)
  if (!m) return 'en-US'
  const lng = m[1].toLowerCase()
  const region = (m[2]?.toUpperCase() ?? DEFAULT_REGION[lng] ?? lng.toUpperCase())
  return `${lng}-${region}`
}

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
    // Accept any BCP-47 language so Kelion can speak every language Chirp 3 HD
    // supports. Normalise "ro" → "ro-RO", "fr-fr" → "fr-FR"; default en-US.
    const lang = normalizeLang(req.body?.lang)
    // A valid Chirp 3 HD style is a single capitalised name (e.g. Charon). Guard
    // against legacy/invalid values (e.g. "chirp_3") that would make Google
    // reject the voice → robotic browser fallback. Fall back to the spec voice.
    const style = /^[A-Z][a-z]+$/.test(config.ttsVoiceStyle) ? config.ttsVoiceStyle : 'Charon'
    const voiceName = `${lang}-Chirp3-HD-${style}`

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
