import { config } from '../config.js'
import { topUpUser } from '../db.js'

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
  let data: { id?: string; payment_status?: string; amount_total?: number; currency?: string; payment_intent?: string; metadata?: { email?: string }; customer_details?: { email?: string } }[] = []
  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions?limit=25', {
      headers: { Authorization: `Bearer ${config.stripe.secretKey}` },
      signal: AbortSignal.timeout(15_000),
    })
    if (!r.ok) return { scanned: 0, credited: 0 }
    const j = (await r.json()) as { data?: typeof data }
    data = j.data ?? []
  } catch {
    return { scanned: 0, credited: 0 }
  }

  let credited = 0
  for (const s of data) {
    if (s.payment_status !== 'paid') continue
    const email = s.metadata?.email ?? s.customer_details?.email ?? ''
    const amount = (s.amount_total ?? 0) / 100
    const ref = s.payment_intent ?? s.id ?? ''
    if (!email || !(amount > 0) || !ref) continue
    // Idempotent: dacă stripe_ref există deja în billing_events, topUpUser
    // întoarce false și nu se creditează nimic în plus.
    const ok = await topUpUser(email, amount, s.currency ?? config.stripe.currency, ref)
    if (ok) credited++
  }
  return { scanned: data.length, credited }
}
