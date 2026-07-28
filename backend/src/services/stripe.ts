import crypto from 'node:crypto'
import { config } from '../config.js'
import { getStripeCustomer, setStripeCustomer } from '../db.js'

// Thin Stripe client over the REST API (no SDK dependency). Handles: a customer
// per user, a Checkout Session for a credit top-up, and webhook signature
// verification (the only security-critical part — done with a timing-safe HMAC).

const API = 'https://api.stripe.com/v1'
// PLASĂ DE BLOCARE (auditul 28 iul): 14 din 20 de apeluri fetch din acest
// fișier n-aveau NICIUN timeout — dacă api.stripe.com atârnă, cereri HTTP ale
// userului (checkout, payment intent, reîncărcare automată) rămâneau agățate
// nemărginit. Un singur helper, folosit peste tot unde lipsea.
const stripeTimeout = (): AbortSignal => AbortSignal.timeout(15_000)

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.stripe.secretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }
}

async function ensureCustomer(email: string, name: string): Promise<string | null> {
  const existing = await getStripeCustomer(email)
  if (existing) return existing
  const body = new URLSearchParams({ email })
  if (name) body.set('name', name)
  const r = await fetch(`${API}/customers`, { method: 'POST', headers: authHeaders(), body, signal: stripeTimeout() })
  if (!r.ok) return null
  const j = (await r.json()) as { id?: string }
  if (!j.id) return null
  await setStripeCustomer(email, j.id)
  return j.id
}

export type CheckoutResult = { url: string } | { error: string }

// Create a one-off Checkout Session that tops the wallet up by `pounds`.
export async function createCheckout(
  email: string,
  name: string,
  pounds: number,
  baseUrl: string,
): Promise<CheckoutResult> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  const amount = Math.max(1, Math.min(500, Math.round(pounds))) // clamp £1..£500
  const customer = await ensureCustomer(email, name)
  const body = new URLSearchParams()
  body.set('mode', 'payment')
  if (customer) body.set('customer', customer)
  body.set('success_url', `${baseUrl}/?topup=success`)
  body.set('cancel_url', `${baseUrl}/?topup=cancel`)
  body.set('line_items[0][quantity]', '1')
  body.set('line_items[0][price_data][currency]', config.stripe.currency)
  body.set('line_items[0][price_data][unit_amount]', String(amount * 100))
  body.set('line_items[0][price_data][product_data][name]', 'Kelion credit')
  body.set('metadata[email]', email)
  // Emailul și pe PaymentIntent (audit 24 iul, P2-4): PI-ul NU moștenește
  // metadata sesiunii, iar fără email evenimentul payment_intent.succeeded nu
  // putea fi atribuit → 400 repetat la webhook (Stripe poate dezactiva endpointul).
  body.set('payment_intent_data[metadata][email]', email)
  // SALVEAZĂ cardul pentru reîncărcarea automată (ca userul să nu rămână fără
  // credit — cerința lui Adrian). Cardul devine metoda implicită a clientului.
  body.set('payment_intent_data[setup_future_usage]', 'off_session')
  const r = await fetch(`${API}/checkout/sessions`, { method: 'POST', headers: authHeaders(), body, signal: stripeTimeout() })
  if (!r.ok) return { error: `stripe_http_${r.status}` }
  const j = (await r.json()) as { url?: string }
  return j.url ? { url: j.url } : { error: 'no_checkout_url' }
}

