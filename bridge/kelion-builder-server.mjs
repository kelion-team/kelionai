#!/usr/bin/env node
// CONSTRUCTORUL HEADLESS KELION (server Contabo, systemd: kelion-builder).
// Ruleaza INVIZIBIL pe server — zero ferestre, nici pe laptop, nici pe server.
//
// Flux profesional (livrare continua cu poarta de aprobare):
//   1. Trage ordinele de lucru (GET /api/bridge/workorders).
//   2. Pentru fiecare: ruleaza `claude -p` in repo, il lasa sa editeze + compileze
//      + testeze. NU publica.
//   3. STAGEAZA un release (POST /api/bridge/stage-release) cu ce s-a schimbat.
//   4. Adrian aproba din tab-ul Admin "Release-uri".
//   5. Constructorul vede aprobarea (GET /api/bridge/approved-releases) si abia
//      ATUNCI face deploy (railway up), apoi marcheaza publicat.
//
// MONITOR LIVE (ordinul lui Adrian, 4 iul: "trebuie sa vad live cu ce te ocupi
// pe monitor"): constructorul NU mai lucreaza mut. Claude ruleaza cu
// --output-format stream-json, iar fiecare pas real (fisier citit, fisier
// modificat, comanda rulata) e tradus intr-o linie umana si impins imediat pe
// monitorul lui Adrian (POST /api/bridge/activity), cu bara procesului
// avansand pe etape (POST /api/bridge/progress). Doar PASII apar pe monitor —
// niciodata textul intern al modelului (regula: fara note interne scurse).
//
// SIGURANTA: nimic nu ajunge live fara aprobarea umana (pasul 4). Executia de
// build ruleaza doar in repo-ul proiectului.
//
// Mediu (din /root/kelion/claude.env): BRIDGE_SECRET, CLAUDE_CODE_OAUTH_TOKEN,
// RAILWAY_TOKEN (pentru deploy). Repo la /root/kelion/app (clona proiectului).
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'

const BASE = process.env.KELION_BASE || 'https://kelionai.app'
const REPO = process.env.KELION_REPO || '/root/kelion/app'
const SECRET = (process.env.BRIDGE_SECRET || readSecret()).trim()
function readSecret() {
  try { return readFileSync('/root/kelion/bridge-secret.txt', 'utf8') } catch { return '' }
}
if (!SECRET) { console.error('BRIDGE_SECRET lipsa'); process.exit(1) }
const H = { 'content-type': 'application/json', 'x-bridge-secret': SECRET }

async function api(path, method = 'GET', body) {
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json()
}

// ── Linia live catre monitor: coada serializata (ordinea pasilor se pastreaza,
// un pas pe ~0.7s ca sa nu inece serverul), fire-and-forget — o cadere de retea
// nu opreste niciodata constructia.
const actQueue = []
let draining = false
function say(line) {
  if (!line || line === actQueue[actQueue.length - 1]) return
  actQueue.push(line)
  if (!draining) void drain()
}
async function drain() {
  draining = true
  while (actQueue.length) {
    const line = actQueue.shift()
    await api('/api/bridge/activity', 'POST', { line }).catch(() => {})
    if (actQueue.length) await new Promise((r) => setTimeout(r, 700))
  }
  draining = false
}

// Bara procesului 0→100% (preluare → executie → verificare → gata/deploy).
function pushProgress(pct, label, file = '') {
  void api('/api/bridge/progress', 'POST', { pct, label, file }).catch(() => {})
}

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    const c = spawn(cmd, args, { cwd: REPO, env: process.env, ...opts })
    let out = ''
    const t = setTimeout(() => c.kill('SIGKILL'), opts.timeoutMs || 600000)
    c.stdout?.on('data', (d) => (out += d))
    c.stderr?.on('data', (d) => (out += d))
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out }) })
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e) }) })
  })
}

// Claude in mod streaming: fiecare eveniment (tool_use) ajunge la onEvent PE
// MASURA ce se intampla; rezultatul final (textul cu SUMAR:) se intoarce la final.
function runClaudeLive(prompt, onEvent, timeoutMs) {
  return new Promise((resolve) => {
    const c = spawn('claude', [
      '-p', prompt,
      '--model', 'claude-fable-5',
      '--allowedTools', 'Read,Edit,Write,Bash',
      '--output-format', 'stream-json', '--verbose',
    ], { cwd: REPO, env: process.env })
    let buf = ''
    let finalText = ''
    const t = setTimeout(() => c.kill('SIGKILL'), timeoutMs)
    c.stdout.on('data', (d) => {
      buf += d
      let i
      while ((i = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (!line) continue
        try {
          const ev = JSON.parse(line)
          if (ev.type === 'result' && typeof ev.result === 'string') finalText = ev.result
          onEvent(ev)
        } catch { /* linie partiala/non-JSON — ignorata */ }
      }
    })
    c.stderr.on('data', () => {})
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out: finalText }) })
    c.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: String(e) }) })
  })
}

