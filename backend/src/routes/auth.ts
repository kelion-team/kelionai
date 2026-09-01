import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import crypto from 'node:crypto'
import { OAuth2Client } from 'google-auth-library'
import { config, isAllowed, roleFor } from '../config.js'
import { oauthFailureRedirect, oauthSuccessRedirect, safeReturnPath } from '../authNavigation.js'
import {
  clearSession,
  createNativeSession,
  getSessionUser,
  isNativeBearerSession,
  revokeNativeBearer,
  sessionTokenHash,
  setSession,
} from '../session.js'
import {
  accountBlockStatus,
  completeNativeAuthRequest,
  consumeNativeAuthCode,
  createNativeAuthRequest,
  createNativeChannelTicket,
  getNativeAuthByHandle,
  getNativeAuthByOauthState,
  getOrCreateClientStorageId,
  saveGoogleRefreshToken,
  getGoogleRefreshToken,
  type NativePlatform,
} from '../db.js'

const STATE_COOKIE = 'kelionai_oauth_state'
const PKCE_COOKIE = 'kelionai_oauth_pkce'
const RETURN_TO_COOKIE = 'kelionai_oauth_return_to'
const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const googleIdentityVerifier = new OAuth2Client(config.google.clientId)

const sha256Hex = (value: string): string => crypto.createHash('sha256').update(value).digest('hex')
const pkceChallenge = (value: string): string => crypto.createHash('sha256').update(value).digest('base64url')
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const PKCE_RE = /^[A-Za-z0-9_-]{43,128}$/

function nativePkceKey(): Buffer {
  return crypto.createHash('sha256')
    .update(`kelion:native-google-pkce:v1:${config.googleTokenEncryptionKey}`)
    .digest()
}

function encryptNativePkce(requestId: string, verifier: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', nativePkceKey(), iv)
  cipher.setAAD(Buffer.from(requestId, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(verifier, 'utf8'), cipher.final()])
  return `v1:${iv.toString('base64url')}:${encrypted.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}`
}

function decryptNativePkce(requestId: string, value: string): string {
  try {
    const [version, iv, encrypted, tag] = value.split(':')
    if (version !== 'v1' || !iv || !encrypted || !tag) return ''
    const decipher = crypto.createDecipheriv('aes-256-gcm', nativePkceKey(), Buffer.from(iv, 'base64url'))
    decipher.setAAD(Buffer.from(requestId, 'utf8'))
    decipher.setAuthTag(Buffer.from(tag, 'base64url'))
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, 'base64url')),
      decipher.final(),
    ]).toString('utf8')
  } catch {
    return ''
  }
}

function nativeOriginAllowed(origin: string | undefined, platform: NativePlatform): boolean {
  if (!origin || !config.product.nativeOrigins.includes(origin)) return false
  return platform === 'ios'
    ? origin === 'capacitor://localhost'
    : origin === 'http://tauri.localhost' || origin === 'tauri://localhost'
}

function nativeRedirectFor(platform: NativePlatform): string {
  return platform === 'constructor-desktop'
    ? config.product.nativeRedirects.constructorDesktop
    : config.product.nativeRedirects[platform]
}

// Google-connect DIAGNOSTIC (Adrian, Jul 10: "it doesn't do what you said").
// Remembers exactly what happened at the last connect, so we know WHERE it
// fails instead of guessing: did a refresh token come from Google? did a
// session exist? was it saved to the DB?
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

type GoogleIdentity = {
  email: string
  name?: string
  picture?: string
  locale?: string
}

/** Verifică criptografic identitatea primită de la Google.
 *
 * Un JWT doar decodat este text controlabil de client, nu autentificare. Clientul
 * oficial verifică semnătura Google, emitentul, expirarea și faptul că tokenul a
 * fost emis pentru GOOGLE_CLIENT_ID-ul acestei aplicații. Acceptăm numai adrese
 * pe care Google le-a marcat explicit ca verificate. */
