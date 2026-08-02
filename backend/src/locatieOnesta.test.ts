// ── LOCAȚIA ONESTĂ: „câte grade sunt în locația mea" → GPS real sau adevăr ──
//
// Incidentul ownerului: fără GPS de la dispozitiv și cu cache-ul de geo-IP
// rece, nimic nu spunea creierului „nu ai locația" — a inventat un oraș și a
// citat vremea LIVE pentru el ca și cum ar fi fost a utilizatorului (27°).
// Regula păzită de testele de aici:
//   1. „locația mea" → coordonatele GPS ale dispozitivului (determinist);
//   2. fără GPS → fallback IP ETICHETAT aproximativ;
//   3. fără nimic → refuz onest (location_unavailable) + bloc explicit în
//      prompt — NICIODATĂ un default inventat.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  LOCATION_NONE_PROMPT,
  resolveDeviceLocation,
  weatherArgsWithLocation,
} from './routes/chat.js'

const sursaChat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('resolveDeviceLocation — adevărul despre locație, o singură sursă', () => {
  it('GPS valid de la dispozitiv → coordonate exacte, fără fallback IP', () => {
    const loc = resolveDeviceLocation({ lat: 44.4268, lon: 26.1025 }, { city: 'Altundeva' })
    expect(loc.gps).toEqual({ lat: 44.4268, lon: 26.1025 })
    expect(loc.approxPlace).toBe('')
  })

  it('fără GPS → locația aproximativă din IP (oraș, regiune, țară)', () => {
    const loc = resolveDeviceLocation(undefined, { city: 'Witney', region: 'England', country: 'UK' })
    expect(loc.gps).toBeNull()
    expect(loc.approxPlace).toBe('Witney, England, UK')
  })

  it('coordonate nevalide (NaN) → NU sunt acceptate ca GPS', () => {
    const loc = resolveDeviceLocation({ lat: Number.NaN, lon: 26.1 }, { city: 'X' })
    expect(loc.gps).toBeNull()
    expect(loc.approxPlace).toBe('X')
  })

  it('nici GPS, nici geo-IP → golul DECLARAT (zero valori prefabricate)', () => {
    const loc = resolveDeviceLocation(undefined, null)
    expect(loc.gps).toBeNull()
    expect(loc.approxPlace).toBe('')
  })
})

describe('weatherArgsWithLocation — garda get_weather (deterministă)', () => {
  const GPS = { lat: 44.4268, lon: 26.1025 }

  it('lat/lon explicite de la model → păstrate intacte', () => {
    const r = weatherArgsWithLocation({ lat: 51.5, lon: -0.12 }, { gps: GPS, approxPlace: '' })
    expect(r).toEqual({ input: { lat: 51.5, lon: -0.12 } })
  })

  it('locație numită explicit → păstrată intactă', () => {
    const r = weatherArgsWithLocation({ location: 'Tokyo' }, { gps: GPS, approxPlace: '' })
    expect(r).toEqual({ input: { location: 'Tokyo' } })
  })

  it('„locația mea" (fără argumente) → se completează cu GPS-ul dispozitivului', () => {
    const r = weatherArgsWithLocation({}, { gps: GPS, approxPlace: '' })
    expect(r).toEqual({ input: { lat: 44.4268, lon: 26.1025 } })
  })

  it('fără GPS dar cu geo-IP → fallback aproximativ, nu coordonate inventate', () => {
    const r = weatherArgsWithLocation({}, { gps: null, approxPlace: 'Witney, UK' })
    expect(r).toEqual({ input: { location: 'Witney, UK' } })
  })

  it('fără GPS și fără nimic → REFUZ onest, nu un default inventat', () => {
    const r = weatherArgsWithLocation({}, { gps: null, approxPlace: '' })
    expect('errorJson' in r).toBe(true)
    if ('errorJson' in r) {
      const j = JSON.parse(r.errorJson) as { error: string; message: string }
      expect(j.error).toBe('location_unavailable')
      expect(j.message).toContain("don't have their location")
      expect(j.message).toContain('never guess')
    }
  })

  it('lat/lon nevalide (text) → tratate ca lipsă, nu ca 0/0', () => {
    const r = weatherArgsWithLocation({ lat: 'abc', lon: '' }, { gps: GPS, approxPlace: '' })
    expect(r).toEqual({ input: { lat: 44.4268, lon: 26.1025 } })
  })
})

describe('cablajul în rută (sursa, fără mock-uri)', () => {
  it('promptul declară golul de locație (LOCATION_NONE_PROMPT injectat)', () => {
    expect(LOCATION_NONE_PROMPT).toContain('do NOT have the user')
    expect(sursaChat).toContain('systemPrompt += LOCATION_NONE_PROMPT')
  })

  it('aceeași sursă de adevăr hrănește și promptul, și garda uneltei', () => {
    expect(sursaChat).toContain('const deviceLoc = resolveDeviceLocation(')
    expect(sursaChat).toContain('weatherArgsWithLocation(block.input, loc)')
  })
})
