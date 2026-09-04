#!/usr/bin/env node
// Dispatcher de release separat. Nu execută SSH/deploy și nu are credentială
// de push; poate doar valida un commit merged și porni workflow-ul aprobat care
// păstrează credentialele production environment.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  assertLoopbackApi,
  canonicalJson,
  fail,
  loadSystemdCredential,
  postInternal,
  sha256,
  signedServiceHeaders,
  startLease,
  strictJobIdentity,
} from './lib/constructor-service-client.mjs'
import { deterministicUuid, githubRequest, validateRepository } from './lib/github-fixed-client.mjs'

const API = assertLoopbackApi(process.env.KELION_CONSTRUCTOR_API ?? 'http://127.0.0.1:8080/')
const ENABLED = process.env.CONSTRUCTOR_RELEASE_EXEC_ENABLED === '1'
const ENABLE_MARKER = process.env.CONSTRUCTOR_RELEASE_ENABLE_MARKER ?? '/etc/kelion/constructor-release.enabled'
const REPOSITORY = process.env.KELION_GITHUB_REPOSITORY ?? ''
const WORKFLOW = process.env.CONSTRUCTOR_RELEASE_WORKFLOW ?? 'deploy.yml'
const STATE = resolve(process.env.CONSTRUCTOR_RELEASE_STATE ?? '/var/lib/kelion-release/state')
const PUBLIC_ORIGIN = process.env.KELION_PUBLIC_APP_ORIGIN ?? ''
const PREFIX = 'x-constructor-release'
const BUILD_WORKFLOW_PATH = '.github/workflows/build-images.yml'
const RELEASE_WORKFLOW_PATH = '.github/workflows/deploy.yml'
const EXPECTED_CHECKS = (process.env.CONSTRUCTOR_RELEASE_REQUIRED_CHECKS ?? 'verify,container-isolation')
  .split(',').map((value) => value.trim()).filter(Boolean)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const INTENT_RETIRE_AFTER_MS = 4 * 60 * 60_000

function releaseFailureCode(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/CI push .* nu este verde/i.test(message)) return 'ci_failed'
  if (/Artefactul OCI semnat nu este disponibil/i.test(message)) return 'artifact_missing'
  if (/Workflow-ul release nu este verde/i.test(message)) return 'release_workflow_failed'
  if (/Workflow-ul release nu a apărut|Ambiguitatea dispatchului release v1|Workflow-ul release v1 nu a putut fi dovedit/i.test(message)) return 'release_dispatch_ambiguous'
  if (/Dovada externă nu confirmă commitul live/i.test(message)) return 'live_proof_failed'
  if (/Commitul merged nu este strămoș|Ținta release nu mai aparține master/i.test(message)) return 'master_diverged'
  if (/Ținta release a fost depășită/i.test(message)) return 'target_advanced'
  if (/Credentială GitHub invalidă|GitHub .*HTTP (?:401|403)\b/i.test(message)) return 'github_auth_required'
  return 'release_failed'
}

function assertEnabledLayout() {
  if (!ENABLED || !existsSync(ENABLE_MARKER)) fail('Release dispatcher este dezactivat explicit')
  if (process.platform !== 'linux' || process.getuid?.() === 0) fail('Release dispatcher rulează numai non-root pe Linux')
  validateRepository(REPOSITORY)
  if (WORKFLOW !== 'deploy.yml' || STATE !== '/var/lib/kelion-release/state') fail('Config release necanonic')
  if (EXPECTED_CHECKS.length < 2 || new Set(EXPECTED_CHECKS).size !== EXPECTED_CHECKS.length) fail('Controale release invalide')
  const origin = new URL(PUBLIC_ORIGIN)
  if (origin.protocol !== 'https:' || origin.origin !== PUBLIC_ORIGIN || origin.username || origin.password) fail('Origine publică invalidă')
}

const github = (token, path, method = 'GET', body = undefined) =>
  githubRequest(token, REPOSITORY, path, method, body)

async function releaseUpstreamPreflight(token) {
  const [repository, workflow, workflowFile, actions] = await Promise.all([
    github(token, `/repos/${REPOSITORY}`),
    github(token, `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}`),
    github(token, `/repos/${REPOSITORY}/contents/${RELEASE_WORKFLOW_PATH}?ref=master`),
    github(token, `/repos/${REPOSITORY}/actions/runs?per_page=1`),
  ])
  const permissions = repository?.permissions ?? {}
  if (repository?.full_name !== REPOSITORY || ![permissions.push, permissions.maintain, permissions.admin].some((value) => value === true)) {
    fail('Credentiala GitHub release nu are rol write/maintain/admin pe repository-ul exact')
  }
  if (workflow?.path !== RELEASE_WORKFLOW_PATH || workflow?.state !== 'active') fail('Workflow-ul release canonic nu este activ')
  if (
    workflowFile?.type !== 'file'
    || workflowFile?.path !== RELEASE_WORKFLOW_PATH
    || !/^[0-9a-f]{40}$/.test(String(workflowFile?.sha ?? '').toLowerCase())
    || Number(workflowFile?.size) <= 0
  ) fail('Conținutul workflow-ului release canonic nu poate fi verificat pe master')
  if (!Array.isArray(actions?.workflow_runs)) fail('GitHub Actions nu poate fi citit cu credentiala release')
}

async function reportReleasePreflightFailure(hmac, error) {
  const code = releaseFailureCode(error)
  await postInternal({
    api: API,
    secret: hmac,
    prefix: PREFIX,
    path: '/api/internal/constructor-release/heartbeat',
    body: { state: 'degraded', detail: `release upstream preflight: ${code}` },
  }).catch(() => undefined)
}

function receiptHash(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'))
}

function intentRetirementMature(createdAt, now = Date.now()) {
  const timestamp = Date.parse(String(createdAt ?? ''))
  return Number.isFinite(timestamp) && timestamp <= now - INTENT_RETIRE_AFTER_MS
}

function missingRunDecision({ persistedRequestId, intentCreatedAt, targetCommit, masterCommit, now = Date.now() }) {
  if (masterCommit === targetCommit) return 'dispatch_same_request'
  if (persistedRequestId && intentRetirementMature(intentCreatedAt, now)) return 'retire_absent_intent'
  return 'wait_for_consistency'
}

