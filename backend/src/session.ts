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
  // ── TEST-AUTH (owner, 23 aug 2026: „trebuie gasita modalitate prin care sa
  //    nu mai zici doar tu poti sa faci asta") — permite agenților AI să
  //    testeze rutele cu auth FĂRĂ cookie de admin. Mecanism:
  //    1. Header `x-test-auth: <token>` în request
  //    2. Token-ul vine din env `TEST_AUTH_TOKEN` (setat pe VPS via GitHub Secrets)
  //    3. Dacă matchează → autentific ca admin (adrianenc11@gmail.com)
  //    4. Dacă env nu e setat → mecanism INACTIV (zero risc pe producție fără token)
  //    5. Token-ul NU e în cod, NU e în repo — doar în env pe VPS.
  const testToken = process.env.TEST_AUTH_TOKEN
  if (testToken && typeof req.headers['x-test-auth'] === 'string') {
    if (req.headers['x-test-auth'] === testToken) {
      return {
        email: config.adminEmail,
        name: 'Adrian (test)',
        picture: '',
        role: 'admin',
        locale: 'ro',
      }
    }
  }
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

// ── GARDUL „ești admin?" — O SINGURĂ DATĂ (jscpd, 10 aug) ────────────────────
// Preambulul „citește sesiunea → 401 dacă e moartă → 403 dacă nu e admin" era
// copiat identic în 54 de rute din admin.ts (poarta jscpd îl prindea). Aici, o
// dată: întoarce userul sau `null` DUPĂ ce a trimis răspunsul de eroare. 401 pe
// sesiune moartă ≠ 403 pe rol (regula 9 aug: un cookie expirat nu are voie să
// arate ca „nu ești admin").
// ── LEGITIMAȚIA DE SERVICIU A LUI KELION — ADMIN 2 (P9) ─────────────────────
// (owner, 15 aug: „kelion in continuare nu are acces la panoul de control si
// la restul, raporteaza de ce nu are acces ca admin 2?")
//
// MĂSURAT atunci: accesul lui la panou era ÎMPRUMUTAT din cookie-ul sesiunii
// ownerului, iar pe voce (vocalLive) și în bucla autonomă (autonomie.ts)
// cookie-ul nu se transmitea → admin_vezi primea 403 exact când lucra ca
// admin 2. Legitimația de aici e a LUI: un token aleator pe viața procesului,
// care NU părăsește niciodată procesul (adminVedere îl pune pe fetch-urile
// către bucla locală) și e acceptat DOAR de pe loopback — se verifică
// adresa REALĂ a socketului (req.socket.remoteAddress), nu req.ip, care sub
// trustProxy ar crede antetul X-Forwarded-For al oricui.
// Rutele care mișcă bani / restaurează baza rămân ale ownerului — poarta aia
// stă în adminVedere (DOAR_OWNERUL) și nu se atinge de legitimația asta.
import { randomBytes as octetiAleatori } from 'node:crypto'
export const TOKEN_ADMIN_INTERN = octetiAleatori(32).toString('hex')
const KELION_ADMIN_INTERN: SessionUser = {
  email: 'kelion@kelionai.app', // apare în audit ca EL, nu ca ownerul
  name: 'Kelion (admin 2)',
  picture: '',
  role: 'admin',
  locale: 'ro',
}
const deLoopback = (req: FastifyRequest): boolean =>
  /^(127\.|::1$|::ffff:127\.)/.test(String(req.socket?.remoteAddress ?? ''))

export function cerAdmin(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const user = getSessionUser(req)
  if (!user) {
    const intern = req.headers['x-kelion-intern']
    if (typeof intern === 'string' && intern.length > 0 && intern === TOKEN_ADMIN_INTERN && deLoopback(req)) {
      return KELION_ADMIN_INTERN
    }
    void reply.code(401).send({ error: 'unauthorized' })
    return null
  }
  if (user.role !== 'admin') {
    void reply.code(403).send({ error: 'forbidden' })
    return null
  }
  return user
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
  // Gardul de admin, o singură sursă (cerAdmin) — 401 pe sesiune moartă, 403 pe rol.
  if (!cerAdmin(req, reply)) return null
  const id = Number(rawId)
  if (!Number.isInteger(id) || id <= 0) {
    void reply.code(400).send({ error: 'id_invalid' })
    return null
  }
  return id
}
