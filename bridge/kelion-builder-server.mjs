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
  const r = await fetch(BASE + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  if (!r.ok) throw new Error(`${path} -> ${r.status}`)
  return r.json()
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

async function build(order) {
  // Claude editeaza + compileaza in repo. NU publica (interzis explicit).
  const prompt =
    `Esti constructorul Kelionai. Sarcina de la Adrian: "${order.text}". ` +
    `Editeaza codul in acest repo ca sa o rezolvi. Compileaza (npm run build in backend SI frontend) ` +
    `pana trece fara erori. NU face deploy, NU rula railway. La final scrie pe o singura linie, ` +
    `dupa "SUMAR:", ce ai schimbat.`
  const res = await run('claude', ['-p', prompt, '--model', 'claude-fable-5', '--allowedTools', 'Read,Edit,Write,Bash'], { timeoutMs: 900000 })
  const diff = (await run('git', ['diff', '--stat'])).out
  const sumMatch = res.out.match(/SUMAR:\s*(.+)/)
  const title = (sumMatch ? sumMatch[1] : order.text).slice(0, 180)
  const detail = `Ordin: ${order.text}\n\n--- ce s-a schimbat (git diff --stat) ---\n${diff}\n\n--- notele constructorului ---\n${res.out.slice(-2000)}`
  await api('/api/bridge/stage-release', 'POST', { title, detail })
}

async function deployApproved(r) {
  const res = await run('railway', ['up', '--detach'], { timeoutMs: 600000 })
  if (res.code === 0) await api('/api/bridge/release-deployed', 'POST', { id: r.id })
  else console.error('deploy esuat:', res.out.slice(-500))
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
