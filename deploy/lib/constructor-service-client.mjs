import { createHash, createHmac, randomUUID } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

export function fail(message) {
  throw new Error(message)
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

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function assertLoopbackApi(raw) {
  const url = new URL(raw)
  if (
    url.protocol !== 'http:'
    || !['127.0.0.1', '::1', 'localhost'].includes(url.hostname.toLowerCase())
    || url.username
    || url.password
    || url.search
    || url.hash
  ) fail('API-ul Constructor trebuie să fie HTTP loopback fără credentiale în URL')
  return url
}

export function signedServiceHeaders(secret, prefix, method, path, body, timestamp, nonce) {
  if (secret.length < 32 || /[\r\n]/.test(secret)) fail('Secret HMAC invalid')
  if (!/^x-constructor-(publisher|release)$/.test(prefix)) fail('Domeniu HMAC invalid')
  const bodyHash = sha256(canonicalJson(body))
  const payload = `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${bodyHash}`
  return {
    'content-type': 'application/json',
    [`${prefix}-timestamp`]: timestamp,
    [`${prefix}-nonce`]: nonce,
    [`${prefix}-signature`]: `v1=${createHmac('sha256', secret).update(payload).digest('hex')}`,
  }
}

export function systemdCredentialPath(name, explicitEnv, maxBytes = 65_536) {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(name)) fail('Nume credentială invalid')
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 32 || maxBytes > 65_536) fail('Limită credentială invalidă')
  const path = explicitEnv
    ? resolve(explicitEnv)
    : process.env.CREDENTIALS_DIRECTORY
      ? join(process.env.CREDENTIALS_DIRECTORY, name)
      : ''
  if (!path) fail(`Lipsește credentiala systemd ${name}`)
  const info = statSync(path)
  if (!info.isFile() || info.size < 1 || info.size > maxBytes) fail(`Credentiala ${name} este invalidă`)
  if (process.platform !== 'win32' && (info.mode & 0o077) !== 0) fail(`Credentiala ${name} are permisiuni prea largi`)
  return path
}

export function loadSystemdCredential(name, explicitEnv) {
  const path = systemdCredentialPath(name, explicitEnv)
  const value = readFileSync(path, 'utf8').trim()
  if (value.length < 32 || /[\r\n]/.test(value)) fail(`Credentiala ${name} trebuie să fie o singură valoare de minimum 32 caractere`)
  return { path, value }
}

export async function postInternal({ api, secret, prefix, path, body, timeoutMs = 15_000 }) {
  if (!path.startsWith('/api/internal/')) fail('Calea internă este invalidă')
  const timestamp = String(Math.floor(Date.now() / 1000))
  const nonce = randomUUID()
  const response = await fetch(new URL(path, api), {
    method: 'POST',
    headers: signedServiceHeaders(secret, prefix, 'POST', path, body, timestamp, nonce),
    body: canonicalJson(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (response.status === 204) return null
  const payload = await response.json().catch(() => null)
  if (!response.ok) fail(`API intern ${path}: HTTP ${response.status}`)
  return payload
}

export function startLease({ api, secret, prefix, path, body, intervalMs = 45_000 }) {
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 5 || intervalMs > 60_000) fail('Interval lease invalid')
  let stopped = false
  let pending = Promise.resolve()
  let failure = null
  const renew = () => {
    if (stopped) return
    pending = pending
      .then(() => postInternal({ api, secret, prefix, path, body }))
      .catch((error) => { failure = error })
  }
  renew()
  const timer = setInterval(renew, intervalMs)
  timer.unref()
  const assertHeld = async () => {
    await pending
    if (failure) throw failure
  }
  const stop = async () => {
    stopped = true
    clearInterval(timer)
    await assertHeld()
  }
  stop.assert = assertHeld
  return stop
}

export function strictJobIdentity(job) {
  const jobId = String(job?.jobId ?? '')
  const taskId = String(job?.taskId ?? '').toLowerCase()
  const leaseId = String(job?.leaseId ?? '').toLowerCase()
  if (
    !/^[1-9]\d{0,18}$/.test(jobId)
    || !/^codex-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(taskId)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(leaseId)
    || !Number.isSafeInteger(job?.leaseSeconds)
    || job.leaseSeconds < 30
    || job.leaseSeconds > 300
  ) fail('Identitatea jobului intern este invalidă')
  return { jobId, taskId, leaseId }
}
