// List the Stripe webhook endpoints on the account, so we can confirm one points
// at kelionai.app with checkout.session.completed. URLs/events aren't secrets.
const sk = process.env.STRIPE_SECRET_KEY ?? ''
const r = await fetch('https://api.stripe.com/v1/webhook_endpoints?limit=30', {
  headers: { Authorization: `Bearer ${sk}` },
})
console.log('HTTP', r.status)
const j = await r.json()
if (Array.isArray(j.data)) {
  if (j.data.length === 0) console.log('NO_ENDPOINTS_CONFIGURED')
  for (const e of j.data) {
    console.log(`- [${e.status}] ${e.url}`)
    console.log(`    events: ${(e.enabled_events || []).slice(0, 8).join(', ')}`)
  }
} else {
  console.log('BODY', JSON.stringify(j).slice(0, 300))
}
