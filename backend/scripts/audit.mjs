// FULL AUDIT of everything Kelion has. Run (cu env-ul producției): node scripts/audit.mjs
// Tests every external dependency + Google API + brain (Kimi/GLM) + voice. Google
// user-data skills are tested at the API-enablement level (the live 200 needs
// the user's own login, which a server probe can't hold).
import { GoogleAuth } from 'google-auth-library'

const results = []
const add = (name, ok, detail) => results.push({ name, ok, detail })

async function http(name, url, opts) {
  try {
    const r = await fetch(url, opts)
    const ok = r.ok
    let extra = ''
    if (!ok) extra = (await r.text()).slice(0, 110).replace(/\s+/g, ' ')
    add(name, ok, `HTTP ${r.status}${extra ? ' ' + extra : ''}`)
  } catch (e) { add(name, false, 'ERR ' + String(e).slice(0, 90)) }
}

const GK = process.env.GEMINI_API_KEY ?? ''
const GM = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
const UA = { 'User-Agent': 'KelionAudit/1.0 (kelionai.app)' }

// ---- External services (web search, maps, weather, knowledge, currency) ----
await http('web_search / youtube_search (Serper)', 'https://google.serper.dev/search',
  { method: 'POST', headers: { 'X-API-KEY': process.env.SERPER_API_KEY ?? '', 'Content-Type': 'application/json' }, body: JSON.stringify({ q: 'test' }) })
await http('get_weather geocode (Open-Meteo)', 'https://geocoding-api.open-meteo.com/v1/search?name=Bucharest&count=1')
await http('get_weather forecast (Open-Meteo)', 'https://api.open-meteo.com/v1/forecast?latitude=44.43&longitude=26.1&current=temperature_2m')
await http('get_weather map (Windy embed)', 'https://embed.windy.com/embed2.html?lat=44.43&lon=26.1&zoom=8')
await http('maps_search (Nominatim)', 'https://nominatim.openstreetmap.org/search?q=Paris&format=json&limit=1', { headers: UA })
await http('reverse geocode (Nominatim)', 'https://nominatim.openstreetmap.org/reverse?lat=44.43&lon=26.1&format=json', { headers: UA })
await http('maps_directions (OSRM)', 'https://router.project-osrm.org/route/v1/driving/26.1,44.43;26.2,44.5?overview=false')
await http('wikipedia_lookup', 'https://en.wikipedia.org/w/rest.php/v1/search/page?q=Paris&limit=1', { headers: UA })
await http('convert_currency (er-api)', 'https://open.er-api.com/v6/latest/USD')
await http('translate_text / search-fallback (Gemini text)', `https://generativelanguage.googleapis.com/v1beta/models/${GM}:generateContent`,
  { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GK }, body: JSON.stringify({ contents: [{ parts: [{ text: 'hi' }] }] }) })
// CREIERUL = Kimi (primar) → GLM (rezerva). Furnizorul vechi a fost scos complet
// (ordin Adrian). Endpoint-urile Kimi/GLM au acelasi format (x-api-key +
// /v1/messages), deci verificam EXACT aceeasi functie (creierul raspunde) pe
// furnizorul nou.
await http('brain (Kimi — primar)', 'https://api.kimi.com/coding/v1/messages',
  { method: 'POST', headers: { 'x-api-key': process.env.KIMI_API_KEY ?? process.env.KIMI_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'kimi-for-coding', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }) })
await http('brain (GLM — rezerva)', 'https://api.z.ai/api/anthropic/v1/messages',
  { method: 'POST', headers: { 'x-api-key': process.env.GLM_API_KEY ?? process.env.GLM_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: 'glm-4.6', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }) })
try { const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit' }).format(new Date()); add('get_time (local Intl)', true, 'OK ' + t) }
catch (e) { add('get_time', false, String(e).slice(0, 60)) }
await http('/health (app)', 'https://kelionai.app/health')

// ---- Google service-account: voice + STT + user-data API enablement ----
const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '{}')
const auth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/cloud-platform'] })
const tok = (await (await auth.getClient()).getAccessToken()).token
const H = { Authorization: `Bearer ${tok}` }

// Voice — actually synthesize.
{
  try {
    const r = await fetch('https://texttospeech.googleapis.com/v1/text:synthesize',
      { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ input: { text: 'salut' }, voice: { languageCode: 'ro-RO', name: 'ro-RO-Chirp3-HD-Charon' }, audioConfig: { audioEncoding: 'MP3' } }) })
    add('voice TTS (Chirp 3 HD)', r.ok, `HTTP ${r.status}${r.ok ? ' audio OK' : ' ' + (await r.text()).slice(0, 90)}`)
  } catch (e) { add('voice TTS', false, 'ERR ' + String(e).slice(0, 80)) }
}

// Image generation — the real path: service account (generative-language scope),
// which bills the billing-enabled project (the free-tier API key returns 429).
{
  try {
    const iAuth = new GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/generative-language'] })
    const iTok = (await (await iAuth.getClient()).getAccessToken()).token
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent',
      { method: 'POST', headers: { Authorization: `Bearer ${iTok}`, 'Content-Type': 'application/json', 'x-goog-user-project': creds.project_id }, body: JSON.stringify({ contents: [{ parts: [{ text: 'a red circle' }] }] }) })
    const t = await r.text()
    add('generate_image (Gemini image via SA)', r.ok && /inlineData|"data"/.test(t), `HTTP ${r.status}${r.ok ? ' image OK' : ' ' + t.slice(0, 80)}`)
  } catch (e) { add('generate_image (via SA)', false, 'ERR ' + String(e).slice(0, 80)) }
}

// User-data APIs: classify ENABLED (live skill works with the user's login,
// already granted) vs DISABLED. A cloud-platform SA can't read the user's data,
// so 401/403 here = API on; only "disabled/SERVICE_DISABLED" = broken.
async function apiEnabled(name, url, method = 'GET', body) {
  try {
    const r = await fetch(url, { method, headers: { ...H, 'Content-Type': 'application/json' }, body })
    const text = await r.text()
    const disabled = /has not been used in project|it is disabled|SERVICE_DISABLED/i.test(text)
    add(name, !disabled, disabled ? `DISABLED (HTTP ${r.status})` : `enabled — live skill needs your login (probe HTTP ${r.status})`)
  } catch (e) { add(name, false, 'ERR ' + String(e).slice(0, 80)) }
}
await apiEnabled('get_calendar_events / create (Calendar API)', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1')
await apiEnabled('get_recent_emails / send_email (Gmail API)', 'https://gmail.googleapis.com/gmail/v1/users/me/profile')
await apiEnabled('get_drive_files (Drive API)', 'https://www.googleapis.com/drive/v3/files?pageSize=1')
await apiEnabled('get_tasks / add_task (Tasks API)', 'https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=1')
await apiEnabled('search_contacts (People API)', 'https://people.googleapis.com/v1/people/me/connections?personFields=names&pageSize=1')
await apiEnabled('hearing STT (Speech-to-Text API)', 'https://speech.googleapis.com/v1/speech:recognize', 'POST', '{}')

// ---- Print table ----
const pass = results.filter((r) => r.ok).length
console.log(`\n==== KELION AUDIT — ${pass}/${results.length} OK ====`)
for (const r of results) console.log(`${r.ok ? '✅' : '❌'}  ${r.name.padEnd(46)} ${r.detail}`)
const fails = results.filter((r) => !r.ok)
if (fails.length) { console.log('\nFAILS:'); for (const f of fails) console.log(`  ❌ ${f.name} — ${f.detail}`) }
else console.log('\nALL GREEN ✅')
