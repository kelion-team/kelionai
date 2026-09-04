export const REQUIRED_MERGE_CHECKS = Object.freeze([
  'verify',
  'container-isolation',
  'current-tree',
  'merge-policy',
])

export const GITHUB_ACTIONS_APP_ID = 15368 // hardcod-permis: identificatorul public, stabil, al GitHub Actions

export const RELEASE_QA_GATES = Object.freeze([
  ['master-routing', 'merge-policy', 60, 'workflow route test'],
  ['permissions-secrets', 'workflow-security', 60, 'least-privilege and redaction test'],
  ['triggers-heartbeat', 'release-verifier', 60, 'push, workflow_run and schedule receipts'],
  ['review-conversations', 'merge-policy', 60, 'complete GraphQL reviewThreads snapshot'],
  ['sync-conflicts', 'merge-policy', 60, 'strict compare and mergeability snapshot'],
  ['required-checks', 'branch-protection', 60, 'required contexts bound to GitHub Actions app'],
  ['artifact-provenance', 'build-release-images', 7200, 'signed digest manifest and artifact identity'],
  ['dependency-image-security', 'pr-verify', 3600, 'secret, dependency and container gates'],
  ['deploy-idempotency', 'production-release', 300, 'canonical UUID and concurrency receipt'],
  ['migration-compatibility', 'production-release', 1800, 'migration plan, backup and rollback contract'],
  ['live-version', 'release-verifier', 60, 'exact /api/version commit prefix'],
  ['health-smoke-contract', 'release-verifier', 60, 'ready, live, health and release proof samples'],
  ['post-deploy-window', 'release-verifier', 300, 'consecutive independent live samples'],
  ['rollback-seal', 'release-verifier', 60, 'active marker, release ledger and rollback-capable workflow'],
  ['observability-correlation', 'release-verifier', 60, 'PR/SHA/CI/build/deploy/check correlation'],
  ['retry-rate-outage', 'release-verifier', 60, 'bounded retry, backoff and fail-closed incident'],
  ['cost-safe-stop', 'release-verifier', 60, 'bounded API calls, wall clock and concurrency'],
  ['audit-retention-recovery', 'release-verifier', 60, 'tamper-evident GitHub check and incident history'],
  ['backup-restore-dr', 'production-release', 1800, 'verified backup/restore and recovery receipts'],
  ['privacy-environments-flags', 'production-release', 300, 'protected production environment and runtime contract'],
  ['alert-incident-runbook', 'release-verifier', 60, 'incident issue with deterministic escalation owner'],
].map(([id, owner, deadlineSeconds, evidence]) => Object.freeze({ id, owner, deadlineSeconds, evidence, failClosed: true, negativeTestRequired: true })))

const SHA = /^[0-9a-f]{40}$/

export function parseDeployTitle(title) {
  const match = String(title).match(/^production-([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})-([0-9a-f]{40})-([1-9][0-9]*)-([1-9][0-9]*)$/)
  if (!match) return null
  return { requestId: match[1], commit: match[2], ciRunId: Number(match[3]), buildRunId: Number(match[4]) }
}

export async function selectDeployEvidence(runs, loadJobs) {
  if (!Array.isArray(runs)) return { run: null, releaseJobQualified: false }
  if (typeof loadJobs !== 'function') throw new Error('invalid_deploy_jobs_loader')
  if (runs.some((run) => !Number.isSafeInteger(Number(run?.id)) || Number(run.id) <= 0)) {
    throw new Error('invalid_deploy_run_identity')
  }
  const ordered = [...runs].sort((left, right) => {
    const leftId = Number(left?.id)
    const rightId = Number(right?.id)
    return rightId - leftId
  })
  const successful = ordered.filter((run) => run?.status === 'completed' && run?.conclusion === 'success')
  const qualified = []
  for (const run of successful) {
    const identity = parseDeployTitle(run?.display_title)
    if (!identity) throw new Error('invalid_deploy_run_identity')
    const jobs = await loadJobs(Number(run.id))
    if (!Array.isArray(jobs)) throw new Error('invalid_deploy_jobs')
    const releaseJobs = jobs.filter((job) => job?.name === 'release')
    if (releaseJobs.length > 1) throw new Error('invalid_deploy_jobs')
    if (releaseJobs.length === 1 && releaseJobs[0]?.conclusion === 'success') {
      qualified.push({ run, requestId: identity.requestId })
    }
  }

  const pending = ordered.find((run) => run?.status !== 'completed')
  if (pending) return { run: pending, releaseJobQualified: false }

  const qualifiedRequestIds = new Set(qualified.map(({ requestId }) => requestId))
  if (qualifiedRequestIds.size > 1) throw new Error('ambiguous_successful_deploy_requests')
  if (qualified.length > 0) return { run: qualified[0].run, releaseJobQualified: true }

  const unrecoveredFailure = ordered.find((run) => run?.status === 'completed' && run?.conclusion !== 'success')
  return {
    run: unrecoveredFailure ?? successful[0] ?? null,
    releaseJobQualified: false,
  }
}

