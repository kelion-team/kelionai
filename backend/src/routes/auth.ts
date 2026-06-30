import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { config, isAllowed, roleFor } from '../config.js'
import { SESSION_COOKIE, getSessionUser, setSession } from '../session.js'

const STATE_COOKIE = 'kelionai_oauth_state'

function decodeIdToken(idToken: string): { email?: string; email_verified?: boolean; name?: string; picture?: string; locale?: string } {
  const payload = idToken.split('.')[1]
  if (!payload) return {}
  const json = Buffer.from(payload, 'base64url').toString('utf8')
  return JSON.parse(json)
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
      scope: [
        'openid',
        'email',
        'profile',
        // Calendar read + event create; Gmail read + send; Drive read; Tasks;
        // Contacts read — the skills Kelion can run on the user's behalf.
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/drive.readonly',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/contacts.readonly',
      ].join(' '),
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
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
      const tokens = (await tokenRes.json()) as {
        id_token?: string
        access_token?: string
        expires_in?: number
      }
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
        locale: claims.locale ?? 'en',
        googleAccessToken: tokens.access_token ?? '',
        googleTokenExp: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      })
      return reply.redirect(`${config.frontendOrigin}/`)
    },
  )

  // Who am I? (frontend calls this on load)
  app.get('/auth/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ authenticated: false })
    return reply.send({ authenticated: true, user })
  })

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })
}
