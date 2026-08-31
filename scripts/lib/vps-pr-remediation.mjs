import { randomUUID } from 'node:crypto'

export const STATE_MARKER = '<!-- kelion-vps-remediation-state:v1 -->'
export const INCIDENT_MARKER = '<!-- kelion-vps-remediation-incident:v1 -->'
export const MAX_L1_ATTEMPTS = 2
export const DEFAULT_FEEDBACK_TIMEOUT_MINUTES = 20

export const MONITORED_FILES = Object.freeze([
  '.github/workflows/deploy.yml',
  '.github/workflows/pr-verify.yml',
  '.github/workflows/vps-auto-merge-chore-prs.yml',
  '.github/workflows/vps-auto-merge-watchdog.yml',
  '.github/workflows/vps-diag.yml',
  '.github/workflows/vps-fix-acl.yml',
  '.github/workflows/vps-run.yml',
  '.github/workflows/vps-release-verifier.yml',
  '.github/workflows/vps-set-env.yml',
  'deploy/RUNBOOKS.md',
  'deploy/deploy.sh',
  'deploy/instaleaza-constructor.sh',
  'deploy/lib/constructor-publication.test.mjs',
  'deploy/lib/runtime-config-cutover.sh',
  'deploy/upgrade-constructor.sh',
  'docs/operations/CURRENT.md',
  'scripts/lib/vps-pr-remediation.mjs',
  'scripts/lib/vps-release-verification.mjs',
  'scripts/vps-pr-remediator.mjs',
  'scripts/vps-pr-remediator.test.mjs',
  'scripts/vps-release-verifier.mjs',
  'scripts/vps-release-verifier.test.mjs',
  'scripts/verifica-workflow-uri-sigure.mjs',
])

const SHA = /^[0-9a-f]{40}$/
const PHASES = new Set([
  'observing',
  'waiting_pending_checks',
  'waiting_l1_feedback',
  'waiting_merge',
  'waiting_deploy',
  'complete',
  'terminal_blocked',
])

function iso(value = Date.now()) {
  return new Date(value).toISOString()
}

function boundedHistory(history = []) {
  return history.slice(-40).map((entry) => ({
    at: String(entry.at ?? '').slice(0, 40),
    action: String(entry.action ?? '').slice(0, 120),
    result: String(entry.result ?? '').slice(0, 240),
  }))
}

export function initialRemediationState({ prNumber, headSha, now = Date.now() }) {
  if (!Number.isSafeInteger(prNumber) || prNumber < 1 || !SHA.test(headSha)) throw new Error('Identitate PR invalidă')
  return {
    schema: 1,
    chainId: randomUUID(),
    prNumber,
    startedAt: iso(now),
    elapsedSeconds: 0,
    originalHead: headSha,
    currentHead: headSha,
    phase: 'observing',
    blocker: 'none',
    cause: 'none',
    l1Attempts: 0,
    lastAction: 'tracking_started',
    lastActionAt: iso(now),
    lastFeedbackAt: iso(now),
    feedbackDeadlineAt: null,
    pendingObservedHead: null,
    nextAction: 'inspect',
    nextExpectedResult: 'authoritative_github_snapshot',
    etaSeconds: 60,
    evidence: { checks: [], reviewThreads: [], sync: null },
    history: [{ at: iso(now), action: 'tracking_started', result: `head=${headSha}` }],
  }
}

