import { config } from '../config.js'

type FetchLike = typeof fetch
type CheckState = 'passed' | 'pending' | 'failed' | 'unknown'

interface GitHubCheckRun {
  id?: number
  name?: string
  conclusion?: string | null
  status?: string
  app?: { id?: number }
  details_url?: string
  head_sha?: string
  check_suite?: { id?: number }
  pull_requests?: Array<Record<string, any>>
}

interface RequiredCheckPolicy { name: string; appId: number }

interface GitHubReview {
  id?: number
  state?: string
  commit_id?: string
  submitted_at?: string
  user?: { id?: number; login?: string }
}

function emptyNamedActorSet(value: unknown): boolean {
  if (value === null) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return ['users', 'teams', 'apps'].every((key) => Array.isArray(record[key]) && record[key].length === 0)
}

export function hasNoActiveBranchRules(value: unknown): boolean {
  return Array.isArray(value) && value.length === 0
}

export function requiredConstructorChecks(raw = process.env.CONSTRUCTOR_REQUIRED_CHECKS ?? 'verify,container-isolation'): string[] {
  return [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))]
}

export function projectRequiredChecks(
  checkRuns: readonly GitHubCheckRun[],
  required = requiredConstructorChecks(),
  policies: readonly RequiredCheckPolicy[] = [],
  canonicalCheckIds: Readonly<Record<string, number>> | null = null,
): CheckState {
  if (
    required.length === 0
    || policies.length !== required.length
    || policies.some((policy, index) =>
      policy.name !== required[index]
      || !Number.isSafeInteger(policy.appId)
      || policy.appId <= 0)
  ) return 'unknown'
  if (canonicalCheckIds === null) return 'pending'
  if (
    Object.keys(canonicalCheckIds).length !== required.length
    || required.some((name) => !Number.isSafeInteger(canonicalCheckIds[name]) || canonicalCheckIds[name] <= 0)
  ) return 'unknown'
  const checks = policies.map((policy) => checkRuns
    .filter((check) =>
      check.name === policy.name
      && Number.isSafeInteger(check.id)
      && Number(check.id) > 0
      && check.id === canonicalCheckIds[policy.name]
      && check.app?.id === policy.appId,
    )
    .sort((left, right) => Number(left.id) - Number(right.id))
    .at(-1))
  if (checks.some((check) => check?.status === 'completed' && check.conclusion !== 'success')) return 'failed'
  if (checks.some((check) => !check || check.status !== 'completed')) return 'pending'
  return checks.every((check) => check?.conclusion === 'success') ? 'passed' : 'failed'
}

export function projectBranchProtection(
  protection: Record<string, any>,
  requiredSignatures: Record<string, any>,
  requiredChecks = requiredConstructorChecks(),
): { requiredApprovalCount: number; requiredChecks: RequiredCheckPolicy[] } | null {
  const statusChecks = protection.required_status_checks
  const configuredContexts = statusChecks?.contexts
  const configuredChecks = statusChecks?.checks ?? []
  if (
    !Array.isArray(configuredContexts)
    || !Array.isArray(configuredChecks)
    || configuredContexts.some((value: unknown) => typeof value !== 'string' || value.length === 0)
    || configuredChecks.some((item: { context?: unknown }) => typeof item?.context !== 'string' || item.context.length === 0)
  ) return null
  const contexts = new Set<string>([
    ...configuredContexts,
    ...configuredChecks.map((item: { context: string }) => item.context),
  ])
  const reviews = protection.required_pull_request_reviews
  const requiredApprovalCount = Number(reviews?.required_approving_review_count)
  const bypass = reviews?.bypass_pull_request_allowances
  const dismissalRestrictions = reviews?.dismissal_restrictions
  const requiredCheckPolicies: RequiredCheckPolicy[] = []
  for (const name of requiredChecks) {
    const matching = configuredChecks.filter((item: { context?: unknown }) => item?.context === name)
    if (matching.length !== 1) return null
    const configuredAppId = matching[0]?.app_id
    const appId = Number(configuredAppId)
    if (!Number.isSafeInteger(appId) || appId <= 0) return null
    requiredCheckPolicies.push({ name, appId })
  }
  if (
    statusChecks?.strict !== true
    || contexts.size !== requiredChecks.length
    || !requiredChecks.every((name) => contexts.has(name))
    || protection.enforce_admins?.enabled !== true
    || !Number.isSafeInteger(requiredApprovalCount)
    || requiredApprovalCount <= 0
    || reviews?.dismiss_stale_reviews !== true
    || reviews?.require_code_owner_reviews !== false
    || reviews?.require_last_push_approval !== false
    || !emptyNamedActorSet(dismissalRestrictions)
    || !Array.isArray(bypass?.users) || bypass.users.length !== 0
    || !Array.isArray(bypass?.teams) || bypass.teams.length !== 0
    || !Array.isArray(bypass?.apps) || bypass.apps.length !== 0
    || protection.required_conversation_resolution?.enabled !== true
    || protection.required_linear_history?.enabled !== true
    || requiredSignatures.enabled !== true
    || !emptyNamedActorSet(protection.restrictions)
    || protection.allow_force_pushes?.enabled !== false
    || protection.allow_deletions?.enabled !== false
  ) return null
  return { requiredApprovalCount, requiredChecks: requiredCheckPolicies }
}

