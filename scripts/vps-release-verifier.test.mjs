import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canonicalCiRunIdFromBuild,
  canonicalProductionRunId,
  classifyReleaseDispatchOwner,
  exactAssociatedPullNumber,
  exactCanonicalArtifactId,
  exactCanonicalBuildRunId,
  genericReleaseRequestId,
  releasedProductionRunId,
} from './release-dispatch-owner.mjs'
import { GITHUB_ACTIONS_APP_ID, RELEASE_QA_GATES, REQUIRED_MERGE_CHECKS, evaluateBranchProtection, evaluateLiveSample, evaluateReleaseEvidence, matrixIsFailClosed, parseDeployTitle, selectDeployEvidence } from './lib/vps-release-verification.mjs'

const sha = 'a'.repeat(40)
const taskUuid = '123e4567-e89b-42d3-a456-426614174000'
const repository = 'kelion-team/kelionai'
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
  ready: { status: 200, body: { ready: true, checks: { config: true, database: true, migrations: true }, release: { candidate: false, sideEffectsActive: true } } },
  live: { status: 200, body: { status: 'alive' } },
  health: { status: 200, body: { status: 'ok' } },
  proof: { status: 200, body: { ready: true, activeCommit: sha, release: { candidate: false, sideEffectsActive: true } } },
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

test('verifierul așteaptă pending și califică fiecare workflow success prin jobul release', async () => {
  const title = `production-123e4567-e89b-42d3-a456-426614174000-${sha}-12-13`
  const failed = { id: 10, status: 'completed', conclusion: 'failure', display_title: title }
  const queued = { id: 20, status: 'queued', conclusion: null, display_title: title }
  const success = { id: 30, status: 'completed', conclusion: 'success', display_title: title }
  const calls = []
  const jobs = async (runId) => {
    calls.push(runId)
    return [{ name: 'release', conclusion: 'success' }]
  }
  assert.deepEqual(await selectDeployEvidence([failed, success], jobs), { run: success, releaseJobQualified: true })
  assert.deepEqual(await selectDeployEvidence([failed, queued, success], jobs), { run: queued, releaseJobQualified: false })
  assert.deepEqual(calls, [30, 30], 'workflow-ul success trebuie calificat chiar dacă există un run pending exact')
  assert.deepEqual(await selectDeployEvidence([success, { ...success, id: 31 }], jobs), {
    run: { ...success, id: 31 },
    releaseJobQualified: true,
  })
  await assert.rejects(selectDeployEvidence([{ id: 0, status: 'completed', conclusion: 'success' }], jobs), /invalid_deploy_run_identity/)
  await assert.rejects(selectDeployEvidence([
    success,
    { ...success, id: 31, display_title: `production-223e4567-e89b-42d3-a456-426614174000-${sha}-12-13` },
  ], jobs), /ambiguous_successful_deploy_requests/)
})

test('un job release skipped nu recuperează failure-ul vechi, dar un job success îl recuperează', async () => {
  const title = `production-123e4567-e89b-42d3-a456-426614174000-${sha}-12-13`
  const failed = { id: 10, status: 'completed', conclusion: 'failure', display_title: title }
  const workflowSuccess = { id: 20, status: 'completed', conclusion: 'success', display_title: title }
  assert.deepEqual(await selectDeployEvidence([failed, workflowSuccess], async () => [
    { name: 'release', conclusion: 'skipped' },
  ]), { run: failed, releaseJobQualified: false })
  assert.deepEqual(await selectDeployEvidence([failed, workflowSuccess], async () => [
    { name: 'release', conclusion: 'success' },
  ]), { run: workflowSuccess, releaseJobQualified: true })
})

