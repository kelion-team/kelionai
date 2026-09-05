import { createHash } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

// These are the canonical installer destinations, not caller-controlled paths.
// A heartbeat is a measurement, not an expected-hash source: the backend compares
// it with the manifest baked into its reviewed, immutable application image.
const INSTALLED = Object.freeze({
  workerSha256: '/opt/kelion-codex/codex-worker.mjs',
  publisherSha256: '/opt/kelion-constructor/constructor-publisher.mjs',
  workerGuard: '/opt/kelion-codex/lib/doctor-repair-scope.mjs',
  publisherGuard: '/opt/kelion-constructor/lib/doctor-repair-scope.mjs',
})

function rootOwnedFileHash(path, mode) {
  if (realpathSync(path) !== path) throw new Error('noncanonical_runtime_file')
  for (let parent = dirname(path); parent !== '/'; parent = dirname(parent)) {
    const directory = lstatSync(parent)
    if (!directory.isDirectory() || directory.uid !== 0 || (directory.mode & 0o022) !== 0) throw new Error('unsafe_runtime_directory')
  }
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    const before = fstatSync(fd)
    if (!before.isFile() || before.uid !== 0 || before.gid !== 0 || (before.mode & 0o7777) !== mode
      || before.nlink !== 1 || before.size < 1 || before.size > 2 * 1024 * 1024) throw new Error('unsafe_runtime_file')
    const bytes = readFileSync(fd)
    const after = fstatSync(fd)
    const current = lstatSync(path)
    if (bytes.length !== before.size || ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].some((key) => before[key] !== after[key] || after[key] !== current[key])) throw new Error('runtime_changed_during_measurement')
    return createHash('sha256').update(bytes).digest('hex')
  } finally { closeSync(fd) }
}

function installedCapability() {
  try {
    if (process.platform !== 'linux' || ![INSTALLED.workerGuard, INSTALLED.publisherGuard].includes(fileURLToPath(import.meta.url))) return null
    const guardSha256 = rootOwnedFileHash(INSTALLED.workerGuard, 0o444)
    if (guardSha256 !== rootOwnedFileHash(INSTALLED.publisherGuard, 0o444)) return null
    return Object.freeze({ protocol: 2, guardSha256,
      workerSha256: rootOwnedFileHash(INSTALLED.workerSha256, 0o555),
      publisherSha256: rootOwnedFileHash(INSTALLED.publisherSha256, 0o555),
    })
  } catch { return null }
}

// Preserve the loaded process's tuple. Replacing files cannot upgrade a running
// old supervisor's advertised capability; it must be restarted by the installer.
const loadedCapability = installedCapability()
export function measureDoctorCapability() {
  const current = installedCapability()
  return loadedCapability && current && Object.keys(loadedCapability).every((key) => loadedCapability[key] === current[key]) ? loadedCapability : null
}

/** Immutable, idempotent local rejection evidence. A lost transport ACK may
 * repeat publication, but must neither overwrite evidence nor invoke AI again.
 * No raw patch, model message, log text or credential is persisted here. */
export function persistDoctorScopeRejection(path, { jobId, taskId, reason, patchSha256 }) {
  if (!/^[1-9]\d{0,18}$/.test(String(jobId)) || !/^codex-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(taskId)
    || !/^[a-z][a-z_]{2,63}$/.test(reason) || !/^[0-9a-f]{64}$/.test(patchSha256)) throw new Error('invalid_scope_rejection_evidence')
  const encoded = `${JSON.stringify({ schema: 1, jobId: String(jobId), taskId, code: 'doctor_scope_rejected', reason, patchSha256 })}\n`
  let fd
  try {
    fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o400)
    writeFileSync(fd, encoded)
    fsyncSync(fd)
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error
    const info = lstatSync(path)
    if (!info.isFile() || info.nlink !== 1 || info.uid !== process.getuid() || (info.mode & 0o7777) !== 0o400 || info.size !== Buffer.byteLength(encoded)) throw new Error('scope_rejection_evidence_conflict')
    const existing = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if (readFileSync(existing, 'utf8') !== encoded) throw new Error('scope_rejection_evidence_conflict')
      fsyncSync(existing)
    } finally { closeSync(existing) }
  } finally { if (fd !== undefined) closeSync(fd) }
  const directory = openSync(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY)
  try { fsyncSync(directory) } finally { closeSync(directory) }
}

// Authorization is derived from the persisted grant/incident by the server,
// never from the AI order, a patch, a receipt or user-supplied file names.
const SCOPES = Object.freeze({
  public_health: Object.freeze(['backend/src/services/publicRuntimeContract.ts', 'backend/src/doctorPublicRuntime.regression.test.ts']),
  release_version: Object.freeze(['backend/src/services/publicRuntimeContract.ts', 'backend/src/doctorPublicRuntime.regression.test.ts']),
  agent_registry: Object.freeze(['backend/src/services/publicAgentContract.ts', 'backend/src/doctorPublicAgents.regression.test.ts']),
})

