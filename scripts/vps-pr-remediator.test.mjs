import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  MAX_L1_ATTEMPTS,
  MONITORED_FILES,
  appendAudit,
  classifySnapshot,
  ensureFeedbackDeadline,
  feedbackIsStale,
  formatStateComment,
  initialRemediationState,
  isMonitoredScope,
  normalizeState,
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
  assert.equal(Object.hasOwn(parsed, 'l2Attempts'), false)
  assert.equal(parsed.history.at(-1).action, 'rerun_failed')
})

test('pending-ul este doar observat până la deadline, apoi devine incident fail-closed', () => {
  const initial = initialRemediationState({ ...identity, now: 0 })
  assert.deepEqual(
    remediationPolicy(initial, 'checks_pending', 0),
    { action: 'observe_pending', reason: 'pending_checks_need_bounded_observation' },
  )

  const state = withFeedbackDeadline({
    ...initial,
    phase: 'waiting_pending_checks',
    pendingObservedHead: sha,
    l1Attempts: MAX_L1_ATTEMPTS,
  }, 0, 5)
  assert.equal(feedbackIsStale(state, 4 * 60_000), false)
  assert.equal(feedbackIsStale(state, 5 * 60_000), true)
  assert.deepEqual(
    remediationPolicy(state, 'checks_pending', 4 * 60_000),
    { action: 'wait', reason: 'pending_checks_deadline_active' },
  )
  assert.deepEqual(
    remediationPolicy(state, 'checks_pending', 5 * 60_000),
    { action: 'incident', reason: 'pending_checks_deadline_expired' },
  )
  assert.deepEqual(
    remediationPolicy({ ...state, phase: 'terminal_blocked', blocker: 'checks_pending', feedbackDeadlineAt: null }, 'checks_pending', 6 * 60_000),
    { action: 'incident', reason: 'pending_checks_deadline_expired' },
  )
  assert.deepEqual(
    remediationPolicy({ ...state, phase: 'waiting_l1_feedback' }, 'checks_failed', 5 * 60_000),
    { action: 'incident', reason: 'l1_exhausted_without_canonical_local_executor_channel' },
  )
  assert.deepEqual(
    remediationPolicy({ ...state, currentHead: 'b'.repeat(40) }, 'checks_pending', 5 * 60_000),
    { action: 'observe_pending', reason: 'pending_checks_need_bounded_observation' },
  )
})

test('polling-ul păstrează deadline-ul inițial și nu poate amâna escaladarea', () => {
  const first = ensureFeedbackDeadline(initialRemediationState(identity), 1_000, 1)
  const polled = ensureFeedbackDeadline(first, 50_000, 1)
  assert.equal(polled.feedbackDeadlineAt, first.feedbackDeadlineAt)
  assert.equal(feedbackIsStale(polled, 61_000), true)
})

test('scope-ul monitorizat rămâne allowlist exact', () => {
  assert.equal(isMonitoredScope(['.github/workflows/vps-run.yml']), true)
  assert.equal(isMonitoredScope(['.github/workflows/vps-fix-acl.yml']), true)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-seed-slots.yml', status: 'removed' }]), true)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-seed-slots.yml', status: 'added' }]), false)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-seed-slots.yml', status: 'modified' }]), false)
  assert.equal(isMonitoredScope(['scripts/verifica-workflow-uri-sigure.mjs']), true)
  assert.equal(isMonitoredScope(['deploy/upgrade-constructor.sh']), true)
  assert.equal(isMonitoredScope(['deploy/RUNBOOKS.md']), true)
  assert.equal(isMonitoredScope(['deploy/deploy.sh']), true)
  assert.equal(isMonitoredScope(['deploy/instaleaza-constructor.sh']), true)
  assert.equal(isMonitoredScope(['deploy/lib/constructor-publication.test.mjs']), true)
  assert.equal(isMonitoredScope(['deploy/lib/runtime-config-cutover.sh']), true)
  assert.equal(isMonitoredScope(['docs/operations/CURRENT.md']), true)
  assert.equal(isMonitoredScope([
    '.github/workflows/vps-run.yml',
    '.github/workflows/vps-set-env.yml',
    'deploy/upgrade-constructor.sh',
    'deploy/RUNBOOKS.md',
    'deploy/deploy.sh',
    'deploy/instaleaza-constructor.sh',
    'deploy/lib/constructor-publication.test.mjs',
    'deploy/lib/runtime-config-cutover.sh',
  ]), true)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-run.yml', status: 'renamed', previous_filename: 'legacy.yml' }]), false)
  assert.equal(isMonitoredScope([{ filename: '.github/workflows/vps-run.yml', status: 'modified', previous_filename: 'legacy.yml' }]), false)
  assert.equal(isMonitoredScope(['backend/src/index.ts']), false)
})

