import crypto from 'node:crypto'
// CONTRACTUL HTTP, o singură declarație (Lotul A) — vezi src/shared/api-types.ts.
import type { MoneyCircuit, ExpenseLine, StripeProbe } from '../shared/api-types.js'
export type { MoneyCircuit }
import { config } from '../config.js'
import { getStripeCustomer, setStripeCustomer, countWalletUsers, getCostSummary } from '../db.js'
import { stareFurnizori } from './cardFurnizor.js'

// Thin Stripe client over the REST API (no SDK dependency). Handles: a customer
// per user, a Checkout Session for a credit top-up, and webhook signature
// verification (the only security-critical part — done with a timing-safe HMAC).

const API = 'https://api.stripe.com/v1'

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
  const r = await fetch(`${API}/customers`, { method: 'POST', headers: authHeaders(), body })
  if (!r.ok) return null
  const j = (await r.json()) as { id?: string }
  if (!j.id) return null
  await setStripeCustomer(email, j.id)
  return j.id
}

// ── SURSE UNICE pentru corpurile Stripe repetate (unic, fără duplicate) ───────
// Calea banilor: comportament IDENTIC — doar mutat. Cele 3 fluxuri de Checkout
// (top-up, vânzare admin, depunere owner) și cele 2 taxări off-session (reîncărcare
// user, auto-depunere owner) aveau corpul + apelul copiate; aici o singură dată.

// Corpul comun al unei sesiuni Checkout: mod plată, clientul (opțional), URL-urile
// de retur și UN singur line_item cu preț ad-hoc. Suma/denumirea/metadata le pun
// apelanții după (ordinea parametrilor rămâne identică cu înainte).
function checkoutBody(
  baseUrl: string,
  customer: string | null,
  unitAmountPence: number,
  productName: string,
  returnTag: 'topup' | 'deposit',
): URLSearchParams {
  const body = new URLSearchParams()
  body.set('mode', 'payment')
  if (customer) body.set('customer', customer)
  body.set('success_url', `${baseUrl}/?${returnTag}=success`)
  body.set('cancel_url', `${baseUrl}/?${returnTag}=cancel`)
  body.set('line_items[0][quantity]', '1')
  body.set('line_items[0][price_data][currency]', config.stripe.currency)
  body.set('line_items[0][price_data][unit_amount]', String(unitAmountPence))
  body.set('line_items[0][price_data][product_data][name]', productName)
  return body
}

// Postează sesiunea Checkout și extrage URL-ul (sau eroarea). Apelantul care are
// nevoie și de altceva (ex. vânzarea admin întoarce și lirele) adaugă peste.
async function postCheckout(body: URLSearchParams): Promise<CheckoutResult> {
  const r = await fetch(`${API}/checkout/sessions`, { method: 'POST', headers: authHeaders(), body })
  if (!r.ok) return { error: `stripe_http_${r.status}` }
  const j = (await r.json()) as { url?: string }
  return j.url ? { url: j.url } : { error: 'no_checkout_url' }
}

// Taxare OFF-SESSION a cardului salvat (PaymentIntent confirmat imediat, cu
// Idempotency-Key anti dublă-debitare). Corpul + apelul sunt comuni pentru
// reîncărcarea userului și auto-depunerea ownerului; `extraMeta` adaugă marcajele
// specifice (ex. owner_deposit). Cheia de idempotență o dă apelantul (format diferit).
async function offSessionCharge(
  customer: string,
  pm: string,
  amountPence: number,
  email: string,
  idemKey: string,
  extraMeta?: Record<string, string>,
): Promise<{ ok: boolean; status: number; id?: string; piStatus?: string; error?: string }> {
  const body = new URLSearchParams()
  body.set('amount', String(amountPence))
  body.set('currency', config.stripe.currency)
  body.set('customer', customer)
  body.set('payment_method', pm)
  body.set('off_session', 'true')
  body.set('confirm', 'true')
  body.set('metadata[email]', email)
  for (const [k, v] of Object.entries(extraMeta ?? {})) body.set(`metadata[${k}]`, v)
  const r = await fetch(`${API}/payment_intents`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Idempotency-Key': idemKey },
    body,
  })
  const j = (await r.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string } }
  return { ok: r.ok, status: r.status, id: j.id, piStatus: j.status, error: j.error?.message }
}

export type CheckoutResult = { url: string } | { error: string }

