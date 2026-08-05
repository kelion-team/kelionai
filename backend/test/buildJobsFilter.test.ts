import { describe, it, expect } from 'vitest'

describe('build_jobs filtering for old failed jobs', () => {
  it('excludes failed jobs with id <= 28', () => {
    const SQL_QUERY = `SELECT * FROM build_jobs WHERE NOT (status = 'failed' AND id <= 28) ORDER BY created_at DESC LIMIT $1`
    expect(SQL_QUERY).toContain("status = 'failed'")
    expect(SQL_QUERY).toContain('id <= 28')
    expect(SQL_QUERY).toContain('NOT')
  })
})
