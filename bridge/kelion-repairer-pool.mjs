#!/usr/bin/env node
// SUPERVIZOR — POOL ELASTIC DE REPARATORI (Adrian, 12 iul: „mai mulți reparatori
// sincronizați care se opresc când termină, ca să nu consume, și repornesc când
// cresc sarcinile automat").
//
// Ce face (ieftin când e liniște, se întinde când e coadă):
//   - ține 1 proces DEPLOY_ONLY (publică release-urile aprobate);
//   - numără ordinele în așteptare (GET /api/bridge/workorders/pending-count);
//   - pornește reparatori efemeri (REPAIRER_MODE) până la MAX, câți ordine sunt
//     în coadă; fiecare în WORKTREE-UL LUI (git worktree) → nu se bat pe git;
//   - reparatorii revendică UN ordin (atomic, /workorders/claim), îl repară,
//     revin după altul; când coada e goală → ies singuri (scale-to-zero).
//
// SIGURANȚĂ (0 stricăciuni): NU atinge constructorul clasic. Ca să comuți pe pool,
// oprești `kelion-builder` și pornești ăsta; ca să revii, invers. Revenire instant.
//
// Config din env (sau /root/kelion/claude.env): KELION_BASE, BRIDGE_SECRET.
//   MAX_REPAIRERS (impl. 3), POLL_MS (impl. 8000), KELION_REPO, WT_BASE.
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const CLAUDE_ENV = '/root/kelion/claude.env'
function loadEnvFile(path) {
  const out = {}
  if (!existsSync(path)) return out
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([^#=\s]+)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    let v = m[2]
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
const FILE_ENV = loadEnvFile(CLAUDE_ENV)
const BASE = (process.env.KELION_BASE || FILE_ENV.KELION_BASE || 'https://kelionai.app').trim()
const SECRET = (process.env.BRIDGE_SECRET || FILE_ENV.BRIDGE_SECRET || '').trim()
const REPO =
  [process.env.KELION_REPO, FILE_ENV.KELION_REPO, '/root/kelion/repo', '/root/kelion']
    .filter(Boolean)
    .find((d) => existsSync(`${d}/bridge/kelion-builder-server.mjs`)) || '/root/kelion/repo'
const BUILDER = `${REPO}/bridge/kelion-builder-server.mjs`
const MAX_REPAIRERS = Math.max(1, Number(process.env.MAX_REPAIRERS || 3))
const POLL_MS = Math.max(2000, Number(process.env.POLL_MS || 8000))
const WT_BASE = process.env.WT_BASE || '/root/kelion/wt'

function log(...a) {
  console.log(`[pool ${new Date().toISOString()}]`, ...a)
}
if (!SECRET) {
  console.error('[pool EROARE] BRIDGE_SECRET lipsește (env sau claude.env)')
  process.exit(1)
}

function run(cmd, args, opts = {}) {
  return new Promise((res) => {
    const c = spawn(cmd, args, { stdio: 'ignore', ...opts })
    c.on('close', (code) => res(code))
    c.on('error', () => res(-1))
  })
}

const childEnv = () => ({
  ...process.env,
  KELION_BASE: BASE,
  BRIDGE_SECRET: SECRET,
})

// ── Proces DEPLOY_ONLY (persistent): publică release-urile aprobate ──────────
let deployer = null
function ensureDeployer() {
  if (deployer && deployer.exitCode === null) return
  log('pornesc procesul DEPLOY_ONLY (publică release-urile aprobate)')
  deployer = spawn('node', [BUILDER], {
    env: { ...childEnv(), DEPLOY_ONLY: '1', KELION_REPO: REPO },
    stdio: 'inherit',
  })
  deployer.on('exit', (code) => {
    log(`DEPLOY_ONLY a ieșit (cod ${code}) — îl repornesc la următorul ciclu`)
    deployer = null
  })
}

// ── Reparatori efemeri (scale up pe coadă, ies singuri când e goală) ─────────
const workers = new Map() // tag -> child
let nextTag = 1

async function ensureWorktree(tag) {
  const wt = `${WT_BASE}-${tag}`
  // Worktree pe origin/master proaspăt. Dacă există deja, doar îl resetez.
  await run('bash', [
    '-lc',
    `cd ${REPO} && git fetch origin master -q || true; ` +
      `if [ -d ${wt} ]; then cd ${wt} && git reset --hard origin/master -q || true; ` +
      `else git worktree add -f ${wt} origin/master >/dev/null 2>&1 || true; fi`,
  ])
  return wt
}

async function spawnRepairer() {
  const tag = nextTag++
  const wt = await ensureWorktree(tag)
  log(`pornesc reparatorul ${tag} (worktree ${wt})`)
  const child = spawn('node', [BUILDER], {
    env: { ...childEnv(), REPAIRER_MODE: '1', REPAIRER_TAG: String(tag), KELION_REPO: wt },
    stdio: 'inherit',
  })
  workers.set(tag, child)
  child.on('exit', (code) => {
    workers.delete(tag)
    log(`reparatorul ${tag} a ieșit (cod ${code}); reparatori activi: ${workers.size}`)
  })
}

async function pendingCount() {
  const r = await fetch(`${BASE}/api/bridge/workorders/pending-count`, {
    headers: { 'x-bridge-secret': SECRET },
    signal: AbortSignal.timeout(10_000),
  })
  const j = await r.json()
  return Number(j?.count || 0)
}

async function loop() {
  ensureDeployer()
  let pending = 0
  try {
    pending = await pendingCount()
  } catch (e) {
    log('nu pot citi coada:', String(e).slice(0, 80))
    return
  }
  const running = workers.size
  // Câți vrem: min(MAX, câte ordine sunt). Nu pornim mai mulți decât e treabă.
  const desired = Math.min(MAX_REPAIRERS, pending)
  if (desired > running) {
    for (let i = running; i < desired; i++) await spawnRepairer()
    log(`coadă ${pending} → scale up la ${Math.min(desired, MAX_REPAIRERS)} reparatori`)
  }
  // Scale-down e AUTOMAT: reparatorii ies singuri când coada se golește
  // (claim → null → process.exit). Supervizorul nu-i omoară — se sting singuri.
}

log(`START — pool elastic. BASE=${BASE} REPO=${REPO} MAX=${MAX_REPAIRERS} poll=${POLL_MS}ms`)
async function main() {
  for (;;) {
    try {
      await loop()
    } catch (e) {
      log('ciclu:', String(e).slice(0, 120))
    }
    await new Promise((r) => setTimeout(r, POLL_MS))
  }
}
void main()