function currentHeadApprovedReviews(
  reviews: readonly GitHubReview[],
  headSha: string,
  submittedNoLaterThan: string | null = null,
): GitHubReview[] {
  const decisive = new Set(['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED'])
  const cutoff = submittedNoLaterThan === null ? null : Date.parse(submittedNoLaterThan)
  if (submittedNoLaterThan !== null && !Number.isFinite(cutoff)) return []
  const latestByReviewer = new Map<number, GitHubReview>()
  const ordered = reviews
    .filter((review) =>
      review.commit_id === headSha
      && decisive.has(String(review.state ?? ''))
      && Number.isSafeInteger(review.id)
      && Number(review.id) > 0
      && Number.isSafeInteger(review.user?.id)
      && Number(review.user?.id) > 0
      && (cutoff === null || (
        Number.isFinite(Date.parse(String(review.submitted_at ?? '')))
        && Date.parse(String(review.submitted_at)) <= cutoff
      )),
    )
    .sort((left, right) => Number(left.id) - Number(right.id))
  for (const review of ordered) latestByReviewer.set(Number(review.user!.id), review)
  return [...latestByReviewer.values()].filter((review) => review.state === 'APPROVED')
}

export async function eligibleCurrentHeadApprovalCount(
  reviews: readonly GitHubReview[],
  headSha: string,
  fetcher: FetchLike,
  submittedNoLaterThan: string | null = null,
): Promise<number> {
  const approved = currentHeadApprovedReviews(reviews, headSha, submittedNoLaterThan)
  let eligible = 0
  for (const review of approved) {
    const login = review.user?.login
    const id = Number(review.user?.id)
    if (typeof login !== 'string' || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
      throw new Error('github_reviewer_identity_invalid')
    }
    const response = await github(`/collaborators/${encodeURIComponent(login)}/permission`, fetcher)
    if (!response.ok) throw new Error('github_reviewer_permission_unreadable')
    const payload = await response.json() as { permission?: unknown; user?: { id?: unknown; login?: unknown } }
    if (Number(payload.user?.id) !== id || String(payload.user?.login ?? '').toLowerCase() !== login.toLowerCase()) {
      throw new Error('github_reviewer_permission_identity_mismatch')
    }
    if (['write', 'maintain', 'admin'].includes(String(payload.permission ?? ''))) eligible += 1
  }
  return eligible
}

export interface ReleaseSnapshot {
  integration: 'ready' | 'setup_required' | 'unavailable'
  setupInstructions: string | null
  pr: null | { number: number; title: string; url: string; state: 'open' | 'closed'; merged: boolean; headSha: string; baseRef: string }
  checks: CheckState
  approval: 'approved' | 'required' | 'unknown'
  merge: 'ready' | 'blocked' | 'merged' | 'unknown'
  nextAction: string
}

