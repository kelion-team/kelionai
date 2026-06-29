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
}

export function setSession(reply: FastifyReply, user: SessionUser): void {
  const token = jwt.sign(user, config.sessionSecret, { expiresIn: '30d' })
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
