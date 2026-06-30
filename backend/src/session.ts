import type { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

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
  const token = req.cookies[SESSION_COOKIE]
  if (!token) return null
  try {
    return jwt.verify(token, config.sessionSecret) as SessionUser
  } catch {
    return null
  }
}
