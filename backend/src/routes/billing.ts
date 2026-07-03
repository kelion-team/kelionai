import type { FastifyInstance, FastifyRequest } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getWalletStatus, topUpUser } from '../db.js'
import { createCheckout, verifyWebhook } from '../services/stripe.js'

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // The customer sees CREDITS (1 credit = config.stripe.creditValue) and the %
  // of the last top-up still left, for the escalating low-credit alerts.
  app.get('/api/billing/balance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const { balance, topupRef } = await getWalletStatus(user.email)
    const credits = Math.floor(balance / config.stripe.creditValue)
    const percent = topupRef > 0 ? Math.max(0, Math.min(100, (balance / topupRef) * 100)) : 100
    return reply.send({ credits, percent, currency: config.stripe.currency })
  })

  // Start a top-up: returns a Stripe Checkout URL to redirect the user to.
  app.post<{ Body: { amount?: number } }>('/api/billing/checkout', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!config.stripe.secretKey) return reply.code(503).send({ error: 'stripe_not_configured' })
    const amount = Number(req.body?.amount ?? 10)
    const baseUrl = `https://${req.headers.host ?? 'kelionai.app'}`
    const result = await createCheckout(user.email, user.name ?? '', amount, baseUrl)
    if ('error' in result) return reply.code(502).send(result)
    return reply.send(result)
  })

  // Stripe webhook — credits the wallet when a top-up completes. Path matches the
  // endpoint already configured in the Stripe account (/api/credits/webhook), so
  // its existing signing secret works. Uses the raw body (stashed by the
  // content-type parser) for signature verification.
  app.post('/api/credits/webhook', async (req: FastifyRequest & { rawBody?: string }, reply) => {
    const sig = (req.headers['stripe-signature'] as string | undefined) ?? ''
    const event = verifyWebhook(req.rawBody ?? '', sig)
    if (!event) return reply.code(400).send({ error: 'bad_signature' })
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as {
        id?: string
        amount_total?: number
        currency?: string
        metadata?: { email?: string }
        customer_details?: { email?: string }
      }
      const email = s.metadata?.email ?? s.customer_details?.email ?? ''
      const amount = (s.amount_total ?? 0) / 100
      if (email && amount > 0) {
        // 75% becomes the user's spendable credit, 25% is our profit.
        await topUpUser(email, amount, s.currency ?? config.stripe.currency, s.id ?? '')
      }
    }
    return reply.code(200).send({ received: true })
  })
}
