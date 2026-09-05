#!/usr/bin/env node

import http from 'node:http'
import https from 'node:https'
import { spawn } from 'node:child_process'
import {
  closeSync, chmodSync, constants as fsConstants, existsSync, fstatSync,
  openSync, lstatSync, readFileSync, realpathSync, unlinkSync, mkdirSync, mkdtempSync, rmSync,
} from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { createServiceVerifier, readServiceSecret, requireRequestId } from './lib/service-auth.mjs'

export const CONTROL_SOCKET = '/run/kelion-constructor-model-control/control.sock'
export const CONTROL_SECRET = '/run/credentials/kelion-constructor-model-control.service/constructor-model-control-secret'
// The historical wire ID remains stable; it no longer selects a local model.
export const DEFAULT_PROFILE = 'fast'
export const PUBLICATION_LOCK = '/run/kelion-constructor-model-control/publicare.lock'
export const OPENCODE_CONFIG = '/srv/private-ai/home/.config/opencode/opencode.json'
export const OPENCODE_BIN = '/opt/private-ai/bin/opencode'
const OPENCODE_VERSION = '1.18.25'
const OPENCODE_SHA256 = 'd91e0d33676d0839f7cde87924cd4127ea88c9d6784eea9f009a7d08bdc60eeb'
const APPROVED_ENDPOINT = 'https://opencode.ai/inference/openai/v1'
const CATALOG_URL = new URL('https://opencode.ai/zen/v1/models')
const MAX_BODY_BYTES = 1024
const MAX_COMMAND_BYTES = 64 * 1024
const MAX_CATALOG_BYTES = 512 * 1024
const CATALOG_TIMEOUT_MS = 5_000
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
    let timer
    let settled = false
    let versionHome = null
    let versionHomeIdentity = null
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (versionHome !== null) {
        try {
          const current = lstatSync(versionHome)
          if (!versionHomeIdentity || !current.isDirectory() || current.isSymbolicLink()
            || current.dev !== versionHomeIdentity.dev || current.ino !== versionHomeIdentity.ino
            || current.uid !== versionHomeIdentity.uid || (current.mode & 0o777) !== 0o700
            || realpathSync(versionHome) !== versionHome) throw new Error('version_home_changed')
          // Only the exact mkdtemp-created directory is removed, never HOME,
          // /tmp, a caller-supplied path, or a replaced/symlinked target.
          rmSync(versionHome, { recursive: true, force: false })
        } catch { result = { ...result, failed: true } }
      }
      resolvePromise(result)
    }
    try {
      let env = SAFE_ENV
      if (command === OPENCODE_BIN && args.length === 1 && args[0] === '--version') {
        // OpenCode/Bun initializes XDG directories even for --version. The
        // controller keeps ProtectHome/ProtectSystem; its private /tmp hosts
        // one empty, owner-only home per version probe, with no credentials.
        versionHome = mkdtempSync(join(realpathSync(tmpdir()), 'kelion-constructor-version-'))
        versionHomeIdentity = lstatSync(versionHome)
        if (!versionHomeIdentity.isDirectory() || versionHomeIdentity.isSymbolicLink()
          || (versionHomeIdentity.mode & 0o777) !== 0o700
          || (process.getuid && versionHomeIdentity.uid !== process.getuid())
          || realpathSync(versionHome) !== versionHome) throw new Error('version_home_invalid')
        const xdg = { XDG_CACHE_HOME: 'cache', XDG_CONFIG_HOME: 'config', XDG_DATA_HOME: 'data', XDG_STATE_HOME: 'state', XDG_RUNTIME_DIR: 'runtime' }
        env = { ...SAFE_ENV, HOME: versionHome }
        for (const [key, directory] of Object.entries(xdg)) {
          env[key] = join(versionHome, directory)
          mkdirSync(env[key], { mode: 0o700 })
        }
      }
      child = spawn(command, args, {
        env,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
    } catch {
      finish({ code: null, signal: null, stdout: '', failed: true })
      return
    }
    const chunks = []
    let bytes = 0
    let failed = false
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
    timer = setTimeout(() => {
      failed = true
      child.kill('SIGKILL')
    }, timeoutMs)
    timer.unref()
    child.once('error', () => {
      finish({ code: null, signal: null, stdout: '', failed: true })
    })
    child.once('close', (code, signal) => {
      finish({
        code,
        signal,
        stdout: Buffer.concat(chunks).toString('utf8').trim(),
        failed,
      })
    })
  })
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