// ── VÂNZARE DE CREDITE DE CĂTRE ADMIN (Adrian, 24 iul: „se vând X credite pe
// bani; butonul de credite e doar la admin") ─────────────────────────────────
// Adminul alege userul + X credite → generăm un link de plată Stripe pentru
// prețul lor. Prețul: userul primește EXACT X credite (1 credit = £0.10 din
// consum), iar la regula 75/25 prețul brut = X×0.10/0.75, rotunjit ÎN SUS la
// bănuț ca creditarea exactă să fie mereu acoperită. Metadata de pe
// PaymentIntent (email + sale_credits) spune webhook-ului/reconcilierii să
// crediteze EXACT X, nu formula procentuală (fără erori de rotunjire).
export async function createSaleCheckout(
  email: string,
  credits: number,
  baseUrl: string,
): Promise<{ url: string; pounds: number } | { error: string }> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  const c = Math.floor(credits)
  if (!(c > 0) || c > 100_000) return { error: 'bad_credits' }
  const pence = Math.ceil((c * 100 * config.stripe.creditValue) / config.stripe.userShare)
  const customer = await ensureCustomer(email, '')
  const body = new URLSearchParams()
  body.set('mode', 'payment')
  if (customer) body.set('customer', customer)
  body.set('success_url', `${baseUrl}/?topup=success`)
  body.set('cancel_url', `${baseUrl}/?topup=cancel`)
  body.set('line_items[0][quantity]', '1')
  body.set('line_items[0][price_data][currency]', config.stripe.currency)
  body.set('line_items[0][price_data][unit_amount]', String(pence))
  body.set('line_items[0][price_data][product_data][name]', `${c} Kelion credits`)
  body.set('metadata[email]', email)
  body.set('metadata[sale_credits]', String(c))
  body.set('payment_intent_data[metadata][email]', email)
  body.set('payment_intent_data[metadata][sale_credits]', String(c))
  const r = await fetch(`${API}/checkout/sessions`, { method: 'POST', headers: authHeaders(), body, signal: stripeTimeout() })
  if (!r.ok) return { error: `stripe_http_${r.status}` }
  const j = (await r.json()) as { url?: string }
  return j.url ? { url: j.url, pounds: pence / 100 } : { error: 'no_checkout_url' }
}

// ── DEPUNEREA OWNERULUI ÎN PUNGĂ, din admin (Adrian, 24 iul: „de unde din
// admin depun bani să ajungă în Stripe și din Stripe imediat în OpenRouter?")
// Checkout Stripe marcat `owner_deposit` — banii intră în punga plăților ca
// orice plată, dar NU generează credite (toate căile de creditare îl sar).
// De acolo: transferul automat orar → punga cardului → OpenAI/OpenRouter.
export async function createOwnerDeposit(
  email: string,
  pounds: number,
  baseUrl: string,
): Promise<CheckoutResult> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  const amount = Math.max(1, Math.min(2000, Math.round(pounds)))
  const body = new URLSearchParams()
  body.set('mode', 'payment')
  body.set('success_url', `${baseUrl}/?deposit=success`)
  body.set('cancel_url', `${baseUrl}/?deposit=cancel`)
  body.set('line_items[0][quantity]', '1')
  body.set('line_items[0][price_data][currency]', config.stripe.currency)
  body.set('line_items[0][price_data][unit_amount]', String(amount * 100))
  body.set('line_items[0][price_data][product_data][name]', 'Kelion pot deposit (owner)')
  body.set('metadata[email]', email)
  body.set('metadata[owner_deposit]', '1')
  body.set('payment_intent_data[metadata][email]', email)
  body.set('payment_intent_data[metadata][owner_deposit]', '1')
  const r = await fetch(`${API}/checkout/sessions`, { method: 'POST', headers: authHeaders(), body, signal: stripeTimeout() })
  if (!r.ok) return { error: `stripe_http_${r.status}` }
  const j = (await r.json()) as { url?: string }
  return j.url ? { url: j.url } : { error: 'no_checkout_url' }
}

// Metoda de plată salvată a clientului (pentru reîncărcarea automată off-session).
async function defaultPaymentMethod(customerId: string): Promise<string | null> {
  const c = await fetch(`${API}/customers/${customerId}`, { headers: authHeaders(), signal: stripeTimeout() })
  if (c.ok) {
    const j = (await c.json()) as { invoice_settings?: { default_payment_method?: string } }
    if (j.invoice_settings?.default_payment_method) return j.invoice_settings.default_payment_method
  }
  // Fallback: primul card salvat al clientului.
  const pm = await fetch(`${API}/payment_methods?customer=${customerId}&type=card&limit=1`, {
    headers: authHeaders(),
    signal: stripeTimeout(),
  })
  if (!pm.ok) return null
  const pj = (await pm.json()) as { data?: { id: string }[] }
  return pj.data?.[0]?.id ?? null
}

