#!/usr/bin/env node
import {
  INCIDENT_MARKER,
  MAX_L1_ATTEMPTS,
  STATE_MARKER,
  appendAudit,
  classifySnapshot,
  ensureFeedbackDeadline,
  feedbackIsStale,
  formatStateComment,
  initialRemediationState,
  isMonitoredScope,
  normalizeState,
  parseStateComment,
  redactEvidence,
  remediationPolicy,
  withFeedbackDeadline,
} from './lib/vps-pr-remediation.mjs'

const token = process.env.GH_TOKEN ?? ''
const repository = process.env.GITHUB_REPOSITORY ?? ''
const apiBase = process.env.GITHUB_API_URL ?? 'https://api.github.com'
const graphqlUrl = process.env.GITHUB_GRAPHQL_URL ?? 'https://api.github.com/graphql'
const feedbackMinutes = Number(process.env.VPS_REMEDIATOR_FEEDBACK_MINUTES ?? 20)
const liveOrigin = String(process.env.VPS_REMEDIATOR_LIVE_ORIGIN ?? '').replace(/\/$/, '')
const maxPrs = Math.min(20, Math.max(1, Number(process.env.VPS_REMEDIATOR_MAX_PRS ?? 10)))

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('GITHUB_REPOSITORY invalid')
if (token.length < 20) throw new Error('GH_TOKEN lipsește; remediatorul rămâne fail-closed')

const [owner, name] = repository.split('/')

function jsonHeaders() {
  return {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    'user-agent': 'kelion-vps-pr-remediator/1',
    'x-github-api-version': '2022-11-28',
  }
}

async function api(path, { method = 'GET', body, ok = [200] } = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: jsonHeaders(),
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const text = await response.text()
  if (!ok.includes(response.status)) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status} ${redactEvidence(text).slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}

async function graphql(query, variables) {
  const response = await fetch(graphqlUrl, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ query, variables }),
    redirect: 'manual',
    signal: AbortSignal.timeout(30_000),
  })
  const payload = await response.json()
  if (!response.ok || payload.errors?.length) throw new Error(`GitHub GraphQL: ${redactEvidence(JSON.stringify(payload.errors ?? payload)).slice(0, 500)}`)
  return payload.data
}

async function paged(path, perPage = 100, maxPages = 10) {
  const all = []
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = path.includes('?') ? '&' : '?'
    const batch = await api(`${path}${separator}per_page=${perPage}&page=${page}`)
    if (!Array.isArray(batch)) throw new Error(`Răspuns paginat invalid pentru ${path}`)
    all.push(...batch)
    if (batch.length < perPage) return all
  }
  throw new Error(`Paginarea pentru ${path} depășește limita sigură`)
}

function runIdFromUrl(url) {
  const match = String(url ?? '').match(/\/actions\/runs\/(\d+)/)
  return match ? Number(match[1]) : null
}

async function reviewThreads(number) {
  const data = await graphql(
    'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id reviewDecision reviewThreads(first:100){pageInfo{hasNextPage}nodes{id isResolved isOutdated comments(first:50){pageInfo{hasNextPage}nodes{id body path outdated author{login} createdAt}}}}}}}',
    { owner, name, number },
  )
  const pr = data.repository.pullRequest
  const incomplete = pr.reviewThreads.pageInfo.hasNextPage || pr.reviewThreads.nodes.some((thread) => thread.comments.pageInfo.hasNextPage)
  const threads = pr.reviewThreads.nodes.map((thread) => ({ ...thread, comments: thread.comments.nodes }))
  return { prNodeId: pr.id, reviewDecision: pr.reviewDecision, incomplete, threads, unresolved: threads.filter((thread) => !thread.isResolved) }
}

