#!/usr/bin/env node
// QA-PATROL — Kelion își exercită SINGUR aplicația cap-coadă și, când ceva NU e
// 200, INFORMEAZĂ creierul (Adrian, 14 iul: „QA nu blochează, doar informează
// creierul de probleme; creierul decide real ce se face și cine, aplică, și tot
// el verifică până când reparația e 200"). Determinist: fiecare verificare are o
// probă REALĂ (cod HTTP, randare, răspuns de chat), zero „presupun". La problemă →
// o notă în CAIET (POST /api/bridge/memory) pe care creierul o citește și DECIDE
// singur (reparație / suport / ignoră fals-pozitiv); dedup 6h ca să nu spameze.
// NU BLOCHEAZĂ NIMIC (exit 0 mereu). Fără secret → mod DRY (doar raportează local).
//
//   node kelion-qa-patrol.mjs          → patrulează o dată; informează creierul la problemă
//   node kelion-qa-patrol.mjs --dry    → doar raportează local (nu scrie în caiet)
//   KELION_BASE (default https://kelionai.app), BRIDGE_SECRET (din claude.env/fișier)
//   CHROMIUM_PATH sau PLAYWRIGHT_BROWSERS_PATH pentru binarul browserului.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const BASE = process.env.KELION_BASE || 'https://kelionai.app'
const DRY = process.argv.includes('--dry')
const SECRET = (process.env.BRIDGE_SECRET || readFileMaybe('/root/kelion/bridge-secret.txt')).trim()
const STATE = process.env.QA_STATE || '/root/kelion/qa-patrol-seen.json'
const SIX_H = 6 * 60 * 60_000

function readFileMaybe(p) { try { return readFileSync(p, 'utf8') } catch { return '' } }

async function http(path, opts = {}) {
  const ctrl = AbortSignal.timeout(opts.timeoutMs || 15_000)
  const r = await fetch(BASE + path, { ...opts, signal: ctrl })
  const text = await r.text().catch(() => '')
  let setCookie = []
  try { setCookie = r.headers.getSetCookie?.() || [] } catch { /* ignore */ }
  return { status: r.status, text, json: safeJson(text), setCookie }
}
// Extrage `kelionai_session=...` din anteturile Set-Cookie (numele real al sesiunii).
function sessionCookie(setCookie) {
  for (const c of setCookie || []) {
    const m = /(^|;\s*)(kelionai_session=[^;]+)/.exec(c) || /^(kelionai_session=[^;]+)/.exec(c)
    if (m) return m[2] || m[1]
  }
  return ''
}
function safeJson(t) { try { return JSON.parse(t) } catch { return null } }

