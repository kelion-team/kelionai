import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { citestePortofel, listTransactionsForUser, creeazaCodPlata, codPlataInAsteptare, getAutoRecharge, setAutoRecharge, type AutoRechargePrefs } from '../db.js'

// AUTO TOP-UP validation — pure, so the rule is testable without a database.
// The checkbox means: "when my credit drops below the threshold, PREPARE my
// top-up automatically" (the Revolut link cannot pull money by itself — the
// user always confirms the actual payment with one tap). The amount obeys the
// same rule as any top-up: the owner's settings from config.billing
// (multiple of topupStep, between topupMin and topupMax).
// The threshold's 100,000-credit cap is a SANITY BOUND against absurd input,
// not a money value ever shown to anyone.
export function validateAutoRecharge(input: unknown): AutoRechargePrefs | null {
  const b = input as { enabled?: unknown; threshold?: unknown; topupAmount?: unknown } | null
  if (!b || typeof b !== 'object') return null
  const threshold = Math.floor(Number(b.threshold))
  const topupAmount = Math.floor(Number(b.topupAmount))
  const { topupMin, topupMax, topupStep } = config.billing
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100_000) return null
  if (!Number.isFinite(topupAmount) || topupAmount < topupMin || topupAmount > topupMax || topupAmount % topupStep !== 0) return null
  return { enabled: !!b.enabled, threshold, topupAmount }
}

