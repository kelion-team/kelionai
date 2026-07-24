import { config } from '../config.js'
import { sendMail } from './mail.js'

// ── ALERTĂ „contul OpenAI fără credit" (incident real, 24 iul) ───────────────
// Vocea ÎNTREAGĂ (Realtime + STT + TTS) merge pe cheia OpenAI. Când contul
// rămâne fără cotă, OpenAI răspunde 429 insufficient_quota și vocea moare
// complet — Adrian a descoperit-o testând („nu aude"). De-acum: la primul
// refuz de cotă, adminul primește email imediat (cooldown 6h — fără spam).

let lastAlertAt = 0
const COOLDOWN_MS = 6 * 60 * 60 * 1000

export function isQuotaError(errorBody: string): boolean {
  return /insufficient_quota|exceeded your current quota/i.test(errorBody || '')
}

export function alertOpenAiQuota(): void {
  if (Date.now() - lastAlertAt < COOLDOWN_MS) return
  lastAlertAt = Date.now()
  const to = config.mail.forwardTo || config.adminEmail
  void sendMail({
    to,
    subject: '🔴 URGENT: contul OpenAI fără credit — VOCEA lui Kelion e moartă',
    text:
      'OpenAI refuză sesiunile cu 429 insufficient_quota — contul de API nu mai are credit.\n\n' +
      'Vocea întreagă (auz live, STT de rezervă, TTS) NU funcționează până nu depui bani:\n' +
      'https://platform.openai.com/settings/organization/billing/overview\n\n' +
      'Creierul (OpenRouter) e separat și nu e afectat.\n\n— Kelion (alertă automată)',
    html:
      '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#222">' +
      '<p><strong>OpenAI refuză sesiunile cu 429 insufficient_quota</strong> — contul de API nu mai are credit.</p>' +
      '<p>Vocea întreagă (auz live, STT de rezervă, TTS) <strong>NU funcționează</strong> până nu depui bani:</p>' +
      '<p><a href="https://platform.openai.com/settings/organization/billing/overview">Alimentează contul OpenAI</a></p>' +
      '<p>Creierul (OpenRouter) e separat și nu e afectat.</p>' +
      '<p style="color:#888">— Kelion (alertă automată)</p></div>',
  }).catch(() => {})
}