async function verifyMergedCandidate(token, job) {
  const releaseProtocolVersion = Number(job.releaseProtocolVersion)
  if (![1, 2].includes(releaseProtocolVersion)) fail('Versiunea protocolului release este invalidă')
  const commit = String(job.commit ?? '').toLowerCase()
  const headCommit = String(job.headCommit ?? '').toLowerCase()
  const prNumber = Number(job.prNumber)
  const prUrl = String(job.prUrl ?? '')
  const publisherReceipt = String(job.publisherReceiptSha256 ?? '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(headCommit) || !Number.isSafeInteger(prNumber) || prNumber <= 0 || prUrl !== `https://github.com/${REPOSITORY}/pull/${prNumber}` || !/^[0-9a-f]{64}$/.test(publisherReceipt)) {
    fail('Claim release invalid')
  }
  const pr = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`)
  if (pr?.merged !== true || pr?.merge_commit_sha !== commit || pr?.head?.sha !== headCommit || pr?.base?.ref !== 'master') fail('Dovada merge-ului nu corespunde claim-ului')
  const master = await github(token, `/repos/${REPOSITORY}/git/ref/heads/master`)
  const masterCommit = String(master?.object?.sha ?? '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(masterCommit)) fail('Vârful master nu poate fi verificat')
  const storedTarget = String(job.releaseTargetCommit ?? '').toLowerCase()
  const storedTargetReceipt = String(job.releaseTargetReceiptSha256 ?? '').toLowerCase()
  if (
    Boolean(storedTarget) !== Boolean(storedTargetReceipt)
    || (storedTarget && (!/^[0-9a-f]{40}$/.test(storedTarget) || !/^[0-9a-f]{64}$/.test(storedTargetReceipt)))
  ) {
    fail('Ținta release persistată este invalidă')
  }
  if (releaseProtocolVersion === 1 && storedTarget && storedTarget !== commit) fail('Ținta reconciliată v1 diferă de commitul original')
  // A persisted target remains authoritative while an intent or dispatch is
  // being reconciled.  Advancing to current master is a later, explicit DB
  // transition and is forbidden while an external workflow may still exist.
  const targetCommit = releaseProtocolVersion === 1 ? commit : (storedTarget || masterCommit)
  if (targetCommit !== commit) {
    const inclusion = await github(token, `/repos/${REPOSITORY}/compare/${commit}...${targetCommit}`)
    if (!['ahead', 'identical'].includes(inclusion?.status) || inclusion?.merge_base_commit?.sha !== commit) {
      fail('Commitul merged nu este strămoș al țintei release')
    }
  }
  if (storedTarget && storedTarget !== masterCommit) {
    const stillOnMaster = await github(token, `/repos/${REPOSITORY}/compare/${storedTarget}...${masterCommit}`)
    if (!['ahead', 'identical'].includes(stillOnMaster?.status) || stillOnMaster?.merge_base_commit?.sha !== storedTarget) {
      fail('Ținta release nu mai aparține master')
    }
  }
  return {
    commit,
    targetCommit,
    masterCommit,
    previousTargetCommit: storedTarget || null,
    previousTargetReceipt: storedTargetReceipt || null,
    headCommit,
    prNumber,
    prUrl,
    publisherReceipt,
    releaseProtocolVersion,
  }
}

async function successfulPushChecks(token, commit) {
  const runs = await github(token, `/repos/${REPOSITORY}/actions/workflows/pr-verify.yml/runs?head_sha=${commit}&event=push&status=completed&per_page=30`)
  const candidates = (runs?.workflow_runs ?? [])
    .filter((run) => run?.head_sha === commit && run?.event === 'push' && run?.conclusion === 'success' && Number.isSafeInteger(Number(run?.id)))
    .sort((left, right) => Number(right.id) - Number(left.id))
  for (const candidate of candidates) {
    const jobs = await github(token, `/repos/${REPOSITORY}/actions/runs/${candidate.id}/jobs?filter=latest&per_page=100`)
    const byName = new Map((jobs?.jobs ?? []).map((job) => [job.name, job]))
    if (EXPECTED_CHECKS.every((name) => byName.get(name)?.conclusion === 'success')) return Number(candidate.id)
  }
  return null
}

async function exactSuccessfulPushChecks(token, commit, runId) {
  if (!Number.isSafeInteger(runId) || runId <= 0) fail('Runul CI persistat este invalid')
  const run = await github(token, `/repos/${REPOSITORY}/actions/runs/${runId}`)
  if (run?.head_sha !== commit || run?.event !== 'push' || run?.conclusion !== 'success') {
    fail('Runul CI persistat nu mai corespunde candidatului release')
  }
  const jobs = await github(token, `/repos/${REPOSITORY}/actions/runs/${runId}/jobs?filter=latest&per_page=100`)
  const byName = new Map((jobs?.jobs ?? []).map((job) => [job.name, job]))
  if (!EXPECTED_CHECKS.every((name) => byName.get(name)?.conclusion === 'success')) {
    fail('Joburile obligatorii ale runului CI persistat nu sunt verzi')
  }
  return runId
}

async function successfulBuildArtifact(token, commit, ciRunId) {
  const expectedTitle = `build-release-${ciRunId}-${commit}`
  const matches = []
  for (let page = 1; page <= 100; page += 1) {
    const runs = await github(token, `/repos/${REPOSITORY}/actions/workflows/build-images.yml/runs?event=workflow_run&status=completed&per_page=100&page=${page}`)
    const pageRuns = runs?.workflow_runs ?? []
    matches.push(...pageRuns.filter((run) => buildRunIdentityMatches(run, commit, ciRunId)))
    if (pageRuns.length < 100) break
    if (page === 100) fail('Căutarea buildului exact a depășit fereastra sigură; dispatchul este oprit')
  }
  matches.sort((left, right) => Number(right.id) - Number(left.id))
  const run = matches[0]
  const buildRunId = Number(run?.id)
  if (!Number.isSafeInteger(buildRunId) || buildRunId <= 0) return null
  const artifacts = await github(token, `/repos/${REPOSITORY}/actions/runs/${buildRunId}/artifacts?per_page=100`)
  const expectedName = `release-images-${commit}`
  const exact = (artifacts?.artifacts ?? []).filter((artifact) => artifact?.name === expectedName && artifact?.expired === false)
  if (exact.length !== 1 || !Number.isSafeInteger(Number(exact[0]?.id)) || Number(exact[0]?.size_in_bytes) <= 0) return null
  // `deploy.yml` verifică apoi conținutul, sourceRunId=ciRunId și semnăturile;
  // dispatcherul dovedește aici că artefactul exact există înainte de dispatch.
  return { buildRunId, artifactId: Number(exact[0].id), ciRunId }
}

function buildRunIdentityMatches(run, commit, ciRunId) {
  return /^[0-9a-f]{40}$/.test(String(run?.head_sha ?? '').toLowerCase())
    && run?.event === 'workflow_run'
    && run?.conclusion === 'success'
    && typeof run?.path === 'string'
    && (run.path === BUILD_WORKFLOW_PATH
      || (run.path.startsWith(`${BUILD_WORKFLOW_PATH}@`) && /^@[A-Za-z0-9._/-]{1,300}$/.test(run.path.slice(BUILD_WORKFLOW_PATH.length))))
    && run?.display_title === `build-release-${ciRunId}-${commit}`
}

async function exactSuccessfulBuildArtifact(token, commit, ciRunId, buildRunId, artifactId) {
  if (![buildRunId, artifactId].every((value) => Number.isSafeInteger(value) && value > 0)) {
    fail('Identitatea build/artefact persistată este invalidă')
  }
  const run = await github(token, `/repos/${REPOSITORY}/actions/runs/${buildRunId}`)
  if (!buildRunIdentityMatches(run, commit, ciRunId)) {
    fail('Buildul persistat nu corespunde runului CI și commitului release')
  }
  const artifacts = await github(token, `/repos/${REPOSITORY}/actions/runs/${buildRunId}/artifacts?per_page=100`)
  const exact = (artifacts?.artifacts ?? []).filter((artifact) =>
    Number(artifact?.id) === artifactId
    && artifact?.name === `release-images-${commit}`
    && artifact?.expired === false
    && Number(artifact?.size_in_bytes) > 0,
  )
  if (exact.length !== 1) fail('Artefactul persistat nu mai este disponibil sau nu corespunde buildului')
  return { buildRunId, artifactId, ciRunId }
}

function releaseRunTitles(requestId, commit, ciRunId = null, buildRunId = null, allowLegacyTitle = false) {
  const titles = new Set([`production-${requestId}-${commit}-${ciRunId ?? ''}-${buildRunId ?? ''}`])
  if (allowLegacyTitle) titles.add(`production-${requestId}`)
  return titles
}

function releaseRunIdentityMatches(run, requestId, commit, ciRunId = null, buildRunId = null, allowLegacyTitle = false) {
  return run?.event === 'workflow_dispatch'
    && /^[0-9a-f]{40}$/.test(String(run?.head_sha ?? '').toLowerCase())
    && releaseRunTitles(requestId, commit, ciRunId, buildRunId, allowLegacyTitle).has(run?.display_title)
}

async function existingReleaseRun(token, requestId, commit, ciRunId = null, buildRunId = null, allowLegacyTitle = false) {
  const titles = releaseRunTitles(requestId, commit, ciRunId, buildRunId, allowLegacyTitle)
  const matches = []
  for (let page = 1; page <= 100; page += 1) {
    const runs = await github(token, `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=100&page=${page}`)
    const pageRuns = runs?.workflow_runs ?? []
    const titled = pageRuns.filter((run) => titles.has(run?.display_title) && run?.event === 'workflow_dispatch')
    if (titled.some((run) => !releaseRunIdentityMatches(run, requestId, commit, ciRunId, buildRunId, allowLegacyTitle))) {
      fail('Identitatea unui workflow release existent este invalidă')
    }
    matches.push(...titled)
    if (pageRuns.length < 100) break
    if (page === 100) fail('Căutarea release-ului existent nu a fost exhaustivă; un dispatch duplicat este interzis')
  }
  return canonicalReleaseRun(matches)
}

function canonicalReleaseRun(matches) {
  const ordered = [...matches].sort((left, right) => {
    const leftId = Number(left?.id)
    const rightId = Number(right?.id)
    if (![leftId, rightId].every((value) => Number.isSafeInteger(value) && value > 0)) {
      fail('Identitatea unui workflow release existent este invalidă')
    }
    return leftId - rightId
  })
  const canonical = ordered[0] ?? null
  // A retry after an uncertain dispatch can create more than one GitHub run.
  // deploy.yml serializes equal request ids and deploy.sh keeps the durable
  // success ledger; the oldest run is the canonical receipt identity.
  return canonical
}

async function exactReleaseRun(token, runId, requestId, commit, ciRunId = null, buildRunId = null, allowLegacyTitle = false) {
  if (!Number.isSafeInteger(runId) || runId <= 0) fail('Run id release persistat invalid')
  const run = await github(token, `/repos/${REPOSITORY}/actions/runs/${runId}`)
  if (!releaseRunIdentityMatches(run, requestId, commit, ciRunId, buildRunId, allowLegacyTitle)) {
    fail('Runul release persistat nu mai corespunde cererii și țintei canonice')
  }
  return run
}

function shouldRerunRelease(run) {
  return run?.status === 'completed' && run?.conclusion !== 'success'
}

function releaseRunAttempt(run) {
  const attempt = Number(run?.run_attempt ?? 1)
  if (!Number.isSafeInteger(attempt) || attempt <= 0) fail('Run attempt release invalid')
  return attempt
}

async function waitForReleaseRun(token, requestId, commit, renew, ciRunId = null, buildRunId = null, allowLegacyTitle = false) {
  const deadline = Date.now() + 4 * 60 * 60_000
  while (Date.now() < deadline) {
    await renew()
    const run = await existingReleaseRun(token, requestId, commit, ciRunId, buildRunId, allowLegacyTitle)
    if (run) return run
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000))
  }
  fail('Workflow-ul release nu a apărut în fereastra permisă')
}

async function waitForCompletion(token, runId, requestId, commit, renew, minimumRunAttempt = 1, ciRunId = null, buildRunId = null, allowLegacyTitle = false) {
  const deadline = Date.now() + 4 * 60 * 60_000
  while (Date.now() < deadline) {
    await renew()
    const run = await github(token, `/repos/${REPOSITORY}/actions/runs/${runId}`)
    if (!releaseRunIdentityMatches(run, requestId, commit, ciRunId, buildRunId, allowLegacyTitle)) fail('Identitatea workflow-ului release s-a schimbat')
    const runAttempt = releaseRunAttempt(run)
    if (runAttempt < minimumRunAttempt) {
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
      continue
    }
    if (run?.status === 'completed') {
      return run
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20_000))
  }
  fail('Timeout așteptând aprobarea sau terminarea release-ului')
}

const RETIREABLE_CONCLUSIONS = new Set([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'timed_out',
])

function terminalFailureConclusion(run) {
  const conclusion = String(run?.conclusion ?? '')
  if (run?.status !== 'completed' || !RETIREABLE_CONCLUSIONS.has(conclusion)) {
    fail('Workflow-ul release nu are un verdict terminal retragabil')
  }
  return conclusion
}

async function currentMasterIncludingTarget(token, targetCommit) {
  const master = await github(token, `/repos/${REPOSITORY}/git/ref/heads/master`)
  const masterCommit = String(master?.object?.sha ?? '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(masterCommit)) fail('Vârful master nu poate fi verificat')
  if (masterCommit !== targetCommit) {
    const inclusion = await github(token, `/repos/${REPOSITORY}/compare/${targetCommit}...${masterCommit}`)
    if (!['ahead', 'identical'].includes(inclusion?.status) || inclusion?.merge_base_commit?.sha !== targetCommit) {
      fail('Ținta release nu mai aparține master')
    }
  }
  return masterCommit
}

async function externalProof(commit) {
  const response = await fetch(new URL('/api/release-proof', PUBLIC_ORIGIN), { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  const payload = await response.json().catch(() => null)
  const liveSha = String(payload?.activeCommit ?? '').toLowerCase()
  const activeReady = payload?.ready === true && payload?.release?.sideEffectsActive === true
  if (!response.ok || !activeReady || !/^[0-9a-f]{40}$/.test(liveSha) || liveSha !== commit) {
    fail('Dovada externă nu confirmă commitul live')
  }
  return liveSha
}

async function reconcileLegacyRelease({ candidate, claimJob, identity, githubToken, hmacSecret, renewLease, stopLease }) {
  const requestId = deterministicUuid(`kelion-release-v1\n${identity.jobId}\n${identity.taskId}\n${candidate.commit}`)
  const storedRequestId = String(claimJob.releaseRequestId ?? '').toLowerCase()
  const storedRunPresent = claimJob.workflowRunId !== null && claimJob.workflowRunId !== undefined
  const storedRunId = storedRunPresent ? Number(claimJob.workflowRunId) : null
  const storedDispatchReceipt = String(claimJob.dispatchReceiptSha256 ?? '').toLowerCase()
  if (storedRequestId && (storedRequestId !== requestId || !UUID.test(storedRequestId))) fail('Cererea v1 persistată este invalidă')
  if (storedRunPresent && (!Number.isSafeInteger(storedRunId) || storedRunId <= 0)) fail('Run id v1 persistat invalid')
  if ((storedRequestId || storedRunPresent || storedDispatchReceipt) && !(storedRequestId && storedRunPresent && /^[0-9a-f]{64}$/.test(storedDispatchReceipt))) {
    fail('Checkpointul v1 este parțial')
  }

  const ambiguityValuePresent = claimJob.legacyAmbiguityStartedAt !== null
    && claimJob.legacyAmbiguityStartedAt !== undefined
  const legacyAmbiguityStartedAt = ambiguityValuePresent
    ? String(claimJob.legacyAmbiguityStartedAt)
    : null
  const ambiguityTimestamp = legacyAmbiguityStartedAt === null
    ? Number.NaN
    : Date.parse(legacyAmbiguityStartedAt)
  if (
    ambiguityValuePresent
    && (!Number.isFinite(ambiguityTimestamp) || new Date(ambiguityTimestamp).toISOString() !== legacyAmbiguityStartedAt)
  ) fail('Momentul ambiguității dispatchului release v1 este invalid')

  const storedTargetReceipt = String(claimJob.releaseTargetReceiptSha256 ?? '').toLowerCase()
  const storedCandidate = {
    ciRunId: Number(claimJob.ciRunId),
    buildRunId: Number(claimJob.buildRunId),
    artifactId: Number(claimJob.artifactId),
    receipt: String(claimJob.candidateReceiptSha256 ?? '').toLowerCase(),
  }
  const storedCandidateCount = [storedCandidate.ciRunId, storedCandidate.buildRunId, storedCandidate.artifactId]
    .filter((value) => Number.isSafeInteger(value) && value > 0).length
    + (/^[0-9a-f]{64}$/.test(storedCandidate.receipt) ? 1 : 0)
  if (storedCandidateCount !== 0 && storedCandidateCount !== 4) fail('Checkpointul candidatului v1 reconciliat este parțial')
  if (
    ambiguityValuePresent
    && (
      (claimJob.releaseTargetCommit !== null && claimJob.releaseTargetCommit !== undefined)
      || storedTargetReceipt
      || storedCandidateCount !== 0
      || storedRequestId
      || storedRunPresent
      || storedDispatchReceipt
      || (claimJob.intentReceiptSha256 !== null && claimJob.intentReceiptSha256 !== undefined)
      || (claimJob.intentCreatedAt !== null && claimJob.intentCreatedAt !== undefined)
    )
  ) fail('Ambiguitatea dispatchului release v1 are checkpointuri externe incompatibile')

  let discoveredLegacyRun = null
  if (ambiguityValuePresent) {
    // Schema veche putea muri înainte sau după POST. Căutăm toate runurile
    // păstrate de GitHub înainte de a aștepta CI/build și nu emitem niciodată
    // din nou side effect-ul v1 pe baza unui simplu attempts>0.
    discoveredLegacyRun = await existingReleaseRun(
      githubToken,
      requestId,
      candidate.commit,
      null,
      null,
      true,
    )
    if (!discoveredLegacyRun) {
      if (!intentRetirementMature(legacyAmbiguityStartedAt)) {
        fail('Ambiguitatea dispatchului release v1 rămâne blocată până la încheierea ferestrei de consistență')
      }
      await stopLease.assert()
      const currentMaster = await currentMasterIncludingTarget(githubToken, candidate.commit)
      const resolutionReceipt = receiptHash({
        schema: 1,
        kind: 'legacy-release-dispatch-absence-resolution',
        jobId: identity.jobId,
        taskId: identity.taskId,
        mergedCommit: candidate.commit,
        requestId,
        ambiguityStartedAt: legacyAmbiguityStartedAt,
        currentMaster,
      })
      await postInternal({
        api: API,
        secret: hmacSecret,
        prefix: PREFIX,
        path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`,
        body: {
          taskId: identity.taskId,
          leaseId: identity.leaseId,
          event: 'legacy_dispatch_absence_resolved',
          mergedCommit: candidate.commit,
          requestId,
          ambiguityStartedAt: legacyAmbiguityStartedAt,
          currentMaster,
          receiptSha256: resolutionReceipt,
        },
      })
      fail('Ambiguitatea dispatchului release v1 a fost rezolvată durabil; următorul claim folosește v2')
    }
  }
  let ciRunId = null
  let build = null
  if (storedCandidateCount === 4) {
    ciRunId = await exactSuccessfulPushChecks(githubToken, candidate.commit, storedCandidate.ciRunId)
    build = await exactSuccessfulBuildArtifact(githubToken, candidate.commit, ciRunId, storedCandidate.buildRunId, storedCandidate.artifactId)
  } else {
    const ciDeadline = Date.now() + 90 * 60_000
    while (!ciRunId && Date.now() < ciDeadline) {
      await renewLease()
      ciRunId = await successfulPushChecks(githubToken, candidate.commit)
      if (!ciRunId) await new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000))
    }
    if (!ciRunId) fail('CI push pe commitul merged nu este verde')
    const buildDeadline = Date.now() + 130 * 60_000
    while (!build && Date.now() < buildDeadline) {
      await renewLease()
      build = await successfulBuildArtifact(githubToken, candidate.commit, ciRunId)
      if (!build) await new Promise((resolvePromise) => setTimeout(resolvePromise, 20_000))
    }
  }
  if (!build) fail('Artefactul OCI semnat nu este disponibil pentru commitul merged')

  const targetReceipt = receiptHash({ schema: 1, kind: 'release-target-v1-migration', jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.commit, publisherReceiptSha256: candidate.publisherReceipt })
  const candidateReceipt = receiptHash({ schema: 1, kind: 'release-candidate', jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.commit, targetReceiptSha256: targetReceipt, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId })
  if (storedTargetReceipt && storedTargetReceipt !== targetReceipt) fail('Receiptul țintei v1 reconciliate este invalid')
  if (storedCandidateCount === 4 && storedCandidate.receipt !== candidateReceipt) fail('Receiptul candidatului v1 reconciliat este invalid')
  let run = storedRunId !== null
    ? await exactReleaseRun(githubToken, storedRunId, requestId, candidate.commit, ciRunId, build.buildRunId, true)
    : discoveredLegacyRun
      ? await exactReleaseRun(githubToken, Number(discoveredLegacyRun.id), requestId, candidate.commit, ciRunId, build.buildRunId, true)
      : await existingReleaseRun(githubToken, requestId, candidate.commit, ciRunId, build.buildRunId, true)
  if (!run) {
    fail('Workflow-ul release v1 nu a putut fi dovedit; redispatch-ul ambiguu este interzis')
  }
  const workflowRunId = Number(run?.id)
  if (!Number.isSafeInteger(workflowRunId) || workflowRunId <= 0) fail('Run id v1 invalid')
  const dispatchReceipt = receiptHash({ schema: 1, kind: 'release-dispatch', jobId: identity.jobId, taskId: identity.taskId, commit: candidate.commit, requestId, workflowRunId, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, publisherReceiptSha256: candidate.publisherReceipt })
  if (storedDispatchReceipt && storedDispatchReceipt !== dispatchReceipt) fail('Receiptul dispatchului v1 nu corespunde dovezilor exacte')
  await postInternal({
    api: API,
    secret: hmacSecret,
    prefix: PREFIX,
    path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`,
    body: {
      taskId: identity.taskId,
      leaseId: identity.leaseId,
      event: 'legacy_dispatch_reconciled',
      targetCommit: candidate.commit,
      targetReceiptSha256: targetReceipt,
      requestId,
      workflowRunId,
      ciRunId,
      buildRunId: build.buildRunId,
      artifactId: build.artifactId,
      candidateReceiptSha256: candidateReceipt,
      dispatchReceiptSha256: dispatchReceipt,
    },
  })

  const retireFailedV1IfSuperseded = async (failedRun) => {
    const conclusion = terminalFailureConclusion(failedRun)
    const latestMaster = await currentMasterIncludingTarget(githubToken, candidate.commit)
    if (latestMaster === candidate.commit) return false
    const retirementReceipt = receiptHash({ schema: 1, kind: 'release-dispatch-retirement', jobId: identity.jobId, taskId: identity.taskId, targetCommit: candidate.commit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, intentReceiptSha256: null, dispatchReceiptSha256: dispatchReceipt, candidateReceiptSha256: candidateReceipt })
    await postInternal({ api: API, secret: hmacSecret, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'dispatch_retired', targetCommit: candidate.commit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, receiptSha256: retirementReceipt } })
    fail('Ținta release v1 a fost depășită după verdictul terminal al workflow-ului')
  }

  const retireSuccessfulV1IfSuperseded = async () => {
    const latestMaster = await currentMasterIncludingTarget(githubToken, candidate.commit)
    if (latestMaster === candidate.commit) return false
    const conclusion = 'target_advanced_after_success'
    const retirementReceipt = receiptHash({ schema: 1, kind: 'release-dispatch-retirement', jobId: identity.jobId, taskId: identity.taskId, targetCommit: candidate.commit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, intentReceiptSha256: null, dispatchReceiptSha256: dispatchReceipt, candidateReceiptSha256: candidateReceipt })
    await postInternal({ api: API, secret: hmacSecret, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'dispatch_retired', targetCommit: candidate.commit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, receiptSha256: retirementReceipt } })
    fail('Ținta release v1 a fost depășită după workflow-ul reușit')
  }

  let minimumRunAttempt = 1
  if (shouldRerunRelease(run)) {
    await retireFailedV1IfSuperseded(run)
    const previousRunAttempt = releaseRunAttempt(run)
    await stopLease.assert()
    await github(githubToken, `/repos/${REPOSITORY}/actions/runs/${workflowRunId}/rerun-failed-jobs`, 'POST')
    minimumRunAttempt = previousRunAttempt + 1
  }
  const completedRun = await waitForCompletion(githubToken, workflowRunId, requestId, candidate.commit, renewLease, minimumRunAttempt, null, null, true)
  if (completedRun?.conclusion !== 'success') {
    await retireFailedV1IfSuperseded(completedRun)
    fail('Workflow-ul release nu este verde')
  }
  await stopLease.assert()
  await retireSuccessfulV1IfSuperseded()
  const liveVersion = await externalProof(candidate.commit)
  await retireSuccessfulV1IfSuperseded()
  const releaseReceipt = receiptHash({ schema: 2, kind: 'release-deployed-v1-reconciled', jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.commit, requestId, workflowRunId, liveVersion })
  await postInternal({ api: API, secret: hmacSecret, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'deployed', requestId, workflowRunId, commit: candidate.commit, targetCommit: candidate.commit, liveVersion, receiptSha256: releaseReceipt } })
  writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 2, migratedFromReleaseProtocol: 1, jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.commit, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, requestId, workflowRunId, liveVersion, releaseReceipt })}\n`, { mode: 0o600 })
}

