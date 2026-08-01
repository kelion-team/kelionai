import { describe, it, expect } from 'vitest'
import { validateRunbook, RUNBOOKS } from './runbooks.js'
import { isValidBranch, normalizeBranch } from './github.js'

// NO RESTRICTIONS (Adrian's order, Jul 25): there is no approval, no
// ceilings and no blocks — the remaining guards are purely TECHNICAL (valid
// names), not policy.
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

  // THE RESTORE DRILL (Adrian, Jul 30). An untested backup is not a net, it's
  // an assumption. The drill MUST stay non-destructive: if someone ever lets
  // the restore slip over the LIVE database, they lose everything exactly on
  // the day they needed the net. That's why the command is kept under test,
  // not just recited.
  it('proba de restaurare e NEDISTRUCTIVĂ: bază temporară, ștearsă la final', () => {
    const cmd = RUNBOOKS['proba-restaurare']?.inputs?.cmd ?? ''
    expect(cmd).toBeTruthy()
    // It restores INTO A DRILL DATABASE, not over the live one.
    expect(cmd).toContain('CREATE DATABASE $BAZA')
    expect(cmd).toContain('kelion_proba_restaurare')
    // And it drops it after counting.
    expect(cmd).toContain('DROP DATABASE $BAZA')
    // It stops at the first error — a "half" restore is not allowed to pass
    // as a success.
    expect(cmd).toContain('ON_ERROR_STOP=1')
    expect(cmd.startsWith('set -e;')).toBe(true)
    // It is NOT allowed to write into the live database.
    expect(cmd).not.toContain('psql "$PGURL" -f')
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
