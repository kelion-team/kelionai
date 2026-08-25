import { describe, expect, it } from 'vitest'
import { readReleaseSnapshot } from './githubReleaseIntegration.js'

describe('GitHub release integration', () => {
  it('fails visibly when the OAuth integration is not configured', async () => {
    const result = await readReleaseSnapshot('https://github.com/kelion-team/kelionai/pull/1')
    expect(['setup_required', 'unavailable']).toContain(result.integration)
    if (result.integration === 'setup_required') expect(result.nextAction).toMatch(/Conectează integrarea/)
  })
})