test('starea veche de executor automat este retrasă fail-closed', () => {
  const legacy = {
    ...initialRemediationState(identity),
    phase: 'waiting_l2_checks',
    l1Attempts: 2,
    l2Attempts: 1,
    remediationHead: sha,
    changedFiles: ['.github/workflows/vps-run.yml'],
    evidence: { checks: [], reviewThreads: [], sync: null, sources: [{ url: 'https://example.com' }], gates: [{ command: 'legacy' }] },
  }
  const normalized = normalizeState(legacy, identity)
  assert.equal(normalized.phase, 'terminal_blocked')
  assert.equal(Object.hasOwn(normalized, 'l2Attempts'), false)
  assert.equal(Object.hasOwn(normalized, 'remediationHead'), false)
  assert.equal(Object.hasOwn(normalized, 'changedFiles'), false)
  assert.deepEqual(normalized.evidence, { checks: [], reviewThreads: [], sync: null })
})

test('workflow-ul merge-policy păstrează allowlist-ul canonic fără excepții consumate', () => {
  const workflow = readFileSync(new URL('../.github/workflows/vps-auto-merge-chore-prs.yml', import.meta.url), 'utf8')
  assert.match(workflow, /guard-source:\s*\n\s+if: always\(\)[\s\S]*actions\/checkout@[0-9a-f]{40}[\s\S]*persist-credentials: false/)
  assert.match(workflow, /guard-source:[\s\S]*\[ "\$GITHUB_REPOSITORY" = kelion-team\/kelionai \][\s\S]*git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /merge-policy:\s*\n\s+needs: guard-source/)
  assert.equal(workflow.match(/\.head\.repo\.full_name/g)?.length, 2)
  assert.equal(workflow.match(/\.head\.sha/g)?.length, 3)
  assert.equal(workflow.match(/\[ "\$GITHUB_REF" = "refs\/heads\/\$head_ref" \]/g)?.length, 2)
  assert.equal(workflow.match(/\[ "\$GITHUB_REF_NAME" = "\$head_ref" \]/g)?.length, 2)
  const encoded = /allowed='(\[[\s\S]*?\n          \])'\n          file_entries=/.exec(workflow)?.[1]
  assert.ok(encoded)
  const allowed = JSON.parse(encoded)
  assert.equal(new Set(allowed).size, allowed.length)
  assert.equal(allowed.includes('deploy/upgrade-constructor.sh'), true)
  assert.equal(allowed.includes('deploy/RUNBOOKS.md'), true)
  assert.equal(allowed.includes('deploy/instaleaza-constructor.sh'), true)
  assert.equal(allowed.includes('deploy/lib/constructor-publication.test.mjs'), true)
  assert.equal(allowed.includes('deploy/lib/runtime-config-cutover.sh'), true)
  assert.equal(allowed.includes('docs/operations/CURRENT.md'), true)
  assert.equal(MONITORED_FILES.every((file) => allowed.includes(file)), true)
  assert.doesNotMatch(workflow, /openai_unified|OPENAI_UNIFIED_ONCE|postdeploy-openai-verifier-cleanup/)
  assert.equal(workflow.match(/pulls\/\$pr_number\/files\?per_page=100/g)?.length, 1)
  assert.ok(workflow.includes("--jq '.[] | {filename, status, previous_filename: (.previous_filename // null)}' | jq -s '.'"))
  const isVpsStart = workflow.indexOf('is_vps=$(jq -r')
  const vpsBranchStart = workflow.indexOf('if [ "$is_vps" = true ]', isVpsStart)
  const renameGuard = workflow.indexOf("jq -e 'all(.[]; .status != \"renamed\" and .previous_filename == null)' <<<\"$file_entries\"", vpsBranchStart)
  const allowlistGuard = workflow.indexOf('jq -e --argjson allowed "$allowed"', vpsBranchStart)
  assert.ok(isVpsStart >= 0 && vpsBranchStart > isVpsStart)
  assert.match(workflow.slice(isVpsStart, vpsBranchStart), /index\(\$entry\.filename\)/)
  assert.match(workflow.slice(isVpsStart, vpsBranchStart), /index\(\$entry\.previous_filename\)/)
  assert.ok(renameGuard > vpsBranchStart && allowlistGuard > renameGuard)
})