// Positive AST policy for the two tiny, pure public formatters. This is not a
// blacklist or a general TypeScript sandbox. Only these reviewed algorithms and
// fixed declarative regressions are authorized; every other AST is rejected.
const FORMATTERS = Object.freeze({
  public_health: `export function publicHealthPayload(): { status: string } { return { status: 'ok' } }
export function publicVersionPayload(version: string, bootAt: string): { v: string; at: string; ver: string } { return { v: version, at: bootAt, ver: version } }`,
  agent_registry: 'export function publicAgentRoster(agents: readonly { id: string; nume: string; rol: string }[]): { count: number; agents: { id: string; nume: string; rol: string; url: string }[] } { return { count: agents.length, agents: agents.map((a) => ({ id: a.id, nume: a.nume, rol: a.rol, url: `/api/a2a/${a.id}` })) } }',
})
const REGRESSIONS = Object.freeze({
  public_health: `import { expect, test } from 'vitest'
import { publicHealthPayload, publicVersionPayload } from './services/publicRuntimeContract.js'
test('public runtime preserves measured input', () => {
  expect(publicHealthPayload()).toEqual({ status: 'ok' })
  expect(publicVersionPayload('revision-proof', 'boot-proof')).toEqual({ v: 'revision-proof', at: 'boot-proof', ver: 'revision-proof' })
})`,
  agent_registry: `import { expect, test } from 'vitest'
import { publicAgentRoster } from './services/publicAgentContract.js'
test('public roster serializes only already authorized fields', () => {
  expect(publicAgentRoster([])).toEqual({ count: 0, agents: [] })
  expect(publicAgentRoster([{ id: 'probe', nume: 'Probe', rol: 'Read' }])).toEqual({ count: 1, agents: [{ id: 'probe', nume: 'Probe', rol: 'Read', url: '/api/a2a/probe' }] })
})`,
})

export function doctorSemanticSources(authorization) {
  const auth = canonicalRepairAuthorization(authorization)
  if (auth.automationOrigin !== 'doctor') return null
  const key = auth.repairScope.code === 'release_version' ? 'public_health' : auth.repairScope.code
  return Object.freeze({ [auth.repairScope.allowedPaths[0]]: FORMATTERS[key], [auth.repairScope.allowedPaths[1]]: REGRESSIONS[key] })
}

function astSignature(ts, source) {
  if (typeof source !== 'string' || Buffer.byteLength(source) > 65_536 || source.includes('\0')) throw new DoctorScopeError('semantic_contract_rejected')
  const parsed = ts.createSourceFile('repair.ts', source, ts.ScriptTarget.ES2022, false, ts.ScriptKind.TS)
  if (parsed.parseDiagnostics.length > 0) throw new DoctorScopeError('semantic_contract_rejected')
  let count = 0
  const visit = (node) => {
    if (++count > 10_000) throw new DoctorScopeError('semantic_contract_rejected')
    const children = []
    ts.forEachChild(node, (child) => { children.push(visit(child)) })
    return [node.kind, typeof node.text === 'string' ? node.text : null, children]
  }
  // EOF positions, comments and whitespace are not executable syntax. Node kinds,
  // identifiers, literals, operators, modifiers, types and every child must match.
  return JSON.stringify(parsed.statements.map(visit))
}

export function assertDoctorSemanticSources(ts, authorization, measuredSources) {
  const accepted = doctorSemanticSources(authorization)
  if (accepted === null) return
  if (!measuredSources || Object.keys(measuredSources).sort().join('\0') !== Object.keys(accepted).sort().join('\0')) throw new DoctorScopeError('semantic_contract_rejected')
  for (const [path, expected] of Object.entries(accepted)) {
    if (astSignature(ts, measuredSources[path]) !== astSignature(ts, expected)) throw new DoctorScopeError('semantic_contract_rejected')
  }
}

export function doctorSemanticContainerArgs(worktree, image, authorization, identity = {}) {
  const auth = canonicalRepairAuthorization(authorization)
  if (auth.automationOrigin !== 'doctor' || !/^ghcr\.io\/[-a-z0-9_./]+@sha256:[0-9a-f]{64}$/.test(image)) throw new DoctorScopeError('invalid_authorization')
  const uid = identity.uid ?? process.getuid?.()
  const gid = identity.gid ?? process.getgid?.()
  if (!Number.isSafeInteger(uid) || uid < 1 || !Number.isSafeInteger(gid) || gid < 1) throw new DoctorScopeError('invalid_authorization')
  const guard = fileURLToPath(import.meta.url)
  if (![INSTALLED.workerGuard, INSTALLED.publisherGuard].includes(guard)) throw new DoctorScopeError('invalid_authorization')
  return ['--runtime', '/usr/bin/crun', 'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=all', '--security-opt=no-new-privileges',
    '--cgroups=disabled', '--ulimit=nofile=1024:1024', '--userns=keep-id', '--user', `${uid}:${gid}`,
    '--mount', `type=bind,src=${resolve(worktree)},dst=/source,ro=true`,
    '--mount', `type=bind,src=${guard},dst=/doctor-guard.mjs,ro=true`,
    '--env', 'HOME=/nonexistent', '--entrypoint', '/usr/local/bin/node', image, '/doctor-guard.mjs', '--semantic-check', auth.repairScope.code]
}

