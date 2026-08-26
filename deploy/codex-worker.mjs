#!/usr/bin/env node
// Clientul separat al cozii Constructor. Nu conține autentificare OpenAI,
// token GitHub, push, merge sau deploy. Autentificarea se face interactiv,
// exclusiv cu CLI-ul oficial `codex login`, în CODEX_HOME-ul acestui worker.

import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  renameSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

const API = new URL(process.env.KELION_CODEX_API ?? 'http://127.0.0.1:8080/')
const CODEX_BIN = process.env.CODEX_BIN ?? 'codex'
const REPO = resolve(process.env.CODEX_WORKER_REPO ?? '/var/lib/kelion-codex/repo')
const JOBS = resolve(process.env.CODEX_WORKER_JOBS ?? '/var/lib/kelion-codex/jobs')
const AUTH_HOME = resolve(process.env.CODEX_HOME ?? '/var/lib/kelion-codex-auth')
const PROFILE_HOME = resolve(process.env.CODEX_WORKER_PROFILE_HOME ?? '/opt/kelion-codex/profile-home')
const HANDOFF_READY = resolve(process.env.CODEX_HANDOFF_READY ?? '/var/lib/kelion-constructor-handoff/ready')
const HANDOFF_ACK = resolve(HANDOFF_READY, '..', 'ack')
const HANDOFF_RETIRED = resolve(HANDOFF_READY, '..', 'retired')

class HandoffDurabilityUncertainError extends Error {
  constructor(cause) {
    super(`Durabilitatea handoff-ului materializat nu a putut fi confirmată: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'HandoffDurabilityUncertainError'
    this.cause = cause
  }
}

function fsyncPath(path) {
  const descriptor = openSync(path, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}
const EXEC_ENABLED = process.env.CODEX_WORKER_EXEC_ENABLED === '1'
const GATE_IMAGE = process.env.KELION_CODEX_GATE_IMAGE ?? ''
const CODEX_VERSION = 'codex-cli 0.149.1'
const PROFILE_NAME = 'kelion-worker'
const ADVERSARIAL_SENTINEL = 'KELION-CODEX-ADVERSARIAL-SENTINEL-V1'
const GITHUB_REPOSITORY = process.env.KELION_GITHUB_REPOSITORY ?? ''
const REQUIRED_LAYOUT = Object.freeze({
  codexBin: '/opt/kelion-codex/bin/codex',
  repo: '/var/lib/kelion-codex/repo',
  jobs: '/var/lib/kelion-codex/jobs',
  authHome: '/var/lib/kelion-codex-auth',
  profileHome: '/opt/kelion-codex/profile-home',
  handoffReady: '/var/lib/kelion-constructor-handoff/ready',
  bwrap: '/usr/bin/bwrap',
  podman: '/usr/bin/podman',
})
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RECOVERY_GUIDANCE = Object.freeze({
  stale_base: 'Reexecută ordinul peste vârful master curent; nu reutiliza patch-ul sau baza anterioară.',
  ci_failed: 'Versiunea anterioară a fost respinsă de un control CI obligatoriu. Auditează cauza probabilă și produce o remediere nouă, verificată complet.',
  local_gate_failed: 'Revalidarea izolată a publisherului a respins versiunea anterioară. Reproduce toate porțile și repară orice diferență deterministă.',
  pr_closed: 'PR-ul anterior a fost închis fără merge. Reexecută ordinul curat și produce un handoff nou, fără a reutiliza branch-ul anterior.',
})
const WORKER_FAILURE_CODES = new Set([
  'provider_auth',
  'provider_credit',
  'execution_timeout',
  'test_failure',
  'quality_gate_failure',
  'no_changes',
  'brain_unavailable',
  'codex_exec_failed',
  'worker_internal_failure',
])

function fail(message) {
  throw new Error(message)
}

class WorkerApiError extends Error {
  constructor(path, status, payload) {
    super(`API worker ${path}: HTTP ${status}`)
    this.name = 'WorkerApiError'
    this.status = status
    this.payload = payload
  }
}

function privateLogTail(logPath, maxBytes = 128 * 1024) {
  if (!logPath || !existsSync(logPath)) return ''
  const raw = readFileSync(logPath, 'utf8')
  return raw.slice(-maxBytes)
}

/** Clasifică local jurnalul privat și transmite serverului numai un cod dintr-un
 * catalog fix. Niciun fragment de output (care poate conține secrete) nu iese
 * din contul workerului. */
function classifyWorkerFailure(logPath, phase, result = {}, error = null) {
  const source = `${privateLogTail(logPath)}\n${error instanceof Error ? error.message : ''}`
  if (/credit balance is too low|requires more credits|insufficient.{0,30}credit|payment required|\b402\b/i.test(source)) return 'provider_credit'
  if (/invalid x-api-key|authentication_error|api key not valid|not logged in|unauthorized|\b(?:401|403)\b.{0,80}(?:key|token|auth)/i.test(source)) return 'provider_auth'
  if (result.timedOut || /timed out|timeout|timp.{0,20}depăș/i.test(source)) return 'execution_timeout'
  if (/no changes|working tree clean|fără nicio modificare|nu ai scris nimic/i.test(source)) return 'no_changes'
  if (/model.{0,80}(?:unavailable|invalid|refused)|provider.{0,80}(?:unavailable|error)|brain unavailable|răspuns gol/i.test(source)) return 'brain_unavailable'
  if (phase === 'gate' && /(?:test|vitest|jest|pytest|assert).{0,120}(?:failed|failure|error|picat)/i.test(source)) return 'test_failure'
  if (phase === 'gate') return 'quality_gate_failure'
  if (phase === 'codex') return 'codex_exec_failed'
  return 'worker_internal_failure'
}

function assertWorkerFailureCode(code) {
  if (!WORKER_FAILURE_CODES.has(code)) fail('Cod de eroare worker necanonic')
  return code
}

function assertLoopbackApi() {
  const host = API.hostname.toLowerCase()
  if (
    API.protocol !== 'http:'
    || !['127.0.0.1', '::1', 'localhost'].includes(host)
    || API.username
    || API.password
    || API.search
    || API.hash
  ) {
    fail('KELION_CODEX_API trebuie să fie HTTP loopback, fără credentiale în URL')
  }
}

function assertDescendant(parent, child, label) {
  const prefix = `${resolve(parent)}${process.platform === 'win32' ? '\\' : '/'}`
  if (!resolve(child).startsWith(prefix)) fail(`${label} iese din directorul permis`)
}

function assertRootOwnedReadonly(path, label) {
  const info = statSync(path)
  if (!info.isFile()) fail(`${label} nu este fișier`)
  if (process.platform !== 'win32') {
    if (info.uid !== 0) fail(`${label} nu este deținut de root`)
    if ((info.mode & 0o022) !== 0) fail(`${label} este inscriptibil de grup sau alții`)
  }
}

function codexParentEnv() {
  return {
    PATH: '/usr/bin:/bin',
    HOME: AUTH_HOME,
    CODEX_HOME: AUTH_HOME,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    CI: '1',
  }
}

function sandboxSupervisorEnv() {
  return {
    PATH: '/usr/bin:/bin',
    HOME: '/nonexistent',
    CODEX_HOME: PROFILE_HOME,
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    CI: '1',
  }
}

function podmanSupervisorEnv() {
  const uid = process.getuid?.()
  if (!Number.isSafeInteger(uid)) fail('UID-ul workerului nu este disponibil')
  return {
    PATH: '/usr/bin:/bin',
    HOME: '/var/lib/kelion-codex',
    XDG_RUNTIME_DIR: '/run/kelion-codex',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
  }
}

function gitSupervisorEnv() {
  return {
    PATH: '/usr/bin:/bin',
    HOME: '/nonexistent',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
  }
}

export function codexExecArgs(jobDir) {
  return [
    'exec',
    '--strict-config',
    '--ephemeral',
    '--ignore-user-config',
    '--ignore-rules',
    '--profile', PROFILE_NAME,
    '-C', resolve(jobDir),
    '-',
  ]
}

export function gateContainerArgs(jobDir, image = GATE_IMAGE, identity = {}) {
  const uid = identity.uid ?? process.getuid?.()
  const gid = identity.gid ?? process.getgid?.()
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid)) fail('Identitatea workerului nu este disponibilă')
  return [
    'run', '--rm', '--pull=never', '--network=none', '--read-only',
    '--cap-drop=all', '--security-opt=no-new-privileges',
    '--pids-limit=512', '--memory=4g', '--cpus=2', '--ulimit=nofile=1024:1024',
    '--userns=keep-id', '--user', `${uid}:${gid}`,
    '--tmpfs', `/work:rw,nosuid,nodev,size=6g,uid=${uid},gid=${gid}`,
    '--mount', `type=bind,src=${resolve(jobDir)},dst=/source,ro=true`,
    '--mount', `type=bind,src=${join(REPO, '.git')},dst=${join(REPO, '.git')},ro=true`,
    '--env', 'HOME=/nonexistent', '--env', 'CI=1',
    image,
  ]
}

function sandboxArgs(cwd, command, args) {
  return [
    'sandbox', 'linux',
    '--profile', PROFILE_NAME,
    '--permission-profile', PROFILE_NAME,
    '--cd', resolve(cwd),
    '--', command, ...args,
  ]
}

export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) fail('Valoare JSON neacceptată')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

export function signedHeaders(secret, method, path, body, timestamp, nonce) {
  const bodyHash = createHash('sha256').update(canonicalJson(body)).digest('hex')
  const payload = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`
  const signature = createHmac('sha256', secret).update(payload).digest('hex')
  return {
    'content-type': 'application/json',
    'x-codex-timestamp': timestamp,
    'x-codex-nonce': nonce,
    'x-codex-signature': `v1=${signature}`,
  }
}

function secretPath() {
  if (process.env.CODEX_WORKER_SECRET_FILE) return resolve(process.env.CODEX_WORKER_SECRET_FILE)
  if (process.env.CREDENTIALS_DIRECTORY) return join(process.env.CREDENTIALS_DIRECTORY, 'codex-worker-secret')
  fail('Lipsește credentiala systemd codex-worker-secret')
}

function loadSecret() {
  const path = secretPath()
  const info = statSync(path)
  if (!info.isFile()) fail('Credentiala worker nu este fișier')
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) fail('Credentiala worker are permisiuni prea largi')
  const secret = readFileSync(path, 'utf8').trim()
  if (secret.length < 32 || /[\r\n]/.test(secret)) fail('Credentiala worker trebuie să fie o singură valoare de minimum 32 caractere')
  return secret
}

async function post(secret, path, body) {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomUUID()
  const response = await fetch(new URL(path, API), {
    method: 'POST',
    headers: signedHeaders(secret, 'POST', path, body, timestamp, nonce),
    body: canonicalJson(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) throw new WorkerApiError(path, response.status, payload)
  return payload
}

function commandResult(command, args, cwd = undefined, env = undefined) {
  return spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024,
    timeout: 30_000,
    windowsHide: true,
  })
}

function gitResult(args, cwd, maxBuffer = 256 * 1024) {
  return spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', ...args], {
    cwd,
    env: gitSupervisorEnv(),
    encoding: 'utf8',
    maxBuffer,
    timeout: 60_000,
    windowsHide: true,
  })
}

