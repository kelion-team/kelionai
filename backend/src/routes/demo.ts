import type { FastifyInstance, FastifyRequest } from 'fastify'
import { createHmac, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { getSessionUser } from '../session.js'
import {
  logVisit,
  touchVisit,
  addLead,
  addVisitorMessage,
  getVisitorMessages,
} from '../db.js'

// IP-ul real este calculat de Caddy numai după ce verifică dacă peer-ul este
// într-un CIDR Cloudflare de încredere. Caddy SUPRASCRIE antetul intern;
// browserul nu-l poate alege. Nu mai credem direct CF-Connecting-IP/XFF:
// oricine care lovește origin-ul direct poate fabrica acele antete și ocoli
// rate-limitul, geolocația și protecția anti-reuse.
export function clientIp(req: FastifyRequest): string {
  const curatatDeProxy = typeof req.headers['x-kelion-client-ip'] === 'string'
    ? req.headers['x-kelion-client-ip'].split(',')[0]?.trim()
    : ''
  return curatatDeProxy || req.ip || ''
}

// Visitor chat is identified only by the short-lived signed cookie. The
// public widget has no client-chosen conversation handle.
const VISITOR_CHAT_COOKIE = 'kelion_visitor_chat'
const CONV_RE = /^[A-Za-z0-9_-]{32,80}$/
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SAFE_PATH_RE = /^\/[A-Za-z0-9/_-]{0,63}$/

// Domeniu criptografic separat: compromiterea unui token de vizitator nu îl
// face utilizabil drept cookie de autentificare al unui cont.
const visitorChatSigningKey = createHmac('sha256', config.sessionSecret)
  .update('kelion:visitor-chat-cookie:v1')
  .digest()

interface VisitorChatClaims { scope: 'visitor-chat'; conv: string }

function readVisitorChat(req: FastifyRequest): { conv: string; expired: boolean } | null {
  const raw = req.cookies?.[VISITOR_CHAT_COOKIE]
  if (!raw) return null
  try {
    const claim = jwt.verify(raw, visitorChatSigningKey) as VisitorChatClaims
    if (claim.scope !== 'visitor-chat' || !CONV_RE.test(claim.conv)) return null
    return { conv: claim.conv, expired: false }
  } catch (e) {
    return e instanceof jwt.TokenExpiredError ? { conv: '', expired: true } : null
  }
}

function pathAgregat(value: unknown): string {
  if (typeof value !== 'string') return '/'
  const path = value.trim()
  return SAFE_PATH_RE.test(path) ? path : '/'
}

/** Țara vine numai din antetul intern suprascris de proxy-ul de încredere. */
export function countryCodeIntern(req: FastifyRequest): string {
  const raw = typeof req.headers['x-kelion-country'] === 'string'
    ? req.headers['x-kelion-country'].trim().toUpperCase()
    : ''
  return /^[A-Z]{2}$/.test(raw) && raw !== 'XX' && raw !== 'T1' ? raw : ''
}

function visitorRateKey(req: FastifyRequest): string {
  const conv = readVisitorChat(req)?.conv ?? ''
  return `${clientIp(req) || 'unknown'}:${conv || 'new'}`
}

export async function demoRoutes(app: FastifyInstance): Promise<void> {
  // Statistică anonimă agregată pe zi/pagină/țară. Nu persistăm un rând per
  // persoană, IP, user-agent, referrer sau identificator de dispozitiv.
  app.post<{ Body: { path?: string } }>('/api/visit', async (req, reply) => {
    void logVisit(countryCodeIntern(req), pathAgregat(req.body?.path))
    return reply.send({ ok: true })
  })

  // Prezență autentificată agregată pe user/zi/pagină, fără device/IP.
  app.post<{ Body: { path?: string } }>('/api/visit/ping', async (req, reply) => {
    const email = getSessionUser(req)?.email ?? ''
    if (!email) return reply.code(401).send({ error: 'unauthorized' })
    await touchVisit(email, pathAgregat(req.body?.path))
    return reply.send({ ok: true })
  })

  // NO free tier (Adrian: "the trial minutes are removed completely, users
  // buy to try"). The visit is still tracked (the analytics above), but
  // NOBODY gets a free session anymore — access requires an account +
  // credits.

  // A visitor leaves their email (the only real channel to an anonymous visitor):
  // stored as a lead the owner can then email from the admin panel. Public but
  // rate-limited by the global limiter; validated + capped server-side.
  app.post<{ Body: { email?: string; note?: string; submissionSession?: string } }>('/api/lead', async (req, reply) => {
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : ''
    const submissionSession = typeof req.body?.submissionSession === 'string' ? req.body.submissionSession : ''
    if (email.length > 254 || note.length > 1_000 || !UUID_V4_RE.test(submissionSession)) {
      return reply.code(400).send({ error: 'bad_request' })
    }
    const ok = await addLead(email, note, submissionSession)
    if (!ok) return reply.code(400).send({ error: 'bad_request' })
    return reply.send({ ok: true })
  })

  // Anonymous visitor chat uses a server-issued, signed HttpOnly cookie. The
  // browser never chooses or reads the conversation id, so threads cannot be
  // enumerated by changing a query/body field.
  app.post('/api/visitor-chat/session', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute', keyGenerator: (req: FastifyRequest) => clientIp(req) || 'unknown' } },
  }, async (req, reply) => {
    const existing = readVisitorChat(req)
    if (existing && !existing.expired) return reply.send({ ok: true, reused: true })
    const conv = randomBytes(32).toString('base64url')
    const token = jwt.sign({ scope: 'visitor-chat', conv } satisfies VisitorChatClaims, visitorChatSigningKey, {
      expiresIn: config.visitor.chatTtlSeconds,
    })
    reply.setCookie(VISITOR_CHAT_COOKIE, token, {
      path: '/api/visitor-chat', httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: config.visitor.chatTtlSeconds,
    })
    return reply.send({ ok: true, reused: false })
  })

  app.post<{ Body: { text?: string } }>('/api/visitor-chat/send', {
    config: { rateLimit: { max: 12, timeWindow: '1 minute', keyGenerator: visitorRateKey } },
  }, async (req, reply) => {
    const session = readVisitorChat(req)
    if (!session || session.expired) return reply.code(session?.expired ? 410 : 401).send({ error: session?.expired ? 'expired' : 'unauthorized' })
    const text = typeof req.body?.text === 'string' ? req.body.text : ''
    if (!text.trim() || text.length > 2_000) return reply.code(400).send({ error: 'bad_request' })
    const id = await addVisitorMessage(session.conv, 'visitor', text)
    if (id > 0) return reply.send({ ok: true, id })
    // AUDIT ADMIN (3 aug): INSERT-ul picat răspundea 200 cu {ok:false} —
    // widgetul verifica doar statusul HTTP și desena bula ca „trimisă", deși
    // mesajul nu exista nicăieri și adminul nu l-ar fi văzut niciodată. 502.
    return reply.code(502).send({ ok: false, error: 'save_failed', id: 0 })
  })

  app.get<{ Querystring: { after?: string } }>('/api/visitor-chat/poll', {
    config: { rateLimit: { max: 60, timeWindow: '1 minute', keyGenerator: visitorRateKey } },
  }, async (req, reply) => {
    const session = readVisitorChat(req)
    if (!session || session.expired) return reply.code(session?.expired ? 410 : 401).send({ error: session?.expired ? 'expired' : 'unauthorized' })
    const after = Number(req.query?.after ?? 0)
    if (!Number.isInteger(after) || after < 0 || after > 2_147_483_647) return reply.code(400).send({ error: 'bad_request' })
    return reply.send({ messages: await getVisitorMessages(session.conv, after) })
  })
}
