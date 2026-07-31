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

// ── „TOCMAI MI-A VORBIT, ȘI L-AM RECUNOSCUT" ────────────────────────────────
//
// Adrian, 31 iul: „să opereze pentru mine când îi cer doar eu, folosind
// sistemul de recunoaștere vocală, ca securitate sporită."
//
// Cookie-ul de deblocare merge pe rutele care au cererea în mână. Uneltele
// creierului nu o au — și nici nu vreau s-o car prin zece semnături ca să
// ajungă acolo. Aici ținem minte, pe server, CÂND s-a potrivit ultima dată
// amprenta vocală a titularului. Operațiile care ating un instrument de plată
// cer fereastra asta: nu „ai fost admin cândva", ci „ești tu, ai vorbit ACUM".
//
// Fereastra e scurtă dinadins. Un cod tastat rămâne valabil cât ține cookie-ul;
// vocea trebuie să fie proaspătă, altfel garda n-ar însemna nimic.
const VOCE_TTL_MS = 15 * 60_000
const voceLa = new Map<string, number>()

/** Amprenta vocală a titularului tocmai s-a potrivit (chemat din ruta vocii). */
export function marcheazaVoce(email: string): void {
  voceLa.set(email.trim().toLowerCase(), Date.now())
}

/** A vorbit — și l-am recunoscut — în ultimele 15 minute? */
export function voceRecenta(email: string): boolean {
  const t = voceLa.get(email.trim().toLowerCase())
  return !!t && Date.now() - t < VOCE_TTL_MS
}

/** Închide fereastra ACUM, fără să aștepte cele 15 minute.
 *  Ownerul spune „gata" → poarta se închide în clipa aia, nu când expiră ea. */
export function uitaVocea(email: string): void {
  voceLa.delete(email.trim().toLowerCase())
}

/** Câte minute mai ține fereastra (pentru mesaje pe înțelesul omului). */
export function minuteRamaseVoce(email: string): number {
  const t = voceLa.get(email.trim().toLowerCase())
  if (!t) return 0
  return Math.max(0, Math.ceil((VOCE_TTL_MS - (Date.now() - t)) / 60_000))
}

/** Deblocat PRIN VOCE, nu prin secret tastat (Adrian, 31 iul: „să opereze
 *  pentru mine când îi cer doar eu, folosind sistemul de recunoaștere vocală,
 *  ca securitate sporită").
 *
 *  Diferența e reală: un secret tastat poate fi furat, citit peste umăr sau
 *  scos dintr-un cookie. Amprenta vocală cere să fii TU, acolo, vorbind. De-aia
 *  operațiile care ating instrumente de plată cer ANUME metoda asta — nu doar
 *  „ești admin", ci „ești tu, și tocmai ai vorbit".
 *
 *  `method` era deja pus în token de `grantUnlock`, dar nimeni nu-l citea. */
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

/** Tokenul de deblocare, din cookie sau din antet (una singură, folosită de
 *  ambele verificări — altfel cele două ar diverge tăcut). */
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