export function handoffReceipt(input) {
  const receipt = {
    schema: 1,
    kind: 'kelion-constructor-handoff',
    jobId: String(input.jobId),
    taskId: String(input.taskId),
    handoffId: String(input.handoffId),
    baseCommit: String(input.baseCommit),
    patchSha256: String(input.patchSha256),
    gateImage: String(input.gateImage),
    passedAt: String(input.passedAt),
  }
  if (
    !/^[1-9]\d{0,18}$/.test(receipt.jobId)
    || !receipt.taskId.startsWith('codex-')
    || !UUID.test(receipt.taskId.slice('codex-'.length))
    || !UUID.test(receipt.handoffId)
    || !/^[0-9a-f]{40}$/.test(receipt.baseCommit)
    || !/^[0-9a-f]{64}$/.test(receipt.patchSha256)
    || !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/codex-gates@sha256:[0-9a-f]{64}$/.test(receipt.gateImage)
    || !Number.isFinite(Date.parse(receipt.passedAt))
  ) fail('Receipt-ul handoff este invalid')
  return receipt
}

function publishHandoff(jobDir, input) {
  const currentHead = exactOutput('/usr/bin/git', ['rev-parse', 'HEAD'], jobDir, gitSupervisorEnv())
  if (currentHead !== input.baseCommit) fail('Codex a mutat HEAD-ul; workerul acceptă numai patch peste baza revendicată')
  const add = gitResult(['add', '--all', '--', '.'], jobDir)
  if (add.status !== 0) fail('Nu am putut indexa patch-ul după porți')
  const submodules = exactOutput('/usr/bin/git', ['ls-files', '--stage'], jobDir, gitSupervisorEnv())
  if (submodules?.split('\n').some((line) => line.startsWith('160000 '))) fail('Patch-ul nu poate adăuga sau modifica submodule')
  const patch = gitResult(
    ['diff', '--cached', '--binary', '--full-index', '--no-ext-diff', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/', input.baseCommit, '--'],
    jobDir,
    16 * 1024 * 1024,
  )
  if (patch.status !== 0) fail('Nu am putut materializa patch-ul imuabil')
  const patchBytes = Buffer.from(String(patch.stdout ?? ''), 'utf8')
  if (patchBytes.length === 0 || patchBytes.length > 16 * 1024 * 1024) fail('Patch-ul este gol sau depășește limita de 16 MiB')
  const patchSha256 = createHash('sha256').update(patchBytes).digest('hex')
  const handoffId = randomUUID()
  const receipt = handoffReceipt({
    ...input,
    handoffId,
    patchSha256,
    gateImage: GATE_IMAGE,
    passedAt: new Date().toISOString(),
  })
  const receiptBytes = Buffer.from(`${canonicalJson(receipt)}\n`, 'utf8')
  const gateReceiptSha256 = createHash('sha256').update(receiptBytes).digest('hex')
  const handoffRoot = resolve(HANDOFF_READY, '..')
  const stagingRoot = join(handoffRoot, 'staging')
  mkdirSync(HANDOFF_READY, { recursive: true, mode: 0o750 })
  mkdirSync(stagingRoot, { recursive: true, mode: 0o750 })
  const staging = join(stagingRoot, `.${handoffId}.tmp`)
  const target = join(HANDOFF_READY, handoffId)
  assertDescendant(stagingRoot, staging, 'Staging handoff')
  assertDescendant(HANDOFF_READY, target, 'Handoff final')
  if (existsSync(staging) || existsSync(target)) fail('Coliziune de identificator handoff')
  mkdirSync(staging, { mode: 0o750 })
  chmodSync(staging, 0o750)
  try {
    writeFileSync(join(staging, 'patch.diff'), patchBytes, { flag: 'wx', mode: 0o440 })
    writeFileSync(join(staging, 'receipt.json'), receiptBytes, { flag: 'wx', mode: 0o440 })
    chmodSync(join(staging, 'patch.diff'), 0o440)
    chmodSync(join(staging, 'receipt.json'), 0o440)
    fsyncPath(join(staging, 'patch.diff'))
    fsyncPath(join(staging, 'receipt.json'))
    fsyncPath(staging)
    renameSync(staging, target)
    // The DB handoff event is allowed only after both file contents and the
    // directory rename survive a power loss.  fsync both sides of the rename;
    // the root sync also persists newly-created ready/staging entries.
    fsyncPath(stagingRoot)
    fsyncPath(HANDOFF_READY)
    fsyncPath(handoffRoot)
  } catch (error) {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
    if (existsSync(target)) throw new HandoffDurabilityUncertainError(error)
    throw error
  }
  return { handoffId, baseCommit: input.baseCommit, patchSha256, gateReceiptSha256 }
}

function handoffAckPath(handoffId) {
  const path = join(HANDOFF_ACK, `${handoffId}.recorded`)
  assertDescendant(HANDOFF_ACK, path, 'Confirmare handoff')
  return path
}

function markHandoffRecorded(handoffId, outcome = 'recorded') {
  mkdirSync(HANDOFF_ACK, { recursive: true, mode: 0o750 })
  const path = handoffAckPath(handoffId)
  if (existsSync(path)) return
  if (!['recorded', 'stale'].includes(outcome)) fail('Verdict handoff local invalid')
  writeFileSync(path, `${outcome}\n`, { flag: 'wx', mode: 0o440 })
  chmodSync(path, 0o440)
}

/** Publisherul mută atomic materialul confirmat într-un director de retenție;
 * numai workerul care deține fișierele îl șterge recursiv. */
function cleanupRetiredHandoffs() {
  if (!existsSync(HANDOFF_RETIRED)) return 0
  let removed = 0
  for (const entry of readdirSync(HANDOFF_RETIRED, { withFileTypes: true })) {
    if (!entry.isDirectory() || !UUID.test(entry.name)) continue
    const directory = resolve(HANDOFF_RETIRED, entry.name)
    assertDescendant(HANDOFF_RETIRED, directory, 'Handoff retras')
    rmSync(directory, { recursive: true, force: false })
    removed += 1
  }
  return removed
}

function retireAcknowledgedHandoff(handoffId) {
  if (!UUID.test(handoffId)) fail('Identificator handoff invalid la retragere')
  const source = resolve(HANDOFF_READY, handoffId)
  const target = resolve(HANDOFF_RETIRED, handoffId)
  assertDescendant(HANDOFF_READY, source, 'Handoff de retras')
  assertDescendant(HANDOFF_RETIRED, target, 'Destinație handoff retras')
  if (!existsSync(source)) return false
  if (existsSync(target)) fail('Coliziune în retenția handoff worker')
  renameSync(source, target)
  const ack = handoffAckPath(handoffId)
  if (existsSync(ack)) unlinkSync(ack)
  return true
}

/** Reia numai înscrierea DB a unui handoff deja materializat. Nu rerulează
 * promptul și nu produce un al doilea patch dacă răspunsul API s-a pierdut. */
async function reconcilePendingHandoffs(secret) {
  if (!existsSync(HANDOFF_READY)) return 0
  const entries = readdirSync(HANDOFF_READY, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && UUID.test(entry.name))
    .map((entry) => ({ entry, acknowledged: existsSync(handoffAckPath(entry.name)) }))
    .sort((left, right) => left.entry.name.localeCompare(right.entry.name))
  // Două loturi independente: un val de handoff-uri noi nu poate înfometa
  // reconcilierea celor ACKed care au fost deja merged/retired în DB.
  const pending = [
    ...entries.filter((item) => !item.acknowledged).slice(0, 64),
    ...entries.filter((item) => item.acknowledged).slice(0, 64),
  ]
  let recovered = 0
  for (const { entry, acknowledged } of pending) {
    const directory = resolve(HANDOFF_READY, entry.name)
    assertDescendant(HANDOFF_READY, directory, 'Handoff de reconciliat')
    if (realpathSync(directory) !== directory) fail('Handoff-ul de reconciliat nu este canonic')
    const receiptPath = join(directory, 'receipt.json')
    const patchPath = join(directory, 'patch.diff')
    const receiptInfo = statSync(receiptPath)
    const patchInfo = statSync(patchPath)
    if (!receiptInfo.isFile() || !patchInfo.isFile() || receiptInfo.size > 16_384 || patchInfo.size < 1 || patchInfo.size > 16 * 1024 * 1024) {
      fail('Handoff-ul pending are fișiere sau dimensiuni invalide')
    }
    const receiptBytes = readFileSync(receiptPath)
    const receipt = handoffReceipt(JSON.parse(receiptBytes.toString('utf8')))
    if (receipt.handoffId !== entry.name || createHash('sha256').update(readFileSync(patchPath)).digest('hex') !== receipt.patchSha256) {
      fail('Handoff-ul pending nu corespunde receiptului')
    }
    try {
      const response = await reportEvent(secret, receipt.jobId, {
        taskId: receipt.taskId,
        event: 'gates_passed',
        ci: 'local_gates',
        progress: 'Handoff-ul imuabil a fost reconciliat după întreruperea transportului',
        handoffId: receipt.handoffId,
        baseCommit: receipt.baseCommit,
        patchSha256: receipt.patchSha256,
        gateReceiptSha256: createHash('sha256').update(receiptBytes).digest('hex'),
      })
      if (['merged', 'release_dispatched', 'deployed'].includes(String(response?.stage ?? ''))) {
        if (retireAcknowledgedHandoff(receipt.handoffId)) recovered += 1
      } else if (!acknowledged) {
        markHandoffRecorded(receipt.handoffId)
        recovered += 1
      }
    } catch (error) {
      if (error instanceof WorkerApiError && error.status === 409 && error.payload?.error === 'stale_handoff') {
        // Serverul a verificat tranzacțional că alt task/stadiu este canonic.
        // Receiptul vechi nu mai poate fi consumat de publisher și este retras
        // recuperabil înainte de ștergerea făcută de workerul proprietar.
        if (retireAcknowledgedHandoff(receipt.handoffId)) recovered += 1
      } else {
        // 5xx/timeout rămân pending și vor fi reconciliate la următoarea tură.
        throw error
      }
    }
  }
  cleanupRetiredHandoffs()
  return recovered
}

function commandOk(command, args, cwd = undefined, env = undefined) {
  const result = commandResult(command, args, cwd, env)
  return result.status === 0
}

function exactOutput(command, args, cwd, env) {
  const result = commandResult(command, args, cwd, env)
  if (result.status !== 0) return null
  return String(result.stdout ?? '').trim()
}

function runCaptured(command, args, cwd, env, timeoutMs = 30_000) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 2_000).unref()
    }, timeoutMs)
    const collect = (field) => (chunk) => {
      if (field === 'stdout') stdout = `${stdout}${chunk}`.slice(-64 * 1024)
      else stderr = `${stderr}${chunk}`.slice(-64 * 1024)
    }
    child.stdout.on('data', collect('stdout'))
    child.stderr.on('data', collect('stderr'))
    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ code: code ?? 1, signal, stdout, stderr })
    })
  })
}

