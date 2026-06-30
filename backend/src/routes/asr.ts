import type { FastifyInstance } from 'fastify'
import { GoogleAuth } from 'google-auth-library'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { recordCost } from '../db.js'
import { ASR_USD_PER_CALL } from '../services/cost.js'

// Audio language identification + transcription via Google Cloud Speech-to-Text
// v2 (chirp_2, automatic language detection). This is what lets Kelion detect
// the spoken language FROM THE AUDIO itself — e.g. a Chinese speaker on an
// English browser — which text-based detection can't do (the browser recognizer
// would mis-transcribe first). The detected language then drives the browser
// recognizer + Chirp voice. Speech is Google-only per spec.

let auth: GoogleAuth | null = null
let projectId = ''
function getAuth(): GoogleAuth | null {
  if (!config.googleServiceAccountJson) return null
  if (!auth) {
    const creds = JSON.parse(config.googleServiceAccountJson) as { project_id?: string }
    projectId = creds.project_id ?? ''
    auth = new GoogleAuth({
      credentials: creds as Record<string, unknown>,
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    })
  }
  return auth
}

const REGION = 'us-central1'

export async function asrRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { audio?: string } }>('/api/asr', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })

    const a = getAuth()
    if (!a || !projectId) return reply.code(503).send({ error: 'asr_not_configured' })

    const audio = req.body?.audio?.trim()
    if (!audio) return reply.code(400).send({ error: 'bad_request' })

    try {
      const token = await a.getAccessToken()
      if (!token) return reply.code(502).send({ error: 'asr_auth_failed' })
      const url = `https://${REGION}-speech.googleapis.com/v2/projects/${projectId}/locations/${REGION}/recognizers/_:recognize`
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          config: { model: 'chirp_2', languageCodes: ['auto'], autoDecodingConfig: {} },
          content: audio,
        }),
      })
      if (!res.ok) {
        app.log.warn({ status: res.status, detail: await res.text() }, 'google asr failed')
        return reply.code(502).send({ error: 'asr_failed' })
      }
      const j = (await res.json()) as {
        results?: { languageCode?: string; alternatives?: { transcript?: string }[] }[]
      }
      const r0 = j.results?.find((r) => r.alternatives?.[0]?.transcript)
      void recordCost(user.email, 'asr', ASR_USD_PER_CALL)
      return reply.send({
        lang: r0?.languageCode ?? null,
        transcript: r0?.alternatives?.[0]?.transcript ?? '',
      })
    } catch (err) {
      app.log.error(err)
      return reply.code(502).send({ error: 'asr_failed' })
    }
  })
}
