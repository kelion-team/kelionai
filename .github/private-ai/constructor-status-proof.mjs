import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync, realpathSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { pathToFileURL } from 'node:url'

// Canonical installed paths; this proof never installs, starts, claims or repairs.
const LAYOUT = Object.freeze([
  ['controller', '/opt/kelion-constructor/constructor-model-control.mjs', '555'],
  ['serviceAuth', '/opt/kelion-constructor/lib/service-auth.mjs', '444'],
  ['worker', '/opt/kelion-codex/codex-worker.mjs', '555'],
  ['workerUnit', '/etc/systemd/system/kelion-codex-worker.service', '444'],
  ['config', '/srv/private-ai/home/.config/opencode/opencode.json', '640'],
  ['instructions', '/srv/private-ai/home/.config/opencode/instructions.md', '640'],
])
const HEX40 = /^[0-9a-f]{40}$/
const HEX64 = /^[0-9a-f]{64}$/
const ID = /^[1-9][0-9]{0,18}$/
const TASK = /^codex-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_BYTES = 512 * 1024

export function readVerifiedFile(path, hash, mode, read = readFileSync, stat = lstatSync, canonical = realpathSync) {
  if (!HEX64.test(hash)) throw new Error('source_hash_invalid')
  const entry = stat(path)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.uid !== 0
    || (entry.mode & 0o777).toString(8) !== mode || canonical(path) !== path
    || entry.size < 1 || entry.size > 2 * 1024 * 1024) throw new Error('source_metadata_invalid')
  const bytes = read(path)
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('installed_source_mismatch')
  return bytes
}

export function validateControllerState(state, model) {
  if (state?.status !== 'ready' || state.mode !== 'manual' || state.defaultProfile !== 'fast'
    || state.activeProfile !== 'fast' || state.requestedProfile !== null || state.requestId !== null
    || JSON.stringify(state.installedProfiles) !== '["fast"]'
    || state.model?.id !== model.id || state.model?.label !== model.label
    || state.model?.provider !== model.provider) throw new Error('constructor_not_ready')
  return { status: 'ready', model: { ...model } }
}

export function validateCompletedJob(row, receipt, live) {
  if (!row || !ID.test(row.jobId) || !TASK.test(row.taskId)
    || row.status !== 'done' || row.stage !== 'deployed' || row.ci !== 'green'
    || row.profile !== 'fast' || !HEX40.test(row.commit) || row.liveVersion !== row.commit
    || row.targetCommit !== row.commit || !HEX40.test(row.mergedCommit)
    || !HEX64.test(row.gateReceipt) || !HEX64.test(row.patchReceipt)
    || !HEX64.test(row.publisherReceipt) || !HEX64.test(row.releaseReceipt)
    || !ID.test(row.workflowRunId)
    || !/^https:\/\/github\.com\/kelion-team\/kelionai\/pull\/[1-9][0-9]*$/.test(row.prUrl ?? '')
  ) throw new Error('completed_pipeline_proof_missing')
  if (!receipt || receipt.jobId !== row.jobId || receipt.taskId !== row.taskId
    || receipt.executor !== 'opencode-anonymous-isolated' || receipt.profile !== 'fast'
    || !HEX40.test(receipt.baseCommit)
    || !Number.isFinite(Date.parse(receipt.createdAt))
  ) throw new Error('approved_executor_receipt_missing')
  if (!live || live.ready !== true || live.candidate !== false || live.sideEffectsActive !== true
    || live.release?.candidate !== false || live.release?.sideEffectsActive !== true
    || live.activeCommit !== row.commit) throw new Error('current_live_commit_not_job_commit')
  return {
    jobId: row.jobId, taskId: row.taskId, stage: row.stage,
    commit: row.commit, mergedCommit: row.mergedCommit,
    prUrl: row.prUrl,
    workflowUrl: 'https://github.com/kelion-team/kelionai/actions/runs/' + row.workflowRunId,
    executor: receipt.executor, gateReceipt: row.gateReceipt, patchReceipt: row.patchReceipt,
    publisherReceipt: row.publisherReceipt, releaseReceipt: row.releaseReceipt,
    liveVersion: live.activeCommit,
  }
}

