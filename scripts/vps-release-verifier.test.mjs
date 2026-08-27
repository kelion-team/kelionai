import assert from 'node:assert/strict'
import test from 'node:test'
import { GITHUB_ACTIONS_APP_ID, RELEASE_QA_GATES, REQUIRED_MERGE_CHECKS, evaluateBranchProtection, evaluateLiveSample, evaluateReleaseEvidence, matrixIsFailClosed, parseDeployTitle } from './lib/vps-release-verification.mjs'

const sha = 'a'.repeat(40)
const protection = {
  required_status_checks: { strict: true, contexts: REQUIRED_MERGE_CHECKS, checks: REQUIRED_MERGE_CHECKS.map((context) => ({ context, app_id: GITHUB_ACTIONS_APP_ID })) },
  required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: true, require_code_owner_reviews: false, require_last_push_approval: false, dismissal_restrictions: null, bypass_pull_request_allowances: { users: [], teams: [], apps: [] } },
  required_conversation_resolution: { enabled: true },
  enforce_admins: { enabled: true },
  required_linear_history: { enabled: true },
  allow_force_pushes: { enabled: false },
  allow_deletions: { enabled: false },
  restrictions: null,
}
const healthy = {
  version: { status: 200, body: { v: sha.slice(0, 7) } },
  ready: { status: 200, body: { ready: true, checks: { config: true, database: true, migrations: true }, release: { candidate: true, sideEffectsActive: true } } },
  live: { status: 200, body: { status: 'alive' } },
  health: { status: 200, body: { status: 'ok' } },
  proof: { status: 200, body: { ready: true, activeCommit: sha, release: { sideEffectsActive: true } } },
}

test('matricea QA are owner, deadline, dovadă și negative test fail-closed pentru fiecare poartă', () => {
  assert.equal(matrixIsFailClosed(RELEASE_QA_GATES), true)
  assert.equal(new Set(RELEASE_QA_GATES.map((gate) => gate.id)).size, RELEASE_QA_GATES.length)
})

test('protecția refuză fiecare lipsă critică, inclusiv merge-policy și admin bypass', () => {
  assert.equal(evaluateBranchProtection(protection, { enabled: true }, []).ok, true)
  for (const context of REQUIRED_MERGE_CHECKS) {
    const changed = structuredClone(protection)
    changed.required_status_checks.checks = changed.required_status_checks.checks.filter((check) => check.context !== context)
    assert.equal(evaluateBranchProtection(changed, { enabled: true }, []).ok, false)
  }
  assert.equal(evaluateBranchProtection({ ...protection, enforce_admins: { enabled: false } }, { enabled: true }, []).ok, false)
})

test('identitatea deployului este exactă și respinge SHA scurt sau receipt incomplet', () => {
  const valid = parseDeployTitle(`production-123e4567-e89b-42d3-a456-426614174000-${sha}-12-13`)
  assert.deepEqual(valid, { requestId: '123e4567-e89b-42d3-a456-426614174000', commit: sha, ciRunId: 12, buildRunId: 13 })
  assert.equal(parseDeployTitle(`production-123e4567-e89b-42d3-a456-426614174000-${sha.slice(0, 8)}-12-13`), null)
})

test('live-ul cere commit exact, toate health checks și release-proof independent', () => {
  assert.equal(evaluateLiveSample(healthy, sha).ok, true)
  for (const key of ['version', 'ready', 'live', 'health', 'proof']) {
    const broken = structuredClone(healthy)
    broken[key].status = 503
    assert.equal(evaluateLiveSample(broken, sha).ok, false)
  }
})

test('livrarea necesită trei probe, CI, artefact, deploy, protecție și rollback seal', () => {
  const evidence = { commit: sha, masterHead: sha, branchProtection: { ok: true }, ci: { conclusion: 'success' }, build: { conclusion: 'success' }, artifactVerified: true, deploy: { conclusion: 'success' }, deployIdentityValid: true, liveSamples: [1, 2, 3].map(() => ({ ok: true })), rollbackContractVerified: true }
  assert.equal(evaluateReleaseEvidence(evidence).delivered, true)
  for (const key of ['artifactVerified', 'deployIdentityValid', 'rollbackContractVerified']) {
    assert.equal(evaluateReleaseEvidence({ ...evidence, [key]: false }).delivered, false)
  }
  assert.equal(evaluateReleaseEvidence({ ...evidence, liveSamples: [{ ok: true }, { ok: false }, { ok: true }] }).delivered, false)
})
