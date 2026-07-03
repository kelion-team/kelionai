import type { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

export const SESSION_COOKIE = 'kelionai_session'

export interface SessionUser {
  email: string
  name: string
  picture: string
  role: 'admin' | 'customer' | 'demo'
  // Language from the user's Google account (e.g. "ro", "en-GB"). Drives UI language.
  locale: string
  // For a free trial ("demo") session only: the epoch-ms when the 3 minutes end,
  // so the frontend can show a live countdown and the conversion overlay at zero.
  demoUntil?: number
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
    demoUntil: user.demoUntil,
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

// Issue a short-lived free-trial ("demo") session: full access for `seconds`,
// no Google skills, its own throwaway identity. The JWT itself expires a little
// after the trial so the very last request doesn't 401 early.
export function setDemoSession(reply: FastifyReply, seconds: number): void {
  const payload: SessionUser = {
    email: `demo-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}@demo.kelionai.app`,
    name: 'Guest',
    picture: '',
    role: 'demo',
    locale: 'en',
    demoUntil: Date.now() + seconds * 1000,
  }
  const token = jwt.sign(payload, config.sessionSecret, { expiresIn: seconds + 15 })
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: seconds + 15,
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
