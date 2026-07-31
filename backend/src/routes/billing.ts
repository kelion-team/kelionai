import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import { getWalletStatus, listTransactionsForUser, creeazaCodPlata, codPlataInAsteptare } from '../db.js'

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // The customer sees CREDITS (1 credit = config.billing.creditValue) and the %
  // of the last top-up still left, for the escalating low-credit alerts.
  app.get('/api/billing/balance', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const { balance, topupRef } = await getWalletStatus(user.email)
    const credits = Math.floor(balance / config.billing.creditValue)
    const percent = topupRef > 0 ? Math.max(0, Math.min(100, (balance / topupRef) * 100)) : 100
    // firstTopUp = userul n-a alimentat niciodată (topup_ref e 0). Prima alimentare
    // e mai mare (activarea creierului = £20 minim); apoi orice multiplu de £5.
    return reply.send({ credits, percent, currency: config.billing.currency, firstTopUp: topupRef <= 0 })
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

  // ── PLATA TRECE PE REVOLUT (Adrian, 30 iul: „Stripe se scoate total și intră
  // Pro", „link să înlocuim peste tot") ───────────────────────────────────────
  //
  // Ruta ăsta rămâne INTACTĂ ca formă (`{ url }`), fiindcă prin ea trec TOATE
  // locurile în care se plătește: pastila de portofel, pagina /credite și
  // paywall-ul din chat. Schimbând sursa URL-ului aici, se schimbă în toate trei
  // deodată — „peste tot" cu o singură modificare, nu trei locuri de ținut minte.
  //
  // ── COD UNIC PE FIECARE PLATĂ (Adrian, 30 iul) ──────────────────────────────
  // „fiecare plată trebuie să fie însoțită de un cod unic" · „userul X cumpără
  // credit de atâția bani, tranzacția are un cod alocat unic generat, la plată
  // se trece automat la ce cod/client".
  //
  // Revolut Pro n-are webhook, deci nimeni nu ne anunță că s-a plătit. Codul e
  // puntea: pleacă cu omul la plată, se întoarce în referința tranzacției, iar
  // cititorul de tranzacții îl potrivește înapoi cu contul lui. Fără cod ar
  // rămâne gestiunea manuală — exact ce a refuzat, pe bună dreptate.
  //
  // De ce COD și nu suma cu bănuți unici (prima mea idee): suma poate fi fixată
  // de link și poate fi schimbată de comision până ajunge în cont. Codul trece
  // neatins prin amândouă.
  app.post<{ Body: { amount?: number } }>('/api/billing/checkout', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const link = config.revolut.payLink
    // Fără link configurat NU trimitem userul nicăieri și nu tăcem: butonul
    // spune ce lipsește (regula nr. 1 — un eșec nu se afișează ca reușită).
    if (!link) return reply.code(503).send({ error: 'revolut_link_lipsa' })
    const amount = Number(req.body?.amount ?? 0)
    const bad = await validateTopUp(user.email, amount)
    if (bad) return reply.code(400).send({ error: bad })
    // REFOLOSIM un cod încă nefolosit (2 ore) în loc să dăm unul nou la fiecare
    // apăsare: altfel omul care apasă de trei ori ar avea trei coduri valabile
    // și n-ar ști pe care să-l scrie.
    const existent = await codPlataInAsteptare(user.email)
    const cod = existent?.amount === amount ? existent : await creeazaCodPlata(user.email, amount, config.billing.currency)
    if (!cod) return reply.code(503).send({ error: 'cod_indisponibil' })
    return reply.send({ url: link, code: cod.code, amount: cod.amount, currency: cod.currency })
  })

  // AICI A STAT `/api/billing/payment-intent` — a doua cale de plată, pe Stripe.js
  // direct. Scoasă odată cu Stripe: nimic din frontend n-o mai chema (singurul
  // drum al userului trece prin `/api/billing/checkout`), iar o rută de plată
  // vie pe care n-o folosește nimeni e o ușă lăsată deschisă degeaba.

  // ORDIN #6G: user purchase history from the transactions table.
  app.get('/api/billing/history', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ error: 'unauthorized' })
    const history = await listTransactionsForUser(user.email, 50)
    return reply.send({ history })
  })
}