function assertEnabledLayout() {
  if (process.platform !== 'linux') fail('Execuția Codex este permisă numai pe Linux')
  if (process.getuid?.() === 0) fail('Workerul Codex nu poate rula ca root')
  const actual = {
    codexBin: resolve(CODEX_BIN),
    repo: REPO,
    jobs: JOBS,
    authHome: AUTH_HOME,
    profileHome: PROFILE_HOME,
    handoffReady: HANDOFF_READY,
  }
  for (const [name, expected] of Object.entries(REQUIRED_LAYOUT)) {
    if (name === 'bwrap' || name === 'podman') continue
    if (actual[name] !== expected) fail(`Layout Codex necanonic: ${name}`)
  }

  assertRootOwnedReadonly(CODEX_BIN, 'CLI-ul Codex')
  const bwrapPath = REQUIRED_LAYOUT.bwrap
  if (!existsSync(bwrapPath) || realpathSync(bwrapPath) !== REQUIRED_LAYOUT.bwrap) {
    fail('bwrap trebuie să fie exact /usr/bin/bwrap')
  }
  assertRootOwnedReadonly(bwrapPath, 'bubblewrap')
  if (!commandOk(bwrapPath, ['--version'], undefined, sandboxSupervisorEnv())) fail('bubblewrap nu pornește')
  const podmanPath = REQUIRED_LAYOUT.podman
  if (!existsSync(podmanPath) || realpathSync(podmanPath) !== REQUIRED_LAYOUT.podman) fail('podman trebuie să fie exact /usr/bin/podman')
  assertRootOwnedReadonly(podmanPath, 'podman')
  if (!commandOk(podmanPath, ['--version'], undefined, podmanSupervisorEnv())) fail('podman rootless nu pornește')

  const canonicalProfile = join(PROFILE_HOME, `${PROFILE_NAME}.config.toml`)
  const authProfile = join(AUTH_HOME, `${PROFILE_NAME}.config.toml`)
  assertRootOwnedReadonly(canonicalProfile, 'Profilul canonic Codex')
  assertRootOwnedReadonly(authProfile, 'Profilul Codex din AUTH_HOME')
  const canonicalHash = createHash('sha256').update(readFileSync(canonicalProfile)).digest('hex')
  const authHash = createHash('sha256').update(readFileSync(authProfile)).digest('hex')
  if (canonicalHash !== authHash) fail('Profilul din AUTH_HOME diferă de profilul canonic')

  const version = exactOutput(CODEX_BIN, ['--version'], undefined, codexParentEnv())
  if (version !== CODEX_VERSION) fail(`Versiunea Codex trebuie să fie exact ${CODEX_VERSION}`)
  const help = exactOutput(CODEX_BIN, ['exec', '--help'], undefined, codexParentEnv())
  for (const flag of ['--strict-config', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--profile']) {
    if (!help?.includes(flag)) fail(`CLI-ul Codex nu confirmă flagul obligatoriu ${flag}`)
  }
  if (!commandOk(CODEX_BIN, ['login', 'status'], undefined, codexParentEnv())) {
    fail('Rulează interactiv `codex login` ca utilizatorul workerului')
  }

  if (!existsSync(REPO) || !commandOk('/usr/bin/git', ['rev-parse', '--verify', 'origin/master^{commit}'], REPO, gitSupervisorEnv())) {
    fail('Clona dedicată nu are ref-ul origin/master verificabil')
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(GITHUB_REPOSITORY)) fail('KELION_GITHUB_REPOSITORY este invalid')
  const origin = exactOutput('/usr/bin/git', ['remote', 'get-url', 'origin'], REPO, gitSupervisorEnv())
  if (origin !== `https://github.com/${GITHUB_REPOSITORY}.git`) fail('Remote-ul clonei dedicate nu este URL-ul public configurat')
  const dangerousGitConfig = exactOutput(
    '/usr/bin/git',
    ['config', '--local', '--get-regexp', '^(credential\\.|http\\..*\\.extraheader|filter\\.|core\\.hooksPath|core\\.fsmonitor|include\\.|includeIf\\.)'],
    REPO,
    gitSupervisorEnv(),
  )
  if (dangerousGitConfig !== null) fail('Clona dedicată conține configurare Git executabilă sau de credentiale')
  const expectedCommit = exactOutput('/usr/bin/git', ['rev-parse', 'origin/master^{commit}'], REPO, gitSupervisorEnv())
  const expectedGatePrefix = `ghcr.io/${GITHUB_REPOSITORY.toLowerCase()}/codex-gates@sha256:`
  if (!GATE_IMAGE.startsWith(expectedGatePrefix) || !/^ghcr\.io\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/codex-gates@sha256:[0-9a-f]{64}$/.test(GATE_IMAGE)) {
    fail('KELION_CODEX_GATE_IMAGE trebuie să fie imaginea canonică fixată prin digest')
  }
  const imageDigest = exactOutput(podmanPath, ['image', 'inspect', '--format', '{{.Digest}}', GATE_IMAGE], undefined, podmanSupervisorEnv())
  if (imageDigest !== GATE_IMAGE.slice(GATE_IMAGE.indexOf('@') + 1)) fail('Digestul imaginii gate locale nu corespunde configurației')
  const gateRevision = exactOutput(
    podmanPath,
    ['image', 'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.revision"}}', GATE_IMAGE],
    undefined,
    podmanSupervisorEnv(),
  )
  if (gateRevision !== expectedCommit) fail('Imaginea gate nu a fost construită din același commit ca origin/master')
}

async function adversarialSandboxPreflight() {
  mkdirSync(JOBS, { recursive: true, mode: 0o700 })
  const probeDir = mkdtempSync(join(JOBS, '.sandbox-preflight-'))
  assertDescendant(JOBS, probeDir, 'Directorul probei')
  const suffix = randomUUID()
  const outsideSentinel = join(resolve(JOBS, '..'), `.sandbox-outside-${suffix}`)
  const authSentinel = join(AUTH_HOME, `.sandbox-auth-${suffix}`)
  const credentialSentinel = secretPath()
  const installedProbe = new URL('./codex-sandbox-probe.mjs', import.meta.url)
  const workspaceProbe = join(probeDir, 'probe.mjs')
  let listener
  let connections = 0
  try {
    writeFileSync(outsideSentinel, `${ADVERSARIAL_SENTINEL}\n`, { flag: 'wx', mode: 0o600 })
    writeFileSync(authSentinel, `${ADVERSARIAL_SENTINEL}\n`, { flag: 'wx', mode: 0o600 })
    writeFileSync(workspaceProbe, readFileSync(installedProbe), { flag: 'wx', mode: 0o500 })
    chmodSync(probeDir, 0o700)

    listener = createServer((socket) => {
      connections += 1
      socket.destroy()
    })
    await new Promise((resolvePromise, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', resolvePromise)
    })
    const address = listener.address()
    if (!address || typeof address === 'string') fail('Listenerul adversarial nu are port TCP')

    const result = await runCaptured(
      CODEX_BIN,
      sandboxArgs(probeDir, '/usr/bin/node', [
        workspaceProbe,
        '--workspace', probeDir,
        '--outside-sentinel', outsideSentinel,
        '--auth-sentinel', authSentinel,
        '--credential-sentinel', credentialSentinel,
        '--listener-port', String(address.port),
      ]),
      probeDir,
      sandboxSupervisorEnv(),
      30_000,
    )
    if (result.code !== 0 || result.stdout.trim() !== 'codex-sandbox-probe: TRECE' || connections !== 0) {
      fail('Proba adversarială Codex nu a demonstrat izolarea')
    }
  } finally {
    if (listener) await new Promise((resolvePromise) => listener.close(resolvePromise))
    if (existsSync(outsideSentinel)) unlinkSync(outsideSentinel)
    if (existsSync(authSentinel)) unlinkSync(authSentinel)
    assertDescendant(JOBS, probeDir, 'Directorul probei')
    rmSync(probeDir, { recursive: true, force: true })
  }
}

async function preflight() {
  if (!EXEC_ENABLED) return 'Execuția locală este dezactivată explicit'
  try {
    assertEnabledLayout()
    await adversarialSandboxPreflight()
  } catch (error) {
    return error instanceof Error ? error.message : 'Preflightul Codex a eșuat'
  }
  return null
}

function runLogged(command, args, cwd, logPath, env, stdin = null, timeoutMs = 30 * 60_000, signal = undefined) {
  return new Promise((done, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Lease-ul jobului a fost pierdut'))
      return
    }
    const fd = openSync(logPath, 'a', 0o600)
    let settled = false
    let killTimer = null
    let timedOut = false
    let aborted = false
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [stdin === null ? 'ignore' : 'pipe', fd, fd],
      windowsHide: true,
    })
    const terminate = () => {
      if (settled || killTimer) return
      child.kill('SIGTERM')
      killTimer = setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 2_000)
      killTimer.unref()
    }
    const onTimeout = () => {
      timedOut = true
      terminate()
    }
    const onAbort = () => {
      aborted = true
      terminate()
    }
    const timer = setTimeout(onTimeout, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      signal?.removeEventListener('abort', onAbort)
      closeSync(fd)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    child.once('exit', (code, exitSignal) => {
      if (settled) return
      settled = true
      cleanup()
      done({ code: code ?? 1, signal: exitSignal, timedOut, aborted })
    })
    if (stdin !== null) {
      child.stdin.on('error', () => undefined)
      child.stdin.end(stdin)
    }
  })
}

