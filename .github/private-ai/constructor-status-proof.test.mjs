import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { readVerifiedFile, validateControllerState, validateCompletedJob } from './constructor-status-proof.mjs'

const source = readFileSync(new URL('./constructor-status-proof.mjs', import.meta.url), 'utf8')
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
const model = { id: 'opencode-free/big-pickle', label: 'Big Pickle', provider: 'opencode-free' }
const state = { mode: 'manual', defaultProfile: 'fast', status: 'ready', activeProfile: 'fast',
  requestedProfile: null, requestId: null, installedProfiles: ['fast'], model }
const sha = 'a'.repeat(40)
const receiptHash = 'b'.repeat(64)
const row = { jobId: '17', taskId: 'codex-12345678-1234-4234-8234-123456789abc',
  status: 'done', stage: 'deployed', ci: 'green', profile: 'fast', commit: sha,
  liveVersion: sha, targetCommit: sha, mergedCommit: 'c'.repeat(40),
  gateReceipt: receiptHash, patchReceipt: receiptHash, publisherReceipt: receiptHash,
  releaseReceipt: receiptHash, workflowRunId: '25', prUrl: 'https://github.com/kelion-team/kelionai/pull/12' }
const receipt = { jobId: row.jobId, taskId: row.taskId, profile: 'fast',
  executor: 'opencode-anonymous-isolated', baseCommit: 'd'.repeat(40),
  createdAt: '2026-09-05T00:00:00.000Z' }
const live = { ready: true, candidate: false, sideEffectsActive: true,
  release: { candidate: false, sideEffectsActive: true }, activeCommit: sha }

test('installed proof checks exact bytes and root metadata before importing installed code', () => {
  const installer = read('deploy/instaleaza-constructor.sh')
  for (const [path, mode] of [
    ['/opt/kelion-constructor/constructor-model-control.mjs', '555'],
    ['/opt/kelion-constructor/lib/service-auth.mjs', '444'],
    ['/opt/kelion-codex/codex-worker.mjs', '555'],
    ['/etc/systemd/system/kelion-codex-worker.service', '444'],
  ]) {
    assert.ok(source.includes("'" + path + "', '" + mode + "'"))
    if (path.endsWith('.service')) assert.match(installer, /systemd-service\.\*\).*install_mode=444/)
    else assert.ok(installer.includes('install_target=' + path + '; install_mode=' + mode))
  }
  const content = Buffer.from('approved source')
  const hash = createHash('sha256').update(content).digest('hex')
  const metadata = { isFile: () => true, isSymbolicLink: () => false, nlink: 1, uid: 0, mode: 0o644, size: content.length }
  const check = (overrides = {}, bytes = content, canonical = '/fixed/file') => readVerifiedFile(
    '/fixed/file', hash, '644', () => bytes, () => ({ ...metadata, ...overrides }), () => canonical)
  assert.equal(check().toString(), 'approved source')
  for (const bad of [{ uid: 1000 }, { nlink: 2 }, { mode: 0o664 }, { isSymbolicLink: () => true }, { size: 2 * 1024 * 1024 + 1 }]) {
    assert.throws(() => check(bad), /source_metadata_invalid/)
  }
  assert.throws(() => check({}, Buffer.from('unapproved')), /installed_source_mismatch/)
  assert.throws(() => check({}, content, '/elsewhere'), /source_metadata_invalid/)
  assert.ok(source.indexOf('readVerifiedFile(path, args[index], mode)') < source.indexOf('await import(pathToFileURL'))
})

test('readiness is distinct from completed work and derives model from checked controller', () => {
  assert.deepEqual(validateControllerState(state, model), { status: 'ready', model })
  for (const change of [
    { status: 'unavailable' }, { activeProfile: null }, { installedProfiles: [] },
    { installedProfiles: ['fast', 'powerful'] }, { requestedProfile: 'fast' },
    { requestId: 'pending' }, { model: { ...model, id: 'historical/local' } },
  ]) assert.throws(() => validateControllerState({ ...state, ...change }, model), /constructor_not_ready/)
  assert.match(source, /kind: 'constructor-readiness-proof'[\s\S]*endToEnd: false/)
})

