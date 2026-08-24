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
const EXPECTED_CHECKS = (process.env.CONSTRUCTOR_RELEASE_REQUIRED_CHECKS ?? 'verify,container-isolation')
  .split(',').map((value) => value.trim()).filter(Boolean)
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

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

function receiptHash(value) {
  return sha256(Buffer.from(`${canonicalJson(value)}\n`, 'utf8'))
}

async function verifyMergedCandidate(token, job) {
  const commit = String(job.commit ?? '').toLowerCase()
  const headCommit = String(job.headCommit ?? '').toLowerCase()
  const prNumber = Number(job.prNumber)
  const prUrl = String(job.prUrl ?? '')
  const publisherReceipt = String(job.publisherReceiptSha256 ?? '').toLowerCase()
  if (!/^[0-9a-f]{40}$/.test(commit) || !/^[0-9a-f]{40}$/.test(headCommit) || !Number.isSafeInteger(prNumber) || prNumber <= 0 || prUrl !== `https://github.com/${REPOSITORY}/pull/${prNumber}` || !/^[0-9a-f]{64}$/.test(publisherReceipt)) {
    fail('Claim release invalid')
  }
  const master = await github(token, `/repos/${REPOSITORY}/git/ref/heads/master`)
  if (master?.object?.sha !== commit) fail('Release-ul poate porni numai din vârful imuabil master')
  const pr = await github(token, `/repos/${REPOSITORY}/pulls/${prNumber}`)
  if (pr?.merged !== true || pr?.merge_commit_sha !== commit || pr?.head?.sha !== headCommit || pr?.base?.ref !== 'master') fail('Dovada merge-ului nu corespunde claim-ului')
  return { commit, headCommit, prNumber, prUrl, publisherReceipt }
}

async function successfulPushChecks(token, commit) {
  const runs = await github(token, `/repos/${REPOSITORY}/actions/workflows/pr-verify.yml/runs?head_sha=${commit}&event=push&status=completed&per_page=30`)
  const success = (runs?.workflow_runs ?? []).find((run) => run?.head_sha === commit && run?.event === 'push' && run?.conclusion === 'success')
  if (!success || !Number.isSafeInteger(Number(success.id))) return null
  const jobs = await github(token, `/repos/${REPOSITORY}/actions/runs/${success.id}/jobs?filter=latest&per_page=100`)
  const byName = new Map((jobs?.jobs ?? []).map((job) => [job.name, job]))
  if (!EXPECTED_CHECKS.every((name) => byName.get(name)?.conclusion === 'success')) return null
  return Number(success.id)
}

async function successfulBuildArtifact(token, commit, ciRunId) {
  const runs = await github(token, `/repos/${REPOSITORY}/actions/workflows/build-images.yml/runs?event=workflow_run&status=completed&per_page=50`)
  const matches = (runs?.workflow_runs ?? []).filter((run) =>
    run?.head_sha === commit && run?.event === 'workflow_run' && run?.conclusion === 'success',
  )
  if (matches.length > 1) fail('Mai multe builduri verzi corespund commitului release')
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

async function existingReleaseRun(token, requestId, commit) {
  const runs = await github(token, `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/runs?event=workflow_dispatch&per_page=50`)
  const title = `production-${requestId}`
  const matches = (runs?.workflow_runs ?? []).filter((run) => run?.display_title === title && run?.head_sha === commit && run?.event === 'workflow_dispatch')
  if (matches.length > 1) fail('Mai multe workflow-uri corespund aceleiași cereri release')
  return matches[0] ?? null
}

async function waitForReleaseRun(token, requestId, commit, renew) {
  const deadline = Date.now() + 4 * 60 * 60_000
  while (Date.now() < deadline) {
    await renew()
    const run = await existingReleaseRun(token, requestId, commit)
    if (run) return run
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000))
  }
  fail('Workflow-ul release nu a apărut în fereastra permisă')
}

async function waitForCompletion(token, runId, commit, renew) {
  const deadline = Date.now() + 4 * 60 * 60_000
  while (Date.now() < deadline) {
    await renew()
    const run = await github(token, `/repos/${REPOSITORY}/actions/runs/${runId}`)
    if (run?.head_sha !== commit || run?.event !== 'workflow_dispatch') fail('Identitatea workflow-ului release s-a schimbat')
    if (run?.status === 'completed') {
      if (run?.conclusion !== 'success') fail('Workflow-ul release nu este verde')
      return run
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20_000))
  }
  fail('Timeout așteptând aprobarea sau terminarea release-ului')
}

