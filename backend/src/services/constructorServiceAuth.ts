import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'
import { config } from '../config.js'
import {
  consumeConstructorServiceNonce,
  type ConstructorServiceDomain,
} from './constructorPipeline.js'

interface DomainAuth {
  enabled: boolean
  secret: string
  headerPrefix: string
  windowMs: number
}

export type ConstructorServiceAuthResult = 'authorized' | 'unauthorized' | 'store_unavailable'

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) throw new Error('invalid_json_value')
    return encoded
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(obj[key])}`).join(',')}}`
}

function authFor(domain: ConstructorServiceDomain): DomainAuth {
  if (domain === 'codex-worker') {
    return {
      enabled: config.codexWorker.enabled,
      secret: config.codexWorker.secret,
      headerPrefix: 'x-codex',
      windowMs: 5 * 60_000,
    }
  }
  if (domain === 'constructor-publisher') {
    return {
      enabled: config.constructorPublisher.enabled,
      secret: config.constructorPublisher.secret,
      headerPrefix: 'x-constructor-publisher',
      windowMs: 30_000,
    }
  }
  return {
    enabled: config.constructorRelease.enabled,
    secret: config.constructorRelease.secret,
    headerPrefix: 'x-constructor-release',
    windowMs: 30_000,
  }
}

function pathWithoutQuery(req: FastifyRequest): string {
  const raw = req.raw.url ?? req.url
  return raw.split('?')[0] || '/'
}

/**
 * Verifică HMAC-ul unei singure identități operaționale și consumă nonce-ul în
 * Postgres înainte ca ruta să poată muta starea. Secretele, namespace-urile de
 * antet și nonce-urile sunt distincte pentru worker, publisher și release.
 */
export async function verifyConstructorServiceRequest(
  req: FastifyRequest,
  domain: ConstructorServiceDomain,
  now = Date.now(),
  consumeNonce: typeof consumeConstructorServiceNonce = consumeConstructorServiceNonce,
): Promise<ConstructorServiceAuthResult> {
  const auth = authFor(domain)
  if (!auth.enabled || auth.secret.length < 32) return 'unauthorized'
  const timestampRaw = String(req.headers[`${auth.headerPrefix}-timestamp`] ?? '')
  const nonce = String(req.headers[`${auth.headerPrefix}-nonce`] ?? '').toLowerCase()
  const signature = String(req.headers[`${auth.headerPrefix}-signature`] ?? '').toLowerCase()
  if (
    !/^\d{10}$/.test(timestampRaw)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce)
    || !/^v1=[0-9a-f]{64}$/.test(signature)
  ) return 'unauthorized'
  const timestampMs = Number(timestampRaw) * 1000
  if (!Number.isFinite(timestampMs) || Math.abs(now - timestampMs) > auth.windowMs) return 'unauthorized'
  let encodedBody: string
  try {
    encodedBody = canonicalJson(req.body ?? null)
  } catch {
    return 'unauthorized'
  }
  const bodyHash = createHash('sha256').update(encodedBody).digest('hex')
  const payload = `${timestampRaw}\n${nonce}\n${req.method.toUpperCase()}\n${pathWithoutQuery(req)}\n${bodyHash}`
  const expected = `v1=${createHmac('sha256', auth.secret).update(payload).digest('hex')}`
  const left = Buffer.from(signature)
  const right = Buffer.from(expected)
  if (left.length !== right.length || !timingSafeEqual(left, right)) return 'unauthorized'
  try {
    // Nonce-ul trebuie să supraviețuiască întregii ferestre a timestampului
    // semnat, inclusiv când ceasul semnatarului este înaintea serverului.
    return await consumeNonce(domain, nonce, new Date(timestampMs + auth.windowMs + 1))
      ? 'authorized'
      : 'unauthorized'
  } catch {
    return 'store_unavailable'
  }
}

export async function verifyCodexWorkerRequest(req: FastifyRequest, now = Date.now()): Promise<ConstructorServiceAuthResult> {
  return verifyConstructorServiceRequest(req, 'codex-worker', now)
}

export async function verifyPublisherRequest(req: FastifyRequest, now = Date.now()): Promise<ConstructorServiceAuthResult> {
  return verifyConstructorServiceRequest(req, 'constructor-publisher', now)
}

export async function verifyReleaseRequest(req: FastifyRequest, now = Date.now()): Promise<ConstructorServiceAuthResult> {
  return verifyConstructorServiceRequest(req, 'constructor-release', now)
}
