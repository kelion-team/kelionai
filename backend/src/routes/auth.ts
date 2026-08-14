import type { FastifyInstance, FastifyReply } from 'fastify'
import crypto from 'node:crypto'
import { config, isAllowed, roleFor } from '../config.js'
import { SESSION_COOKIE, getSessionUser, setSession } from '../session.js'
import { isBlocked, saveGoogleRefreshToken, getGoogleRefreshToken } from '../db.js'

const STATE_COOKIE = 'kelionai_oauth_state'

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

function decodeIdToken(idToken: string): { email?: string; email_verified?: boolean; name?: string; picture?: string; locale?: string } {
  const payload = idToken.split('.')[1]
  if (!payload) return {}
  const json = Buffer.from(payload, 'base64url').toString('utf8')
  return JSON.parse(json)
}

// LOGIN = EVERYTHING (Adrian, Jul 25, 0 barriers): the same heavy scopes as
// "Connect Google", asked directly at login. Defined before the routes so both
// /login and /connect use it (the same list, a single source).
const FULL_SCOPES = [
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
  // L1i — EDITARE avansată (Docs + Sheets, 12 aug): citirea mergea prin
  // drive.readonly, dar SCRIEREA are nevoie de scope propriu de scriere.
  // `documents` = creează/editează Google Docs; `spreadsheets` = creează/editează
  // Google Sheets; `drive.file` = creează/gestionează fișierele pe care le face
  // chiar el. Fără ele, create_doc/edit_doc/create_sheet/edit_sheet dau 403 și
  // dispecerul cere reconectarea (un token vechi doar-citire nu poate scrie).
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
  // PRODUSELE ALESE DE OWNER (14 aug, bifate în listă): Slides + Forms.
  // Meet nu cere nimic nou (merge pe scope-ul calendar). Cine s-a conectat
  // ÎNAINTE de scope-urile astea trebuie să se RE-conecteze o dată ca să le
  // acorde — uneltele noi răspund 403 până atunci, iar dispecerul cere
  // reconectarea (același tratament ca la documents/spreadsheets, 12 aug).
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/forms.body',
  // PHOTOS prin Picker API (14 aug, bifat de owner): omul își ALEGE pozele în
  // interfața Google; aplicația vede doar alegerea. Scope-ul vechi
  // photoslibrary.readonly e MORT (șters de Google, 31 mar 2025) — ăsta e cel
  // al Picker-ului, viu.
  'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
  // REMOVED (Aug 2, live probe): 'photoslibrary.readonly' — Google DELETED this
  // scope on 2025-03-31 for every client; the Photos Library API now answers
  // 403 PERMISSION_DENIED even when the scope appears as granted in tokeninfo
  // (verified live). Re-authorization can NOT bring it back. Reading the user's
  // photo library requires migrating to the Google Photos Picker API (a
  // session-based picker flow — a NEW feature, not a scope fix). Keeping the
  // dead scope here would only promise Photos on the consent screen and never
  // deliver it.
  // REMOVED (14 aug, captura LIVE a ownerului): 'youtube.readonly' — Google a
  // început să REFUZE cererea întreagă („Error 400: invalid_request — scopes
  // that cannot be requested together: drive.file, youtube.readonly"), deci
  // scope-ul ăsta bloca TOATĂ conectarea Google. Măsurat în cod înainte de
  // tăiere: NICIUN apel la youtube/v3 cu tokenul OAuth nu există —
  // youtube_search merge pe Serper (serperVideos), redarea pe embed public.
  // Un scope nefolosit care omoară consimțământul e doar pagubă.
  // (`cloud-platform` — cerut pe 4 aug DOAR pentru crearea agenților în consola
  // Gemini Enterprise — a fost SCOS pe 8 aug odată cu toată calea consolei,
  // pe ordinul ownerului: niciun consumator rămas, deci consimțământul nu mai
  // cere acces la tot Google Cloud. TTS/ASR folosesc CONTUL DE SERVICIU cu
  // scope-ul lor propriu — neatinse de lista asta, care e a OMULUI logat.)
].join(' ')