async function verificaIdentitateGoogle(idToken: string): Promise<GoogleIdentity | null> {
  try {
    const ticket = await googleIdentityVerifier.verifyIdToken({
      idToken,
      audience: config.google.clientId,
    })
    const claims = ticket.getPayload()
    const email = claims?.email?.trim().toLowerCase()
    if (!email || claims?.email_verified !== true) return null
    return {
      email,
      name: claims.name,
      picture: claims.picture,
      locale: claims.locale,
    }
  } catch {
    return null
  }
}

const IDENTITY_SCOPES = ['openid', 'email', 'profile'] as const
const GOOGLE_CAPABILITY_SCOPES = {
  gmail_read: ['https://www.googleapis.com/auth/gmail.readonly'],
  gmail_send: ['https://www.googleapis.com/auth/gmail.send'],
  calendar: ['https://www.googleapis.com/auth/calendar.events'],
  drive: ['https://www.googleapis.com/auth/drive.readonly', 'https://www.googleapis.com/auth/drive.file'],
  docs: ['https://www.googleapis.com/auth/documents', 'https://www.googleapis.com/auth/drive.file'],
  sheets: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
  slides: ['https://www.googleapis.com/auth/presentations', 'https://www.googleapis.com/auth/drive.file'],
  forms: ['https://www.googleapis.com/auth/forms.body', 'https://www.googleapis.com/auth/drive.file'],
  tasks: ['https://www.googleapis.com/auth/tasks'],
  contacts: ['https://www.googleapis.com/auth/contacts'],
  photos: ['https://www.googleapis.com/auth/photospicker.mediaitems.readonly'],
  youtube: ['https://www.googleapis.com/auth/youtube.upload'],
  business: ['https://www.googleapis.com/auth/business.manage'],
} as const
type GoogleCapability = keyof typeof GOOGLE_CAPABILITY_SCOPES

function capabilityScopes(raw: string): string | null {
  const capability = raw.trim().toLowerCase() as GoogleCapability
  const scopes = GOOGLE_CAPABILITY_SCOPES[capability]
  return scopes ? [...IDENTITY_SCOPES, ...scopes].join(' ') : null
}