export type ChargeResult =
  | { ok: true; paymentIntentId: string; amount: number }
  | { ok: false; error: string }

// Taxează OFF-SESSION cardul salvat al userului (reîncărcare automată). Suma în
// aceeași unitate ca top-up-ul manual. Creditarea (75/25) o face webhookul +
// apelul idempotent din serviciul de auto-recharge.
export async function chargeSavedCard(
  email: string,
  name: string,
  pounds: number,
): Promise<ChargeResult> {
  if (!config.stripe.secretKey) return { ok: false, error: 'stripe_not_configured' }
  const amount = Math.max(1, Math.min(500, Math.round(pounds)))
  const customer = await ensureCustomer(email, name)
  if (!customer) return { ok: false, error: 'no_customer' }
  const pm = await defaultPaymentMethod(customer)
  if (!pm) return { ok: false, error: 'no_saved_card' }
  const body = new URLSearchParams()
  body.set('amount', String(amount * 100))
  body.set('currency', config.stripe.currency)
  body.set('customer', customer)
  body.set('payment_method', pm)
  body.set('off_session', 'true')
  body.set('confirm', 'true')
  body.set('metadata[email]', email)
  // ANTI DUBLĂ-DEBITARE (audit 24 iul, P1-2): Idempotency-Key per user + fereastră
  // de 10 min — dacă două procese/retry-uri cer aceeași reîncărcare aproape
  // simultan, Stripe execută UNA singură (lacătul in-memory nu supraviețuiește
  // restartului și nu există între instanțe; cheia asta da).
  const idemKey = `kelion-ar-${email.toLowerCase()}-${Math.floor(Date.now() / 600_000)}`
  const r = await fetch(`${API}/payment_intents`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': idemKey },
    body,
    signal: stripeTimeout(),
  })
  const j = (await r.json().catch(() => ({}))) as {
    id?: string
    status?: string
    error?: { message?: string }
  }
  if (!r.ok || !j.id || j.status !== 'succeeded') {
    return { ok: false, error: j.error?.message ?? `stripe_http_${r.status}` }
  }
  return { ok: true, paymentIntentId: j.id, amount }
}

// ── CIRCUITUL BANILOR, din adminul Kelionai (Adrian, 24 iul: „din platforma
// kelionai admin") ───────────────────────────────────────────────────────────
// Starea LIVE a fiecărei verigi Stripe→AI: payouts (Manual = banii rămân în
// pungă), capacitatea Issuing, cardurile virtuale existente. Ce se poate face
// prin API se face de aici (creare card); ce cere dashboard-ul (activare
// Issuing, introducerea cardului la OpenAI/OpenRouter) primește link direct.
export interface MoneyCircuit {
  payoutsInterval: string // 'manual' = corect (banii rămân în pungă)
  issuingStatus: string // 'active' | 'inactive' | 'pending' | 'unknown'
  cards: { id: string; last4: string; status: string }[]
  issuingAvailable: number // punga Issuing (bani gata de cheltuit pe card), GBP
  // Ultima încercare de alimentare AUTOMATĂ plăți→card (Balance Transfer API).
  autoFund?: { at: string; ok: boolean; detail: string } | null
  error?: string
}