export function normalizeState(raw, identity) {
  const fallback = initialRemediationState(identity)
  if (!raw || raw.schema !== 1 || raw.prNumber !== identity.prNumber || typeof raw.chainId !== 'string') return fallback
  if (!SHA.test(String(raw.originalHead ?? '')) || !SHA.test(String(raw.currentHead ?? ''))) return fallback
  const {
    l2Attempts: _retiredL2Attempts,
    remediationHead: _retiredRemediationHead,
    changedFiles: _retiredChangedFiles,
    ...current
  } = raw
  const phase = PHASES.has(current.phase) ? current.phase : 'terminal_blocked'
  const rawEvidence = current.evidence && typeof current.evidence === 'object' ? current.evidence : {}
  return {
    ...fallback,
    ...current,
    phase,
    l1Attempts: Math.min(MAX_L1_ATTEMPTS, Math.max(0, Number(current.l1Attempts) || 0)),
    pendingObservedHead: SHA.test(String(current.pendingObservedHead ?? '')) ? current.pendingObservedHead : null,
    evidence: {
      checks: Array.isArray(rawEvidence.checks) ? rawEvidence.checks.slice(0, 100) : [],
      reviewThreads: Array.isArray(rawEvidence.reviewThreads) ? rawEvidence.reviewThreads.slice(0, 100) : [],
      sync: rawEvidence.sync && typeof rawEvidence.sync === 'object' ? rawEvidence.sync : null,
    },
    history: boundedHistory(Array.isArray(current.history) ? current.history : []),
  }
}

export function appendAudit(state, action, result, now = Date.now()) {
  const started = Date.parse(String(state.startedAt ?? ''))
  return {
    ...state,
    elapsedSeconds: Number.isFinite(started) ? Math.max(0, Math.floor((now - started) / 1000)) : null,
    lastAction: String(action).slice(0, 120),
    lastActionAt: iso(now),
    lastFeedbackAt: iso(now),
    history: boundedHistory([...(state.history ?? []), { at: iso(now), action, result }]),
  }
}

export function withFeedbackDeadline(state, now = Date.now(), minutes = DEFAULT_FEEDBACK_TIMEOUT_MINUTES) {
  const safeMinutes = Math.min(180, Math.max(1, Number(minutes) || DEFAULT_FEEDBACK_TIMEOUT_MINUTES))
  return { ...state, feedbackDeadlineAt: iso(now + safeMinutes * 60_000) }
}

export function ensureFeedbackDeadline(state, now = Date.now(), minutes = DEFAULT_FEEDBACK_TIMEOUT_MINUTES) {
  const existing = Date.parse(String(state.feedbackDeadlineAt ?? ''))
  return Number.isFinite(existing) ? state : withFeedbackDeadline(state, now, minutes)
}

export function feedbackIsStale(state, now = Date.now()) {
  const deadline = Date.parse(String(state.feedbackDeadlineAt ?? ''))
  return Number.isFinite(deadline) && now >= deadline
}

export function formatStateComment(state) {
  const summary = [
    '## Kelion VPS remediation tracker',
    '',
    `- Stare: \`${state.phase}\``,
    `- Cauză: \`${state.cause}\``,
    `- Start / timp scurs: \`${state.startedAt}\` / \`${state.elapsedSeconds ?? 'unknown'}s\``,
    `- Deadline feedback: \`${state.feedbackDeadlineAt ?? 'none'}\``,
    `- Ultima acțiune: \`${state.lastAction}\``,
    `- Încercări automate L1: \`${state.l1Attempts}/${MAX_L1_ATTEMPTS}\``,
    `- Următorul pas automat: \`${state.nextAction}\``,
    `- Rezultat așteptat / ETA: \`${state.nextExpectedResult ?? 'unknown'}\` / \`${state.etaSeconds ?? 'unknown'}s\``,
    `- Branch / head urmărit: \`${state.branch ?? 'unknown'}\` / \`${state.currentHead}\``,
    `- Checkuri observate: \`${state.evidence?.checks?.length ?? 0}\``,
    '',
    'Acest comentariu este stare operațională citită și actualizată de watchdog; auto-merge rămâne blocat cât timp starea nu este `waiting_merge` sau `complete`.',
  ].join('\n')
  return `${STATE_MARKER}\n${summary}\n\n\`\`\`json\n${JSON.stringify(state)}\n\`\`\``
}

export function parseStateComment(body, identity) {
  if (typeof body !== 'string' || !body.includes(STATE_MARKER)) return null
  const match = body.match(/```json\s*([\s\S]*?)\s*```/)
  if (!match) return null
  try {
    return normalizeState(JSON.parse(match[1]), identity)
  } catch {
    return null
  }
}