// THE TOP-UP RULE (Adrian, 24 Jul): first top-up = £20 minimum (brain
// activation), then any multiple of £5. The numbers are the owner's settings
// (config.billing), validated on the server, not just in the UI. Exported so
// the rule is testable without booting a server.
export async function validateTopUp(citestePortofelFn: typeof citestePortofel, email: string, amount: number): Promise<string | null> {
  const { firstTopupMin, topupMin, topupStep } = config.billing
  if (!Number.isFinite(amount) || amount <= 0) return 'bad_amount'
  if (amount % topupStep !== 0) return 'must_be_multiple_of_5'
  const portofel = await citestePortofelFn(email)
  // O ALIMENTARE NU SE VALIDEAZĂ PE UN PORTOFEL NECITIT: `topupRef` picat pe 0
  // ar fi zis „prima alimentare, minim £20" unui om care alimentase deja.
  if (!portofel.citit) return 'sold_necitit'
  const { topupRef } = portofel
  const min = topupRef <= 0 ? firstTopupMin : topupMin
  if (amount < min) return topupRef <= 0 ? 'first_topup_min_20' : 'min_5'
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
      credit: { lire: config.billing.creditValue, moneda: config.billing.currency },
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
    const portofel = await citestePortofel(user.email)
    // NU POT CITI ≠ AI 0 CREDITE (măsurat 8 aug). Câmpul `credits` LIPSEȘTE
    // când citirea a picat; clientul verifică deja `typeof j.credits === 
    // 'number'`, deci nu mai aprinde „fără credit" pe o eroare de-a noastră.
    if (!portofel.citit)
      return reply.code(503).send({ error: 'sold_necitit', motiv: portofel.motiv, currency: config.billing.currency })
    const { balance, topupRef } = portofel
    const credits = Math.floor(balance / config.billing.creditValue)
    const percent = topupRef > 0 ? Math.max(0, Math.min(100, (balance / topupRef) * 100)) : 100
    // firstTopUp = the user has never topped up (topup_ref is 0). The first
    // top-up is bigger (brain activation — config.billing.firstTopupMin);
    // then any multiple of config.billing.topupStep.
    const firstTopUp = topupRef <= 0
    // AUTO TOP-UP, DUE (Adrian, Aug 1). When the checkbox is on and the credit
    // dropped under the user's threshold, we PREPARE the payment right here:
    // the unique code exists (reused while pending, exactly like at checkout)
    // and the reply carries the link — the client shows a one-tap button. The
    // money itself moves only with the user's tap: the Revolut link cannot
    // pull from his account by itself, and we never pretend it can. The first
    // top-up stays manual (firstTopupMin — it activates the brain).
    let autoTopUp: { code: string; amount: number; currency: string; url: string } | null = null
    if (!firstTopUp && config.revolut.payLink && user.role !== 'admin') {
      const ar = await getAutoRecharge(user.email)
      if (ar.enabled && credits < ar.threshold) {
        const existent = await codPlataInAsteptare(user.email)
        const cod = existent?.amount === ar.topupAmount ? existent : await creeazaCodPlata(user.email, ar.topupAmount, config.billing.currency)
        if (cod) autoTopUp = { code: cod.code, amount: cod.amount, currency: cod.currency, url: config.revolut.payLink }
      }
    }
    return reply.send({ credits, percent, currency: config.billing.currency, firstTopUp, autoTopUp })
  })

  // THE AUTO TOP-UP CHECKBOX (Adrian, Aug 1: "auto-pay selectable with a
  // checkbox when the user pays"). The route the Settings page had been
  // calling without it existing — the checkbox used to save into the void.
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
      const prefs = validateAutoRecharge(req.body)
      if (!prefs) return reply.code(400).send({ error: 'bad_autorecharge' })
      await setAutoRecharge(user.email, prefs)
      return reply.send(prefs)
    },
  )

  // The top-up rule moved next to validateAutoRecharge (exported, top of
  // file): one place for the money rules, both testable without a server.
  const checkTopUp = (email: string, amount: number): Promise<string | null> =>
    validateTopUp(citestePortofel, email, amount)

  // ── PAYMENT GOES THROUGH REVOLUT (Adrian, 30 Jul: "Stripe goes out
  // completely and Pro comes in", "a link to replace everywhere") ───────────
  //
  // This route stays INTACT in shape (`{ url }`), because EVERY place that
  // takes payment goes through it: the wallet pill, the /credits page and the
  // chat paywall. Changing the URL's source here changes all three at once —
  // "everywhere" with a single change, not three places to remember.
  //
  // ── A UNIQUE CODE ON EVERY PAYMENT (Adrian, 30 Jul) ───────────────────────
  // "every payment must come with a unique code" · "user X buys credit worth
  // this much money, the transaction has a unique generated code assigned, at
  // payment it automatically maps to which code/client".
  //
  // Revolut Pro has no webhook, so nobody notifies us the payment happened.
  // The code is the bridge: it leaves with the person to the payment, comes
  // back in the transaction reference, and the transaction reader matches it
  // back to his account. Without the code, manual management would remain —
  // exactly what he refused, rightfully.
  //
  // Why a CODE and not an amount with unique pennies (my first idea): the
  // amount can be fixed by the link and can be changed by fees before it
  // lands. The code passes untouched through both.
  app.post<{ Body: { amount?: number } }>('/api/billing/checkout', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const link = config.revolut.payLink
    // Without a configured link we send the user NOWHERE and we don't stay
    // silent: the button says what's missing (rule no. 1 — a failure is not
    // displayed as success).
    if (!link) return reply.code(503).send({ error: 'revolut_link_lipsa' })
    const amount = Number(req.body?.amount ?? 0)
    const bad = await checkTopUp(user.email, amount)
    if (bad) return reply.code(400).send({ error: bad })
    // We REUSE an unused code (2 hours) instead of giving a new one on every
    // click: otherwise the person clicking three times would have three valid
    // codes and wouldn't know which to write.
    const existent = await codPlataInAsteptare(user.email)
    const cod = existent?.amount === amount ? existent : await creeazaCodPlata(user.email, amount, config.billing.currency)
    if (!cod) return reply.code(503).send({ error: 'cod_indisponibil' })
    return reply.send({ url: link, code: cod.code, amount: cod.amount, currency: cod.currency })
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
    return reply.send({ history })
  })
}