async function reportEvent(secret, jobId, body) {
  return post(secret, `/api/internal/codex/jobs/${jobId}/event`, body)
}

async function heartbeat(secret, status, detail) {
  return post(secret, '/api/internal/codex/status', { status, ...(detail ? { detail } : {}) })
}

function strictWorkerClaimResponse(claimed) {
  if (!claimed || typeof claimed !== 'object' || Array.isArray(claimed)) fail('Răspuns claim invalid')
  if (Object.keys(claimed).some((key) => !['state', 'job'].includes(key))) fail('Răspuns claim invalid')
  if (claimed.state === 'no_claimable_job' || claimed.state === 'pipeline_active') {
    if (claimed.job !== null) fail('Răspuns claim invalid')
    return { state: claimed.state, job: null }
  }
  if (claimed.state !== 'claimed' || !claimed.job || typeof claimed.job !== 'object' || Array.isArray(claimed.job)) {
    fail('Răspuns claim invalid')
  }
  const job = claimed.job
  const jobId = String(job?.jobId ?? '')
  const taskId = String(job?.taskId ?? '')
  const order = job?.order
  const recoveryCode = job?.recoveryCode ?? null
  if (
    !/^[1-9]\d{0,18}$/.test(jobId)
    || !/^codex-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(taskId)
    || typeof order !== 'string'
    || !order.trim()
    || order.length > 20_000
    || (recoveryCode !== null && !Object.hasOwn(RECOVERY_GUIDANCE, recoveryCode))
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(order)
  ) fail('Răspuns claim invalid')
  return { state: 'claimed', job: { jobId, taskId, order, recoveryCode } }
}

