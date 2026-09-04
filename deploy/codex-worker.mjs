#!/usr/bin/env node
// Clientul separat al cozii Constructor. OpenCode folosește exclusiv modelul
// Qwen local prin llama.cpp; publisherul separat păstrează tokenul GitHub,
// porțile, push-ul, merge-ul și deploy-ul în afara executorului.

import { createHash, createHmac, randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  renameSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const API = new URL(process.env.KELION_CODEX_API ?? 'http://127.0.0.1:8080/')
const OPENCODE_BIN = resolve(process.env.OPENCODE_BIN ?? '/opt/private-ai/bin/opencode')
const OPENCODE_CONFIG_HOME = resolve(process.env.OPENCODE_CONFIG_HOME ?? '/srv/private-ai/home/.config')
const OPENCODE_CONFIG = resolve(process.env.OPENCODE_CONFIG ?? '/srv/private-ai/home/.config/opencode/opencode.json')
const OPENCODE_MODEL = process.env.OPENCODE_MODEL ?? 'llama.cpp/qwen3.6-35b-a3b-local'
const FAST_OPENCODE_MODEL = 'llama.cpp/qwen3.6-35b-a3b-local'
const OPENCODE_BASE_URL = process.env.OPENCODE_BASE_URL ?? 'http://127.0.0.1:24080/v1'
const REPO = resolve(process.env.CODEX_WORKER_REPO ?? '/var/lib/kelion-codex/repo')
const JOBS = resolve(process.env.CODEX_WORKER_JOBS ?? '/var/lib/kelion-codex/jobs')
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
const OPENCODE_VERSION = '1.18.25'
const OPENCODE_MODEL_ID = 'qwen3.6-35b-a3b-local'
const POWERFUL_OPENCODE_MODEL = 'llama.cpp/qwen3.5-122b-a10b-local'
const POWERFUL_OPENCODE_MODEL_ID = 'qwen3.5-122b-a10b-local'
const OPENCODE_PROMPT = 'Execută integral ordinul Constructor atașat. Modifică worktree-ul, rulează testele relevante și nu te opri la plan. Nu crea commituri, nu muta HEAD și nu indexa modificările; handoff-ul Git este făcut separat.'
const WORKER_LOG_MAX_BYTES = 16 * 1024 * 1024
const GITHUB_REPOSITORY = process.env.KELION_GITHUB_REPOSITORY ?? ''
const REQUIRED_LAYOUT = Object.freeze({
  openCodeBin: '/opt/private-ai/bin/opencode',
  openCodeConfigHome: '/srv/private-ai/home/.config',
  openCodeConfig: '/srv/private-ai/home/.config/opencode/opencode.json',
  repo: '/var/lib/kelion-codex/repo',
  jobs: '/var/lib/kelion-codex/jobs',
  handoffReady: '/var/lib/kelion-constructor-handoff/ready',
  sudo: '/usr/bin/sudo',
  podman: '/usr/bin/podman',
})
const CONSTRUCTOR_MODEL_PROFILES = Object.freeze({
  fast: Object.freeze({ tier: 'fast', model: FAST_OPENCODE_MODEL, modelId: OPENCODE_MODEL_ID, label: 'FAST 35B' }),
  powerful: Object.freeze({ tier: 'powerful', model: POWERFUL_OPENCODE_MODEL, modelId: POWERFUL_OPENCODE_MODEL_ID, label: 'POWERFUL 122B' }),
})
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RECOVERY_GUIDANCE = Object.freeze({
  stale_base: 'Reexecută ordinul peste vârful master curent; nu reutiliza patch-ul sau baza anterioară.',
  ci_failed: 'Versiunea anterioară a fost respinsă de un control CI obligatoriu. Auditează cauza probabilă și produce o remediere nouă, verificată complet.',
  local_gate_failed: 'Revalidarea izolată a publisherului a respins versiunea anterioară. Reproduce toate porțile și repară orice diferență deterministă.',
  pr_closed: 'PR-ul anterior a fost închis fără merge. Reexecută ordinul curat și produce un handoff nou, fără a reutiliza branch-ul anterior.',
  execution_timeout: 'Execuția anterioară a depășit fereastra de timp. Lucrează concentrat pe ordin, fără explorare inutilă, și oprește-te când ordinul este îndeplinit.',
  brain_unavailable: 'Execuția anterioară a căzut fiindcă modelul local era indisponibil, nu din vina ordinului. Reia lucrul de la zero, fără a presupune nimic despre starea anterioară.',
  worker_internal_failure: 'Execuția anterioară a căzut dintr-o cauză tehnică a lucrătorului, nu din vina ordinului. Reia lucrul de la zero, pe worktree curat.',
})
const WORKER_FAILURE_CODES = new Set([
  'execution_timeout',
  'brain_unavailable',
  'worker_internal_failure',
])
const WORKER_UNRESOLVED_REASONS = new Set(['no_changes', 'test_failure', 'quality_gate_failure'])

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

export function tailText(logPath, maxBytes = 128 * 1024) {
  if (!logPath) return ''
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) fail('Limita tail-ului privat este invalidă')
  let descriptor = null
  try {
    descriptor = openSync(logPath, 'r')
    const info = fstatSync(descriptor)
    if (!info.isFile() || maxBytes === 0 || info.size === 0) return ''
    const byteCount = Math.min(info.size, maxBytes)
    const buffer = Buffer.alloc(byteCount)
    const start = info.size - byteCount
    let offset = 0
    while (offset < byteCount) {
      const count = readSync(descriptor, buffer, offset, byteCount - offset, start + offset)
      if (count === 0) break
      offset += count
    }
    return buffer.subarray(0, offset).toString('utf8')
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return ''
    throw error
  } finally {
    if (descriptor !== null) closeSync(descriptor)
  }
}

const GATE_INFRASTRUCTURE_FAILURE = /(?:\bENOENT\b|\bEACCES\b|\bENOSPC\b|\bENOMEM\b|no space left on device|permission denied|read-only file system|out of memory|oom[- ]kill|killed process|cannot execute|command not found|executable file not found|container runtime|podman(?:\s+runtime)?\s+error|input\/output error|i\/o error|broken pipe)/i
const GATE_TEST_FAILURE = /(?:\b(?:vitest|jest|pytest)\b[^\n]{0,160}\b(?:failed|failure|error)|\bAssertionError\b|\bFAIL\b[^\n]{0,180}(?:\.test\.|\.spec\.|test)|\bfailed tests?\b|\bTests?\s+\d+\s+failed\b)/i
// Numai diagnostice bounded ale porților de cod pot demonstra un rezultat
// nepublicabil. Un exit 1/2 cu receipt, dar cu text necunoscut (de exemplu o
// dependență lipsă în imagine), rămâne eșec tehnic și nu recomandă alt model.
const GATE_QUALITY_FAILURE = /(?:\berror TS\d{3,5}\b|\b(?:eslint|oxlint|lint)\b[^\n]{0,160}\b(?:failed|failure|errors?)\b|\b(?:vite|webpack|rollup|build)\b[^\n]{0,160}\b(?:build failed|failed to build|error during build)\b|SEMNE GREȘIT PUSE|APELURI FĂRĂ RUTĂ|RUTE FĂRĂ CONSUMATOR|RUTE DUBLATE|DDL ÎN CODUL RUNTIME|NUME MIGRĂRI INVALIDE|MIGRĂRI FĂRĂ EXACT|TABELE CREATE ÎN MAI MULTE|Workflow-uri nesigure|Creier unic:|Hardcodări operaționale\/comerciale|FIȘIERE DE PRODUCȚIE INACCESIBILE|EXPORTURI PUBLICE NECONSUMATE|Fișiere neclasificate|Active binare duplicate|(?:jscpd|duplicate code|duplication)[^\n]{0,160}(?:threshold|failed|detected)|dependințele (?:backend|frontend) diferă de imaginea gate)/i

function measuredGateVerdict(source, result) {
  if (!Number.isInteger(result?.code) || ![1, 2].includes(result.code)) return false
  const markers = [...source.matchAll(/^codex-gates: VERDICT schema=1 exit=(\d+)$/gm)]
  return Number(markers.at(-1)?.[1] ?? -1) === result.code
}

