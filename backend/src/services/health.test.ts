import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listBuildJobs: vi.fn(),
  query: vi.fn(),
  fetch: vi.fn(),
}))

vi.mock('../db.js', () => ({
  dbEnabled: () => true,
  getPool: () => ({ query: mocks.query }),
  listBuildJobs: mocks.listBuildJobs,
  countClientErrorsLastHour: async () => 0,
}))
vi.mock('./resurse.js', () => ({
  resurseGazda: async () => null,
  descrieResurse: () => '',
  PRAG_MEMORIE_PCT: 10,
  PRAG_INCARCARE_PCT: 90,
}))
vi.mock('./openaiResponses.js', () => ({ openaiHealth: async () => ({ ok: true, serving: true }) }))
vi.mock('./dispecer.js', () => ({ stareDispecer: () => ({}) }))
vi.mock('./browser.js', () => ({ probaBrowserulMainilor: async () => ({ ok: true }) }))
vi.mock('./constructorChainStatus.js', () => ({
  getConstructorChainStatus: async () => ({ state: 'ready', reason: 'ready' }),
}))
vi.mock('./githubApi.js', () => ({ GITHUB_API: 'https://api.github.invalid', ghToken: () => '' }))

import { systemHealth } from './health.js'

describe('systemHealth Constructor queue truthfulness', () => {
  beforeEach(() => {
    mocks.listBuildJobs.mockReset()
    mocks.query.mockReset().mockResolvedValue({ rows: [{ '?column?': 1 }] })
    mocks.fetch.mockReset().mockResolvedValue({ status: 401 })
    vi.stubGlobal('fetch', mocks.fetch)
    delete process.env.GITHUB_TOKEN
  })

  it('raportează critic coada ilizibilă chiar dacă SELECT 1 este verde', async () => {
    mocks.listBuildJobs.mockResolvedValue(null)

    const health = JSON.parse(await systemHealth()) as {
      ok: boolean
      probleme: { id: string; grav: string }[]
    }

    expect(mocks.query).toHaveBeenCalledWith('SELECT 1')
    expect(health.ok).toBe(false)
    expect(health.probleme).toContainEqual(expect.objectContaining({
      id: 'constructor_queue_unreadable',
      grav: 'critic',
    }))
    expect(health.probleme).not.toContainEqual(expect.objectContaining({ id: 'db_moarta' }))
  })
})