export function projectReleaseMergeState(input: {
  merged: boolean
  state: 'open' | 'closed'
  baseRef: string
  checks: CheckState
  approved: boolean
  mergeable: boolean
}): ReleaseSnapshot['merge'] {
  if (input.merged) return 'merged'
  if (input.state !== 'open' || input.baseRef !== 'master') return 'blocked'
  if (input.checks === 'unknown') return 'unknown'
  return input.checks === 'passed' && input.approved && input.mergeable ? 'ready' : 'blocked'
}

function configured(): boolean {
  return config.githubReleaseOAuthToken.length > 0 && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.githubRepo)
}

function headers(): HeadersInit {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${config.githubReleaseOAuthToken}`,
    'x-github-api-version': '2022-11-28',
  }
}

function prNumber(url: string | null): number | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const expected = `/${config.githubRepo}/pull/`
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || !parsed.pathname.startsWith(expected)) return null
    const value = Number(parsed.pathname.slice(expected.length))
    return Number.isSafeInteger(value) && value > 0 ? value : null
  } catch { return null }
}

function setup(): ReleaseSnapshot {
  return {
    integration: 'setup_required', setupInstructions: 'Configurează OAuth GitHub server-side pentru Admin (GITHUB_RELEASE_OAUTH_TOKEN_FILE), cu acces limitat la acest repository și permisiuni Pull requests: write, Checks: read, Actions: read, Contents: read și Administration: read pentru politica ramurii. Tokenul nu ajunge în browser și nu poate publica direct în master.',
    pr: null, checks: 'unknown', approval: 'unknown', merge: 'unknown', nextAction: 'Conectează integrarea GitHub în secret store; apoi reîncarcă acest panou.',
  }
}

async function github(path: string, fetcher: FetchLike): Promise<Response> {
  return fetcher(`https://api.github.com/repos/${config.githubRepo}${path}`, { headers: headers(), signal: AbortSignal.timeout(10_000) })
}

async function githubReviews(number: number, fetcher: FetchLike): Promise<GitHubReview[]> {
  const all: GitHubReview[] = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await github(`/pulls/${number}/reviews?per_page=100&page=${page}`, fetcher)
    if (!response.ok) throw new Error('github_reviews_unreadable')
    const payload = await response.json()
    if (!Array.isArray(payload)) throw new Error('github_reviews_invalid')
    all.push(...payload as GitHubReview[])
    if (payload.length < 100) return all
  }
  throw new Error('github_reviews_pagination_exhausted')
}

async function githubCheckRuns(headSha: string, fetcher: FetchLike): Promise<GitHubCheckRun[]> {
  const all: GitHubCheckRun[] = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await github(`/commits/${encodeURIComponent(headSha)}/check-runs?filter=all&per_page=100&page=${page}`, fetcher)
    if (!response.ok) throw new Error('github_checks_unreadable')
    const payload = await response.json() as { check_runs?: unknown }
    if (!Array.isArray(payload?.check_runs)) throw new Error('github_checks_invalid')
    all.push(...payload.check_runs as GitHubCheckRun[])
    if (payload.check_runs.length < 100) return all
  }
  throw new Error('github_checks_pagination_exhausted')
}

async function githubActiveBranchRules(fetcher: FetchLike): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await github(`/rules/branches/master?per_page=100&page=${page}`, fetcher)
    if (!response.ok) throw new Error('github_branch_rules_unreadable')
    const payload = await response.json()
    if (!Array.isArray(payload)) throw new Error('github_branch_rules_invalid')
    all.push(...payload as Record<string, unknown>[])
    if (payload.length < 100) return all
  }
  throw new Error('github_branch_rules_pagination_exhausted')
}

const CANONICAL_CI_WORKFLOW = '.github/workflows/pr-verify.yml'

function canonicalWorkflowRunPath(value: unknown): boolean {
  return typeof value === 'string' && (
    value === CANONICAL_CI_WORKFLOW
    || (value.startsWith(`${CANONICAL_CI_WORKFLOW}@`) && /^@[A-Za-z0-9._/-]{1,300}$/.test(value.slice(CANONICAL_CI_WORKFLOW.length)))
  )
}