async function snapshot(number) {
  const pr = await api(`/repos/${repository}/pulls/${number}`)
  const fileEntries = (await paged(`/repos/${repository}/pulls/${number}/files`))
    .map((file) => ({
      filename: file.filename,
      status: file.status,
      previous_filename: file.previous_filename ?? null,
    }))
  const files = fileEntries.map((file) => file.filename)
  const checksPayload = await api(`/repos/${repository}/commits/${pr.head.sha}/check-runs?per_page=100`)
  if (checksPayload.total_count > 100) throw new Error('Mai mult de 100 check-runs; evaluarea incompletă este refuzată')
  const statuses = await api(`/repos/${repository}/commits/${pr.head.sha}/status`)
  const reviews = await reviewThreads(number)
  const comparison = await api(`/repos/${repository}/compare/${encodeURIComponent(pr.base.sha)}...${encodeURIComponent(pr.head.sha)}`)
  const checkRuns = checksPayload.check_runs.map((check) => ({
    id: check.id,
    name: check.name,
    status: check.status,
    conclusion: check.conclusion,
    detailsUrl: check.details_url,
    runId: runIdFromUrl(check.details_url),
    startedAt: check.started_at,
    completedAt: check.completed_at,
  }))
  const contexts = (statuses.statuses ?? []).map((status) => ({
    id: status.id,
    name: status.context,
    status: status.state === 'pending' ? 'in_progress' : 'completed',
    conclusion: status.state === 'success' ? 'success' : status.state === 'pending' ? null : 'failure',
    detailsUrl: status.target_url,
    runId: runIdFromUrl(status.target_url),
    startedAt: status.created_at,
    completedAt: status.updated_at,
  }))
  const all = [...checkRuns, ...contexts]
  const pendingChecks = all.filter((check) => check.status !== 'completed')
  const failedChecks = all.filter((check) => check.status === 'completed' && !['success', 'neutral', 'skipped'].includes(check.conclusion))
  const allChecksGreen = all.length > 0 && pendingChecks.length === 0 && failedChecks.length === 0
  return {
    pr,
    prNodeId: reviews.prNodeId,
    files,
    scopeValid: isMonitoredScope(fileEntries, {
      prNumber: pr.number,
      repository,
      headRepo: pr.head.repo?.full_name ?? '',
      headRef: pr.head.ref,
    }),
    draft: pr.draft,
    mergeable: pr.mergeable,
    mergeableState: pr.mergeable_state,
    sync: { status: comparison.status, aheadBy: comparison.ahead_by, behindBy: comparison.behind_by, conflicted: pr.mergeable === false || pr.mergeable_state === 'dirty' },
    reviewDecision: reviews.reviewDecision,
    reviewThreadsIncomplete: reviews.incomplete,
    threads: reviews.threads,
    unresolvedThreads: reviews.unresolved,
    checks: all,
    pendingChecks,
    failedChecks,
    checksObserved: all.length > 0,
    allChecksGreen,
  }
}

async function stateComment(number, headSha) {
  const comments = await paged(`/repos/${repository}/issues/${number}/comments`)
  for (const comment of comments.toReversed()) {
    const parsed = parseStateComment(comment.body, { prNumber: number, headSha })
    if (parsed) return { comment, state: parsed }
  }
  return { comment: null, state: initialRemediationState({ prNumber: number, headSha }) }
}

async function saveState(number, holder, next) {
  const body = formatStateComment(next)
  if (body.length > 60_000) throw new Error('Starea de audit depășește limita sigură')
  if (holder.comment) {
    await api(`/repos/${repository}/issues/comments/${holder.comment.id}`, { method: 'PATCH', body: { body } })
  } else {
    holder.comment = await api(`/repos/${repository}/issues/${number}/comments`, { method: 'POST', body: { body }, ok: [201] })
  }
  holder.state = next
}

async function disableAutoMerge(snap) {
  if (!snap.pr.auto_merge) return
  await graphql('mutation($id:ID!){disablePullRequestAutoMerge(input:{pullRequestId:$id}){pullRequest{id autoMergeRequest{enabledAt}}}}', { id: snap.prNodeId })
}

async function enableAutoMerge(snap) {
  if (snap.pr.auto_merge?.merge_method?.toLowerCase() === 'rebase') return
  await graphql('mutation($id:ID!){enablePullRequestAutoMerge(input:{pullRequestId:$id,mergeMethod:REBASE}){pullRequest{id autoMergeRequest{enabledAt mergeMethod}}}}', { id: snap.prNodeId })
}