// The shared header of both Google OAuth flows (login + connect): generates
// the state (with an optional "c." prefix for connect, so the shared callback
// knows to KEEP the identity and only attach the tokens), sets the state
// cookie and starts the params with the client identifiers. The two routes
// diverged only in scope/prompt — not in this header, which was copied.
// Single source here (the permanent principle: one, no duplicates).
function beginGoogleOAuth(reply: FastifyReply, statePrefix = ''): { state: string; params: URLSearchParams } {
  const state = statePrefix + crypto.randomBytes(16).toString('hex')
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
  })
  return { state, params }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // Step 1 — kick off Google OAuth
  app.get('/auth/google/login', async (_req, reply) => {
    const { state, params } = beginGoogleOAuth(reply)
    // IDENTITY ONLY at login (Adrian, Jul 25 — he saw live the red "Google
    // hasn't verified this app" screen that scares clients). These 3 scopes are
    // NON-sensitive → Google shows NO warning, any visitor signs in calmly. The
    // heavy skills (Gmail/Calendar/Drive/Tasks/Contacts) stay OPTIONAL, asked
    // on demand through "Connect Google" (only those who want them go through
    // the consent screen). The only way for login to ask for EVERYTHING
    // WITHOUT the red screen is Google APP VERIFICATION (an external process,
    // in Google Cloud Console — the owner's; see the AI-HANDOFF note).
    params.set('scope', 'openid email profile')
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
    return reply.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`)
  })

  // Step 1b — "Connect Google services": incremental consent for the heavy
  // scopes (Gmail read+send, Calendar, Drive, Tasks, Contacts). Only reachable
  // when already signed in. access_type=offline + prompt=consent guarantee a
  // refresh token so the skills keep working long-term. The state is prefixed
  // "c." so the shared callback knows to KEEP the current identity and merely
  // attach the freshly granted tokens.
  const CONNECT_SCOPES = FULL_SCOPES // the same list — a single source
  app.get('/auth/google/connect', async (req, reply) => {
    const user = getSessionUser(req)
    if (!user) {
      return reply.redirect(`${config.frontendOrigin}/?error=closed`)
    }
    const { state, params } = beginGoogleOAuth(reply, 'c.')
    params.set('scope', CONNECT_SCOPES)
    params.set('access_type', 'offline')
    params.set('include_granted_scopes', 'true')
    params.set('prompt', 'consent')
    params.set('login_hint', user.email) // pre-select the account they're signed in as
    params.set('state', state)
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
          stateOk: true, // passed the state check above
          tokenExchangeOk: true, // passed the token exchange above
          gotRefreshFromGoogle: Boolean(tokens.refresh_token),
          sessionExisted: Boolean(existing),
          savedToDb: false,
          error: '',
        }
        if (existing) {
          const refresh = tokens.refresh_token || existing.googleRefreshToken || ''
          // PERSIST the token in the DB (the definitive "I'm logging into
          // Google again" fix): from now on it survives any re-login/deploy,
          // not just the cookie.
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

      // A plain login (identity only) does NOT bring a refresh token from
      // Google. We RESTORE it from the DB, so whoever connected Google once is
      // NOT asked to reconnect after every login (the definitive "fixed 10
      // times" fix).
      const savedRefresh = tokens.refresh_token || (await getGoogleRefreshToken(email))
      if (tokens.refresh_token) void saveGoogleRefreshToken(email, tokens.refresh_token)
      setSession(reply, {
        email,
        name: claims.name ?? email,
        picture: claims.picture ?? '',
        role: roleFor(email),
        locale: claims.locale ?? 'en',
        // NU stocăm access-token-ul de la LOGIN ca token Google (owner, 13 aug:
        // „Kelion nu vede că m-am logat / cere reautorizare"). Login-ul dă DOAR
        // scope-uri de IDENTITATE (email/profil/openid), FĂRĂ Gmail/Calendar.
        // Dacă îl țineam (cu exp în viitor), tura de chat îl credea valid, NU
        // reîmprospăta din refresh-token, iar unealta Gmail îl folosea → 403 →
        // google_not_connected → „reautorizează" (MĂSURAT: get_recent_emails
        // picată deși refresh-token-ul e full-scope și valid). Îl lăsăm GOL (exp 0):
        // tura scoate un access-token cu scope COMPLET din refresh-token-ul salvat.
        googleAccessToken: '',
        googleTokenExp: 0,
        // Refresh token restored from the DB → the Google skills keep working
        // without reconnecting at every login.
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
    // SESIUNE ROSTOGOLITĂ (owner, 14 aug: „kelion a pierdut drepturile de
    // admin… fă ceva să nu se mai poată pierde"). Cookie-ul avea termen FIX
    // de 30 de zile de la LOGIN — expira în mijlocul folosirii și te lăsa
    // „customer" din senin. Ruta asta e bătută la fiecare încărcare a
    // aplicației, deci re-semnăm biletul aici: termenul curge mereu de la
    // ULTIMA vizită. Cine intră măcar o dată pe lună nu mai pierde NICIODATĂ
    // sesiunea (rolul de admin se recalculează oricum din email, la fiecare
    // citire — ăla nu se pierde cât timp sesiunea trăiește).
    setSession(reply, user)
    // GUSTAREA GRATIS (owner, 14 aug): la prima venire a unui cont — pe ORICE
    // cale de intrare (Google, email+parolă, magic link), fiindcă toate trec
    // pe aici la încărcarea aplicației — casa îi dă O SINGURĂ dată creditul de
    // bun-venit, ca zidul de plată să nu-l lovească la PRIMUL mesaj. Nu
    // blochează răspunsul (void) — o alergare pierdută se reia la următoarea
    // încărcare, semnul din kv se scrie doar după acordare.
    void import('../services/bunVenit.js').then((m) => m.acordaBunVenit(user.email)).catch(() => 0)
    // If the current session has no refresh token but the DB has one
    // (connected some time ago), we restore it into the session NOW — without
    // asking you to reconnect Google.
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

}
