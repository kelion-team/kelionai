// Publish the signed AAB to Google Play (production track) via the official
// Play Developer API — no console clicking. Needs (one-time, made by Adrian in
// Play Console → Setup → API access):
//   C:\Users\adria\Kelionai-secrets\play-service-account.json
// After the app's FIRST manual upload (Google policy), every release is:
//   node publish-play.mjs   (or automatically from release.ps1)
import { readFileSync, existsSync } from 'node:fs'
import { createSign } from 'node:crypto'

// Contul de serviciu vine, în ordine: (1) din env PLAY_SERVICE_ACCOUNT_JSON
// (conținutul JSON ca secret — calea din GitHub Actions), (2) din env
// PLAY_SERVICE_ACCOUNT_JSON_PATH (cale de fișier), (3) din calea locală a lui
// Adrian (fluxul de pe PC-ul lui). Așa merge și din cloud, și local — nu dublăm.
const SA_PATH = process.env.PLAY_SERVICE_ACCOUNT_JSON_PATH || 'C:/Users/adria/Kelionai-secrets/play-service-account.json'
const AAB = new URL('./app/build/outputs/bundle/release/app-release.aab', import.meta.url)
const PACKAGE = 'app.kelionai.twa'

let saRaw = process.env.PLAY_SERVICE_ACCOUNT_JSON
if (!saRaw) {
  if (!existsSync(SA_PATH)) {
    console.log('play-service-account.json absent — sar peste publicarea Play (vezi PLAY-UPLOAD.md).')
    process.exit(0)
  }
  saRaw = readFileSync(SA_PATH, 'utf8')
}

const sa = JSON.parse(saRaw)

// OAuth2 for a service account: signed JWT → access token.
const now = Math.floor(Date.now() / 1000)
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
  iss: sa.client_email,
  scope: 'https://www.googleapis.com/auth/androidpublisher',
  aud: 'https://oauth2.googleapis.com/token',
  iat: now,
  exp: now + 3600,
})}`
const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${signature}`,
})
const { access_token } = await tokenRes.json()
if (!access_token) throw new Error('Play auth failed')

const api = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`
const auth = { Authorization: `Bearer ${access_token}` }
const j = (r) => r.json()

// Standard edits flow: open edit → upload bundle → assign to production → commit.
const edit = await fetch(`${api}/edits`, { method: 'POST', headers: auth }).then(j)
if (!edit.id) throw new Error(`edit failed: ${JSON.stringify(edit)}`)

const bundle = await fetch(
  `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`,
  { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: readFileSync(AAB) },
).then(j)
if (!bundle.versionCode) throw new Error(`upload failed: ${JSON.stringify(bundle)}`)
console.log('AAB urcat, versionCode', bundle.versionCode)

await fetch(`${api}/edits/${edit.id}/tracks/production`, {
  method: 'PUT',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    track: 'production',
    releases: [{ versionCodes: [String(bundle.versionCode)], status: 'completed' }],
  }),
}).then(j)

const commit = await fetch(`${api}/edits/${edit.id}:commit`, { method: 'POST', headers: auth }).then(j)
if (!commit.id) throw new Error(`commit failed: ${JSON.stringify(commit)}`)
console.log('PUBLICAT în Play (production) — edit', commit.id)
