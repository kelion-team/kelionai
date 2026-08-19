import { describe, it, expect } from 'vitest'
import { decideConfigConstructor, tagModelCloud } from './services/creierCloud.js'

// ── MATRICEA CREIER 2 × CONSTRUCTOR — MĂSURATĂ, nu povestită (owner, 19 aug:
// „reia analiza tabelului tău care e o invenție… măsoară și afișează rezultatele").
// Rulăm FUNCȚIA REALĂ de decizie (decideConfigConstructor, aceeași pe care o
// folosește ruta /api/constructor/creier-config) peste TOATE combinațiile și
// afișăm ce produce EFECTIV fiecare. Nicio părere — doar ieșirea funcției.

const CREIER2 = ['gemini', 'kimi-k3', 'qwen3.5'] as const
const SURSA = ['free', 'platit'] as const
const CHEIE = [
  { label: 'cheie pusă', v: 'k'.repeat(20) },
  { label: 'fără cheie', v: '' },
]

interface Rand {
  'Creier 2': string
  Constructor: string
  Cheie: string
  'RULEAZĂ pe': string
  'Rezervă plătită': string
}

const matrice: Rand[] = []
for (const creier2 of CREIER2) {
  for (const constructorSursa of SURSA) {
    for (const ch of CHEIE) {
      const r = decideConfigConstructor({ creier2, constructorSursa }, ch.v)
      const ruleaza =
        r.sursa === 'platit'
          ? `CLOUD plătit: ${r.model}`
          : 'LOCAL free: qwen2.5-coder:32b'
      matrice.push({
        'Creier 2': creier2,
        Constructor: constructorSursa,
        Cheie: ch.label,
        'RULEAZĂ pe': ruleaza,
        'Rezervă plătită': r.fallback ? `da (${r.fallback.model})` : 'nu',
      })
    }
  }
}

// AFIȘAREA măsurată — apare în ieșirea testului.
console.log('\n===== MATRICEA MĂSURATĂ: ce RULEAZĂ efectiv pe fiecare combinație =====')
console.table(matrice)

describe('matricea creier×constructor — MĂSURATĂ pe funcția reală de decizie', () => {
  it('GEMINI la Creier 2 → constructorul rulează MEREU LOCAL free (nu există model cloud), oricât ai apăsa PLĂTIT', () => {
    for (const s of SURSA) {
      const r = decideConfigConstructor({ creier2: 'gemini', constructorSursa: s }, 'k'.repeat(20))
      expect(r.sursa).toBe('free')
      expect(r.paidDisponibil).toBe(false)
      expect(r.fallback).toBeNull()
    }
  })

  it('QWEN3.5 + PLĂTIT + cheie → rulează EFECTIV pe CLOUD (platit), cu modelul cloud', () => {
    const r = decideConfigConstructor({ creier2: 'qwen3.5', constructorSursa: 'platit' }, 'k'.repeat(20))
    expect(r.sursa).toBe('platit')
    expect(r.model).toBe(tagModelCloud('qwen3.5'))
    expect(r.model).not.toBe('')
  })

  it('KIMI K3 + PLĂTIT + cheie → decizia de rutare zice CLOUD (platit) — dar dacă merge LIVE depinde de „extra usage" (402), NU de cod', () => {
    const r = decideConfigConstructor({ creier2: 'kimi-k3', constructorSursa: 'platit' }, 'k'.repeat(20))
    expect(r.sursa).toBe('platit')
    expect(r.model).toBe(tagModelCloud('kimi-k3'))
  })

  it('cloud ales dar FĂRĂ cheie → cade pe LOCAL free (nu inventează un paid imposibil)', () => {
    for (const c of ['kimi-k3', 'qwen3.5'] as const) {
      const r = decideConfigConstructor({ creier2: c, constructorSursa: 'platit' }, '')
      expect(r.sursa).toBe('free')
      expect(r.paidDisponibil).toBe(false)
    }
  })

  it('cloud + FREE + cheie → START pe LOCAL free, dar REZERVA plătită e gata (escaladează doar la nevoie)', () => {
    const r = decideConfigConstructor({ creier2: 'qwen3.5', constructorSursa: 'free' }, 'k'.repeat(20))
    expect(r.sursa).toBe('free')
    expect(r.paidDisponibil).toBe(true)
    expect(r.fallback?.model).toBe(tagModelCloud('qwen3.5'))
  })
})
