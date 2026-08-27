import { randomUUID } from 'node:crypto'

export const STATE_MARKER = '<!-- kelion-vps-remediation-state:v1 -->'
export const INCIDENT_MARKER = '<!-- kelion-vps-remediation-incident:v1 -->'
export const MAX_L1_ATTEMPTS = 2
export const MAX_L2_ATTEMPTS = 1
export const DEFAULT_FEEDBACK_TIMEOUT_MINUTES = 20

export const MONITORED_FILES = Object.freeze([
  '.github/workflows/deploy.yml',
  '.github/workflows/vps-auto-merge-chore-prs.yml',
  '.github/workflows/vps-auto-merge-watchdog.yml',
  '.github/workflows/vps-diag.yml',
  '.github/workflows/vps-run.yml',
  '.github/workflows/vps-set-env.yml',
  'scripts/lib/vps-pr-remediation.mjs',
  'scripts/vps-pr-remediator.mjs',
  'scripts/vps-pr-remediator.test.mjs',
])

export const L2_WRITABLE_FILES = Object.freeze([
  '.github/workflows/deploy.yml',
  '.github/workflows/vps-auto-merge-chore-prs.yml',
  '.github/workflows/vps-auto-merge-watchdog.yml',
  '.github/workflows/vps-diag.yml',
  '.github/workflows/vps-run.yml',
  '.github/workflows/vps-set-env.yml',
])

export const OFFICIAL_SOURCE_DOMAINS = Object.freeze([
  'docs.github.com',
  'github.com',
  'cli.github.com',
  'developers.openai.com',
  'platform.openai.com',
  'registry.npmjs.org',
])

export const OFFICIAL_GITHUB_REPOSITORIES = Object.freeze([
  'actions/checkout',
  'actions/runner',
  'cli/cli',
  'openai/codex',
])

const SHA = /^[0-9a-f]{40}$/
const PHASES = new Set([
  'observing',
  'waiting_l1_feedback',
  'l2_running',
  'waiting_l2_checks',
  'waiting_review_resolution',
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
    l2Attempts: 0,
    lastAction: 'tracking_started',
    lastActionAt: iso(now),
    lastFeedbackAt: iso(now),
    feedbackDeadlineAt: null,
    nextAction: 'inspect',
    nextExpectedResult: 'authoritative_github_snapshot',
    etaSeconds: 60,
    remediationHead: null,
    changedFiles: [],
    evidence: { checks: [], reviewThreads: [], sync: null, sources: [], gates: [] },
    history: [{ at: iso(now), action: 'tracking_started', result: `head=${headSha}` }],
  }
}

