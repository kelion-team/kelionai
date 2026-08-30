import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MAX_L1_ATTEMPTS,
  OPENAI_UNIFIED_ONCE_BRANCH,
  OPENAI_UNIFIED_ONCE_FILES,
  OPENAI_UNIFIED_ONCE_PR_NUMBER,
  OPENAI_UNIFIED_ONCE_REPOSITORY,
  appendAudit,
  assertL2DiffSafe,
  classifySnapshot,
  ensureFeedbackDeadline,
  feedbackIsStale,
  formatStateComment,
  initialRemediationState,
  isMonitoredScope,
  isOpenaiUnifiedOneShotScope,
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
  assert.equal(isMonitoredScope(['.github/workflows/vps-fix-acl.yml']), true)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-seed-slots.yml', status: 'removed' }]), true)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-seed-slots.yml', status: 'added' }]), false)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-seed-slots.yml', status: 'modified' }]), false)
  assert.equal(isMonitoredScope(['scripts/verifica-workflow-uri-sigure.mjs']), true)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-run.yml', status: 'renamed', previous_filename: 'legacy.yml' }]), false)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-run.yml', status: 'modified', previous_filename: 'legacy.yml' }]), false)
  assert.equal(isMonitoredScope(['backend/src/index.ts']), false)
  assert.deepEqual(assertL2DiffSafe(['.github/workflows/vps-run.yml'], 100), ['.github/workflows/vps-run.yml'])
  assert.throws(() => assertL2DiffSafe(['deploy/deploy.sh'], 100), /neautorizată/)
})

test('scope-ul OpenAI one-shot cere identitatea și exact cele 7 căi', () => {
  const identity = {
    prNumber: OPENAI_UNIFIED_ONCE_PR_NUMBER,
    repository: OPENAI_UNIFIED_ONCE_REPOSITORY,
    headRepo: OPENAI_UNIFIED_ONCE_REPOSITORY,
    headRef: OPENAI_UNIFIED_ONCE_BRANCH,
  }
  const exact = [...OPENAI_UNIFIED_ONCE_FILES]
  assert.equal(exact.length, 7)
  assert.equal(new Set(exact).size, exact.length)
  assert.deepEqual(exact, exact.toSorted())
  const exactEntries = exact.map((filename) => ({ filename, status: 'modified', previous_filename: null }))
  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries, identity), true)
  assert.equal(isMonitoredScope(exactEntries, identity), true)

  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries, { ...identity, prNumber: 1540 }), false)
  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries, { ...identity, headRef: 'chore/openai-unified-credentials-alt' }), false)
  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries, { ...identity, repository: 'kelion-team/other' }), false)
  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries, { ...identity, headRepo: 'fork/kelionai' }), false)
  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries.slice(0, -1), identity), false)
  assert.equal(isOpenaiUnifiedOneShotScope([...exactEntries, { filename: 'unexpected/path', status: 'added', previous_filename: null }], identity), false)
  assert.equal(isOpenaiUnifiedOneShotScope([...exactEntries.slice(0, -1), exactEntries[0]], identity), false)
  assert.equal(isOpenaiUnifiedOneShotScope(exact, identity), false)
  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries.map((entry, index) => index === 0 ? { ...entry, status: 'renamed', previous_filename: 'outside/allowlist' } : entry), identity), false)
  assert.equal(isOpenaiUnifiedOneShotScope(exactEntries.map((entry, index) => index === 0 ? { ...entry, previous_filename: 'outside/allowlist' } : entry), identity), false)
})

test('workflow-ul merge-policy folosește aceeași identitate și aceeași listă one-shot', () => {
  const workflow = readFileSync(new URL('../.github/workflows/vps-auto-merge-chore-prs.yml', import.meta.url), 'utf8')
  const encoded = /openai_unified_once='(\[[\s\S]*?\n          \])'\n          file_entries=/.exec(workflow)?.[1]
  assert.ok(encoded)
  assert.deepEqual(JSON.parse(encoded), OPENAI_UNIFIED_ONCE_FILES)
  assert.match(workflow, new RegExp(`readonly openai_unified_pr_number=${OPENAI_UNIFIED_ONCE_PR_NUMBER}\\b`))
  assert.match(workflow, new RegExp(`readonly openai_unified_repository=${OPENAI_UNIFIED_ONCE_REPOSITORY.replace('/', '\\/')}\\b`))
  assert.match(workflow, new RegExp(`readonly openai_unified_branch=${OPENAI_UNIFIED_ONCE_BRANCH}\\b`))
  assert.match(workflow, /\[ "\$pr_number" = "\$openai_unified_pr_number" \]/)
  assert.match(workflow, /\[ "\$GITHUB_REPOSITORY" = "\$openai_unified_repository" \]/)
  assert.match(workflow, /\[ "\$head_repo" = "\$openai_unified_repository" \]/)
  assert.match(workflow, /\[ "\$head_ref" = "\$openai_unified_branch" \]/)
  assert.equal(workflow.match(/pulls\/\$pr_number\/files\?per_page=100/g)?.length, 1)
  assert.ok(workflow.includes("--jq '.[] | {filename, status, previous_filename: (.previous_filename // null)}' | jq -s '.'"))
  const isVpsStart = workflow.indexOf('is_vps=$(jq -r')
  const vpsBranchStart = workflow.indexOf('if [ "$is_vps" = true ]', isVpsStart)
  const renameGuard = workflow.indexOf("jq -e 'all(.[]; .status != \"renamed\" and .previous_filename == null)' <<<\"$file_entries\"", vpsBranchStart)
  const exceptionStart = workflow.indexOf('openai_unified_exception=false', vpsBranchStart)
  assert.ok(isVpsStart >= 0 && vpsBranchStart > isVpsStart)
  assert.match(workflow.slice(isVpsStart, vpsBranchStart), /index\(\$entry\.filename\)/)
  assert.match(workflow.slice(isVpsStart, vpsBranchStart), /index\(\$entry\.previous_filename\)/)
  assert.ok(renameGuard > vpsBranchStart && exceptionStart > renameGuard)
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
