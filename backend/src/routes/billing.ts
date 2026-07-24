import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getWalletStatus, topUpUser, topUpUserFromPaymentIntent, listTransactionsForUser, getAutoRecharge, setAutoRecharge } from '../db.js'
import { createCheckout, createPaymentIntent, verifyWebhook, verifyEventWithApi } from '../services/stripe.js'

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // The customer sees CREDITS (1 credit = config.stripe.creditValue) and the %
  // of the last top-up still left, for the escalating low-credit alerts.
  app.get('/api/billing/balance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const { balance, topupRef } = await getWalletStatus(user.email)
    const credits = Math.floor(balance / config.stripe.creditValue)
    const percent = topupRef > 0 ? Math.max(0, Math.min(100, (balance / topupRef) * 100)) : 100
    // firstTopUp = userul n-a alimentat niciodată (topup_ref e 0). Prima alimentare
    // e mai mare (activarea creierului = £20 minim); apoi orice multiplu de £5.
    return reply.send({ credits, percent, currency: config.stripe.currency, firstTopUp: topupRef <= 0 })
  })

  // Regula de alimentare (Adrian, 24 iul): prima alimentare = £20 minim (activarea
  // creierului), apoi orice multiplu de £5. Validată pe server, nu doar în UI.
  async function validateTopUp(email: string, amount: number): Promise<string | null> {
    if (!Number.isFinite(amount) || amount <= 0) return 'bad_amount'
    if (amount % 5 !== 0) return 'must_be_multiple_of_5'
    const { topupRef } = await getWalletStatus(email)
    const min = topupRef <= 0 ? 20 : 5
    if (amount < min) return topupRef <= 0 ? 'first_topup_min_20' : 'min_5'
    return null
  }

  // Start a top-up: returns a Stripe Checkout URL to redirect the user to.
  app.post<{ Body: { amount?: number } }>('/api/billing/checkout', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!config.stripe.secretKey) return reply.code(503).send({ error: 'stripe_not_configured' })
    const amount = Number(req.body?.amount ?? 10)
    const bad = await validateTopUp(user.email, amount)
    if (bad) return reply.code(400).send({ error: bad })
    const baseUrl = `https://${req.headers.host ?? 'kelionai.app'}`
    const result = await createCheckout(user.email, user.name ?? '', amount, baseUrl)
    if ('error' in result) return reply.code(502).send(result)
    return reply.send(result)
  })

  // ORDIN #6G: create a Stripe PaymentIntent for a direct credit top-up.
  // Returns { client_secret, payment_intent_id, amount, currency } for the
  // frontend to confirm with Stripe.js.
  app.post<{ Body: { amount?: number } }>('/api/billing/payment-intent', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (!config.stripe.secretKey) return reply.code(503).send({ error: 'stripe_not_configured' })
    const amount = Number(req.body?.amount ?? 10)
    const bad = await validateTopUp(user.email, amount)
    if (bad) return reply.code(400).send({ error: bad })
    const result = await createPaymentIntent(user.email, user.name ?? '', amount)
    if ('error' in result) return reply.code(502).send(result)
    return reply.send(result)
  })

  // Reîncărcare automată (ca userul să nu rămână fără credit). Userul o pornește,
  // își alege pragul (în credite) și suma de reîncărcare. Cardul se salvează la
  // primul checkout (setup_future_usage), apoi taxarea e off-session.
  app.get('/api/billing/autorecharge', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    return reply.send(await getAutoRecharge(user.email))
  })

  app.put<{ Body: { enabled?: boolean; threshold?: number; topupAmount?: number } }>(
    '/api/billing/autorecharge',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      const cur = await getAutoRecharge(user.email)
      const next = {
        enabled: typeof req.body?.enabled === 'boolean' ? req.body.enabled : cur.enabled,
        threshold: Number.isFinite(req.body?.threshold) ? Math.max(0, Number(req.body?.threshold)) : cur.threshold,
        topupAmount: Number.isFinite(req.body?.topupAmount)
          ? Math.max(1, Math.min(500, Number(req.body?.topupAmount)))
          : cur.topupAmount,
      }
      await setAutoRecharge(user.email, next)
      return reply.send(next)
    },
  )

  // ORDIN #6G: user purchase history from the transactions table.
  app.get('/api/billing/history', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const history = await listTransactionsForUser(user.email, 50)
    return reply.send({ history })
  })

  // Shared webhook handler for Stripe events.
  async function handleStripeWebhook(
    req: FastifyRequest & { rawBody?: string },
    reply: FastifyReply,
  ): Promise<void> {
    const sig = (req.headers['stripe-signature'] as string | undefined) ?? ''
    const event = verifyWebhook(req.rawBody ?? '', sig)
    if (!event) {
      // FALLBACK SECURIZAT (STRIPE_WEBHOOK_SECRET lipsă pe VPS → plățile nu se
      // creditau): re-verificăm evenimentul direct la Stripe cu cheia secretă și
      // creditam DOAR dacă Stripe confirmă că e plătit. Bani reali, niciodată
      // pierduți; niciodată creditare oarbă pe un payload nesemnat.
      const v = await verifyEventWithApi(req.rawBody ?? '')
      if (v) {
        await topUpUser(v.email, v.amount, v.currency, v.ref)
        reply.code(200).send({ received: true, via: 'api_verify' })
        return
      }
      reply.code(400).send({ error: 'bad_signature' })
      return
    }

    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as {
        id?: string
        amount_total?: number
        currency?: string
        metadata?: { email?: string }
        customer_details?: { email?: string }
        payment_intent?: string
      }
      const email = s.metadata?.email ?? s.customer_details?.email ?? ''
      const amount = (s.amount_total ?? 0) / 100
      if (email && amount > 0) {
        // Prefer to credit via the unified PaymentIntent path when the PI id is
        // present; otherwise fall back to the legacy top-up path.
        if (s.payment_intent) {
          await topUpUserFromPaymentIntent(email, amount, s.currency ?? config.stripe.currency, s.payment_intent)
        } else {
          await topUpUser(email, amount, s.currency ?? config.stripe.currency, s.id ?? '')
        }
      }
    }

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as {
        id?: string
        amount?: number
        currency?: string
        metadata?: { email?: string }
        charges?: { data?: { billing_details?: { email?: string } }[] }
        receipt_email?: string
      }
      const email =
        pi.metadata?.email ??
        pi.charges?.data?.[0]?.billing_details?.email ??
        pi.receipt_email ??
        ''
      const amount = (pi.amount ?? 0) / 100
      if (email && pi.id && amount > 0) {
        await topUpUserFromPaymentIntent(email, amount, pi.currency ?? config.stripe.currency, pi.id)
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as { id?: string; metadata?: { email?: string } }
      if (pi.id) {
        // Optionally mark the transaction as failed; if no row exists, it's a no-op.
        const { updateTransactionStatus } = await import('../db.js')
        await updateTransactionStatus(pi.id, 'failed')
      }
    }

    reply.code(200).send({ received: true })
  }

  // Stripe webhook — canonical path requested in ORDIN #6G.
  app.post('/api/stripe/webhook', async (req: FastifyRequest & { rawBody?: string }, reply) => {
    await handleStripeWebhook(req, reply)
  })

  // Legacy Stripe webhook path (still configured in some Stripe accounts).
  app.post('/api/credits/webhook', async (req: FastifyRequest & { rawBody?: string }, reply) => {
    await handleStripeWebhook(req, reply)
  })
}
