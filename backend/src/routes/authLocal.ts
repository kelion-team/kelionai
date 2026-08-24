import type { FastifyInstance, FastifyReply } from 'fastify'
import crypto from 'node:crypto'
import { config } from '../config.js'
import { setSession } from '../session.js'
import {
  accountBlockStatus,
  consumeLoginToken,
  createLocalAccount,
  getLocalAccount,
  revokeAllAuthSessions,
  saveLoginToken,
  updateLocalPassword,
} from '../db.js'
import { sendMail } from '../services/mail.js'

const SCRYPT_N = 16_384
const PASSWORD_MAX = 256
const LINK_TTL_MINUTES = 20
const validEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
const isAdminIdentity = (email: string): boolean => email.toLowerCase() === config.adminEmail.toLowerCase()
const sha256 = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')

function scrypt(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: SCRYPT_N }, (error, derived) => {
      if (error) reject(error)
      else resolve(derived)
    })
  })
}

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex')
  return `${salt}:${(await scrypt(password, salt)).toString('hex')}`
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!password || password.length > PASSWORD_MAX) return false
  const [salt, encoded] = stored.split(':')
  if (!salt || !/^[a-f0-9]{128}$/.test(encoded ?? '')) return false
  try {
    const probe = await scrypt(password, salt)
    const expected = Buffer.from(encoded, 'hex')
    return probe.length === expected.length && crypto.timingSafeEqual(probe, expected)
  } catch {
    return false
  }
}

async function signIn(reply: FastifyReply, email: string, name: string): Promise<void> {
  await setSession(reply, {
    email: email.toLowerCase(),
    name: name || email.split('@')[0],
    picture: '',
    role: 'customer',
    authProvider: 'local',
    locale: '',
  })
}

async function sendLink(email: string, purpose: 'magic' | 'reset'): Promise<void> {
  if (!config.publicOrigin) throw new Error('public_origin_required')
  const token = crypto.randomBytes(32).toString('hex')
  await saveLoginToken(sha256(token), email, purpose, LINK_TTL_MINUTES)
  const url = purpose === 'magic'
    ? `${config.publicOrigin}/auth/local/magic/cb?token=${token}`
    : `${config.publicOrigin}/login?reset=${token}`
  const subject = purpose === 'magic' ? 'Your Kelionai sign-in link' : 'Reset your Kelionai password'
  const text = `${subject} (valid for ${LINK_TTL_MINUTES} minutes):\n\n${url}\n\nIf you did not request this, ignore this message.`
  await sendMail({ to: email, subject, html: `<p style="white-space:pre-wrap">${text}</p>`, text })
}

async function activeAccount(email: string): Promise<'active' | 'blocked' | 'unavailable'> {
  const status = await accountBlockStatus(email)
  if (!status.available) return 'unavailable'
  return status.blocked ? 'blocked' : 'active'
}

export async function authLocalRoutes(app: FastifyInstance): Promise<void> {
  const limited = { config: { rateLimit: { max: 8, timeWindow: '1 minute' } } }

  // New local identities are created only after control of the mailbox is
  // proven by the one-use magic callback. There is no unverified password
  // registration path that can pre-claim another provider's email.
  app.post<{ Body: { email?: string } }>('/auth/local/magic', limited, async (req, reply) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim()
    if (!validEmail(email) || isAdminIdentity(email)) return reply.send({ ok: true })
    const status = await activeAccount(email)
    if (status === 'unavailable') return reply.code(503).send({ error: 'account_status_unavailable' })
    if (status === 'active') await sendLink(email, 'magic').catch(() => undefined)
    return reply.send({ ok: true })
  })

  app.get<{ Querystring: { token?: string } }>('/auth/local/magic/cb', async (req, reply) => {
    const token = String(req.query?.token ?? '')
    if (!/^[a-f0-9]{64}$/.test(token)) return reply.redirect(`${config.publicOrigin}/login?error=link_expired`)
    const email = await consumeLoginToken(sha256(token), 'magic')
    if (!email || isAdminIdentity(email)) return reply.redirect(`${config.publicOrigin}/login?error=link_expired`)
    const status = await activeAccount(email)
    if (status === 'unavailable') return reply.code(503).send({ error: 'account_status_unavailable' })
    if (status === 'blocked') return reply.redirect(`${config.publicOrigin}/login?error=blocked`)
    let account = await getLocalAccount(email)
    if (!account) {
      await createLocalAccount(email, '', await hashPassword(crypto.randomBytes(32).toString('base64url')))
      account = await getLocalAccount(email)
    }
    if (!account) return reply.code(503).send({ error: 'account_creation_unavailable' })
    await signIn(reply, email, account.name)
    return reply.redirect(config.publicOrigin)
  })

  // Password login/reset remains only for already verified legacy local
  // accounts. Hashing is asynchronous so it cannot block the HTTP event loop.
  app.post<{ Body: { email?: string; password?: string } }>('/auth/local/login', limited, async (req, reply) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim()
    const password = String(req.body?.password ?? '')
    if (!validEmail(email) || isAdminIdentity(email) || password.length > PASSWORD_MAX) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    const status = await activeAccount(email)
    if (status === 'unavailable') return reply.code(503).send({ error: 'account_status_unavailable' })
    if (status === 'blocked') return reply.code(401).send({ error: 'invalid_credentials' })
    const account = await getLocalAccount(email)
    if (!account || !await verifyPassword(password, account.pass_hash)) {
      return reply.code(401).send({ error: 'invalid_credentials' })
    }
    await signIn(reply, email, account.name)
    return reply.send({ ok: true })
  })

  app.post<{ Body: { email?: string } }>('/auth/local/reset-request', limited, async (req, reply) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim()
    if (!validEmail(email) || isAdminIdentity(email)) return reply.send({ ok: true })
    const status = await activeAccount(email)
    if (status === 'unavailable') return reply.code(503).send({ error: 'account_status_unavailable' })
    if (status === 'active' && await getLocalAccount(email)) await sendLink(email, 'reset').catch(() => undefined)
    return reply.send({ ok: true })
  })

  app.post<{ Body: { token?: string; password?: string } }>('/auth/local/reset', limited, async (req, reply) => {
    const password = String(req.body?.password ?? '')
    const token = String(req.body?.token ?? '')
    if (password.length < 12 || password.length > PASSWORD_MAX || !/^[a-f0-9]{64}$/.test(token)) {
      return reply.code(400).send({ error: 'invalid_reset' })
    }
    const email = await consumeLoginToken(sha256(token), 'reset')
    if (!email || isAdminIdentity(email)) return reply.code(400).send({ error: 'invalid_reset' })
    const status = await activeAccount(email)
    if (status === 'unavailable') return reply.code(503).send({ error: 'account_status_unavailable' })
    if (status === 'blocked' || !await updateLocalPassword(email, await hashPassword(password))) {
      return reply.code(400).send({ error: 'invalid_reset' })
    }
    await revokeAllAuthSessions(email)
    const account = await getLocalAccount(email)
    if (!account) return reply.code(503).send({ error: 'account_unavailable' })
    await signIn(reply, email, account.name)
    return reply.send({ ok: true })
  })
}
