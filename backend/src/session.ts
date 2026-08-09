import type { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { config, roleFor } from './config.js'

export const SESSION_COOKIE = 'kelionai_session'

export interface SessionUser {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer'
  // Language from the user's Google account (e.g. "ro", "en-GB"). Drives UI language.
  locale: string
  // Google OAuth access token + expiry (ms) for calling Google skills on the
  // user's behalf. The access token is valid ~1h; the refresh token (kept in the
  // signed, httpOnly session cookie) lets the chat route mint a fresh access
  // token transparently so the Google skills keep working past the first hour.
  googleAccessToken?: string
  googleTokenExp?: number
  googleRefreshToken?: string
}

export function setSession(reply: FastifyReply, user: SessionUser): void {
  // `user` may have been read back from a verified JWT (e.g. on token refresh),
  // so it can carry reserved claims (iat/exp/nbf). jsonwebtoken refuses to sign a
  // payload that already has `exp` together with `expiresIn`, so sign ONLY the
  // SessionUser fields — a clean payload regardless of where `user` came from.
  const payload: SessionUser = {
    email: user.email,
    name: user.name,
    picture: user.picture,
    role: user.role,
    locale: user.locale,
    googleAccessToken: user.googleAccessToken,
    googleTokenExp: user.googleTokenExp,
    googleRefreshToken: user.googleRefreshToken,
  }
  const token = jwt.sign(payload, config.sessionSecret, { expiresIn: '30d' })
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })
}

export function getSessionUser(req: FastifyRequest): SessionUser | null {
  // req.cookies is populated by @fastify/cookie on normal HTTP routes. On a
  // WebSocket UPGRADE it may be unparsed (undefined) → `?.` avoids the crash and
  // we fall back to the raw header, so session auth works over WS too.
  let token = req.cookies?.[SESSION_COOKIE]
  if (!token) {
    const raw = req.headers.cookie
    if (raw) {
      const m = raw.match(/(?:^|;\s*)kelionai_session=([^;]+)/)
      if (m) token = decodeURIComponent(m[1])
    }
  }
  if (!token) return null
  try {
    const u = jwt.verify(token, config.sessionSecret) as SessionUser
    // Re-derive the role from the email (W10 #5): the role "frozen" in the JWT
    // stayed admin for 30 days if ADMIN_EMAIL changed — revoking admin had no effect.
    u.role = roleFor(u.email)
    return u
  } catch {
    return null
  }
}

// ── GARDUL „admin + :id întreg pozitiv" — O SINGURĂ DATĂ (jscpd, 3 aug) ──────
// Șablonul „getSessionUser → 403 → Number(:id) → 400" apărea identic în trei
// rute (constructor șterge/reia, cereri neacoperite șterge). Aici e o dată:
// întoarce id-ul valid, sau null DUPĂ ce a scris deja răspunsul de refuz.
export function adminSiId(
  req: FastifyRequest,
  reply: FastifyReply,
  rawId: string,
): number | null {
  const user = getSessionUser(req)
  // 401 pe sesiune moartă, 403 DOAR pe rol — un cookie expirat nu are voie să
  // arate ca „nu ești admin" (9 aug, ownerul: „sistemul dă err 403, ca și cum
  // nu sunt admin" — cauza reală era sesiunea, nu rolul).
  if (!user) {
    void reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  if (user.role !== 'admin') {
    void reply.code(403).send({ error: 'forbidden' })
    return null
  }
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) {
    void reply.code(400).send({ error: 'id_invalid' })
    return null
  }
  return id
}