async function degradedWithoutMasking(secret, detail, reportHeartbeat = heartbeat) {
  try {
    await reportHeartbeat(secret, 'degraded', detail)
  } catch {
    // Heartbeatul este numai diagnosticul secundar. Eroarea canonică a
    // reconcilierii/claimului/evenimentului trebuie să rămână cea aruncată.
  }
}

/** Un worker nu este `ready` până când a reconciliat orice handoff durabil și
 * a citit cu succes coada. Un claim valid devine `busy` înainte de primul
 * eveniment, astfel încât un 5xx la `accepted` nu lasă un heartbeat verde
 * peste un job deja trecut durabil în running. */
async function prepareWorkerClaim(secret, dependencies = {}) {
  const cleanup = dependencies.cleanup ?? cleanupRetiredHandoffs
  const reconcile = dependencies.reconcile ?? reconcilePendingHandoffs
  const claim = dependencies.claim ?? ((value) => post(value, '/api/internal/codex/jobs/claim', {}))
  const reportHeartbeat = dependencies.reportHeartbeat ?? heartbeat
  try {
    cleanup()
    const recovered = await reconcile(secret)
    const response = strictWorkerClaimResponse(await claim(secret))
    if (response.state === 'no_claimable_job') {
      await reportHeartbeat(
        secret,
        'ready',
        recovered > 0
          ? 'Handoff pending reconciliat; nu există ordin eligibil acum și workerul este pregătit'
          : 'Worker pregătit; nu există ordin eligibil pentru claim acum',
      )
      return null
    }
    if (response.state === 'pipeline_active') {
      await reportHeartbeat(secret, 'busy', 'Un ordin Constructor este deja running; workerul nu revendică un executor paralel')
      return null
    }
    const job = response.job
    await reportHeartbeat(secret, 'busy', 'Workerul a revendicat un ordin și îl pregătește în worktree-ul izolat')
    return job
  } catch (error) {
    await degradedWithoutMasking(
      secret,
      'Workerul nu a putut reconcilia handoff-urile sau citi coada; niciun ordin nou nu poate porni sigur',
      reportHeartbeat,
    )
    throw error
  }
}