// Un tool_use → o linie umana pentru monitor. Numai actiuni, niciodata textul
// intern al modelului.
function baseName(p) { return String(p || '').split('/').pop() || '' }
function toolLine(t) {
  const i = t.input || {}
  switch (t.name) {
    case 'Read': return `📖 Citesc ${baseName(i.file_path)}`
    case 'Edit':
    case 'MultiEdit': return `✏️ Modific ${baseName(i.file_path)}`
    case 'Write': return `📝 Scriu ${baseName(i.file_path)}`
    case 'Bash': return `💻 Rulez: ${String(i.description || i.command || '').replace(/\s+/g, ' ').slice(0, 70)}`
    case 'Grep':
    case 'Glob': return `🔍 Caut în cod: ${String(i.pattern || '').slice(0, 50)}`
    default: return `🛠️ ${t.name}`
  }
}
// Fisierul "in lucru" pentru bara — doar cand pasul chiar atinge un fisier.
function toolFile(t) {
  const i = t.input || {}
  return t.name === 'Edit' || t.name === 'Write' || t.name === 'MultiEdit' || t.name === 'Read'
    ? baseName(i.file_path)
    : ''
}

async function build(order) {
  // Claude editeaza + compileaza in repo. NU publica (interzis explicit).
  const prompt =
    `Esti constructorul Kelionai. Sarcina de la Adrian: "${order.text}". ` +
    `Editeaza codul in acest repo ca sa o rezolvi. Compileaza (npm run build in backend SI frontend) ` +
    `pana trece fara erori. NU face deploy, NU rula railway. La final scrie pe o singura linie, ` +
    `dupa "SUMAR:", ce ai schimbat.`
  const short = order.text.replace(/\s+/g, ' ').slice(0, 70)
  say(`🔨 Am preluat ordinul și încep execuția: ${short}`)
  pushProgress(10, 'Execuție')
  // Puls de prezenta cat lucreaza Claude: monitorul ramane LIVE chiar si in
  // pauzele lungi de gandire (fara pasi noi >60s, altfel feed-ul s-ar stinge).
  const hb = setInterval(() => { void api('/api/dev/heartbeat', 'POST', {}).catch(() => {}) }, 20_000)
  let steps = 0
  let lastFile = ''
  const res = await runClaudeLive(prompt, (ev) => {
    if (ev.type !== 'assistant') return
    const blocks = ev.message?.content
    if (!Array.isArray(blocks)) return
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue
      steps++
      const f = toolFile(b)
      if (f) lastFile = f
      say(toolLine(b))
      // Executia umple 12→84%; verificarea si stagearea duc restul pana la 100.
      pushProgress(Math.min(84, 12 + steps * 2), 'Execuție', lastFile)
    }
  }, 900000)
  clearInterval(hb)
  if (res.code !== 0) say('⚠️ Execuția s-a terminat cu erori — detaliile în Admin → Release-uri')
  else say('🧪 Execuția s-a încheiat — verific ce s-a schimbat')
  pushProgress(90, 'Verificare')
  const diff = (await run('git', ['diff', '--stat'])).out
  const sumMatch = res.out.match(/SUMAR:\s*(.+)/)
  const title = (sumMatch ? sumMatch[1] : order.text).slice(0, 180)
  const detail = `Ordin: ${order.text}\n\n--- ce s-a schimbat (git diff --stat) ---\n${diff}\n\n--- notele constructorului ---\n${res.out.slice(-2000)}`
  await api('/api/bridge/stage-release', 'POST', { title, detail })
  say(`✅ Gata: ${title.slice(0, 100)} — aștept aprobarea (Admin → Release-uri)`)
  pushProgress(100, 'Gata — aștept aprobarea')
}

async function deployApproved(r) {
  say(`🚀 Aprobat — public pe producție: ${String(r.title || r.id).slice(0, 80)}`)
  pushProgress(94, 'Deploy')
  const res = await run('railway', ['up', '--detach'], { timeoutMs: 600000 })
  if (res.code === 0) {
    await api('/api/bridge/release-deployed', 'POST', { id: r.id })
    say('🟢 PUBLICAT LIVE pe kelionai.app')
    pushProgress(100, 'Publicat live')
  } else {
    console.error('deploy esuat:', res.out.slice(-500))
    say('🔴 Deploy eșuat — nimic nu s-a publicat (detalii în jurnalul serverului)')
  }
}

async function main() {
  console.log('Constructorul Kelion (headless) pornit ->', BASE, 'repo', REPO)
  for (;;) {
    try {
      const { orders } = await api('/api/bridge/workorders')
      for (const o of orders || []) await build(o)
      const { releases } = await api('/api/bridge/approved-releases')
      for (const r of releases || []) await deployApproved(r)
    } catch (e) {
      console.error('bucla:', e.message)
    }
    await new Promise((r) => setTimeout(r, 20000))
  }
}
void main()