function emptyNamedActorSet(value) {
  if (value === null) return true
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return ['users', 'teams', 'apps'].every((key) => Array.isArray(value[key]) && value[key].length === 0)
}

export function evaluateBranchProtection(protection, requiredSignatures, activeBranchRules = []) {
  const configuredContexts = protection?.required_status_checks?.contexts
  const configuredChecks = protection?.required_status_checks?.checks
  const checks = new Set([
    ...(Array.isArray(configuredContexts) ? configuredContexts : []),
    ...(Array.isArray(configuredChecks) ? configuredChecks.map((check) => check?.context) : []),
  ])
  const missing = REQUIRED_MERGE_CHECKS.filter((name) => !checks.has(name))
  if (checks.size !== REQUIRED_MERGE_CHECKS.length) missing.push('exact-required-checks')
  for (const name of REQUIRED_MERGE_CHECKS) {
    const matching = Array.isArray(configuredChecks) ? configuredChecks.filter((check) => check?.context === name) : []
    if (matching.length !== 1 || Number(matching[0]?.app_id) !== GITHUB_ACTIONS_APP_ID) missing.push(`trusted-app:${name}`)
  }
  if (protection?.required_status_checks?.strict !== true) missing.push('strict-sync')
  if (protection?.required_conversation_resolution?.enabled !== true) missing.push('conversation-resolution')
  if (protection?.enforce_admins?.enabled !== true) missing.push('enforce-admins')
  const reviews = protection?.required_pull_request_reviews
  if (!Number.isSafeInteger(reviews?.required_approving_review_count) || reviews.required_approving_review_count < 1) missing.push('human-review')
  if (reviews?.dismiss_stale_reviews !== true) missing.push('dismiss-stale-reviews')
  if (reviews?.require_code_owner_reviews !== false) missing.push('code-owner-policy')
  if (reviews?.require_last_push_approval !== false) missing.push('last-push-policy')
  if (!emptyNamedActorSet(reviews?.dismissal_restrictions)) missing.push('review-dismissal-restrictions')
  if (!emptyNamedActorSet(reviews?.bypass_pull_request_allowances)) missing.push('review-bypass')
  if (protection?.required_linear_history?.enabled !== true) missing.push('linear-history')
  if (requiredSignatures?.enabled !== true) missing.push('signed-commits')
  if (!emptyNamedActorSet(protection?.restrictions)) missing.push('push-restrictions')
  if (protection?.allow_force_pushes?.enabled !== false) missing.push('force-push-disabled')
  if (protection?.allow_deletions?.enabled !== false) missing.push('deletion-disabled')
  if (!Array.isArray(activeBranchRules) || activeBranchRules.length !== 0) missing.push('unsupported-ruleset')
  return { ok: missing.length === 0, missing }
}

export function evaluateLiveSample(sample, commit) {
  if (!SHA.test(String(commit))) return { ok: false, missing: ['commit'] }
  const expected = commit.slice(0, 7)
  const missing = []
  if (sample?.version?.status !== 200 || sample.version.body?.v !== expected) missing.push('live-version')
  const ready = sample?.ready?.body
  if (sample?.ready?.status !== 200 || ready?.ready !== true || !ready?.checks || Object.values(ready.checks).some((value) => value !== true) || ready?.release?.candidate !== false || ready?.release?.sideEffectsActive !== true) missing.push('readiness')
  if (sample?.live?.status !== 200 || sample.live.body?.status !== 'alive') missing.push('liveness')
  if (sample?.health?.status !== 200 || sample.health.body?.status !== 'ok') missing.push('health')
  const proof = sample?.proof?.body
  if (sample?.proof?.status !== 200 || proof?.ready !== true || proof?.release?.candidate !== false || proof?.release?.sideEffectsActive !== true || proof?.activeCommit !== commit) missing.push('release-proof')
  return { ok: missing.length === 0, missing }
}

export function evaluateReleaseEvidence(evidence) {
  const missing = []
  if (!SHA.test(String(evidence?.commit))) missing.push('commit')
  if (evidence?.masterHead !== evidence?.commit) missing.push('master-head')
  if (evidence?.branchProtection?.ok !== true) missing.push('branch-protection')
  if (evidence?.ci?.conclusion !== 'success') missing.push('ci')
  if (evidence?.build?.conclusion !== 'success' || evidence?.artifactVerified !== true) missing.push('artifact')
  if (evidence?.deploy?.conclusion !== 'success' || evidence?.deployIdentityValid !== true) missing.push('deploy')
  if (!Array.isArray(evidence?.liveSamples) || evidence.liveSamples.length < 3 || evidence.liveSamples.some((sample) => sample.ok !== true)) missing.push('post-deploy-live')
  if (evidence?.rollbackContractVerified !== true) missing.push('rollback-seal')
  return { delivered: missing.length === 0, missing }
}

export function matrixIsFailClosed(matrix = RELEASE_QA_GATES) {
  return matrix.length >= 20 && matrix.every((gate) => gate.failClosed === true && gate.negativeTestRequired === true && gate.owner && Number.isSafeInteger(gate.deadlineSeconds) && gate.deadlineSeconds > 0 && gate.evidence)
}
