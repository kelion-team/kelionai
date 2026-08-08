// Genuinely try to re-link billing on the project using the service account.
// Reports exactly what's permitted; if the SA lacks billing rights it 403s and
// only the owner can do it in the console.
import { GoogleAuth } from 'google-auth-library'
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}')
const project = creds.project_id
const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const tok = (await (await auth.getClient()).getAccessToken()).token
const H = { Authorization: `Bearer ${tok}` }

// 1. Current billing info (also reveals the previously-linked billing account).
const bi = await fetch(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`, { headers: H })
const biText = await bi.text()
console.log('BILLINGINFO', bi.status, biText.slice(0, 260))

// 2. Billing accounts the SA can see.
const la = await fetch('https://cloudbilling.googleapis.com/v1/billingAccounts', { headers: H })
const laText = await la.text()
console.log('ACCOUNTS', la.status, laText.slice(0, 260))

// 3. Attempt to re-enable, if we can find a billing account name.
let acct = ''
try { acct = JSON.parse(biText).billingAccountName || '' } catch {}
if (!acct) { try { acct = JSON.parse(laText).billingAccounts?.[0]?.name || '' } catch {} }
if (acct) {
  const en = await fetch(`https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`, {
    method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' },
    body: JSON.stringify({ billingAccountName: acct }),
  })
  console.log('ENABLE_ATTEMPT', en.status, (await en.text()).slice(0, 260))
} else {
  console.log('NO_ACCOUNT_VISIBLE — cannot attempt enable from here')
}