/** Clasifică local jurnalul privat și transmite serverului numai un cod dintr-un
 * catalog fix. Niciun fragment de output (care poate conține secrete) nu iese
 * din contul workerului. Un verdict `unresolved` este permis numai când scriptul
 * gate fixat a emis receiptul său final și podman a propagat exact exit 1/2. */
function classifyWorkerFailure(logPath, phase, result = {}, error = null) {
  const privateLog = tailText(logPath)
  const errorText = error instanceof Error ? `${error.name}: ${error.message}` : ''
  const source = `${privateLog}\n${errorText}`
  if (result.timedOut || /timed out|timeout|timp.{0,20}depăș/i.test(source)) return 'execution_timeout'
  if (
    phase === 'opencode'
    && /(?:llama\.cpp|qwen3?\b|127\.0\.0\.1:24080|ECONNREFUSED|ECONNRESET|connection refused|failed to connect|fetch failed|model.{0,80}(?:unavailable|invalid|refused|not found)|brain unavailable|răspuns gol)/i.test(source)
  ) return 'brain_unavailable'
  if (phase === 'gate') {
    if (
      error instanceof Error
      || result.aborted === true
      || result.outputExceeded === true
      || result.signal != null
      || [125, 126, 127, 137].includes(result.code)
      || GATE_INFRASTRUCTURE_FAILURE.test(source)
      || !measuredGateVerdict(privateLog, result)
    ) return 'worker_internal_failure'
    if (GATE_TEST_FAILURE.test(privateLog)) return 'test_failure'
    if (GATE_QUALITY_FAILURE.test(privateLog)) return 'quality_gate_failure'
    return 'worker_internal_failure'
  }
  // Constructorul local nu emite coduri de autentificare/credit ale unui
  // furnizor cloud. Un eșec OpenCode fără o dovadă locală mai precisă
  // rămâne intern până la citirea jurnalului privat.
  if (phase === 'opencode') return 'worker_internal_failure'
  return 'worker_internal_failure'
}

function assertWorkerFailureCode(code) {
  if (!WORKER_FAILURE_CODES.has(code)) fail('Cod de eroare worker necanonic')
  return code
}

function assertWorkerUnresolvedReason(reason) {
  if (!WORKER_UNRESOLVED_REASONS.has(reason)) fail('Motiv unresolved worker necanonic')
  return reason
}

