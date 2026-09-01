#!/usr/bin/env node

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  closeSync,
  chmodSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  openSync,
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  createServiceVerifier,
  readServiceSecret,
  requireRequestId,
} from './lib/service-auth.mjs'

export const CONTROL_SOCKET = '/run/kelion-constructor-model-control/control.sock'
export const SWITCH_HELPER = '/opt/private-ai/bin/constructor-model-switch'
export const CONTROL_SECRET = '/run/credentials/kelion-constructor-model-control.service/constructor-model-control-secret'
export const LLAMA_UNIT = 'private-ai-llm.service'
export const WORKER_UNIT = 'kelion-codex-worker.service'
export const WORKER_TIMER = 'kelion-codex-worker.timer'
export const DEFAULT_PROFILE = 'fast'
export const TRANSACTION_FILE = '/etc/private-ai/.constructor-model-switch-transaction'
export const HISTORY_FILE = '/etc/private-ai/.constructor-model-switch-history'
export const PUBLICATION_LOCK = '/run/kelion-constructor-model-control/publicare.lock'

const FAST_ALIAS = 'qwen3.6-35b-a3b-local'
const POWERFUL_ALIAS = 'qwen3.5-122b-a10b-local'
const LLAMA_HOST = '127.0.0.1'
const LLAMA_PORT = 24080
const MAX_BODY_BYTES = 1024
const MAX_COMMAND_BYTES = 64 * 1024
const REQUEST_HISTORY_LIMIT = 64
const FAST_RECEIPT = '/etc/private-ai/.install-complete'
const FAST_READY = '/var/lib/private-ai/model.ready'
const POWERFUL_RECEIPT = '/etc/private-ai/.max-model-sealed'
const POWERFUL_COMPLETE_RECEIPT = '/etc/private-ai/.max-model-complete'
const FAST_MODEL_SHA256 = '671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7'
const POWERFUL_ROOT = '/srv/private-ai/models/qwen3.5-122b-a10b-q4_k_m'
const POWERFUL_FIRST = `${POWERFUL_ROOT}/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf`
const LLAMA_BIN = '/opt/private-ai/bin/llama-server'
const WEB_UNIT = 'private-ai-web.service'
const LEGACY_DROPIN = '/etc/systemd/system/private-ai-llm.service.d/90-qwen35-122b-max.conf'
const BOOT_ID_FILE = '/proc/sys/kernel/random/boot_id'
const DEPLOYMENT_PENDING = '/run/kelion/constructor-activation.pending'
const RUNTIME_READY_STAMP = '/run/kelion/runtime-config-recovery.ready'
const REACTIVATION_JOURNAL = '/run/kelion-constructor-model-control/deploy-journals/constructor-reactivation.journal'
const DEPLOYMENT_JOURNALS = Object.freeze([
  '/run/kelion-constructor-model-control/deploy-journals/constructor-deploy-quiesce.journal',
  '/run/kelion-constructor-model-control/deploy-journals/constructor-upgrade.journal',
  '/run/kelion-constructor-model-control/deploy-journals/constructor-max-model.journal',
  '/run/kelion-constructor-model-control/deploy-journals/runtime-config-cutover.journal',
  '/run/kelion-constructor-model-control/deploy-journals/constructor-activation.journal',
  '/run/kelion-constructor-model-control/deploy-journals/constructor-gate-refresh.journal',
  '/run/kelion-constructor-model-control/deploy-journals/destructive-cutover-recovery.json',
  '/run/kelion-constructor-model-control/deploy-journals/constructor-unit-migration.pending',
  REACTIVATION_JOURNAL,
])
const POWERFUL_SHARDS = Object.freeze([
  Object.freeze({ name: 'Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf', bytes: 10_943_552 }),
  Object.freeze({ name: 'Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf', bytes: 49_968_146_912 }),
  Object.freeze({ name: 'Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf', bytes: 26_557_874_144 }),
])
const PROFILE_BY_ALIAS = Object.freeze({
  [FAST_ALIAS]: 'fast',
  [POWERFUL_ALIAS]: 'powerful',
})
const SAFE_ENV = Object.freeze({
  PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  LANG: 'C.UTF-8',
  LC_ALL: 'C.UTF-8',
})

function json(res, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value))
  res.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-length': body.length,
    'content-type': 'application/json; charset=utf-8',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

function collectBody(req) {
  return new Promise((resolvePromise, reject) => {
    const announced = Number(req.headers['content-length'] ?? -1)
    if (!Number.isSafeInteger(announced) || announced < 2 || announced > MAX_BODY_BYTES) {
      reject(new Error('body_size'))
      return
    }
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > announced || total > MAX_BODY_BYTES) {
        reject(new Error('body_size'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (total !== announced) reject(new Error('body_size'))
      else resolvePromise(Buffer.concat(chunks))
    })
    req.on('error', reject)
  })
}

function exactObject(raw, requiredKeys) {
  let value
  try {
    value = JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('body_json')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('body_schema')
  const actual = Object.keys(value).sort()
  const expected = [...requiredKeys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new Error('body_schema')
  }
  return value
}

function exactRawJson(raw, value) {
  if (!raw.equals(Buffer.from(JSON.stringify(value), 'utf8'))) throw new Error('body_schema')
}

export function runCommand(command, args, timeoutMs = 30_000) {
  return new Promise((resolvePromise) => {
    let child
    try {
      child = spawn(command, args, {
        env: SAFE_ENV,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      resolvePromise({ code: null, signal: null, stdout: '', failed: true })
      return
    }
    const chunks = []
    let bytes = 0
    let failed = false
    let settled = false
    const append = (chunk) => {
      if (failed) return
      bytes += chunk.length
      if (bytes > MAX_COMMAND_BYTES) {
        failed = true
        child.kill('SIGKILL')
      } else chunks.push(chunk)
    }
    child.stdout.on('data', append)
    child.stderr.on('data', () => undefined)
    const timer = setTimeout(() => {
      failed = true
      child.kill('SIGKILL')
    }, timeoutMs)
    timer.unref()
    child.once('error', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ code: null, signal: null, stdout: '', failed: true })
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        code,
        signal,
        stdout: Buffer.concat(chunks).toString('utf8').trim(),
        failed,
      })
    })
  })
}

function requestLlamaJson(path, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const request = http.get({
      agent: false,
      headers: { accept: 'application/json', connection: 'close' },
      host: LLAMA_HOST,
      path,
      port: LLAMA_PORT,
      timeout: timeoutMs,
    }, (response) => {
      const chunks = []
      let total = 0
      response.on('data', (chunk) => {
        total += chunk.length
        if (total > MAX_COMMAND_BYTES) response.destroy(new Error('llama_response_size'))
        else chunks.push(chunk)
      })
      response.on('end', () => {
        if (response.statusCode !== 200) return reject(new Error('llama_status'))
        try {
          resolvePromise(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        } catch {
          reject(new Error('llama_json'))
        }
      })
      response.on('error', reject)
    })
    request.on('timeout', () => request.destroy(new Error('llama_timeout')))
    request.on('error', reject)
  })
}

