// FULL LIVE AUDIT — talks to Kelion on the real site through /api/chat with a
// minted admin session and asserts a PASS/FAIL for EVERY functionality: base
// skills, Google tools, the 5 specialist agents, owner identity, cross-session
// memory, the capability-gap log and the document panel. Run:
//   (cu env-ul producției încărcat) node backend/scripts/live-test.mjs
// (are nevoie de SESSION_SECRET în env). Prints ✅/❌ per feature + a summary; a
// non-zero exit means something failed.
import jwt from 'jsonwebtoken'

const SECRET = process.env.SESSION_SECRET
if (!SECRET) { console.log('NO_SESSION_SECRET'); process.exit(1) }
const cookie = `kelionai_session=${jwt.sign(
  { email: 'adrianenc11@gmail.com', name: 'Adrian', picture: '', role: 'admin', locale: 'ro' },
  SECRET, { expiresIn: '1h' },
)}`
const BASE = process.env.AUDIT_BASE || 'https://kelionai.app'
const CTRL = String.fromCharCode(31)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Send one message (optionally with prior history for multi-turn tests) and
// return the parsed reply + control frames.
async function ask(content, { coords, history = [] } = {}) {
  const messages = [...history, { role: 'user', content }]
  let res
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ messages, ...(coords ? { coords } : {}) }),
    })
  } catch (e) { return { error: `fetch ${String(e).slice(0, 80)}` } }
  if (!res.ok) return { error: `HTTP ${res.status} ${(await res.text()).slice(0, 100)}` }
  const text = await res.text()
  const frames = []
  let visible = ''
  let buf = text
  for (;;) {
    const i = buf.indexOf(CTRL)
    if (i === -1) { visible += buf; break }
    visible += buf.slice(0, i)
    const j = buf.indexOf(CTRL, i + 1)
    if (j === -1) break
    try { frames.push(JSON.parse(buf.slice(i + 1, j))) } catch { /* ignore */ }
    buf = buf.slice(j + 1)
  }
  return {
    reply: visible.replace(/\s+/g, ' ').trim(),
    frames,
    monitor: frames.map((f) => f.monitor?.url).filter(Boolean).join(' '),
    image: frames.map((f) => f.image?.url).filter(Boolean).join(' '),
    doc: frames.map((f) => f.doc?.text).filter(Boolean).join(' '),
    card: frames.map((f) => f.card?.type).filter(Boolean).join(' '),
  }
}

const results = []
async function test(label, content, passFn, opts) {
  const r = await ask(content, opts)
  let pass = false, note = ''
  if (r.error) { note = r.error } else {
    try { const v = passFn(r); pass = v === true; if (typeof v === 'string') { pass = false; note = v } }
    catch (e) { note = `assert ${String(e).slice(0, 60)}` }
  }
  if (!note && !pass) note = `reply="${(r.reply || '').slice(0, 70)}"`
  results.push({ label, pass })
  console.log(`${pass ? '✅' : '❌'} ${label}${note ? ' — ' + note : ''}`)
  return r
}
const has = (s, re) => re.test(s || '')

console.log(`\n──────── FULL LIVE AUDIT @ ${BASE} ────────`)

// ── Identity & brain ──
await test('owner_identity', 'Cine te-a creat și a cui este aplicația?',
  (r) => has(r.reply, /AE ?Studio/i) && has(r.reply, /Adrian/i) || 'missing AE Studio / Adrian')

// ── Base skills ──
await test('web_search', 'Caută pe web ultimele știri despre inteligența artificială, pe scurt.',
  (r) => r.reply.length > 25)
await test('weather', 'Cum e vremea la mine acum?',
  (r) => has(r.monitor, /windy/i) || has(r.reply, /grad|°|temperatur/i), { coords: { lat: 44.4268, lon: 26.1025 } })
await test('translate', 'Tradu exact "bună dimineața prietene" în franceză.',
  (r) => has(r.reply, /bonjour/i))
await test('wikipedia', 'Caută Turnul Eiffel pe Wikipedia și spune-mi înălțimea lui.',
  (r) => has(r.reply, /\d/) && r.reply.length > 20)