async function acceptWorkerClaim(secret, job, dependencies = {}) {
  const report = dependencies.report ?? reportEvent
  const reportHeartbeat = dependencies.reportHeartbeat ?? heartbeat
  try {
    await report(secret, job.jobId, { taskId: job.taskId, event: 'accepted', progress: 'Ordin acceptat în worktree-ul izolat' })
  } catch (error) {
    await degradedWithoutMasking(
      secret,
      'Ordinul a fost revendicat, dar evenimentul accepted nu a putut fi persistat; watchdogul va reconcilia jobul',
      reportHeartbeat,
    )
    throw error
  }
}

function startJobLease(secret, jobId, taskId, progress) {
  const controller = new AbortController()
  let stopped = false
  let running = Promise.resolve()
  let failure = null
  const renew = () => {
    if (stopped || failure) return
    running = running.then(async () => {
      await reportEvent(secret, jobId, { taskId, event: 'progress', progress })
      await heartbeat(secret, 'busy', progress)
    }).catch((error) => {
      failure = error
      controller.abort(error)
    })
  }
  renew()
  const timer = setInterval(renew, 45_000)
  timer.unref()
  const assertHeld = async () => {
    await running
    if (failure) throw failure
  }
  const stop = async () => {
    stopped = true
    clearInterval(timer)
    await assertHeld()
  }
  stop.assert = assertHeld
  stop.signal = controller.signal
  return stop
}

