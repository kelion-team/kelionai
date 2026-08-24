import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const sursa = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

describe('analytics minimizat și fără capturi ascunse', () => {
  it('nu mai există ruta/capabilitatea de a atașa un cadru de cameră unei vizite', () => {
    const demo = sursa('./routes/demo.ts')
    const db = sursa('./db.ts')
    expect(demo).not.toContain('/api/visit/poza')
    expect(demo).not.toContain('attachVisitPhoto')
    expect(db).not.toContain('function attachVisitPhoto')
  })

  it('nu trimite IP-ul către geolocație și nu expune IP/locație/poze în raport', () => {
    const demo = sursa('./routes/demo.ts')
    const db = sursa('./db.ts')
    const tipuri = sursa('./shared/api-types.ts')
    expect(demo).not.toContain('ipwho.is')
    expect(demo).not.toContain('connection.isp')
    const inceput = db.indexOf('export async function getDemoStats')
    const raport = db.slice(inceput, db.indexOf('// ── THE OWNER', inceput))
    expect(raport).not.toMatch(/photo_url|faceprints|\bip\b|\bcity\b|\bisp\b/)
    expect(tipuri).not.toMatch(/interface DemoRecent[\s\S]{0,800}(?:photo_url|\bip:|\bcity:|\bisp:)/)
  })

  it('ping-ul de prezență cere sesiune și nu folosește fingerprint/IP', () => {
    const demo = sursa('./routes/demo.ts')
    const ping = demo.slice(demo.indexOf("'/api/visit/ping'"), demo.indexOf('// NO free tier'))
    expect(ping).toContain('reply.code(401)')
    expect(ping).toContain('touchVisit(email, pathAgregat')
    expect(ping).not.toContain('fp')
    expect(ping).not.toContain('clientIp')
  })

  it('statistica anonimă este agregată și schema runtime nu recreează profiluri', () => {
    const db = sursa('./db.ts')
    const schema = sursa('../migrations/20260824_base_schema.sql')
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS visit_daily')
    expect(db).toContain('ON CONFLICT (day, path, country_code)')
    expect(db).not.toMatch(/CREATE TABLE|ALTER TABLE|DROP TABLE/)
    expect(schema).not.toContain('CREATE TABLE IF NOT EXISTS visits')
    expect(schema).not.toContain('CREATE TABLE IF NOT EXISTS demo_uses')
  })
})