function compactEvidence(snap) {
  return {
    checks: snap.checks.map((check) => ({ name: check.name, status: check.status, conclusion: check.conclusion, runId: check.runId })).slice(0, 100),
    reviewThreads: snap.unresolvedThreads.map((thread) => ({ id: thread.id, isOutdated: thread.isOutdated, path: thread.comments.at(-1)?.path ?? null })).slice(0, 100),
    sync: snap.sync,
  }
}

async function openOrUpdateIncident(number, state, detail) {
  const title = `[VPS remediation incident] PR #${number}`
  const query = encodeURIComponent(`repo:${repository} is:issue is:open in:title "${title}"`)
  const found = await api(`/search/issues?q=${query}&per_page=10`)
  const body = `${INCIDENT_MARKER}\n## Incident automat de remediere VPS\n\n- PR: #${number}\n- Stare: \`${state.phase}\`\n- Cauză: \`${state.cause}\`\n- Încercări automate L1: \`${state.l1Attempts}/${MAX_L1_ATTEMPTS}\`\n- Ultima acțiune: \`${state.lastAction}\`\n- Următorul pas verificabil: \`${state.nextAction}\`\n- Dovadă așteptată: \`${state.nextExpectedResult}\`\n\nDetaliu redactat: ${redactEvidence(detail).slice(0, 1000)}\n\nRunnerul GitHub nu are un canal canonic autentificat către OpenCode/Qwen de pe VPS și nu pornește un executor alternativ. Merge-ul și deploy-ul rămân blocate până la dovezi noi.`
  const issue = found.items?.find((item) => item.title === title)
  if (issue) return api(`/repos/${repository}/issues/${issue.number}`, { method: 'PATCH', body: { body } })
  return api(`/repos/${repository}/issues`, { method: 'POST', body: { title, body }, ok: [201] })
}

async function rerunFailedChecks(snap) {
  const runIds = [...new Set(snap.failedChecks.map((check) => check.runId).filter(Number.isSafeInteger))]
  if (!runIds.length) throw new Error('Checkurile eșuate nu expun run IDs rerulabile')
  for (const runId of runIds) await api(`/repos/${repository}/actions/runs/${runId}/rerun-failed-jobs`, { method: 'POST', ok: [201] })
  return runIds
}

async function updateBranch(snap) {
  return api(`/repos/${repository}/pulls/${snap.pr.number}/update-branch`, {
    method: 'PUT',
    body: { expected_head_sha: snap.pr.head.sha },
    ok: [202],
  })
}

async function terminal(
  number,
  holder,
  state,
  cause,
  detail,
  nextAction = 'incident_waits_for_new_verified_evidence',
  nextExpectedResult = 'new_authoritative_evidence',
) {
  const next = appendAudit({ ...state, phase: 'terminal_blocked', blocker: cause, cause, nextAction, nextExpectedResult, etaSeconds: null, feedbackDeadlineAt: null }, 'terminal_blocked', detail)
  await saveState(number, holder, next)
  await openOrUpdateIncident(number, next, detail)
}