export async function getMoneyCircuit(): Promise<MoneyCircuit> {
  const out: MoneyCircuit = { payoutsInterval: 'unknown', issuingStatus: 'unknown', cards: [], issuingAvailable: 0, autoFund: lastAutoFund }
  if (!config.stripe.secretKey) return { ...out, error: 'stripe_not_configured' }
  try {
    const acc = await fetch(`${API}/account`, { headers: authHeaders(), signal: AbortSignal.timeout(12_000) })
    if (acc.ok) {
      const a = (await acc.json()) as {
        settings?: { payouts?: { schedule?: { interval?: string } } }
        capabilities?: { card_issuing?: string }
      }
      out.payoutsInterval = a.settings?.payouts?.schedule?.interval ?? 'unknown'
      out.issuingStatus = a.capabilities?.card_issuing ?? 'inactive'
    } else {
      // „unknown" MUT era o minciună prin omisiune (Adrian, 26 iul: „datele de
      // aici nu sunt reale"). Verificat live: cheia din env e RESTRICȚIONATĂ
      // (rk_live_…) și /v1/account răspunde 403 more_permissions_required —
      // aplicația nu ARE VOIE să citească setările contului. Spunem exact asta
      // și ce e de făcut (Stripe Dashboard → Developers → API keys → cheia
      // restricționată → Edit → Account: Read), nu lăsăm „unknown" fără motiv.
      const body = (await acc.json().catch(() => null)) as { error?: { code?: string } } | null
      const reason =
        acc.status === 403 || body?.error?.code === 'more_permissions_required'
          ? 'fara_permisiune_cheie'
          : `http_${acc.status}`
      out.payoutsInterval = reason
      out.issuingStatus = reason
      out.error = `Stripe /v1/account: ${acc.status} (${body?.error?.code ?? 'eroare'}) — cheia restricționată nu poate citi contul; dă-i permisiunea Account:Read în Dashboard → API keys.`
    }
    const bal = await fetch(`${API}/balance`, { headers: authHeaders(), signal: AbortSignal.timeout(12_000) })
    if (bal.ok) {
      const b = (await bal.json()) as { issuing?: { available?: { amount: number }[] } }
      out.issuingAvailable = (b.issuing?.available?.[0]?.amount ?? 0) / 100
    }
    if (out.issuingStatus === 'active') {
      const cards = await fetch(`${API}/issuing/cards?limit=5&status=active`, {
        headers: authHeaders(),
        signal: AbortSignal.timeout(12_000),
      })
      if (cards.ok) {
        const c = (await cards.json()) as { data?: { id: string; last4?: string; status?: string }[] }
        out.cards = (c.data ?? []).map((x) => ({ id: x.id, last4: x.last4 ?? '????', status: x.status ?? '' }))
      }
    }
    return out
  } catch (e) {
    return { ...out, error: String(e).slice(0, 120) }
  }
}

// ── ALIMENTAREA AUTOMATĂ A PUNGII CARDULUI, ÎN PLATFORMĂ (Adrian, 24 iul:
// „tot prin Stripe, circuit unificat, nimic extern"; soluția din documentația
// oficială Stripe: Balance Transfer API — docs.stripe.com/issuing/funding/balance)
// POST /v1/balance_transfers mută banii din punga PLĂȚILOR (banii userilor) în
// punga CARDULUI (Issuing), prin API, fără nicio sursă externă. UK: decontare
// într-o zi lucrătoare. NOTĂ: endpointul e în beta la Stripe — până la aprobare
// răspunde 4xx, iar noi raportăm starea în panoul Circuitul banilor.
let lastAutoFund: { at: string; ok: boolean; detail: string } | null = null

const ISSUING_MIN = Math.max(0, Number(process.env.ISSUING_MIN_GBP ?? '10') || 10)
const ISSUING_TOPUP = Math.max(1, Number(process.env.ISSUING_TOPUP_GBP ?? '20') || 20)

