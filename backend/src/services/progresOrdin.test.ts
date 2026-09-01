import { describe, expect, it } from 'vitest'
import { procentDinEtapePersistate } from './progresOrdin.js'

describe('procentDinEtapePersistate', () => {
  it('derives the public percentage from canonical completed/total milestones', () => {
    expect(procentDinEtapePersistate(0, 8, false)).toBe(0)
    expect(procentDinEtapePersistate(2, 8, false)).toBe(25)
    expect(procentDinEtapePersistate(7, 8, false)).toBe(87)
  })

  it('reserves 100 for a resolved authoritative result', () => {
    expect(procentDinEtapePersistate(8, 8, false)).toBe(99)
    expect(procentDinEtapePersistate(8, 8, true)).toBe(100)
    expect(procentDinEtapePersistate(0, 0, false)).toBeNull()
  })
})