async function runOnce() {
  const hmac = loadSystemdCredential('constructor-release-secret', process.env.CONSTRUCTOR_RELEASE_SECRET_FILE)
  let githubCredential
  try {
    assertEnabledLayout()
    mkdirSync(STATE, { recursive: true, mode: 0o700 })
    githubCredential = loadSystemdCredential('github-release-token', process.env.GITHUB_RELEASE_TOKEN_FILE)
    await releaseUpstreamPreflight(githubCredential.value)
  } catch (error) {
    await reportReleasePreflightFailure(hmac.value, error)
    throw error
  }
  const claim = await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: '/api/internal/constructor-release/jobs/claim', body: {} })
  if (!claim?.job) return
  const identity = strictJobIdentity(claim.job)
  const leasePath = `/api/internal/constructor-release/jobs/${identity.jobId}/lease`
  const renewLease = () => postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  const stopLease = startLease({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  try {
    await stopLease.assert()
    const candidate = await verifyMergedCandidate(githubCredential.value, claim.job)
    if (candidate.releaseProtocolVersion === 1) {
      await reconcileLegacyRelease({
        candidate,
        claimJob: claim.job,
        identity,
        githubToken: githubCredential.value,
        hmacSecret: hmac.value,
        renewLease,
        stopLease,
      })
      return
    }
    const persistedCandidate = {
      ciRunId: Number(claim.job.ciRunId),
      buildRunId: Number(claim.job.buildRunId),
      artifactId: Number(claim.job.artifactId),
      receipt: String(claim.job.candidateReceiptSha256 ?? '').toLowerCase(),
    }
    let persistedCandidateCount = [persistedCandidate.ciRunId, persistedCandidate.buildRunId, persistedCandidate.artifactId]
      .filter((value) => Number.isSafeInteger(value) && value > 0).length
      + (/^[0-9a-f]{64}$/.test(persistedCandidate.receipt) ? 1 : 0)
    if (persistedCandidateCount !== 0 && persistedCandidateCount !== 4) fail('Checkpointul candidatului release este parțial')

    const persistedRequestId = String(claim.job.releaseRequestId ?? '').toLowerCase()
    const persistedIntentReceipt = String(claim.job.intentReceiptSha256 ?? '').toLowerCase()
    const persistedIntentCreatedAt = claim.job.intentCreatedAt == null ? null : String(claim.job.intentCreatedAt)
    const persistedDispatchReceipt = String(claim.job.dispatchReceiptSha256 ?? '').toLowerCase()
    const workflowValuePresent = claim.job.workflowRunId !== null && claim.job.workflowRunId !== undefined
    const persistedWorkflowRunId = workflowValuePresent ? Number(claim.job.workflowRunId) : null
    if (persistedRequestId && !UUID.test(persistedRequestId)) fail('Cererea release persistată este invalidă')
    if (workflowValuePresent && (!Number.isSafeInteger(persistedWorkflowRunId) || persistedWorkflowRunId <= 0)) fail('Run id release persistat invalid')
    if (!persistedRequestId && (persistedIntentReceipt || persistedWorkflowRunId !== null || persistedDispatchReceipt)) {
      fail('Checkpointul dispatchului release este parțial')
    }
    if (persistedRequestId && persistedWorkflowRunId === null && !/^[0-9a-f]{64}$/.test(persistedIntentReceipt)) {
      fail('Checkpointul intenției release este parțial')
    }
    if (persistedRequestId && persistedWorkflowRunId === null && !Number.isFinite(Date.parse(String(persistedIntentCreatedAt ?? '')))) {
      fail('Momentul intenției release este invalid')
    }
    if (persistedWorkflowRunId !== null && !/^[0-9a-f]{64}$/.test(persistedDispatchReceipt)) {
      fail('Checkpointul dispatchului release este parțial')
    }
    if (persistedRequestId && persistedCandidateCount !== 4) fail('Dispatchul release nu are candidatul durabil complet')

    let ciRunId = null
    let build = null
    let candidateReceipt = null

    const loadPersistedCandidate = async (targetCommit, targetReceipt) => {
      ciRunId = await exactSuccessfulPushChecks(githubCredential.value, targetCommit, persistedCandidate.ciRunId)
      build = await exactSuccessfulBuildArtifact(
        githubCredential.value,
        targetCommit,
        ciRunId,
        persistedCandidate.buildRunId,
        persistedCandidate.artifactId,
      )
      candidateReceipt = receiptHash({
        schema: 1,
        kind: 'release-candidate',
        jobId: identity.jobId,
        taskId: identity.taskId,
        mergedCommit: candidate.commit,
        targetCommit,
        targetReceiptSha256: targetReceipt,
        ciRunId,
        buildRunId: build.buildRunId,
        artifactId: build.artifactId,
      })
      if (persistedCandidate.receipt !== candidateReceipt) fail('Receiptul candidatului persistat nu corespunde dovezilor exacte')
    }

    // Protocol v2 persists dispatch_intended before the GitHub side effect.
    // Therefore request=NULL is a durable proof that no v2 workflow could have
    // been emitted, and a superseded candidate can advance safely. Protocol v1
    // ambiguity is handled separately above and never reaches this branch.
    if (!persistedRequestId && candidate.previousTargetCommit && candidate.previousTargetCommit !== candidate.masterCommit) {
      candidate.targetCommit = candidate.masterCommit
      ciRunId = null
      build = null
      candidateReceipt = null
      persistedCandidateCount = 0
    }

    const targetUnchanged = candidate.previousTargetCommit === candidate.targetCommit
    const targetReceipt = targetUnchanged
      ? candidate.previousTargetReceipt
      : receiptHash({
          schema: 1,
          kind: 'release-target',
          jobId: identity.jobId,
          taskId: identity.taskId,
          mergedCommit: candidate.commit,
          targetCommit: candidate.targetCommit,
          previousTargetCommit: candidate.previousTargetCommit,
          previousTargetReceiptSha256: candidate.previousTargetReceipt,
          publisherReceiptSha256: candidate.publisherReceipt,
        })
    if (!targetReceipt || !/^[0-9a-f]{64}$/.test(targetReceipt)) fail('Receiptul țintei release nu corespunde claim-ului')
    if (!targetUnchanged) {
      await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'target_selected', targetCommit: candidate.targetCommit, receiptSha256: targetReceipt, previousTargetCommit: candidate.previousTargetCommit, previousReceiptSha256: candidate.previousTargetReceipt } })
    }

    if (persistedCandidateCount === 4 && !candidateReceipt) {
      try {
        await loadPersistedCandidate(candidate.targetCommit, targetReceipt)
      } catch (error) {
        // Până la intent nu există niciun workflow extern posibil. Un run sau
        // artefact expirat poate fi înlocuit cu o dovadă nouă pentru aceeași
        // țintă; după intent tuple-ul rămâne imuabil și eroarea se propagă.
        if (persistedRequestId) throw error
        ciRunId = null
        build = null
        candidateReceipt = null
        persistedCandidateCount = 0
      }
    }
    if (persistedCandidateCount === 0) {
      const ciDeadline = Date.now() + 90 * 60_000
      while (!ciRunId && Date.now() < ciDeadline) {
        await renewLease()
        ciRunId = await successfulPushChecks(githubCredential.value, candidate.targetCommit)
        if (!ciRunId) await new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000))
      }
      if (!ciRunId) fail('CI push pe commitul merged nu este verde')
      await stopLease.assert()
      const buildDeadline = Date.now() + 130 * 60_000
      while (!build && Date.now() < buildDeadline) {
        await renewLease()
        build = await successfulBuildArtifact(githubCredential.value, candidate.targetCommit, ciRunId)
        if (!build) await new Promise((resolvePromise) => setTimeout(resolvePromise, 20_000))
      }
      if (!build) fail('Artefactul OCI semnat nu este disponibil pentru commitul merged')
    }
    if (!ciRunId || !build) fail('Checkpointul candidatului release nu a putut fi verificat')
    await stopLease.assert()
    candidateReceipt ??= receiptHash({ schema: 1, kind: 'release-candidate', jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.targetCommit, targetReceiptSha256: targetReceipt, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId })
    await postInternal({
      api: API,
      secret: hmac.value,
      prefix: PREFIX,
      path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`,
      body: {
        taskId: identity.taskId,
        leaseId: identity.leaseId,
        event: 'candidate_verified',
        targetCommit: candidate.targetCommit,
        ciRunId,
        buildRunId: build.buildRunId,
        artifactId: build.artifactId,
        receiptSha256: candidateReceipt,
      },
    })
    await stopLease.assert()
    const requestId = deterministicUuid(`kelion-release-v2\n${identity.jobId}\n${identity.taskId}\n${candidate.targetCommit}\n${ciRunId}\n${build.buildRunId}`)
    const activeRequestId = persistedRequestId || requestId
    if (activeRequestId !== requestId) {
      fail('Cererea release persistată nu corespunde candidatului determinist')
    }
    const intentReceipt = receiptHash({ schema: 1, kind: 'release-dispatch-intent', jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.targetCommit, targetReceiptSha256: targetReceipt, candidateReceiptSha256: candidateReceipt, requestId, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, publisherReceiptSha256: candidate.publisherReceipt })
    if (persistedIntentReceipt && persistedIntentReceipt !== intentReceipt) fail('Receiptul intenției release nu corespunde candidatului')

    if (!persistedRequestId) {
      const preDispatchMaster = await currentMasterIncludingTarget(githubCredential.value, candidate.targetCommit)
      if (preDispatchMaster !== candidate.targetCommit) fail('Ținta release a fost depășită înainte de dispatch')
      await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'dispatch_intended', targetCommit: candidate.targetCommit, requestId, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, receiptSha256: intentReceipt } })
    }

    let run = persistedWorkflowRunId !== null
      ? await exactReleaseRun(githubCredential.value, persistedWorkflowRunId, requestId, candidate.targetCommit, ciRunId, build.buildRunId)
      : await existingReleaseRun(githubCredential.value, requestId, candidate.targetCommit, ciRunId, build.buildRunId)
    if (!run) {
      // The process may have died after persisting dispatch_intended but before
      // GitHub received the POST.  Retry the *same* deterministic request.  A
      // duplicate run is serialized/skipped by deploy.yml and the VPS success
      // ledger makes the production side effect idempotent beyond Actions'
      // retention window.
      const preDispatchMaster = await currentMasterIncludingTarget(githubCredential.value, candidate.targetCommit)
      const missingDecision = missingRunDecision({
        persistedRequestId,
        intentCreatedAt: persistedIntentCreatedAt,
        targetCommit: candidate.targetCommit,
        masterCommit: preDispatchMaster,
      })
      if (missingDecision === 'wait_for_consistency') {
        fail('Workflow-ul release nu a apărut încă; intenția rămâne blocată până la încheierea ferestrei de consistență')
      }
      if (missingDecision === 'retire_absent_intent') {
        const retirementReceipt = receiptHash({
          schema: 1,
          kind: 'release-dispatch-intent-retirement',
          jobId: identity.jobId,
          taskId: identity.taskId,
          targetCommit: candidate.targetCommit,
          replacementTargetCommit: preDispatchMaster,
          requestId,
          intentReceiptSha256: intentReceipt,
          candidateReceiptSha256: candidateReceipt,
          conclusion: 'intent_not_materialized',
        })
        await postInternal({
          api: API,
          secret: hmac.value,
          prefix: PREFIX,
          path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`,
          body: {
            taskId: identity.taskId,
            leaseId: identity.leaseId,
            event: 'dispatch_retired',
            targetCommit: candidate.targetCommit,
            replacementTargetCommit: preDispatchMaster,
            requestId,
            workflowRunId: null,
            conclusion: 'intent_not_materialized',
            receiptSha256: retirementReceipt,
          },
        })
        fail('Ținta release a fost depășită după retragerea intenției nematerializate')
      }
      await stopLease.assert()
      await github(githubCredential.value, `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, 'POST', {
        ref: 'master',
        inputs: {
          commit_sha: candidate.targetCommit,
          release_mode: 'release',
          release_request_id: requestId,
          ci_run_id: String(ciRunId),
          build_run_id: String(build.buildRunId),
        },
      })
      run = await waitForReleaseRun(githubCredential.value, requestId, candidate.targetCommit, renewLease, ciRunId, build.buildRunId)
    }
    const workflowRunId = Number(run?.id)
    if (!Number.isSafeInteger(workflowRunId) || workflowRunId <= 0) fail('Run id release invalid')
    const dispatchReceipt = receiptHash({ schema: 1, kind: 'release-dispatch', jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.targetCommit, targetReceiptSha256: targetReceipt, candidateReceiptSha256: candidateReceipt, requestId, workflowRunId, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, publisherReceiptSha256: candidate.publisherReceipt })
    if (persistedDispatchReceipt && persistedDispatchReceipt !== dispatchReceipt) fail('Receiptul dispatchului release nu corespunde runului exact')
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'dispatched', requestId, workflowRunId, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, receiptSha256: dispatchReceipt } })

    const retireFailedRunIfSuperseded = async (failedRun) => {
      const conclusion = terminalFailureConclusion(failedRun)
      const latestMaster = await currentMasterIncludingTarget(githubCredential.value, candidate.targetCommit)
      if (latestMaster === candidate.targetCommit) return false
      const retirementReceipt = receiptHash({ schema: 1, kind: 'release-dispatch-retirement', jobId: identity.jobId, taskId: identity.taskId, targetCommit: candidate.targetCommit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, intentReceiptSha256: intentReceipt, dispatchReceiptSha256: dispatchReceipt, candidateReceiptSha256: candidateReceipt })
      await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'dispatch_retired', targetCommit: candidate.targetCommit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, receiptSha256: retirementReceipt } })
      fail('Ținta release a fost depășită după verdictul terminal al workflow-ului')
    }

    const retireSuccessfulRunIfSuperseded = async () => {
      const latestMaster = await currentMasterIncludingTarget(githubCredential.value, candidate.targetCommit)
      if (latestMaster === candidate.targetCommit) return false
      const conclusion = 'target_advanced_after_success'
      const retirementReceipt = receiptHash({ schema: 1, kind: 'release-dispatch-retirement', jobId: identity.jobId, taskId: identity.taskId, targetCommit: candidate.targetCommit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, intentReceiptSha256: intentReceipt, dispatchReceiptSha256: dispatchReceipt, candidateReceiptSha256: candidateReceipt })
      await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'dispatch_retired', targetCommit: candidate.targetCommit, replacementTargetCommit: latestMaster, requestId, workflowRunId, conclusion, receiptSha256: retirementReceipt } })
      fail('Ținta release a fost depășită după workflow-ul reușit')
    }

    let minimumRunAttempt = 1
    if (shouldRerunRelease(run)) {
      await retireFailedRunIfSuperseded(run)
      const previousRunAttempt = releaseRunAttempt(run)
      await stopLease.assert()
      await github(githubCredential.value, `/repos/${REPOSITORY}/actions/runs/${workflowRunId}/rerun-failed-jobs`, 'POST')
      minimumRunAttempt = previousRunAttempt + 1
    }
    const completedRun = await waitForCompletion(githubCredential.value, workflowRunId, requestId, candidate.targetCommit, renewLease, minimumRunAttempt, ciRunId, build.buildRunId)
    if (completedRun?.conclusion !== 'success') {
      await retireFailedRunIfSuperseded(completedRun)
      fail('Workflow-ul release nu este verde')
    }
    await stopLease.assert()
    await retireSuccessfulRunIfSuperseded()
    const liveVersion = await externalProof(candidate.targetCommit)
    await retireSuccessfulRunIfSuperseded()
    const releaseReceipt = receiptHash({ schema: 1, kind: 'release-deployed', jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.targetCommit, requestId, workflowRunId, liveVersion })
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'deployed', requestId, workflowRunId, commit: candidate.commit, targetCommit: candidate.targetCommit, liveVersion, receiptSha256: releaseReceipt } })
    writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 1, jobId: identity.jobId, taskId: identity.taskId, mergedCommit: candidate.commit, targetCommit: candidate.targetCommit, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, requestId, workflowRunId, liveVersion, releaseReceipt })}\n`, { mode: 0o600 })
  } catch (error) {
    const code = releaseFailureCode(error)
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'failed', code } }).catch(() => undefined)
    throw error
  } finally {
    await stopLease().catch(() => undefined)
  }
}

