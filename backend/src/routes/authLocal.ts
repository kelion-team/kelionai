// ── AUTENTIFICARE LOCALĂ (Adrian, 26 iul: „alte soluții de logare non-Gmail?
// ... da, pornește, inclusiv să poată crea și cumpăra credite") ──────────────
// Trei căi FĂRĂ Google, cu aceleași funcții (identitatea = emailul, ca la
// Google; portofel/istoric/memorie sunt deja pe email):
//   1. email + parolă (înregistrare + login)
//   2. link magic pe email (fără parolă; creează contul din zbor dacă nu există)
//   3. resetare parolă (link pe email)
// Parole: scrypt din node:crypto (fără dependențe noi), sare per cont,
// comparare în timp constant. Tokenurile de link: DOAR hash-ul în DB.
// Mesaje deliberat GENERICE la magic/reset (nu confirmăm dacă un email există).
import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { config, roleFor } from '../config.js'
import { setSession } from '../session.js'
import {
  getLocalAccount,
  upsertLocalAccount,
  saveLoginToken,
  consumeLoginToken,
} from '../db.js'
import { sendMail } from '../services/mail.js'

const SCRYPT_N = 16384
function hashPassword(pass: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const h = crypto.scryptSync(pass, salt, 64, { N: SCRYPT_N }).toString('hex')
  return `${salt}:${h}`
}
function verifyPassword(pass: string, stored: string): boolean {
  const [salt, h] = stored.split(':')
  if (!salt || !h) return false
  const probe = crypto.scryptSync(pass, salt, 64, { N: SCRYPT_N })
  const ref = Buffer.from(h, 'hex')
  return probe.length === ref.length && crypto.timingSafeEqual(probe, ref)
}
const sha256 = (s: string): string => crypto.createHash('sha256').update(s).digest('hex')
const validEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)

function signIn(reply: Parameters<typeof setSession>[0], email: string, name: string): void {
  setSession(reply, {
    email: email.toLowerCase(),
    name: name || email.split('@')[0],
    picture: '',
    role: roleFor(email),
    locale: '',
  })
}

async function sendLink(email: string, purpose: 'magic' | 'reset'): Promise<void> {
  const token = crypto.randomBytes(32).toString('hex')
  await saveLoginToken(sha256(token), email, purpose, 20)
  const base = config.frontendOrigin || 'https://kelionai.app'
  const url =
    purpose === 'magic'
      ? `${base}/auth/local/magic/cb?token=${token}`
      : `${base}/login?reset=${token}`
  const subj = purpose === 'magic' ? 'Linkul tău de intrare în Kelionai' : 'Resetarea parolei Kelionai'
  const body =
    purpose === 'magic'
      ? `Apasă linkul ca să intri în Kelionai (valabil 20 de minute):\n\n${url}\n\nDacă nu tu ai cerut asta, ignoră mesajul.`
      : `Apasă linkul ca să îți setezi o parolă nouă (valabil 20 de minute):\n\n${url}\n\nDacă nu tu ai cerut asta, ignoră mesajul.`
  await sendMail({ to: email, subject: subj, html: `<p style="white-space:pre-wrap">${body}</p>`, text: body })
}

export async function authLocalRoutes(app: FastifyInstance): Promise<void> {
  const rl = { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }

  // Înregistrare cont nou (email + parolă) → sesiune direct.
  app.post<{ Body: { email?: string; password?: string; name?: string } }>(
    '/auth/local/register',
    rl,
    async (req, reply) => {
      const email = String(req.body?.email ?? '').toLowerCase().trim()
      const pass = String(req.body?.password ?? '')
      if (!validEmail(email)) return reply.code(400).send({ error: 'email_invalid' })
      if (pass.length < 8) return reply.code(400).send({ error: 'parola_scurta' })
      if (await getLocalAccount(email)) return reply.code(409).send({ error: 'cont_existent' })
      await upsertLocalAccount(email, String(req.body?.name ?? '').trim(), hashPassword(pass))
      signIn(reply, email, String(req.body?.name ?? '').trim())
      return reply.send({ ok: true })
    },
  )

  app.post<{ Body: { email?: string; password?: string } }>(
    '/auth/local/login',
    rl,
    async (req, reply) => {
      const email = String(req.body?.email ?? '').toLowerCase().trim()
      const acc = await getLocalAccount(email)
      if (!acc || !verifyPassword(String(req.body?.password ?? ''), acc.pass_hash))
        return reply.code(401).send({ error: 'date_gresite' })
      signIn(reply, email, acc.name)
      return reply.send({ ok: true })
    },
  )

  // Link magic: răspuns GENERIC mereu; contul se creează din zbor la click.
  app.post<{ Body: { email?: string } }>('/auth/local/magic', rl, async (req, reply) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim()
    if (validEmail(email)) void sendLink(email, 'magic').catch(() => {})
    return reply.send({ ok: true })
  })

  app.get<{ Querystring: { token?: string } }>('/auth/local/magic/cb', async (req, reply) => {
    const token = String(req.query?.token ?? '')
    const email = token ? await consumeLoginToken(sha256(token), 'magic') : null
    if (!email) return reply.redirect(`${config.frontendOrigin}/login?error=link_expirat`)
    const acc = await getLocalAccount(email)
    if (!acc) await upsertLocalAccount(email, '', hashPassword(crypto.randomBytes(24).toString('hex')))
    signIn(reply, email, acc?.name ?? '')
    return reply.redirect(config.frontendOrigin || '/')
  })

  app.post<{ Body: { email?: string } }>('/auth/local/reset-request', rl, async (req, reply) => {
    const email = String(req.body?.email ?? '').toLowerCase().trim()
    if (validEmail(email) && (await getLocalAccount(email))) void sendLink(email, 'reset').catch(() => {})
    return reply.send({ ok: true })
  })

  app.post<{ Body: { token?: string; password?: string } }>(
    '/auth/local/reset',
    rl,
    async (req, reply) => {
      const pass = String(req.body?.password ?? '')
      if (pass.length < 8) return reply.code(400).send({ error: 'parola_scurta' })
      const email = await consumeLoginToken(sha256(String(req.body?.token ?? '')), 'reset')
      if (!email) return reply.code(400).send({ error: 'link_expirat' })
      const acc = await getLocalAccount(email)
      await upsertLocalAccount(email, acc?.name ?? '', hashPassword(pass))
      signIn(reply, email, acc?.name ?? '')
      return reply.send({ ok: true })
    },
  )
}
