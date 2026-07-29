// ── TESTELE ANCOREI DE TIMP (§3 din KELION-CREIER-UNIC) ─────────────────────
//
// Bug-ul reclamat de Adrian: „bună seara" spus dimineața, și „i-am zis de 2 ori
// că e dimineața și a zis ca mine". Ancora asta e sursa UNICĂ de adevăr despre
// oră pentru chat ȘI voce — dacă întoarce ceva greșit sau tace, creierul rămâne
// fără reper și inventează. Avea zero teste.
import { describe, it, expect } from 'vitest'
import { formatDeviceTime } from './services/timeContext.js'

describe('timeContext — ancora de timp a dispozitivului', () => {
  it('formatează ora reală în fusul cerut', () => {
    const r = formatDeviceTime('2026-07-29T06:30:00Z', 'Europe/London')
    expect(r).not.toBeNull()
    expect(r?.tzName).toBe('Europe/London')
    // 06:30 UTC = 07:30 la Londra vara — ora TREBUIE să apară în text.
    expect(r?.human).toMatch(/07:30/)
    expect(r?.human).toMatch(/July|Wednesday/)
  })

  it('respectă fusul: același moment, ore diferite', () => {
    const londra = formatDeviceTime('2026-07-29T06:30:00Z', 'Europe/London')
    const bucuresti = formatDeviceTime('2026-07-29T06:30:00Z', 'Europe/Bucharest')
    expect(londra?.human).not.toBe(bucuresti?.human)
    expect(bucuresti?.human).toMatch(/09:30/)
  })

  it('fără fus valid cade pe UTC, nu crapă', () => {
    expect(formatDeviceTime('2026-07-29T06:30:00Z', undefined)?.tzName).toBe('UTC')
    expect(formatDeviceTime('2026-07-29T06:30:00Z', '')?.tzName).toBe('UTC')
    // Fus inexistent: nu aruncă — cade pe reprezentarea UTC.
    expect(formatDeviceTime('2026-07-29T06:30:00Z', 'Nu/Exista')).not.toBeNull()
  })

  it('TACE (null) când nu are oră reală — nu inventează una', () => {
    // Regula: mai bine fără bloc de timp decât cu o oră greșită.
    expect(formatDeviceTime(undefined, 'Europe/London')).toBeNull()
    expect(formatDeviceTime('', 'Europe/London')).toBeNull()
    expect(formatDeviceTime('nu-i o dată', 'Europe/London')).toBeNull()
    expect(formatDeviceTime(12345, 'Europe/London')).toBeNull()
    expect(formatDeviceTime(null, 'Europe/London')).toBeNull()
  })

  it('dimineața rămâne dimineață (bugul „bună seara" la 7 AM)', () => {
    const r = formatDeviceTime('2026-07-29T05:00:00Z', 'Europe/London')
    expect(r?.human).toMatch(/06:00/) // 6 dimineața, nu seara
  })
})
