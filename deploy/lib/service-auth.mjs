import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'

const MAX_CLOCK_SKEW_SECONDS = 30
const NONCE_TTL_MS = 90_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIGNATURE_RE = /^v1=([0-9a-f]{64})$/i

export function sha256Hex(body) {
  return createHash('sha256').update(body).digest('hex')
}

export function canonicalServiceRequest(timestamp, nonce, method, path, body) {
  return `${timestamp}\n${nonce}\n${method.toUpperCase()}\n${path}\n${sha256Hex(body)}`
}

export function readServiceSecret(path) {
  const stat = statSync(path)
  // Group-read is allowed for the dedicated service GID; group-write/execute
  // and every permission for "other" stay forbidden.
  if (!stat.isFile() || (stat.mode & 0o027) !== 0) throw new Error('service_secret_permissions')
  const secret = readFileSync(path)
  const trimmed = Buffer.from(secret.toString('utf8').trim(), 'utf8')
  if (trimmed.length < 32 || trimmed.length > 256) throw new Error('service_secret_length')
  return trimmed
}

export function signServiceRequest(secret, timestamp, nonce, method, path, body) {
  const digest = createHmac('sha256', secret)
    .update(canonicalServiceRequest(timestamp, nonce, method, path, body))
    .digest('hex')
  return `v1=${digest}`
}

export function createServiceVerifier(secret) {
  const nonces = new Map()
  return ({ timestamp, nonce, signature, method, path, body }) => {
    const nowSeconds = Math.floor(Date.now() / 1000)
    const parsedTimestamp = Number(timestamp)
    if (!Number.isSafeInteger(parsedTimestamp) || Math.abs(nowSeconds - parsedTimestamp) > MAX_CLOCK_SKEW_SECONDS) {
      throw new Error('service_auth_timestamp')
    }
    if (!UUID_RE.test(String(nonce ?? ''))) throw new Error('service_auth_nonce')
    const match = SIGNATURE_RE.exec(String(signature ?? ''))
    if (!match) throw new Error('service_auth_signature')

    const now = Date.now()
    for (const [seenNonce, expiresAt] of nonces) {
      if (expiresAt <= now) nonces.delete(seenNonce)
    }
    if (nonces.has(nonce)) throw new Error('service_auth_replay')

    const expected = signServiceRequest(secret, String(parsedTimestamp), nonce, method, path, body).slice(3)
    const supplied = match[1].toLowerCase()
    if (!timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(supplied, 'hex'))) {
      throw new Error('service_auth_signature')
    }
    nonces.set(nonce, now + NONCE_TTL_MS)
  }
}

export function requireRequestId(value) {
  const requestId = String(value ?? '')
  if (!UUID_RE.test(requestId)) throw new Error('request_id_invalid')
  return requestId
}