// DEPUNERE AUTOMATĂ A OWNERULUI (Adrian, 24 iul: „când vede că trebuiesc bani,
// să se ducă automat"): dacă punga cardului E goală ȘI punga plăților n-are din
// ce (nici în tranzit), platforma debitează SINGURĂ cardul salvat al ownerului
// (off-session, marcat owner_deposit → FĂRĂ credite) — banii intră în punga
// plăților și circuitul curge. Max o dată/zi (Idempotency-Key pe zi), sumă din
// env OWNER_AUTODEPOSIT_GBP (implicit 20; 0 = oprit).
const OWNER_AUTODEPOSIT = Math.max(0, Number(process.env.OWNER_AUTODEPOSIT_GBP ?? '20') || 0)

async function autoOwnerDeposit(): Promise<string> {
  if (OWNER_AUTODEPOSIT <= 0) return 'auto-depunere oprită (OWNER_AUTODEPOSIT_GBP=0)'
  const email = config.adminEmail
  const customer = await ensureCustomer(email, '')
  if (!customer) return 'fără client Stripe pentru owner'
  const pm = await defaultPaymentMethod(customer)
  if (!pm) return 'ownerul nu are card salvat (o plată prin aplicație îl salvează)'
  const body = new URLSearchParams()
  body.set('amount', String(OWNER_AUTODEPOSIT * 100))
  body.set('currency', config.stripe.currency)
  body.set('customer', customer)
  body.set('payment_method', pm)
  body.set('off_session', 'true')
  body.set('confirm', 'true')
  body.set('metadata[email]', email)
  body.set('metadata[owner_deposit]', '1')
  const idemKey = `kelion-ownerdep-${new Date().toISOString().slice(0, 10)}`
  const r = await fetch(`${API}/payment_intents`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': idemKey },
    body,
    signal: stripeTimeout(),
  })
  const j = (await r.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string } }
  if (!r.ok || j.status !== 'succeeded') return `auto-depunere eșuată: ${j.error?.message ?? `http_${r.status}`}`
  return `auto-depunere owner £${OWNER_AUTODEPOSIT} reușită (${j.id}) — intră în pungă la decontare`
}