function selfTest() {
  const headers = signedServiceHeaders('1'.repeat(32), PREFIX, 'POST', '/api/internal/constructor-release/jobs/claim', {}, '1787536800', '123e4567-e89b-42d3-a456-426614174000')
  if (!/^v1=[0-9a-f]{64}$/.test(headers[`${PREFIX}-signature`])) fail('HMAC release invalid')
  const requestId = deterministicUuid(`kelion-release-v2\n42\ncodex-123e4567-e89b-42d3-a456-426614174000\n${'a'.repeat(40)}\n123\n456`)
  if (!UUID.test(requestId)) fail('Idempotency key release invalid')
  const legacyRequestId = deterministicUuid(`kelion-release-v1\n42\ncodex-123e4567-e89b-42d3-a456-426614174000\n${'a'.repeat(40)}`)
  if (!UUID.test(legacyRequestId) || legacyRequestId === requestId) fail('Compatibilitatea idempotency key v1 este invalidă')
  if (WORKFLOW !== 'deploy.yml') fail('Workflow release necanonic')
  if (!shouldRerunRelease({ status: 'completed', conclusion: 'failure' })) fail('Release-ul eșuat nu cere rerun')
  if (shouldRerunRelease({ status: 'completed', conclusion: 'success' })) fail('Release-ul verde nu trebuie reluat')
  if (releaseRunAttempt({ run_attempt: 3 }) !== 3) fail('Run attempt release invalid')
  if (releaseFailureCode(new Error('Workflow-ul release nu este verde')) !== 'release_workflow_failed') fail('Clasificarea release workflow este invalidă')
  if (releaseFailureCode(new Error('Dovada externă nu confirmă commitul live')) !== 'live_proof_failed') fail('Clasificarea dovezii live este invalidă')
  if (releaseFailureCode(new Error('Commitul merged nu este strămoș al țintei release')) !== 'master_diverged') fail('Divergența master nu este clasificată')
  if (releaseFailureCode(new Error('Ținta release a fost depășită înainte de dispatch')) !== 'target_advanced') fail('Avansarea țintei release nu este clasificată')
  if (releaseFailureCode(new Error('Workflow-ul release nu a apărut în fereastra permisă')) !== 'release_dispatch_ambiguous') fail('Ambiguitatea dispatchului release nu este clasificată')
  if (releaseFailureCode(new Error('Ambiguitatea dispatchului release v1 rămâne blocată')) !== 'release_dispatch_ambiguous') fail('Ambiguitatea v1 nu este clasificată')
  const canonical = canonicalReleaseRun([
    { id: 12, head_sha: 'b'.repeat(40) },
    { id: 11, head_sha: 'b'.repeat(40) },
  ])
  if (canonical?.id !== 11) fail('Selecția runului release canonic nu este deterministă')
  if (!releaseRunIdentityMatches({ event: 'workflow_dispatch', head_sha: 'b'.repeat(40), display_title: `production-${requestId}-${'a'.repeat(40)}-123-456` }, requestId, 'a'.repeat(40), 123, 456)) {
    fail('Identitatea tuplei release nu tolerează avansarea ref-ului după dispatch')
  }
  if (!buildRunIdentityMatches({ event: 'workflow_run', conclusion: 'success', path: BUILD_WORKFLOW_PATH, head_sha: 'b'.repeat(40), display_title: `build-release-123-${'a'.repeat(40)}` }, 'a'.repeat(40), 123)) {
    fail('Identitatea buildului nu tolerează avansarea ref-ului workflow_run')
  }
  if (buildRunIdentityMatches({ event: 'workflow_run', conclusion: 'success', path: BUILD_WORKFLOW_PATH, head_sha: 'invalid', display_title: `build-release-123-${'a'.repeat(40)}` }, 'a'.repeat(40), 123)) {
    fail('Identitatea buildului acceptă un head SHA necanonic')
  }
  const now = Date.parse('2026-08-26T12:00:00.000Z')
  if (!intentRetirementMature('2026-08-26T07:59:59.000Z', now)) fail('Cooldown-ul intenției release nu expiră')
  if (intentRetirementMature('2026-08-26T08:00:01.000Z', now)) fail('Intenția release se retrage prea devreme')
  if (missingRunDecision({ persistedRequestId: requestId, intentCreatedAt: '2026-08-26T07:00:00.000Z', targetCommit: 'a'.repeat(40), masterCommit: 'b'.repeat(40), now }) !== 'retire_absent_intent') fail('Crash-ul post-intent nu poate retrage dovada absentă')
  if (missingRunDecision({ persistedRequestId: requestId, intentCreatedAt: '2026-08-26T11:00:00.000Z', targetCommit: 'a'.repeat(40), masterCommit: 'b'.repeat(40), now }) !== 'wait_for_consistency') fail('Fereastra de consistență a intenției nu este fail-closed')
  if (missingRunDecision({ persistedRequestId: requestId, intentCreatedAt: '2026-08-26T11:00:00.000Z', targetCommit: 'a'.repeat(40), masterCommit: 'a'.repeat(40), now }) !== 'dispatch_same_request') fail('Retry-ul aceleiași cereri release nu este activ')
  process.stdout.write('constructor-release self-test: TRECE\n')
}

const mode = process.argv[2] ?? '--once'
if (mode === '--self-test') selfTest()
else if (mode === '--once') {
  const activationMarkerExists = existsSync(ENABLE_MARKER)
  if (!ENABLED && !activationMarkerExists) process.stdout.write('constructor-release: dezactivat\n')
  else await runOnce()
} else fail(`Mod necunoscut: ${mode}`)
