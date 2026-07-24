import { config } from '../config.js'
import { topUpUser, revokeTopUpForRefund } from '../db.js'
import { hasRefund } from './stripe.js'

// ── RECONCILIEREA AUTOMATĂ A PLĂȚILOR (Adrian, 24 iul: „nu e de joacă cu banii
// userilor") ─────────────────────────────────────────────────────────────────
// Incident real: STRIPE_WEBHOOK_SECRET lipsea → webhook-urile erau respinse →
// Adrian a plătit £20 și creditul n-a apărut. Fallback-ul verifyEventWithApi
// acoperă webhook-urile viitoare; ACEASTĂ plasă acoperă orice altă scurgere:
// serverul întreabă SINGUR Stripe (cu cheia secretă) ce sesiuni au fost plătite
// recent și le creditează pe cele necreditate. topUpUser e idempotent pe
// stripe_ref (billing_events) — nimic nu se creditează de două ori, nimic nu se
// pierde. Rulează la boot + la fiecare oră.

export interface ReconcileResult {
  scanned: number
  credited: number
}

export async function reconcileStripePayments(): Promise<ReconcileResult> {
  if (!config.stripe.secretKey) return { scanned: 0, credited: 0 }
  const headers = { Authorization: `Bearer ${config.stripe.secretKey}` }
  // FEREASTRĂ DE 7 ZILE (incident real, 24 iul: plasa a creditat plăți din
  // MARTIE și IUNIE — era veche a aplicației — iar Adrian a văzut credite
  // „din senin": „eu am plătit doar £20, a doua de unde a venit?"). Plasa
  // recuperează DOAR plăți recente scăpate de webhook; plățile istorice se
  // creditează doar MANUAL, după verificare umană. Plată unică, fără surprize.
  const since = Math.floor(Date.now() / 1000) - 7 * 86_400

  // 1) Sesiunile Checkout plătite (limită mărită la 100 — audit P1-1: la 25, a
  // 26-a plată dintr-un vârf cădea de pe listă și nu se mai recupera).
  let sessions: { id?: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string; metadata?: { email?: string }; customer_details?: { email?: string } }[] = []
  try {
    const r = await fetch(`https://api.stripe.com/v1/checkout/sessions?limit=100&created[gte]=${since}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (r.ok) sessions = ((await r.json()) as { data?: typeof sessions }).data ?? []
  } catch {
    /* mergem mai departe cu PI-urile */
  }

  let credited = 0
  for (const s of sessions) {
    if (s.payment_status !== 'paid') continue
    const email = s.metadata?.email ?? s.customer_details?.email ?? ''
    const amount = (s.amount_total ?? 0) / 100
    const ref = s.payment_intent ?? s.id ?? ''
    if (!email || !(amount > 0) || !ref) continue
    // RAMBURSATĂ = NU se creditează (incident real: £25 rambursată dar creditată).
    if (await hasRefund(ref)) continue
    // Idempotent: dacă stripe_ref există deja în billing_events, topUpUser
    // întoarce false și nu se creditează nimic în plus.
    const ok = await topUpUser(email, amount, s.currency ?? config.stripe.currency, ref)
    if (ok) credited++
  }

  // 2) PaymentIntents reușite (audit P1-1: reîncărcarea automată debita cardul,
  // dar dacă creditarea imediată pica ȘI webhookul era mort, banii nu mai veneau
  // de NICĂIERI — PI-urile nu apar în lista de checkout sessions). Aceeași
  // creditare idempotentă, pe aceeași cheie pi_.
  let pis: { id?: string; status?: string; amount?: number; currency?: string; metadata?: { email?: string }; receipt_email?: string }[] = []
  try {
    const r = await fetch(`https://api.stripe.com/v1/payment_intents?limit=100&created[gte]=${since}`, {
      headers,
      signal: AbortSignal.timeout(15_000),
    })
    if (r.ok) pis = ((await r.json()) as { data?: typeof pis }).data ?? []
  } catch {
    return { scanned: sessions.length, credited }
  }
  for (const pi of pis) {
    if (pi.status !== 'succeeded') continue
    const email = pi.metadata?.email ?? pi.receipt_email ?? ''
    const amount = (pi.amount ?? 0) / 100
    if (!email || !(amount > 0) || !pi.id) continue
    // RAMBURSATĂ = NU se creditează.
    if (await hasRefund(pi.id)) continue
    const ok = await topUpUser(email, amount, pi.currency ?? config.stripe.currency, pi.id)
    if (ok) credited++
  }

  // 3) REFUND-uri recente → RETRAGEM creditele acordate (plasa inversă — banii
  // care s-au întors pe card nu pot rămâne credite). Idempotent pe <ref>:refund.
  // Fereastra e mai LARGĂ (30 zile): un refund poate veni la săptămâni după plată.
  try {
    const r = await fetch(
      `https://api.stripe.com/v1/refunds?limit=100&created[gte]=${Math.floor(Date.now() / 1000) - 30 * 86_400}`,
      { headers, signal: AbortSignal.timeout(15_000) },
    )
    if (r.ok) {
      const refunds = ((await r.json()) as { data?: { payment_intent?: string; status?: string }[] }).data ?? []
      for (const rf of refunds) {
        if (rf.status !== 'succeeded' || !rf.payment_intent) continue
        await revokeTopUpForRefund(rf.payment_intent)
      }
    }
  } catch {
    /* best-effort — reîncearcă ora următoare */
  }
  return { scanned: sessions.length + pis.length, credited }
}
