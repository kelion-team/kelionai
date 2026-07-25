import { describe, it, expect } from 'vitest'
import { validateRunbook, RUNBOOKS } from './runbooks.js'
import { isValidBranch, normalizeBranch } from './github.js'

// FĂRĂ RESTRICȚII (ordinul lui Adrian, 25 iul): nu există aprobare, plafoane
// sau blocări — gărzile rămase sunt pur TEHNICE (nume valide), nu de politică.
describe('validateRunbook', () => {
  it('refuză un runbook necunoscut și listează ce există', () => {
    const r = validateRunbook('sterge-tot')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('unknown_runbook')
      expect(r.known).toContain('diagnostic')
    }
  })

  it('TOATE runbook-urile pornesc liber, inclusiv publish-master (fără aprobare)', () => {
    for (const name of Object.keys(RUNBOOKS)) {
      expect(validateRunbook(name).ok).toBe(true)
    }
  })

  it('registrul conține doar workflow-uri reale, cu comenzi fixe', () => {
    const allowed = new Set(['deploy.yml', 'vps-diag.yml', 'sentinel.yml', 'vps-run.yml'])
    for (const rb of Object.values(RUNBOOKS)) expect(allowed.has(rb.workflow)).toBe(true)
  })
})

describe('normalizeBranch (incident: diacriticele blocau livrarea fixului)', () => {
  it('transformă diacriticele și spațiile în forme sigure git', () => {
    expect(normalizeBranch('kelion/sincronizare-gură-audio')).toBe('kelion/sincronizare-gura-audio')
    expect(normalizeBranch('kelion/fix animație țeapănă')).toBe('kelion/fix-animatie-teapana')
  })
  it('numele deja curate rămân neschimbate', () => {
    expect(normalizeBranch('kelion/fix-microfon')).toBe('kelion/fix-microfon')
  })
  it('master rămâne respins și după normalizare', () => {
    expect(isValidBranch(normalizeBranch('master'))).toBe(false)
    expect(isValidBranch(normalizeBranch('măstér'))).toBe(false)
  })
})

describe('isValidBranch (gardă tehnică git, nu politică)', () => {
  it('acceptă nume normale de ramură', () => {
    expect(isValidBranch('kelion/fix-microfon')).toBe(true)
    expect(isValidBranch('reparatie-2')).toBe(true)
  })
  it('refuză master (acolo se ajunge prin merge, nu prin scriere directă) și nume corupte', () => {
    expect(isValidBranch('master')).toBe(false)
    expect(isValidBranch('a b')).toBe(false)
    expect(isValidBranch('../evadare')).toBe(false)
    expect(isValidBranch('')).toBe(false)
  })
})