async function runOnce() {
  assertLoopbackApi()
  const secret = loadSecret()
  const problem = await preflight()
  if (problem) {
    await heartbeat(secret, 'setup_required', problem)
    if (!EXEC_ENABLED) return
    fail(problem)
  }

  const claimed = await prepareWorkerClaim(secret)
  if (!claimed) return
  const { jobId, taskId, order, recoveryCode } = claimed
  const effectiveOrder = recoveryCode
    ? `${order}\n\nContext de recuperare canonic: ${RECOVERY_GUIDANCE[recoveryCode]}`
    : order

  await acceptWorkerClaim(secret, claimed)
  mkdirSync(JOBS, { recursive: true, mode: 0o700 })
  const jobStateDir = join(JOBS, `${taskId}-${jobId}`)
  const jobDir = join(jobStateDir, 'worktree')
  assertDescendant(JOBS, jobStateDir, 'Directorul jobului')
  assertDescendant(jobStateDir, jobDir, 'Worktree-ul jobului')
  if (existsSync(jobStateDir)) fail('Directorul jobului există deja; intervenție manuală necesară')
  let worktreeAdded = false
  let logPath = null
  let failureReported = false
  let handoffMaterialized = false
  try {
    mkdirSync(jobStateDir, { recursive: false, mode: 0o700 })
    const added = spawnSync(
      '/usr/bin/git',
      ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', jobDir, 'origin/master'],
      { cwd: REPO, env: gitSupervisorEnv(), stdio: 'ignore', timeout: 60_000 },
    )
    if (added.status !== 0) fail('Nu am putut crea worktree-ul dedicat')
    worktreeAdded = true
    const baseCommit = exactOutput('/usr/bin/git', ['rev-parse', 'HEAD'], jobDir, gitSupervisorEnv())
    const expectedCommit = exactOutput('/usr/bin/git', ['rev-parse', 'origin/master^{commit}'], REPO, gitSupervisorEnv())
    if (!/^[0-9a-f]{40}$/.test(baseCommit ?? '') || baseCommit !== expectedCommit) fail('Worktree-ul nu corespunde exact origin/master')
    writeFileSync(join(jobStateDir, 'job.json'), `${JSON.stringify({ jobId, taskId, baseCommit, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 })
    logPath = join(jobStateDir, 'worker.log')

    const stopExecLease = startJobLease(secret, jobId, taskId, 'Codex editează local în sandbox fără rețea')
    let result
    try {
      result = await runLogged(
        CODEX_BIN,
        codexExecArgs(jobDir),
        jobDir,
        logPath,
        codexParentEnv(),
        effectiveOrder,
        30 * 60_000,
        stopExecLease.signal,
      )
    } finally {
      await stopExecLease()
    }
    if (result.code !== 0) {
      const code = assertWorkerFailureCode(classifyWorkerFailure(logPath, 'codex', result))
      await reportEvent(secret, jobId, { taskId, event: 'failed', code })
      failureReported = true
      await heartbeat(secret, 'degraded', 'Codex exec a eșuat; consultă jurnalul privat al worktree-ului')
      return
    }

    const stopGateLease = startJobLease(secret, jobId, taskId, 'Rulez porțile în imaginea offline fixată prin digest')
    let gate
    try {
      gate = await runLogged(
        REQUIRED_LAYOUT.podman,
        gateContainerArgs(jobDir),
        jobDir,
        logPath,
        podmanSupervisorEnv(),
        null,
        45 * 60_000,
        stopGateLease.signal,
      )
    } finally {
      await stopGateLease()
    }
    if (gate.code !== 0) {
      const code = assertWorkerFailureCode(classifyWorkerFailure(logPath, 'gate', gate))
      await reportEvent(secret, jobId, { taskId, event: 'failed', code })
      failureReported = true
      await heartbeat(secret, 'degraded', 'Imaginea offline de porți a eșuat; consultă jurnalul privat')
      return
    }
    const handoff = publishHandoff(jobDir, { jobId, taskId, baseCommit })
    handoffMaterialized = true
    await reportEvent(secret, jobId, {
      taskId,
      event: 'gates_passed',
      ci: 'local_gates',
      progress: 'Toate porțile locale sunt verzi; handoff-ul imuabil așteaptă publisherul separat',
      ...handoff,
    })
    markHandoffRecorded(handoff.handoffId)
    // `ready` se publică numai la următoarea tură, după ce handoff-ul
    // tocmai confirmat este reconciliat și claim-ul dovedește că nu există
    // niciun ordin eligibil acum.
  } catch (error) {
    if (error instanceof HandoffDurabilityUncertainError) handoffMaterialized = true
    if (!failureReported && !handoffMaterialized) {
      const code = assertWorkerFailureCode(classifyWorkerFailure(logPath, 'internal', {}, error))
      await reportEvent(secret, jobId, { taskId, event: 'failed', code }).catch(() => undefined)
    }
    throw error
  } finally {
    const removed = worktreeAdded ? gitResult(['worktree', 'remove', '--force', '--', jobDir], REPO) : null
    if (removed?.status !== 0 && existsSync(jobDir)) {
      await heartbeat(secret, 'degraded', 'Worktree-ul jobului necesită curățare manuală').catch(() => undefined)
    } else if (existsSync(jobStateDir)) {
      rmSync(jobStateDir, { recursive: true, force: true })
    }
    gitResult(['worktree', 'prune'], REPO)
  }
}

async function selfTest() {
  const body = { z: 1, a: { y: true, x: null }, b: [2, 'q'] }
  const canonical = canonicalJson(body)
  if (canonical !== '{"a":{"x":null,"y":true},"b":[2,"q"],"z":1}') fail('canonicalJson diferă de contract')
  const headers = signedHeaders(
    '0123456789abcdef0123456789abcdef',
    'POST',
    '/api/internal/codex/status',
    body,
    '1787536800',
    '123e4567-e89b-12d3-a456-426614174000',
  )
  if (headers['x-codex-signature'] !== 'v1=83247cf65f03be7abb1d82cc36c18e341fd9ba399e07e9706e0c116e2ebbe8ee') {
    fail('Semnătura HMAC diferă de vectorul cunoscut')
  }
  const args = codexExecArgs('/var/lib/kelion-codex/jobs/codex-test/worktree')
  for (const flag of ['--strict-config', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--profile']) {
    if (!args.includes(flag)) fail(`Lipsește flagul Codex fix ${flag}`)
  }
  if (args.includes('--sandbox') || args.at(-1) !== '-') fail('Argumentele Codex nu selectează exclusiv profilul fix și stdin')
  const gateArgs = gateContainerArgs(
    '/var/lib/kelion-codex/jobs/codex-test/worktree',
    'ghcr.io/example/repository/codex-gates@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    { uid: 1000, gid: 1000 },
  )
  for (const fixed of ['--pull=never', '--network=none', '--read-only', '--cap-drop=all', '--security-opt=no-new-privileges']) {
    if (!gateArgs.includes(fixed)) fail(`Containerului de porți îi lipsește ${fixed}`)
  }
  if (gateArgs.some((value) => /OPENAI|SECRET|TOKEN|CREDENTIAL/i.test(value))) fail('Containerul de porți primește un nume de secret')
  const parentEnv = codexParentEnv()
  for (const forbidden of ['CREDENTIALS_DIRECTORY', 'CODEX_WORKER_SECRET_FILE', 'OPENAI_API_KEY', 'OPENAI_ADMIN_KEY']) {
    if (forbidden in parentEnv) fail(`Mediul Codex conține ${forbidden}`)
  }
  const receipt = handoffReceipt({
    jobId: '42',
    taskId: 'codex-123e4567-e89b-42d3-a456-426614174000',
    handoffId: '123e4567-e89b-42d3-a456-426614174001',
    baseCommit: 'a'.repeat(40),
    patchSha256: 'b'.repeat(64),
    gateImage: 'ghcr.io/example/repository/codex-gates@sha256:' + 'c'.repeat(64),
    passedAt: '2026-08-24T00:00:00.000Z',
  })
  if (receipt.kind !== 'kelion-constructor-handoff' || receipt.schema !== 1) fail('Receipt-ul handoff nu este canonic')
  for (const code of WORKER_FAILURE_CODES) {
    if (assertWorkerFailureCode(code) !== code) fail('Catalog worker failure inconsistent')
  }
  if (classifyWorkerFailure(null, 'gate', { timedOut: true }) !== 'execution_timeout') fail('Timeout worker neclasificat')

  const claimedJob = {
    jobId: '42',
    taskId: 'codex-123e4567-e89b-42d3-a456-426614174000',
    order: 'Remediază fluxul Constructor complet',
    recoveryCode: null,
  }
  const emptyTrace = []
  const empty = await prepareWorkerClaim('self-test-secret', {
    cleanup: () => emptyTrace.push('cleanup'),
    reconcile: async () => { emptyTrace.push('reconcile'); return 1 },
    claim: async () => { emptyTrace.push('claim'); return { state: 'no_claimable_job', job: null } },
    reportHeartbeat: async (_secret, status) => { emptyTrace.push(status) },
  })
  if (empty !== null || emptyTrace.join(',') !== 'cleanup,reconcile,claim,ready') {
    fail('Workerul nu publică ready numai după reconciliere și lipsa unui ordin eligibil')
  }

  const busyTrace = []
  const busy = await prepareWorkerClaim('self-test-secret', {
    cleanup: () => busyTrace.push('cleanup'),
    reconcile: async () => { busyTrace.push('reconcile'); return 0 },
    claim: async () => { busyTrace.push('claim'); return { state: 'claimed', job: claimedJob } },
    reportHeartbeat: async (_secret, status) => { busyTrace.push(status) },
  })
  if (busy?.jobId !== claimedJob.jobId || busyTrace.join(',') !== 'cleanup,reconcile,claim,busy') {
    fail('Un claim valid nu devine busy imediat, fără heartbeat ready intermediar')
  }

  for (const phase of ['reconcile', 'claim']) {
    const original = new Error(`self-test-${phase}`)
    const trace = []
    let observed = null
    try {
      await prepareWorkerClaim('self-test-secret', {
        cleanup: () => trace.push('cleanup'),
        reconcile: async () => {
          trace.push('reconcile')
          if (phase === 'reconcile') throw original
          return 0
        },
        claim: async () => {
          trace.push('claim')
          throw original
        },
        reportHeartbeat: async (_secret, status) => { trace.push(status) },
      })
    } catch (error) {
      observed = error
    }
    const expectedTrace = phase === 'reconcile'
      ? 'cleanup,reconcile,degraded'
      : 'cleanup,reconcile,claim,degraded'
    if (observed !== original || trace.join(',') !== expectedTrace || trace.includes('ready')) {
      fail(`Eșecul ${phase} nu păstrează eroarea originală și heartbeatul degraded`)
    }
  }

  const committedTimeout = new Error('self-test-claim-response-timeout-after-commit')
  const committedTrace = []
  let committedObserved = null
  try {
    await prepareWorkerClaim('self-test-secret', {
      cleanup: () => committedTrace.push('cleanup'),
      reconcile: async () => { committedTrace.push('reconcile'); return 0 },
      claim: async () => { committedTrace.push('claim-timeout'); throw committedTimeout },
      reportHeartbeat: async (_secret, status) => { committedTrace.push(status) },
    })
  } catch (error) {
    committedObserved = error
  }
  const afterCommittedTimeout = await prepareWorkerClaim('self-test-secret', {
    cleanup: () => committedTrace.push('cleanup'),
    reconcile: async () => { committedTrace.push('reconcile'); return 0 },
    claim: async () => { committedTrace.push('claim-active'); return { state: 'pipeline_active', job: null } },
    reportHeartbeat: async (_secret, status) => { committedTrace.push(status) },
  })
  if (
    committedObserved !== committedTimeout
    || afterCommittedTimeout !== null
    || committedTrace.join(',') !== 'cleanup,reconcile,claim-timeout,degraded,cleanup,reconcile,claim-active,busy'
    || committedTrace.includes('ready')
  ) fail('Un claim COMMIT cu răspuns pierdut poate reveni fals la ready')

  const acceptedFailure = new Error('self-test-accepted')
  const acceptedTrace = []
  let acceptedObserved = null
  const acceptedClaim = await prepareWorkerClaim('self-test-secret', {
    cleanup: () => acceptedTrace.push('cleanup'),
    reconcile: async () => { acceptedTrace.push('reconcile'); return 0 },
    claim: async () => { acceptedTrace.push('claim'); return { state: 'claimed', job: claimedJob } },
    reportHeartbeat: async (_secret, status) => { acceptedTrace.push(status) },
  })
  try {
    await acceptWorkerClaim('self-test-secret', acceptedClaim, {
      report: async () => { acceptedTrace.push('accepted'); throw acceptedFailure },
      reportHeartbeat: async (_secret, status) => { acceptedTrace.push(status) },
    })
  } catch (error) {
    acceptedObserved = error
  }
  const afterAcceptedFailure = await prepareWorkerClaim('self-test-secret', {
    cleanup: () => acceptedTrace.push('cleanup'),
    reconcile: async () => { acceptedTrace.push('reconcile'); return 0 },
    claim: async () => { acceptedTrace.push('claim-active'); return { state: 'pipeline_active', job: null } },
    reportHeartbeat: async (_secret, status) => { acceptedTrace.push(status) },
  })
  if (
    acceptedObserved !== acceptedFailure
    || afterAcceptedFailure !== null
    || acceptedTrace.join(',') !== 'cleanup,reconcile,claim,busy,accepted,degraded,cleanup,reconcile,claim-active,busy'
    || acceptedTrace.includes('ready')
  ) {
    fail('Eșecul accepted este mascat sau lasă heartbeat ready peste jobul running')
  }

  const malformedTrace = []
  let malformedRejected = false
  try {
    await prepareWorkerClaim('self-test-secret', {
      cleanup: () => malformedTrace.push('cleanup'),
      reconcile: async () => { malformedTrace.push('reconcile'); return 0 },
      claim: async () => { malformedTrace.push('legacy-204'); return null },
      reportHeartbeat: async (_secret, status) => { malformedTrace.push(status) },
    })
  } catch {
    malformedRejected = true
  }
  if (!malformedRejected || malformedTrace.join(',') !== 'cleanup,reconcile,legacy-204,degraded') {
    fail('Contractul claim ambiguu legacy nu este refuzat fail-closed')
  }
  process.stdout.write('codex-worker self-test: TRECE\n')
}

async function preflightOnly() {
  const problem = await preflight()
  if (problem) fail(problem)
  process.stdout.write(`${CODEX_VERSION}\ncodex-sandbox-probe: TRECE\n`)
}

const mode = process.argv[2] ?? '--once'
if (mode === '--self-test') await selfTest()
else if (mode === '--preflight') await preflightOnly()
else if (mode === '--once') await runOnce()
else fail(`Mod necunoscut: ${mode}`)
