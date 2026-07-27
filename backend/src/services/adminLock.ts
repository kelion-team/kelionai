import type { FastifyReply, FastifyRequest } from 'fastify'
import crypto from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { loadKv, saveKv } from '../db.js'

// ── LACĂTUL BUTONULUI ADMIN (Adrian, 27 iul: „dacă amprenta nu corespunde,
// nici butonul admin nu trebuie să se activeze") ────────────────────────────
// Al DOILEA factor peste sesiunea de admin: panoul se deschide numai dacă
// (a) amprenta vocală din sesiunea curentă s-a potrivit cu titularul, sau
// (b) s-a tastat secretul de activare — ales și setat DOAR de Adrian, păstrat
// exclusiv ca hash scrypt în kv (nimeni, nici Kelion, nu-l poate citi înapoi).
// Lacătul se ARMEAZĂ abia când secretul există: până atunci comportamentul
// rămâne cel vechi — fără fereastră de auto-blocare între deploy și setare.
// Deblocarea = cookie semnat separat (12h), nu sesiunea de 30 de zile: cine
// fură doar cookie-ul de sesiune tot nu intră în admin.

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

export async function isArmed(): Promise<boolean> {
  return !!(await loadKv(KV_SECRET))
}

export async function setLockSecret(secret: string): Promise<void> {
  await saveKv(KV_SECRET, hashSecret(secret))
}

// Anti-brute-force: 5 încercări / 10 min per email, în memorie (un singur
// proces; la restart contorul se pierde — acceptabil, scrypt e oricum lent).
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

// Deblocarea: JWT propriu (scope dedicat, emailul titularului), cookie separat.
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
