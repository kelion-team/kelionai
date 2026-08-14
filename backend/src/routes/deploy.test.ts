import { describe, it, expect } from 'vitest'
import { getDeployProgress } from './deploy.js'

describe('Deploy progress & status', () => {
  it('getDeployProgress returns default fallback structure if no deploy is running', async () => {
    const progress = await getDeployProgress()
    expect(progress).toBeDefined()
    expect(typeof progress.percent).toBe('number')
    expect(typeof progress.step).toBe('string')
    expect(typeof progress.timestamp).toBe('string')
    expect(typeof progress.active).toBe('boolean')
    expect(typeof progress.done).toBe('boolean')
  })
})