function record(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

/** The deployed, root-owned configuration supplies the public model identity.
 * The allowlist only enforces the exact anonymous provider approved by owner. */
export function validateProviderConfig(config) {
  if (
    !record(config)
    || config.autoupdate !== false
    || config.share !== 'disabled'
    || config.model !== 'opencode-free/big-pickle'
    || config.small_model !== config.model
    || !Array.isArray(config.enabled_providers)
    || config.enabled_providers.length !== 1
    || config.enabled_providers[0] !== 'opencode-free'
    || !record(config.provider)
    || Object.keys(config.provider).join(',') !== 'opencode-free'
  ) throw new Error('provider_config_invalid')
  const providerId = config.model.split('/')[0]
  const modelId = config.model.slice(providerId.length + 1)
  const provider = config.provider[providerId]
  const options = provider?.options
  if (
    !record(provider)
    || provider.npm !== '@ai-sdk/openai-compatible'
    || !record(options)
    || options.baseURL !== APPROVED_ENDPOINT
    || Object.keys(options).some((key) => !['baseURL', 'timeout', 'chunkTimeout'].includes(key))
    || !record(provider.models)
    || Object.keys(provider.models).join(',') !== modelId
  ) throw new Error('provider_config_invalid')
  const descriptor = provider.models[modelId]
  if (
    !record(descriptor)
    || typeof descriptor.name !== 'string'
    || descriptor.name.length < 1
    || descriptor.name.length > 80
    || descriptor.name.trim() !== descriptor.name
    || /[\u0000-\u001f\u007f]/u.test(descriptor.name)
  ) throw new Error('provider_model_invalid')
  return { id: config.model, label: descriptor.name, provider: providerId }
}

function readCanonicalConfig() {
  const parent = resolve(OPENCODE_CONFIG, '..')
  const parentInfo = lstatSync(parent)
  if (
    !parentInfo.isDirectory()
    || parentInfo.isSymbolicLink()
    || parentInfo.uid !== 0
    || (parentInfo.mode & 0o777) !== 0o750
    || realpathSync(parent) !== parent
  ) throw new Error('provider_config_parent_invalid')
  const fd = openSync(OPENCODE_CONFIG, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
  try {
    const info = fstatSync(fd)
    if (
      !info.isFile() || info.nlink !== 1 || info.uid !== 0
      || (info.mode & 0o777) !== 0o640 || info.size < 2 || info.size > MAX_COMMAND_BYTES
    ) throw new Error('provider_config_metadata_invalid')
    return JSON.parse(readFileSync(fd, 'utf8'))
  } finally {
    closeSync(fd)
  }
}

let verifiedBinaryFingerprint = null
async function verifyOpenCodeBinary(execute) {
  let info
  try {
    info = lstatSync(OPENCODE_BIN)
    if (
      !info.isFile() || info.isSymbolicLink() || info.nlink !== 1
      || info.uid !== 0 || (info.mode & 0o777) !== 0o755
      || realpathSync(OPENCODE_BIN) !== OPENCODE_BIN
    ) return false
  } catch { return false }
  const fingerprint = [info.dev, info.ino, info.ctimeMs, info.size, info.mode, info.uid, info.gid].join(':')
  if (verifiedBinaryFingerprint === fingerprint) return true
  const digest = await execute('/usr/bin/sha256sum', ['--', OPENCODE_BIN], 10_000)
  if (digest.failed || digest.code !== 0 || digest.signal !== null
    || digest.stdout !== `${OPENCODE_SHA256}  ${OPENCODE_BIN}`) return false
  const version = await execute(OPENCODE_BIN, ['--version'], 5_000)
  if (version.failed || version.code !== 0 || version.signal !== null || version.stdout !== OPENCODE_VERSION) return false
  const after = lstatSync(OPENCODE_BIN)
  if ([after.dev, after.ino, after.ctimeMs, after.size, after.mode, after.uid, after.gid].join(':') !== fingerprint) return false
  verifiedBinaryFingerprint = fingerprint
  return true
}

/** Catalog inspection never sends prompts, project data or authentication.
 * The deadline includes DNS/TLS and the body, not merely socket inactivity. */
export function requestProviderCatalog(dependencies = {}) {
  const get = dependencies.get ?? https.get
  return new Promise((resolvePromise, reject) => {
    let request
    let response
    let completed = false
    let timer
    const finish = (error, value) => {
      if (completed) return
      completed = true
      clearTimeout(timer)
      if (error) {
        response?.destroy()
        request?.destroy()
        reject(error)
      } else resolvePromise(value)
    }
    timer = setTimeout(() => finish(new Error('provider_catalog_timeout')), dependencies.timeoutMs ?? CATALOG_TIMEOUT_MS)
    timer.unref()
    try {
      request = get(CATALOG_URL, {
        agent: false,
        family: 4,
        headers: { accept: 'application/json', connection: 'close' },
      }, (incoming) => {
        response = incoming
        if (incoming.statusCode !== 200) return finish(new Error('provider_catalog_status'))
        const chunks = []
        let bytes = 0
        incoming.on('data', (chunk) => {
          bytes += chunk.length
          if (bytes > MAX_CATALOG_BYTES) finish(new Error('provider_catalog_size'))
          else chunks.push(chunk)
        })
        incoming.once('error', () => finish(new Error('provider_catalog_transport')))
        incoming.once('aborted', () => finish(new Error('provider_catalog_transport')))
        incoming.once('end', () => {
          try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
          catch { finish(new Error('provider_catalog_json')) }
        })
      })
      request.once('error', () => finish(new Error('provider_catalog_transport')))
    } catch { finish(new Error('provider_catalog_transport')) }
  })
}

export async function probeModelState(dependencies = {}) {
  let model = null
  let installed = false
  try {
    const config = (dependencies.readConfig ?? readCanonicalConfig)()
    model = validateProviderConfig(config)
    const binaryReady = await (dependencies.verifyBinary ?? verifyOpenCodeBinary)(dependencies.runCommand ?? runCommand)
    if (!binaryReady) return { ok: false, model, installed: false }
    installed = true
    const catalog = await (dependencies.getCatalog ?? requestProviderCatalog)()
    const modelId = model.id.slice(model.provider.length + 1)
    if (
      !record(catalog) || !Array.isArray(catalog.data)
      || catalog.data.filter((item) => record(item) && item.id === modelId).length !== 1
    ) return { ok: false, model, installed: true }
    return { ok: true, model, installed: true }
  } catch {
    return { ok: false, model, installed }
  }
}


// Read-only host observation for the independent server monitor. No caller
// supplies a unit name, filesystem path or command. Process presence is not
// itself evidence of useful activity; the backend correlates durable events.
export function readWorkerPause(io = { lstatSync, realpathSync, openSync, fstatSync, readFileSync, closeSync }) {
  const directory = '/etc/kelion', path = directory + '/codex-worker.paused'
  const parent = io.lstatSync(directory)
  const validParent = (p) => p.isDirectory() && !p.isSymbolicLink()
    && p.uid === 0 && p.gid === 0 && (p.mode & 0o777) === 0o755
    && io.realpathSync(directory) === directory
  if (!validParent(parent)) throw new Error('worker_pause_invalid')
  const assertParentUnchanged = () => {
    const current = io.lstatSync(directory)
    if (!validParent(current) || current.dev !== parent.dev || current.ino !== parent.ino) throw new Error('worker_pause_invalid')
  }
  let info
  try { info = io.lstatSync(path) }
  catch (error) {
    // Only initial absence is unpaused. A disappearance during open/read is not.
    if (error?.code !== 'ENOENT') throw error
    assertParentUnchanged()
    return false
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1
    || info.uid !== 0 || info.gid !== 0 || (info.mode & 0o777) !== 0o444
    || info.size !== 9 || io.realpathSync(path) !== path) throw new Error('worker_pause_invalid')
  let fd
  try {
    fd = io.openSync(path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW)
    const opened = io.fstatSync(fd), current = io.lstatSync(path)
    if (opened.dev !== info.dev || opened.ino !== info.ino || current.dev !== info.dev || current.ino !== info.ino
      || opened.uid !== 0 || opened.gid !== 0 || (opened.mode & 0o777) !== 0o444
      || io.readFileSync(fd, 'utf8') !== 'schema=1\n') throw new Error('worker_pause_invalid')
    assertParentUnchanged()
    return true
  } finally { if (fd !== undefined) io.closeSync(fd) }
}

export async function probeWorkerState(dependencies = {}) {
  const execute = dependencies.runCommand ?? runCommand
  const parse = async (unit, pid) => {
    const result = await execute('/usr/bin/systemctl', ['show', '--no-pager',
      '--property=' + (pid ? 'LoadState,ActiveState,MainPID' : 'LoadState,ActiveState'), unit], 3_000)
    if (result.failed || result.code !== 0 || result.signal) throw new Error('worker_host_unavailable')
    const entries = result.stdout.split('\n').filter(Boolean).map((line) => line.split('='))
    const fields = Object.fromEntries(entries)
    const expected = pid ? ['LoadState','ActiveState','MainPID'] : ['LoadState','ActiveState']
    if (entries.length !== expected.length || entries.some(([key, value, extra]) =>
      !expected.includes(key) || value === undefined || extra !== undefined)
      || Object.keys(fields).length !== expected.length || fields.LoadState !== 'loaded'
      || !(pid ? ['active','activating','inactive','failed'] : ['active','inactive','failed']).includes(fields.ActiveState)) {
      throw new Error('worker_host_unavailable')
    }
    if (pid && (!/^(0|[1-9][0-9]*)$/.test(fields.MainPID)
      || !Number.isSafeInteger(Number(fields.MainPID))
      || (['inactive','failed'].includes(fields.ActiveState) && fields.MainPID !== '0'))) {
      throw new Error('worker_host_unavailable')
    }
    return fields
  }
  const paused = (dependencies.readWorkerPause ?? readWorkerPause)()
  const [timer, service] = await Promise.all([
    parse('kelion-codex-worker.timer', false), parse('kelion-codex-worker.service', true),
  ])
  if (paused && (timer.ActiveState !== 'inactive' || !['inactive','failed'].includes(service.ActiveState))) {
    throw new Error('worker_pause_vector_invalid')
  }
  return { schema: 1, measuredAt: new Date().toISOString(),
    worker: { timer: timer.ActiveState, service: service.ActiveState, mainPid: Number(service.MainPID) },
    intentionalPause: paused, deployGate: false }
}

function statePayload(observed) {
  const ready = observed?.ok === true && observed.installed === true && record(observed.model)
  return {
    mode: 'manual',
    defaultProfile: DEFAULT_PROFILE,
    status: ready ? 'ready' : 'unavailable',
    activeProfile: ready ? DEFAULT_PROFILE : null,
    requestedProfile: null,
    requestId: null,
    installedProfiles: observed?.installed === true ? [DEFAULT_PROFILE] : [],
    model: observed?.model ?? null,
  }
}

/** Read-only compatibility endpoint. All former switch actions are retired.
 * A publication lease prevents a deployment from changing the checked config
 * between the readiness probe and the completed HTTP response. */
export function createModelControl(secret, dependencies = {}) {
  const verify = createServiceVerifier(secret)
  const probe = dependencies.probeState ?? (() => probeModelState(dependencies))
  const deploymentPending = dependencies.deploymentPending ?? deploymentEntryExists
  const publicationBarrier = dependencies.publicationBarrier ?? createPublicationBarrier()
  const snapshot = async () => statePayload(await probe().catch(() => ({ ok: false })))
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || !['/v1/model/state', '/v1/model/switch', '/v1/worker/state'].includes(req.url)) {
      return json(res, 404, { error: 'not_found' })
    }
    let lease
    let handedToResponse = false
    try {
      if (
        req.headers['transfer-encoding'] !== undefined
        || String(req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json'
      ) return json(res, 415, { error: 'content_type' })
      const raw = await collectBody(req)
      verify({
        timestamp: req.headers['x-kelion-timestamp'],
        nonce: req.headers['x-kelion-nonce'],
        signature: req.headers['x-kelion-signature'],
        method: req.method, path: req.url, body: raw,
      })
      if (deploymentPending()) return json(res, 503, { error: 'deployment_in_progress' })
      if (req.url === '/v1/model/switch') {
        const input = exactObject(raw, ['requestId', 'profile'])
        exactRawJson(raw, { requestId: input.requestId, profile: input.profile })
        requireRequestId(input.requestId)
        return json(res, 410, { error: 'constructor_model_switch_retired' })
      }
      exactRawJson(raw, exactObject(raw, []))
      lease = await publicationBarrier.acquire()
      if (!lease || deploymentPending()) return json(res, 503, { error: 'deployment_in_progress' })
      const state = req.url === '/v1/worker/state'
        ? await (dependencies.probeWorkerState ?? (() => probeWorkerState(dependencies)))()
        : await snapshot()
      if (deploymentPending()) return json(res, 503, { error: 'deployment_in_progress' })
      let released = false
      const releaseOnce = () => {
        if (released) return
        released = true
        void lease.release()
      }
      res.once('finish', releaseOnce)
      res.once('close', releaseOnce)
      handedToResponse = true
      return json(res, 200, state)
    } catch (error) {
      const message = String(error?.message ?? '')
      if (message.startsWith('service_auth')) return json(res, 401, { error: 'unauthorized' })
      if (message === 'body_size') return json(res, 413, { error: 'body_rejected' })
      return json(res, 422, { error: 'request_rejected' })
    } finally {
      if (lease && !handedToResponse) await lease.release()
    }
  })
  server.maxConnections = 16
  server.headersTimeout = 5_000
  server.requestTimeout = 25_000
  server.keepAliveTimeout = 1_000
  server.maxRequestsPerSocket = 8
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
  })
  return { server, snapshot }
}