function classifyWorkerOutcome(logPath, phase, result = {}, error = null) {
  const code = classifyWorkerFailure(logPath, phase, result, error)
  return WORKER_UNRESOLVED_REASONS.has(code)
    ? { event: 'unresolved', reason: assertWorkerUnresolvedReason(code) }
    : { event: 'failed', code: assertWorkerFailureCode(code) }
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

export function openCodeParentEnv() {
  return {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    CI: '1',
  }
}

function openCodeRootEnvironmentArgs(safeDirectory = null) {
  const gitEnvironment = []
  if (safeDirectory !== null) {
    const worktree = resolve(safeDirectory)
    assertDescendant(JOBS, worktree, 'safe.directory OpenCode')
    if (worktree.includes('\0') || worktree.includes('\n') || worktree.includes('\r')) fail('safe.directory OpenCode este invalid')
    gitEnvironment.push(
      'GIT_CONFIG_NOSYSTEM=1',
      'GIT_CONFIG_GLOBAL=/dev/null',
      'GIT_CONFIG_COUNT=1',
      'GIT_CONFIG_KEY_0=safe.directory',
      `GIT_CONFIG_VALUE_0=${worktree}`,
      'GIT_TERMINAL_PROMPT=0',
      'GIT_ASKPASS=/bin/false',
    )
  }
  return [
    'HOME=/srv/private-ai/home',
    `XDG_CONFIG_HOME=${OPENCODE_CONFIG_HOME}`,
    'XDG_CACHE_HOME=/srv/private-ai/cache',
    'XDG_DATA_HOME=/srv/private-ai/home/.local/share',
    `OPENCODE_CONFIG=${OPENCODE_CONFIG}`,
    'OPENCODE_DISABLE_PROJECT_CONFIG=true',
    'OPENCODE_DISABLE_LSP_DOWNLOAD=true',
    'OPENCODE_DISABLE_MODELS_FETCH=true',
    'OPENCODE_DISABLE_AUTOUPDATE=true',
    'OPENCODE_DISABLE_DEFAULT_PLUGINS=true',
    'PATH=/opt/private-ai/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'LANG=C.UTF-8',
    'LC_ALL=C.UTF-8',
    'CI=1',
    'NO_COLOR=1',
    ...gitEnvironment,
  ]
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

export function openCodeExecArgs(jobDir, orderPath, model = OPENCODE_MODEL) {
  const worktree = resolve(jobDir)
  const order = resolve(orderPath)
  assertDescendant(JOBS, worktree, 'Worktree OpenCode')
  assertDescendant(JOBS, order, 'Ordin OpenCode')
  if (![FAST_OPENCODE_MODEL, POWERFUL_OPENCODE_MODEL].includes(model)) fail('Modelul OpenCode solicitat nu aparține politicii Constructor')
  const modelArgs = ['--model', model]
  return [
    '--pure',
    'run',
    OPENCODE_PROMPT,
    ...modelArgs,
    '--file', order,
  ]
}

export function rootOpenCodeArgs(openCodeArgs, safeDirectory = null) {
  if (!Array.isArray(openCodeArgs) || openCodeArgs.some((value) => typeof value !== 'string' || value.includes('\0'))) {
    fail('Argumentele OpenCode sunt invalide')
  }
  return [
    '-n', '-u', 'root', '--',
    '/usr/bin/env', '-i',
    ...openCodeRootEnvironmentArgs(safeDirectory),
    OPENCODE_BIN,
    ...openCodeArgs,
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

function secretLocation() {
  if (process.env.CODEX_WORKER_SECRET_FILE && process.env.CREDENTIALS_DIRECTORY) {
    fail('Sursele credentialei worker sunt ambigue')
  }
  return logicalLength > API_LOGIN_STATUS_PREFIX.length
}

function codexProjectKeyStatusReady() {
  const result = spawnSync(CODEX_BIN, codexLoginStatusArgs(), {
    env: codexParentEnv(),
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 30_000,
    maxBuffer: 4 * 1024,
    windowsHide: true,
  })
  const output = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.alloc(0)
  try {
    return !result.error && result.status === 0 && isCodexProjectKeyStatus(output)
  } finally {
    output.fill(0)
  }
}

function cachedProjectKeyFingerprint() {
  const path = join(AUTH_HOME, PROJECT_KEY_FINGERPRINT)
  if (!existsSync(path)) return null
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    fail('Fingerprintul credentialei Codex nu este un fișier regulat unic')
  }
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) {
    fail('Fingerprintul credentialei Codex are permisiuni prea largi')
  }
  const value = readFileSync(path, 'ascii')
  return /^[0-9a-f]{64}\n?$/.test(value) ? value.trim() : null
}

function publishProjectKeyFingerprint(fingerprint) {
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) fail('Fingerprint OpenAI invalid')
  const target = join(AUTH_HOME, PROJECT_KEY_FINGERPRINT)
  const temporary = join(AUTH_HOME, `.${PROJECT_KEY_FINGERPRINT}.${randomUUID()}.tmp`)
  let descriptor = null
  try {
    descriptor = openSync(temporary, 'wx', 0o600)
    writeFileSync(descriptor, `${fingerprint}\n`, { encoding: 'ascii' })
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null
    renameSync(temporary, target)
    fsyncPath(AUTH_HOME)
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function assertCodexAuthCacheMetadata(required) {
  const path = join(AUTH_HOME, 'auth.json')
  if (!existsSync(path)) {
    if (required) fail('Cache-ul Codex auth.json lipsește după login')
    return false
  }
  const info = lstatSync(path)
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) {
    fail('Cache-ul Codex auth.json nu este un fișier regulat unic')
  }
  const uid = process.getuid?.()
  if (process.platform !== 'win32' && (info.uid !== uid || (info.mode & 0o077) !== 0)) {
    fail('Cache-ul Codex auth.json are owner sau permisiuni necanonice')
  }
  return true
}

function refreshCodexApiLogin() {
  const projectKey = loadProjectKeyCredential()
  try {
    const fingerprint = createHash('sha256').update(projectKey).digest('hex')
    assertCodexAuthCacheMetadata(false)
    if (
      !directory.startsWith('/run/credentials/')
      || realpathSync(directory) !== directory
    ) {
      fail('Directorul credentialei systemd nu este canonic')
    }
    const directoryEntry = lstatSync(directory)
    if (!directoryEntry.isDirectory() || directoryEntry.isSymbolicLink()) {
      fail('Directorul credentialei systemd este nesigur')
    }
    return { path: join(directory, 'codex-worker-secret'), systemd: true }
  }
  fail('Lipsește credentiala systemd codex-worker-secret')
}

function loadSecret() {
  const location = secretLocation()
  const entry = lstatSync(location.path)
  if (!entry.isFile() || entry.isSymbolicLink()) fail('Credentiala worker nu este fișier regulat')
  const info = statSync(location.path)
  if (process.platform !== 'win32') {
    if (location.systemd) {
      // systemd poate expune credentialele 0444 într-un mount privat inaccesibil
      // altor procese. Fișierul trebuie să rămână complet nemodificabil.
      if ((info.mode & 0o222) !== 0) fail('Credentiala systemd este modificabilă')
    } else if ((info.mode & 0o077) !== 0) {
      fail('Credentiala worker explicită are permisiuni prea largi')
    }
  }
  const secret = readFileSync(location.path, 'utf8').trim()
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
    cwd: cwd ?? '/var/lib/kelion-codex',
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
  if (currentHead !== input.baseCommit) fail('Executorul OpenCode a mutat HEAD-ul; workerul acceptă numai patch peste baza revendicată')
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

function activeLocalModelId() {
  const health = commandResult('/usr/bin/curl', [
    '--fail', '--silent', '--show-error', '--max-time', '10', `${OPENCODE_BASE_URL.replace(/\/v1$/, '')}/health`,
  ], undefined, openCodeParentEnv())
  if (health.status !== 0) fail('Endpointul llama.cpp local nu este sănătos')
  const models = commandResult('/usr/bin/curl', [
    '--fail', '--silent', '--show-error', '--max-time', '30', `${OPENCODE_BASE_URL}/models`,
  ], undefined, openCodeParentEnv())
  if (models.status !== 0) fail('Endpointul llama.cpp local nu publică modelul activ')
  let modelPayload
  try {
    modelPayload = JSON.parse(String(models.stdout ?? ''))
  } catch {
    fail('Răspunsul /v1/models al llama.cpp nu este JSON valid')
  }
  const modelIds = Array.isArray(modelPayload?.data)
    ? modelPayload.data.map((item) => item?.id).filter((value) => typeof value === 'string')
    : []
  if (modelIds.length !== 1 || ![OPENCODE_MODEL_ID, POWERFUL_OPENCODE_MODEL_ID].includes(modelIds[0])) {
    fail('Endpointul unic llama.cpp nu publică exact un model Constructor permis')
  }
  return modelIds[0]
}

function assertActiveLocalModel(expectedModelId) {
  if (![OPENCODE_MODEL_ID, POWERFUL_OPENCODE_MODEL_ID].includes(expectedModelId)) {
    fail('Modelul activ solicitat pentru verificare este invalid')
  }
  if (activeLocalModelId() !== expectedModelId) {
    fail(`Endpointul unic llama.cpp nu are activ exclusiv modelul ${expectedModelId}`)
  }
  return true
}

function activeConstructorProfile() {
  const modelId = activeLocalModelId()
  return modelId === POWERFUL_OPENCODE_MODEL_ID
    ? CONSTRUCTOR_MODEL_PROFILES.powerful
    : CONSTRUCTOR_MODEL_PROFILES.fast
}

export function validateOpenCodeConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) fail('Configurația OpenCode este invalidă')
  if (config.autoupdate !== false || config.share !== 'disabled') fail('OpenCode trebuie să aibă update-ul și partajarea dezactivate')
  if (config.model !== FAST_OPENCODE_MODEL || (config.small_model ?? config.model) !== FAST_OPENCODE_MODEL) {
    fail('OpenCode nu are modelul FAST local drept implicit unic')
  }
  if (!Array.isArray(config.enabled_providers) || config.enabled_providers.length !== 1 || config.enabled_providers[0] !== 'llama.cpp') {
    fail('OpenCode trebuie să aibă exclusiv providerul llama.cpp activ')
  }
  const providers = config.provider
  if (!providers || typeof providers !== 'object' || Array.isArray(providers) || Object.keys(providers).join(',') !== 'llama.cpp') {
    fail('Configurația OpenCode conține provideri neautorizați')
  }
  const local = providers['llama.cpp']
  const configuredModels = Object.keys(local?.models ?? {}).sort()
  if (
    !local
    || local.npm !== '@ai-sdk/openai-compatible'
    || local.options?.baseURL !== OPENCODE_BASE_URL
    || Object.hasOwn(local.options ?? {}, 'apiKey')
    || configuredModels.join(',') !== [POWERFUL_OPENCODE_MODEL_ID, OPENCODE_MODEL_ID].sort().join(',')
  ) fail('Providerul OpenCode nu are exact configurația duală FAST/POWERFUL pe endpointul llama.cpp unic')
  const permissions = config.permission
  for (const capability of ['*', 'read', 'glob', 'grep', 'edit', 'bash', 'task', 'skill', 'webfetch', 'websearch', 'external_directory']) {
    if (permissions?.[capability] !== 'allow') fail(`OpenCode nu are accesul complet cerut pentru ${capability}`)
  }
  return true
}

function assertEnabledLayout(expectedModelId) {
  if (process.platform !== 'linux') fail('Execuția OpenCode este permisă numai pe Linux')
  if (process.getuid?.() === 0) fail('Supervisorul rulează necanonic ca root; OpenCode trebuie să escaladeze explicit prin sudo')
  if (OPENCODE_MODEL !== FAST_OPENCODE_MODEL) fail('Modelul implicit al workerului trebuie să fie treapta FAST de 35B')
  if (OPENCODE_BASE_URL !== 'http://127.0.0.1:24080/v1') fail('llama.cpp trebuie să rămână pe endpointul loopback unic fixat')
  const actual = {
    openCodeBin: OPENCODE_BIN,
    openCodeConfigHome: OPENCODE_CONFIG_HOME,
    openCodeConfig: OPENCODE_CONFIG,
    repo: REPO,
    jobs: JOBS,
    handoffReady: HANDOFF_READY,
  }
  for (const [name, expected] of Object.entries(REQUIRED_LAYOUT)) {
    if (name === 'sudo' || name === 'podman') continue
    if (actual[name] !== expected) fail(`Layout OpenCode necanonic: ${name}`)
  }

  if (!existsSync(OPENCODE_BIN) || realpathSync(OPENCODE_BIN) !== REQUIRED_LAYOUT.openCodeBin) fail('OpenCode trebuie să fie binarul canonic fixat')
  assertRootOwnedReadonly(OPENCODE_BIN, 'CLI-ul OpenCode')
  const sudoPath = REQUIRED_LAYOUT.sudo
  if (!existsSync(sudoPath) || realpathSync(sudoPath) !== REQUIRED_LAYOUT.sudo) fail('sudo trebuie să fie exact /usr/bin/sudo')
  assertRootOwnedReadonly(sudoPath, 'sudo')
  const rootIdentity = exactOutput(sudoPath, ['-n', '-u', 'root', '--', '/usr/bin/id', '-u'], undefined, openCodeParentEnv())
  if (rootIdentity !== '0') fail('OpenCode nu are acces root non-interactiv prin sudo')
  const rootOpenCodeVersion = exactOutput(sudoPath, rootOpenCodeArgs(['--version']), undefined, openCodeParentEnv())
  if (rootOpenCodeVersion !== OPENCODE_VERSION) fail('Executorul root nu pornește binarul OpenCode fixat')
  repairSupervisorOwnership()

  const podmanPath = REQUIRED_LAYOUT.podman
  if (!existsSync(podmanPath) || realpathSync(podmanPath) !== REQUIRED_LAYOUT.podman) fail('podman trebuie să fie exact /usr/bin/podman')
  assertRootOwnedReadonly(podmanPath, 'podman')
  const podmanProbe = commandResult(podmanPath, ['--version'], undefined, podmanSupervisorEnv())
  if (podmanProbe.status !== 0) {
    const diagnostic = String(podmanProbe.stderr ?? '')
      .replace(/[^\x20-\x7e]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 240)
    fail(`podman rootless nu pornește: status=${String(podmanProbe.status)} signal=${String(podmanProbe.signal)} stderr=${diagnostic || 'absent'}`)
  }

  const configInfo = lstatSync(OPENCODE_CONFIG)
  if (!configInfo.isFile() || configInfo.isSymbolicLink() || configInfo.nlink !== 1) fail('Configurația OpenCode nu este un fișier regulat unic')
  assertRootOwnedReadonly(OPENCODE_CONFIG, 'Configurația OpenCode')
  if (configInfo.size < 2 || configInfo.size > 128 * 1024) fail('Configurația OpenCode are dimensiune invalidă')
  validateOpenCodeConfig(JSON.parse(readFileSync(OPENCODE_CONFIG, 'utf8')))

  const version = exactOutput(OPENCODE_BIN, ['--version'], undefined, openCodeParentEnv())
  if (version !== OPENCODE_VERSION) fail(`Versiunea OpenCode trebuie să fie exact ${OPENCODE_VERSION}`)
  assertActiveLocalModel(expectedModelId)

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
  // Imaginea gate se improspateaza abia la deploy, dar clona dedicata urmareste
  // origin/master imediat. Intre un merge si deployul urmator cele doua diverg,
  // iar o comparatie cu varful mobil al lui master respinge orice ordin din acel
  // interval — inclusiv ordinele deja pornite, care mor la jumatatea executiei.
  // Ordinul se ancoreaza deci in commitul din care a fost construita imaginea
  // gate: acelasi cod ruleaza in container si in worktree. Cerem doar ca acel
  // commit sa existe in clona si sa fie stramos al lui origin/master, adica sa
  // fie cod chiar ajuns pe master, nu unul arbitrar.
  if (!/^[0-9a-f]{40}$/.test(gateRevision ?? '')) fail('Imaginea gate nu declară commitul din care a fost construită')
  if (gateRevision !== expectedCommit) {
    if (!commandOk('/usr/bin/git', ['rev-parse', '--verify', `${gateRevision}^{commit}`], REPO, gitSupervisorEnv())) {
      fail('Commitul imaginii gate nu există în clona dedicată')
    }
    if (!commandOk('/usr/bin/git', ['merge-base', '--is-ancestor', gateRevision, expectedCommit], REPO, gitSupervisorEnv())) {
      fail('Imaginea gate nu a fost construită dintr-un commit aflat pe origin/master')
    }
  }
  return gateRevision
}

async function preflight() {
  if (!EXEC_ENABLED) return { problem: 'Execuția locală este dezactivată explicit', profile: null }
  try {
    const profile = activeConstructorProfile()
    // Commitul imaginii gate este si baza pe care se executa ordinul: containerul
    // de porti si worktree-ul trebuie sa contina exact acelasi cod.
    const gateCommit = assertEnabledLayout(profile.modelId)
    return { problem: null, profile, gateCommit }
  } catch (error) {
    return {
      problem: error instanceof Error ? error.message : 'Preflightul OpenCode a eșuat',
      profile: null,
      gateCommit: null,
    }
  }
}

export function runSucceeded(result) {
  return result?.code === 0
    && result.signal === null
    && result.timedOut === false
    && result.aborted === false
    && result.outputExceeded === false
}

function runLogged(command, args, cwd, logPath, env, stdin = null, timeoutMs = 30 * 60_000, signal = undefined, privilegedKill = false, maxLogBytes = WORKER_LOG_MAX_BYTES) {
  return new Promise((done, reject) => {
    if (!Number.isSafeInteger(maxLogBytes) || maxLogBytes <= 0 || maxLogBytes > WORKER_LOG_MAX_BYTES) {
      reject(new Error('Limita jurnalului worker este invalidă'))
      return
    }
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Lease-ul jobului a fost pierdut'))
      return
    }
    let fd = null
    let logBytes = 0
    try {
      fd = openSync(logPath, 'a', 0o600)
      const info = fstatSync(fd)
      if (!info.isFile()) throw new Error('Jurnalul worker nu este fișier regulat')
      if (info.size > maxLogBytes) ftruncateSync(fd, maxLogBytes)
      logBytes = Math.min(info.size, maxLogBytes)
      if (logBytes === maxLogBytes) {
        closeSync(fd)
        fd = null
        done({ code: 1, signal: null, timedOut: false, aborted: false, outputExceeded: true })
        return
      }
    } catch (error) {
      if (fd !== null) closeSync(fd)
      reject(error)
      return
    }
    let settled = false
    let killTimer = null
    let timedOut = false
    let aborted = false
    let outputExceeded = false
    let outputError = null
    let child
    try {
      child = spawn(command, args, {
        cwd,
        env,
        stdio: [stdin === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
        detached: true,
        windowsHide: true,
      })
    } catch (error) {
      closeSync(fd)
      reject(error)
      return
    }
    const signalGroup = (name) => {
      if (privilegedKill) {
        const killed = spawnSync(
          '/usr/bin/sudo',
          ['-n', '-u', 'root', '--', '/usr/bin/kill', `-${name.replace(/^SIG/, '')}`, '--', `-${child.pid}`],
          { env: openCodeParentEnv(), stdio: 'ignore', timeout: 10_000, windowsHide: true },
        )
        if (killed.status === 0) return
      }
      try {
        process.kill(-child.pid, name)
      } catch {
        try { child.kill(name) } catch { /* procesul s-a închis deja */ }
      }
    }
    const terminate = () => {
      if (settled || killTimer) return
      signalGroup('SIGTERM')
      killTimer = setTimeout(() => {
        if (!settled) signalGroup('SIGKILL')
      }, 2_000)
      killTimer.unref()
    }
    const appendOutput = (value) => {
      if (settled || outputExceeded || outputError) return
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      const accepted = Math.min(chunk.length, maxLogBytes - logBytes)
      try {
        let offset = 0
        while (offset < accepted) {
          const written = writeSync(fd, chunk, offset, accepted - offset)
          if (written === 0) throw new Error('Scriere nulă în jurnalul worker')
          offset += written
        }
        logBytes += accepted
      } catch (error) {
        outputError = error
        terminate()
        return
      }
      if (accepted < chunk.length) {
        outputExceeded = true
        terminate()
      }
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
      if (fd !== null) {
        closeSync(fd)
        fd = null
      }
    }
    child.stdout.on('data', appendOutput)
    child.stderr.on('data', appendOutput)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.once('error', (error) => {
      if (settled) return
      settled = true
      cleanup()
      reject(error)
    })
    child.once('exit', () => {
      // `sudo` poate ieși la SIGTERM înaintea executorului său. Grupul încă
      // păstrează PGID-ul inițial, deci îl închidem definitiv înainte de cleanup.
      if (killTimer) signalGroup('SIGKILL')
    })
    child.once('close', (code, exitSignal) => {
      if (settled) return
      settled = true
      cleanup()
      if (outputError) {
        reject(outputError)
        return
      }
      done(outputExceeded
        ? { code: 1, signal: null, timedOut, aborted, outputExceeded: true }
        : { code: code ?? 1, signal: exitSignal, timedOut, aborted, outputExceeded: false })
    })
    if (stdin !== null) {
      child.stdin.on('error', () => undefined)
      child.stdin.end(stdin)
    }
  })
}

function canonicalDirectory(path, label) {
  const canonical = resolve(path)
  const info = lstatSync(canonical)
  if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(canonical) !== canonical) {
    fail(`${label} nu este un director canonic`)
  }
  return canonical
}