export async function autoFundIssuing(): Promise<void> {
  if (!config.stripe.secretKey) return
  try {
    // Starea reală a celor două pungi.
    const r = await fetch(`${API}/balance`, { headers: authHeaders(), signal: AbortSignal.timeout(12_000) })
    if (!r.ok) return
    const b = (await r.json()) as {
      available?: { amount: number; currency: string }[]
      pending?: { amount: number; currency: string }[]
      issuing?: { available?: { amount: number; currency: string }[] }
    }
    const cur = config.stripe.currency
    const payments = (b.available ?? []).find((a) => a.currency === cur)?.amount ?? 0
    const pendingAmt = (b.pending ?? []).find((a) => a.currency === cur)?.amount ?? 0
    const issuing = (b.issuing?.available ?? []).find((a) => a.currency === cur)?.amount ?? 0
    // Punga cardului are destul → nimic de făcut.
    if (issuing >= ISSUING_MIN * 100) return
    const want = Math.min(ISSUING_TOPUP * 100, payments)
    if (want < 100) {
      // Punga plăților GOALĂ și nimic pe drum → depunerea automată a ownerului
      // (cardul salvat, o dată/zi). Banii intră în pungă la decontare.
      if (payments + pendingAmt < ISSUING_TOPUP * 100) {
        const msg = await autoOwnerDeposit()
        lastAutoFund = { at: new Date().toISOString(), ok: /reușită/.test(msg), detail: msg }
      }
      return
    }
    const body = new URLSearchParams()
    body.set('amount', String(want))
    body.set('currency', cur)
    body.set('source_balance[type]', 'payments')
    body.set('destination_balance[type]', 'issuing')
    const t = await fetch(`${API}/balance_transfers`, {
      method: 'POST',
      headers: authHeaders(),
      body,
      signal: AbortSignal.timeout(15_000),
    })
    const j = (await t.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    lastAutoFund = {
      at: new Date().toISOString(),
      ok: t.ok && !!j.id,
      detail: t.ok && j.id ? `transferat £${(want / 100).toFixed(2)} în punga cardului (${j.id})` : j.error?.message ?? `http_${t.status}`,
    }
  } catch (e) {
    lastAutoFund = { at: new Date().toISOString(), ok: false, detail: String(e).slice(0, 120) }
  }
}

// Creează cardul virtual „Kelion AI" prin API (necesită Issuing activ):
// cardholder pe emailul adminului + card virtual GBP. Detaliile complete
// (număr/CVC) se văd în dashboardul Stripe (API-ul le dă doar cu acces PCI
// special) — întoarcem linkul direct la card.
export async function createKelionCard(adminEmail: string): Promise<
  { id: string; last4: string; url: string } | { error: string }
> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  try {
    const chBody = new URLSearchParams()
    chBody.set('name', 'Kelion AI')
    chBody.set('email', adminEmail)
    chBody.set('type', 'individual')
    chBody.set('billing[address][line1]', 'Kelionai')
    chBody.set('billing[address][city]', 'London')
    chBody.set('billing[address][postal_code]', 'EC1A 1AA')
    chBody.set('billing[address][country]', 'GB')
    const ch = await fetch(`${API}/issuing/cardholders`, { method: 'POST', headers: authHeaders(), body: chBody, signal: stripeTimeout() })
    const chJ = (await ch.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!ch.ok || !chJ.id) return { error: chJ.error?.message ?? `cardholder_http_${ch.status}` }
    const cBody = new URLSearchParams()
    cBody.set('cardholder', chJ.id)
    cBody.set('currency', config.stripe.currency)
    cBody.set('type', 'virtual')
    cBody.set('status', 'active')
    const card = await fetch(`${API}/issuing/cards`, { method: 'POST', headers: authHeaders(), body: cBody, signal: stripeTimeout() })
    const cardJ = (await card.json().catch(() => ({}))) as { id?: string; last4?: string; error?: { message?: string } }
    if (!card.ok || !cardJ.id) return { error: cardJ.error?.message ?? `card_http_${card.status}` }
    return { id: cardJ.id, last4: cardJ.last4 ?? '????', url: `https://dashboard.stripe.com/issuing/cards/${cardJ.id}` }
  } catch (e) {
    return { error: String(e).slice(0, 160) }
  }
}

// ── PAYOUT ADMIN (Adrian, 24 iul: „să scrie clar PAYOUT admin și să fie către
// cardul declarat REAL, nu cel virtual") ─────────────────────────────────────
// Payout-ul Stripe merge prin DESIGN exclusiv către contul bancar/cardul REAL
// declarat la Settings→Payouts — cardul virtual Issuing nu poate primi payout
// (șine diferite). Aici doar îl declanșăm din admin, etichetat clar: pe
// extrasul lui apare „PAYOUT ADMIN".
export async function createAdminPayout(
  pounds: number,
): Promise<{ id: string; arrival: string } | { error: string }> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  const amount = Math.round(pounds * 100)
  if (!(amount > 0)) return { error: 'bad_amount' }
  const body = new URLSearchParams()
  body.set('amount', String(amount))
  body.set('currency', config.stripe.currency)
  body.set('statement_descriptor', 'PAYOUT ADMIN')
  body.set('description', 'PAYOUT admin — profit Kelionai (către contul real declarat)')
  const r = await fetch(`${API}/payouts`, { method: 'POST', headers: authHeaders(), body, signal: stripeTimeout() })
  const j = (await r.json().catch(() => ({}))) as {
    id?: string
    arrival_date?: number
    error?: { message?: string }
  }
  if (!r.ok || !j.id) return { error: j.error?.message ?? `stripe_http_${r.status}` }
  const arrival = j.arrival_date
    ? new Date(j.arrival_date * 1000).toISOString().slice(0, 10)
    : ''
  return { id: j.id, arrival }
}

