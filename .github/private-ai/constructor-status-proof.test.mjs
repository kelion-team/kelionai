import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
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

// Exercise the production entry point; only its I/O boundaries are substituted.
// No installed files, credentials, sockets, processes or provider are accessed.
async function installedStatus(scenario, jobId = 'status', observed = {}) {
  const calls = observed.calls ?? []
  const requests = observed.requests ?? []
  const signatures = observed.signatures ?? []
  const layout = runInNewContext(source.match(/const LAYOUT = Object.freeze\(([\s\S]*?)\n\]\)/)[0] + '; LAYOUT')
  const start = source.indexOf('export async function installedProof(args) {')
  const end = source.indexOf("\nif (process.argv[2] === '--installed')", start)
  assert.ok(start >= 0 && end > start)
  const body = source.slice(start, end).replace('export async function', 'async function').replaceAll('await import(', 'await load(')
  const paused = !scenario.startsWith('unpaused')
  const host = { schema: 1, measuredAt: new Date().toISOString(),
    worker: { timer: paused ? 'inactive' : 'active', service: 'inactive', mainPid: 0 },
    intentionalPause: paused, deployGate: false }
  const command = (file, args) => {
    calls.push([file, ...args])
    if (file === '/usr/bin/node') return 'OPENCODE_BINARY_VERIFIED=yes'
    assert.equal(file, '/usr/bin/systemctl', 'no unverified installed helper may execute')
    assert.equal(args[0], 'show')
    if (args.includes('--property=UnitFileState')) return scenario === 'worker-disabled' ? 'disabled' : 'enabled'
    if (args.includes('--property=MainPID')) return scenario === 'worker-pid-changed' ? '7' : '0'
    assert.ok(args.includes('--property=ActiveState'))
    if (args[1] === 'kelion-codex-worker.service') return scenario === 'worker-service-changed' ? 'active' : 'inactive'
    if (args[1] === 'kelion-codex-worker.timer') return scenario === 'paused-active' || scenario === 'unpaused-active' ? 'active' : 'inactive'
    if (args[1] === 'kelion-constructor-publisher.timer' && scenario === 'publisher-stopped') return 'inactive'
    if (args[1] === 'kelion-constructor-release.timer' && scenario === 'release-stopped') return 'inactive'
    return 'active'
  }
  const controller = { validateProviderConfig: () => model, CONTROL_SOCKET: '/synthetic/socket', CONTROL_SECRET: '/synthetic/secret' }
  const auth = { signServiceRequest: (...args) => {
    signatures.push(args)
    return 'signed:' + args[2] + ':' + args[4]
  }, readServiceSecret: () => Buffer.from('synthetic') }
  let nonce = 0
  const entryPoint = runInNewContext('(' + body.trim() + ')', {
    LAYOUT: layout, ID: /^[1-9][0-9]{0,18}$/, MAX_BYTES: 512 * 1024, Buffer, Date, process: { getuid: () => 0 },
    readVerifiedFile: () => { if (scenario === 'unverified-controller') throw new Error('installed_source_mismatch') },
    readFileSync: () => '{}',
    lstatSync: () => { throw Object.assign(new Error('absent'), { code: 'ENOENT' }) },
    pathToFileURL: (path) => ({ href: path }),
    load: async (path) => path === layout[0][1] ? controller : auth,
    randomUUID: () => 'synthetic-nonce-' + (++nonce), command,
    boundedJSON: async (_request, options, body, limits) => {
      requests.push({ options, body, limits })
      if (options.path === '/v1/model/state') return state
      assert.equal(options.path, '/v1/worker/state')
      if (scenario === 'host-failed') throw new Error('proof_request_status')
      return Object.hasOwn(observed, 'host') ? observed.host : host
    }, httpRequest: {}, validateControllerState,
    activeContainer: () => { throw new Error('paused_proof_must_not_enter_completion_path') },
  })
  const result = await entryPoint([...layout.map(() => 'a'.repeat(64)), jobId])
  return { result, calls, requests, signatures }
}

for (const jobId of ['status', '17']) {
  test('installed production proof reports paused without readiness or completion: ' + jobId, async () => {
    const { result, calls } = await installedStatus('paused', jobId)
    assert.equal(result.kind, 'constructor-paused-status')
    assert.equal(result.readiness.status, 'paused')
    assert.equal(result.workerPause, 'paused')
    assert.equal(result.endToEnd, false)
    assert.equal(result.job, undefined)
    assert.equal(result.inferenceRequests, 0)
    assert.ok(!calls.some(([file]) => file === '/root/kelion/bin/runtime-config-cutover.sh'))
    assert.ok(!calls.some(([file]) => file === '/usr/bin/docker'))
  })
}

test('installed production proof accepts unpaused active vector only as readiness, not E2E', async () => {
  const { result } = await installedStatus('unpaused-active')
  assert.equal(result.kind, 'constructor-readiness-proof')
  assert.equal(result.readiness.status, 'ready')
  assert.equal(result.workerPause, 'unpaused')
  assert.equal(result.endToEnd, false)
})

for (const scenario of ['host-failed', 'worker-disabled', 'publisher-stopped', 'release-stopped', 'unpaused-stopped', 'paused-active', 'worker-service-changed', 'worker-pid-changed']) {
  test('installed production proof rejects ' + scenario + ', never inventing a pause', async () => {
    await assert.rejects(installedStatus(scenario))
  })
}