test('dispatcherul generic cedează numai ownership-ului Constructor complet și semnat', () => {
  const commit = {
    sha,
    commit: {
      message: `Constructor codex-${taskUuid}`,
      verification: { verified: true },
    },
  }
  const pull = {
    number: 1555,
    state: 'closed',
    merged: true,
    merged_at: '2026-09-01T10:00:00.000Z',
    merge_commit_sha: sha,
    title: `Constructor codex-${taskUuid}`,
    body: 'Patch produs în sandbox, revalidat de publisherul izolat și supus tuturor controalelor obligatorii.',
    draft: false,
    base: { ref: 'master', repo: { full_name: repository } },
    head: { ref: `codex/${taskUuid}`, repo: { full_name: repository } },
  }
  const associatedPullPages = [[{ number: pull.number }]]
  assert.equal(exactAssociatedPullNumber(associatedPullPages), pull.number)
  assert.equal(classifyReleaseDispatchOwner({ associatedPullPages, pullRequest: pull, commit, repository, candidateSha: sha }), 'constructor')
  assert.equal(classifyReleaseDispatchOwner({
    associatedPullPages,
    pullRequest: { ...pull, title: 'fix: manual', body: 'manual', head: { ...pull.head, ref: 'fix/manual' } },
    commit: { ...commit, commit: { message: 'fix: manual', verification: { verified: true } } },
    repository,
    candidateSha: sha,
  }), 'generic')
  for (const changed of [
    { commit: { ...commit, commit: { ...commit.commit, verification: { verified: false } } } },
    { pullRequest: { ...pull, merged: false } },
    { associatedPullPages: [[{ number: pull.number }, { number: 1556 }]] },
    { pullRequest: { ...pull, head: { ...pull.head, ref: 'codex/223e4567-e89b-42d3-a456-426614174000' } } },
    { pullRequest: { ...pull, body: 'body editat' } },
  ]) {
    assert.throws(() => classifyReleaseDispatchOwner({
      associatedPullPages,
      pullRequest: pull,
      commit,
      repository,
      candidateSha: sha,
      ...changed,
    }), /(?:Ownership-ul release-ului Constructor|PR-ul asociat|exact un PR asociat)/)
  }
})

test('guardul deploy ignoră runul off-master și execută numai primul run master pe același head SHA', () => {
  const title = `production-123e4567-e89b-42d3-a456-426614174000-${sha}-123-456`
  const offMasterA = {
    id: 10,
    event: 'workflow_dispatch',
    display_title: title,
    head_branch: 'codex/vechi',
    head_sha: sha,
  }
  const wrongMasterHead = {
    id: 11,
    event: 'workflow_dispatch',
    display_title: title,
    head_branch: 'master',
    head_sha: 'b'.repeat(40),
  }
  const masterB = {
    id: 20,
    event: 'workflow_dispatch',
    display_title: title,
    head_branch: 'master',
    head_sha: sha,
  }
  assert.equal(canonicalProductionRunId([
    { workflow_runs: [offMasterA, wrongMasterHead, masterB] },
  ], title, sha, masterB.id), masterB.id, 'B trebuie să execute chiar dacă A off-master este mai vechi')

  const secondMasterB = { ...masterB, id: 30 }
  assert.equal(canonicalProductionRunId([
    { workflow_runs: [offMasterA, wrongMasterHead, masterB, secondMasterB] },
  ], title, sha, secondMasterB.id), masterB.id, 'al doilea B trebuie să fie no-op')

  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  assert.match(workflow, /CANONICAL_WORKFLOW_SHA: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /canonical-production-run[\s\S]*"\$CANONICAL_WORKFLOW_SHA" "\$GITHUB_RUN_ID"/)
})

