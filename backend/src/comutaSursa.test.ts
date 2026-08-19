// ── COMUTAREA SURSEI din chat (owner, 19 aug) ────────────────────────────────
// „comută pe free creier și free constructor sau combinații; când eu nu sunt să
//  decidă autonom." Nucleul e PUR — probat aici pe fiecare traducere + pe decizia
//  autonomă (owner prezent vs plecat) + pe rezumatul MĂSURAT (regula #1).
import { describe, it, expect } from 'vitest'
import {
  normalizeazaCreier,
  normalizeazaConstructor,
  interpreteazaComutare,
  decideSursaAutonoma,
  rezumaComutare,
} from './services/comutaSursa.js'
import type { ConfigCreier } from './services/creierCloud.js'

describe('normalizează creierul — „free" = Gemini, cloud = kimi/qwen', () => {
  it('sinonimele de FREE cad pe gemini', () => {
    for (const s of ['free', 'FREE', 'gemini', 'gemeni', 'gratis', 'implicit']) expect(normalizeazaCreier(s)).toBe('gemini')
  })
  it('cloud: kimi → kimi-k3, qwen → qwen3.5', () => {
    expect(normalizeazaCreier('kimi')).toBe('kimi-k3')
    expect(normalizeazaCreier('Kimi K3')).toBe('kimi-k3')
    expect(normalizeazaCreier('qwen')).toBe('qwen3.5')
    expect(normalizeazaCreier('Qwen3.5 Max')).toBe('qwen3.5')
  })
  it('gol/necunoscut → undefined (nu schimbă orbește)', () => {
    expect(normalizeazaCreier(undefined)).toBeUndefined()
    expect(normalizeazaCreier('')).toBeUndefined()
    expect(normalizeazaCreier('ceva-inexistent')).toBeUndefined()
  })
})

describe('normalizează constructorul — free (local) vs plătit (cloud)', () => {
  it('plătit', () => {
    for (const s of ['platit', 'plătit', 'plata', 'cloud', 'pro', 'contra-cost']) expect(normalizeazaConstructor(s)).toBe('platit')
  })
  it('free', () => {
    for (const s of ['free', 'local', 'gratis', 'vps']) expect(normalizeazaConstructor(s)).toBe('free')
  })
  it('gol/necunoscut → undefined', () => {
    expect(normalizeazaConstructor(undefined)).toBeUndefined()
    expect(normalizeazaConstructor('aiurea')).toBeUndefined()
  })
})

describe('interpretează cererea → doar câmpurile cerute (combinații)', () => {
  it('„free creier, plătit constructor" → ambele', () => {
    expect(interpreteazaComutare({ creier: 'free', constructor: 'platit' })).toEqual({ creier2: 'gemini', constructorSursa: 'platit' })
  })
  it('doar creierul cerut → doar creier2 (restul rămâne)', () => {
    expect(interpreteazaComutare({ creier: 'kimi' })).toEqual({ creier2: 'kimi-k3' })
  })
  it('doar constructorul cerut → doar constructorSursa', () => {
    expect(interpreteazaComutare({ constructor: 'free' })).toEqual({ constructorSursa: 'free' })
  })
  it('nimic recognoscibil → obiect gol (apelantul refuză „nimic de comutat")', () => {
    expect(interpreteazaComutare({ creier: 'zzz', constructor: 'zzz' })).toEqual({})
    expect(interpreteazaComutare({})).toEqual({})
  })
})

describe('decizia AUTONOMĂ când ownerul lipsește — cost-safe (free-first)', () => {
  const acum: ConfigCreier = { creier2: 'qwen3.5', constructorSursa: 'platit' }
  it('owner PREZENT → NU suprascrie alegerea lui (config gol)', () => {
    const d = decideSursaAutonoma({ ownerPrezent: true, acum, paidDisponibil: true })
    expect(d.config).toEqual({})
    expect(d.deCe).toMatch(/prezent/)
  })
  it('owner PLECAT → FREE pe amândouă, ferm, ca să nu ardă bani fără el', () => {
    const d = decideSursaAutonoma({ ownerPrezent: false, acum, paidDisponibil: true })
    expect(d.config).toEqual({ creier2: 'gemini', constructorSursa: 'free' })
    expect(d.recomandare).toMatch(/FERM|FREE/)
    expect(d.deCe).toMatch(/lipse[șs]te|plecat|nevoie/)
  })
  it('owner plecat + plătit indisponibil → tot FREE, cu motivul onest', () => {
    const d = decideSursaAutonoma({ ownerPrezent: false, acum, paidDisponibil: false })
    expect(d.config).toEqual({ creier2: 'gemini', constructorSursa: 'free' })
    expect(d.deCe).toMatch(/nu e gata|cheie/)
  })
})

describe('rezumatul e MĂSURAT — nu promite plătit când rezerva nu e gata (regula #1)', () => {
  it('free curat', () => {
    const r = rezumaComutare({ creier2: 'gemini', constructorSursa: 'free' }, false)
    expect(r).toMatch(/FREE \(Gemini\)/)
    expect(r).toMatch(/FREE \(local/)
    expect(r).not.toMatch(/⚠/)
  })
  it('constructor pe plătit dar rezerva NU e gata → avertisment onest', () => {
    const r = rezumaComutare({ creier2: 'gemini', constructorSursa: 'platit' }, false)
    expect(r).toMatch(/⚠/)
    expect(r).toMatch(/nu e gata|porne[șs]te tot pe FREE/i)
  })
  it('plătit cu rezerva gata → fără avertisment', () => {
    const r = rezumaComutare({ creier2: 'qwen3.5', constructorSursa: 'platit' }, true)
    expect(r).toMatch(/PLĂTIT \(qwen3.5\)/)
    expect(r).not.toMatch(/⚠/)
  })
})
