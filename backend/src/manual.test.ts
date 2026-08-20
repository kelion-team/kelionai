import { describe, it, expect } from 'vitest'
import { CAPABILITIES } from './services/brainCapabilities.js'
import { MANUAL_CAPS, buildManual, buildAdminChapters } from './services/manual.js'

// THE MANUAL GUARD — the test manual.ts's own comment always referenced
// ("The guard in manual.test.ts fails if a new skill appears without a row
// here") but that did not exist. Proof it was needed: lookup_address shipped
// in the registry (1 Aug) without a manual row — an undocumented public
// feature, exactly what the guard was meant to make impossible.
// From here on, the manual can neither miss a public capability nor keep a
// row for one that no longer exists.
describe('manual — the public feature list cannot rot', () => {
  it('every non-admin capability in the registry has a manual row', () => {
    const missing = CAPABILITIES.filter((c) => !c.admin && !MANUAL_CAPS[c.name]).map((c) => c.name)
    expect(missing, `public capabilities missing from the manual: ${missing.join(', ')}`).toEqual([])
  })

  it('every manual row names a capability that still exists (no dead rows)', () => {
    const real = new Set(CAPABILITIES.map((c) => c.name))
    const dead = Object.keys(MANUAL_CAPS).filter((k) => !real.has(k))
    expect(dead, `manual rows for removed capabilities: ${dead.join(', ')}`).toEqual([])
  })

  it('buildManual() actually lists every public capability (none silently dropped)', () => {
    const doc = buildManual()
    const listed = doc.groups.flatMap((g) => g.items).length
    const expected = CAPABILITIES.filter((c) => !c.admin && MANUAL_CAPS[c.name]).length
    expect(listed).toBe(expected)
    expect(listed).toBeGreaterThan(0)
  })

  // Capitolele doar-admin (owner, 20 aug: „ce e admin se afișează tot"): un
  // singur manual, care câștigă proiectul de chat voce când sesiunea e admin.
  it('buildAdminChapters() dă capitolele proiectului, în română, non-goale', () => {
    const cap = buildAdminChapters()
    expect(cap.length).toBeGreaterThan(0)
    for (const s of cap) {
      expect(s.title, 'un capitol admin fără titlu').toBeTruthy()
      expect(s.paragraphs.length, `capitolul „${s.title}" e gol`).toBeGreaterThan(0)
    }
    const tot = cap.map((s) => `${s.title} ${s.paragraphs.join(' ')}`).join(' ')
    expect(tot).toMatch(/Jarvis/)
    expect(tot).toMatch(/100% VORBIT/i)
    expect(tot).toMatch(/PROIECT-CHAT-VOCE\.md/)
  })
})
