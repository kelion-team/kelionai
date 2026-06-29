import type { FastifyInstance, FastifyReply } from 'fastify'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config, isAllowed, roleFor } from '../config.js'

const SESSION_COOKIE = 'kelionai_session'
const STATE_COOKIE = 'kelionai_oauth_state'

interface SessionUser {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer'
}

function decodeIdToken(idToken: string): { email?: string; email_verified?: boolean; name?: string; picture?: string } {
  const payload = idToken.split('.')[1]
  if (!payload) return {}
  const json = Buffer.from(payload, 'base64url').toString('utf8')
  return JSON.parse(json)
}

function setSession(reply: FastifyReply, user: SessionUser): void {
  const token = jwt.sign(user, config.sessionSecret, { expiresIn: '30d' })
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Step 1 — kick off Google OAuth
  app.get('/auth/google/login', async (_req, reply) => {
    const state = crypto.randomBytes(16).toString('hex')
    reply.setCookie(STATE_COOKIE, state, {
      path: '/',
      httpOnly: true,
      secure: config.isProd,
      sameSite: 'lax',
      maxAge: 600,
    })
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      state,
    })
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  })

  // Step 2 — Google redirects back here with a code
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/google/callback',
    async (req, reply) => {
      const { code, state } = req.query
      const expectedState = req.cookies[STATE_COOKIE]
      reply.clearCookie(STATE_COOKIE, { path: '/' })

      if (!code || !state || !expectedState || state !== expectedState) {
        return reply.redirect(`${config.frontendOrigin}/?error=bad_state`)
      }

      // Exchange the code for tokens (server-to-server, with our secret)
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: config.google.redirectUri,
          grant_type: 'authorization_code',
        }),
      })
      if (!tokenRes.ok) {
        return reply.redirect(`${config.frontendOrigin}/?error=token_exchange`)
      }
      const tokens = (await tokenRes.json()) as { id_token?: string }
      if (!tokens.id_token) {
        return reply.redirect(`${config.frontendOrigin}/?error=no_id_token`)
      }

      const claims = decodeIdToken(tokens.id_token)
      const email = claims.email
      if (!email || claims.email_verified === false) {
        return reply.redirect(`${config.frontendOrigin}/?error=no_email`)
      }

      // The gate: v1 admits only the allowlist.
      if (!isAllowed(email)) {
        return reply.redirect(`${config.frontendOrigin}/?error=closed`)
      }

      setSession(reply, {
        email,
        name: claims.name ?? email,
        picture: claims.picture ?? '',
        role: roleFor(email),
      })
      return reply.redirect(`${config.frontendOrigin}/`)
    },
  )

  // Who am I? (frontend calls this on load)
  app.get('/auth/me', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE]
    if (!token) return reply.code(401).send({ authenticated: false })
    try {
      const user = jwt.verify(token, config.sessionSecret) as SessionUser
      return reply.send({ authenticated: true, user })
    } catch {
      return reply.code(401).send({ authenticated: false })
    }
  })

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })
}