export async function probeModelState(dependencies = {}) {
  const execute = dependencies.runCommand ?? runCommand
  const getJson = dependencies.getJson ?? requestLlamaJson
  const resolvePath = dependencies.realpath ?? realpathSync
  const readText = dependencies.readText ?? ((path) => readFileSync(path, 'utf8'))
  try {
    const service = await execute('/usr/bin/systemctl', [
      'show', LLAMA_UNIT, '--property=ActiveState', '--property=MainPID',
    ], 3_000)
    const activeState = /^ActiveState=(.+)$/m.exec(service.stdout)?.[1]
    const pid = /^MainPID=(.+)$/m.exec(service.stdout)?.[1]
    if (
      service.code !== 0
      || service.signal !== null
      || service.failed
      || activeState !== 'active'
      || !/^[1-9]\d*$/.test(pid ?? '')
    ) return { ok: false }
    const [health, models, web, listeners] = await Promise.all([
      getJson('/health', 3_000),
      getJson('/v1/models', 5_000),
      execute('/usr/bin/systemctl', ['is-active', WEB_UNIT], 3_000),
      execute('/usr/bin/ss', ['-ltnpH'], 3_000),
    ])
    if (!health || typeof health !== 'object' || health.status !== 'ok') return { ok: false }
    if (!Array.isArray(models?.data) || models.data.length !== 1) return { ok: false }
    const alias = models.data[0]?.id
    const profile = PROFILE_BY_ALIAS[alias]
    if (!profile) return { ok: false }
    if (
      web.failed
      || web.signal !== null
      || !['fast:active', 'powerful:inactive'].includes(`${profile}:${web.stdout}`)
      || listeners.failed
      || listeners.code !== 0
      || listeners.signal !== null
    ) return { ok: false }
    const loopback = listeners.stdout.split('\n').filter((line) => line.includes('127.0.0.1:24080'))
    if (
      loopback.length !== 1
      || !loopback[0].includes(`pid=${pid},`)
      || listeners.stdout.split('\n').some((line) => /(?:0[.]0[.]0[.]0|\[::\]):24080\b/.test(line))
      || resolvePath(`/proc/${pid}/exe`) !== LLAMA_BIN
    ) return { ok: false }
    const expectedModel = profile === 'powerful'
      ? POWERFUL_FIRST
      : (dependencies.fastModelPath ?? await discoverFastModelPath(execute))
    if (!expectedModel) return { ok: false }
    const maps = readText(`/proc/${pid}/maps`)
    if (!maps.split('\n').some((line) => line.endsWith(` ${expectedModel}`))) return { ok: false }
    return { ok: true, profile, alias }
  } catch {
    return { ok: false }
  }
}

function regularFile(path, expected = {}) {
  try {
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) return false
    if (expected.uid !== undefined && info.uid !== expected.uid) return false
    if (expected.gid !== undefined && info.gid !== expected.gid) return false
    if (expected.mode !== undefined && (info.mode & 0o777) !== expected.mode) return false
    if (expected.size !== undefined && info.size !== expected.size) return false
    return true
  } catch {
    return false
  }
}