test('guardul deploy refuză un request nou pentru o tuplă commit+CI+build deja publicată cu succes', () => {
  const uuid = '123e4567-e89b-42d3-a456-426614174000'
  const other = '7575dffc-068f-4628-973f-1f0813f9de5e'
  const released = {
    id: 20,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    display_title: `production-${uuid}-${sha}-123-456`,
    head_branch: 'master',
    head_sha: sha,
  }
  const duplicate = { ...released, id: 30, conclusion: 'failure', display_title: `production-${other}-${sha}-123-456` }
  assert.equal(releasedProductionRunId([{ workflow_runs: [released, duplicate] }], sha, 123, 456, duplicate.id), released.id,
    'un alt UUID pentru aceeași tuplă publicată este un duplicat')
  assert.equal(releasedProductionRunId([{ workflow_runs: [released] }], sha, 123, 456, released.id), 0,
    'runul care a publicat tupla nu se vede pe sine ca duplicat')
  assert.equal(releasedProductionRunId([{ workflow_runs: [{ ...released, conclusion: 'failure' }] }], sha, 123, 456, 30), 0,
    'un run picat nu dovedește publicarea')
  assert.equal(releasedProductionRunId([{ workflow_runs: [{ ...released, status: 'in_progress', conclusion: null }] }], sha, 123, 456, 30), 0,
    'un run încă în curs nu dovedește publicarea')
  assert.equal(releasedProductionRunId([{ workflow_runs: [{ ...released, head_branch: 'codex/vechi' }] }], sha, 123, 456, 30), 0)
  assert.equal(releasedProductionRunId([{ workflow_runs: [{ ...released, display_title: `production-${uuid}-${sha}-124-456` }] }], sha, 123, 456, 30), 0,
    'alt CI canonic este altă tuplă')
  assert.equal(releasedProductionRunId([{ workflow_runs: [{ ...released, head_sha: 'b'.repeat(40) }] }], sha, 123, 456, 30), 0)

  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8')
  assert.match(workflow, /RELEASE_MODE: \$\{\{ inputs\.release_mode \}\}[\s\S]*canonical-production-run/)
  const canonical = workflow.indexOf('canonical-production-run')
  const releasedGuard = workflow.indexOf('released-production-run', canonical)
  const execute = workflow.indexOf("echo 'execute=true'", releasedGuard)
  assert.ok(canonical >= 0 && releasedGuard > canonical && execute > releasedGuard,
    'guardul tuplei publicate precede execute=true')
  assert.match(workflow, /"\$RELEASE_MODE" = release \] && \[ -n "\$CI_RUN_ID" \] && \[ -n "\$BUILD_RUN_ID" \]/)
  assert.match(workflow, /"\$work\/deploy-runs-pages\.json" "\$CANDIDATE_SHA" "\$CI_RUN_ID" "\$BUILD_RUN_ID" "\$GITHUB_RUN_ID"/)
  assert.match(workflow, /if \[ "\$released" != 0 \]; then\n\s*echo 'execute=false'/)
})

test('dispatcherul generic cere exact un build și un artefact canonic pentru același SHA și CI', () => {
  const build = {
    id: 456,
    head_sha: sha,
    head_branch: 'master',
    event: 'workflow_run',
    conclusion: 'success',
    path: '.github/workflows/build-images.yml@refs/heads/master',
    display_title: `build-release-123-${sha}`,
  }
  assert.equal(canonicalCiRunIdFromBuild(build, sha, build.id), 123)
  const offMaster = { ...build, id: 455, head_branch: 'codex/vechi' }
  assert.equal(exactCanonicalBuildRunId([
    { workflow_runs: [offMaster, build] },
  ], sha, 123, build.id), build.id)
  assert.throws(() => exactCanonicalBuildRunId([
    { workflow_runs: [build, { ...build, id: 457 }] },
  ], sha, 123, build.id), /exact un build release canonic/,
  'două workflow_run success pentru același SHA/CI trebuie să oprească al doilea dispatch')

  const artifact = {
    id: 900,
    name: `release-images-${sha}`,
    expired: false,
    workflow_run: { id: build.id, head_branch: 'master', head_sha: sha },
  }
  assert.equal(exactCanonicalArtifactId([
    { artifacts: [artifact] },
  ], artifact.name, build.id, sha), artifact.id)
  assert.throws(() => exactCanonicalArtifactId([
    { artifacts: [artifact, { ...artifact, id: 901 }] },
  ], artifact.name, build.id, sha), /exact un artefact release/)
  assert.throws(() => exactCanonicalArtifactId([
    { artifacts: [{ ...artifact, expired: true }] },
  ], artifact.name, build.id, sha), /nu aparține buildului canonic/)
})

