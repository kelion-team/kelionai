import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { saveKv, loadKv, userKey } from '../db.js'
import { config } from '../config.js'
import { resolveModel, type ModelTier } from '../services/brainContract.js'

// ── SELECTABLE MODELS — GEMINI-ONLY (extirparea OpenRouter, 3 aug) ──────────
// Catalogul viu OpenRouter a dispărut odată cu furnizorul. Ce rămâne e lista
// FIXĂ a treptelor Gemini (config.brain) — adevărată, nu simulată — plus
// selecția per-user (KV), validată acum doar pe google-direct/*.
// GET  /api/models/catalog   → treptele Gemini (chat + work)
// GET  /api/models/selection → which models the user has chosen now (chat + work)
// PUT  /api/models/selection → saves the user's choice (validated: google-direct/* only)

const KEY = (email: string): string => `model_choice:${userKey(email)}`

interface Selection {
  chat: string
  work: string
}

// Forma pe care frontend-ul (CustomerSettings, selector ascuns) o știe deja:
// id/name/provider/vision. Toate treptele Gemini văd nativ.
function geminiCatalog(): { chat: { id: string; name: string; provider: string; vision: boolean }[]; work: { id: string; name: string; provider: string; vision: boolean }[] } {
  const intrare = (id: string): { id: string; name: string; provider: string; vision: boolean } => ({
    id,
    name: id.replace('google-direct/', ''),
    provider: 'google',
    vision: true,
  })
  const chat = [...new Set([config.brain.chatDefault])].map(intrare)
  const work = [...new Set([config.brain.workDefault, config.brain.topDefault])].map(intrare)
  return { chat, work }
}

async function readSelection(email: string): Promise<Selection> {
  let chat: string | null = null
  let work: string | null = null
  try {
    const raw = await loadKv(KEY(email))
    if (raw) {
      const p = JSON.parse(raw) as Partial<Selection>
      chat = typeof p.chat === 'string' ? p.chat : null
      work = typeof p.work === 'string' ? p.work : null
    }
  } catch {
    /* fall back to the default */
  }
  // Validare Gemini-only: o alegere veche (id OpenRouter rămas în KV) cade pe
  // defaultul treptei — nu mai există alt furnizor care s-o servească.
  return {
    chat: await resolveModel('chat', chat),
    work: await resolveModel('work', work),
  }
}

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/models/catalog', async (_req, reply) => {
    return reply.send(geminiCatalog())
  })

  app.get('/api/models/selection', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(await readSelection(user.email))
  })

  app.put<{ Body: { tier?: ModelTier; model?: string } }>(
    '/api/models/selection',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const tier = req.body?.tier
      const model = String(req.body?.model ?? '').trim()
      if ((tier !== 'chat' && tier !== 'work') || !model) {
        return reply.code(400).send({ error: 'bad_request' })
      }
      // We only accept a model that exists in the requested tier (otherwise garbage would be saved).
      const resolved = await resolveModel(tier, model)
      if (resolved !== model) return reply.code(400).send({ error: 'model_not_in_tier' })

      const current = await readSelection(user.email)
      const next: Selection = { ...current, [tier]: model }
      await saveKv(KEY(user.email), JSON.stringify(next))
      return reply.send(next)
    },
  )
}
