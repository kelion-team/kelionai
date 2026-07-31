import type { FastifyReply, FastifyRequest } from 'fastify'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'

// ── THE ADMIN BUTTON PADLOCK (Adrian, Jul 27: "if the voiceprint doesn't
// match, the admin button must not activate either") ────────────────────────
// The SECOND factor on top of the admin session: the panel opens only if
// (a) the voiceprint from the current session matched the owner, or
// (b) the activation secret was typed — chosen and set ONLY by Adrian, kept
// exclusively as a scrypt hash in kv (nobody, not even Kelion, can read it
// back). The padlock ARMS only once the secret exists: until then the old
// behavior stands — no self-lockout window between deploy and setup.
// Unlock = a separately signed cookie (12h), not the 30-day session: whoever
// steals only the session cookie still doesn't get into admin.

const KV_SECRET = 'admin_lock_secret'
export const ADMIN_UNLOCK_COOKIE = 'kelionai_admin_unlock'
const UNLOCK_TTL_SEC = 12 * 60 * 60

function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.scryptSync(secret, salt, 64, { N: 16384 }).toString('hex')
  return `${salt}:${hash}`
}

function verifyHash(secret: string, stored: string): boolean {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const probe = crypto.scryptSync(secret, salt, 64, { N: 16384 })
  const ref = Buffer.from(hash, 'hex')
  return probe.length === ref.length && crypto.timingSafeEqual(probe, ref)
}

// ── DISARMED BY THE OWNER (Adrian, Jul 31) ──────────────────────────────────
// "please remove the approval completely, there's nobody next to me to give
// orders".
//
// The padlock was designed on Jul 27 against a specific threat: somebody
// ELSE — a voice near the microphone, a stolen session cookie. Adrian says
// that threat doesn't exist for him: he is alone, the only admin, the only
// one giving orders. A second factor that guards against nobody is just a
// tax on every entry into his own application.
//
// A single disarm point, on purpose: all gates (chat, voice, /api/admin/*)
// ask `isArmed()`. A `false` here opens them all at once — and, more
// importantly, everything RE-ARMS from a single place too, without hunting
// six call sites. The rest of the mechanism (secret, scrypt hash, 12h cookie,
// anti-brute-force) stays intact underneath.
//
// TO RE-ARM: `LACAT_DEZARMAT = false`. That's all. The secret in kv is still
// there; the padlock becomes active again the moment you flip the line.
//
// WHAT IS LOST, written down so it isn't forgotten: the admin session becomes
// the only factor everywhere. Whoever reaches it — stolen cookie, open laptop,
// compromised email account — reaches the source code, the secrets, the
// database and the money, without a second question. A compromise explicitly
// requested, twice, with the risk stated each time.
const LACAT_DEZARMAT = true

export async function isArmed(): Promise<boolean> {
  if (LACAT_DEZARMAT) return false
  return !!(await loadKv(KV_SECRET))
}

export async function setLockSecret(secret: string): Promise<void> {
  await saveKv(KV_SECRET, hashSecret(secret))
}

// Anti-brute-force: 5 attempts / 10 min per email, in memory (a single
// process; on restart the counter is lost — acceptable, scrypt is slow anyway).
const attempts = new Map<string, { count: number; resetAt: number }>()

export async function verifyLockSecret(email: string, secret: string): Promise<boolean> {
  const now = Date.now()
  const a = attempts.get(email)
  if (a && now < a.resetAt && a.count >= 5) return false
  const stored = await loadKv(KV_SECRET)
  const ok = !!stored && verifyHash(secret, stored)
  if (ok) attempts.delete(email)
  else {
    if (!a || now >= a.resetAt) attempts.set(email, { count: 1, resetAt: now + 10 * 60_000 })
    else a.count += 1
  }
  return ok
}

