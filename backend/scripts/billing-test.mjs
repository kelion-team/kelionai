// Live test of the billing endpoints with a minted admin session: read balance
// and create a real Stripe Checkout Session (returns a checkout URL if Stripe
// works end-to-end). Does NOT pay anything.
import jwt from 'jsonwebtoken'
const SECRET = process.env.SESSION_SECRET
if (!SECRET) { console.log('NO_SESSION_SECRET'); process.exit(1) }
const cookie = `kelionai_session=${jwt.sign({ email: 'adrianenc11@gmail.com', name: 'Adrian', picture: '', role: 'admin', locale: 'ro' }, SECRET, { expiresIn: '1h' })}`
const BASE = 'https://kelionai.app'

const bal = await fetch(`${BASE}/api/billing/balance`, { headers: { Cookie: cookie } })
console.log('balance:', bal.status, (await bal.text()).slice(0, 120))

const co = await fetch(`${BASE}/api/billing/checkout`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ amount: 10 }),
})
const coBody = await co.text()
let url = ''
try { url = JSON.parse(coBody).url ?? '' } catch { /* ignore */ }
console.log('checkout:', co.status, url ? `URL OK -> ${url.slice(0, 60)}…` : coBody.slice(0, 160))