async function handlePr(number) {
  let snap = await snapshot(number)
  if (snap.pr.state !== 'open' || snap.pr.base.ref !== 'master' || !snap.pr.head.ref.startsWith('chore/')) return
  const holder = await stateComment(number, snap.pr.head.sha)
  let state = normalizeState(holder.state, { prNumber: number, headSha: snap.pr.head.sha })
  const previousUnresolved = Array.isArray(state.evidence?.reviewThreads) ? state.evidence.reviewThreads.length : 0
  const previousHead = state.currentHead
  state = { ...state, branch: snap.pr.head.ref, currentHead: snap.pr.head.sha, evidence: compactEvidence(snap) }
  if (previousUnresolved > 0 && snap.unresolvedThreads.length === 0) {
    state = appendAudit(state, 'review_threads_resolution_observed', `previous=${previousUnresolved}; current=0; actor=not_exposed_by_polling_api`)
  }
  if (previousHead !== snap.pr.head.sha) {
    state = appendAudit(state, 'external_head_update_observed', `previous=${previousHead}; current=${snap.pr.head.sha}`)
  }
  const classification = classifySnapshot(snap)
  const policy = remediationPolicy(state, classification.blocker)
  state = {
    ...state,
    blocker: classification.blocker,
    cause: classification.blocker,
    pendingObservedHead: classification.blocker === 'checks_pending' ? state.pendingObservedHead : null,
  }

  if (policy.action === 'incident' && ['invalid_scope', 'draft', 'review_threads_incomplete', 'merge_requirements_unknown'].includes(classification.blocker)) {
    await disableAutoMerge(snap)
    return terminal(number, holder, state, classification.blocker, 'Blocajul nu poate fi modificat automat fără a încălca intenția autorului sau o evaluare completă.')
  }

  if (classification.blocker === 'none') {
    await enableAutoMerge(snap)
    state = appendAudit({ ...state, phase: 'waiting_merge', blocker: 'none', cause: 'none', nextAction: 'watch_merge_then_deploy', nextExpectedResult: 'protected_rebase_merge', etaSeconds: 600, feedbackDeadlineAt: null, lastFeedbackAt: new Date().toISOString() }, 'auto_merge_enabled_rebase', `head=${snap.pr.head.sha}`)
    return saveState(number, holder, state)
  }

  if (policy.action === 'observe_pending') {
    state = withFeedbackDeadline(appendAudit({
      ...state,
      phase: 'waiting_pending_checks',
      pendingObservedHead: snap.pr.head.sha,
      nextAction: 'observe_pending_checks_until_deadline',
      nextExpectedResult: 'checks_complete_or_incident_at_deadline',
      etaSeconds: Math.max(60, Math.round(feedbackMinutes * 60)),
    }, 'pending_checks_observed', `head=${snap.pr.head.sha}; pending=${snap.pendingChecks.length}`), Date.now(), feedbackMinutes)
    return saveState(number, holder, state)
  }

  // Un check pending în fereastra lui normală este doar observat. Nu anulăm
  // run-uri și nu schimbăm auto-merge-ul până când deadline-ul chiar expiră.
  if (classification.blocker === 'checks_pending' && policy.action === 'wait') {
    return saveState(number, holder, state)
  }

  await disableAutoMerge(snap)
  if (policy.action === 'wait') return saveState(number, holder, state)

  if (policy.action === 'retry_l1') {
    try {
      let result
      if (classification.blocker === 'behind_master') result = await updateBranch(snap)
      else if (classification.blocker === 'checks_failed') result = await rerunFailedChecks(snap)
      else result = `observed ${classification.blocker}; waiting for verified feedback`
      state = withFeedbackDeadline(appendAudit({ ...state, phase: 'waiting_l1_feedback', l1Attempts: state.l1Attempts + 1, nextAction: state.l1Attempts + 1 >= MAX_L1_ATTEMPTS ? 'open_incident_if_still_blocked' : 'reinspect_then_retry_l1', nextExpectedResult: 'new_check_or_sync_feedback', etaSeconds: 60 }, 'l1_attempt', JSON.stringify(result)), Date.now(), feedbackMinutes)
      return saveState(number, holder, state)
    } catch (error) {
      state = withFeedbackDeadline(appendAudit({ ...state, phase: 'waiting_l1_feedback', l1Attempts: state.l1Attempts + 1, nextAction: state.l1Attempts + 1 >= MAX_L1_ATTEMPTS ? 'open_incident_if_still_blocked' : 'retry_l1' }, 'l1_failed', redactEvidence(error)), Date.now(), 5)
      return saveState(number, holder, state)
    }
  }

  const pendingDeadlineExpired = classification.blocker === 'checks_pending'
    && policy.reason === 'pending_checks_deadline_expired'
  const detail = pendingDeadlineExpired
    ? 'Checkurile au rămas pending până la deadline-ul observat pentru același head; CI nu a fost anulat, iar starea nu este declarată stale fără această dovadă temporală.'
    : policy.action === 'incident'
      ? `L1 epuizat pentru ${classification.blocker}; runnerul GitHub nu are un canal canonic autentificat către OpenCode/Qwen de pe VPS, deci nu execută remediere de cod automată.`
      : `Politica a refuzat acțiunea neașteptată ${policy.action} pentru ${classification.blocker}.`
  return terminal(
    number,
    holder,
    state,
    classification.blocker,
    detail,
    pendingDeadlineExpired
      ? 'publish_authoritative_check_completion_or_new_verified_head'
      : 'publish_verified_head_or_provision_canonical_opencode_qwen_channel',
    pendingDeadlineExpired
      ? 'pending_checks_complete_with_authoritative_conclusion'
      : 'new_head_with_required_checks_green_or_authenticated_channel_attestation',
  )
}