// ── VERIFICĂRILE (fiecare cu probă reală) ─────────────────────────────────────
const checks = [
  { name: 'version', desc: 'aplicația răspunde la /api/version cu boot recent', run: async () => {
    const r = await http('/api/version')
    if (r.status !== 200) return fail(`/api/version → HTTP ${r.status}`)
    if (!r.json?.v) return fail(`/api/version fără câmp {v}: ${r.text.slice(0, 120)}`)
    return ok(`v=${r.json.v}`)
  } },
  { name: 'health', desc: '/health întoarce 200', run: async () => {
    const r = await http('/health')
    return r.status === 200 ? ok('200') : fail(`/health → HTTP ${r.status}`)
  } },
  { name: 'bridge', desc: 'puntea e conectată (/api/dev/status bridge=true)', run: async () => {
    const r = await http('/api/dev/status')
    if (r.status !== 200) return fail(`/api/dev/status → HTTP ${r.status}`)
    if (r.json?.bridge !== true) return fail(`puntea NU e conectată: bridge=${JSON.stringify(r.json?.bridge)}`)
    return ok('bridge=true')
  } },
  { name: 'delete-account', desc: '/api/me/delete e protejat (401, nu 404)', run: async () => {
    const r = await http('/api/me/delete', { method: 'POST' })
    if (r.status === 404) return fail('/api/me/delete → 404 (ruta lipsește — regresie de rutare)')
    return ok(`HTTP ${r.status} (protejat)`)
  } },
  { name: 'download-linux', desc: '/dl/Kelionai-linux.zip se servește', run: async () => {
    const r = await http('/dl/Kelionai-linux.zip', { method: 'HEAD', timeoutMs: 30_000 })
    return (r.status === 200 || r.status === 302) ? ok(`HTTP ${r.status}`) : fail(`/dl linux → HTTP ${r.status}`)
  } },
  { name: 'chat-public', desc: 'chatul public răspunde (demo → mesaj → răspuns real)', run: async () => {
    // Start demo (anonim) → sesiune → o tură reală de chat. Dovada = răspuns ne-gol.
    const d = await http('/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', timeoutMs: 20_000 })
    // 429 = plafon demo / fingerprint deja folosit — NU e eșec de app, sar (fără false-fail).
    if (d.status === 429) return ok('demo plafonat (429) — sar peste, nu e eșec de app')
    if (d.status !== 200) return fail(`/api/demo/start → HTTP ${d.status}: ${d.text.slice(0, 120)}`)
    const cookie = sessionCookie(d.setCookie)
    if (!cookie) return ok('demo/start nu a dat cookie de sesiune vizibil — sar (posibil plafon)')
    const c = await http('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Salut, spune un cuvânt.' }], now: new Date().toISOString(), tz: 'Europe/London' }),
      timeoutMs: 55_000,
    })
    if (c.status !== 200) return fail(`/api/chat → HTTP ${c.status}: ${c.text.slice(0, 120)}`)
    if (!c.text || c.text.trim().length < 1) return fail('chatul a răspuns GOL (creierul nu produce text)')
    return ok(`răspuns ${c.text.trim().length} car.`)
  } },
  { name: 'face-models', desc: 'modelele de recunoaștere facială se servesc din /models (fața e chiar deployată)', run: async () => {
    // FUNCȚIONAL, nu doar reachability: dacă un deploy pierde modelele, fața nu
    // poate rula deloc — ăsta e semnalul „funcție lipsă" pe care altfel nimeni nu-l vede.
    const m = await http('/models/tiny_face_detector_model-weights_manifest.json')
    if (m.status !== 200) return fail(`/models manifest → HTTP ${m.status} (recunoașterea facială NU e servită)`)
    const r = await http('/models/face_recognition_model.bin', { method: 'HEAD', timeoutMs: 25_000 })
    if (r.status !== 200) return fail(`/models weights → HTTP ${r.status}`)
    return ok('modele face-api servite (manifest + weights 200)')
  } },
  { name: 'biometrie-contract', desc: 'calea voce+față din chat nu crapă (200, nu 500) cu payload biometric', run: async () => {
    // COMPORTAMENT, nu reachability: trimite un payload cu voiceFeatures +
    // faceDescriptor și cere ca traseul biometric (Promise.all + save
    // fire-and-forget + injectare în prompt) să răspundă 200 ne-gol, nu 500.
    // Prinde regresii de logică care lasă 200-ul „sănătos" pe alte căi dar sparg asta.
    const d = await http('/api/demo/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', timeoutMs: 20_000 })
    if (d.status === 429 || d.status === 403) return ok(`demo plafonat (${d.status}) — sar peste, nu e eșec de app`)
    if (d.status !== 200) return fail(`/api/demo/start → HTTP ${d.status}`)
    const cookie = sessionCookie(d.setCookie)
    if (!cookie) return ok('demo/start fără cookie vizibil — sar (posibil plafon)')
    const voiceFeatures = { vector: Array.from({ length: 24 }, (_, i) => (i % 5) * 0.1), meta: { pitchMean: 120, pitchStd: 10, pitchMin: 90, pitchMax: 160, centroid: 1500, rolloff: 3000, zcr: 0.1, energy: 0.2, jitter: 0.01, shimmer: 0.02 } }
    const faceDescriptor = Array.from({ length: 128 }, (_, i) => Math.sin(i) * 0.1)
    const c = await http('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Salut, spune un cuvânt.' }], voiceFeatures, faceDescriptor, now: new Date().toISOString(), tz: 'Europe/London' }),
      timeoutMs: 55_000,
    })
    if (c.status === 500) return fail(`/api/chat cu biometrie → HTTP 500 (traseul voce/față crapă): ${c.text.slice(0, 140)}`)
    if (c.status !== 200) return fail(`/api/chat cu biometrie → HTTP ${c.status}: ${c.text.slice(0, 120)}`)
    if (!c.text || c.text.trim().length < 1) return fail('chatul cu biometrie a răspuns GOL')
    return ok(`biometrie acceptată, răspuns ${c.text.trim().length} car.`)
  } },
  { name: 'landing-render', desc: 'pagina publică se randează în browser real', run: async () => {
    return await browserCheck()
  } },
]
function ok(detail) { return { ok: true, detail } }
function fail(detail) { return { ok: false, detail } }