export function isMonitoredScope(files) {
  if (!Array.isArray(files) || files.length === 0) return false
  if (files.some((entry) => (
    entry
    && typeof entry === 'object'
    && (entry.status === 'renamed' || entry.previous_filename != null)
  ))) return false
  return files.every((entry) => {
    const file = typeof entry === 'string' ? entry : entry?.filename
    const status = typeof entry === 'string' ? null : entry?.status
    if (MONITORED_FILES.includes(String(file))) return true
    return file === '.github/workflows/vps-seed-slots.yml' && status === 'removed'
  })
}

export function classifySnapshot(snapshot) {
  if (!snapshot.scopeValid) return { blocker: 'invalid_scope', automatic: false }
  if (snapshot.draft) return { blocker: 'draft', automatic: false }
  if (snapshot.sync?.conflicted || snapshot.mergeable === false || snapshot.mergeableState === 'dirty') {
    return { blocker: 'merge_conflict', automatic: true }
  }
  if (snapshot.sync?.behindBy > 0 || snapshot.mergeableState === 'behind') return { blocker: 'behind_master', automatic: true }
  if (snapshot.reviewThreadsIncomplete) return { blocker: 'review_threads_incomplete', automatic: false }
  if ((snapshot.unresolvedThreads ?? []).length > 0) return { blocker: 'unresolved_review_threads', automatic: true }
  if ((snapshot.pendingChecks ?? []).length > 0) return { blocker: 'checks_pending', automatic: true }
  if ((snapshot.failedChecks ?? []).length > 0) return { blocker: 'checks_failed', automatic: true }
  if (!snapshot.checksObserved) return { blocker: 'checks_missing', automatic: true }
  if (!snapshot.allChecksGreen) return { blocker: 'merge_requirements_unknown', automatic: false }
  return { blocker: 'none', automatic: true }
}

/** Motorul de politici nu execută nimic: primește starea măsurată de watchdog
 * și emite o singură decizie canonică pentru orchestrator. Runnerul poate face
 * numai cele două acțiuni L1 GitHub; după epuizarea lor deschide un incident,
 * deoarece nu are un canal canonic autentificat către OpenCode/Qwen de pe VPS. */
export function remediationPolicy(state, blocker, now = Date.now()) {
  if (blocker === 'none') return { action: 'advance', reason: 'all_observed_gates_green' }
  if (['invalid_scope', 'draft', 'review_threads_incomplete', 'merge_requirements_unknown'].includes(blocker)) {
    return { action: 'incident', reason: blocker }
  }
  if (blocker === 'checks_pending') {
    const pendingHeadMatches = state.pendingObservedHead === state.currentHead
    if (state.phase === 'terminal_blocked' && state.blocker === 'checks_pending' && pendingHeadMatches) {
      return { action: 'incident', reason: 'pending_checks_deadline_expired' }
    }
    const observingCurrentHead = state.phase === 'waiting_pending_checks'
      && pendingHeadMatches
    if (!observingCurrentHead) return { action: 'observe_pending', reason: 'pending_checks_need_bounded_observation' }
    return feedbackIsStale(state, now)
      ? { action: 'incident', reason: 'pending_checks_deadline_expired' }
      : { action: 'wait', reason: 'pending_checks_deadline_active' }
  }
  if (state.l1Attempts < MAX_L1_ATTEMPTS) {
    if (state.phase === 'waiting_l1_feedback' && !feedbackIsStale(state, now)) {
      return { action: 'wait', reason: 'l1_feedback_deadline_active' }
    }
    return { action: 'retry_l1', reason: blocker }
  }
  return { action: 'incident', reason: 'l1_exhausted_without_canonical_local_executor_channel' }
}

export function redactEvidence(value) {
  return String(value ?? '')
    .replace(/\b(?:ghp|github_pat|sk-proj|sk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/(?:authorization|token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(-96 * 1024)
}