// The REAL Stripe balance (money actually held at Stripe), summed per state and
// returned in major units of the account currency. This is the owner's true
// revenue-side figure — not a hand-typed number.
export async function getStripeBalance(): Promise<{
  available: number
  pending: number
  currency: string
} | null> {
  if (!config.stripe.secretKey) return null
  const r = await fetch(`${API}/balance`, { headers: authHeaders(), signal: stripeTimeout() })
  if (!r.ok) return null
  const j = (await r.json()) as {
    available?: { amount: number; currency?: string }[]
    pending?: { amount: number; currency?: string }[]
  }
  // BUG FIX (4 iul): Stripe returns one entry PER CURRENCY. Summing them all
  // into a single figure mixed gbp+usd+eur into one meaningless number (that's
  // how the panel showed a bogus balance). Count ONLY the account currency.
  const cur = config.stripe.currency
  const sum = (arr?: { amount: number; currency?: string }[]): number =>
    (arr ?? [])
      .filter((x) => !x.currency || x.currency.toLowerCase() === cur)
      .reduce((s, x) => s + x.amount, 0) / 100
  return { available: sum(j.available), pending: sum(j.pending), currency: cur }
}

// Create a PaymentIntent for a credit top-up. The frontend confirms the payment
// with the client_secret; the backend credits the wallet on webhook.
export type PaymentIntentResult =
  | { client_secret: string; payment_intent_id: string; amount: number; currency: string }
  | { error: string }

export async function createPaymentIntent(
  email: string,
  name: string,
  pounds: number,
): Promise<PaymentIntentResult> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  const amount = Math.max(1, Math.min(500, Math.round(pounds)))
  const customer = await ensureCustomer(email, name)
  const body = new URLSearchParams()
  body.set('amount', String(amount * 100))
  body.set('currency', config.stripe.currency)
  body.set('automatic_payment_methods[enabled]', 'true')
  if (customer) body.set('customer', customer)
  body.set('metadata[email]', email)
  const r = await fetch(`${API}/payment_intents`, { method: 'POST', headers: authHeaders(), body, signal: stripeTimeout() })
  if (!r.ok) return { error: `stripe_http_${r.status}` }
  const j = (await r.json()) as { id?: string; client_secret?: string }
  if (!j.id || !j.client_secret) return { error: 'no_payment_intent' }
  return {
    client_secret: j.client_secret,
    payment_intent_id: j.id,
    amount,
    currency: config.stripe.currency,
  }
}

export interface StripeEvent {
  type: string
  data: { object: Record<string, unknown> }
}

// Verify a webhook payload against the signing secret (Stripe's scheme:
// HMAC-SHA256 over `${timestamp}.${rawBody}`, timing-safe compare, 5-min window).
export function verifyWebhook(raw: string, sigHeader: string): StripeEvent | null {
  const secret = config.stripe.webhookSecret
  if (!secret || !sigHeader || !raw) return null
  const parts: Record<string, string> = {}
  for (const kv of sigHeader.split(',')) {
    const i = kv.indexOf('=')
    if (i > 0) parts[kv.slice(0, i)] = kv.slice(i + 1)
  }
  const t = parts.t
  const v1 = parts.v1
  if (!t || !v1) return null
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return null
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  const a = Buffer.from(expected)
  const b = Buffer.from(v1)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    return JSON.parse(raw) as StripeEvent
  } catch {
    return null
  }
}

// ── VERIFICARE FĂRĂ SECRET DE WEBHOOK (fallback securizat) ───────────────────
// Dacă STRIPE_WEBHOOK_SECRET lipsește (cazul VPS-ului → plățile nu se creditau,
// Adrian a plătit £20 și n-a apărut), NU putem valida semnătura. În loc să
// respingem (bani pierduți) SAU să creditam orbește (gaură de securitate), luăm
// evenimentul (id + tip) și RE-INTEROGĂM Stripe cu cheia noastră SECRETĂ: doar
// dacă Stripe confirmă că obiectul e REAL și PLĂTIT, creditam. Sursa de adevăr
// e API-ul Stripe autentificat, nu payload-ul webhook.
export type VerifiedTopup = {
  email: string
  amount: number
  currency: string
  ref: string
  // Vânzare admin: numărul EXACT de credite vândute (metadata sale_credits).
  saleCredits?: number
} | null

