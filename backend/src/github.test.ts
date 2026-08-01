import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('GITHUB_TOKEN', 'test-token')

// Mocks for github.ts dependencies, so I test ONLY the checkpoint logic in
// repoMergePR, without touching the real GitHub.
const { createRecoveryPoint } = vi.hoisted(() => ({ createRecoveryPoint: vi.fn() }))
vi.mock('./services/recovery.js', () => ({ createRecoveryPoint }))
vi.mock('./services/runbooks.js', () => ({ isOpsPaused: vi.fn(async () => false), alertAdminLoop: vi.fn() }))

import { repoMergePR } from './services/github.js'

// Shared log: both the checkpoint (mock) and the merge (fetch) write here, so
// I can prove the ORDER — checkpoint BEFORE merge.
let callLog: string[] = []

function fakeResp(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as unknown as Response
}

beforeEach(() => {
  callLog = []
  createRecoveryPoint.mockReset()
  global.fetch = vi.fn(async (url: unknown, _init?: RequestInit) => {
    const u = String(url)
    if (u.includes('/pulls/123/merge')) {
      callLog.push('merge')
      return fakeResp({ sha: 'abcdef1234567', merged: true })
    }
    if (u.includes('/pulls/123')) return fakeResp({ title: 'PR de test', head: { sha: 'headsha' } })
    if (u.includes('/actions/runs?head_sha=')) return fakeResp({ workflow_runs: [{ name: 'pr-verify', status: 'completed', conclusion: 'success' }] })
    if (u.includes('deploy.yml/runs')) return fakeResp({ workflow_runs: [{ conclusion: 'success' }, { conclusion: 'success' }] })
    return fakeResp({})
  }) as unknown as typeof fetch
})

describe('Etapa 3 — checkpoint automat înainte de merge (operație riscantă)', () => {
  it('creează checkpoint ÎNAINTE de merge și raportează tag-ul', async () => {
    createRecoveryPoint.mockImplementation(async () => {
      callLog.push('checkpoint')
      return { ok: true, tag: 'backup-2026-07-29-0700-abcdef1' }
    })
    const out = JSON.parse(await repoMergePR(123))
    expect(createRecoveryPoint).toHaveBeenCalledOnce()
    // The checkpoint description contains the PR number (clear description).
    expect(String(createRecoveryPoint.mock.calls[0][0])).toMatch(/PR #123/)
    // ORDER: checkpoint before merge.
    expect(callLog.indexOf('checkpoint')).toBeLessThan(callLog.indexOf('merge'))
    expect(callLog).toEqual(['checkpoint', 'merge'])
    // The result carries the rollback tag.
    expect(out.checkpoint).toBe('backup-2026-07-29-0700-abcdef1')
    expect(out.merged).toBe(true)
  })

  it('un checkpoint eșuat NU blochează merge-ul, dar avertizează clar', async () => {
    createRecoveryPoint.mockImplementation(async () => {
      callLog.push('checkpoint')
      return { ok: false, error: 'master_ref_500' }
    })
    const out = JSON.parse(await repoMergePR(123))
    expect(callLog).toContain('merge') // the merge happened anyway
    expect(out.merged).toBe(true)
    expect(out.checkpoint).toBeUndefined()
    expect(String(out.checkpointWarning)).toMatch(/NU am putut crea checkpoint/)
  })
})
