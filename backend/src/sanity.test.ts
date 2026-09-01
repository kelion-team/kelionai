import { describe, it, expect } from 'vitest'

describe('Basic Sanity Tests', () => {
  it('should pass a simple math test', () => {
    expect(1 + 1).toBe(2)
  })

  it('should verify environment', () => {
    expect(process.env.NODE_ENV).toBeDefined()
  })
})
