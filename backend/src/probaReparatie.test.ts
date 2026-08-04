import { describe, it, expect } from 'vitest'
import { probaReparatie } from './services/probaReparatie'

describe('probaReparatie', () => {
  it('intoarce exact textul specificat', () => {
    expect(probaReparatie()).toBe('constructorul repara din nou')
  })
})