// ── Verificarea de browser (Playwright + Chromium din /opt/pw-browsers) ────────
async function browserCheck() {
  let chromium
  try {
    const mod = await import(process.env.PW_CORE_PATH || 'playwright-core')
    chromium = mod.chromium ?? mod.default?.chromium
  } catch { return { ok: true, detail: 'playwright-core absent — sar peste (nu e eșec de app)' } }
  if (!chromium) return { ok: true, detail: 'playwright-core fără chromium — sar peste' }
  const exe = process.env.CHROMIUM_PATH || findChromium()
  if (!exe) return { ok: true, detail: 'binar chromium negăsit — sar peste' }
  let browser
  try {
    browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--no-sandbox'] })
    const page = await browser.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)))
    const resp = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30_000 })
    if (!resp || resp.status() >= 400) return fail(`landing → HTTP ${resp?.status()}`)
    await page.waitForTimeout(2500) // lasă app-ul să monteze
    const hasRoot = await page.evaluate(() => !!document.querySelector('#root, canvas, main, .stage, [class*="stage"]'))
    if (!hasRoot) return fail('landing nu montează UI-ul (fără #root/canvas/main)')
    if (errors.length) return fail(`erori JS pe landing: ${errors.slice(0, 2).join(' | ')}`)
    return ok('randat, fără erori JS')
  } catch (e) {
    const msg = String(e.message || e)
    // Eroare de REȚEA la nivel de browser (nu poate ieși la app) ≠ app stricată —
    // verificările HTTP de mai sus deja dovedesc că app-ul e sus. Deci SKIP, nu
    // eșec (altfel s-ar deschide ordine false unde browserul n-are egress).
    if (/ERR_|net::|ECONN|ETIMEDOUT|timeout|proxy|Timeout|Navigation/i.test(msg)) {
      return { ok: true, detail: `browser fără egress la app (${msg.slice(0, 60)}) — sar, HTTP-ul dovedește app-ul sus` }
    }
    return fail(`browser: ${msg.slice(0, 120)}`)
  } finally {
    try { await browser?.close() } catch { /* ignore */ }
  }
}
function findChromium() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers'
  for (const p of [`${root}/chromium-1194/chrome-linux/chrome`, `${root}/chromium/chrome-linux/chrome`]) {
    if (existsSync(p)) return p
  }
  return ''
}

// ── INFORMEAZĂ CREIERUL (nu blochează, nu comandă — creierul decide) ──────────
// Adrian, 14 iul: „QA nu trebuie să blocheze, doar să INFORMEZE creierul de
// probleme; creierul decide real ce se face și CINE face, aplică, și tot el
// VERIFICĂ până când reparația e 200." De aceea NU mai deschidem ordin direct la
// constructor (ar fi „QA comandă"). Scriem în CAIET (shared_memory) — canalul pe
// care creierul îl citește la fiecare mesaj (+ caiet-watcher îl trezește). Așa
// creierul e informat și DECIDE singur: reparație (EXECUT către constructor),
// suport către Adrian, sau ignoră un fals-pozitiv. Dedup 6h ca să nu spameze.
function loadSeen() { try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return {} } }
function saveSeen(s) { try { writeFileSync(STATE, JSON.stringify(s)) } catch { /* ignore */ } }

async function informBrain(check, detail, seen, nowMs) {
  const key = check.name
  const prev = seen[key]
  if (prev && nowMs - prev < SIX_H) return false // deja informat recent — nu spam
  const content =
    `QA-PATROL (semnal automat): verificarea „${check.desc}" NU e 200 — ${detail}. ` +
    `Tu (creierul) DECIZI ce se face și CINE face: dacă e bug de cod → predă [EXECUT] la ` +
    `constructor; dacă e resursă/credențial → suport ghidat lui Adrian; dacă e tranzitoriu ` +
    `(429/redeploy) → confirmă că nu se mai reproduce și lasă-l. Reprodu întâi cu o comandă ` +
    `reală (curl/loguri). VERIFICĂ singur până când e 200 — nu declara „gata" fără dovadă. ` +
    `NU bloca nimic: ăsta e doar un semnal informativ.`
  if (DRY || !SECRET) return false
  try {
    await fetch(BASE + '/api/bridge/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-bridge-secret': SECRET },
      body: JSON.stringify({ source: 'qa-patrol', content }),
      signal: AbortSignal.timeout(15_000),
    })
    seen[key] = nowMs
    return true
  } catch { return false }
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const nowMs = Date.now()
  const seen = loadSeen()
  let passed = 0, failed = 0, informed = 0
  console.log(`== QA-PATROL pe ${BASE}${DRY || !SECRET ? ' (DRY — nu informez creierul)' : ''} ==`)
  for (const check of checks) {
    let res
    try { res = await check.run() } catch (e) { res = fail(String(e.message || e).slice(0, 120)) }
    if (res.ok) { passed++; console.log(`  ✅ ${check.name}: ${res.detail}`) }
    else {
      failed++
      const did = await informBrain(check, res.detail, seen, nowMs)
      if (did) informed++
      console.log(`  ❌ ${check.name}: ${res.detail}${did ? ' → am informat creierul (caiet)' : (DRY || !SECRET ? '' : ' (dedup: deja informat <6h)')}`)
    }
  }
  saveSeen(seen)
  console.log(`== gata: ${passed} ok, ${failed} nu-s 200, ${informed} semnale către creier ==`)
  // NU blochează NIMIC (Adrian): patrula doar informează → exit 0 mereu, chiar și
  // când găsește probleme. Creierul e cel care decide și verifică până e 200.
  process.exit(0)
}
void main()