function command(file, args, input) {
  return execFileSync(file, args, {
    encoding: 'utf8', timeout: 30_000, maxBuffer: MAX_BYTES,
    env: { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root' },
    stdio: ['pipe', 'pipe', 'pipe'], ...(input === undefined ? {} : { input }),
  }).trim()
}

function boundedJSON(requestFn, options, body, { maxBytes = MAX_BYTES } = {}) {
  return new Promise((resolve, reject) => {
    let complete = false
    let request
    const finish = (error, value) => {
      if (complete) return
      complete = true
      clearTimeout(deadline)
      if (error) { request?.destroy(); reject(error) } else resolve(value)
    }
    const deadline = setTimeout(() => finish(new Error('proof_request_timeout')), 10_000)
    request = requestFn(options, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        return finish(new Error('proof_request_status'))
      }
      let length = 0
      const chunks = []
      response.on('data', (chunk) => {
        length += chunk.length
        if (length > maxBytes) return finish(new Error('proof_response_limit'))
        chunks.push(chunk)
      })
      response.on('error', () => finish(new Error('proof_response_failed')))
      response.on('end', () => {
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))) }
        catch { finish(new Error('proof_response_invalid')) }
      })
    })
    request.on('error', () => finish(new Error('proof_request_failed')))
    request.end(body)
  })
}

const QUEUE_READ_ONLY = String.raw`
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
const id = process.argv[2]
if (!/^[1-9][0-9]{0,18}$/.test(id)) process.exit(2)
let client
try {
  const secret = readFileSync('/run/secrets/database-url', 'utf8')
  if (!secret.endsWith('\n') || secret.slice(0, -1).includes('\n') || secret.includes('\r')) process.exit(3)
  const { Client } = createRequire('/app/backend/package.json')('pg')
  client = new Client({ connectionString: secret.slice(0, -1), connectionTimeoutMillis: 10_000,
    statement_timeout: 10_000, application_name: 'constructor-read-only-completion-proof' })
  await client.connect()
  await client.query('BEGIN TRANSACTION READ ONLY')
  await client.query("SET LOCAL statement_timeout = '10s'")
  const result = await client.query(
    'SELECT b.id::text AS "jobId", b.codex_task_id AS "taskId", b.status, ' +
    'b.constructor_stage AS stage, b.ci, b.execution_profile AS profile, ' +
    'b.commit_sha AS commit, b.live_version AS "liveVersion", ' +
    'p.release_target_sha AS "targetCommit", p.merged_commit_sha AS "mergedCommit", ' +
    'p.gate_receipt_sha256 AS "gateReceipt", p.patch_sha256 AS "patchReceipt", ' +
    'p.publisher_receipt_sha256 AS "publisherReceipt", p.release_receipt_sha256 AS "releaseReceipt", ' +
    'p.release_workflow_run_id::text AS "workflowRunId", p.publisher_pr_url AS "prUrl" ' +
    'FROM build_jobs b JOIN constructor_pipeline p ON p.job_id=b.id ' +
    'WHERE b.id=$1::bigint AND b.arhivat=false', [id])
  await client.query('COMMIT')
  if (result.rows.length !== 1) process.exitCode = 4
  else process.stdout.write(JSON.stringify(result.rows[0]))
} catch {
  await client?.query('ROLLBACK').catch(() => undefined)
  process.stderr.write('constructor_queue_proof_failed\n')
  process.exitCode = 5
} finally { await client?.end().catch(() => undefined) }
`

