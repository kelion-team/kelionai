// Try to enable People API on the project using the service account already in
// Railway (GOOGLE_SERVICE_ACCOUNT_JSON). Works only if that SA has the
// serviceusage.services.enable permission; otherwise reports the 403 so we know
// it must be done in the console.
import { GoogleAuth } from 'google-auth-library'

const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
if (!raw) { console.log('NO_SA'); process.exit(1) }
const creds = JSON.parse(raw)
const project = creds.project_id
const api = 'people.googleapis.com'

const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const client = await auth.getClient()
const tok = (await client.getAccessToken()).token

const base = `https://serviceusage.googleapis.com/v1/projects/${project}/services/${api}`
const getRes = await fetch(base, { headers: { Authorization: `Bearer ${tok}` } })
const getJson = await getRes.json()
console.log('STATUS_HTTP', getRes.status, 'state:', getJson.state ?? JSON.stringify(getJson).slice(0, 240))
if (getJson.state === 'ENABLED') { console.log('ALREADY_ENABLED'); process.exit(0) }

const enRes = await fetch(`${base}:enable`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
  body: '{}',
})
const enJson = await enRes.json()
console.log('ENABLE_HTTP', enRes.status, JSON.stringify(enJson).slice(0, 400))
