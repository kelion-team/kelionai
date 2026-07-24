import { config } from '../config.js'
import { getOpenRouterBalance } from './openrouter.js'
import { sendMail } from './mail.js'

// ── ALERTĂ „punga lui Kelion e pe terminate" (Adrian, 24 iul) ────────────────
// Creierul (OpenRouter) e alimentat CENTRAL din contul lui Kelion. Când soldul
// REAL scade sub prag, ANUNȚĂM adminul pe email că e nevoie să depună bani —
// înainte să pice creierul în mijlocul unei conversații reale. Un mail/zi cât
// timp e jos (fără spam); când soldul se reface, resetăm și putem alerta din nou.

let lastAlertAt = 0
const ALERT_COOLDOWN_MS = 24 * 60 * 60 * 1000

export async function checkOpenRouterBalance(): Promise<void> {
  const bal = await getOpenRouterBalance(true) // valoarea LIVE, nu din cache
  if (!bal.ok) return // cheie lipsă / OpenRouter inaccesibil → nu alarmăm fals
  if (!bal.low) {
    lastAlertAt = 0 // s-a realimentat → permite o alertă nouă data viitoare
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
