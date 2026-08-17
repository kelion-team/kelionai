// ── P9: LEGITIMAȚIA DE SERVICIU A LUI KELION (ADMIN 2) ──────────────────────
// (owner, 15 aug: „kelion in continuare nu are acces la panoul de control si
// la restul, raporteaza de ce nu are acces ca admin 2?")
//
// MĂSURAT atunci: accesul lui era împrumutat din cookie-ul ownerului; pe voce
// (vocalLive.ts:1022) și în bucla autonomă (autonomie.ts:664) cookie-ul nu se
// transmitea → admin_vezi lovea 403 exact când lucra ca admin 2. Acum are
// legitimația LUI: token pe viața procesului + doar de pe loopback.
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

const { cerAdmin, TOKEN_ADMIN_INTERN } = await import('./session.js')

type Cerere = { headers: Record<string, string>; socket: { remoteAddress: string } }
const raspuns = () => {
  const r = { cod: 0, code: (c: number) => { r.cod = c; return r }, send: () => r }
  return r
}
const cere = (headers: Record<string, string>, ip: string): Cerere => ({ headers, socket: { remoteAddress: ip } })

describe('cerAdmin: legitimația internă, doar de pe loopback', () => {
  it('token corect + loopback → Kelion e admin 2, cu emailul LUI în audit', () => {
    const r = raspuns()
    const u = cerAdmin(cere({ 'x-kelion-intern': TOKEN_ADMIN_INTERN }, '127.0.0.1') as never, r as never)
    expect(u?.role).toBe('admin')
    expect(u?.email).toBe('kelion@kelionai.app')
    expect(r.cod).toBe(0)
  })

  it('tokenul corect de pe o adresă NE-loopback e refuzat cu 401 — legitimația nu călătorește', () => {
    const r = raspuns()
    const u = cerAdmin(cere({ 'x-kelion-intern': TOKEN_ADMIN_INTERN }, '203.0.113.7') as never, r as never)
    expect(u).toBe(null)
    expect(r.cod).toBe(401)
  })

  it('token greșit sau lipsă de pe loopback → 401, ca înainte', () => {
    const r1 = raspuns()
    expect(cerAdmin(cere({ 'x-kelion-intern': 'fals' }, '127.0.0.1') as never, r1 as never)).toBe(null)
    expect(r1.cod).toBe(401)
    const r2 = raspuns()
    expect(cerAdmin(cere({}, '127.0.0.1') as never, r2 as never)).toBe(null)
    expect(r2.cod).toBe(401)
  })
})

describe('lanțul legitimației, în sursă', () => {
  it('adminVedere pune legitimația pe AMBELE fetch-uri (vezi + schimbă), lângă cookie', () => {
    const vedere = citeste('services/adminVedere.ts')
    const legitimatii = vedere.match(/'x-kelion-intern': TOKEN_ADMIN_INTERN/g) ?? []
    expect(legitimatii.length).toBe(2)
  })

  it('secțiunea „constructor/ordine" trece prin cerAdmin — altfel legitimația nu deschidea chiar coada', () => {
    const ctor = citeste('routes/constructor.ts')
    expect(ctor).toMatch(/app\.get\('\/api\/admin\/constructor'[\s\S]{0,500}?cerAdmin\(req, reply\)/)
  })

  it('verificarea adresei e pe socket (remoteAddress), NU pe req.ip — trustProxy ar crede XFF', () => {
    const sesiune = citeste('session.ts')
    expect(sesiune).toMatch(/req\.socket\?\.remoteAddress/)
  })
})