// The shared header of both Google OAuth flows (login + connect): generates
// the state (with an optional "c." prefix for connect, so the shared callback
// knows to KEEP the identity and only attach the tokens), sets the state
// cookie and starts the params with the client identifiers. The two routes
// diverged only in scope/prompt — not in this header, which was copied.
// Single source here (the permanent principle: one, no duplicates).
function beginGoogleOAuth(reply: FastifyReply, statePrefix = ''): { state: string; params: URLSearchParams } {
  const state = statePrefix + crypto.randomBytes(16).toString('hex')
  const verifier = crypto.randomBytes(32).toString('base64url')
  reply.setCookie(STATE_COOKIE, state, {
    path: '/',
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 600,
  })
  reply.setCookie(PKCE_COOKIE, verifier, {
    path: '/', httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 600,
  })
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    code_challenge: pkceChallenge(verifier),
    code_challenge_method: 'S256',
  })
  return { state, params }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: { platform?: NativePlatform; installId?: string; codeChallenge?: string }
  }>('/auth/native/start', {
    bodyLimit: 2_048,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const platform = req.body?.platform
    const installId = String(req.body?.installId ?? '')
    const codeChallenge = String(req.body?.codeChallenge ?? '')
    if ((platform !== 'ios' && platform !== 'desktop' && platform !== 'constructor-desktop')
      || !nativeOriginAllowed(req.headers.origin, platform)
      || !UUID_RE.test(installId)
      || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      return reply.code(400).send({ error: 'native_request_invalid' })
    }
    const id = crypto.randomUUID()
    const handle = crypto.randomBytes(32).toString('base64url')
    const oauthState = `n.${handle}`
    const clientState = crypto.randomBytes(24).toString('base64url')
    const googleVerifier = crypto.randomBytes(32).toString('base64url')
    try {
      await createNativeAuthRequest({
        id,
        handleHash: sha256Hex(handle),
        oauthStateHash: sha256Hex(oauthState),
        clientState,
        platform,
        installId,
        clientCodeChallenge: codeChallenge,
        googlePkceCipher: encryptNativePkce(id, googleVerifier),
        ttlSeconds: config.nativeAuth.requestTtlSeconds,
      })
    } catch {
      return reply.code(503).send({ error: 'native_auth_unavailable' })
    }
    return reply.send({
      authorizeUrl: `${config.publicOrigin}/auth/native/authorize?request=${encodeURIComponent(handle)}`,
      state: clientState,
      expiresIn: config.nativeAuth.requestTtlSeconds,
    })
  })

  app.get<{ Querystring: { request?: string } }>('/auth/native/authorize', async (req, reply) => {
    const handle = String(req.query?.request ?? '')
    if (!/^[A-Za-z0-9_-]{43}$/.test(handle)) return reply.code(400).send({ error: 'native_request_invalid' })
    const pending = await getNativeAuthByHandle(sha256Hex(handle)).catch(() => null)
    if (!pending) return reply.code(410).send({ error: 'native_request_expired' })
    const state = `n.${handle}`
    reply.setCookie(STATE_COOKIE, state, {
      path: '/', httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: config.nativeAuth.requestTtlSeconds,
    })
    const googleVerifier = decryptNativePkce(pending.id, pending.googlePkceCipher)
    if (!googleVerifier) return reply.code(503).send({ error: 'native_auth_unavailable' })
    const params = new URLSearchParams({
      client_id: config.google.clientId,
      redirect_uri: config.google.redirectUri,
      response_type: 'code',
      scope: IDENTITY_SCOPES.join(' '),
      prompt: 'select_account',
      max_age: '0',
      state,
      code_challenge: pkceChallenge(googleVerifier),
      code_challenge_method: 'S256',
    })
    return reply.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`)
  })

  app.get('/auth/native/complete', async (_req, reply) => {
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('Cache-Control', 'no-store')
    return reply.type('text/html; charset=utf-8').send(
      '<!doctype html><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Kelionai</title><p>Revino în aplicația Kelionai pentru a finaliza conectarea.</p>',
    )
  })

  app.post<{
    Body: { platform?: NativePlatform; installId?: string; code?: string; state?: string; verifier?: string }
  }>('/auth/native/exchange', {
    bodyLimit: 4_096,
    config: { rateLimit: { max: 10, timeWindow: '10 minutes' } },
  }, async (req, reply) => {
    const platform = req.body?.platform
    const installId = String(req.body?.installId ?? '')
    const code = String(req.body?.code ?? '')
    const state = String(req.body?.state ?? '')
    const verifier = String(req.body?.verifier ?? '')
    if ((platform !== 'ios' && platform !== 'desktop' && platform !== 'constructor-desktop')
      || !nativeOriginAllowed(req.headers.origin, platform)
      || !UUID_RE.test(installId)
      || !/^[A-Za-z0-9_-]{43}$/.test(code)
      || !/^[A-Za-z0-9_-]{32}$/.test(state)
      || !PKCE_RE.test(verifier)) {
      return reply.code(400).send({ error: 'native_exchange_invalid' })
    }
    let identity: Awaited<ReturnType<typeof consumeNativeAuthCode>>
    try {
      identity = await consumeNativeAuthCode({
        exchangeCodeHash: sha256Hex(code),
        clientState: state,
        platform,
        installId,
        clientCodeChallenge: pkceChallenge(verifier),
      })
    } catch {
      return reply.code(503).send({ error: 'native_auth_unavailable' })
    }
    if (!identity) return reply.code(400).send({ error: 'native_exchange_invalid_or_expired' })
    if (!isAllowed(identity.email)) return reply.code(403).send({ error: 'closed' })
    const block = await accountBlockStatus(identity.email)
    if (!block.available) return reply.code(503).send({ error: 'account_status_unavailable' })
    if (block.blocked) return reply.code(403).send({ error: 'blocked' })
    const token = await createNativeSession({
      email: identity.email,
      name: identity.name || identity.email,
      picture: identity.picture,
      role: roleFor(identity.email),
      authProvider: 'google',
      locale: identity.locale || 'en',
    }, installId)
    return reply.send({
      ...token,
      user: {
        email: identity.email,
        name: identity.name || identity.email,
        picture: identity.picture,
        role: roleFor(identity.email),
        locale: identity.locale || 'en',
      },
    })
  })

  app.post<{ Body: { audience?: 'vocal-live' | 'apel' | 'deploy-status' } }>(
    '/api/auth/native/channel-ticket',
    { bodyLimit: 1_024, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const user = getSessionUser(req)
      const hash = sessionTokenHash(req)
      const audience = req.body?.audience
      if (!user || !hash || !isNativeBearerSession(req)) return reply.code(401).send({ error: 'native_bearer_required' })
      if (audience !== 'vocal-live' && audience !== 'apel' && audience !== 'deploy-status') {
        return reply.code(400).send({ error: 'audience_invalid' })
      }
      if (audience === 'deploy-status' && user.role !== 'admin') return reply.code(403).send({ error: 'forbidden' })
      const ticket = crypto.randomBytes(32).toString('base64url')
      try {
        await createNativeChannelTicket({
          ticketHash: sha256Hex(ticket), sessionTokenHash: hash, audience,
          ttlSeconds: config.nativeAuth.channelTicketTtlSeconds,
        })
      } catch {
        return reply.code(503).send({ error: 'channel_ticket_unavailable' })
      }
      return reply.send({ ticket, protocol: 'kelion-native', expiresIn: config.nativeAuth.channelTicketTtlSeconds })
    },
  )

  // Step 1 — kick off Google OAuth
  app.get<{ Querystring: { next?: string } }>('/auth/google/login', async (req, reply) => {
    const { state, params } = beginGoogleOAuth(reply)
    // Preserve only a known client route. The callback must never be allowed to
    // redirect a signed-in user to a URL supplied by somebody else.
    reply.setCookie(RETURN_TO_COOKIE, safeReturnPath(req.query?.next), {
      path: '/', httpOnly: true, secure: config.isProd, sameSite: 'lax', maxAge: 600,
    })
    // IDENTITY ONLY at login (Adrian, Jul 25 — he saw live the red "Google
    // hasn't verified this app" screen that scares clients). These 3 scopes are
    // NON-sensitive → Google shows NO warning, any visitor signs in calmly. The
    // heavy skills (Gmail/Calendar/Drive/Tasks/Contacts) stay OPTIONAL, asked
    // on demand through "Connect Google" (only those who want them go through
    // the consent screen). The only way for login to ask for EVERYTHING
    // WITHOUT the red screen is Google APP VERIFICATION (an external process,
    // in Google Cloud Console — the owner's configured OAuth application).
    params.set('scope', IDENTITY_SCOPES.join(' '))
    // THE FULL PROCEDURE AT LOGIN (Adrian, Jul 26: "not automatic, it must do
    // the full procedure, ask for user and pass").
    // Without these, a browser with an active Google session jumped STRAIGHT
    // into the account:
    //  • select_account → Google ALWAYS shows the account chooser;
    //  • max_age=0 → Google asks for RE-AUTHENTICATION (user + password/pin),
    //    it doesn't settle for the old session.
    // Whoever has NO Google account: Google's screen has its own "Create
    // account" — they make it right in the flow; no other login exists (the
    // app is Google-only by decision).
    params.set('prompt', 'select_account')
    params.set('max_age', '0')
    params.set('state', state)
    return reply.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`)
  })

  // Step 1b — "Connect Google services": incremental consent for the heavy
  // scopes (Gmail read+send, Calendar, Drive, Tasks, Contacts). Only reachable
  // when already signed in. access_type=offline + prompt=consent guarantee a
  // refresh token so the skills keep working long-term. The state is prefixed
  // "c." so the shared callback knows to KEEP the current identity and merely
  // attach the freshly granted tokens.
  // UN SINGUR început de consimțământ incremental pentru ambele porți (jscpd):
  // access_type=offline + prompt=consent garantează refresh token; state „c."
  // spune callback-ului comun să PĂSTREZE identitatea și doar să atașeze tokenii.
  const consimtamantIncremental = (req: FastifyRequest, reply: FastifyReply, scope: string): unknown => {
    const user = getSessionUser(req)
    if (!user) {
      return reply.redirect(`${config.frontendOrigin}/?error=closed`)
    }
    const { state, params } = beginGoogleOAuth(reply, 'c.')
    params.set('scope', scope)
    params.set('access_type', 'offline')
    params.set('include_granted_scopes', 'true')
    params.set('prompt', 'consent')
    params.set('login_hint', user.email) // pre-select the account they're signed in as
    params.set('state', state)
    return reply.redirect(`${GOOGLE_AUTHORIZE_URL}?${params.toString()}`)
  }
  app.get<{ Querystring: { capability?: string } }>('/auth/google/connect', async (req, reply) => {
    const scopes = capabilityScopes(String(req.query?.capability ?? ''))
    if (!scopes) return reply.code(400).send({ error: 'capability_required' })
    return consimtamantIncremental(req, reply, scopes)
  })

  // Step 2 — Google redirects back here with a code
  app.get<{ Querystring: { code?: string; state?: string } }>(
    '/auth/google/callback',
    async (req, reply) => {
      const { code, state } = req.query
      const expectedState = req.cookies[STATE_COOKIE]
      const browserPkceVerifier = req.cookies[PKCE_COOKIE]
      const returnTo = safeReturnPath(req.cookies[RETURN_TO_COOKIE])
      reply.clearCookie(STATE_COOKIE, { path: '/' })
      reply.clearCookie(PKCE_COOKIE, { path: '/' })
      reply.clearCookie(RETURN_TO_COOKIE, { path: '/' })

      const fail = (reason: string): FastifyReply => reply.redirect(oauthFailureRedirect(config.frontendOrigin, reason))

      if (!code || !state || !expectedState || state !== expectedState) {
        return fail('bad_state')
      }

      const nativeRequest = state.startsWith('n.')
        ? await getNativeAuthByOauthState(sha256Hex(state)).catch(() => null)
        : null
      if (state.startsWith('n.') && !nativeRequest) {
        return fail('native_request_expired')
      }
      const codeVerifier = nativeRequest
        ? decryptNativePkce(nativeRequest.id, nativeRequest.googlePkceCipher)
        : (typeof browserPkceVerifier === 'string' && PKCE_RE.test(browserPkceVerifier) ? browserPkceVerifier : '')
      if (!codeVerifier) return fail('bad_state')

      // Exchange the code for tokens (server-to-server, with PKCE and client secret).
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.google.clientId,
          client_secret: config.google.clientSecret,
          redirect_uri: config.google.redirectUri,
          grant_type: 'authorization_code',
          code_verifier: codeVerifier,
        }),
      })
      if (!tokenRes.ok) {
        return fail('token_exchange')
      }
      const tokens = (await tokenRes.json()) as {
        id_token?: string
        access_token?: string
        expires_in?: number
        refresh_token?: string
        scope?: string
      }
      if (!tokens.id_token) {
        return fail('no_id_token')
      }

      const identity = await verificaIdentitateGoogle(tokens.id_token)
      if (!identity) {
        return fail('invalid_identity')
      }
      const email = identity.email

      if (nativeRequest) {
        if (!isAllowed(email)) return fail('closed')
        const block = await accountBlockStatus(email)
        if (!block.available) return reply.code(503).send({ error: 'account_status_unavailable' })
        if (block.blocked) return fail('blocked')
        const exchangeCode = crypto.randomBytes(32).toString('base64url')
        const completed = await completeNativeAuthRequest({
          id: nativeRequest.id,
          email,
          name: identity.name ?? email,
          picture: identity.picture ?? '',
          locale: identity.locale ?? 'en',
          exchangeCodeHash: sha256Hex(exchangeCode),
          exchangeTtlSeconds: config.nativeAuth.exchangeTtlSeconds,
        }).catch(() => false)
        if (!completed) return fail('native_request_expired')
        const redirect = new URL(nativeRedirectFor(nativeRequest.platform))
        redirect.searchParams.set('code', exchangeCode)
        redirect.searchParams.set('state', nativeRequest.clientState)
        return reply.redirect(redirect.toString())
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
          stateOk: true, // passed the state check above
          tokenExchangeOk: true, // passed the token exchange above
          gotRefreshFromGoogle: Boolean(tokens.refresh_token),
          sessionExisted: Boolean(existing),
          savedToDb: false,
          error: '',
        }
        if (existing) {
          // Incremental consent may never attach account B's credentials to
          // account A's authenticated session.
          if (existing.email.toLowerCase() !== email) {
            lastConnectDiag.error = 'identitatea Google nu corespunde sesiunii curente'
            return fail('account_mismatch')
          }
          if (!tokens.refresh_token) {
            lastConnectDiag.error = 'Google nu a emis refresh token'
            return fail('no_refresh_token')
          }
          try {
            await saveGoogleRefreshToken(existing.email, tokens.refresh_token, tokens.scope ?? '')
            lastConnectDiag.savedToDb = true
          } catch {
            lastConnectDiag.error = 'credentiala nu a putut fi salvată sigur'
            return fail('token_store')
          }
          return reply.redirect(oauthSuccessRedirect(config.frontendOrigin, '/'))
        }
        // A capability grant is bound to the session that started it. Never
        // reinterpret an expired connect flow as a fresh login.
        lastConnectDiag.error = 'sesiunea a expirat în timpul conectării (getSessionUser=null la callback)'
        return fail('session_expired')
      }

      // The gate: v1 admits only the allowlist.
      if (!isAllowed(email)) {
        return fail('closed')
      }
      const block = await accountBlockStatus(email)
      if (!block.available) return reply.code(503).send({ error: 'account_status_unavailable' })
      if (block.blocked) {
        return fail('blocked')
      }

      // A plain login (identity only) does NOT bring a refresh token from
      // Google. We RESTORE it from the DB, so whoever connected Google once is
      // NOT asked to reconnect after every login (the definitive "fixed 10
      // times" fix).
      if (tokens.refresh_token) {
        try {
          await saveGoogleRefreshToken(email, tokens.refresh_token, tokens.scope ?? '')
        } catch {
          return fail('token_store')
        }
      }
      await setSession(reply, {
        email,
        name: identity.name ?? email,
        picture: identity.picture ?? '',
        role: roleFor(email),
        authProvider: 'google',
        locale: identity.locale ?? 'en',
      })
      return reply.redirect(oauthSuccessRedirect(config.frontendOrigin, returnTo))
    },
  )

  // Who am I? (frontend calls this on load). NEVER expose the OAuth tokens to
  // the browser — send only the identity plus a boolean that says whether the
  // heavy Google scopes are connected (drives the "Connect Google" button).
  app.get('/auth/me', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) return reply.code(401).send({ authenticated: false })
    // GUSTAREA GRATIS (owner, 14 aug): la prima venire a unui cont — pe ORICE
    // cale de intrare (Google, email+parolă, magic link), fiindcă toate trec
    // pe aici la încărcarea aplicației — casa îi dă O SINGURĂ dată creditul de
    // bun-venit, ca zidul de plată să nu-l lovească la PRIMUL mesaj. Nu
    // blochează răspunsul (void) — o alergare pierdută se reia la următoarea
    // încărcare, semnul din kv se scrie doar după acordare.
    void import('../services/bunVenit.js').then((m) => m.acordaBunVenit(user.email)).catch(() => 0)
    const [refresh, clientStorageId] = await Promise.all([
      getGoogleRefreshToken(user.email),
      getOrCreateClientStorageId(user.email),
    ])
    return reply.send({
      authenticated: true,
      user: {
        email: user.email,
        name: user.name,
        picture: user.picture,
        role: user.role,
        locale: user.locale,
        googleConnected: Boolean(refresh),
        clientStorageId,
      },
    })
  })

  app.post('/auth/logout', async (req, reply) => {
    await clearSession(req, reply)
    return reply.send({ ok: true })
  })

  app.post('/auth/native/logout', async (req, reply) => {
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : ''
    if (!config.product.nativeOrigins.includes(origin)) {
      return reply.code(403).send({ error: 'origin_not_allowed' })
    }
    if (!await revokeNativeBearer(req)) {
      return reply.code(401).send({ error: 'invalid_native_bearer' })
    }
    return reply.code(204).send()
  })

}
