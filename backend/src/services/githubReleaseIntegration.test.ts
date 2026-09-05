import { describe, expect, it, vi } from 'vitest'
import {
  checkRunMatchesPullRequestIdentity,
  eligibleCurrentHeadApprovalCount,
  hasNoActiveBranchRules,
  parseGitHubActionsCheckCoordinates,
  projectBranchProtection,
  projectReleaseMergeState,
  projectRequiredChecks,
  readReleaseSnapshot,
} from './githubReleaseIntegration.js'

function permissionFetcher(
  entries: Record<string, { id: number; permission: 'read' | 'write' | 'maintain' | 'admin' }>,
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const match = String(input).match(/\/collaborators\/([^/]+)\/permission/)
    const login = decodeURIComponent(match?.[1] ?? '')
    const entry = entries[login]
    return entry
      ? new Response(JSON.stringify({ permission: entry.permission, user: { id: entry.id, login } }), { status: 200 })
      : new Response('{}', { status: 404 })
  }) as typeof fetch
}

describe('GitHub release integration', () => {
  it('keeps GitHub job IDs separate from check-run IDs', () => {
    expect(parseGitHubActionsCheckCoordinates(
      'https://github.com/kelion-team/kelionai/actions/runs/7001/job/8002',
      'kelion-team/kelionai',
    )).toEqual({ runId: 7001, jobId: 8002 })
    expect(parseGitHubActionsCheckCoordinates(
      'https://github.com/kelion-team/other/actions/runs/7001/job/8002',
      'kelion-team/kelionai',
    )).toBeNull()
  })

  it('requires volatile check-to-PR arrays only while the PR is open', () => {
    const check = { head_sha: 'a'.repeat(40), pull_requests: [] }
    const expected = {
      number: 42,
      headSha: 'a'.repeat(40),
      headRef: 'codex/123e4567-e89b-42d3-a456-426614174000',
      repository: 'kelion-team/kelionai',
    }
    expect(checkRunMatchesPullRequestIdentity(check, expected, true)).toBe(false)
    expect(checkRunMatchesPullRequestIdentity(check, expected, false)).toBe(true)
    expect(checkRunMatchesPullRequestIdentity({ ...check, head_sha: 'b'.repeat(40) }, expected, false)).toBe(false)
    expect(checkRunMatchesPullRequestIdentity({
      ...check,
      pull_requests: [{
        number: 99,
        head: { sha: expected.headSha, ref: expected.headRef, repo: { url: `https://api.github.com/repos/${expected.repository}` } },
        base: { ref: 'master', repo: { url: `https://api.github.com/repos/${expected.repository}` } },
      }],
    }, expected, false)).toBe(false)
  })

  it('fails visibly when the OAuth integration is not configured', async () => {
    const result = await readReleaseSnapshot('https://github.com/kelion-team/kelionai/pull/1')
    expect(['setup_required', 'unavailable']).toContain(result.integration)
    if (result.integration === 'setup_required') expect(result.nextAction).toMatch(/Conectează integrarea/)
  })

  it('never treats optional green checks as a missing required check', () => {
    const policies = [{ name: 'verify', appId: 41 }, { name: 'container-isolation', appId: 42 }]
    expect(projectRequiredChecks([
      { id: 1, name: 'optional', app: { id: 99 }, status: 'completed', conclusion: 'success' },
    ], ['verify', 'container-isolation'], policies, { verify: 2, 'container-isolation': 3 })).toBe('pending')
    expect(projectRequiredChecks([
      { id: 2, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success' },
      { id: 3, name: 'container-isolation', app: { id: 42 }, status: 'completed', conclusion: 'failure' },
    ], ['verify', 'container-isolation'], policies, { verify: 2, 'container-isolation': 3 })).toBe('failed')
  })

  it('uses the latest required check from the app pinned by branch protection', () => {
    const required = ['verify', 'container-isolation']
    const policies = [{ name: 'verify', appId: 41 }, { name: 'container-isolation', appId: 42 }]
    expect(projectRequiredChecks([
      { id: 1, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success' },
      { id: 2, name: 'verify', app: { id: 42 }, status: 'completed', conclusion: 'failure' },
      { id: 3, name: 'container-isolation', app: { id: 42 }, status: 'completed', conclusion: 'success' },
    ], required, policies, { verify: 1, 'container-isolation': 3 })).toBe('passed')
    expect(projectRequiredChecks([
      { id: 4, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success' },
      { id: 5, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'failure' },
      { id: 6, name: 'container-isolation', app: { id: 42 }, status: 'completed', conclusion: 'success' },
    ], required, policies, { verify: 5, 'container-isolation': 6 })).toBe('failed')
    expect(projectRequiredChecks([
      { id: 7, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success' },
      { id: 8, name: 'container-isolation', app: { id: 99 }, status: 'completed', conclusion: 'success' },
    ], required, policies, { verify: 7, 'container-isolation': 8 })).toBe('pending')
    expect(projectRequiredChecks([
      { id: 9, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'failure' },
      { id: 10, name: 'verify', app: { id: 99 }, status: 'completed', conclusion: 'success' },
      { id: 11, name: 'container-isolation', app: { id: 42 }, status: 'completed', conclusion: 'success' },
    ], required, policies, { verify: 9, 'container-isolation': 11 })).toBe('failed')
    expect(projectRequiredChecks([
      { id: 12, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'failure' },
      { id: 13, name: 'verify', app: { id: 41 }, status: 'completed', conclusion: 'success' },
      { id: 14, name: 'container-isolation', app: { id: 42 }, status: 'completed', conclusion: 'success' },
    ], required, policies, { verify: 12, 'container-isolation': 14 })).toBe('failed')
  })

  it('accepts approval only for the current PR head', async () => {
    const fetcher = permissionFetcher({ reviewer: { id: 10, permission: 'write' } })
    await expect(eligibleCurrentHeadApprovalCount([
      { id: 1, user: { id: 10, login: 'reviewer' }, state: 'APPROVED', commit_id: 'old' },
    ], 'new', fetcher)).resolves.toBe(0)
    await expect(eligibleCurrentHeadApprovalCount([
      { id: 2, user: { id: 10, login: 'reviewer' }, state: 'APPROVED', commit_id: 'new' },
    ], 'new', fetcher)).resolves.toBe(1)
  })

  it('uses each reviewer latest decisive state instead of a stale approval', async () => {
    const fetcher = permissionFetcher({ reviewer: { id: 7, permission: 'maintain' } })
    await expect(eligibleCurrentHeadApprovalCount([
      { id: 10, user: { id: 7, login: 'reviewer' }, state: 'APPROVED', commit_id: 'head' },
      { id: 11, user: { id: 7, login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: 'head' },
    ], 'head', fetcher)).resolves.toBe(0)
    await expect(eligibleCurrentHeadApprovalCount([
      { id: 13, user: { id: 7, login: 'reviewer' }, state: 'APPROVED', commit_id: 'head' },
      { id: 12, user: { id: 7, login: 'reviewer' }, state: 'CHANGES_REQUESTED', commit_id: 'head' },
      { id: 14, user: { id: 8, login: 'dismissed' }, state: 'DISMISSED', commit_id: 'head' },
    ], 'head', fetcher)).resolves.toBe(1)
  })

  it('requires the real number of distinct current approvals', async () => {
    const reviews = [
      { id: 20, user: { id: 7, login: 'first' }, state: 'APPROVED', commit_id: 'head' },
      { id: 21, user: { id: 8, login: 'second' }, state: 'APPROVED', commit_id: 'head' },
    ]
    const fetcher = permissionFetcher({
      first: { id: 7, permission: 'write' },
      second: { id: 8, permission: 'admin' },
    })
    await expect(eligibleCurrentHeadApprovalCount(reviews, 'head', fetcher)).resolves.toBe(2)
    await expect(eligibleCurrentHeadApprovalCount(reviews.slice(0, 1), 'head', fetcher)).resolves.toBe(1)
  })

  it('counts only current reviewers whose repository permission can approve', async () => {
    const reviews = [
      { id: 20, user: { id: 7, login: 'outsider' }, state: 'APPROVED', commit_id: 'head' },
      { id: 21, user: { id: 8, login: 'maintainer' }, state: 'APPROVED', commit_id: 'head' },
    ]
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.includes('/collaborators/outsider/permission')) {
        return new Response(JSON.stringify({ permission: 'read', user: { id: 7, login: 'outsider' } }), { status: 200 })
      }
      if (url.includes('/collaborators/maintainer/permission')) {
        return new Response(JSON.stringify({ permission: 'maintain', user: { id: 8, login: 'maintainer' } }), { status: 200 })
      }
      return new Response('{}', { status: 500 })
    }) as typeof fetch
    await expect(eligibleCurrentHeadApprovalCount(reviews, 'head', fetcher)).resolves.toBe(1)
    await expect(eligibleCurrentHeadApprovalCount(reviews, 'head', vi.fn(async () => new Response('{}', { status: 503 })) as typeof fetch))
      .rejects.toThrow('github_reviewer_permission_unreadable')
  })

  it('never projects a retargeted or closed PR as ready', () => {
    const valid = { merged: false, state: 'open' as const, baseRef: 'master', checks: 'passed' as const, approved: true, mergeable: true }
    expect(projectReleaseMergeState(valid)).toBe('ready')
    expect(projectReleaseMergeState({ ...valid, baseRef: 'release' })).toBe('blocked')
    expect(projectReleaseMergeState({ ...valid, state: 'closed' })).toBe('blocked')
    expect(projectReleaseMergeState({ ...valid, checks: 'failed' })).toBe('blocked')
    expect(projectReleaseMergeState({ ...valid, checks: 'pending' })).toBe('blocked')
    expect(projectReleaseMergeState({ ...valid, approved: false })).toBe('blocked')
    expect(projectReleaseMergeState({ ...valid, mergeable: false })).toBe('blocked')
  })

  it('reports ready only under the complete publisher branch policy', () => {
    const protection = {
      required_status_checks: {
        strict: true,
        contexts: ['verify', 'container-isolation'],
        checks: [{ context: 'verify', app_id: 41 }, { context: 'container-isolation', app_id: 42 }],
      },
      required_pull_request_reviews: {
        required_approving_review_count: 2,
        dismiss_stale_reviews: true,
        require_code_owner_reviews: false,
        require_last_push_approval: false,
        dismissal_restrictions: { users: [], teams: [], apps: [] },
        bypass_pull_request_allowances: { users: [], teams: [], apps: [] },
      },
      enforce_admins: { enabled: true },
      required_conversation_resolution: { enabled: true },
      required_linear_history: { enabled: true },
      allow_force_pushes: { enabled: false },
      allow_deletions: { enabled: false },
      restrictions: { users: [], teams: [], apps: [] },
    }
    expect(projectBranchProtection(protection, { enabled: true })).toEqual({
      requiredApprovalCount: 2,
      requiredChecks: [
        { name: 'verify', appId: 41 },
        { name: 'container-isolation', appId: 42 },
      ],
    })
    expect(projectBranchProtection({
      ...protection,
      required_status_checks: {
        ...protection.required_status_checks,
        checks: [{ context: 'verify', app_id: 41 }, { context: 'container-isolation', app_id: 42 }],
      },
    }, { enabled: true })?.requiredChecks).toEqual([
      { name: 'verify', appId: 41 },
      { name: 'container-isolation', appId: 42 },
    ])
    expect(projectBranchProtection({ ...protection, required_status_checks: { ...protection.required_status_checks, strict: false } }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      required_status_checks: {
        ...protection.required_status_checks,
        checks: [{ context: 'verify', app_id: -1 }, { context: 'container-isolation', app_id: 42 }],
      },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      required_status_checks: {
        ...protection.required_status_checks,
        checks: [{ context: 'verify', app_id: null }, { context: 'container-isolation', app_id: 42 }],
      },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      required_status_checks: {
        ...protection.required_status_checks,
        contexts: ['verify', 'container-isolation', 'security-scan'],
      },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      required_pull_request_reviews: {
        ...protection.required_pull_request_reviews,
        bypass_pull_request_allowances: { users: [{ login: 'owner' }], teams: [], apps: [] },
      },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      required_pull_request_reviews: {
        ...protection.required_pull_request_reviews,
        require_code_owner_reviews: true,
      },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      required_pull_request_reviews: {
        ...protection.required_pull_request_reviews,
        require_last_push_approval: true,
      },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      required_pull_request_reviews: {
        ...protection.required_pull_request_reviews,
        dismissal_restrictions: { users: [{ login: 'owner' }], teams: [], apps: [] },
      },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection({
      ...protection,
      restrictions: { users: [], teams: [{ slug: 'release' }], apps: [] },
    }, { enabled: true })).toBeNull()
    expect(projectBranchProtection(protection, { enabled: false })?.requiredApprovalCount).toBe(2)
    expect(projectBranchProtection(protection, null)?.requiredApprovalCount).toBe(2)
    expect(projectBranchProtection({
      ...protection,
      required_pull_request_reviews: {
        required_approving_review_count: 0,
        require_code_owner_reviews: false,
        require_last_push_approval: false,
      },
      restrictions: undefined,
    }, { enabled: false })?.requiredApprovalCount).toBe(0)
    for (const invalid of [null, undefined, '0', -1, 0.5]) {
      expect(projectBranchProtection({ ...protection, required_pull_request_reviews: {
        ...protection.required_pull_request_reviews, required_approving_review_count: invalid,
      } }, { enabled: false })).toBeNull()
    }
    expect(projectBranchProtection({ ...protection, required_pull_request_reviews: {
      ...protection.required_pull_request_reviews, required_approving_review_count: 1, dismiss_stale_reviews: false,
    } }, { enabled: false })).toBeNull()
    expect(projectBranchProtection(protection, {})).toBeNull()
    expect(hasNoActiveBranchRules([])).toBe(true)
    expect(hasNoActiveBranchRules([{ type: 'required_status_checks', ruleset_id: 42 }])).toBe(false)
    expect(hasNoActiveBranchRules(null)).toBe(false)
  })
})