export function normalizeState(raw, identity) {
  const fallback = initialRemediationState(identity)
  if (!raw || raw.schema !== 1 || raw.prNumber !== identity.prNumber || typeof raw.chainId !== 'string') return fallback
  if (!SHA.test(String(raw.originalHead ?? '')) || !SHA.test(String(raw.currentHead ?? ''))) return fallback
  const phase = PHASES.has(raw.phase) ? raw.phase : 'terminal_blocked'
  return {
    ...fallback,
    ...raw,
    phase,
    l1Attempts: Math.min(MAX_L1_ATTEMPTS, Math.max(0, Number(raw.l1Attempts) || 0)),
    l2Attempts: Math.min(MAX_L2_ATTEMPTS, Math.max(0, Number(raw.l2Attempts) || 0)),
    changedFiles: Array.isArray(raw.changedFiles) ? raw.changedFiles.slice(0, 20).map(String) : [],
    evidence: raw.evidence && typeof raw.evidence === 'object' ? raw.evidence : fallback.evidence,
    history: boundedHistory(Array.isArray(raw.history) ? raw.history : []),
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
    `- Încercări L1/L2: \`${state.l1Attempts}/${MAX_L1_ATTEMPTS}\` / \`${state.l2Attempts}/${MAX_L2_ATTEMPTS}\``,
    `- Următorul pas automat: \`${state.nextAction}\``,
    `- Rezultat așteptat / ETA: \`${state.nextExpectedResult ?? 'unknown'}\` / \`${state.etaSeconds ?? 'unknown'}s\``,
    `- Branch / commit remediere: \`${state.branch ?? 'unknown'}\` / \`${state.remediationHead ?? 'none'}\``,
    `- Fișiere modificate: \`${(state.changedFiles ?? []).join(', ') || 'none'}\``,
    `- Teste înregistrate: \`${state.evidence?.gates?.length ?? 0}\``,
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
  return Array.isArray(files) && files.length > 0 && files.every((file) => MONITORED_FILES.includes(String(file)))
}

export function assertL2DiffSafe(files, patchBytes) {
  if (!Number.isSafeInteger(patchBytes) || patchBytes < 1 || patchBytes > 256 * 1024) throw new Error('Patch L2 gol sau prea mare')
  const unique = [...new Set(files.map(String))]
  if (!unique.length || unique.length > L2_WRITABLE_FILES.length) throw new Error('Număr de fișiere L2 invalid')
  for (const file of unique) {
    if (!L2_WRITABLE_FILES.includes(file)) throw new Error(`Agentul L2 a modificat o cale neautorizată: ${file}`)
  }
  return unique
}

export function officialSource(url, repository) {
  let parsed
  try { parsed = new URL(url) } catch { return false }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false
  if (!OFFICIAL_SOURCE_DOMAINS.includes(parsed.hostname.toLowerCase())) return false
  if (parsed.hostname.toLowerCase() !== 'github.com') return true
  const [owner, repo] = parsed.pathname.split('/').filter(Boolean)
  const fullName = owner && repo ? `${owner}/${repo}`.toLowerCase() : ''
  return fullName === String(repository ?? '').toLowerCase() || OFFICIAL_GITHUB_REPOSITORIES.includes(fullName)
}

export function validateResearchSources(sources, repository) {
  if (!Array.isArray(sources)) throw new Error('Sursele L2 lipsesc')
  const normalized = sources.slice(0, 20).map((source) => ({
    url: String(source.url ?? ''),
    title: String(source.title ?? '').replace(/\s+/g, ' ').slice(0, 200),
    usedFor: String(source.usedFor ?? '').replace(/\s+/g, ' ').slice(0, 300),
  }))
  if (normalized.some((source) => !officialSource(source.url, repository))) throw new Error('Agentul L2 a returnat o sursă neoficială')
  return normalized
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
 * și emite o singură decizie canonică pentru orchestrator. Executorul L2 nu își
 * poate declara singur succesul; `waiting_l2_checks` cere dovezi GitHub noi. */
export function remediationPolicy(state, blocker, now = Date.now()) {
  if (blocker === 'none') return { action: 'advance', reason: 'all_observed_gates_green' }
  if (['invalid_scope', 'draft', 'review_threads_incomplete', 'merge_requirements_unknown'].includes(blocker)) {
    return { action: 'incident', reason: blocker }
  }
  if (state.phase === 'waiting_l2_checks') {
    return feedbackIsStale(state, now)
      ? { action: 'incident', reason: 'l2_feedback_stalled' }
      : { action: 'wait', reason: 'awaiting_independent_l2_checks' }
  }
  if (state.l1Attempts < MAX_L1_ATTEMPTS) {
    if (state.phase === 'waiting_l1_feedback' && !feedbackIsStale(state, now)) {
      return { action: 'wait', reason: 'l1_feedback_deadline_active' }
    }
    return { action: 'retry_l1', reason: blocker }
  }
  if (state.l2Attempts < MAX_L2_ATTEMPTS) return { action: 'escalate_l2', reason: blocker }
  return { action: 'incident', reason: 'automatic_attempt_budget_exhausted' }
}

export function mayResolveThread(thread, changedFiles, gatesGreen) {
  if (!gatesGreen || !thread || thread.isResolved === true || thread.isOutdated !== true) return false
  const comments = Array.isArray(thread.comments) ? thread.comments : []
  const path = comments.map((comment) => comment.path).filter(Boolean).at(-1)
  return Boolean(path && changedFiles.includes(path))
}

export function redactEvidence(value) {
  return String(value ?? '')
    .replace(/\b(?:ghp|github_pat|sk-proj|sk)-[A-Za-z0-9_-]{12,}\b/g, '[REDACTED_TOKEN]')
    .replace(/(?:authorization|token|password|secret|api[_-]?key)\s*[:=]\s*\S+/gi, '$1=[REDACTED]')
    .slice(-96 * 1024)
}
