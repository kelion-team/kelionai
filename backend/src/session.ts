import type { FastifyReply, FastifyRequest } from 'fastify'
import { createHash, randomBytes } from 'node:crypto'
import { config, roleFor } from './config.js'
import { esteAdminKelion } from './services/adminIdentity.js'
import {
  createAuthSession,
  consumeNativeChannelTicket,
  readAndTouchAuthSession,
  revokeAuthSession,
  type AuthSessionRecord,
} from './db.js'

/** Opaque browser session. The cookie never contains identity or OAuth data. */
export const SESSION_COOKIE = config.isProd ? '__Host-kelionai_session' : 'kelionai_session'

export interface SessionUser {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer'
  /** Admin is granted only to an identity verified by Google OAuth. */
  authProvider: 'google' | 'local'
  locale: string
  /** Server-derived login time, used only for recent-confirmation gates. */
  authenticatedAt?: number
}

const SESSION_ON_REQUEST = Symbol('kelionai.auth-session')
const SESSION_HASH_ON_REQUEST = Symbol('kelionai.auth-session-hash')
const SESSION_TRANSPORT_ON_REQUEST = Symbol('kelionai.auth-session-transport')
type SessionRequest = FastifyRequest & {
  [SESSION_ON_REQUEST]?: SessionUser | null
  [SESSION_HASH_ON_REQUEST]?: string
  [SESSION_TRANSPORT_ON_REQUEST]?: 'cookie' | 'bearer'
}

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')
const looksOpaque = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value)

function cookieToken(req: FastifyRequest): string {
  let token = req.cookies?.[SESSION_COOKIE]
  if (!token) {
    const raw = req.headers.cookie
    if (raw) {
      const escaped = SESSION_COOKIE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const match = raw.match(new RegExp(`(?:^|;\\s*)${escaped}=([^;]+)`))
      if (match) {
        try { token = decodeURIComponent(match[1]) } catch { return '' }
      }
    }
  }
  return typeof token === 'string' ? token : ''
}

function bearerToken(req: FastifyRequest): string {
  const value = req.headers.authorization
  if (!value) return ''
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(value)
  return match?.[1] ?? ''
}

export function sessionRoleFor(
  email: string,
  provider: SessionUser['authProvider'] | undefined,
): SessionUser['role'] {
  return provider === 'google' ? roleFor(email) : 'customer'
}

function fromRecord(record: AuthSessionRecord): SessionUser | null {
  const authProvider = record.authProvider === 'google' ? 'google' : 'local'
  // Historical/local records must never carry the owner's email to legacy
  // email-keyed tools or billing. Apply once for HTTP and native channels.
  if (authProvider !== 'google' && esteAdminKelion(record.email)) return null
  return {
    email: record.email.toLowerCase(),
    name: record.name,
    picture: record.picture,
    authProvider,
    locale: record.locale,
    authenticatedAt: record.authenticatedAt,
    role: sessionRoleFor(record.email, authProvider),
  }
}

/** Resolve the opaque handle once, before route handlers run. */
export async function hydrateSession(req: FastifyRequest): Promise<void> {
  const target = req as SessionRequest
  target[SESSION_ON_REQUEST] = null
  delete target[SESSION_HASH_ON_REQUEST]
  delete target[SESSION_TRANSPORT_ON_REQUEST]
  const authorizationPresent = typeof req.headers.authorization === 'string'
  const bearer = bearerToken(req)
  const nativeOrigin = typeof req.headers.origin === 'string'
    && config.product.nativeOrigins.includes(req.headers.origin)
  // Native shells authenticate only with an explicit bearer. They never fall
  // back to ambient web cookies. An invalid Authorization header also fails
  // closed instead of silently selecting a cookie identity.
  const token = authorizationPresent || nativeOrigin ? bearer : cookieToken(req)
  // Historical JWTs contain dots, so they fail closed here.
  if (!looksOpaque(token)) return
  const hash = sha256(token)
  try {
    const record = await readAndTouchAuthSession(
      hash,
      config.session.idleTtlSeconds,
      config.session.touchIntervalSeconds,
    )
    if (!record) return
    if (bearer && record.sessionKind !== 'native') return
    if (!bearer && record.sessionKind !== 'browser') return
    const user = fromRecord(record)
    if (!user) return
    target[SESSION_HASH_ON_REQUEST] = hash
    target[SESSION_TRANSPORT_ON_REQUEST] = bearer ? 'bearer' : 'cookie'
    target[SESSION_ON_REQUEST] = user
  } catch {
    const unavailable = new Error('session_store_unavailable') as Error & { statusCode?: number }
    unavailable.statusCode = 503
    throw unavailable
  }
}

export function getSessionUser(req: FastifyRequest): SessionUser | null {
  return (req as SessionRequest)[SESSION_ON_REQUEST] ?? null
}

/** CSRF decision for a cookie-authenticated request. */
export function trustedMutationOrigin(req: FastifyRequest): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true
  if (!getSessionUser(req)) return true
  if ((req as SessionRequest)[SESSION_TRANSPORT_ON_REQUEST] === 'bearer') return true
  const expected = config.publicOrigin || config.frontendOrigin
  return Boolean(expected) && req.headers.origin === expected
}

/** Browser WebSocket upgrades are GET requests, so the mutation hook does not
 * cover them. Every cookie-authenticated upgrade must call this exact-origin
 * guard from preValidation before the HTTP connection is upgraded. */
