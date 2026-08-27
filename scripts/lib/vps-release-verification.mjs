export const REQUIRED_MERGE_CHECKS = Object.freeze([
  'verify',
  'container-isolation',
  'current-tree',
  'merge-policy',
])

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

export function evaluateBranchProtection(protection) {
  const checks = new Set(protection?.required_status_checks?.checks?.map((check) => check.context) ?? [])
  const missing = REQUIRED_MERGE_CHECKS.filter((name) => !checks.has(name))
  if (protection?.required_status_checks?.strict !== true) missing.push('strict-sync')
  if (protection?.required_conversation_resolution?.enabled !== true) missing.push('conversation-resolution')
  if (protection?.enforce_admins?.enabled !== true) missing.push('enforce-admins')
  if (protection?.allow_force_pushes?.enabled !== false) missing.push('force-push-disabled')
  return { ok: missing.length === 0, missing }
}

export function evaluateLiveSample(sample, commit) {
  if (!SHA.test(String(commit))) return { ok: false, missing: ['commit'] }
  const expected = commit.slice(0, 7)
  const missing = []
  if (sample?.version?.status !== 200 || sample.version.body?.v !== expected) missing.push('live-version')
  const ready = sample?.ready?.body
  if (sample?.ready?.status !== 200 || ready?.ready !== true || !ready?.checks || Object.values(ready.checks).some((value) => value !== true) || ready?.release?.candidate !== true || ready?.release?.sideEffectsActive !== true) missing.push('readiness')
  if (sample?.live?.status !== 200 || sample.live.body?.status !== 'alive') missing.push('liveness')
  if (sample?.health?.status !== 200 || sample.health.body?.status !== 'ok') missing.push('health')
  const proof = sample?.proof?.body
  if (sample?.proof?.status !== 200 || proof?.ready !== true || proof?.release?.sideEffectsActive !== true || proof?.activeCommit !== commit) missing.push('release-proof')
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