export class DoctorScopeError extends Error {
  constructor(reason, patch = '') {
    super(`doctor_scope_rejected;reason=${reason}`)
    this.name = 'DoctorScopeError'
    this.reason = reason
    this.patchSha256 = createHash('sha256').update(patch).digest('hex')
  }
}

export function canonicalRepairAuthorization(job) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new DoctorScopeError('invalid_authorization')
  if (job.automationOrigin === 'admin' && job.repairScope === null) return Object.freeze({ automationOrigin: 'admin', repairScope: null })
  const scope = job.repairScope
  const paths = scope && typeof scope === 'object' && !Array.isArray(scope)
    && typeof scope.code === 'string' && Object.hasOwn(SCOPES, scope.code) && SCOPES[scope.code]
  if (job.automationOrigin !== 'doctor' || !paths || Object.keys(scope).sort().join(',') !== 'allowedPaths,code'
    || !Array.isArray(scope.allowedPaths) || scope.allowedPaths.length !== paths.length
    || scope.allowedPaths.some((path, index) => path !== paths[index])) throw new DoctorScopeError('invalid_authorization')
  return Object.freeze({ automationOrigin: 'doctor', repairScope: Object.freeze({ code: scope.code, allowedPaths: paths }) })
}

/** Git's NUL-delimited index manifests are authoritative. Textual patch headers
 * are not parsed as paths: quoting, renames, symlinks and binary patches must
 * not turn a nominally allowed path into a different operation. */
export function assertDoctorPatchScope(authorization, { rawDiff, numStat, patch }) {
  const auth = canonicalRepairAuthorization(authorization)
  if (auth.automationOrigin === 'admin') return
  const reject = (reason) => { throw new DoctorScopeError(reason, patch) }
  const decode = (value) => {
    if (typeof value === 'string') return value
    if (!Buffer.isBuffer(value)) return reject('invalid_manifest')
    try { return new TextDecoder('utf-8', { fatal: true }).decode(value) } catch { return reject('invalid_manifest') }
  }
  const raw = decode(rawDiff).split('\0')
  if (raw.pop() !== '' || raw.length === 0 || raw.length % 2 !== 0) reject('invalid_manifest')
  const changed = new Set()
  for (let i = 0; i < raw.length; i += 2) {
    const entry = /^:(\d{6}) (\d{6}) ([0-9a-f]{40}) ([0-9a-f]{40}) ([AM])$/.exec(raw[i])
    const path = raw[i + 1]
    if (!entry || !auth.repairScope.allowedPaths.includes(path) || changed.has(path)) reject('forbidden_change')
    const [, before, after, oldOid, , status] = entry
    if (after !== '100644' || (status === 'M' && before !== '100644')
      || (status === 'A' && (before !== '000000' || oldOid !== '0'.repeat(40) || path !== auth.repairScope.allowedPaths[1]))) reject('forbidden_file_mode')
    changed.add(path)
  }
  if (!changed.has(auth.repairScope.allowedPaths[0])) reject('missing_source_change')
  const counts = decode(numStat).split('\0')
  if (counts.pop() !== '' || counts.length !== changed.size) reject('invalid_manifest')
  const measured = new Set()
  for (const line of counts) {
    const match = /^(\d+)\t(\d+)\t([^\0\r\n\t]+)$/.exec(line)
    if (!match || !changed.has(match[3]) || measured.has(match[3])) reject('binary_or_invalid_change')
    measured.add(match[3])
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--semantic-check' || !Object.hasOwn(SCOPES, process.argv[3])) throw new DoctorScopeError('invalid_authorization')
    // Parser is loaded from the immutable gate image, never the AI worktree.
    const ts = createRequire('/opt/kelion/backend/doctor-parser.cjs')('typescript')
    const authorization = { automationOrigin: 'doctor', repairScope: { code: process.argv[3], allowedPaths: SCOPES[process.argv[3]] } }
    const sources = {}
    for (const path of authorization.repairScope.allowedPaths) {
      const absolute = join('/source', path)
      let info
      try { info = lstatSync(absolute) } catch (error) {
        if (error?.code === 'ENOENT') throw new DoctorScopeError('semantic_contract_rejected')
        throw error
      }
      if (!info.isFile() || info.size < 1 || info.size > 65_536 || realpathSync(absolute) !== absolute) throw new DoctorScopeError('semantic_contract_rejected')
      const bytes = readFileSync(absolute)
      try { sources[path] = new TextDecoder('utf-8', { fatal: true }).decode(bytes) } catch { throw new DoctorScopeError('semantic_contract_rejected') }
    }
    assertDoctorSemanticSources(ts, authorization, sources)
    process.stdout.write('doctor_semantic_contract_v2_ok\n')
  } catch (error) {
    process.stderr.write(error instanceof DoctorScopeError ? 'doctor_semantic_contract_rejected\n' : 'doctor_semantic_check_unavailable\n')
    process.exitCode = error instanceof DoctorScopeError ? 2 : 1
  }
}