export function trustedWebSocketOrigin(req: FastifyRequest): boolean {
  if ((req as SessionRequest)[SESSION_TRANSPORT_ON_REQUEST] === 'bearer') {
    return typeof req.headers.origin === 'string' && config.product.nativeOrigins.includes(req.headers.origin)
  }
  const expected = config.publicOrigin || config.frontendOrigin
  return Boolean(expected) && req.headers.origin === expected
}

export async function hydrateSessionFromChannelTicket(
  req: FastifyRequest,
  audience: 'vocal-live' | 'apel',
): Promise<boolean> {
  const target = req as SessionRequest
  target[SESSION_ON_REQUEST] = null
  delete target[SESSION_HASH_ON_REQUEST]
  delete target[SESSION_TRANSPORT_ON_REQUEST]
  const raw = req.headers['sec-websocket-protocol']
  if (typeof raw !== 'string') return false
  const protocols = raw.split(',').map((value) => value.trim()).filter(Boolean)
  if (!protocols.includes('kelion-native')) return false
  const encoded = protocols.filter((value) => value.startsWith('kelion-ticket.'))
  if (encoded.length !== 1) return false
  const ticket = encoded[0].slice('kelion-ticket.'.length)
  if (!looksOpaque(ticket)) return false
  const record = await consumeNativeChannelTicket(sha256(ticket), audience)
  if (!record) return false
  const user = fromRecord(record)
  if (!user) return false
  target[SESSION_ON_REQUEST] = user
  target[SESSION_TRANSPORT_ON_REQUEST] = 'bearer'
  return true
}

/** Authenticate a WebSocket upgrade through either the hydrated browser
 * session or a one-use native channel ticket, then enforce its exact origin. */
export async function validateWebSocketSession(
  req: FastifyRequest,
  reply: FastifyReply,
  audience: 'vocal-live' | 'apel',
): Promise<FastifyReply | void> {
  if (!getSessionUser(req) && req.headers['sec-websocket-protocol']) {
    try {
      await hydrateSessionFromChannelTicket(req, audience)
    } catch {
      return reply.code(503).send({ error: 'channel_ticket_unavailable' })
    }
  }
  if (!getSessionUser(req)) return reply.code(401).send({ error: 'unauthorized' })
  if (!trustedWebSocketOrigin(req)) return reply.code(403).send({ error: 'origin_forbidden' })
}

/** Re-check the session at the upgraded-handler boundary and close fail-closed
 * if a plugin or future refactor ever reaches it without authenticated state. */
export function webSocketSessionUser(
  req: FastifyRequest,
  socket: { close(code: number, reason: string): void },
): SessionUser | null {
  const user = getSessionUser(req)
  if (user) return user
  try {
    socket.close(1008, 'unauthorized')
  } catch {
    // Socket already closed.
  }
  return null
}

export async function setSession(reply: FastifyReply, user: SessionUser): Promise<void> {
  const authProvider = user.authProvider === 'google' ? 'google' : 'local'
  const token = randomBytes(32).toString('base64url')
  await createAuthSession({
    tokenHash: sha256(token),
    email: user.email.toLowerCase(),
    name: user.name,
    picture: user.picture,
    authProvider,
    locale: user.locale,
    sessionKind: 'browser',
    deviceId: null,
    absoluteTtlSeconds: config.session.absoluteTtlSeconds,
  })
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: config.session.absoluteTtlSeconds,
  })
}

export async function createNativeSession(user: SessionUser, deviceId: string): Promise<{
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}> {
  const token = randomBytes(32).toString('base64url')
  await createAuthSession({
    tokenHash: sha256(token),
    email: user.email.toLowerCase(),
    name: user.name,
    picture: user.picture,
    authProvider: 'google',
    locale: user.locale,
    sessionKind: 'native',
    deviceId,
    absoluteTtlSeconds: config.session.absoluteTtlSeconds,
  })
  return { accessToken: token, tokenType: 'Bearer', expiresIn: config.session.absoluteTtlSeconds }
}

export function sessionTokenHash(req: FastifyRequest): string | null {
  return (req as SessionRequest)[SESSION_HASH_ON_REQUEST] ?? null
}

export function isNativeBearerSession(req: FastifyRequest): boolean {
  return (req as SessionRequest)[SESSION_TRANSPORT_ON_REQUEST] === 'bearer'
}

/** Revoke an opaque native bearer without disclosing whether it was active.
 * A repeated request with the same well-formed token remains a successful
 * no-op, which makes device logout safe to retry after a lost response. */
export async function revokeNativeBearer(req: FastifyRequest): Promise<boolean> {
  const token = bearerToken(req)
  if (!looksOpaque(token)) return false
  await revokeAuthSession(sha256(token))
  return true
}

export async function clearSession(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const hash = (req as SessionRequest)[SESSION_HASH_ON_REQUEST]
  try {
    if (hash) await revokeAuthSession(hash)
  } finally {
    reply.clearCookie(SESSION_COOKIE, {
      path: '/',
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
    })
  }
}

export function cerAdmin(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const user = getSessionUser(req)
  if (!user) {
    void reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  if (user.role !== 'admin') {
    void reply.code(403).send({ error: 'forbidden' })
    return null
  }
  return user
}

export function adminSiId(
  req: FastifyRequest,
  reply: FastifyReply,
  rawId: string,
): number | null {
  if (!cerAdmin(req, reply)) return null
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) {
    void reply.code(400).send({ error: 'id_invalid' })
    return null
  }
  return id
}
