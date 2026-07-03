// End-to-end test of the Stripe webhook path WITHOUT a real payment: craft a
// checkout.session.completed event, sign it with the configured webhook secret,
// POST it, then read the wallet balance for the probe email. Also checks a bad
// signature is rejected and a replay doesn't double-credit.
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
const SECRET = process.env.SESSION_SECRET
const WHSEC = process.env.STRIPE_WEBHOOK_SECRET
if (!SECRET || !WHSEC) { console.log('MISSING_SECRETS'); process.exit(1) }
const BASE = 'https://kelionai.app'
const email = `webhook-probe-${Date.now()}@test.local`

const sign = (raw, secret) => {
  const t = Math.floor(Date.now() / 1000)
  const v1 = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')
  return `t=${t},v1=${v1}`
}
const evt = JSON.stringify({
  type: 'checkout.session.completed',
  data: { object: { id: `cs_probe_${Date.now()}`, amount_total: 1234, currency: 'gbp', metadata: { email } } },
})
const post = (sig) => fetch(`${BASE}/api/credits/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig }, body: evt })
const cookie = `kelionai_session=${jwt.sign({ email, name: 'Probe', picture: '', role: 'customer', locale: 'en' }, SECRET, { expiresIn: '1h' })}`
const balance = async () => (await (await fetch(`${BASE}/api/billing/balance`, { headers: { Cookie: cookie } })).text())

let r = await post(sign(evt, WHSEC))
console.log('1) good signature  ->', r.status, (await r.text()).slice(0, 40))
r = await post(sign(evt, 'whsec_wrongwrongwrong'))
console.log('2) bad signature   ->', r.status, '(expect 400)')
console.log('3) balance credited->', await balance(), '(expect 12.34)')
r = await post(sign(evt, WHSEC))
console.log('4) replay same id  ->', r.status)
console.log('5) balance after replay ->', await balance(), '(expect still 12.34 — idempotent)')