export function parseGitHubActionsCheckCoordinates(
  detailsUrl: string | undefined,
  repository = config.githubRepo,
): { runId: number; jobId: number } | null {
  try {
    const url = new URL(String(detailsUrl ?? ''))
    const match = url.pathname.match(new RegExp(`^/${repository.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/actions/runs/([1-9][0-9]*)/job/([1-9][0-9]*)$`))
    if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash || !match) return null
    const runId = Number(match[1])
    const jobId = Number(match[2])
    return Number.isSafeInteger(runId) && Number.isSafeInteger(jobId) ? { runId, jobId } : null
  } catch { return null }
}

export function checkRunMatchesPullRequestIdentity(
  check: GitHubCheckRun,
  expected: { number: number; headSha: string; headRef: string; repository: string },
  requireAssociation: boolean,
): boolean {
  if (check.head_sha !== expected.headSha) return false
  if (!Array.isArray(check.pull_requests) || check.pull_requests.length === 0) return !requireAssociation
  return check.pull_requests.every((pr) =>
    Number(pr?.number) === expected.number
    && pr?.head?.sha === expected.headSha
    && pr?.head?.ref === expected.headRef
    && pr?.head?.repo?.url === `https://api.github.com/repos/${expected.repository}`
    && pr?.base?.ref === 'master'
    && pr?.base?.repo?.url === `https://api.github.com/repos/${expected.repository}`)
}

async function workflowSourceSha(ref: string, fetcher: FetchLike): Promise<string> {
  const response = await github(`/contents/${CANONICAL_CI_WORKFLOW}?ref=${encodeURIComponent(ref)}`, fetcher)
  if (!response.ok) throw new Error('github_ci_workflow_unreadable')
  const payload = await response.json() as { type?: unknown; sha?: unknown }
  if (payload?.type !== 'file' || typeof payload.sha !== 'string' || !/^[0-9a-f]{40}$/.test(payload.sha)) {
    throw new Error('github_ci_workflow_invalid')
  }
  return payload.sha
}

async function workflowJobs(runId: number, fetcher: FetchLike): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = []
  for (let page = 1; page <= 100; page += 1) {
    const response = await github(`/actions/runs/${runId}/jobs?filter=latest&per_page=100&page=${page}`, fetcher)
    if (!response.ok) throw new Error('github_ci_jobs_unreadable')
    const payload = await response.json() as { jobs?: unknown }
    if (!Array.isArray(payload?.jobs)) throw new Error('github_ci_jobs_invalid')
    all.push(...payload.jobs as Record<string, unknown>[])
    if (payload.jobs.length < 100) return all
  }
  throw new Error('github_ci_jobs_pagination_exhausted')
}