async function externalProof(commit) {
  const versionResponse = await fetch(new URL('/api/version', PUBLIC_ORIGIN), { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  const versionPayload = await versionResponse.json().catch(() => null)
  const readyResponse = await fetch(new URL('/readyz', PUBLIC_ORIGIN), { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  const liveVersion = String(versionPayload?.v ?? '').toLowerCase()
  if (!versionResponse.ok || !readyResponse.ok || liveVersion !== commit.slice(0, 7)) fail('Dovada externă nu confirmă commitul live')
  return liveVersion
}

async function runOnce() {
  assertEnabledLayout()
  mkdirSync(STATE, { recursive: true, mode: 0o700 })
  const hmac = loadSystemdCredential('constructor-release-secret', process.env.CONSTRUCTOR_RELEASE_SECRET_FILE)
  const githubCredential = loadSystemdCredential('github-release-token', process.env.GITHUB_RELEASE_TOKEN_FILE)
  const claim = await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: '/api/internal/constructor-release/jobs/claim', body: {} })
  if (!claim?.job) return
  const identity = strictJobIdentity(claim.job)
  const leasePath = `/api/internal/constructor-release/jobs/${identity.jobId}/lease`
  const renewLease = () => postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  const stopLease = startLease({ api: API, secret: hmac.value, prefix: PREFIX, path: leasePath, body: { taskId: identity.taskId, leaseId: identity.leaseId } })
  try {
    await stopLease.assert()
    const candidate = await verifyMergedCandidate(githubCredential.value, claim.job)
    let ciRunId = null
    const ciDeadline = Date.now() + 90 * 60_000
    while (!ciRunId && Date.now() < ciDeadline) {
      await renewLease()
      ciRunId = await successfulPushChecks(githubCredential.value, candidate.commit)
      if (!ciRunId) await new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000))
    }
    if (!ciRunId) fail('CI push pe commitul merged nu este verde')
    await stopLease.assert()
    let build = null
    const buildDeadline = Date.now() + 130 * 60_000
    while (!build && Date.now() < buildDeadline) {
      await renewLease()
      build = await successfulBuildArtifact(githubCredential.value, candidate.commit, ciRunId)
      if (!build) await new Promise((resolvePromise) => setTimeout(resolvePromise, 20_000))
    }
    if (!build) fail('Artefactul OCI semnat nu este disponibil pentru commitul merged')
    await stopLease.assert()
    const requestId = deterministicUuid(`kelion-release-v1\n${identity.jobId}\n${identity.taskId}\n${candidate.commit}`)
    let run = await existingReleaseRun(githubCredential.value, requestId, candidate.commit)
    if (!run) {
      await stopLease.assert()
      await github(githubCredential.value, `/repos/${REPOSITORY}/actions/workflows/${WORKFLOW}/dispatches`, 'POST', {
        ref: 'master',
        inputs: { commit_sha: candidate.commit, release_mode: 'release', release_request_id: requestId },
      })
      run = await waitForReleaseRun(githubCredential.value, requestId, candidate.commit, renewLease)
    }
    const workflowRunId = Number(run?.id)
    if (!Number.isSafeInteger(workflowRunId) || workflowRunId <= 0) fail('Run id release invalid')
    const dispatchReceipt = receiptHash({ schema: 1, kind: 'release-dispatch', jobId: identity.jobId, taskId: identity.taskId, commit: candidate.commit, requestId, workflowRunId, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, publisherReceiptSha256: candidate.publisherReceipt })
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'dispatched', requestId, workflowRunId, receiptSha256: dispatchReceipt } })
    await waitForCompletion(githubCredential.value, workflowRunId, candidate.commit, renewLease)
    await stopLease.assert()
    const liveVersion = await externalProof(candidate.commit)
    const releaseReceipt = receiptHash({ schema: 1, kind: 'release-deployed', jobId: identity.jobId, taskId: identity.taskId, commit: candidate.commit, requestId, workflowRunId, liveVersion })
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'deployed', requestId, workflowRunId, commit: candidate.commit, liveVersion, receiptSha256: releaseReceipt } })
    writeFileSync(join(STATE, `${identity.taskId}.json`), `${canonicalJson({ schema: 1, jobId: identity.jobId, taskId: identity.taskId, commit: candidate.commit, ciRunId, buildRunId: build.buildRunId, artifactId: build.artifactId, requestId, workflowRunId, liveVersion, releaseReceipt })}\n`, { mode: 0o600 })
  } catch (error) {
    await postInternal({ api: API, secret: hmac.value, prefix: PREFIX, path: `/api/internal/constructor-release/jobs/${identity.jobId}/event`, body: { taskId: identity.taskId, leaseId: identity.leaseId, event: 'failed', code: 'release_failed' } }).catch(() => undefined)
    throw error
  } finally {
    await stopLease().catch(() => undefined)
  }
}

function selfTest() {
  const headers = signedServiceHeaders('1'.repeat(32), PREFIX, 'POST', '/api/internal/constructor-release/jobs/claim', {}, '1787536800', '123e4567-e89b-42d3-a456-426614174000')
  if (!/^v1=[0-9a-f]{64}$/.test(headers[`${PREFIX}-signature`])) fail('HMAC release invalid')
  const requestId = deterministicUuid(`kelion-release-v1\n42\ncodex-123e4567-e89b-42d3-a456-426614174000\n${'a'.repeat(40)}`)
  if (!UUID.test(requestId)) fail('Idempotency key release invalid')
  if (WORKFLOW !== 'deploy.yml') fail('Workflow release necanonic')
  process.stdout.write('constructor-release self-test: TRECE\n')
}

const mode = process.argv[2] ?? '--once'
if (mode === '--self-test') selfTest()
else if (mode === '--once') {
  if (!ENABLED || !existsSync(ENABLE_MARKER)) process.stdout.write('constructor-release: dezactivat\n')
  else await runOnce()
} else fail(`Mod necunoscut: ${mode}`)
