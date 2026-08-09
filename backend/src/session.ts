import type { FastifyReply, FastifyRequest } from 'fastify'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config, roleFor } from './config.js'

// ── REFRESH TOKEN-UL GOOGLE NU CĂLĂTOREȘTE ÎN CLAR (audit 9 aug) ─────────────
// JWT-ul e doar SEMNAT (JWS), nu criptat: payload-ul e base64url, lizibil de
// oricine capturează cookie-ul, fără SESSION_SECRET. Refresh token-ul e o
// credencială de LUNGĂ durată pentru Gmail/Calendar/Drive — de-aia se
// criptează AES-256-GCM (cheie derivată din SESSION_SECRET) înainte să intre
// în payload și se decriptează la citire. Cookie-urile vechi, cu tokenul în
// clar, rămân valabile până expiră (decriptarea le lasă cum sunt).
const cheiaRt = (): Buffer => createHash('sha256').update(`kelionai:rt:${config.sessionSecret}`).digest()
const cripteazaRt = (txt: string): string => {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', cheiaRt(), iv)
  const enc = Buffer.concat([c.update(txt, 'utf8'), c.final()])
  return `enc1:${iv.toString('base64url')}:${enc.toString('base64url')}:${c.getAuthTag().toString('base64url')}`
}
const decripteazaRt = (val: string): string | undefined => {
  if (!val.startsWith('enc1:')) return val // cookie vechi, în clar — acceptat până expiră
  try {
    const [, ivB, encB, tagB] = val.split(':')
    const d = createDecipheriv('aes-256-gcm', cheiaRt(), Buffer.from(ivB, 'base64url'))
    d.setAuthTag(Buffer.from(tagB, 'base64url'))
    return Buffer.concat([d.update(Buffer.from(encB, 'base64url')), d.final()]).toString('utf8')
  } catch {
    return undefined // token de nedescifrat (alt secret?) = ca și absent — nu crăpăm sesiunea
  }
}

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
    // Criptat, nu în clar — vezi antetul. (setSession poate primi userul citit
    // dintr-un JWT vechi cu tokenul necriptat; cripteazaRt îl sigilează atunci.)
    googleRefreshToken: user.googleRefreshToken ? cripteazaRt(user.googleRefreshToken) : undefined,
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
    // Refresh token-ul stă criptat în cookie — consumatorii primesc valoarea
    // REALĂ; una de nedescifrat devine „absent", nu o sesiune moartă.
    if (u.googleRefreshToken) u.googleRefreshToken = decripteazaRt(u.googleRefreshToken)
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