async function canonicalCheckRunIds(
  prNumber: number,
  headSha: string,
  headRef: string,
  baseSha: string,
  checkRuns: readonly GitHubCheckRun[],
  policies: readonly RequiredCheckPolicy[],
  fetcher: FetchLike,
  requirePullRequestAssociation: boolean,
): Promise<Record<string, number> | null> {
  const selected = policies.map((policy) => checkRuns
    .filter((check) => check.name === policy.name && check.app?.id === policy.appId && Number.isSafeInteger(check.id) && Number(check.id) > 0)
    .sort((left, right) => Number(left.id) - Number(right.id))
    .at(-1))
  if (selected.some((check) => !check)) return null
  const coordinates = selected.map((check) => parseGitHubActionsCheckCoordinates(check!.details_url))
  if (coordinates.some((value) => value === null)) throw new Error('github_ci_check_provenance_invalid')
  const runIds = new Set(coordinates.map((value) => value!.runId))
  if (runIds.size !== 1) throw new Error('github_ci_checks_from_multiple_runs')
  const suiteIds = new Set(selected.map((check) => Number(check?.check_suite?.id)))
  if (suiteIds.size !== 1 || !Number.isSafeInteger([...suiteIds][0]) || [...suiteIds][0] <= 0) {
    throw new Error('github_ci_check_suite_invalid')
  }
  const suiteId = [...suiteIds][0]!
  for (const check of selected) {
    if (!checkRunMatchesPullRequestIdentity(check!, {
      number: prNumber,
      headSha,
      headRef,
      repository: config.githubRepo,
    }, requirePullRequestAssociation)) throw new Error('github_ci_check_pr_identity_invalid')
  }
  const runId = coordinates[0]!.runId
  const [workflowResponse, runResponse, jobs, headWorkflowSha, baseWorkflowSha] = await Promise.all([
    github('/actions/workflows/pr-verify.yml', fetcher),
    github(`/actions/runs/${runId}`, fetcher),
    workflowJobs(runId, fetcher),
    workflowSourceSha(headSha, fetcher),
    workflowSourceSha(baseSha, fetcher),
  ])
  if (!workflowResponse.ok || !runResponse.ok) throw new Error('github_ci_run_unreadable')
  const workflow = await workflowResponse.json() as Record<string, any>
  const run = await runResponse.json() as Record<string, any>
  if (
    Number(run.id) !== runId
    || !Number.isSafeInteger(Number(workflow.id))
    || Number(workflow.id) <= 0
    || workflow.path !== CANONICAL_CI_WORKFLOW
    || workflow.state !== 'active'
    || Number(run.workflow_id) !== Number(workflow.id)
    || Number(run.check_suite_id) !== suiteId
    || !canonicalWorkflowRunPath(run.path)
    || run.event !== 'pull_request'
    || run.head_sha !== headSha
    || run.head_branch !== headRef
    || run.repository?.full_name !== config.githubRepo
    || headWorkflowSha !== baseWorkflowSha
  ) throw new Error('github_ci_run_provenance_invalid')
  const canonical: Record<string, number> = {}
  for (let index = 0; index < policies.length; index += 1) {
    const policy = policies[index]!
    const check = selected[index]!
    const coordinate = coordinates[index]!
    const matching = jobs.filter((job) =>
      Number(job.id) === coordinate.jobId
      && Number(job.run_id) === runId
      && job.head_sha === headSha
      && job.name === policy.name
      && job.check_run_url === `https://api.github.com/repos/${config.githubRepo}/check-runs/${check.id}`,
    )
    if (matching.length !== 1) throw new Error('github_ci_job_provenance_invalid')
    canonical[policy.name] = Number(check.id)
  }
  return canonical
}

