import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import {
  citestePortofel,
  citesteCrediteFolosite,
  listTransactionsForUser,
  getLowCreditReminder,
  setLowCreditReminder,
  type LowCreditReminderPrefs,
} from '../db.js'
import { minorToMajor, splitTopupMinor } from '../services/billingPolicy.js'
import { esteAdminKelion } from '../services/adminIdentity.js'
import {
  handleRevolutWebhook,
  REVOLUT_WEBHOOK_MAX_BYTES,
  startRevolutCheckout,
} from '../services/revolutMerchant.js'

// Low-credit reminder validation — pure, so the rule is testable without a
// database. It only controls a payment prompt; it never creates an order or
// pulls money. Suggested amounts obey the same server-side checkout rails.
// The threshold's 100,000-credit cap is a SANITY BOUND against absurd input,
// not a money value ever shown to anyone.
export function validateLowCreditReminder(input: unknown): LowCreditReminderPrefs | null {
  const b = input as { enabled?: unknown; thresholdMinor?: unknown; suggestedTopupMinor?: unknown } | null
  if (!b || typeof b !== 'object') return null
  const thresholdMinor = Number(b.thresholdMinor)
  const suggestedTopupMinor = Number(b.suggestedTopupMinor)
  const { topupMinMinor, topupMaxMinor, topupStepMinor } = config.billing
  if (!Number.isSafeInteger(thresholdMinor) || thresholdMinor < 0 || thresholdMinor > topupMaxMinor) return null
  if (
    !Number.isSafeInteger(suggestedTopupMinor) ||
    suggestedTopupMinor < topupMinMinor ||
    suggestedTopupMinor > topupMaxMinor ||
    suggestedTopupMinor % topupStepMinor !== 0
  ) return null
  return { enabled: b.enabled === true, thresholdMinor, suggestedTopupMinor }
}

type WalletReader = typeof citestePortofel

/** Validates the exact integer amount against the same wallet state and
 * commercial rails that the UI displays. A failed wallet read never becomes
 * "first top-up" by assumption. */