function isInsideOrEqual(parent, child) {
  const base = resolve(parent)
  const candidate = resolve(child)
  return candidate === base || candidate.startsWith(`${base}/`)
}

function rootExecutorOwnershipScope(jobDir) {
  const worktree = canonicalDirectory(jobDir, 'Worktree-ul OpenCode')
  assertDescendant(JOBS, worktree, 'Worktree OpenCode la schimbarea ownershipului')
  const commonOutput = exactOutput(
    '/usr/bin/git',
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    worktree,
    gitSupervisorEnv(),
  )
  if (!commonOutput || commonOutput.includes('\0') || commonOutput.includes('\n') || commonOutput.includes('\r')) {
    fail('Directorul Git comun al worktree-ului este invalid')
  }
  const gitCommon = canonicalDirectory(commonOutput, 'Directorul Git comun al worktree-ului')
  let externalGitCommon = null
  if (!isInsideOrEqual(worktree, gitCommon)) {
    const expectedRepoGit = canonicalDirectory(join(REPO, '.git'), 'Directorul Git al clonei dedicate')
    if (gitCommon !== expectedRepoGit) fail('Worktree-ul OpenCode folosește un director Git comun neautorizat')
    externalGitCommon = gitCommon
  }
  return Object.freeze({ worktree, externalGitCommon })
}