export async function readReleaseSnapshot(prUrl: string | null, fetcher: FetchLike = fetch): Promise<ReleaseSnapshot> {
  if (!configured()) return setup()
  const number = prNumber(prUrl)
  if (!number) return { integration: 'ready', setupInstructions: null, pr: null, checks: 'unknown', approval: 'unknown', merge: 'unknown', nextAction: 'Așteaptă ca workerul să deschidă un PR sau selectează un ordin care are PR.' }
  try {
    const [prResponse, reviews, protectionResponse, signaturesResponse, activeBranchRules] = await Promise.all([
      github(`/pulls/${number}`, fetcher),
      githubReviews(number, fetcher),
      github('/branches/master/protection', fetcher),
      github('/branches/master/protection/required_signatures', fetcher),
      githubActiveBranchRules(fetcher),
    ])
    if (!prResponse.ok || !protectionResponse.ok || !signaturesResponse.ok) throw new Error('github_pr_or_protection_unreadable')
    const pr = await prResponse.json() as Record<string, unknown>
    const protection = await protectionResponse.json() as Record<string, any>
    const requiredSignatures = await signaturesResponse.json() as Record<string, any>
    if (!hasNoActiveBranchRules(activeBranchRules)) throw new Error('github_branch_rules_unsupported')
    const policy = projectBranchProtection(protection, requiredSignatures)
    if (!policy) throw new Error('github_branch_policy_invalid')
    const { requiredApprovalCount, requiredChecks } = policy
    const head = pr.head as { sha?: unknown; ref?: unknown; repo?: { full_name?: unknown } } | undefined
    const base = pr.base as { ref?: unknown; sha?: unknown; repo?: { full_name?: unknown } } | undefined
    const expectedUrl = `https://github.com/${config.githubRepo}/pull/${number}`
    if (
      typeof head?.sha !== 'string'
      || !/^[0-9a-f]{40}$/.test(head.sha)
      || typeof head?.ref !== 'string'
      || !/^[A-Za-z0-9._/-]{1,240}$/.test(head.ref)
      || head.repo?.full_name !== config.githubRepo
      || typeof base?.ref !== 'string'
      || typeof base?.sha !== 'string'
      || !/^[0-9a-f]{40}$/.test(base.sha)
      || base.repo?.full_name !== config.githubRepo
      || Number(pr.number) !== number
      || pr.html_url !== expectedUrl
    ) throw new Error('github_pr_identity_invalid')
    const checkRuns = await githubCheckRuns(head.sha, fetcher)
    const canonicalCheckIds = await canonicalCheckRunIds(
      number,
      head.sha,
      head.ref,
      base.sha,
      checkRuns,
      requiredChecks,
      fetcher,
      pr.merged !== true,
    )
    const checkState: CheckState = projectRequiredChecks(checkRuns, requiredConstructorChecks(), requiredChecks, canonicalCheckIds)
    const headSha = typeof head?.sha === 'string' ? head.sha : ''
    const approvalCount = await eligibleCurrentHeadApprovalCount(reviews, headSha, fetcher)
    const approved = approvalCount >= requiredApprovalCount
    const merged = pr.merged === true
    const mergeable = pr.mergeable === true
    const state: 'open' | 'closed' = pr.state === 'open' ? 'open' : 'closed'
    const baseRef = base.ref
    const merge = projectReleaseMergeState({ merged, state, baseRef, checks: checkState, approved, mergeable })
    return {
      integration: 'ready', setupInstructions: null,
      pr: { number, title: typeof pr.title === 'string' ? pr.title.slice(0, 240) : `PR #${number}`, url: expectedUrl, state, merged, headSha, baseRef },
      checks: checkState, approval: approved ? 'approved' : 'required', merge,
      nextAction: merged ? 'PR-ul este integrat; așteaptă dovada separată de deploy live.' : baseRef !== 'master' ? 'PR-ul a fost mutat de pe master; publisherul și Adminul îl refuză.' : state !== 'open' ? 'PR-ul este închis fără merge; reluarea trebuie să urmeze fluxul Constructor.' : checkState !== 'passed' ? 'Așteaptă sau repară verificările GitHub înainte de review.' : !approved ? 'Aprobă PR-ul din Kelion; GitHub poate aplica reguli suplimentare.' : merge === 'ready' ? 'Aprobarea și verificările sunt valide; publisherul separat va integra PR-ul și va înregistra receiptul.' : 'GitHub încă nu permite merge-ul; citește starea PR-ului.',
    }
  } catch {
    return { integration: 'unavailable', setupInstructions: null, pr: null, checks: 'unknown', approval: 'unknown', merge: 'unknown', nextAction: 'Integrarea GitHub nu poate fi citită acum. Verifică permisiunile OAuth și reîncearcă; nu presupune starea PR-ului.' }
  }
}

/** Adminul poate acorda review, dar publisherul este singura identitate care
 * execută merge-ul și persistă receiptul aferent. */
export async function approveRelease(
  prUrl: string | null,
  expectedPrNumber: number,
  expectedHeadSha: string,
  fetcher: FetchLike = fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!configured()) return { ok: false, error: 'github_integration_setup_required' }
  const number = prNumber(prUrl)
  if (!number) return { ok: false, error: 'invalid_pr_url' }
  const snapshot = await readReleaseSnapshot(prUrl, fetcher)
  if (
    snapshot.integration !== 'ready'
    || !snapshot.pr
    || snapshot.pr.merged
    || snapshot.pr.state !== 'open'
    || snapshot.pr.baseRef !== 'master'
    || snapshot.checks !== 'passed'
  ) return { ok: false, error: 'release_not_actionable' }
  if (snapshot.pr.number !== expectedPrNumber || snapshot.pr.headSha !== expectedHeadSha) {
    return { ok: false, error: 'release_snapshot_changed' }
  }
  try {
    const response = await fetcher(`https://api.github.com/repos/${config.githubRepo}/pulls/${number}/reviews`, { method: 'POST', headers: { ...headers(), 'content-type': 'application/json' }, body: JSON.stringify({ event: 'APPROVE', commit_id: expectedHeadSha }), signal: AbortSignal.timeout(10_000) })
    return response.ok ? { ok: true } : { ok: false, error: 'github_approval_rejected' }
  } catch { return { ok: false, error: 'github_unavailable' } }
}
