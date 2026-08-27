import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_L1_ATTEMPTS,
  appendAudit,
  assertL2DiffSafe,
  classifySnapshot,
  ensureFeedbackDeadline,
  feedbackIsStale,
  formatStateComment,
  initialRemediationState,
  isMonitoredScope,
  mayResolveThread,
  officialSource,
  parseStateComment,
  remediationPolicy,
  withFeedbackDeadline,
} from './lib/vps-pr-remediation.mjs'

const sha = 'a'.repeat(40)
const identity = { prNumber: 1401, headSha: sha }

test('starea auditabilă se serializează și se recitește fără resetarea încercărilor', () => {
  let state = initialRemediationState(identity, 0)
  state = appendAudit({ ...state, l1Attempts: MAX_L1_ATTEMPTS }, 'rerun_failed', 'run=12', 1)
  const parsed = parseStateComment(formatStateComment(state), identity)
  assert.equal(parsed.l1Attempts, 2)
  assert.equal(parsed.history.at(-1).action, 'rerun_failed')
})

test('timeoutul fără feedback devine stale, nu succes inventat', () => {
  const state = withFeedbackDeadline(initialRemediationState(identity, 0), 0, 5)
  assert.equal(feedbackIsStale(state, 4 * 60_000), false)
  assert.equal(feedbackIsStale(state, 5 * 60_000), true)
  const waiting = { ...state, phase: 'waiting_l1_feedback', l1Attempts: 1 }
  assert.equal(remediationPolicy(waiting, 'checks_pending', 4 * 60_000).action, 'wait')
  assert.equal(remediationPolicy(waiting, 'checks_pending', 5 * 60_000).action, 'retry_l1')
  assert.equal(remediationPolicy({ ...waiting, l1Attempts: 2, l2Attempts: 0 }, 'checks_failed', 5 * 60_000).action, 'escalate_l2')
  assert.equal(remediationPolicy({ ...waiting, l1Attempts: 2, l2Attempts: 1 }, 'checks_failed', 5 * 60_000).action, 'incident')
})

test('polling-ul păstrează deadline-ul inițial și nu poate amâna escaladarea', () => {
  const first = ensureFeedbackDeadline(initialRemediationState(identity), 1_000, 1)
  const polled = ensureFeedbackDeadline(first, 50_000, 1)
  assert.equal(polled.feedbackDeadlineAt, first.feedbackDeadlineAt)
  assert.equal(feedbackIsStale(polled, 61_000), true)
})

test('scope-ul și patch-ul L2 sunt allowlist exact', () => {
  assert.equal(isMonitoredScope(['.github/workflows/vps-run.yml']), true)
  assert.equal(isMonitoredScope(['scripts/verifica-workflow-uri-sigure.mjs']), true)
  assert.equal(isMonitoredScope(['backend/src/index.ts']), false)
  assert.deepEqual(assertL2DiffSafe(['.github/workflows/vps-run.yml'], 100), ['.github/workflows/vps-run.yml'])
  assert.throws(() => assertL2DiffSafe(['deploy/deploy.sh'], 100), /neautorizată/)
})

test('clasificarea prioritizează conflictul, sincronizarea și review threads', () => {
  const base = { scopeValid: true, draft: false, sync: { behindBy: 0 }, mergeable: true, mergeableState: 'clean', unresolvedThreads: [], pendingChecks: [], failedChecks: [], checksObserved: true, allChecksGreen: true }
  assert.equal(classifySnapshot({ ...base, sync: { conflicted: true } }).blocker, 'merge_conflict')
  assert.equal(classifySnapshot({ ...base, sync: { behindBy: 1 } }).blocker, 'behind_master')
  assert.equal(classifySnapshot({ ...base, unresolvedThreads: [{ id: 'x' }] }).blocker, 'unresolved_review_threads')
  assert.equal(classifySnapshot(base).blocker, 'none')
})

test('o conversație se rezolvă automat numai după patch, outdated și porți verzi', () => {
  const thread = { isResolved: false, isOutdated: true, comments: [{ path: '.github/workflows/vps-run.yml' }] }
  assert.equal(mayResolveThread(thread, ['.github/workflows/vps-run.yml'], true), true)
  assert.equal(mayResolveThread({ ...thread, isOutdated: false }, ['.github/workflows/vps-run.yml'], true), false)
  assert.equal(mayResolveThread(thread, ['.github/workflows/vps-diag.yml'], true), false)
  assert.equal(mayResolveThread(thread, ['.github/workflows/vps-run.yml'], false), false)
})

test('cercetarea acceptă doar domenii și repo-uri oficiale', () => {
  assert.equal(officialSource('https://docs.github.com/actions', 'kelion-team/kelionai'), true)
  assert.equal(officialSource('https://github.com/cli/cli/issues/1', 'kelion-team/kelionai'), true)
  assert.equal(officialSource('https://github.com/random/blog/issues/1', 'kelion-team/kelionai'), false)
  assert.equal(officialSource('https://example.com/fix', 'kelion-team/kelionai'), false)
})
