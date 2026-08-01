import { config } from '../config.js'
import { getOpenRouterBalance } from './openrouter.js'
import { sendMail } from './mail.js'

// ── ALERT "Kelion's pouch is running out" (Adrian, 24 Jul) ──────────────────
// The brain (OpenRouter) is fed CENTRALLY from Kelion's account. When the
// REAL balance drops below the threshold, we NOTIFY the admin by email that
// he needs to deposit money — before the brain drops in the middle of a
// real conversation. One mail/day while it's low (no spam); when the balance
// recovers, we reset and can alert again.

let lastAlertAt = 0
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function checkOpenRouterBalance(): Promise<void> {
  const bal = await getOpenRouterBalance(true) // the LIVE value, not from cache
  if (!bal.ok) return // missing key / OpenRouter unreachable → no false alarm
  if (!bal.low) {
    lastAlertAt = 0 // topped up again → allow a new alert next time
    return
  }
  if (Date.now() - lastAlertAt < ALERT_COOLDOWN_MS) return

  const to = config.mail.forwardTo || config.adminEmail
  const bodyText =
    `Soldul contului OpenRouter (creierul Kelion) a scăzut la $${bal.balance.toFixed(2)}, ` +
    `sub pragul de $${bal.threshold}.\n\n` +
    `Creierul se alimentează CENTRAL din acest cont. Depune bani ca să nu pice ` +
    `conversațiile: ${bal.topup}\n\n` +
    `— Kelion (alertă automată)`
  const html =
    `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222">` +
    `<p>Soldul contului <strong>OpenRouter</strong> (creierul Kelion) a scăzut la ` +
    `<strong>$${bal.balance.toFixed(2)}</strong>, sub pragul de $${bal.threshold}.</p>` +
    `<p>Creierul se alimentează <strong>central</strong> din acest cont. ` +
    `Depune bani ca să nu pice conversațiile:</p>` +
    `<p><a href="${bal.topup}">${bal.topup}</a></p>` +
    `<p style="color:#888">— Kelion (alertă automată)</p></div>`

  const sent = await sendMail({
    to,
    subject: `⚠️ OpenRouter: sold scăzut ($${bal.balance.toFixed(2)}) — depune bani`,
    html,
    text: bodyText,
  })
  if (sent) lastAlertAt = Date.now()
}