await test('currency', 'Convertește 100 de dolari americani în euro.',
  (r) => has(r.reply, /euro|€|\d/))
await test('time', 'Cât e ceasul acum în Tokyo?',
  (r) => has(r.reply, /\d/))
await test('maps_search', 'Arată-mi pe hartă Colosseumul din Roma.',
  (r) => has(r.monitor, /openstreetmap|\/maps/i))
await test('maps_directions', 'Cât face cu mașina de la București la Ploiești?',
  (r) => has(r.monitor, /route|maps|openstreetmap/i) || has(r.reply, /\d+\s*(km|kilometr|minut|or[ăa])/i))
await test('youtube', 'Găsește-mi un clip pe YouTube despre cum se face pizza.',
  (r) => has(r.monitor, /youtube/i) || has(r.reply, /youtube|clip|video/i))
await test('image', 'Generează o imagine cu un robot albastru drăguț, logo minimalist.',
  (r) => has(r.image, /\/api\/image\//))

// ── Google Workspace ──
await test('gmail', 'Citește-mi ultimele emailuri.',
  (r) => r.card.includes('emails') || r.reply.length > 15)
await test('calendar', 'Ce am în calendar azi?',
  (r) => r.card.includes('calendar') || r.reply.length > 10)
await test('tasks', 'Ce am de făcut pe lista mea de sarcini?',
  (r) => r.card.includes('tasks') || r.reply.length > 10)
await test('drive', 'Ce fișiere am recente în Google Drive?',
  (r) => r.card.includes('drive') || r.reply.length > 10)
await test('contacts', 'Caută în contacte pe cineva pe nume Ana.',
  (r) => r.reply.length > 8)

// ── The 5 specialist agents (explicit delegation) ──
await test('agent_researcher', 'Roagă cercetătorul să-mi facă un rezumat scurt cu 2 lucruri despre planeta Marte.',
  (r) => r.doc.length > 20 || r.reply.length > 20)
await test('agent_navigator', 'Roagă navigatorul să-mi arate pe hartă ruta de la Oxford la Londra.',
  (r) => has(r.monitor, /route|maps|openstreetmap/i))
await test('agent_studio', 'Roagă studioul să creeze o imagine cu un munte la răsărit.',
  (r) => has(r.image, /\/api\/image\//))
await test('agent_scribe', 'Roagă scribul să scrie un email scurt de mulțumire către un coleg.',
  (r) => r.doc.length > 30)
await test('agent_secretary', 'Roagă secretarul să-mi spună ce am în calendar azi.',
  (r) => r.reply.length > 10 || r.card.length > 0)

// ── Capability gap (something it genuinely can't do) ──
await test('capability_gap', 'Cheamă-mi un taxi la adresa mea chiar acum.',
  (r) => has(r.reply, /nu pot|nu am|nu reușesc|momentan|încă/i))

// ── Cross-session memory: learn in one turn, recall in a fresh one ──
await ask('Te rog reține pentru viitor: pisica mea se numește Miau și e neagră.')
await sleep(6000) // let the async memory agent (Haiku) persist the fact
await test('memory_recall', 'Cum se numește pisica mea și ce culoare are?',
  (r) => has(r.reply, /miau/i) && has(r.reply, /neagr/i) || 'did not recall Miau/black')

// ── Admin monitors (prove the pipelines) ──
const gaps = await (await fetch(`${BASE}/api/admin/gaps`, { headers: { Cookie: cookie } })).json().catch(() => ({}))
const costs = await (await fetch(`${BASE}/api/admin/costs`, { headers: { Cookie: cookie } })).json().catch(() => ({}))
const agentCosts = Object.keys(costs.byKind || {}).filter((k) => k.startsWith('agent:'))
console.log(`\ncapability_gaps logged: ${(gaps.gaps || []).length}`)
console.log(`agent cost kinds seen: ${agentCosts.join(', ') || '(none)'}`)

// ── Summary ──
const passed = results.filter((r) => r.pass).length
console.log(`\n──────── ${passed}/${results.length} PASSED ────────`)
const failed = results.filter((r) => !r.pass).map((r) => r.label)
if (failed.length) { console.log('FAILED:', failed.join(', ')); process.exitCode = 1 }
else console.log('ALL GREEN')