export async function validateTopUpMinor(
  readWallet: WalletReader,
  email: string,
  amountMinor: number,
): Promise<string | null> {
  const split = splitTopupMinor(amountMinor)
  if (
    !Number.isSafeInteger(amountMinor) || !split ||
    amountMinor < config.billing.topupMinMinor || amountMinor > config.billing.topupMaxMinor
  ) return 'bad_amount'
  if (amountMinor % config.billing.topupStepMinor !== 0) return 'bad_topup_increment'
  const wallet = await readWallet(email)
  if (!wallet.citit) return 'sold_necitit'
  if (wallet.topupRefMinor <= 0 && amountMinor < config.billing.firstTopupMinMinor) {
    return 'first_topup_minimum'
  }
  return null
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // ── MENIUL DE PREȚURI, PUBLIC (owner, 14 aug: „meniu de prețuri regăsite și
  // în manual… afișezi prețul cu profit cu tot") ─────────────────────────────
  // Prețurile extra-serviciilor sunt informație publică (userul le vede ÎNAINTE
  // să opteze) — fără login. Sursa e UNA (services/tarife.ts): același meniu
  // taxează, se afișează pe pagina de credite și intră în manual.
  app.get('/api/tarife', async (_req, reply) => {
    const { meniulDeTarife, lirePentru } = await import('../services/tarife.js')
    return reply.send({
      credit: {
        minor: config.billing.creditMinor,
        lire: minorToMajor(config.billing.creditMinor),
        moneda: config.billing.currency,
        minorUnit: config.billing.minorUnit,
      },
      // LEGEA ANTI-HARDCODARE (16 aug): pragurile alimentării pleacă DE AICI —
      // frontendul nu mai are voie să scrie de mână „£20"/„£5"; cifra afișată
      // e cifra care chiar validează (config.billing, reglabilă din env).
      policyVersion: config.billing.policyVersion,
      userShareBps: config.billing.userShareBps,
      marginShareBps: config.billing.marginShareBps,
      // Derived from the immutable, versioned receipt split and configured
      // credit unit; the frontend never duplicates this commercial formula.
      creditePeLira: (config.billing.userShareBps / 10_000) * (10 ** config.billing.minorUnit) / config.billing.creditMinor,
      praguri: {
        primaAlimentare: minorToMajor(config.billing.firstTopupMinMinor),
        minim: minorToMajor(config.billing.topupMinMinor),
        pas: minorToMajor(config.billing.topupStepMinor),
      },
      tarife: meniulDeTarife().map((t) => ({
        cheie: t.cheie,
        eticheta: t.eticheta,
        credite: t.credite,
        lire: lirePentru(t.cheie),
      })),
    })
  })
  // The customer sees CREDITS (1 credit = config.billing.creditValue) and the %
  // of the last top-up still left, for the escalating low-credit alerts.
  app.get('/api/billing/balance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const scutit = esteAdminKelion(user.email)
    if (scutit) {
      return reply.send({
        credits: 0,
        percent: 100,
        currency: config.billing.currency,
        firstTopUp: false,
        lowCreditPaymentPrompt: null,
        scutit: true,
        debitMinor: 0,
        creditsUsed: 0,
        minorUnit: config.billing.minorUnit,
        policyVersion: config.billing.policyVersion,
      })
    }
    const portofel = await citestePortofel(user.email)
    // NU POT CITI ≠ AI 0 CREDITE (măsurat 8 aug). Câmpul `credits` LIPSEȘTE
    // când citirea a picat; clientul verifică deja `typeof j.credits === 
    // 'number'`, deci nu mai aprinde „fără credit" pe o eroare de-a noastră.
    if (!portofel.citit)
      return reply.code(503).send({ error: 'sold_necitit', motiv: portofel.motiv, currency: config.billing.currency })
    const { balanceMinor, topupRefMinor } = portofel
    if (
      !Number.isSafeInteger(balanceMinor) || balanceMinor < 0 ||
      !Number.isSafeInteger(topupRefMinor) || topupRefMinor < 0
    ) return reply.code(503).send({ error: 'ledger_invalid', currency: config.billing.currency })
    const credits = Math.floor(balanceMinor / config.billing.creditMinor)
    const percent = topupRefMinor > 0 ? Math.max(0, Math.min(100, (balanceMinor / topupRefMinor) * 100)) : 100
    // firstTopUp = the user has never topped up (topup_ref is 0). The first
    // top-up is bigger (brain activation — config.billing.firstTopupMin);
    // then any multiple of config.billing.topupStep.
    const firstTopUp = topupRefMinor <= 0
    // The reminder only offers a checkout action. It never creates an order or
    // moves money during a balance read.
    const reminder = await getLowCreditReminder(user.email)
    const lowCreditPaymentPrompt = reminder?.enabled && balanceMinor <= reminder.thresholdMinor
      ? {
          thresholdMinor: reminder.thresholdMinor,
          suggestedTopupMinor: reminder.suggestedTopupMinor,
          currency: config.billing.currency,
          minorUnit: config.billing.minorUnit,
        }
      : null
    const usage = await citesteCrediteFolosite(user.email)
    if (!usage.citit) return reply.code(503).send({ error: 'ledger_unavailable' })
    return reply.send({
      credits,
      percent,
      currency: config.billing.currency,
      firstTopUp,
      lowCreditPaymentPrompt,
      scutit: false,
      debitMinor: config.billing.chatTurnMinor,
      creditsUsed: usage.valoare,
      minorUnit: config.billing.minorUnit,
      policyVersion: config.billing.policyVersion,
    })
  })

  // Reminder preferences never authorise or initiate a payment.
  app.get('/api/billing/low-credit-reminder', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (esteAdminKelion(user.email)) {
      return reply.send({
        enabled: false,
        thresholdMinor: 0,
        suggestedTopupMinor: 0,
        adminExempt: true,
        currency: config.billing.currency,
        minorUnit: config.billing.minorUnit,
      })
    }
    const pref = await getLowCreditReminder(user.email)
    return reply.send({ ...pref, currency: config.billing.currency, minorUnit: config.billing.minorUnit })
  })

  app.put<{ Body: { enabled?: boolean; thresholdMinor?: number; suggestedTopupMinor?: number } }>(
    '/api/billing/low-credit-reminder',
    async (req, reply) => {
      const user = getSessionUser(req)
      if (!user) return reply.code(401).send({ error: 'unauthorized' })
      if (esteAdminKelion(user.email)) return reply.code(409).send({ error: 'admin_exempt' })
      const prefs = validateLowCreditReminder(req.body)
      if (!prefs) return reply.code(400).send({ error: 'bad_low_credit_reminder' })
      if (!await setLowCreditReminder(user.email, prefs)) return reply.code(503).send({ error: 'save_unavailable' })
      return reply.send({ ...prefs, currency: config.billing.currency, minorUnit: config.billing.minorUnit })
    },
  )

  // One customer entry point, backed by a unique Hosted Checkout order. The
  // browser redirect never grants credit; only the signed webhook plus an
  // authoritative order retrieval can settle the wallet.
  app.post<{ Body: { amountMinor?: number; idempotencyKey?: string } }>(
    '/api/billing/checkout',
    { bodyLimit: 2_048, config: { rateLimit: { max: 8, timeWindow: '1 minute' } } },
    async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    if (esteAdminKelion(user.email)) {
      return reply.send({ status: 'admin_exempt', debitMinor: 0, currency: config.billing.currency, minorUnit: config.billing.minorUnit })
    }
    const amountMinor = Number(req.body?.amountMinor)
    const idempotencyKey = String(req.body?.idempotencyKey ?? '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return reply.code(400).send({ error: 'idempotency_key_invalid' })
    }
    const validationError = await validateTopUpMinor(citestePortofel, user.email, amountMinor)
    if (validationError) {
      const status = validationError === 'sold_necitit' ? 503 : 400
      return reply.code(status).send({ error: validationError })
    }
    const result = await startRevolutCheckout(user.email, amountMinor, idempotencyKey)
    if (!result.ok) return reply.code(result.statusCode).send({ error: result.error })
    return reply.code(result.status === 'paid' ? 200 : 201).send(result)
  })

  // Raw bytes are scoped to this one route so JSON parsing elsewhere remains
  // unchanged. Signature verification happens before JSON decoding.
  await app.register(async (webhookApp) => {
    webhookApp.removeContentTypeParser('application/json')
    webhookApp.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body)
    })
    webhookApp.post<{ Body: Buffer }>(
      '/api/billing/revolut/webhook',
      {
        bodyLimit: REVOLUT_WEBHOOK_MAX_BYTES,
        config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
      },
      async (req, reply) => {
        if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: 'webhook_body_invalid' })
        const result = await handleRevolutWebhook(
          req.body,
          req.headers['revolut-request-timestamp'],
          req.headers['revolut-signature'],
        )
        if (result.statusCode === 204) return reply.code(204).send()
        return reply.code(result.statusCode).send({ error: result.error ?? 'webhook_rejected' })
      },
    )
  })

  // HERE USED TO LIVE `/api/billing/payment-intent` — the second payment path,
  // through Stripe.js directly. Removed together with Stripe: nothing in the
  // frontend called it anymore (the user's only path goes through
  // `/api/billing/checkout`), and a live payment route nobody uses is a door
  // left open for nothing.

  // ORDIN #6G: user purchase history from the transactions table.
  app.get('/api/billing/history', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const history = await listTransactionsForUser(user.email, 50)
    if (!history.citit) return reply.code(503).send({ error: 'ledger_unavailable' })
    return reply.send({ history: history.valoare, minorUnit: config.billing.minorUnit })
  })
}