test('clasificarea prioritizează conflictul, sincronizarea și review threads', () => {
  const base = { scopeValid: true, draft: false, sync: { behindBy: 0 }, mergeable: true, mergeableState: 'clean', unresolvedThreads: [], pendingChecks: [], failedChecks: [], checksObserved: true, allChecksGreen: true }
  assert.equal(classifySnapshot({ ...base, sync: { conflicted: true } }).blocker, 'merge_conflict')
  assert.equal(classifySnapshot({ ...base, sync: { behindBy: 1 } }).blocker, 'behind_master')
  assert.equal(classifySnapshot({ ...base, unresolvedThreads: [{ id: 'x' }] }).blocker, 'unresolved_review_threads')
  assert.equal(classifySnapshot(base).blocker, 'none')
})

test('watchdogul nu instalează și nu invocă un executor AI pe runner', () => {
  const workflow = readFileSync(new URL('../.github/workflows/vps-auto-merge-watchdog.yml', import.meta.url), 'utf8')
  const remediator = readFileSync(new URL('./vps-pr-remediator.mjs', import.meta.url), 'utf8')
  const policy = readFileSync(new URL('./lib/vps-pr-remediation.mjs', import.meta.url), 'utf8')
  for (const source of [workflow, remediator]) {
    assert.doesNotMatch(source, /@openai\/codex|CODEX_HOME|VPS_REMEDIATOR_CODEX|\bcodex\s+(?:login|exec)\b/i)
  }
  assert.match(workflow, /Track, retry twice, then open an incident/)
  assert.match(workflow, /permissions: \{\}[\s\S]*guard-source:\s*\n\s+if: always\(\)/)
  assert.match(workflow, /guard-source:[\s\S]*actions\/checkout@[0-9a-f]{40}[\s\S]*persist-credentials: false[\s\S]*\[ "\$GITHUB_REPOSITORY" = kelion-team\/kelionai \][\s\S]*\[ "\$GITHUB_REF" = refs\/heads\/master \][\s\S]*\[ "\$GITHUB_REF_NAME" = master \][\s\S]*git rev-parse HEAD\)" = "\$GITHUB_SHA"/)
  assert.match(workflow, /remediate-and-track:\s*\n\s+needs: guard-source/)
  assert.match(workflow, /contents: read/)
  assert.doesNotMatch(workflow, /contents: write/)
  assert.match(workflow, /VPS_REMEDIATOR_FEEDBACK_MINUTES:.*\|\| '20'/)
  assert.match(remediator, /nu are un canal canonic autentificat către OpenCode\/Qwen de pe VPS/)
  for (const source of [remediator, policy]) assert.doesNotMatch(source, /cancelStaleChecks|\/cancel\b/)
  assert.match(remediator, /classification\.blocker === 'checks_pending' && policy\.action === 'wait'/)
  const observePending = remediator.indexOf("if (policy.action === 'observe_pending')")
  const waitPending = remediator.indexOf("if (classification.blocker === 'checks_pending' && policy.action === 'wait')")
  const firstMutationAfterPending = remediator.indexOf('await disableAutoMerge(snap)', waitPending)
  assert.ok(observePending >= 0 && waitPending > observePending && firstMutationAfterPending > waitPending)
  assert.match(remediator, /CI nu a fost anulat/)
  assert.doesNotMatch(remediator, /state\.phase === 'complete' \|\| state\.phase === 'terminal_blocked'/)
  assert.match(remediator, /Continuăm să cerem receiptul de release și commitul live/)
})
