import type { FastifyInstance } from 'fastify'
import crypto from 'node:crypto'
import { config, isAllowed, roleFor } from '../config.js'
import { SESSION_COOKIE, getSessionUser, setSession } from '../session.js'
import { isBlocked, saveGoogleRefreshToken, getGoogleRefreshToken } from '../db.js'

const STATE_COOKIE = 'kelionai_oauth_state'

// DIAGNOSTIC conectare Google (Adrian, 10 iul: „nu face ce ai zis"). Reține exact
// ce s-a întâmplat la ultima conectare, ca să știm UNDE pică, nu să ghicim:
// a venit refresh token de la Google? exista sesiune? s-a salvat în DB?
let lastConnectDiag: {
  at: string
  reachedCallback: boolean
  stateOk: boolean
  tokenExchangeOk: boolean
  gotRefreshFromGoogle: boolean
  sessionExisted: boolean
  savedToDb: boolean
  error: string
} = {
  at: '',
  reachedCallback: false,
  stateOk: false,
  tokenExchangeOk: false,
  gotRefreshFromGoogle: false,
  sessionExisted: false,
  savedToDb: false,
  error: 'nicio conectare încă',
}

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
      // LOGARE FULL GOOGLE (Adrian, 24 iul: „la logare trebuie să se logeze full
      // la Google"): dintr-un singur login se acordă TOATE scope-urile (identitate
      // + Gmail/Calendar/Drive/Tasks/Contacts), cu refresh token — nu mai e nevoie
      // de pasul separat „Connect Google". access_type=offline + prompt=consent
      // garantează refresh token-ul pentru ca skill-urile să meargă lung.
      scope: CONNECT_SCOPES,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      state,
    })
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  })

  // Step 1b — "Connect Google services": incremental consent for the heavy
  // scopes (Gmail read+send, Calendar, Drive, Tasks, Contacts). Only reachable
  // when already signed in. access_type=offline + prompt=consent guarantee a
  // refresh token so the skills keep working long-term. The state is prefixed
  // "c." so the shared callback knows to KEEP the current identity and merely
  // attach the freshly granted tokens.
  const CONNECT_SCOPES = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/contacts',
  ].join(' ')
  app.get('/auth/google/connect', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) {
      return reply.redirect(`${config.frontendOrigin}/?error=closed`)
    }
    const state = 'c.' + crypto.randomBytes(16).toString('hex')
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
      scope: CONNECT_SCOPES,
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent',
      login_hint: user.email, // pre-select the account they're signed in as
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
        refresh_token?: string
      }
      if (!tokens.id_token) {
        return reply.redirect(`${config.frontendOrigin}/?error=no_id_token`)
      }

      const claims = decodeIdToken(tokens.id_token)
      const email = claims.email
      if (!email || claims.email_verified === false) {
        return reply.redirect(`${config.frontendOrigin}/?error=no_email`)
      }

      // Incremental "Connect Google" flow (state prefixed "c."): the user is
      // already signed in and is granting the heavy Google scopes. Keep their
      // existing identity and just attach the freshly granted tokens (including
      // the refresh token) so the Google skills start working.
      if (state.startsWith('c.')) {
        const existing = getSessionUser(req)
        lastConnectDiag = {
          at: new Date().toISOString(),
          reachedCallback: true,
          stateOk: true, // am trecut de verificarea de state de mai sus
          tokenExchangeOk: true, // am trecut de schimbul de token de mai sus
          gotRefreshFromGoogle: Boolean(tokens.refresh_token),
          sessionExisted: Boolean(existing),
          savedToDb: false,
          error: '',
        }
        if (existing) {
          const refresh = tokens.refresh_token || existing.googleRefreshToken || ''
          // PERSISTĂ token-ul în DB (fix definitiv „iar loghez Google"): de-acum
          // supraviețuiește oricărei re-logări/deploy, nu doar în cookie.
          if (tokens.refresh_token) {
            void saveGoogleRefreshToken(existing.email, tokens.refresh_token)
              .then(() => {
                lastConnectDiag.savedToDb = true
              })
              .catch(() => {})
          }
          setSession(reply, {
            ...existing,
            googleAccessToken: tokens.access_token ?? existing.googleAccessToken ?? '',
            googleTokenExp: Date.now() + (tokens.expires_in ?? 3600) * 1000,
            googleRefreshToken: refresh,
          })
          return reply.redirect(`${config.frontendOrigin}/?connected=google`)
        }
        // Session expired mid-flow — fall through to a normal login below.
        lastConnectDiag.error = 'sesiunea a expirat în timpul conectării (getSessionUser=null la callback)'
      }

      // The gate: v1 admits only the allowlist.
      if (!isAllowed(email)) {
        return reply.redirect(`${config.frontendOrigin}/?error=closed`)
      }
      // Blocked users are refused (the admin can never be blocked — the block
      // route protects it, but guard here too so the owner is never locked out).
      if (email !== config.adminEmail && (await isBlocked(email))) {
        return reply.redirect(`${config.frontendOrigin}/?error=blocked`)
      }

      // O logare simplă (doar identitate) NU aduce un refresh token de la Google.
      // Îl RESTAURĂM din DB, ca cine a conectat Google o dată să NU mai fie pus
      // să reconecteze după fiecare logare (fix definitiv „reparat de 10 ori").
      const savedRefresh = tokens.refresh_token || (await getGoogleRefreshToken(email))
      if (tokens.refresh_token) void saveGoogleRefreshToken(email, tokens.refresh_token)
      setSession(reply, {
        email,
        name: claims.name ?? email,
        picture: claims.picture ?? '',
        role: roleFor(email),
        locale: claims.locale ?? 'en',
        googleAccessToken: tokens.access_token ?? '',
        googleTokenExp: Date.now() + (tokens.expires_in ?? 3600) * 1000,
        // Refresh token restaurat din DB → skill-urile Google merg în continuare
        // fără reconectare la fiecare logare.
        googleRefreshToken: savedRefresh,
      })
      return reply.redirect(`${config.frontendOrigin}/`)
    },
  )

  // Public: are sales open? The real, DEPLOYED state of the sign-up gate — so
  // "the doors are open" can be verified live, not just promised.
  app.get('/auth/signup-status', async (_req, reply) =>
    reply.send({ open: config.openSignup }),
  )

  // Who am I? (frontend calls this on load). NEVER expose the OAuth tokens to
  // the browser — send only the identity plus a boolean that says whether the
  // heavy Google scopes are connected (drives the "Connect Google" button).
  app.get('/auth/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ authenticated: false })
    // Dacă sesiunea curentă n-are refresh token dar DB-ul îl are (conectat cândva),
    // îl restaurăm în sesiune ACUM — fără să te punem să reconectezi Google.
    let refresh = user.googleRefreshToken || ''
    if (!refresh) {
      refresh = await getGoogleRefreshToken(user.email)
      if (refresh) setSession(reply, { ...user, googleRefreshToken: refresh })
    }
    return reply.send({
      authenticated: true,
      user: {
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
        locale: user.locale,
        googleConnected: Boolean(refresh),
      },
    })
  })

  app.post('/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' })
    return reply.send({ ok: true })
  })

  // DIAGNOSTIC conectare Google (admin) — deschide kelionai.app/auth/google/status
  // DUPĂ ce apeși „Connect Google". Arată EXACT unde pică: a venit refresh de la
  // Google? exista sesiune la callback? s-a salvat în DB? are sesiunea/DB token acum?
  app.get('/auth/google/status', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user || user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
    const dbToken = await getGoogleRefreshToken(user.email)
    return reply.send({
      email: user.email,
      sessionHasRefresh: Boolean(user.googleRefreshToken),
      dbHasRefresh: Boolean(dbToken),
      lastConnectAttempt: lastConnectDiag,
    })
  })
}