function chownAsRoot(paths, owner, failureMessage) {
  const changed = spawnSync(
    '/usr/bin/sudo',
    ['-n', '-u', 'root', '--', '/usr/bin/chown', '-R', '-P', '--no-dereference', owner, '--', ...paths],
    { env: openCodeParentEnv(), stdio: 'ignore', timeout: 60_000, windowsHide: true },
  )
  if (changed.status !== 0) fail(failureMessage)
}

function supervisorOwner() {
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(gid) || uid === 0) fail('Identitatea workerului pentru ownership este invalidă')
  return `${uid}:${gid}`
}

function repairSupervisorOwnership() {
  const jobs = canonicalDirectory(JOBS, 'Directorul joburilor Constructor')
  canonicalDirectory(REPO, 'Clona dedicată Constructor')
  const repoGit = canonicalDirectory(join(REPO, '.git'), 'Directorul Git al clonei dedicate')
  chownAsRoot(
    [jobs, repoGit],
    supervisorOwner(),
    'Ownershipul supervisorului nu a putut fi recuperat înainte de preflight',
  )
}

function restoreJobOwnership(jobStateDir, scope = null) {
  assertDescendant(JOBS, jobStateDir, 'Directorul jobului la restabilirea ownershipului')
  canonicalDirectory(jobStateDir, 'Directorul jobului după execuția OpenCode')
  const paths = [resolve(jobStateDir)]
  if (scope?.externalGitCommon) {
    const expectedRepoGit = canonicalDirectory(join(REPO, '.git'), 'Directorul Git al clonei după execuția OpenCode')
    if (scope.externalGitCommon !== expectedRepoGit) fail('Directorul Git comun s-a schimbat în timpul execuției OpenCode')
    paths.push(expectedRepoGit)
  }
  chownAsRoot(paths, supervisorOwner(), 'Ownershipul worktree-ului OpenCode nu a putut fi restabilit')
}

