import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import { saveKv, loadKv, userKey } from '../db.js'
import { getCatalog, resolveModel, type ModelTier } from '../services/openrouter.js'

// ── SELECTABLE MODELS — live catalog + the per-user selection ───────────────
// GET  /api/models/catalog   → the selectable models, grouped by tier (auto-update)
// GET  /api/models/selection → which models the user has chosen now (chat + work)
// PUT  /api/models/selection → saves the user's choice (validated on the catalog)
// The selection is persisted in KV (no new schema), like the avatar layout.

const KEY = (email: string): string => `model_choice:${userKey(email)}`

interface Selection {
  chat: string
  work: string
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
  // We validate on the catalog: if the saved model no longer exists, it falls back to the default.
  return {
    chat: await resolveModel('chat', chat),
    work: await resolveModel('work', work),
  }
}

export async function modelRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/models/catalog', async (_req, reply) => {
    const cat = await getCatalog()
    return reply.send({ chat: cat.chat, work: cat.work })
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
