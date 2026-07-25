import { describe, it, expect } from 'vitest'
import { validateRunbook, RUNBOOKS } from './runbooks.js'

// Lesa autonomiei (regula #11) — gărzile pure, fără rețea.
describe('validateRunbook (lesa)', () => {
  it('refuză un runbook necunoscut și listează ce există', () => {
    const r = validateRunbook('sterge-tot', false)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.error).toBe('unknown_runbook')
      expect(r.known).toContain('diagnostic')
    }
  })

  it('publish-master NU pornește fără aprobarea explicită a ownerului', () => {
    const r = validateRunbook('publish-master', false)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('needs_owner_affirm')
  })

  it('publish-master pornește CU aprobarea ownerului', () => {
    const r = validateRunbook('publish-master', true)
    expect(r.ok).toBe(true)
  })

  it('operațiunile de citire nu cer aprobare', () => {
    for (const name of ['diagnostic', 'sentinel-now', 'loguri-app']) {
      expect(validateRunbook(name, false).ok).toBe(true)
    }
  })

  it('registrul conține doar workflow-uri reale, fără comenzi libere', () => {
    const allowed = new Set(['deploy.yml', 'vps-diag.yml', 'sentinel.yml', 'vps-run.yml'])
    for (const rb of Object.values(RUNBOOKS)) expect(allowed.has(rb.workflow)).toBe(true)
  })
})