async function followClosedTrackedPrs() {
  const closed = await api(`/repos/${repository}/pulls?state=closed&base=master&sort=updated&direction=desc&per_page=20`)
  for (const pr of closed) {
    if (!pr.merged_at) continue
    const holder = await stateComment(pr.number, pr.head.sha)
    if (!holder.comment || !holder.comment.body.includes(STATE_MARKER)) continue
    let state = holder.state
    // Un incident deschis nu anulează realitatea unui merge făcut ulterior.
    // Continuăm să cerem receiptul de release și commitul live chiar dacă
    // remedierea automată fusese deja retrasă fail-closed.
    if (state.phase === 'complete') continue
    const runs = await api(`/repos/${repository}/actions/workflows/deploy.yml/runs?head_sha=${pr.merge_commit_sha}&per_page=20`)
    const release = runs.workflow_runs?.find((run) => run.event === 'workflow_dispatch')
    if (!release) {
      if (state.phase !== 'waiting_deploy' || state.cause !== 'deploy_missing' || !state.feedbackDeadlineAt) {
        state = ensureFeedbackDeadline(appendAudit({ ...state, phase: 'waiting_deploy', blocker: 'deploy_missing', cause: 'deploy_missing', nextAction: 'watch_release_evidence', nextExpectedResult: 'canonical_production_release_run', etaSeconds: 60 }, 'merge_verified', `commit=${pr.merge_commit_sha}`), Date.now(), feedbackMinutes)
      }
      if (feedbackIsStale(state)) await terminal(pr.number, holder, state, 'deploy_missing', 'Nu există run production-release legat de commitul merged în deadline; deploy-ul nu este inventat sau pornit fără receipturile canonice.')
      else await saveState(pr.number, holder, appendAudit(state, 'deploy_evidence_poll', `commit=${pr.merge_commit_sha}; deadline=${state.feedbackDeadlineAt}`))
      continue
    }
    if (release.status !== 'completed') continue
    if (release.conclusion !== 'success') return terminal(pr.number, holder, state, 'deploy_failed', `run=${release.id}`)
    if (!liveOrigin) return terminal(pr.number, holder, state, 'live_origin_not_configured', `deploy_run=${release.id}`)
    const versionResponse = await fetch(`${liveOrigin}/api/version`, { redirect: 'error', signal: AbortSignal.timeout(15_000) })
    const version = await versionResponse.json().catch(() => ({}))
    const liveCommit = String(version.commit ?? version.sha ?? '').toLowerCase()
    if (!versionResponse.ok || liveCommit !== pr.merge_commit_sha) return terminal(pr.number, holder, state, 'live_version_mismatch', `deploy_run=${release.id}; live=${liveCommit || 'unknown'}`)
    state = appendAudit({ ...state, phase: 'complete', blocker: 'none', cause: 'none', nextAction: 'none', feedbackDeadlineAt: null }, 'live_verified', `commit=${liveCommit}; deploy_run=${release.id}`)
    await saveState(pr.number, holder, state)
  }
}

async function main() {
  const open = await api(`/repos/${repository}/pulls?state=open&base=master&sort=updated&direction=desc&per_page=${maxPrs}`)
  for (const pr of open) {
    try { await handlePr(pr.number) } catch (error) {
      const holder = await stateComment(pr.number, pr.head.sha).catch(() => null)
      if (holder) await terminal(pr.number, holder, holder.state, 'watchdog_internal_failure', redactEvidence(error)).catch(() => undefined)
      process.stderr.write(`PR #${pr.number}: ${redactEvidence(error)}\n`)
    }
  }
  await followClosedTrackedPrs()
}

await main()