function assertCanonicalRuntime() {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) throw new Error('root_required')
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
  if (process.argv[2] === '--validate-runtime-config') {
    const path = process.argv[3]
    if (process.argv.length !== 4 || !isAbsolute(path ?? '')) throw new Error('config_path_invalid')
    const info = lstatSync(path)
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 2 || info.size > MAX_COMMAND_BYTES) {
      throw new Error('config_file_invalid')
    }
    const model = validateProviderConfig(JSON.parse(readFileSync(path, 'utf8')))
    process.stdout.write(`${JSON.stringify(model)}\n`)
    return
  }
  if (process.argv[2] === '--verify-runtime-binary') {
    if (process.argv.length !== 3 || !await verifyOpenCodeBinary(runCommand)) throw new Error('binary_invalid')
    process.stdout.write('OPENCODE_BINARY_VERIFIED=yes\n')
    return
  }
  if (process.argv[2] === '--self-test') {
    if (DEFAULT_PROFILE !== 'fast' || DEPLOYMENT_JOURNALS.length !== 9
      || new Set(DEPLOYMENT_JOURNALS).size !== DEPLOYMENT_JOURNALS.length) throw new Error('self_test_contract')
    process.stdout.write('constructor-model-control self-test: TRECE\n')
    return
  }
  if (process.argv.length !== 2) throw new Error('mode_invalid')
  if (startupDeploymentEntryExists()) throw new Error('deployment_in_progress')
  assertCanonicalRuntime()
  const { server } = createModelControl(readServiceSecret(CONTROL_SECRET))
  removeCanonicalSocket()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(CONTROL_SOCKET, resolvePromise)
  })
  chmodSync(CONTROL_SOCKET, 0o660)
  const stop = () => {
    server.close(() => {
      removeCanonicalSocket()
      process.exit(0)
    })
  }
  process.once('SIGTERM', stop)
  process.once('SIGINT', stop)
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    process.stderr.write('constructor-model-control: startup_failed\n')
    process.exitCode = 1
  })
}