test('dispatcherul generic folosește un request id stabil pe repository, SHA și CI canonic', () => {
  const first = genericReleaseRequestId(repository, sha, 123)
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(genericReleaseRequestId(repository, sha, 123), first)
  assert.equal(genericReleaseRequestId(repository.toUpperCase(), sha, 123), first)
  assert.notEqual(genericReleaseRequestId(repository, sha, 124), first)
})

test('workflow-ul dovedește ownerul Constructor înainte să genereze UUID-ul generic', () => {
  const workflow = readFileSync(new URL('../.github/workflows/release-dispatch.yml', import.meta.url), 'utf8')
  assert.match(workflow, /ref: refs\/heads\/master[\s\S]*persist-credentials: false/)
  assert.match(workflow, /\[ "\$\(git rev-parse HEAD\)" = "\$CANDIDATE_SHA" \][\s\S]*\[ "\$\(git rev-parse HEAD\)" = "\$current_master" \]/)
  assert.match(workflow, /permissions:[\s\S]*contents: read[\s\S]*actions: write[\s\S]*pull-requests: read/)
  const buildIdentity = workflow.indexOf('release-dispatch-owner.mjs build-ci')
  const uniqueBuild = workflow.indexOf('release-dispatch-owner.mjs canonical-build', buildIdentity)
  const uniqueArtifact = workflow.indexOf('release-dispatch-owner.mjs canonical-artifact', uniqueBuild)
  const associated = workflow.indexOf('associated_pr_number=$(node scripts/release-dispatch-owner.mjs')
  const fullPull = workflow.indexOf('pulls/${associated_pr_number}', associated)
  const ownership = workflow.indexOf('release_owner=$(node scripts/release-dispatch-owner.mjs owner', fullPull)
  const constructorExit = workflow.indexOf('dispatcherul generic nu emite un UUID străin', ownership)
  const deterministicUuid = workflow.indexOf('release_request_id=$(node scripts/release-dispatch-owner.mjs request-id', constructorExit)
  const dispatch = workflow.indexOf('gh workflow run deploy.yml', deterministicUuid)
  assert.ok(buildIdentity >= 0 && uniqueBuild > buildIdentity && uniqueArtifact > uniqueBuild
    && associated > uniqueArtifact && fullPull > associated && ownership > fullPull
    && constructorExit > ownership && deterministicUuid > constructorExit && dispatch > deterministicUuid)
  const requestIdCall = workflow.slice(deterministicUuid, workflow.indexOf(')', deterministicUuid) + 1)
  assert.match(requestIdCall, /"\$GITHUB_REPOSITORY" "\$CANDIDATE_SHA" "\$ci_run_id"/)
  assert.doesNotMatch(requestIdCall, /BUILD_RUN_ID/)
  assert.doesNotMatch(workflow, /\/proc\/sys\/kernel\/random\/uuid/)
  assert.doesNotMatch(workflow, /\.id == env\.BUILD_RUN_ID[\s\S]*or true/)
})

test('live-ul cere commit exact, toate health checks și release-proof independent', () => {
  assert.equal(evaluateLiveSample(healthy, sha).ok, true)
  for (const key of ['version', 'ready', 'live', 'health', 'proof']) {
    const broken = structuredClone(healthy)
    broken[key].status = 503
    assert.equal(evaluateLiveSample(broken, sha).ok, false)
  }
})

test('live-ul cere starea activă și respinge starea legitimă doar pre-PONR', () => {
  for (const key of ['ready', 'proof']) {
    const expectedMissing = key === 'ready' ? 'readiness' : 'release-proof'
    const candidate = structuredClone(healthy)
    candidate[key].body.release.candidate = true
    assert.deepEqual(evaluateLiveSample(candidate, sha), { ok: false, missing: [expectedMissing] })

    const inactive = structuredClone(healthy)
    inactive[key].body.release.sideEffectsActive = false
    assert.deepEqual(evaluateLiveSample(inactive, sha), { ok: false, missing: [expectedMissing] })
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