function activeContainer() {
  const path = '/root/kelion/proxy/upstream/kelion-upstream.caddy'
  const entry = lstatSync(path)
  if (!entry.isFile() || entry.isSymbolicLink() || entry.uid !== 0 || entry.nlink !== 1) throw new Error('active_slot_invalid')
  const content = readFileSync(path, 'utf8').trim()
  const match = /^reverse_proxy app-(blue|green):8080 \{\n\theader_up X-Kelion-Client-IP \{client_ip\}\n\}$/.exec(content)
  if (!match) throw new Error('active_slot_invalid')
  const ids = command('/usr/bin/docker', ['ps', '--filter', 'label=com.kelion.managed=true',
    '--filter', 'label=com.kelion.role=app', '--filter', 'label=com.kelion.slot=' + match[1],
    '--format', '{{.ID}}']).split('\n')
  if (ids.length !== 1 || !/^[0-9a-f]{12,64}$/.test(ids[0])) throw new Error('active_container_invalid')
  if (command('/usr/bin/docker', ['inspect', '--format', '{{.State.Running}}:{{if .State.Health}}{{.State.Health.Status}}{{end}}', ids[0]]) !== 'true:healthy') throw new Error('active_container_unhealthy')
  return ids[0]
}

function readJobReceipt(row) {
  if (!ID.test(row?.jobId) || !TASK.test(row?.taskId)) throw new Error('job_identity_invalid')
  const path = '/var/lib/kelion-codex/jobs/' + row.taskId + '-' + row.jobId + '/job.json'
  const entry = lstatSync(path)
  const expectedUid = Number(command('/usr/bin/id', ['-u', 'kelion-codex']))
  if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1 || entry.uid !== expectedUid
    || (entry.mode & 0o777) !== 0o600 || entry.size > 4096 || realpathSync(path) !== path) throw new Error('job_receipt_invalid')
  return JSON.parse(readFileSync(path, 'utf8'))
}