function rootGitStatus(worktree, cwd) {
  return commandResult(
    REQUIRED_LAYOUT.sudo,
    [
      '-n', '-u', 'root', '--', '/usr/bin/env', '-i',
      ...openCodeRootEnvironmentArgs(worktree),
      '/usr/bin/git', '-C', resolve(worktree), 'status', '--porcelain=v1', '--untracked-files=no',
    ],
    cwd,
    openCodeParentEnv(),
  )
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

function emitClaimProof(state) {
  if (process.argv[2] !== '--self-test') process.stdout.write(`OPENCODE_WORKER_CLAIM_VERIFIED state=${state}\n`)
}

/** Un worker nu este `ready` până când a reconciliat orice handoff durabil și
 * a citit cu succes coada. Un claim valid devine `busy` înainte de primul
 * eveniment, astfel încât un 5xx la `accepted` nu lasă un heartbeat verde
 * peste un job deja trecut durabil în running. */
async function prepareWorkerClaim(secret, dependencies = {}) {
  const cleanup = dependencies.cleanup ?? cleanupRetiredHandoffs
  const reconcile = dependencies.reconcile ?? reconcilePendingHandoffs
  const claim = dependencies.claim ?? ((value) => {
    const profile = dependencies.profile
    if (profile !== 'fast' && profile !== 'powerful') fail('Profilul claimului Constructor nu este valid')
    return post(value, '/api/internal/codex/jobs/claim', { profile })
  })
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
      emitClaimProof('no_claimable_job')
      return null
    }
    if (response.state === 'pipeline_active') {
      await reportHeartbeat(secret, 'busy', 'Un ordin Constructor este deja running; workerul nu revendică un executor paralel')
      emitClaimProof('pipeline_active')
      return null
    }
    const job = response.job
    await reportHeartbeat(secret, 'busy', 'Workerul a revendicat un ordin și îl pregătește în worktree-ul dedicat')
    emitClaimProof('claimed')
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
    await report(secret, job.jobId, { taskId: job.taskId, event: 'accepted', progress: 'Ordin acceptat în worktree-ul dedicat' })
  } catch (error) {
    await degradedWithoutMasking(
      secret,
      'Ordinul a fost revendicat, dar evenimentul accepted nu a putut fi persistat; watchdogul îl va închide tehnic fără retry',
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

function worktreeHasChanges(jobDir) {
  const status = gitResult(['status', '--porcelain=v1', '-z', '--untracked-files=all', '--'], jobDir, WORKER_LOG_MAX_BYTES)
  if (status.status !== 0 || status.signal !== null || status.error) fail('Nu am putut verifica modificările worktree-ului')
  return Buffer.byteLength(String(status.stdout ?? ''), 'utf8') > 0
}

async function runConstructorTurn(secret, jobId, taskId, jobStateDir, jobDir, orderPath, ownershipScope, turn) {
  const logPrefix = `model-${turn.tier}`
  const executorLogPath = join(jobStateDir, `${logPrefix}-opencode.log`)
  const gateLogPath = join(jobStateDir, `${logPrefix}-gates.log`)
  const stopExecLease = startJobLease(
    secret,
    jobId,
    taskId,
    `Model selectat manual ${turn.label}: OpenCode execută ordinul`,
  )
  let executorAttempted = false
  let executorResult = null
  let executorError = null
  try {
    executorAttempted = true
    try {
      executorResult = await runLogged(
        REQUIRED_LAYOUT.sudo,
        rootOpenCodeArgs(openCodeExecArgs(jobDir, orderPath, turn.model), jobDir),
        jobDir,
        executorLogPath,
        openCodeParentEnv(),
        null,
        30 * 60_000,
        stopExecLease.signal,
        true,
      )
    } catch (error) {
      executorError = error
    }
  } finally {
    try {
      await stopExecLease()
    } finally {
      if (executorAttempted && existsSync(jobStateDir)) restoreJobOwnership(jobStateDir, ownershipScope)
    }
  }
  if (executorError || !runSucceeded(executorResult)) {
    return {
      ok: false,
      phase: 'opencode',
      ...classifyWorkerOutcome(executorLogPath, 'opencode', executorResult ?? {}, executorError),
      logPath: executorLogPath,
    }
  }
  if (!worktreeHasChanges(jobDir)) {
    return { ok: false, event: 'unresolved', phase: 'opencode', reason: 'no_changes', logPath: executorLogPath }
  }

  const stopGateLease = startJobLease(
    secret,
    jobId,
    taskId,
    `Model selectat manual ${turn.label}: verific porțile locale în imaginea fixată`,
  )
  let gateResult = null
  let gateError = null
  try {
    try {
      gateResult = await runLogged(
        REQUIRED_LAYOUT.podman,
        gateContainerArgs(jobDir),
        jobDir,
        gateLogPath,
        podmanSupervisorEnv(),
        null,
        45 * 60_000,
        stopGateLease.signal,
      )
    } catch (error) {
      gateError = error
    }
  } finally {
    await stopGateLease()
  }
  if (gateError || !runSucceeded(gateResult)) {
    return {
      ok: false,
      phase: 'gate',
      ...classifyWorkerOutcome(gateLogPath, 'gate', gateResult ?? {}, gateError),
      logPath: gateLogPath,
    }
  }
  return { ok: true, phase: 'gate', code: null, logPath: gateLogPath }
}

async function runOnce() {
  assertLoopbackApi()
  const secret = loadSecret()
  const { problem, profile, gateCommit } = await preflight()
  if (problem) {
    await heartbeat(secret, 'setup_required', problem)
    if (!EXEC_ENABLED) return
    fail(problem)
  }
  if (!profile) fail('Preflightul nu a furnizat modelul selectat manual')
  if (!/^[0-9a-f]{40}$/.test(gateCommit ?? '')) fail('Preflightul nu a furnizat commitul imaginii gate')

  const claimed = await prepareWorkerClaim(secret, { profile: profile.tier })
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
      ['-c', 'core.hooksPath=/dev/null', 'worktree', 'add', '--detach', jobDir, gateCommit],
      { cwd: REPO, env: gitSupervisorEnv(), stdio: 'ignore', timeout: 60_000 },
    )
    if (added.status !== 0) fail('Nu am putut crea worktree-ul dedicat')
    worktreeAdded = true
    const baseCommit = exactOutput('/usr/bin/git', ['rev-parse', 'HEAD'], jobDir, gitSupervisorEnv())
    // Baza este commitul imaginii gate, verificat in preflight ca fiind stramos
    // al lui origin/master. Nu folosim varful lui master: acesta se poate muta
    // in timpul executiei, iar ordinul ar muri fara vina lui.
    if (!/^[0-9a-f]{40}$/.test(baseCommit ?? '') || baseCommit !== gateCommit) fail('Worktree-ul nu corespunde commitului imaginii gate')
    writeFileSync(join(jobStateDir, 'job.json'), `${JSON.stringify({ jobId, taskId, baseCommit, executor: 'opencode-local-qwen', profile: profile.tier, createdAt: new Date().toISOString() })}\n`, { mode: 0o600 })
    const orderPath = join(jobStateDir, 'order.md')
    writeFileSync(orderPath, `${effectiveOrder}\n`, { flag: 'wx', mode: 0o600 })

    const ownershipScope = rootExecutorOwnershipScope(jobDir)
    const finalOutcome = await runConstructorTurn(
      secret,
      jobId,
      taskId,
      jobStateDir,
      jobDir,
      orderPath,
      ownershipScope,
      profile,
    )
    logPath = finalOutcome.logPath
    if (!finalOutcome.ok) {
      if (finalOutcome.event === 'unresolved') {
        await reportEvent(secret, jobId, {
          taskId,
          event: 'unresolved',
          reason: assertWorkerUnresolvedReason(finalOutcome.reason),
          profile: profile.tier,
        })
      } else {
        const code = assertWorkerFailureCode(finalOutcome.code)
        await reportEvent(secret, jobId, { taskId, event: 'failed', code, profile: profile.tier })
      }
      failureReported = true
      await heartbeat(
        secret,
        'degraded',
        finalOutcome.event === 'unresolved'
          ? `${profile.label} nu a produs un rezultat publicabil; ordinul rămâne nerezolvat, fără comutare sau retry automat`
          : `Execuția cu ${profile.label} s-a oprit tehnic; cauza nu este clasificată drept insuficiență de model`,
      )
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
      await reportEvent(secret, jobId, { taskId, event: 'failed', code, profile: profile.tier }).catch(() => undefined)
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

async function executorSmoke() {
  const { problem, profile } = await preflight()
  if (problem) fail(problem)
  if (!profile) fail('Preflightul smoke nu a furnizat modelul selectat manual')
  mkdirSync(JOBS, { recursive: true, mode: 0o700 })
  const smokeStateDir = mkdtempSync(join(JOBS, '.opencode-smoke-'))
  const smokeDir = join(smokeStateDir, 'worktree')
  mkdirSync(smokeDir, { mode: 0o755 })
  assertDescendant(JOBS, smokeStateDir, 'Directorul smoke OpenCode')
  assertDescendant(smokeStateDir, smokeDir, 'Worktree-ul smoke OpenCode')
  const nonce = `KELION_OPENCODE_${randomUUID()}`
  const proofPath = join(smokeDir, 'executor-proof.txt')
  const gitProofPath = join(smokeDir, 'git-status-proof.txt')
  const trackedPath = join(smokeDir, 'tracked.txt')
  const orderPath = join(smokeStateDir, 'order.md')
  const logPath = join(smokeStateDir, 'executor-smoke.log')
  const expectedGitStatus = ' M tracked.txt\n'
  try {
    const initialized = commandResult('/usr/bin/git', ['init', '--quiet'], smokeDir, gitSupervisorEnv())
    if (initialized.status !== 0) fail('Repo-ul temporar pentru smoke OpenCode nu a putut fi inițializat')
    writeFileSync(trackedPath, 'baseline\n', { flag: 'wx', mode: 0o600 })
    const committed = commandResult(
      '/usr/bin/git',
      ['-c', 'user.name=Kelion Executor Smoke', '-c', 'user.email=executor-smoke@localhost', 'add', '--', 'tracked.txt'],
      smokeDir,
      gitSupervisorEnv(),
    )
    if (committed.status !== 0) fail('Fișierul urmărit al smoke-ului Git nu a putut fi indexat')
    const baseline = commandResult(
      '/usr/bin/git',
      ['-c', 'user.name=Kelion Executor Smoke', '-c', 'user.email=executor-smoke@localhost', 'commit', '--quiet', '-m', 'executor smoke baseline'],
      smokeDir,
      gitSupervisorEnv(),
    )
    if (baseline.status !== 0) fail('Commitul local al smoke-ului Git nu a putut fi creat')
    writeFileSync(trackedPath, `baseline\n${nonce}\n`, { mode: 0o600 })
    const order = [
      'Execută numai această probă deterministă.',
      'Rulează `/usr/bin/git status --porcelain=v1 --untracked-files=no` în worktree.',
      'Stdout trebuie să fie exact ` M tracked.txt` urmat de newline.',
      `Creează fișierul ${gitProofPath} cu exact acel stdout, inclusiv newline-ul final.`,
      `Creează fișierul ${proofPath} cu exact textul ${nonce} urmat de newline.`,
      'Nu modifica tracked.txt, nu indexa nimic, nu crea commit și oprește-te după ce verifici ambele fișiere.',
    ].join('\n')
    writeFileSync(orderPath, `${order}\n`, { flag: 'wx', mode: 0o600 })
    const ownershipScope = rootExecutorOwnershipScope(smokeDir)
    let executorAttempted = false
    let result
    try {
      executorAttempted = true
      const gitProbe = rootGitStatus(smokeDir, smokeStateDir)
      if (gitProbe.status !== 0 || String(gitProbe.stdout ?? '') !== expectedGitStatus) {
        fail('Executorul root nu poate rula Git status în worktree-ul smoke')
      }
      result = await runLogged(
        REQUIRED_LAYOUT.sudo,
        rootOpenCodeArgs(openCodeExecArgs(smokeDir, orderPath, profile.model), smokeDir),
        smokeDir,
        logPath,
        openCodeParentEnv(),
        null,
        15 * 60_000,
        undefined,
        true,
      )
    } finally {
      if (executorAttempted && existsSync(smokeStateDir)) restoreJobOwnership(smokeStateDir, ownershipScope)
    }
    if (!runSucceeded(result)) {
      const diagnostic = tailText(logPath, 8 * 1024)
        .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '?')
      fail(`Smoke-ul OpenCode a eșuat cu codul ${result.code}; jurnal sigur:\n${diagnostic}`)
    }
    if (!existsSync(proofPath) || readFileSync(proofPath, 'utf8') !== `${nonce}\n`) {
      fail('Smoke-ul OpenCode nu a produs editarea deterministă cerută')
    }
    if (!existsSync(gitProofPath) || readFileSync(gitProofPath, 'utf8') !== expectedGitStatus) {
      fail('Smoke-ul OpenCode nu a dovedit comanda Git status cerută')
    }
    const supervisorGitProbe = commandResult(
      '/usr/bin/git',
      ['status', '--porcelain=v1', '--untracked-files=no'],
      smokeDir,
      gitSupervisorEnv(),
    )
    if (supervisorGitProbe.status !== 0 || String(supervisorGitProbe.stdout ?? '') !== expectedGitStatus) {
      fail('Ownershipul Git nu a fost restabilit după smoke-ul OpenCode')
    }
    const proofSha256 = createHash('sha256').update(readFileSync(proofPath)).digest('hex')
    process.stdout.write('OPENCODE_EXECUTOR_GIT_VERIFIED status=porcelain-v1\n')
    process.stdout.write(`OPENCODE_EXECUTOR_SMOKE_VERIFIED sha256=${proofSha256}\n`)
  } finally {
    rmSync(smokeStateDir, { recursive: true, force: true })
  }
}

async function transportSmoke() {
  assertLoopbackApi()
  const secret = loadSecret()
  await heartbeat(secret, 'busy', 'Transportul HMAC al workerului OpenCode a fost verificat fără claim')
  process.stdout.write('OPENCODE_WORKER_TRANSPORT_VERIFIED no_claim=true\n')
}

async function selfTest() {
  if (OPENCODE_MODEL !== FAST_OPENCODE_MODEL) fail('Self-testul cere modelul FAST drept implicit')
  if (
    CONSTRUCTOR_MODEL_PROFILES.fast.model !== FAST_OPENCODE_MODEL
    || CONSTRUCTOR_MODEL_PROFILES.fast.modelId !== OPENCODE_MODEL_ID
    || CONSTRUCTOR_MODEL_PROFILES.powerful.model !== POWERFUL_OPENCODE_MODEL
    || CONSTRUCTOR_MODEL_PROFILES.powerful.modelId !== POWERFUL_OPENCODE_MODEL_ID
  ) fail('Catalogul modelelor selectabile manual diferă de politica Constructor')
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
  const loginArgs = codexApiLoginArgs()
  if (loginArgs.join(' ') !== '-c forced_login_method="api" -c cli_auth_credentials_store="file" login --with-api-key') {
    fail('Loginul Codex nu fixează API-key și cache-ul file înainte de subcomandă')
  }
  const loginStatusArgs = codexLoginStatusArgs()
  if (loginStatusArgs.join(' ') !== '-c forced_login_method="api" -c cli_auth_credentials_store="file" login status') {
    fail('Statusul Codex nu citește determinist cache-ul API-key din fișier')
  }
  if (!isCodexProjectKeyStatus(Buffer.from('Logged in using an API key - sk-proj-***xxxxx\n', 'ascii'))) {
    fail('Statusul API-key Codex valid nu este recunoscut')
  }
  if (isCodexProjectKeyStatus(Buffer.from('Logged in using ChatGPT\n', 'ascii'))) {
    fail('Statusul ChatGPT nu poate valida loginul API-key')
  }
  assertProjectKeyCredential(Buffer.from(`sk-proj-${'x'.repeat(32)}`, 'ascii'))
  for (const invalid of [
    Buffer.from(`sk-admin-${'x'.repeat(32)}`, 'ascii'),
    Buffer.from(`sk-proj-${'x'.repeat(16)}\nextra`, 'ascii'),
    Buffer.from('disabled-placeholder-openai', 'ascii'),
  ]) {
    let rejected = false
    try {
      assertProjectKeyCredential(invalid)
    } catch {
      rejected = true
    }
    if (!rejected) fail('Validatorul credentialei Codex acceptă o valoare necanonică')
  }
  if (!incompleteDualConfigRejected) fail('Configurația OpenCode acceptă lipsa treptei POWERFUL')
  const gateArgs = gateContainerArgs(
    '/var/lib/kelion-codex/jobs/codex-test/worktree',
    'ghcr.io/example/repository/codex-gates@sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    { uid: 1000, gid: 1000 },
  )
  for (const fixed of ['--pull=never', '--network=none', '--read-only', '--cap-drop=all', '--security-opt=no-new-privileges']) {
    if (!gateArgs.includes(fixed)) fail(`Containerului de porți îi lipsește ${fixed}`)
  }
  if (gateArgs.some((value) => /OPENAI|SECRET|TOKEN|CREDENTIAL/i.test(value))) fail('Containerul de porți primește un nume de secret')
  const parentEnv = openCodeParentEnv()
  const expectedParentEnv = {
    PATH: '/usr/bin:/bin',
    LANG: 'C.UTF-8',
    LC_ALL: 'C.UTF-8',
    NO_COLOR: '1',
    CI: '1',
  }
  if (canonicalJson(parentEnv) !== canonicalJson(expectedParentEnv)) fail('Procesul sudo moștenește un mediu neautorizat')
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
  for (const reason of WORKER_UNRESOLVED_REASONS) {
    if (assertWorkerUnresolvedReason(reason) !== reason) fail('Catalog worker unresolved inconsistent')
  }
  for (const retiredCode of ['provider_auth', 'provider_credit', 'codex_exec_failed', 'no_changes', 'test_failure', 'quality_gate_failure']) {
    let rejected = false
    try {
      assertWorkerFailureCode(retiredCode)
    } catch {
      rejected = true
    }
    if (!rejected) fail(`Catalogul activ acceptă încă un cod retras: ${retiredCode}`)
  }
  const successfulRun = { code: 0, signal: null, timedOut: false, aborted: false, outputExceeded: false }
  if (!runSucceeded(successfulRun)) fail('Rezultatul canonic reușit este refuzat')
  for (const rejectedRun of [
    { ...successfulRun, signal: 'SIGTERM' },
    { ...successfulRun, timedOut: true },
    { ...successfulRun, aborted: true },
    { ...successfulRun, outputExceeded: true },
  ]) {
    if (runSucceeded(rejectedRun)) fail('Rezultatul ambiguu al unei execuții este acceptat ca succes')
  }
  if (classifyWorkerFailure(null, 'gate', { timedOut: true }) !== 'execution_timeout') fail('Timeout worker neclasificat')
  const timedOutOutcome = classifyWorkerOutcome(null, 'gate', { timedOut: true })
  if (timedOutOutcome.event !== 'failed' || timedOutOutcome.code !== 'execution_timeout') fail('Timeout-ul gate nu rămâne tehnic')
  const gateClassificationDir = mkdtempSync(join(tmpdir(), 'kelion-worker-gate-classification-'))
  try {
    const classifiedGate = (name, output, result, error = null) => {
      const path = join(gateClassificationDir, `${name}.log`)
      writeFileSync(path, output, { mode: 0o600 })
      return classifyWorkerOutcome(path, 'gate', result, error)
    }
    const cleanResult = (code) => ({ code, signal: null, timedOut: false, aborted: false, outputExceeded: false })
    const testOutcome = classifiedGate(
      'test-failure',
      'codex-gates: START schema=1\nFAIL src/example.test.ts: AssertionError\ncodex-gates: VERDICT schema=1 exit=1\n',
      cleanResult(1),
    )
    if (testOutcome.event !== 'unresolved' || testOutcome.reason !== 'test_failure') fail('Gate-ul de teste măsurat nu devine unresolved bounded')
    const qualityOutcome = classifiedGate(
      'quality-failure',
      'codex-gates: START schema=1\nerror TS2322: Type mismatch\ncodex-gates: VERDICT schema=1 exit=2\n',
      cleanResult(2),
    )
    if (qualityOutcome.event !== 'unresolved' || qualityOutcome.reason !== 'quality_gate_failure') fail('Gate-ul de calitate măsurat nu devine unresolved bounded')
    const staticQualityOutcome = classifiedGate(
      'static-quality-failure',
      'codex-gates: START schema=1\nRUTE DUBLATE (1):\n  GET /api/x\ncodex-gates: VERDICT schema=1 exit=1\n',
      cleanResult(1),
    )
    if (staticQualityOutcome.event !== 'unresolved' || staticQualityOutcome.reason !== 'quality_gate_failure') fail('Poarta statică bounded nu devine unresolved')

    const infrastructureFailures = [
      ['spawn-enoent', '', cleanResult(1), Object.assign(new Error('spawn /usr/bin/podman ENOENT'), { code: 'ENOENT' })],
      ['spawn-eacces', '', cleanResult(1), Object.assign(new Error('spawn /usr/bin/podman EACCES'), { code: 'EACCES' })],
      ['podman-125', 'Error: container runtime unavailable\n', cleanResult(125), null],
      ['sigkill', 'codex-gates: START schema=1\n', { ...cleanResult(1), signal: 'SIGKILL' }, null],
      ['oom-exit', 'codex-gates: START schema=1\nKilled process: out of memory\n', cleanResult(137), null],
      ['permission', 'codex-gates: START schema=1\npermission denied\ncodex-gates: VERDICT schema=1 exit=1\n', cleanResult(1), null],
      ['disk-full', 'codex-gates: START schema=1\nENOSPC: no space left on device\ncodex-gates: VERDICT schema=1 exit=1\n', cleanResult(1), null],
      ['missing-verdict', 'vitest failed: AssertionError\n', cleanResult(1), null],
      ['module-not-found', 'codex-gates: START schema=1\nError: MODULE_NOT_FOUND @ gate dependency\ncodex-gates: VERDICT schema=1 exit=1\n', cleanResult(1), null],
      ['unknown-receipt', 'codex-gates: START schema=1\nrunner stopped for an unclassified reason\ncodex-gates: VERDICT schema=1 exit=2\n', cleanResult(2), null],
      ['aborted', 'codex-gates: START schema=1\n', { ...cleanResult(1), aborted: true }, null],
      ['output-overflow', 'codex-gates: START schema=1\n', { ...cleanResult(1), outputExceeded: true }, null],
    ]
    for (const [name, output, result, error] of infrastructureFailures) {
      const outcome = classifiedGate(name, output, result, error)
      if (outcome.event !== 'failed' || outcome.code !== 'worker_internal_failure') {
        fail(`Eșecul de infrastructură gate este recomandat fals ca model insuficient: ${name}`)
      }
    }
  } finally {
    rmSync(gateClassificationDir, { recursive: true, force: true })
  }
  if (classifyWorkerOutcome(null, 'opencode', { code: 1 }, new Error('no changes')).code !== 'worker_internal_failure') {
    fail('Textul unui exit OpenCode eșuat este confundat cu verdictul măsurat unresolved')
  }
  for (const localFailure of [
    'connect ECONNREFUSED 127.0.0.1:24080',
    'llama.cpp model qwen3.6-35b-a3b-local unavailable',
    'fetch failed while contacting Qwen3',
  ]) {
    if (classifyWorkerFailure(null, 'opencode', {}, new Error(localFailure)) !== 'brain_unavailable') {
      fail(`Indisponibilitatea locală nu este clasificată brain_unavailable: ${localFailure}`)
    }
  }
  for (const obsoleteCloudFailure of [
    'invalid x-api-key authentication_error',
    'credit_balance_exhausted',
  ]) {
    if (classifyWorkerFailure(null, 'opencode', {}, new Error(obsoleteCloudFailure)) !== 'worker_internal_failure') {
      fail('Executorul local emite încă o taxonomie cloud')
    }
  }

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

  const runLoggedDir = mkdtempSync(join(tmpdir(), 'kelion-worker-run-logged-self-test-'))
  const abortLog = join(runLoggedDir, 'abort.log')
  try {
    const tailLog = join(runLoggedDir, 'tail.log')
    writeFileSync(tailLog, 'prefix-necitit\nTAIL-EXACT', { mode: 0o600 })
    if (tailText(tailLog, 10) !== 'TAIL-EXACT') fail('tailText nu citește exact coada bounded a jurnalului')

    const timeoutLog = join(runLoggedDir, 'timeout.log')
    const timedOut = await runLogged(
      process.execPath,
      ['-e', "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},1000)"],
      runLoggedDir,
      timeoutLog,
      { PATH: '/usr/bin:/bin' },
      null,
      1_000,
    )
    if (
      timedOut.code !== 0
      || timedOut.signal !== null
      || !timedOut.timedOut
      || runSucceeded(timedOut)
      || classifyWorkerFailure(timeoutLog, 'opencode', timedOut) !== 'execution_timeout'
    ) fail('Timeout-ul cu exit 0 poate avansa fals după executor')

    const overflowLog = join(runLoggedDir, 'overflow.log')
    const overflowLimit = 1_024
    const overflowed = await runLogged(
      process.execPath,
      ['-e', "process.stdout.write('o'.repeat(700));process.stderr.write('e'.repeat(700));setInterval(()=>{},1000)"],
      runLoggedDir,
      overflowLog,
      { PATH: '/usr/bin:/bin' },
      null,
      10_000,
      undefined,
      false,
      overflowLimit,
    )
    if (
      !overflowed.outputExceeded
      || overflowed.code !== 1
      || overflowed.signal !== null
      || runSucceeded(overflowed)
      || statSync(overflowLog).size !== overflowLimit
    ) fail('Depășirea stdout+stderr nu este oprită la plafonul exact al jurnalului')

    const controller = new AbortController()
    const running = runLogged(
      process.execPath,
      ['-e', `const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});process.on('SIGTERM',()=>process.exit(0));process.stdout.write(String(child.pid)+'\\n');setInterval(()=>{},1000)`],
      runLoggedDir,
      abortLog,
      { PATH: '/usr/bin:/bin' },
      null,
      10_000,
      controller.signal,
    )
    let descendantPid = null
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = tailText(abortLog, 64).trim()
      if (/^[1-9]\d*$/.test(value)) { descendantPid = Number(value); break }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
    }
    if (!Number.isSafeInteger(descendantPid)) fail('Self-testul abort nu a pornit descendentul')
    controller.abort(new Error('self-test-lease-lost'))
    const aborted = await running
    if (aborted.code !== 0 || aborted.signal !== null || !aborted.aborted || runSucceeded(aborted)) {
      fail('Abort-ul lease-ului cu exit 0 poate avansa fals spre gate sau handoff')
    }
    let descendantAlive = true
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        process.kill(descendantPid, 0)
        const stat = readFileSync(`/proc/${descendantPid}/stat`, 'utf8')
        const commandEnd = stat.lastIndexOf(')')
        const state = commandEnd >= 0 ? stat.slice(commandEnd + 2, commandEnd + 3) : ''
        if (state === 'Z' || state === 'X') { descendantAlive = false; break }
      } catch {
        descendantAlive = false
        break
      }
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
    }
    if (descendantAlive) fail('Descendentul executorului a rămas activ după abort')
  } finally {
    rmSync(runLoggedDir, { recursive: true, force: true })
  }
  process.stdout.write('codex-worker self-test: TRECE\n')
}

async function preflightOnly() {
  const { problem, profile } = await preflight()
  if (problem) fail(problem)
  if (!profile) fail('Preflightul nu a furnizat modelul selectat manual')
  process.stdout.write(`opencode ${OPENCODE_VERSION}\nmodel=${profile.modelId}\nopencode-local-full-access: TRECE\n`)
}

const mode = process.argv[2] ?? '--once'
if (mode === '--self-test') await selfTest()
else if (mode === '--preflight') await preflightOnly()
else if (mode === '--executor-smoke') await executorSmoke()
else if (mode === '--transport-smoke') await transportSmoke()
else if (mode === '--once') await runOnce()
else fail(`Mod necunoscut: ${mode}`)
