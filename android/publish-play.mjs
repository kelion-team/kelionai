// Publish the signed AAB to Google Play (production track) via the official
// Play Developer API — no console clicking. Needs (one-time, made by Adrian in
// Play Console → Setup → API access):
//   PLAY_SERVICE_ACCOUNT_JSON or PLAY_SERVICE_ACCOUNT_JSON_PATH
// After the app's FIRST manual upload (Google policy), every release is:
//   node publish-play.mjs   (or automatically from release.ps1)
import { readFileSync, existsSync } from 'node:fs'
import { createSign } from 'node:crypto'

// Contul de serviciu vine, în ordine: (1) din env PLAY_SERVICE_ACCOUNT_JSON
// (conținutul JSON ca secret), apoi din PLAY_SERVICE_ACCOUNT_JSON_PATH.
// Nicio cale personală sau cheie nu este îngropată în aplicație.
const SA_PATH = process.env.PLAY_SERVICE_ACCOUNT_JSON_PATH?.trim() ?? ''
const AAB = new URL('./app/build/outputs/bundle/release/app-release.aab', import.meta.url)
const PRODUCT = JSON.parse(readFileSync(new URL('../config/product.json', import.meta.url), 'utf8'))
const ENDPOINTS = JSON.parse(readFileSync(new URL('../config/endpoints.json', import.meta.url), 'utf8'))
const PACKAGE = String(PRODUCT.androidApplicationId ?? '')
if (!/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)+$/.test(PACKAGE)) throw new Error('androidApplicationId invalid în config/product.json')
const EXPECTED_VERSION_CODE = Number(process.env.KELION_ANDROID_VERSION_CODE)
if (!Number.isSafeInteger(EXPECTED_VERSION_CODE) || EXPECTED_VERSION_CODE < Number(PRODUCT.androidVersionCode) || EXPECTED_VERSION_CODE > 2_100_000_000) {
  throw new Error('KELION_ANDROID_VERSION_CODE invalid')
}
function endpoint(name, path = '') {
  const parsed = new URL(String(ENDPOINTS?.version === 1 ? ENDPOINTS.external?.[name] : ''))
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== (path || '/')) {
    throw new Error('external endpoint registry invalid')
  }
  return path ? parsed.toString() : parsed.origin
}
const GOOGLE_OAUTH_TOKEN_URL = endpoint('googleOAuthTokenUrl', '/token')
const PLAY_API_ORIGIN = endpoint('googlePlayPublisherApiBase')

let saRaw = process.env.PLAY_SERVICE_ACCOUNT_JSON
if (!saRaw) {
  if (!SA_PATH || !existsSync(SA_PATH)) {
    console.log('Credențialele Play lipsesc — setează PLAY_SERVICE_ACCOUNT_JSON sau PLAY_SERVICE_ACCOUNT_JSON_PATH (vezi PLAY-UPLOAD.md).')
    process.exit(1)
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
  aud: GOOGLE_OAUTH_TOKEN_URL,
  iat: now,
  exp: now + 3600,
})}`
const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
const tokenRes = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${unsigned}.${signature}`,
})
const { access_token } = await tokenRes.json()
if (!access_token) throw new Error('Play auth failed')

const api = `${PLAY_API_ORIGIN}/androidpublisher/v3/applications/${PACKAGE}`
const auth = { Authorization: `Bearer ${access_token}` }
const j = (r) => r.json()

// Standard edits flow: open edit → upload bundle → assign to production → commit.
const edit = await fetch(`${api}/edits`, { method: 'POST', headers: auth }).then(j)
if (!edit.id) throw new Error(`edit failed: ${JSON.stringify(edit)}`)

const currentTrackResponse = await fetch(`${api}/edits/${edit.id}/tracks/production`, { headers: auth })
const currentTrack = currentTrackResponse.status === 404 ? { releases: [] } : await currentTrackResponse.json()
if (!currentTrackResponse.ok && currentTrackResponse.status !== 404) throw new Error(`production track read failed: HTTP ${currentTrackResponse.status}`)
const currentCodes = (currentTrack.releases ?? []).flatMap((release) => release.versionCodes ?? []).map(Number).filter(Number.isSafeInteger)
const currentMax = currentCodes.length ? Math.max(...currentCodes) : 0
if (EXPECTED_VERSION_CODE <= currentMax) throw new Error('KELION_ANDROID_VERSION_CODE nu este mai mare decât versiunea din Play')

const bundle = await fetch(
  `${PLAY_API_ORIGIN}/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/bundles?uploadType=media`,
  { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body: readFileSync(AAB) },
).then(j)
if (!bundle.versionCode) throw new Error(`upload failed: ${JSON.stringify(bundle)}`)
if (Number(bundle.versionCode) !== EXPECTED_VERSION_CODE) throw new Error('AAB-ul încărcat nu are versionCode-ul aprobat')
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