export async function installedProof(args) {
  if (process.getuid?.() !== 0 || args.length !== LAYOUT.length + 1) throw new Error('proof_arguments_invalid')
  const jobId = args.at(-1)
  if (jobId !== 'status' && !ID.test(jobId)) throw new Error('proof_job_id_invalid')
  for (let index = 0; index < LAYOUT.length; index += 1) {
    const [, path, mode] = LAYOUT[index]
    readVerifiedFile(path, args[index], mode)
  }
  const controller = await import(pathToFileURL(LAYOUT[0][1]).href)
  const auth = await import(pathToFileURL(LAYOUT[1][1]).href)
  const model = controller.validateProviderConfig(JSON.parse(readFileSync(LAYOUT[4][1], 'utf8')))
  if (command('/usr/bin/node', [LAYOUT[0][1], '--verify-runtime-binary']) !== 'OPENCODE_BINARY_VERIFIED=yes') throw new Error('binary_unverified')
  const requestState = async (path, maxBytes = MAX_BYTES) => {
    const body = Buffer.from('{}')
    const timestamp = String(Math.floor(Date.now() / 1000))
    const nonce = randomUUID()
    return boundedJSON(httpRequest, {
      socketPath: controller.CONTROL_SOCKET, path, method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(body.length),
        'x-kelion-timestamp': timestamp, 'x-kelion-nonce': nonce,
        'x-kelion-signature': auth.signServiceRequest(auth.readServiceSecret(controller.CONTROL_SECRET), timestamp, nonce, 'POST', path, body) },
    }, body, { maxBytes })
  }
  const readiness = validateControllerState(await requestState('/v1/model/state'), model)
  // Only the already byte-verified controller observes host state. Never execute
  // another installed helper whose source was not authenticated by LAYOUT.
  const host = await requestState('/v1/worker/state', 2048)
  const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))
  const measuredAt = typeof host?.measuredAt === 'string' ? Date.parse(host.measuredAt) : NaN
  const fresh = () => Number.isFinite(measuredAt) && measuredAt <= Date.now() && Date.now() - measuredAt <= 15_000
  if (!exact(host, ['schema', 'measuredAt', 'worker', 'intentionalPause', 'deployGate'])
    || host.schema !== 1 || !fresh() || new Date(measuredAt).toISOString() !== host.measuredAt
    || typeof host.intentionalPause !== 'boolean' || host.deployGate !== false
    || !exact(host.worker, ['timer', 'service', 'mainPid'])
    || !['active', 'inactive', 'failed'].includes(host.worker.timer)
    || !['active', 'activating', 'inactive', 'failed'].includes(host.worker.service)
    || !Number.isSafeInteger(host.worker.mainPid) || host.worker.mainPid < 0
    || (['inactive', 'failed'].includes(host.worker.service) && host.worker.mainPid !== 0)
    || (host.intentionalPause
      ? host.worker.timer !== 'inactive' || !['inactive', 'failed'].includes(host.worker.service)
      : host.worker.timer !== 'active')) throw new Error('worker_state_unverified')
  const workerPause = host.intentionalPause ? 'paused' : 'unpaused'
  const services = {}
  for (const unit of ['kelion-constructor-model-control.service', 'kelion-codex-worker.timer',
    'kelion-constructor-publisher.timer', 'kelion-constructor-release.timer']) {
    services[unit] = command('/usr/bin/systemctl', ['show', unit, '--property=ActiveState', '--value'])
    const expected = unit === 'kelion-codex-worker.timer' && workerPause === 'paused' ? 'inactive' : 'active'
    if (services[unit] !== expected) throw new Error('constructor_service_state_mismatch')
  }
  if (command('/usr/bin/systemctl', ['show', 'kelion-codex-worker.timer',
    '--property=UnitFileState', '--value']) !== 'enabled') throw new Error('worker_timer_not_enabled')
  if (command('/usr/bin/systemctl', ['show', 'kelion-codex-worker.service',
    '--property=ActiveState', '--value']) !== host.worker.service
    || command('/usr/bin/systemctl', ['show', 'kelion-codex-worker.service',
      '--property=MainPID', '--value']) !== String(host.worker.mainPid)
    || !fresh()) throw new Error('worker_host_state_mismatch')
  // These retired identities must never retain root escalation into the host.
  for (const path of ['/etc/sudoers.d/kelion-constructor-full-access',
    '/etc/sudoers.d/kelion-local-qwen-constructor',
    '/etc/systemd/system/private-ai-web.service.d/90-kelion-constructor-full-access.conf',
    '/etc/systemd/system/kelion-codex-worker.service.d/90-local-qwen-full-access.conf',
    '/etc/systemd/system/kelion-codex-worker.service.d/90-local-opencode-full-access.conf']) {
    try { lstatSync(path); throw new Error('retired_host_access_present') }
    catch (error) { if (error?.code !== 'ENOENT') throw error }
  }
  const result = { schema: 1, measuredAt: new Date().toISOString(), kind: 'constructor-readiness-proof',
    readOnly: true, inferenceRequests: 0, readiness, services, workerPause, endToEnd: false }
  if (workerPause === 'paused') {
    // A deliberate pause is observable status, never readiness or completed work.
    // Even a requested job proof remains incomplete until the worker is resumed.
    result.kind = 'constructor-paused-status'
    result.readiness = { status: 'paused', model: { ...model } }
    return result
  }
  if (jobId !== 'status') {
    const container = activeContainer()
    const row = JSON.parse(command('/usr/bin/docker', ['exec', '-i', container,
      'node', '--input-type=module', '-', jobId], QUEUE_READ_ONLY))
    const receipt = readJobReceipt(row)
    const live = await boundedJSON(httpsRequest, {
      protocol: 'https:', hostname: 'kelionai.app', port: 443, path: '/api/release-proof',
      family: 4, method: 'GET', headers: { accept: 'application/json', 'cache-control': 'no-cache' },
    })
    result.job = validateCompletedJob(row, receipt, live)
    result.kind = 'constructor-completed-live-job-proof'
    result.endToEnd = true
  }
  return result
}

if (process.argv[2] === '--installed') {
  installedProof(process.argv.slice(3)).then((value) => {
    process.stdout.write(JSON.stringify(value) + '\n')
    if (value.readiness.status === 'paused') process.exitCode = 1
  })
    .catch(() => {
      // No raw exceptions, process argv, environment or provider/user logs leave VPS.
      process.stdout.write(JSON.stringify({ schema: 1, measuredAt: new Date().toISOString(),
        readOnly: true, endToEnd: false, error: 'constructor_proof_failed' }) + '\n')
      process.exitCode = 1
    })
}