function directoryEntryExists(path) {
  try {
    lstatSync(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function assertPublicationLock(path) {
  const info = lstatSync(path)
  if (
    !info.isFile()
    || info.isSymbolicLink()
    || info.nlink !== 1
    || info.uid !== 0
    || info.gid !== 0
    || (info.mode & 0o777) !== 0o600
    || realpathSync(path) !== path
  ) throw new Error('publication_lock_invalid')
}

export function createPublicationBarrier(path = PUBLICATION_LOCK) {
  return {
    async acquire() {
      let fd
      try {
        assertPublicationLock(path)
        fd = openSync(path,
          fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | (fsConstants.O_CLOEXEC ?? 0))
        const descriptor = fstatSync(fd)
        const current = lstatSync(path)
        if (
          !descriptor.isFile()
          || descriptor.nlink !== 1
          || descriptor.uid !== 0
          || descriptor.gid !== 0
          || (descriptor.mode & 0o777) !== 0o600
          || descriptor.dev !== current.dev
          || descriptor.ino !== current.ino
        ) throw new Error('publication_lock_changed')
      } catch {
        if (fd !== undefined) closeSync(fd)
        return null
      }
      let child
      try {
        child = spawn('/usr/bin/flock', [
          '--exclusive',
          '--nonblock',
          '--conflict-exit-code', '75',
          '3',
        ], {
          cwd: '/',
          env: SAFE_ENV,
          shell: false,
          stdio: ['ignore', 'ignore', 'ignore', fd],
          windowsHide: true,
        })
      } catch {
        closeSync(fd)
        return null
      }
      const acquired = await new Promise((resolvePromise) => {
        child.once('error', () => resolvePromise(false))
        child.once('close', (code, signal) => resolvePromise(code === 0 && signal === null))
      })
      if (!acquired) {
        closeSync(fd)
        return null
      }
      try {
        assertPublicationLock(path)
        const descriptor = fstatSync(fd)
        const current = lstatSync(path)
        if (descriptor.dev !== current.dev || descriptor.ino !== current.ino) throw new Error('publication_lock_changed')
      } catch {
        closeSync(fd)
        return null
      }
      let released = false
      return {
        async release() {
          if (released) return
          released = true
          closeSync(fd)
        },
      }
    },
  }
}

function deploymentEntryExists() {
  try {
    return !regularFile(RUNTIME_READY_STAMP, { uid: 0, mode: 0o444, size: 9 })
      || readFileSync(RUNTIME_READY_STAMP, 'utf8') !== 'schema=1\n'
      || directoryEntryExists(DEPLOYMENT_PENDING)
      || DEPLOYMENT_JOURNALS.some((path) => directoryEntryExists(path))
  } catch {
    // O eroare de lstat/read (inclusiv o montare sandboxată inaccesibilă) nu
    // poate fi interpretată drept absența unei tranzacții autoritative.
    return true
  }
}

function validReactivationJournal() {
  const expected = '{"schema":1,"kind":"constructor-reactivation","phase":"pending"}\n'
  return regularFile(REACTIVATION_JOURNAL, {
    uid: 0,
    gid: 0,
    mode: 0o600,
    size: Buffer.byteLength(expected),
  }) && readFileSync(REACTIVATION_JOURNAL, 'utf8') === expected
}

function startupDeploymentEntryExists() {
  try {
    if (
      !regularFile(RUNTIME_READY_STAMP, { uid: 0, gid: 0, mode: 0o444, size: 9 })
      || readFileSync(RUNTIME_READY_STAMP, 'utf8') !== 'schema=1\n'
      || directoryEntryExists(DEPLOYMENT_PENDING)
    ) return true
    for (const path of DEPLOYMENT_JOURNALS) {
      if (!directoryEntryExists(path)) continue
      if (path !== REACTIVATION_JOURNAL || !validReactivationJournal()) return true
    }
    return false
  } catch {
    return true
  }
}

function readExactLines(path) {
  const lines = readFileSync(path, 'utf8').split('\n')
  if (lines.pop() !== '' || lines.some((line) => line.includes('\r') || line.includes('\0'))) {
    throw new Error('file_lines_invalid')
  }
  return lines
}

function readPowerfulCompletion() {
  if (!regularFile(POWERFUL_COMPLETE_RECEIPT, { uid: 0, mode: 0o600 })) return null
  let lines
  try {
    lines = readExactLines(POWERFUL_COMPLETE_RECEIPT)
  } catch {
    return null
  }
  if (
    lines.length !== 20
    || lines[0] !== 'schema=2'
    || lines[1] !== 'default_model=llama.cpp/qwen3.6-35b-a3b-local'
    || lines[2] !== 'powerful_model=llama.cpp/qwen3.5-122b-a10b-local'
    || lines[3] !== 'active_profile=fast'
    || lines[4] !== 'model_repo=unsloth/Qwen3.5-122B-A10B-GGUF'
    || lines[5] !== 'model_revision=a97b483a9f8cad9788776aa0112a2c63bf349e9e'
    || lines[6] !== 'model_quant=Q4_K_M'
    || lines[7] !== 'model_total_bytes=76536964608'
    || lines[8] !== 'shard_1_sha256=467c9bd92ea518539cf75bf5a5fbfbd35e9a0b40d766ccaa67bf120e12041df3'
    || lines[9] !== 'shard_2_sha256=90db14846413aebdac365b57206441437cac5f7e5037d94b325f0167f902e6e7'
    || lines[10] !== 'shard_3_sha256=e3c24b8ebec070bb4f69ea0aca25a16531da7440cd515529953e046882901f97'
    || lines[11] !== 'fast_model_bytes=20419565568'
    || lines[12] !== 'fast_model_sha256=671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7'
    || !/^installer_sha256=[0-9a-f]{64}$/.test(lines[14])
    || !/^worker_source_sha256=[0-9a-f]{64}$/.test(lines[15])
    || !/^config_source_sha256=[0-9a-f]{64}$/.test(lines[16])
    || !/^worker_unit_source_sha256=[0-9a-f]{64}$/.test(lines[17])
    || !/^switch_source_sha256=[0-9a-f]{64}$/.test(lines[18])
    || !/^verified_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(lines[19])
  ) return null
  const fastPath = lines[13]?.startsWith('fast_model_path=') ? lines[13].slice('fast_model_path='.length) : ''
  if (!fastPath.startsWith('/srv/private-ai/models/') || fastPath.includes('\n') || fastPath.includes('\r')) return null
  try {
    if (realpathSync(fastPath) !== fastPath) return null
  } catch {
    return null
  }
  return { fastPath }
}

function fastArtifactsInstalled(fastPath) {
  if (
    !fastPath
    || !regularFile(FAST_RECEIPT, { uid: 0, mode: 0o600 })
    || !regularFile(FAST_READY, { mode: 0o600 })
  ) return false
  let lines
  try {
    lines = readExactLines(FAST_RECEIPT)
  } catch {
    return false
  }
  if (!(lines.length === 6
    && lines[0] === 'installer_id=private-ai-contabo-v1'
    && /^completed_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(lines[1])
    && lines[2] === 'llama_cpp_ref=c1d0e7a004015f23bc0233470b747b596f29b264'
    && lines[3] === 'opencode_version=1.18.25'
    && lines[4] === 'model_repo=ggml-org/Qwen3.6-35B-A3B-GGUF'
    && lines[5] === 'model_quant=Q4_K_M')) return false
  let ready
  let model
  try {
    ready = lstatSync(FAST_READY)
    model = lstatSync(fastPath)
  } catch {
    return false
  }
  return ready.uid === 10050
    && ready.gid === 10050
    && model.uid === 10050
    && model.gid === 10050
    && model.isFile()
    && !model.isSymbolicLink()
    && model.nlink === 1
    && model.size === 20_419_565_568
}

const fastDigestCache = new Map()

function fileFingerprint(info) {
  return [info.dev, info.ino, info.ctimeMs, info.size, info.uid, info.gid, info.mode & 0o777, info.nlink].join(':')
}

async function verifyFastDigest(path, execute) {
  let before
  try { before = lstatSync(path) } catch { return false }
  const fingerprint = fileFingerprint(before)
  if (fastDigestCache.get(path) === fingerprint) return true
  const result = await execute('/usr/bin/sha256sum', ['--', path], 1_800_000)
  if (!commandPassed(result)) return false
  const match = /^([0-9a-f]{64})  (.+)$/.exec(result.stdout)
  if (!match || match[1] !== FAST_MODEL_SHA256 || match[2] !== path) return false
  let after
  try { after = lstatSync(path) } catch { return false }
  if (fileFingerprint(after) !== fingerprint) return false
  fastDigestCache.set(path, fingerprint)
  return true
}

async function discoverFastModelPath(execute) {
  const result = await execute('/usr/bin/find', [
    '/srv/private-ai/models', '-xdev', '-type', 'f', '-size', '20419565568c', '-print0',
  ], 30_000)
  if (!commandPassed(result)) return null
  const paths = result.stdout.split('\0').filter(Boolean)
  if (paths.length !== 1 || /[\r\n]/.test(paths[0]) || !paths[0].startsWith('/srv/private-ai/models/')) return null
  try {
    return realpathSync(paths[0]) === paths[0] ? paths[0] : null
  } catch {
    return null
  }
}

function powerfulArtifactsInstalled(completion) {
  if (!completion) return false
  if (!regularFile(POWERFUL_RECEIPT, { uid: 0, mode: 0o600 })) return false
  let receipt
  try {
    receipt = readExactLines(POWERFUL_RECEIPT)
  } catch {
    return false
  }
  const expected = [
    'schema=1',
    'model_repo=unsloth/Qwen3.5-122B-A10B-GGUF',
    'model_revision=a97b483a9f8cad9788776aa0112a2c63bf349e9e',
    'model_quant=Q4_K_M',
    'model_total_bytes=76536964608',
    'shard_1_sha256=467c9bd92ea518539cf75bf5a5fbfbd35e9a0b40d766ccaa67bf120e12041df3',
    'shard_2_sha256=90db14846413aebdac365b57206441437cac5f7e5037d94b325f0167f902e6e7',
    'shard_3_sha256=e3c24b8ebec070bb4f69ea0aca25a16531da7440cd515529953e046882901f97',
  ]
  if (
    receipt.length !== expected.length + 1
    || expected.some((line, index) => receipt[index] !== line)
    || !/^sealed_at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(receipt.at(-1) ?? '')
  ) return false
  return POWERFUL_SHARDS.every(({ name, bytes }) => regularFile(`${POWERFUL_ROOT}/${name}`, {
    uid: 0,
    mode: 0o440,
    size: bytes,
  }))
}

export async function detectInstalledProfiles(dependencies = {}) {
  const completion = dependencies.completion === undefined ? readPowerfulCompletion() : dependencies.completion
  const installed = []
  const execute = dependencies.runCommand ?? runCommand
  const fastPath = dependencies.fastModelPath ?? completion?.fastPath ?? await discoverFastModelPath(execute)
  const fastMetadataValid = dependencies.fastArtifactsInstalled ?? fastArtifactsInstalled
  const fastDigestValid = dependencies.verifyFastDigest ?? ((path) => verifyFastDigest(path, execute))
  const powerfulValid = dependencies.powerfulArtifactsInstalled ?? powerfulArtifactsInstalled
  if (
    fastMetadataValid(fastPath)
    && (dependencies.verifyFastSha === false || await fastDigestValid(fastPath))
  ) installed.push('fast')
  if (powerfulValid(completion)) installed.push('powerful')
  return installed
}

function commandPassed(result) {
  return result?.code === 0 && result.signal === null && result.failed === false
}

export function createWorkerCoordinator(execute = runCommand) {
  const query = async (property, unit) => {
    const result = await execute('/usr/bin/systemctl', ['show', unit, `--property=${property}`, '--value'])
    if (!commandPassed(result)) throw new Error('systemd_query')
    return result.stdout
  }
  const mutate = async (...args) => {
    const result = await execute('/usr/bin/systemctl', args)
    if (!commandPassed(result)) throw new Error('systemd_mutation')
  }
  const capture = async () => {
    const snapshot = {
      enabled: await query('UnitFileState', WORKER_TIMER),
      active: await query('ActiveState', WORKER_TIMER),
    }
    if (!['enabled', 'disabled'].includes(snapshot.enabled) || !['active', 'inactive'].includes(snapshot.active)) {
      throw new Error('timer_state_unavailable')
    }
    return snapshot
  }
  const quiesce = async (snapshot) => {
    try {
      if (!validTimerSnapshot(snapshot)) return { ok: false, error: 'timer_state_unavailable', snapshot }
      await mutate('stop', WORKER_TIMER)
      if (await query('ActiveState', WORKER_TIMER) !== 'inactive') throw new Error('timer_stop')
      const jobs = await execute('/usr/bin/systemctl', ['list-jobs', WORKER_UNIT, '--no-legend', '--plain'], 3_000)
      if (!commandPassed(jobs)) throw new Error('systemd_query')
      const workerState = await query('ActiveState', WORKER_UNIT)
      if (jobs.stdout !== '' || !['inactive', 'failed'].includes(workerState)) {
        const restored = await restore(snapshot)
        return { ok: false, error: restored ? 'worker_active' : 'timer_restore_failed', snapshot }
      }
      return { ok: true, snapshot }
    } catch {
      if (!await restore(snapshot)) return { ok: false, error: 'timer_restore_failed', snapshot }
      return { ok: false, error: 'timer_state_unavailable', snapshot }
    }
  }
  const restore = async (snapshot) => {
    try {
      const currentEnabled = await query('UnitFileState', WORKER_TIMER)
      if (currentEnabled !== snapshot.enabled) {
        if (snapshot.enabled === 'enabled') await mutate('enable', WORKER_TIMER)
        else if (snapshot.enabled === 'disabled') await mutate('disable', WORKER_TIMER)
        else throw new Error('timer_enabled_state')
      }
      if (snapshot.active === 'active') await mutate('start', WORKER_TIMER)
      else if (snapshot.active === 'inactive') await mutate('stop', WORKER_TIMER)
      else throw new Error('timer_active_state')
      const [enabled, active] = await Promise.all([
        query('UnitFileState', WORKER_TIMER),
        query('ActiveState', WORKER_TIMER),
      ])
      return enabled === snapshot.enabled && active === snapshot.active
    } catch {
      return false
    }
  }
  return {
    capture,
    quiesce,
    async prepare() {
      let snapshot = null
      try {
        snapshot = await capture()
        return quiesce(snapshot)
      } catch {
        if (snapshot && !await restore(snapshot)) return { ok: false, error: 'timer_restore_failed', snapshot }
        return { ok: false, error: 'timer_state_unavailable', snapshot }
      }
    },
    restore,
  }
}

function assertCanonicalDirectory(path, expectedUid) {
  const info = lstatSync(path)
  if (
    !info.isDirectory()
    || info.isSymbolicLink()
    || info.uid !== expectedUid
    || (info.mode & 0o022) !== 0
    || realpathSync(path) !== path
  ) throw new Error('switch_helper_parent_invalid')
}

function assertCanonicalRootDirectory(path) {
  assertCanonicalDirectory(path, 0)
}

function assertSwitchHelper() {
  for (const path of ['/opt', '/opt/private-ai', '/opt/private-ai/bin']) assertCanonicalRootDirectory(path)
  const helper = lstatSync(SWITCH_HELPER)
  if (
    !helper.isFile()
    || helper.isSymbolicLink()
    || helper.nlink !== 1
    || helper.uid !== 0
    || helper.gid !== 0
    || (helper.mode & 0o122) !== 0o100
    || realpathSync(SWITCH_HELPER) !== SWITCH_HELPER
  ) throw new Error('switch_helper_invalid')
}

export function spawnModelSwitch(profile) {
  if (!['fast', 'powerful'].includes(profile)) throw new Error('profile_invalid')
  assertSwitchHelper()
  return spawn(SWITCH_HELPER, [profile], {
    cwd: '/',
    env: SAFE_ENV,
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  })
}

function validTimerSnapshot(value) {
  return value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'active,enabled'
    && ['enabled', 'disabled'].includes(value.enabled)
    && ['active', 'inactive'].includes(value.active)
}

function validBootId(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
}

export function readBootId(path = BOOT_ID_FILE) {
  const value = readFileSync(path, 'utf8').trim().toLowerCase()
  if (!validBootId(value)) throw new Error('boot_id_invalid')
  return value
}

function parseTransaction(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const legacy = value.schema === 1
    && Object.keys(value).sort().join(',') === 'createdAt,phase,profile,requestId,schema,timerSnapshot'
  const current = value.schema === 2
    && Object.keys(value).sort().join(',') === 'bootId,createdAt,intent,phase,profile,requestId,schema,timerSnapshot'
  if (!legacy && !current) return null
  if (
    !['requested', 'accepted', 'timer-snapshotted', 'switching'].includes(value.phase)
    || (legacy && value.phase === 'accepted')
    || !['fast', 'powerful'].includes(value.profile)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value.requestId)
    || typeof value.createdAt !== 'string'
    || !Number.isFinite(Date.parse(value.createdAt))
    || new Date(value.createdAt).toISOString() !== value.createdAt
    || (['requested', 'accepted'].includes(value.phase)
      ? value.timerSnapshot !== null
      : !validTimerSnapshot(value.timerSnapshot))
    || (current && (!validBootId(value.bootId) || !['switch', 'normalize-fast'].includes(value.intent)))
  ) return null
  return legacy ? { ...value, bootId: null, intent: 'normalize-fast' } : value
}

function syncDirectory(path) {
  const fd = openSync(path, 'r')
  try { fsyncSync(fd) } finally { closeSync(fd) }
}

export function createTransactionStore(path = TRANSACTION_FILE, expectedUid = 0) {
  const parent = resolve(path, '..')
  const assertParent = () => assertCanonicalDirectory(parent, expectedUid)
  return {
    read() {
      if (!existsSync(path)) return null
      assertParent()
      if (!regularFile(path, { uid: expectedUid, mode: 0o600 })) throw new Error('transaction_file_invalid')
      let decoded
      try { decoded = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('transaction_json_invalid') }
      const parsed = parseTransaction(decoded)
      if (!parsed) throw new Error('transaction_schema_invalid')
      return parsed
    },
    write(value) {
      const parsed = parseTransaction(value)
      if (!parsed || parsed.schema !== 2) throw new Error('transaction_schema_invalid')
      assertParent()
      const temporary = `${path}.${process.pid}.${parsed.requestId}.tmp`
      if (existsSync(temporary)) throw new Error('transaction_temporary_exists')
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, `${JSON.stringify(parsed)}\n`, 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      chmodSync(temporary, 0o600)
      renameSync(temporary, path)
      syncDirectory(parent)
    },
    clear() {
      if (!existsSync(path)) return
      assertParent()
      if (!regularFile(path, { uid: expectedUid, mode: 0o600 })) throw new Error('transaction_file_invalid')
      unlinkSync(path)
      syncDirectory(parent)
    },
  }
}

function parseHistory(value) {
  if (
    !value
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'outcomes,schema'
    || value.schema !== 1
    || !Array.isArray(value.outcomes)
    || value.outcomes.length > REQUEST_HISTORY_LIMIT
  ) return null
  for (const outcome of value.outcomes) {
    if (
      !outcome
      || typeof outcome !== 'object'
      || Array.isArray(outcome)
      || Object.keys(outcome).sort().join(',') !== 'bootId,completedAt,profile,requestId,status'
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(outcome.requestId)
      || !['fast', 'powerful'].includes(outcome.profile)
      || !['ready', 'failed'].includes(outcome.status)
      || !validBootId(outcome.bootId)
      || typeof outcome.completedAt !== 'string'
      || !Number.isFinite(Date.parse(outcome.completedAt))
      || new Date(outcome.completedAt).toISOString() !== outcome.completedAt
    ) return null
  }
  if (new Set(value.outcomes.map(({ requestId }) => requestId)).size !== value.outcomes.length) return null
  return value
}

export function createHistoryStore(path = HISTORY_FILE, expectedUid = 0) {
  const parent = resolve(path, '..')
  const assertParent = () => assertCanonicalDirectory(parent, expectedUid)
  return {
    read() {
      if (!existsSync(path)) return { schema: 1, outcomes: [] }
      assertParent()
      if (!regularFile(path, { uid: expectedUid, mode: 0o600 })) throw new Error('history_file_invalid')
      let decoded
      try { decoded = JSON.parse(readFileSync(path, 'utf8')) } catch { throw new Error('history_json_invalid') }
      const parsed = parseHistory(decoded)
      if (!parsed) throw new Error('history_schema_invalid')
      return parsed
    },
    write(value) {
      const parsed = parseHistory(value)
      if (!parsed) throw new Error('history_schema_invalid')
      assertParent()
      const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`
      const fd = openSync(temporary, 'wx', 0o600)
      try {
        writeFileSync(fd, `${JSON.stringify(parsed)}\n`, 'utf8')
        fsyncSync(fd)
      } finally {
        closeSync(fd)
      }
      chmodSync(temporary, 0o600)
      renameSync(temporary, path)
      syncDirectory(parent)
    },
  }
}

function statePayload(status, values = {}) {
  return {
    mode: 'manual',
    defaultProfile: DEFAULT_PROFILE,
    status,
    activeProfile: values.activeProfile ?? null,
    requestedProfile: values.requestedProfile ?? null,
    requestId: values.requestId ?? null,
    installedProfiles: values.installedProfiles ?? [],
  }
}

export function createModelControl(secret, dependencies = {}) {
  const verify = createServiceVerifier(secret)
  const probe = dependencies.probeState ?? (() => probeModelState({ runCommand: dependencies.runCommand }))
  const installedProfiles = dependencies.installedProfiles ?? (() => detectInstalledProfiles({
    runCommand: dependencies.runCommand,
    verifyFastSha: false,
  }))
  const verifiedProfiles = dependencies.verifiedProfiles ?? dependencies.installedProfiles ?? (() => detectInstalledProfiles({
    runCommand: dependencies.runCommand,
    verifyFastSha: true,
  }))
  const coordinator = dependencies.coordinator ?? createWorkerCoordinator(dependencies.runCommand ?? runCommand)
  const launch = dependencies.spawnSwitch ?? spawnModelSwitch
  const transactionStore = dependencies.transactionStore ?? createTransactionStore()
  const historyStore = dependencies.historyStore ?? createHistoryStore()
  const deploymentPending = dependencies.deploymentPending ?? deploymentEntryExists
  const publicationBarrier = dependencies.publicationBarrier ?? createPublicationBarrier()
  const currentBootId = (dependencies.bootId ?? readBootId()).toLowerCase()
  if (!validBootId(currentBootId)) throw new Error('boot_id_invalid')
  const history = new Map()
  const terminalHistory = new Map()
  for (const outcome of historyStore.read().outcomes) {
    history.set(outcome.requestId, outcome)
    terminalHistory.set(outcome.requestId, outcome)
  }
  let interrupted = transactionStore.read()
  const bootChanged = interrupted !== null && interrupted.bootId !== currentBootId
  if (interrupted) {
    const terminal = terminalHistory.get(interrupted.requestId)
    if (terminal && terminal.profile !== interrupted.profile) throw new Error('transaction_history_conflict')
    if (terminal?.profile === interrupted.profile && !bootChanged) {
      transactionStore.clear()
      interrupted = null
    } else if (bootChanged && !terminal) {
      // Cererea vechiului boot nu a ajuns la un rezultat terminal. Înainte să
      // înlocuim jurnalul cu normalizarea FAST îi publicăm tombstone-ul durabil,
      // astfel același requestId nu poate relansa ulterior POWERFUL.
      const abandoned = {
        requestId: interrupted.requestId,
        profile: interrupted.profile,
        status: 'failed',
        bootId: validBootId(interrupted.bootId) ? interrupted.bootId : currentBootId,
        completedAt: new Date().toISOString(),
      }
      history.delete(abandoned.requestId)
      history.set(abandoned.requestId, abandoned)
      terminalHistory.delete(abandoned.requestId)
      terminalHistory.set(abandoned.requestId, abandoned)
      while (terminalHistory.size > REQUEST_HISTORY_LIMIT) {
        const oldest = terminalHistory.keys().next().value
        terminalHistory.delete(oldest)
        history.delete(oldest)
      }
      historyStore.write({ schema: 1, outcomes: [...terminalHistory.values()] })
    }
  }
  const forceFast = dependencies.forceFastOnStartup === true || bootChanged
  let activeSwitch = interrupted || forceFast ? {
    requestId: forceFast ? randomUUID() : interrupted.requestId,
    profile: forceFast ? 'fast' : interrupted.profile,
    intent: forceFast ? 'normalize-fast' : interrupted.intent,
    phase: forceFast ? 'requested' : interrupted.phase,
    bootId: currentBootId,
    timerSnapshot: forceFast ? null : interrupted.timerSnapshot,
    child: null,
    finished: false,
    recovery: true,
    createdAt: forceFast ? new Date().toISOString() : interrupted.createdAt,
  } : null
  const latestTerminal = [...terminalHistory.values()].at(-1)
  let lastFailure = latestTerminal?.status === 'failed'
    ? { requestId: latestTerminal.requestId, profile: latestTerminal.profile }
    : null
  let recoveryBlocked = false
  let lastInstalledProfiles = []

  if (forceFast) {
    transactionStore.write({
      schema: 2,
      requestId: activeSwitch.requestId,
      profile: 'fast',
      intent: 'normalize-fast',
      phase: 'requested',
      bootId: currentBootId,
      timerSnapshot: null,
      createdAt: activeSwitch.createdAt,
    })
  }

  const remember = (requestId, value) => {
    history.delete(requestId)
    history.set(requestId, value)
    while (history.size > REQUEST_HISTORY_LIMIT) history.delete(history.keys().next().value)
  }

  const persistOutcome = (requestId, profile, status) => {
    const outcome = {
      requestId,
      profile,
      status,
      bootId: currentBootId,
      completedAt: new Date().toISOString(),
    }
    terminalHistory.delete(requestId)
    terminalHistory.set(requestId, outcome)
    while (terminalHistory.size > REQUEST_HISTORY_LIMIT) terminalHistory.delete(terminalHistory.keys().next().value)
    historyStore.write({ schema: 1, outcomes: [...terminalHistory.values()] })
    remember(requestId, outcome)
  }

  const snapshot = async () => {
    if (activeSwitch) {
      return statePayload('switching', {
        requestedProfile: activeSwitch.profile,
        requestId: activeSwitch.requestId,
        installedProfiles: lastInstalledProfiles,
      })
    }
    const installed = await installedProfiles().catch(() => [])
    lastInstalledProfiles = installed
    const observed = await probe().catch(() => ({ ok: false }))
    if (lastFailure) {
      return statePayload('failed', {
        activeProfile: observed.ok ? observed.profile : null,
        requestedProfile: lastFailure.profile,
        requestId: lastFailure.requestId,
        installedProfiles: installed,
      })
    }
    if (!observed.ok || !installed.includes(observed.profile)) return statePayload('unavailable', { installedProfiles: installed })
    return statePayload('ready', { activeProfile: observed.profile, installedProfiles: installed })
  }

  const finishSwitch = async (operation, helperPassed) => {
    if (operation.finished) return
    operation.finished = true
    try {
      let targetReady = false
      if (helperPassed) {
        const observed = await probe().catch(() => ({ ok: false }))
        targetReady = observed.ok && observed.profile === operation.profile
      }
      const timerRestored = await coordinator.restore(operation.timerSnapshot)
      const provisionalSuccess = helperPassed && targetReady && timerRestored
      let outcomeSaved = false
      try {
        persistOutcome(operation.requestId, operation.profile, provisionalSuccess ? 'ready' : 'failed')
        outcomeSaved = true
      } catch {
        recoveryBlocked = true
      }
      let journalCleared = false
      if (timerRestored && outcomeSaved) {
        try {
          transactionStore.clear()
          journalCleared = true
        } catch {
          recoveryBlocked = true
        }
      } else recoveryBlocked = true
      const succeeded = provisionalSuccess && outcomeSaved && journalCleared
      if (!outcomeSaved) remember(operation.requestId, { profile: operation.profile, status: 'failed' })
      lastFailure = succeeded ? null : { requestId: operation.requestId, profile: operation.profile }
      if (activeSwitch === operation) activeSwitch = null
    } finally {
      if (operation.recoveryLease) {
        const lease = operation.recoveryLease
        operation.recoveryLease = null
        await lease.release()
      }
    }
  }

  const failBeforeLaunch = async (operation, error, timerNeedsRecovery = false) => {
    let outcomeSaved = false
    try {
      persistOutcome(operation.requestId, operation.profile, 'failed')
      outcomeSaved = true
    } catch {
      recoveryBlocked = true
    }
    let cleared = false
    if (!timerNeedsRecovery && outcomeSaved) {
      try { transactionStore.clear(); cleared = true } catch { recoveryBlocked = true }
    } else recoveryBlocked = true
    if (!outcomeSaved) remember(operation.requestId, { profile: operation.profile, status: 'failed' })
    lastFailure = { requestId: operation.requestId, profile: operation.profile }
    if (activeSwitch === operation) activeSwitch = null
    return { error, cleared }
  }

  const executeSwitch = async (operation) => {
    const installed = await verifiedProfiles().catch(() => [])
    lastInstalledProfiles = installed
    if (
      !installed.includes(operation.profile)
      || (operation.profile === 'powerful' && !installed.includes('fast'))
    ) {
      await failBeforeLaunch(operation, 'profile_not_installed')
      return
    }
    let timerSnapshot
    try {
      timerSnapshot = await coordinator.capture()
      operation.timerSnapshot = timerSnapshot
      transactionStore.write({
        schema: 2,
        requestId: operation.requestId,
        profile: operation.profile,
        intent: operation.intent,
        phase: 'timer-snapshotted',
        bootId: currentBootId,
        timerSnapshot,
        createdAt: operation.createdAt,
      })
    } catch {
      await failBeforeLaunch(operation, 'timer_state_unavailable')
      return
    }
    const prepared = await coordinator.quiesce(timerSnapshot)
    if (!prepared.ok) {
      await failBeforeLaunch(operation, prepared.error, prepared.error === 'timer_restore_failed')
      return
    }
    try {
      transactionStore.write({
        schema: 2,
        requestId: operation.requestId,
        profile: operation.profile,
        intent: operation.intent,
        phase: 'switching',
        bootId: currentBootId,
        timerSnapshot,
        createdAt: operation.createdAt,
      })
    } catch {
      const restored = await coordinator.restore(timerSnapshot)
      await failBeforeLaunch(operation, restored ? 'switch_unavailable' : 'timer_restore_failed', !restored)
      return
    }
    let child
    try {
      child = launch(operation.profile)
      if (!child || typeof child.once !== 'function') throw new Error('switch_spawn')
    } catch {
      const restored = await coordinator.restore(timerSnapshot)
      await failBeforeLaunch(operation, restored ? 'switch_unavailable' : 'timer_restore_failed', !restored)
      return
    }
    operation.child = child
    child.once('error', () => { void finishSwitch(operation, false) })
    child.once('close', (code, signal) => { void finishSwitch(operation, code === 0 && signal === null) })
  }

  const requestSwitchWithLease = async (requestId, profile) => {
    if (deploymentPending()) return { statusCode: 503, body: { error: 'deployment_in_progress' } }
    const previous = history.get(requestId)
    if (previous) {
      if (previous.profile !== profile) return { statusCode: 409, body: { error: 'request_id_conflict' } }
      if (previous.status === 'failed') lastFailure = { requestId, profile }
      else if (previous.status === 'ready') lastFailure = null
      return { statusCode: 202, body: { accepted: true, requestId, profile } }
    }
    if (activeSwitch) return { statusCode: 409, body: { error: 'switch_in_progress' } }
    if (recoveryBlocked) return { statusCode: 503, body: { error: 'switch_recovery_required' } }
    const operation = {
      requestId,
      profile,
      timerSnapshot: null,
      child: null,
      finished: false,
      recovery: false,
      intent: 'switch',
      phase: 'requested',
      bootId: currentBootId,
      createdAt: new Date().toISOString(),
    }
    activeSwitch = operation
    try {
      transactionStore.write({
        schema: 2,
        requestId,
        profile,
        intent: 'switch',
        phase: 'requested',
        bootId: currentBootId,
        timerSnapshot: null,
        createdAt: operation.createdAt,
      })
    } catch {
      activeSwitch = null
      return { statusCode: 503, body: { error: 'switch_unavailable' } }
    }
    // Revalidăm după journalul local și imediat înainte de ACK. Dacă un deploy
    // și-a publicat între timp intentul persistent, comanda nu devine vizibilă.
    if (deploymentPending()) {
      activeSwitch = null
      try { transactionStore.clear() } catch { recoveryBlocked = true }
      return { statusCode: 503, body: { error: 'deployment_in_progress' } }
    }
    try {
      transactionStore.write({
        schema: 2,
        requestId,
        profile,
        intent: 'switch',
        phase: 'accepted',
        bootId: currentBootId,
        timerSnapshot: null,
        createdAt: operation.createdAt,
      })
    } catch {
      activeSwitch = null
      try { transactionStore.clear() } catch { recoveryBlocked = true }
      return { statusCode: 503, body: { error: 'switch_unavailable' } }
    }
    remember(requestId, { profile, status: 'switching' })
    setImmediate(() => { void executeSwitch(operation) })
    return { statusCode: 202, body: { accepted: true, requestId, profile } }
  }

  const acquirePublicationLease = async () => {
    try { return await publicationBarrier.acquire() } catch { return null }
  }

  // API-ul direct folosește 202 ca punct de commit logic. Calea HTTP de mai
  // jos ține aceeași lease până la `finish`, astfel deploy-ul nu poate publica
  // intentul și opri procesul între accepted-write și predarea răspunsului.
  const requestSwitch = async (requestId, profile) => {
    const lease = await acquirePublicationLease()
    if (!lease || typeof lease.release !== 'function') {
      return { statusCode: 503, body: { error: 'deployment_in_progress' } }
    }
    try {
      return await requestSwitchWithLease(requestId, profile)
    } finally {
      await lease.release()
    }
  }

  const recoverInterruptedSwitchWithLease = async (operation) => {
    if (operation.intent === 'normalize-fast' || operation.phase === 'accepted') {
      operation.recovery = false
      await executeSwitch(operation)
      return true
    }
    if (operation.phase === 'requested') {
      await failBeforeLaunch(operation, 'switch_unconfirmed')
      return !recoveryBlocked
    }
    if (!operation.timerSnapshot) {
      await failBeforeLaunch(operation, 'switch_recovery_required')
      return !recoveryBlocked
    }
    const prepared = await coordinator.quiesce(operation.timerSnapshot)
    if (!prepared.ok) {
      await failBeforeLaunch(operation, prepared.error, prepared.error === 'timer_restore_failed')
      return false
    }
    let observed = await probe().catch(() => ({ ok: false }))
    if (!observed.ok || (operation.profile === 'fast' && observed.profile !== 'fast')) {
      let child
      try { child = launch('fast') } catch { child = null }
      if (child && typeof child.once === 'function') {
        const passed = await new Promise((resolvePromise) => {
          let settled = false
          const finish = (value) => { if (!settled) { settled = true; resolvePromise(value) } }
          child.once('error', () => finish(false))
          child.once('close', (code, signal) => finish(code === 0 && signal === null))
        })
        if (passed) observed = await probe().catch(() => ({ ok: false }))
      }
    }
    const restored = await coordinator.restore(operation.timerSnapshot)
    if (!restored || !observed.ok) {
      await failBeforeLaunch(operation, 'switch_recovery_required', !restored)
      return false
    }
    const targetReady = observed.profile === operation.profile
    let outcomeSaved = false
    try {
      persistOutcome(operation.requestId, operation.profile, targetReady ? 'ready' : 'failed')
      outcomeSaved = true
    } catch {
      recoveryBlocked = true
    }
    if (outcomeSaved) {
      try { transactionStore.clear() } catch { recoveryBlocked = true }
    }
    const succeeded = targetReady && outcomeSaved && !recoveryBlocked
    if (!outcomeSaved) remember(operation.requestId, { profile: operation.profile, status: 'failed' })
    lastFailure = succeeded ? null : { requestId: operation.requestId, profile: operation.profile }
    activeSwitch = null
    return !recoveryBlocked
  }

  const recoverInterruptedSwitch = async () => {
    const operation = activeSwitch
    if (!operation?.recovery) return true
    // La boot controllerul poate porni intenționat sub markerul exact de
    // reactivare, ca helperul să-i poată proba socketul. Jurnalul de switch
    // rămâne însă inert până când toate tranzacțiile de deploy au dispărut.
    if (deploymentPending()) return false
    const lease = await acquirePublicationLease()
    if (!lease || typeof lease.release !== 'function') return false
    let transferred = false
    try {
      // Închide TOCTOU-ul dintre primul check și dobândirea lock-ului comun.
      if (deploymentPending() || activeSwitch !== operation || !operation.recovery) return false
      const recovered = await recoverInterruptedSwitchWithLease(operation)
      if (operation.child && activeSwitch === operation) {
        operation.recoveryLease = lease
        transferred = true
      }
      return recovered
    } finally {
      if (!transferred) await lease.release()
    }
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/v1/model/state', '/v1/model/switch'].includes(req.url)) {
      return json(res, 404, { error: 'not_found' })
    }
    try {
      if (
        req.headers['transfer-encoding'] !== undefined
        || String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json'
      ) {
        return json(res, 415, { error: 'content_type' })
      }
      const raw = await collectBody(req)
      verify({
        timestamp: req.headers['x-kelion-timestamp'],
        nonce: req.headers['x-kelion-nonce'],
        signature: req.headers['x-kelion-signature'],
        method: req.method,
        path: req.url,
        body: raw,
      })
      if (deploymentPending()) return json(res, 503, { error: 'deployment_in_progress' })
      if (req.url === '/v1/model/state') {
        const input = exactObject(raw, [])
        exactRawJson(raw, input)
        return json(res, 200, await snapshot())
      }
      const input = exactObject(raw, ['requestId', 'profile'])
      exactRawJson(raw, { requestId: input.requestId, profile: input.profile })
      const requestId = requireRequestId(input.requestId).toLowerCase()
      if (!['fast', 'powerful'].includes(input.profile)) throw new Error('profile_invalid')
      const lease = await acquirePublicationLease()
      if (!lease || typeof lease.release !== 'function') {
        return json(res, 503, { error: 'deployment_in_progress' })
      }
      let handedToResponse = false
      let released = false
      const releaseOnce = () => {
        if (released) return
        released = true
        void lease.release()
      }
      try {
        const result = await requestSwitchWithLease(requestId, input.profile)
        res.once('finish', releaseOnce)
        res.once('close', releaseOnce)
        handedToResponse = true
        return json(res, result.statusCode, result.body)
      } finally {
        if (!handedToResponse) await lease.release()
      }
    } catch (error) {
      const message = String(error?.message ?? '')
      if (message.startsWith('service_auth')) return json(res, 401, { error: 'unauthorized' })
      if (message === 'body_size') return json(res, 413, { error: 'body_rejected' })
      return json(res, 422, { error: 'request_rejected' })
    }
  })

  server.maxConnections = 16
  server.headersTimeout = 5_000
  server.requestTimeout = 10_000
  server.keepAliveTimeout = 1_000
  server.maxRequestsPerSocket = 8
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })

  return { server, snapshot, requestSwitch, recoverInterruptedSwitch }
}

function assertCanonicalRuntime() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('root_required')
  assertSwitchHelper()
  assertCanonicalRootDirectory('/etc/private-ai')
  const runtime = resolve(CONTROL_SOCKET, '..')
  const info = lstatSync(runtime)
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== 0 || info.gid !== 10050 || (info.mode & 0o777) !== 0o750) {
    throw new Error('runtime_directory_invalid')
  }
}

function removeCanonicalSocket() {
  if (!existsSync(CONTROL_SOCKET)) return
  const entry = lstatSync(CONTROL_SOCKET)
  if (!entry.isSocket() || entry.isSymbolicLink()) throw new Error('control_socket_invalid')
  unlinkSync(CONTROL_SOCKET)
}

async function main() {
  if (process.argv[2] === '--self-test') {
    if (
      CONTROL_SOCKET !== '/run/kelion-constructor-model-control/control.sock'
      || SWITCH_HELPER !== '/opt/private-ai/bin/constructor-model-switch'
      || PUBLICATION_LOCK !== '/run/kelion-constructor-model-control/publicare.lock'
      || DEFAULT_PROFILE !== 'fast'
      || PROFILE_BY_ALIAS[POWERFUL_ALIAS] !== 'powerful'
      || RUNTIME_READY_STAMP !== '/run/kelion/runtime-config-recovery.ready'
      || REACTIVATION_JOURNAL !== '/run/kelion-constructor-model-control/deploy-journals/constructor-reactivation.journal'
      || DEPLOYMENT_JOURNALS.length !== 9
      || new Set(DEPLOYMENT_JOURNALS).size !== DEPLOYMENT_JOURNALS.length
    ) throw new Error('self_test_contract')
    process.stdout.write('constructor-model-control self-test: TRECE\n')
    return
  }
  if (process.argv.length !== 2) throw new Error('mode_invalid')
  if (startupDeploymentEntryExists()) throw new Error('deployment_in_progress')
  assertCanonicalRuntime()
  const control = createModelControl(readServiceSecret(CONTROL_SECRET), {
    forceFastOnStartup: directoryEntryExists(LEGACY_DROPIN),
  })
  const { server } = control
  removeCanonicalSocket()
  let recoveryTimer = null
  let closing = false
  const recoverWhenUnblocked = async () => {
    if (closing) return
    const settled = await control.recoverInterruptedSwitch().catch(() => false)
    if (!settled && !closing) {
      recoveryTimer = setTimeout(() => { void recoverWhenUnblocked() }, 1_000)
      recoveryTimer.unref()
    }
  }
  server.listen(CONTROL_SOCKET, () => {
    chmodSync(CONTROL_SOCKET, 0o660)
    setImmediate(() => { void recoverWhenUnblocked() })
  })
  const close = () => {
    closing = true
    if (recoveryTimer) clearTimeout(recoveryTimer)
    server.close()
  }
  process.on('SIGINT', close)
  process.on('SIGTERM', close)
  process.on('exit', () => {
    try { removeCanonicalSocket() } catch { /* directorul runtime este curățat de systemd */ }
  })
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  main().catch(() => {
    process.stderr.write('constructor-model-control: startup_or_runtime_failure\n')
    process.exitCode = 1
  })
}