// AICI A STAT `createCheckout` — sesiunea Stripe prin care userul isi alimenta
// portofelul. Scoasa pe 30 iul, cand Adrian a mutat incasarea pe Revolut Pro:
// „Stripe se scoate total si intra Pro". Drumul userului trece acum prin
// `/api/billing/checkout`, care intoarce linkul de plata Revolut din config.

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
  const body = checkoutBody(baseUrl, customer, pence, `${c} Kelion credits`, 'topup')
  body.set('metadata[email]', email)
  body.set('metadata[sale_credits]', String(c))
  body.set('payment_intent_data[metadata][email]', email)
  body.set('payment_intent_data[metadata][sale_credits]', String(c))
  const res = await postCheckout(body)
  return 'url' in res ? { url: res.url, pounds: pence / 100 } : res
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
  // Fără client atașat (depunerea ownerului nu creditează niciun user).
  const body = checkoutBody(baseUrl, null, amount * 100, 'Kelion pot deposit (owner)', 'deposit')
  body.set('metadata[email]', email)
  body.set('metadata[owner_deposit]', '1')
  body.set('payment_intent_data[metadata][email]', email)
  body.set('payment_intent_data[metadata][owner_deposit]', '1')
  return postCheckout(body)
}

// Metoda de plată salvată a clientului (pentru reîncărcarea automată off-session).
async function defaultPaymentMethod(customerId: string): Promise<string | null> {
  const c = await fetch(`${API}/customers/${customerId}`, { headers: authHeaders() })
  if (c.ok) {
    const j = (await c.json()) as { invoice_settings?: { default_payment_method?: string } }
    if (j.invoice_settings?.default_payment_method) return j.invoice_settings.default_payment_method
  }
  // Fallback: primul card salvat al clientului.
  const pm = await fetch(`${API}/payment_methods?customer=${customerId}&type=card&limit=1`, {
    headers: authHeaders(),
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
  // ANTI DUBLĂ-DEBITARE (audit 24 iul, P1-2): Idempotency-Key per user + fereastră
  // de 10 min — dacă două procese/retry-uri cer aceeași reîncărcare aproape
  // simultan, Stripe execută UNA singură (lacătul in-memory nu supraviețuiește
  // restartului și nu există între instanțe; cheia asta da).
  const idemKey = `kelion-ar-${email.toLowerCase()}-${Math.floor(Date.now() / 600_000)}`
  const res = await offSessionCharge(customer, pm, amount * 100, email, idemKey)
  if (!res.ok || !res.id || res.piStatus !== 'succeeded') {
    return { ok: false, error: res.error ?? `stripe_http_${res.status}` }
  }
  return { ok: true, paymentIntentId: res.id, amount }
}

// ── CIRCUITUL BANILOR, din adminul Kelionai (Adrian, 24 iul: „din platforma
// kelionai admin") ───────────────────────────────────────────────────────────
// Starea LIVE a fiecărei verigi Stripe→AI: payouts (Manual = banii rămân în
// pungă), capacitatea Issuing, cardurile virtuale existente. Ce se poate face
// prin API se face de aici (creare card); ce cere dashboard-ul (activare
// Issuing, introducerea cardului la OpenAI/OpenRouter) primește link direct.

/** TOATE cheltuielile aplicatiei, intr-un singur loc.
 *
 *  Adrian, 30 iul: „se pot pune toate cheltuielile sa fie doar din punga?"
 *  Da — cardul virtual e un card obisnuit, merge oriunde se accepta card. Dar
 *  „poate" nu e „este": fiecare furnizor trebuie sa aiba cardul pus la el, de
 *  mana, o data. Lista asta spune care sunt furnizorii si ce mai ramane de facut,
 *  ca sa se vada ce curge inca din buzunarul propriu.
 *
 *  `configured` = cheia exista in aplicatie, deci serviciul chiar e folosit.
 *  Un serviciu neconfigurat nu costa nimic. */
function expenseLines(): ExpenseLine[] {
  // CARDUL E AL LUI, NU AL APLICAȚIEI (Adrian, 30 iul: „Stripe se scoate total și
  // intră Pro"). Nu mai există card virtual Stripe din care să plătească singură
  // aplicația — fiecare furnizor se plătește cu cardul Revolut pus LA EL, de
  // mână, o dată. De-aia fiecare rând are acum linkul PAGINII LUI de facturare:
  // „link la fiecare AI, să schimb cardul" — un click, nu o căutare.
  const card = 'Cardul tau Revolut, pus la furnizor'
  const gratuit = 'Gratuit / fara factura'
  const extern = 'Platit din alta parte — pune cardul acolo'
  return [
    { name: 'OpenRouter', what: 'creierul (chat, gandire, traduceri)', configured: Boolean(config.openrouter.key), billing: card, billingUrl: 'https://openrouter.ai/settings/credits' },
    { name: 'OpenAI', what: 'vocea live (Realtime) + TTS', configured: Boolean(config.openai.key), billing: card, billingUrl: 'https://platform.openai.com/settings/organization/billing/overview' },
    { name: 'Google Gemini', what: 'creier de rezerva + vedere', configured: Boolean(config.geminiKey), billing: card, billingUrl: 'https://aistudio.google.com/app/plan_information' },
    { name: 'Google Maps', what: 'harti si trasee', configured: Boolean(config.googleMapsKey), billing: card, billingUrl: 'https://console.cloud.google.com/billing' },
    { name: 'Google TTS', what: 'voce sintetizata', configured: Boolean(config.googleTtsKey), billing: card, billingUrl: 'https://console.cloud.google.com/billing' },
    // VOCEA DE CALITATE (Chirp 3 HD) merge pe contul de serviciu Google, nu pe
    // cheia TTS simpla — deci are propriul rand si propriul link. Adrian, 30 iul:
    // „link sa schimb si la vocea noua cardul": orice furnizor care poate tine
    // vocea trebuie sa aiba drumul lui pana la facturare, nu doar cel de azi.
    { name: 'Google Chirp 3 HD', what: 'vocea de calitate (auz + voce)', configured: Boolean(config.googleServiceAccountJson), billing: card, billingUrl: 'https://console.cloud.google.com/billing' },
    { name: 'Serper', what: 'cautare web', configured: Boolean(config.serperKey), billing: card, billingUrl: 'https://serper.dev/dashboard' },
    { name: 'VPS + domeniu', what: 'gazduirea aplicatiei', configured: true, billing: extern },
    { name: 'OpenStreetMap / FOSSGIS', what: 'rutare pe harta', configured: true, billing: gratuit },
  ]
}

// ── O SINGURĂ CITIRE DE LA STRIPE, CU VERDICTUL EI ───────────────────────────
//
// Adrian, 30 iul: „partea de Stripe și cheia la AI ai zbârcit-o de tot, super
// varză". Avea dreptate, și cauza era una singură: fiecare apel către Stripe își
// trata eșecul altfel, iar panoul amesteca rezultatele.
//   • `/v1/account` pica pe permisiune → puneam motivul în `payoutsInterval` ȘI
//     în `issuingStatus` ȘI în `out.error` — trei rânduri roșii dintr-un eșec.
//   • `out.error` (setat de account) făcea ca punga să arate „Card virtual — nu
//     răspunde", deși `/v1/balance` răspunsese perfect. Eroarea unei citiri
//     otrăvea altă citire.
//   • `issuingAvailable` pornea de la 0 și rămânea 0 când cererea pica — deci
//     „n-am putut citi" arăta identic cu „ai zero lire".
//
// Acum: FIECARE întrebare se pune prin funcția asta, își notează singură
// verdictul, și niciun eșec nu se scurge în altă parte. Când e 403, spunem
// permisiunea cu numele ei din dashboard — omul are un singur rând de bifat.
async function intreabaStripe<T>(
  ce: string,
  ruta: string,
  permisiune: string,
  probes: StripeProbe[],
): Promise<T | null> {
  try {
    const r = await fetch(`${API}${ruta}`, { headers: authHeaders(), signal: AbortSignal.timeout(12_000) })
    if (r.ok) {
      probes.push({ ce, ruta, ok: true, detaliu: 'ok' })
      return (await r.json()) as T
    }
    const b = (await r.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null
    const faraVoie = r.status === 403 || b?.error?.code === 'more_permissions_required'
    probes.push({
      ce,
      ruta,
      ok: false,
      detaliu: faraVoie
        ? `cheia nu are permisiunea „${permisiune}"`
        : `HTTP ${r.status}${b?.error?.message ? ` — ${b.error.message.slice(0, 90)}` : ''}`,
    })
    return null
  } catch (e) {
    probes.push({ ce, ruta, ok: false, detaliu: String(e).slice(0, 90) })
    return null
  }
}

/** Lipește pe fiecare furnizor ce s-a MĂSURAT pe pagina lui de facturare.
 *
 *  Adrian, 31 iul: „a pus cardul la furnizori? a setat tot?" — întrebarea merită
 *  un răspuns pe care să-l vadă singur, nu unul pe care să mi-l ceară mie. Dar
 *  numai ce s-a măsurat: un furnizor pe care Kelion nu l-a atins rămâne fără
 *  niciun semn — nu „nu", fiindcă nimeni n-a verificat (regula #1). */
async function cuPlatiAutomate(linii: ExpenseLine[]): Promise<ExpenseLine[]> {
  const masurat = await stareFurnizori().catch(() => [])
  if (!masurat.length) return linii
  return linii.map((l) => {
    // „Google Gemini" ↔ „gemini", „OpenAI" ↔ „openai": potrivim pe cuvinte, nu
    // pe egalitate — furnizorul îl numește el, cu mâna lui, când închide sesiunea.
    const cheie = l.name.toLowerCase()
    const f = masurat.find((m) => cheie.includes(m.furnizor) || m.furnizor.includes(cheie.split(' ').pop() ?? ' '))
    return f ? { ...l, cardPus: f.card, platiAutomate: f.automat } : l
  })
}

export async function getMoneyCircuit(): Promise<MoneyCircuit> {
  const probes: StripeProbe[] = []
  const out: MoneyCircuit = { payoutsInterval: 'unknown', issuingStatus: 'unknown', cards: [], issuingAvailable: null, autoFund: lastAutoFund, expenses: await cuPlatiAutomate(expenseLines()), stripePk: config.stripe.publishableKey, keyLivemode: !/_test_/.test(config.stripe.secretKey), probes }
  if (!config.stripe.secretKey) return { ...out, error: 'stripe_not_configured' }
  try {
    const a = await intreabaStripe<{
      settings?: { payouts?: { schedule?: { interval?: string } } }
      capabilities?: { card_issuing?: string }
    }>('Setările contului (program payout, Issuing)', '/account', 'Account: Read', probes)
    if (a) {
      out.payoutsInterval = a.settings?.payouts?.schedule?.interval ?? 'unknown'
      out.issuingStatus = a.capabilities?.card_issuing ?? 'inactive'
    } else {
      // Necunoscut, spus pe față. NU mai punem motivul și în `out.error`: ăla
      // e pentru eșecuri care ating TOT circuitul, nu pentru o citire ratată.
      out.payoutsInterval = 'nu_pot_citi'
      out.issuingStatus = 'nu_pot_citi'
    }
    const b = await intreabaStripe<{ issuing?: { available?: { amount: number }[] } }>(
      'Punga cardului (Issuing)', '/balance', 'Balance: Read', probes,
    )
    if (b) out.issuingAvailable = (b.issuing?.available?.[0]?.amount ?? 0) / 100
    // VERIGA 4, MĂSURATĂ (nu declarată): cine a taxat cardul. Dacă OpenRouter
    // sau OpenAI l-au folosit, apar aici. Gol = cardul nu e (încă) legat la ei.
    {
      const tj = await intreabaStripe<{
        data?: { amount: number; created: number; merchant_data?: { name?: string } }[]
      }>('Taxările pe card (cine l-a folosit)', '/issuing/transactions?limit=8', 'Issuing Transactions: Read', probes)
      if (tj) {
        out.issuingCharges = (tj.data ?? []).map((x) => ({
          merchant: x.merchant_data?.name ?? 'necunoscut',
          amount: Math.abs(x.amount) / 100,
          at: new Date(x.created * 1000).toISOString(),
        }))
      }
    }

    // ── REGULA BATUTA IN CUIE: platile catre AI ies din punga ──────────────
    // Adrian, 30 iul: „regula trebuie batuta in cuie sa se faca plati din punga."
    // Codul NU poate pune cardul in contul furnizorului — nu exista API la niciunul
    // (verificat in specificatia OpenRouter: 69 de rute, niciuna de plata).
    // Dar poate PRINDE cand nu e pus: daca am consumat AI si cardul n-a fost taxat
    // deloc, atunci furnizorii sunt platiti din alta parte, adica din buzunarul
    // ownerului. Asta se masoara, nu se presupune.
    try {
      const cost = await getCostSummary()
      const cheltuit = Math.round(cost.total * config.stripe.usdToCurrency * 100) / 100
      const taxat = Math.round((out.issuingCharges ?? []).reduce((s2, t) => s2 + t.amount, 0) * 100) / 100
      const respectata = cheltuit < 1 || taxat > 0
      out.pouchRule = {
        spent: cheltuit,
        charged: taxat,
        ok: respectata,
        verdict: respectata
          ? taxat > 0
            ? 'Furnizorii taxeaza cardul Kelion — platile ies din punga, cum trebuie.'
            : 'Inca nu s-a cheltuit destul ca sa se vada; regula se verifica singura la prima factura.'
          : `Am consumat AI de ${cheltuit.toFixed(2)}, dar cardul Kelion n-a fost taxat niciodata. Deci furnizorii sunt platiti din ALT card. Pune cardul Kelion in contul lor de facturare si scoate-l pe celalalt.`,
      }
    } catch {
      /* informativ */
    }

    // NU CERE O PERMISIUNE DE CARE N-AI NEVOIE (Adrian, 30 iul: „la ce câmp?",
    // căutând prin lista de permisiuni a cheii restricționate).
    //
    // Aici scria `if (out.issuingStatus === 'active')`. Adică: dacă nu pot CITI
    // CONTUL, nici nu mă mai uit după carduri. Consecința pe viu: cheia n-avea
    // dreptul `Account: Read`, `/v1/account` întorcea 403, `issuingStatus` rămânea
    // 'fara_permisiune_cheie', lista de carduri nu se cerea NICIODATĂ — și panoul
    // raporta „Cardul Kelion AI: necreat". Nu era o constatare; era rezultatul
    // unei căutări care n-a avut loc. Iar întrebarea care-l bloca pe om („am card
    // adevărat sau nu?") se răspunde exact de aici.
    //
    // Cardurile se cer ACUM întotdeauna. Cheia are deja voie pe Issuing (dată pe
    // 24 iul, verificată cu apeluri reale), deci răspunsul vine fără nicio
    // umblătură prin dashboard. Și un răspuns bun spune mai mult decât
    // `/v1/account`: dacă Stripe îți listează carduri, Issuing E activ.
    const c = await intreabaStripe<{ data?: { id: string; last4?: string; status?: string; livemode?: boolean }[] }>(
      'Cardurile virtuale active', '/issuing/cards?limit=5&status=active', 'Issuing Cards: Read', probes,
    )
    if (c) {
      // `livemode` vine pe FIECARE obiect Stripe. Îl ducem mai departe: un card
      // de test arată identic cu unul real în listă, dar numărul lui e refuzat
      // de orice formular de plată adevărat. Fără steagul ăsta, panoul spune
      // „✅ Cardul Kelion AI" despre o simulare.
      out.cards = (c.data ?? []).map((x) => ({ id: x.id, last4: x.last4 ?? '????', status: x.status ?? '', livemode: x.livemode === true }))
      // Stripe ți-a dat carduri ⇒ Issuing e activ, oricât de oarbă ar fi cheia
      // pe /v1/account. Nu lăsăm veriga 2 pe „nu știu" când dovada e în mână.
      if (out.cards.length > 0 && out.issuingStatus !== 'active') out.issuingStatus = 'active'
      // Zero carduri ACTIVE, cu răspuns bun de la Stripe: acum chiar știm.
      else out.cardsChecked = true
    } else {
      out.cardsError = probes[probes.length - 1]?.detaliu ?? 'Stripe n-a răspuns'
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
export function lastAutoFundStatus(): { at: string; ok: boolean; detail: string } | null {
  return lastAutoFund
}

const ISSUING_MIN = Math.max(0, Number(process.env.ISSUING_MIN_GBP ?? '10') || 10)
const ISSUING_TOPUP = Math.max(1, Number(process.env.ISSUING_TOPUP_GBP ?? '20') || 20)
// Rezerva minimă ținută în punga de plăți: de la ea în jos nu se scoate nimic
// spre card. Creste cu fiecare user, fiindcă fiecare user in plus inseamna inca
// un om care poate cere banii inapoi. Reglabile din mediu, fara deploy.
const REZERVA_BAZA = Math.max(0, Number(process.env.STRIPE_RESERVE_GBP ?? '20') || 20)
const REZERVA_PER_USER = Math.max(0, Number(process.env.STRIPE_RESERVE_PER_USER_GBP ?? '10') || 10)

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
  const idemKey = `kelion-ownerdep-${new Date().toISOString().slice(0, 10)}`
  const res = await offSessionCharge(customer, pm, OWNER_AUTODEPOSIT * 100, email, idemKey, { owner_deposit: '1' })
  if (!res.ok || res.piStatus !== 'succeeded') return `auto-depunere eșuată: ${res.error ?? `http_${res.status}`}`
  return `auto-depunere owner £${OWNER_AUTODEPOSIT} reușită (${res.id}) — intră în pungă la decontare`
}

export async function autoFundIssuing(): Promise<void> {
  if (!config.stripe.secretKey) return
  try {
    // Starea reală a celor două pungi.
    const r = await fetch(`${API}/balance`, { headers: authHeaders(), signal: AbortSignal.timeout(12_000) })
    if (!r.ok) {
      // IEȘIRE MUTĂ, REPARATĂ (Adrian, 30 iul: „banii nu s-au afișat nici o dată
      // după plată"). Funcția asta rulează din oră în oră și avea patru ieșiri,
      // dintre care două nu scriau NIMIC nicăieri. Panoul arăta „—" la ultima
      // alimentare, iar omul n-avea de unde ști dacă a mers, dacă a picat, sau
      // dacă nici măcar nu s-a încercat. De-acum FIECARE ieșire își lasă motivul.
      lastAutoFund = { at: new Date().toISOString(), ok: false, detail: `nu pot citi soldul Stripe (http_${r.status})` }
      return
    }
    const b = (await r.json()) as {
      available?: { amount: number; currency: string }[]
      pending?: { amount: number; currency: string }[]
      issuing?: { available?: { amount: number; currency: string }[] }
    }
    const cur = config.stripe.currency
    const payments = (b.available ?? []).find((a) => a.currency === cur)?.amount ?? 0
    const pendingAmt = (b.pending ?? []).find((a) => a.currency === cur)?.amount ?? 0
    const issuing = (b.issuing?.available ?? []).find((a) => a.currency === cur)?.amount ?? 0
    // Punga cardului are destul → nimic de făcut. (Se notează oricum: „n-am
    // făcut nimic FIINDCĂ n-a fost nevoie" e alt lucru decât „n-am făcut nimic".)
    if (issuing >= ISSUING_MIN * 100) {
      lastAutoFund = {
        at: new Date().toISOString(),
        ok: true,
        detail: `nimic de făcut: punga cardului are £${(issuing / 100).toFixed(2)} (pragul e £${ISSUING_MIN})`,
      }
      return
    }

    // ── REZERVA CARE NU SE ATINGE (Adrian, 30 iul) ────────────────────────
    // „Se face strict asta când avem mai mult de 100 de lire, și se corelează
    // cu numărul de utilizatori: 1 user = 100, 2 useri = 110, 3 useri = 120,
    // ca să nu avem surprize."
    //
    // Până acum transferul lua TOT ce găsea (`min(topup, payments)`), fără prag.
    // Rambursările și taxele Stripe vin DUPĂ, pe un sold golit — de-aia panoul
    // avea deja notița „sub zero = taxe Stripe reținute". Rezerva e banii
    // userilor care încă pot cere înapoi; ei rămân în punga de plăți.
    const useri = await countWalletUsers().catch(() => 0)
    const rezerva = (REZERVA_BAZA + Math.max(0, useri - 1) * REZERVA_PER_USER) * 100
    const disponibil = payments - rezerva
    if (disponibil <= 0) {
      // ASTA E IEȘIREA CARE L-A COSTAT O ZI. Regula rezervei e a lui și rămâne
      // (banii userilor, care pot cere înapoi, nu pleacă spre card) — dar când
      // pune bani și nu se întâmplă NIMIC, trebuie să vadă DE CE: cât e în
      // punga de plăți, cât e rezerva, deci cât lipsește ca să se miște ceva.
      lastAutoFund = {
        at: new Date().toISOString(),
        ok: false,
        detail:
          `nu s-a transferat nimic: în punga de plăți sunt £${(payments / 100).toFixed(2)}, ` +
          `iar rezerva intangibilă (${useri} user${useri === 1 ? '' : 'i'}) e £${(rezerva / 100).toFixed(2)}. ` +
          `Mai trebuie £${((rezerva - payments) / 100 + 0.01).toFixed(2)} ca să înceapă alimentarea cardului.`,
      }
      return // sub rezervă: nu se scoate nimic, punct.
    }
    const want = Math.min(ISSUING_TOPUP * 100, disponibil)
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

// ── NUMĂRUL CARDULUI, ÎN PANOU, FĂRĂ SĂ TREACĂ PRIN NOI ──────────────────────
//
// Adrian, 30 iul: „nu mă descurc, te rog intră și ajută-mă" / „pot pune datele
// cardului aici?". NU — un număr de card scris în chat e un card compromis. Și
// nici prin serverul nostru nu-l trecem: dacă PAN-ul ar veni prin backend
// (`expand[]=number` pe API), toată aplicația ar intra în scope PCI, cu logurile
// cu tot.
//
// Calea oficială Stripe pentru exact cazul ăsta e Issuing Elements: browserul
// cere un NONCE de unică folosință de la Stripe.js, serverul schimbă nonce-ul
// pe o CHEIE EFEMERĂ (15 minute, doar pentru cardul ăsta), iar numărul se
// randează într-un iframe găzduit de Stripe. Serverul nu vede niciodată cifrele
// — vede doar un nonce. Aici e singura parte care are nevoie de cheia secretă.
//
// Ce dă înapoi: `secret`-ul cheii efemere. Nimic sensibil pentru card.
export async function createCardEphemeralKey(
  cardId: string,
  nonce: string,
): Promise<{ secret: string } | { error: string }> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  // Gărzi pe formă ÎNAINTE de rețea: `ic_…` e prefixul cardurilor Issuing, iar
  // nonce-ul e opac dar mărginit. Fără ele, orice șir din browser ar deveni o
  // cerere către Stripe pe cheia noastră secretă.
  if (!/^ic_[A-Za-z0-9]+$/.test(cardId)) return { error: 'bad_card' }
  if (!nonce || nonce.length > 200) return { error: 'bad_nonce' }
  try {
    const body = new URLSearchParams({ nonce, issuing_card: cardId })
    const r = await fetch(`${API}/ephemeral_keys`, {
      method: 'POST',
      // Cheia efemeră cere o versiune de API EXPLICITĂ — Stripe refuză altfel.
      headers: { ...authHeaders(), 'Stripe-Version': '2020-03-02' },
      body,
      signal: AbortSignal.timeout(12_000),
    })
    const j = (await r.json().catch(() => ({}))) as { secret?: string; error?: { message?: string } }
    if (!r.ok || !j.secret) return { error: j.error?.message ?? `http_${r.status}` }
    return { secret: j.secret }
  } catch (e) {
    return { error: String(e).slice(0, 160) }
  }
}

// Creează cardul virtual „Kelion AI" prin API (necesită Issuing activ):
// cardholder pe emailul adminului + card virtual GBP. Numărul complet se vede
// în panou (Issuing Elements, vezi mai sus) sau în dashboardul Stripe —
// întoarcem și linkul direct la card.
export interface CardholderAddress {
  line1: string
  line2?: string
  city: string
  postal_code: string
  country: string
}

export async function createKelionCard(
  adminEmail: string,
  addr: CardholderAddress,
): Promise<{ id: string; last4: string; url: string } | { error: string }> {
  if (!config.stripe.secretKey) return { error: 'stripe_not_configured' }
  // ADRESA REALĂ, CERUTĂ — NU INVENTATĂ (Adrian, 30 iul).
  // Aici scria hardcodat „Kelionai, London, EC1A 1AA" — o adresă care nu există
  // și care nu e a nimănui. Două probleme: (1) la verificarea de adresă (AVS) a
  // unui furnizor, cardul poate fi refuzat, iar omul n-ar avea de unde ghici de
  // ce; (2) e o declarație falsă către Stripe despre titularul cardului. Adresa
  // vine acum de la owner, o dată, din panou — și e obligatorie.
  const line1 = addr.line1?.trim()
  const city = addr.city?.trim()
  const postal = addr.postal_code?.trim()
  const country = (addr.country ?? '').trim().toUpperCase()
  if (!line1 || !city || !postal || !/^[A-Z]{2}$/.test(country)) return { error: 'bad_address' }
  try {
    const chBody = new URLSearchParams()
    chBody.set('name', 'Kelion AI')
    chBody.set('email', adminEmail)
    chBody.set('type', 'individual')
    chBody.set('billing[address][line1]', line1)
    if (addr.line2?.trim()) chBody.set('billing[address][line2]', addr.line2.trim())
    chBody.set('billing[address][city]', city)
    chBody.set('billing[address][postal_code]', postal)
    chBody.set('billing[address][country]', country)
    const ch = await fetch(`${API}/issuing/cardholders`, { method: 'POST', headers: authHeaders(), body: chBody })
    const chJ = (await ch.json().catch(() => ({}))) as { id?: string; error?: { message?: string } }
    if (!ch.ok || !chJ.id) return { error: chJ.error?.message ?? `cardholder_http_${ch.status}` }
    const cBody = new URLSearchParams()
    cBody.set('cardholder', chJ.id)
    cBody.set('currency', config.stripe.currency)
    cBody.set('type', 'virtual')
    cBody.set('status', 'active')
    const card = await fetch(`${API}/issuing/cards`, { method: 'POST', headers: authHeaders(), body: cBody })
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
  const r = await fetch(`${API}/payouts`, { method: 'POST', headers: authHeaders(), body })
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
  /** Punga CARDULUI (Issuing) — al treilea buzunar, complet separat de plăți.
   *  Adrian, 30 iul: „Stripe e 0? am băgat bani." Panoul îi arăta DOAR
   *  `available`, deci banii care erau încă în decontare (`pending`) sau care
   *  intraseră direct în punga cardului (alimentare prin transfer bancar pentru
   *  Issuing) păreau dispăruți. Trei buzunare, una singură afișată. */
  issuing: number
  currency: string
  /** BANII CARE EXISTĂ, DAR ÎN ALTĂ MONEDĂ (Adrian, 30 iul: „stripe 0? am băgat
   *  bani"). Stripe ține soldul separat pe fiecare monedă, iar noi numărăm doar
   *  moneda contului (`STRIPE_CURRENCY`, implicit gbp) — altfel s-ar aduna
   *  lire cu dolari într-o cifră fără sens. Consecința nevăzută: un sold în USD
   *  sau EUR era filtrat afară și panoul scria „£0.00" — bani REALI, afișați ca
   *  zero. Regula nr. 1: o citire filtrată nu e o cifră, e o citire filtrată.
   *  Aici plecă lista celorlalte monede, ca panoul să spună adevărul întreg. */
  alteMonede: { currency: string; available: number; pending: number }[]
} | null> {
  if (!config.stripe.secretKey) return null
  const r = await fetch(`${API}/balance`, { headers: authHeaders() })
  if (!r.ok) return null
  const j = (await r.json()) as {
    available?: { amount: number; currency?: string }[]
    pending?: { amount: number; currency?: string }[]
    issuing?: { available?: { amount: number; currency?: string }[] }
  }
  // BUG FIX (4 iul): Stripe returns one entry PER CURRENCY. Summing them all
  // into a single figure mixed gbp+usd+eur into one meaningless number (that's
  // how the panel showed a bogus balance). Count ONLY the account currency.
  const cur = config.stripe.currency
  const sum = (arr?: { amount: number; currency?: string }[]): number =>
    (arr ?? [])
      .filter((x) => !x.currency || x.currency.toLowerCase() === cur)
      .reduce((s, x) => s + x.amount, 0) / 100
  // Ce EXISTĂ în alte monede decât cea a contului. Nu se adună (ar ieși o cifră
  // fără sens) — se ARATĂ, ca „0" să nu mai poată însemna „n-am găsit unde să mă uit".
  const peMoneda = new Map<string, { available: number; pending: number }>()
  const aduna = (arr: { amount: number; currency?: string }[] | undefined, camp: 'available' | 'pending'): void => {
    for (const x of arr ?? []) {
      const c = (x.currency ?? cur).toLowerCase()
      if (c === cur) continue
      const r = peMoneda.get(c) ?? { available: 0, pending: 0 }
      r[camp] += x.amount / 100
      peMoneda.set(c, r)
    }
  }
  aduna(j.available, 'available')
  aduna(j.pending, 'pending')
  return {
    available: sum(j.available),
    pending: sum(j.pending),
    issuing: sum(j.issuing?.available),
    currency: cur,
    alteMonede: [...peMoneda].map(([currency, v]) => ({ currency, ...v })),
  }
}

// Create a PaymentIntent for a credit top-up. The frontend confirms the payment
// with the client_secret; the backend credits the wallet on webhook.
// AICI AU STAT `PaymentIntentResult` + `createPaymentIntent` — a doua cale de
// plata a userului (Stripe.js direct). Scoase odata cu prima: nicio ruta nu le
// mai chema, iar cod de miscat bani lasat viu "pentru orice eventualitate" e
// exact genul de usa uitata deschisa.

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
      const r = await fetch(`${API}/${path}`, { headers: authHeaders() })
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
