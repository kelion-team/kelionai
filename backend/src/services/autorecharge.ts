import { config } from '../config.js'
import {
  getAutoRecharge,
  getWalletStatus,
  topUpUserFromPaymentIntent,
} from '../db.js'
import { chargeSavedCard } from './stripe.js'

// ── REÎNCĂRCARE AUTOMATĂ — „userul să nu rămână fără credit" (Adrian) ─────────
// Când creditele userului scad sub pragul lui, taxăm OFF-SESSION cardul salvat
// și credit) contul (75% user / 25% fond admin, prin aceeași cale idempotentă ca
// webhookul). Userul vede DOAR credite; nu se blochează în mijlocul unei sesiuni.
// Un lacăt per user împiedică taxări duble concurente.

const inFlight = new Set<string>()

function creditsOf(balance: number): number {
  return Math.floor(balance / config.stripe.creditValue)
}

/**
 * Reîncarcă automat DACĂ e activat și creditele sunt sub prag. Întoarce true dacă
 * a creditat. Best-effort: orice eșec (fără card, plată refuzată) → false, fără
 * să arunce (userul cade pe paywall-ul normal).
 */
export async function maybeAutoRecharge(email: string, name = ''): Promise<boolean> {
  if (!config.stripe.secretKey || inFlight.has(email)) return false
  const ar = await getAutoRecharge(email)
  if (!ar.enabled) return false
  const { balance } = await getWalletStatus(email)
  if (creditsOf(balance) > ar.threshold) return false

  inFlight.add(email)
  try {
    const charge = await chargeSavedCard(email, name, ar.topupAmount)
    if (!charge.ok) return false
    // Creditează 75/25 imediat (idempotent pe PI id → webhookul nu dublează).
    return await topUpUserFromPaymentIntent(
      email,
      charge.amount,
      config.stripe.currency,
      charge.paymentIntentId,
    )
  } catch {
    return false
  } finally {
    inFlight.delete(email)
  }
}