test('installed proof independently signs bounded model and worker requests after source verification', async () => {
  const { requests, signatures } = await installedStatus('paused')
  assert.equal(requests.length, 2)
  assert.equal(signatures.length, 2)
  assert.deepEqual(requests.map(({ options }) => options.path), ['/v1/model/state', '/v1/worker/state'])
  assert.notEqual(requests[0].options.headers['x-kelion-nonce'], requests[1].options.headers['x-kelion-nonce'])
  requests.forEach(({ options, body }, index) => {
    assert.equal(options.method, 'POST')
    assert.equal(options.socketPath, '/synthetic/socket')
    assert.equal(body.toString(), '{}')
    const signed = signatures[index]
    assert.equal(signed[1], options.headers['x-kelion-timestamp'])
    assert.equal(signed[2], options.headers['x-kelion-nonce'])
    assert.equal(signed[3], 'POST')
    assert.equal(signed[4], options.path)
    assert.equal(signed[5], body)
    assert.equal(options.headers['x-kelion-signature'], 'signed:' + signed[2] + ':' + signed[4])
    assert.ok(Math.abs(Date.now() / 1000 - Number(signed[1])) < 2)
  })
  assert.equal(requests[1].limits.maxBytes, 2048)
  const observed = { calls: [], requests: [], signatures: [] }
  await assert.rejects(installedStatus('unverified-controller', 'status', observed), /installed_source_mismatch/)
  assert.equal(observed.calls.length + observed.requests.length + observed.signatures.length, 0)
})

test('real installed proof rejects invalid, stale, future or contradictory worker evidence', async () => {
  const valid = { schema: 1, measuredAt: new Date().toISOString(),
    worker: { timer: 'inactive', service: 'inactive', mainPid: 0 },
    intentionalPause: true, deployGate: false }
  const invalid = [
    null, [], {}, { ...valid, schema: 2 }, { ...valid, extra: true },
    { ...valid, measuredAt: null }, { ...valid, measuredAt: 'invalid' },
    { ...valid, measuredAt: new Date(Date.now() - 15_001).toISOString() },
    { ...valid, measuredAt: new Date(Date.now() + 60_000).toISOString() },
    { ...valid, measuredAt: valid.measuredAt.replace('Z', '+00:00') },
    { ...valid, intentionalPause: 'true' }, { ...valid, deployGate: true },
    { ...valid, deployGate: null }, { ...valid, worker: null },
    { ...valid, worker: { ...valid.worker, extra: true } },
    { ...valid, worker: { ...valid.worker, timer: 'unknown' } },
    { ...valid, worker: { ...valid.worker, service: 'unknown' } },
    { ...valid, worker: { ...valid.worker, mainPid: -1 } },
    { ...valid, worker: { ...valid.worker, mainPid: '0' } },
    { ...valid, worker: { ...valid.worker, mainPid: 1 } },
    { ...valid, worker: { ...valid.worker, timer: 'active' } },
    { ...valid, worker: { ...valid.worker, service: 'active', mainPid: 1 } },
  ]
  for (const host of invalid) {
    const observed = { host, calls: [] }
    await assert.rejects(installedStatus('paused', '17', observed), /worker_state_unverified/)
    assert.ok(!observed.calls.some(([file]) => file === '/usr/bin/systemctl' || file === '/usr/bin/docker'))
  }
})

test('actual bounded JSON transport rejects timeout, HTTP failure, oversized and invalid worker responses', async () => {
  const { EventEmitter } = await import('node:events')
  const start = source.indexOf('function boundedJSON(')
  const end = source.indexOf('\nconst QUEUE_READ_ONLY', start)
  assert.ok(start >= 0 && end > start)
  for (const scenario of ['valid', 'timeout', 'http', 'oversized', 'json', 'request-error', 'response-error']) {
    let deadline, destroyed = false, resumed = false
    const bounded = runInNewContext('(' + source.slice(start, end).trim() + ')', {
      Buffer, MAX_BYTES: 512 * 1024,
      setTimeout: (callback, milliseconds) => { assert.equal(milliseconds, 10_000); deadline = callback; return 1 },
      clearTimeout: () => {},
    })
    const request = new EventEmitter()
    request.destroy = () => { destroyed = true }
    const response = new EventEmitter()
    response.statusCode = scenario === 'http' ? 503 : 200
    response.resume = () => { resumed = true }
    const pending = bounded((_options, callback) => {
      request.end = () => queueMicrotask(() => {
        if (scenario === 'timeout') return deadline()
        if (scenario === 'request-error') return request.emit('error', new Error('private error'))
        callback(response)
        if (scenario === 'http') return
        if (scenario === 'response-error') return response.emit('error', new Error('private error'))
        response.emit('data', Buffer.from(scenario === 'oversized' ? JSON.stringify({ padding: 'x'.repeat(2049) }) : scenario === 'json' ? '{' : '{"ok":true}'))
        response.emit('end')
      })
      return request
    }, {}, Buffer.from('{}'), { maxBytes: 2048 })
    if (scenario === 'valid') assert.equal((await pending).ok, true)
    else {
      await assert.rejects(pending, /proof_(?:request_timeout|request_status|response_limit|response_invalid|request_failed|response_failed)/)
      assert.equal(destroyed, true)
      if (scenario === 'http') assert.equal(resumed, true)
    }
  }
})

test('actual installed CLI prints paused status but never exits successfully for readiness', async () => {
  const cli = source.slice(source.indexOf("\nif (process.argv[2] === '--installed')"))
  for (const status of ['paused', 'ready']) {
    const output = []
    const proof = { readiness: { status }, endToEnd: false }
    const processDouble = {
      argv: ['node', 'proof', '--installed', 'status'], exitCode: 0,
      stdout: { write: (value) => output.push(value) },
    }
    await runInNewContext(cli, { process: processDouble, installedProof: async () => proof, Date })
    assert.equal(processDouble.exitCode, status === 'paused' ? 1 : 0)
    assert.deepEqual(output.map((line) => JSON.parse(line)), [proof])
  }
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
