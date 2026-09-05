import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmodSync, chownSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The test needs root only INSIDE an isolated container with a disposable /opt
// tmpfs. Never execute this fixture against a host installation or production.
assert.equal(process.platform, 'linux')
assert.ok(existsSync('/.dockerenv'), 'Run only in the isolated Linux test container')
assert.equal(process.getuid(), 0, 'Container-local root owns the synthetic installed files')
assert.ok(readFileSync('/proc/mounts', 'utf8').split('\n').some((line) => line.split(' ')[1] === '/opt' && line.split(' ')[2] === 'tmpfs'), 'The fixture requires a private /opt tmpfs')

const guardSource = fileURLToPath(new URL('./doctor-repair-scope.mjs', import.meta.url))
const paths = {
  worker: '/opt/kelion-codex/codex-worker.mjs',
  publisher: '/opt/kelion-constructor/constructor-publisher.mjs',
  workerGuard: '/opt/kelion-codex/lib/doctor-repair-scope.mjs',
  publisherGuard: '/opt/kelion-constructor/lib/doctor-repair-scope.mjs',
}
let serial = 0
function hash(path) { return createHash('sha256').update(readFileSync(path)).digest('hex') }
function rewrite(path, content, mode) { chmodSync(path, 0o600); writeFileSync(path, content); chmodSync(path, mode) }
async function fixture(run, source = guardSource) {
  assert.ok(!existsSync('/opt/kelion-codex') && !existsSync('/opt/kelion-constructor'), 'Refuse pre-existing installed targets')
  try {
    for (const path of Object.values(paths)) mkdirSync(dirname(path), { recursive: true, mode: 0o755 })
    for (const path of [paths.worker, paths.publisher]) { writeFileSync(path, `// Synthetic supervisor: ${path}\n`); chmodSync(path, 0o555) }
    // Stage bytes as container root, not checkout ownership/copy metadata.
    // The source may be runner-owned and read-only; no extra capability is needed.
    const guardBytes = readFileSync(source)
    for (const path of [paths.workerGuard, paths.publisherGuard]) {
      writeFileSync(path, guardBytes, { flag: 'wx', mode: 0o444 })
      const installed = lstatSync(path)
      assert.equal(installed.uid, 0); assert.equal(installed.gid, 0)
      assert.equal(installed.mode & 0o7777, 0o444); assert.equal(installed.nlink, 1)
      assert.equal(hash(path), createHash('sha256').update(guardBytes).digest('hex'))
    }
    const expected = { protocol: 2, guardSha256: hash(paths.workerGuard), workerSha256: hash(paths.worker), publisherSha256: hash(paths.publisher) }
    const load = async (path = paths.workerGuard) => import(`${pathToFileURL(path).href}?fixture=${++serial}`)
    await run({ expected, load })
  } finally {
    // Both exact targets were proven absent and created solely in the /opt tmpfs.
    rmSync('/opt/kelion-codex', { recursive: true, force: true })
    rmSync('/opt/kelion-constructor', { recursive: true, force: true })
  }
}

test('both installed guard copies measure the exact root-owned supervisor tuple', () => fixture(async ({ expected, load }) => {
  for (const path of [paths.workerGuard, paths.publisherGuard]) assert.deepEqual((await load(path)).measureDoctorCapability(), expected)
}))

test('semantic parser runtime is non-root, offline, readonly and mounts no host credentials or parser from the worktree', () => fixture(async ({ load }) => {
  const scope = { automationOrigin: 'doctor', repairScope: { code: 'public_health', allowedPaths: ['backend/src/services/publicRuntimeContract.ts', 'backend/src/doctorPublicRuntime.regression.test.ts'] } }
  const image = `ghcr.io/fixture/gates@sha256:${'a'.repeat(64)}`
  for (const path of [paths.workerGuard, paths.publisherGuard]) {
    const module = await load(path)
    const args = module.doctorSemanticContainerArgs('/var/lib/fixture/job', image, scope, { uid: 995, gid: 986 })
    for (const option of ['--pull=never', '--network=none', '--read-only', '--cap-drop=all', '--security-opt=no-new-privileges', '--userns=keep-id']) assert.ok(args.includes(option))
    assert.equal(args[args.indexOf('--user') + 1], '995:986')
    assert.equal(args[args.indexOf('--entrypoint') + 1], '/usr/local/bin/node')
    const mounts = args.flatMap((arg, index) => arg === '--mount' ? [args[index + 1]] : [])
    assert.deepEqual(mounts, [`type=bind,src=/var/lib/fixture/job,dst=/source,ro=true`, `type=bind,src=${path},dst=/doctor-guard.mjs,ro=true`])
    assert.deepEqual(args.slice(-4), [image, '/doctor-guard.mjs', '--semantic-check', 'public_health'])
    assert.throws(() => module.doctorSemanticContainerArgs('/var/lib/fixture/job', image, scope, { uid: 0, gid: 0 }), /invalid_authorization/)
    assert.throws(() => module.doctorSemanticContainerArgs('/var/lib/fixture/job', 'untrusted:latest', scope, { uid: 995, gid: 986 }), /invalid_authorization/)
  }
}))

test('a running old process cannot advertise replacement bytes as the new capability', () => fixture(async ({ expected, load }) => {
  const old = await load()
  assert.deepEqual(old.measureDoctorCapability(), expected)
  rewrite(paths.worker, '// Reviewed replacement needs its own restarted process\n', 0o555)
  assert.equal(old.measureDoctorCapability(), null)
  const restarted = await load()
  assert.deepEqual(restarted.measureDoctorCapability(), { ...expected, workerSha256: hash(paths.worker) })
}))

test('missing or inconsistent guard copies never advertise partial capability', () => fixture(async ({ load }) => {
  rewrite(paths.publisherGuard, '// Different guard\n', 0o444)
  assert.equal((await load()).measureDoctorCapability(), null)
  rmSync(paths.publisherGuard)
  assert.equal((await load()).measureDoctorCapability(), null)
}))

test('unsafe root ownership, writable mode, symlinks, hardlinks and parent modes fail closed', async () => {
  const unsafe = [
    () => chownSync(paths.worker, 65534, 0),
    () => chmodSync(paths.worker, 0o755),
    () => { rmSync(paths.worker); symlinkSync(paths.publisher, paths.worker) },
    () => linkSync(paths.worker, join(dirname(paths.worker), 'alias.mjs')),
    () => chmodSync(dirname(paths.worker), 0o777),
  ]
  for (const mutate of unsafe) await fixture(async ({ load }) => {
    const before = await load()
    assert.notEqual(before.measureDoctorCapability(), null)
    mutate()
    assert.equal(before.measureDoctorCapability(), null)
    assert.equal((await load()).measureDoctorCapability(), null)
  })
})

test('fixture stages identical root-owned guard bytes from a read-only runner-owned checkout', async () => {
  const directory = mkdtempSync('/tmp/doctor-runner-source-')
  const source = join(directory, 'guard.mjs')
  const bytes = readFileSync(guardSource)
  writeFileSync(source, bytes, { flag: 'wx', mode: 0o444 })
  chownSync(source, 1001, 1001)
  try {
    await fixture(async ({ expected, load }) => {
      assert.deepEqual((await load()).measureDoctorCapability(), expected)
    }, source)
    assert.equal(lstatSync(source).uid, 1001)
    assert.equal(lstatSync(source).mode & 0o7777, 0o444)
    assert.deepEqual(readFileSync(source), bytes)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