test('completed proof requires real queue, gates, publisher, release and current live SHA', () => {
  const proof = validateCompletedJob(row, receipt, live)
  assert.equal(proof.stage, 'deployed')
  assert.equal(proof.liveVersion, sha)
  assert.equal(proof.executor, 'opencode-anonymous-isolated')
  assert.equal(proof.workflowUrl, 'https://github.com/kelion-team/kelionai/actions/runs/25')
  for (const change of [
    { status: 'running' }, { stage: 'working' }, { ci: 'pr_checks_green' },
    { gateReceipt: null }, { patchReceipt: null }, { publisherReceipt: null }, { releaseReceipt: null },
    { targetCommit: 'f'.repeat(40) }, { liveVersion: 'f'.repeat(40) },
    { workflowRunId: null }, { prUrl: 'https://example.com/pull/12' }, { taskId: '../../secret' },
  ]) assert.throws(() => validateCompletedJob({ ...row, ...change }, receipt, live), /completed_pipeline_proof_missing/)
})

test('old executor receipts and another live release never prove this completed Constructor', () => {
  for (const change of [
    { executor: 'opencode-local-qwen' }, { profile: 'powerful' }, { jobId: '18' },
    { taskId: 'different-task' }, { baseCommit: null }, { createdAt: 'invalid' },
  ]) assert.throws(() => validateCompletedJob(row, { ...receipt, ...change }, live), /approved_executor_receipt_missing/)
  for (const change of [
    { ready: false }, { candidate: true }, { sideEffectsActive: false },
    { activeCommit: 'e'.repeat(40) }, { release: { candidate: true, sideEffectsActive: false } },
  ]) assert.throws(() => validateCompletedJob(row, receipt, { ...live, ...change }), /current_live_commit_not_job_commit/)
})

test('proof query is parameterized READ ONLY, bounded and has no inference or mutations', () => {
  assert.match(source, /BEGIN TRANSACTION READ ONLY/)
  assert.match(source, /WHERE b\.id=\$1::bigint AND b\.arhivat=false', \[id\]/)
  assert.match(source, /statement_timeout: 10_000/)
  assert.doesNotMatch(source, /\b(?:INSERT INTO|UPDATE build_jobs|DELETE FROM)\b|jobs\/claim|\/v1\/model\/switch|chat\/completions/)
  assert.doesNotMatch(source, /execFileSync\([^,]*bash|systemctl', \['(?:start|restart|enable|disable)'/)
  assert.match(source, /inferenceRequests: 0/)
  assert.match(source, /constructor_proof_failed/)
  assert.doesNotMatch(source, /process\.stdout\.write\((?:error|secret)|console\.(?:log|error)\(error/)
})

test('shared status and live proof use canonical source, pinned SSH and checked hashes', () => {
  for (const name of ['private-ai-status-proof.yml', 'private-ai-constructor-proof.yml']) {
    const workflow = read('.github/workflows/' + name)
    assert.match(workflow, /\[ "\$GITHUB_REF" = refs\/heads\/master \]/)
    assert.match(workflow, /\[ "\$\(git rev-parse HEAD\)" = "\$GITHUB_SHA" \]/)
    assert.match(workflow, /needs: guard-source/)
    assert.match(workflow, /environment: production/)
    assert.match(workflow, /contents: read/)
    assert.match(workflow, /StrictHostKeyChecking=yes/)
    assert.match(workflow, /\[ "\$current_host_key" = "\$VPS_HOST_KEY" \]/)
    assert.match(workflow, /source_hash=\$\(sha256sum "\$source"/)
    assert.match(workflow, /node --input-type=module - --installed/)
    assert.match(workflow, /< \.github\/private-ai\/constructor-status-proof\.mjs/)
    assert.doesNotMatch(workflow, /systemctl (?:start|restart|enable)|workflow run|\/root\/private-ai-installer/)
  }
  assert.match(read('.github/workflows/vps-codex-login.yml'),
    /uses: \.\/\.github\/workflows\/private-ai-status-proof\.yml/)
})

test('retired download, root-executor and max-model workflows are not executable paths', () => {
  for (const name of ['private-ai-finalize', 'private-ai-max-model-unblock', 'private-ai-repair',
    'private-ai-active-model-benchmark', 'one-shot-bootstrap-private-ai', 'one-shot-diagnose-opencode-e2e']) {
    assert.equal(existsSync(new URL('../../.github/workflows/' + name + '.yml', import.meta.url)), false)
  }
  assert.match(read('.github/workflows/vps-run.yml'), /upgrade-constructor/)
  assert.match(read('deploy/upgrade-constructor.sh'), /instaleaza-constructor\.sh/)
  const recovery = read('.github/workflows/vps-recovery.yml')
  assert.match(recovery, /--validate-runtime-config "\$opencode_config"/)
  assert.match(recovery, /--verify-runtime-binary/)
  assert.doesNotMatch(recovery, /http:\/\/127\.0\.0\.1:24080\/|qwen3\.6|qwen3\.5/)
})