// The unlock: its own JWT (dedicated scope, the owner's email), separate cookie.
export function grantUnlock(reply: FastifyReply, email: string, method: 'voce' | 'secret'): void {
  const token = jwt.sign({ scope: 'admin-unlock', email, method }, config.sessionSecret, {
    expiresIn: UNLOCK_TTL_SEC,
  })
  reply.setCookie(ADMIN_UNLOCK_COOKIE, token, {
    path: '/',
    httpOnly: true,
    secure: config.isProd,
    sameSite: 'lax',
    maxAge: UNLOCK_TTL_SEC,
  })
}

// ── "HE JUST SPOKE TO ME, AND I RECOGNISED HIM" ─────────────────────────────
//
// Adrian, Jul 31: "it should operate for me when only I ask it, using the
// voice recognition system, as heightened security."
//
// The unlock cookie works on routes that hold the request. The brain's tools
// don't have it — and I don't want to carry it through ten signatures to get
// there. Here we remember, on the server, WHEN the owner's voiceprint last
// matched. Operations that touch a payment instrument require this window:
// not "you were admin once", but "it's you, you spoke NOW".
//
// The window is short on purpose. A typed code stays valid as long as the
// cookie lasts; the voice must be fresh, otherwise the guard would mean
// nothing.
const VOCE_TTL_MS = 15 * 60_000
const voceLa = new Map<string, number>()

/** The owner's voiceprint just matched (called from the voice route). */
export function marcheazaVoce(email: string): void {
  voceLa.set(email.trim().toLowerCase(), Date.now())
}

/** He spoke — and we recognised him — within the last 15 minutes? */
export function voceRecenta(email: string): boolean {
  const t = voceLa.get(email.trim().toLowerCase())
  return !!t && Date.now() - t < VOCE_TTL_MS
}

/** Close the window NOW, without waiting out the 15 minutes.
 *  The owner says "done" → the gate closes that instant, not when it expires. */
export function uitaVocea(email: string): void {
  voceLa.delete(email.trim().toLowerCase())
}

/** How many minutes the window has left (for human-readable messages). */
export function minuteRamaseVoce(email: string): number {
  const t = voceLa.get(email.trim().toLowerCase())
  if (!t) return 0
  return Math.max(0, Math.ceil((VOCE_TTL_MS - (Date.now() - t)) / 60_000))
}

/** Unlocked BY VOICE, not by a typed secret (Adrian, Jul 31: "it should
 *  operate for me when only I ask it, using the voice recognition system, as
 *  heightened security").
 *
 *  The difference is real: a typed secret can be stolen, read over a shoulder
 *  or pulled from a cookie. The voiceprint requires you to be YOU, there,
 *  speaking. That's why operations touching payment instruments demand exactly
 *  this method — not just "you are admin", but "it's you, and you just spoke".
 *
 *  `method` was already put into the token by `grantUnlock`, but nobody read it. */
export function hasVoiceUnlock(req: FastifyRequest, email: string): boolean {
  const token = tokenUnlock(req)
  if (!token) return false
  try {
    const p = jwt.verify(token, config.sessionSecret) as { scope?: string; email?: string; method?: string }
    return p.scope === 'admin-unlock' && p.email === email && p.method === 'voce'
  } catch {
    return false
  }
}

/** The unlock token, from the cookie or the header (a single one, used by both
 *  checks — otherwise the two would silently diverge). */
function tokenUnlock(req: FastifyRequest): string | undefined {
  const c = req.cookies?.[ADMIN_UNLOCK_COOKIE]
  if (c) return c
  const raw = req.headers.cookie
  if (!raw) return undefined
  const m = raw.match(/(?:^|;\s*)kelionai_admin_unlock=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : undefined
}

export function hasUnlock(req: FastifyRequest, email: string): boolean {
  let token = req.cookies?.[ADMIN_UNLOCK_COOKIE]
  if (!token) {
    const raw = req.headers.cookie
    if (raw) {
      const m = raw.match(/(?:^|;\s*)kelionai_admin_unlock=([^;]+)/)
      if (m) token = decodeURIComponent(m[1])
    }
  }
  if (!token) return false
  try {
    const p = jwt.verify(token, config.sessionSecret) as { scope?: string; email?: string }
    return p.scope === 'admin-unlock' && p.email === email
  } catch {
    return false
  }
}