// PLĂȚILE RAMBURSATE NU SE CREDITEAZĂ (incident real 24 iul: plata de £25 din
// iunie fusese RAMBURSATĂ integral pe card, dar plasa a creditat-o — „bani"
// care nu mai existau). Întrebăm Stripe dacă există vreun refund pe PI.
export async function hasRefund(paymentIntentId: string): Promise<boolean> {
  if (!config.stripe.secretKey || !paymentIntentId.startsWith('pi_')) return false
  try {
    const r = await fetch(`${API}/refunds?payment_intent=${paymentIntentId}&limit=1`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!r.ok) return false
    const j = (await r.json()) as { data?: unknown[] }
    return (j.data?.length ?? 0) > 0
  } catch {
    return false
  }
}

export async function verifyEventWithApi(raw: string): Promise<VerifiedTopup> {
  let ev: StripeEvent
  try {
    ev = JSON.parse(raw) as StripeEvent
  } catch {
    return null
  }
  if (!config.stripe.secretKey) return null
  const obj = ev.data?.object as Record<string, unknown> | undefined
  const id = String(obj?.id ?? '')
  if (!id) return null

  async function getJson(path: string): Promise<Record<string, unknown> | null> {
    try {
      const r = await fetch(`${API}/${path}`, { headers: authHeaders(), signal: stripeTimeout() })
      if (!r.ok) return null
      return (await r.json()) as Record<string, unknown>
    } catch {
      return null
    }
  }

  if (ev.type === 'checkout.session.completed' && id.startsWith('cs_')) {
    const s = await getJson(`checkout/sessions/${id}`)
    if (!s || s.payment_status !== 'paid') return null
    // Depunerea ownerului: bani în pungă, fără credite.
    if ((s.metadata as { owner_deposit?: string } | undefined)?.owner_deposit === '1') return null
    const email =
      (s.metadata as { email?: string } | undefined)?.email ??
      (s.customer_details as { email?: string } | undefined)?.email ??
      ''
    const amount = Number(s.amount_total ?? 0) / 100
    // FĂRĂ fallback pe cs_ (audit 27 iul): aceeași plată cheiată o dată pe
    // cs_… și apoi pe pi_… trecea de dedup DE DOUĂ ORI (calea semnată a scos
    // fallback-ul încă din iulie — asta rămăsese). Fără payment_intent → nu
    // creditați aici; reconcilierea o prinde pe cheia pi_ corectă.
    if (!s.payment_intent) return null
    const ref = String(s.payment_intent)
    if (!email || !(amount > 0)) return null
    if (await hasRefund(ref)) return null // rambursată → NU se creditează
    const saleCredits = Number((s.metadata as { sale_credits?: string } | undefined)?.sale_credits ?? 0)
    return { email, amount, currency: String(s.currency ?? config.stripe.currency), ref, saleCredits }
  }

  if (ev.type === 'payment_intent.succeeded' && id.startsWith('pi_')) {
    const pi = await getJson(`payment_intents/${id}`)
    if (!pi || pi.status !== 'succeeded') return null
    // Depunerea ownerului: bani în pungă, fără credite.
    if ((pi.metadata as { owner_deposit?: string } | undefined)?.owner_deposit === '1') return null
    const email = (pi.metadata as { email?: string } | undefined)?.email ?? String(pi.receipt_email ?? '')
    const amount = Number(pi.amount ?? 0) / 100
    if (!email || !(amount > 0)) return null
    if (await hasRefund(id)) return null // rambursată → NU se creditează
    const saleCredits = Number((pi.metadata as { sale_credits?: string } | undefined)?.sale_credits ?? 0)
    return { email, amount, currency: String(pi.currency ?? config.stripe.currency), ref: id, saleCredits }
  }

  return null
}
