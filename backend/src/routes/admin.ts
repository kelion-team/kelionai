import type { FastifyInstance } from 'fastify'
import { getSessionUser } from '../session.js'
import {
  listUsers,
  getHistory,
  getCostSummary,
  getCapabilityGaps,
  setGapResolved,
  getAdminAccount,
  loadAdminPool,
  getDemoStats,
} from '../db.js'
import { verifyKeys, verifyModels } from '../services/anthropic.js'
import { getStripeBalance } from '../services/stripe.js'

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  // List users with message counts (admin only).
  app.get('/api/admin/users', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ users: await listUsers() })
  })

  // Full chat history for one user (admin only).
  app.get<{ Querystring: { email?: string } }>('/api/admin/history', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const email = req.query.email
    if (!email) return reply.code(400).send({ error: 'bad_request', message: 'email required' })
    return reply.send({ history: await getHistory(email) })
  })

  // Live real-cost / credit monitor (admin only) — total, today, per-AI breakdown.
  app.get('/api/admin/costs', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getCostSummary())
  })

  // Capability gaps — what users asked for that Kelion can't do yet (admin only).
  app.get<{ Querystring: { all?: string } }>('/api/admin/gaps', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send({ gaps: await getCapabilityGaps(req.query.all === '1') })
  })

  // Mark a gap resolved / reopen it (admin only).
  app.post<{ Body: { id?: number; resolved?: boolean } }>('/api/admin/gaps/resolve', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const id = Number(req.body?.id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'bad_request' })
    await setGapResolved(id, req.body?.resolved !== false)
    return reply.send({ ok: true })
  })

  // The owner's REAL-money view: provider pool loaded, remaining, spent, profit
  // (admin only). This is what the admin sees instead of the users' credits.
  app.get('/api/admin/pool', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getAdminAccount())
  })

  // The owner's REAL money picture (admin only): live Stripe balance (revenue
  // held at Stripe), real provider cost consumed, real profit, and the per-AI
  // cost breakdown. No hand-typed figures.
  app.get('/api/admin/finance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const [stripe, account, costs] = await Promise.all([
      getStripeBalance(),
      getAdminAccount(),
      getCostSummary(),
    ])
    return reply.send({
      stripe,
      spent: account.spent,
      profit: account.profit,
      currency: stripe?.currency ?? 'gbp',
      byKind: costs.byKind,
    })
  })

  // Free-trial visitor analytics (admin only): where trials come from — country,
  // city, IP, total, today.
  app.get('/api/admin/demos', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await getDemoStats())
  })

  // Which brain models actually serve right now (admin only): live ping of
  // Fable 5 and the Opus 4.8 reserve.
  app.get('/api/admin/models', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyModels())
  })

  // Verify the brain's Anthropic keys live (admin only). Pings the primary and
  // reserve keys with a 1-token call; reports ok/fail per key without ever
  // exposing the key values.
  app.get('/api/admin/keys', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    return reply.send(await verifyKeys())
  })

  // Record money the owner loaded into the provider-credit pool (admin only).
  app.post<{ Body: { amount?: number } }>('/api/admin/pool', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const amount = Number(req.body?.amount)
    if (!(amount > 0)) return reply.code(400).send({ error: 'bad_request' })
    await loadAdminPool(amount)
    return reply.send(await getAdminAccount())
  })
}
