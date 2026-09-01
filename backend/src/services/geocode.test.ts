// ── THE COORDINATES ↔ POSTCODE PAIRING (Adrian, Aug 1) ─────────────────────
//
// "It can't see the link from the exact coordinates and pair them with the
// postcode." The pairing rules live in the pure `composePlace`: Nominatim's
// address breakdown → a SHORT human place + the postcode of that exact point.
// Tested here without network: the short form picks street + settlement +
// county + country, the postcode is never invented (missing in the address →
// empty, and the tool reports null), and a county equal to the settlement is
// not repeated.
import { describe, it, expect } from 'vitest'
import { composePlace } from './google.js'

describe('composePlace — the coordinates ↔ postcode pairing', () => {
  it('builds the short place and keeps the postcode', () => {
    const r = composePlace(
      {
        road: 'High Street',
        city: 'Witney',
        county: 'Oxfordshire',
        postcode: 'OX28 1AA',
        country: 'United Kingdom',
      },
      'High Street, Witney, Oxfordshire, South East England, England, OX28 1AA, United Kingdom',
    )
    expect(r.place).toBe('High Street, Witney, Oxfordshire, United Kingdom')
    expect(r.postcode).toBe('OX28 1AA')
  })

  it('never invents a postcode — missing in the address means empty', () => {
    const r = composePlace({ road: 'DN7', county: 'Ilfov', country: 'România' }, 'DN7, Ilfov, România')
    expect(r.postcode).toBe('')
    expect(r.place).toContain('DN7')
  })

  it('falls back to the display name when the address breakdown is missing', () => {
    const r = composePlace(undefined, 'Some Place, Somewhere')
    expect(r.place).toBe('Some Place, Somewhere')
    expect(r.postcode).toBe('')
  })

  it('does not repeat a county identical to the settlement', () => {
    const r = composePlace(
      { city: 'București', county: 'București', postcode: '010101', country: 'România' },
      'București, România',
    )
    expect(r.place).toBe('București, România')
    expect(r.postcode).toBe('010101')
  })

  it('uses the settlement available — village, town or suburb, in this order of truth', () => {
    const r = composePlace({ village: 'Snagov', country: 'România' }, 'Snagov, România')
    expect(r.place).toBe('Snagov, România')
  })
})
