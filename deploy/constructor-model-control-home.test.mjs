import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { OPENCODE_BIN, runCommand } from './constructor-model-control.mjs'

// Mandatory isolated-container probe. The pinned CLI is mounted read-only and
// invoked only with --version; no model, prompt, repository or credential exists.
assert.equal(process.platform, 'linux')
assert.ok(existsSync('/.dockerenv'), 'Never run the host-layout fixture outside its isolated container')
assert.equal(process.getuid(), 0, 'Mirror the controller identity inside the container, never on the host')
assert.equal(createHash('sha256').update(readFileSync(OPENCODE_BIN)).digest('hex'), 'd91e0d33676d0839f7cde87924cd4127ea88c9d6784eea9f009a7d08bdc60eeb')
assert.ok(readFileSync('/proc/mounts', 'utf8').split('\n').some((line) => line.split(' ')[1] === '/' && line.split(' ')[3].split(',').includes('ro')), 'Root filesystem must be readonly')

const safeEnv = { PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' }
const homes = () => readdirSync(tmpdir()).filter((name) => name.startsWith('kelion-constructor-version-')).sort()

test('real pinned OpenCode reproduces EROFS without HOME and succeeds with private version-only HOME', async () => {
  const before = homes()
  const original = spawnSync(OPENCODE_BIN, ['--version'], { env: safeEnv, encoding: 'utf8', timeout: 5_000 })
  assert.equal(original.status, 1)
  assert.match(original.stderr, /EROFS.*read-only file system[\s\S]*\/root\/\.local/)
  const pending = runCommand(OPENCODE_BIN, ['--version'], 5_000)
  const created = homes().filter((name) => !before.includes(name))
  try {
    assert.equal(created.length, 1)
    const home = join(tmpdir(), created[0])
    assert.equal(lstatSync(home).mode & 0o7777, 0o700)
    assert.equal(lstatSync(home).uid, process.getuid())
    for (const directory of ['cache', 'config', 'data', 'state', 'runtime']) assert.equal(lstatSync(join(home, directory)).mode & 0o7777, 0o700)
    const result = await pending
    assert.deepEqual(result, { code: 0, signal: null, stdout: '1.18.25', failed: false })
  } finally { await pending }
  assert.deepEqual(homes(), before)
})

test('concurrent version timeouts remove only their own distinct temporary homes', async () => {
  const before = homes()
  const probes = [runCommand(OPENCODE_BIN, ['--version'], 1), runCommand(OPENCODE_BIN, ['--version'], 1)]
  try {
    const created = homes().filter((name) => !before.includes(name))
    assert.equal(created.length, 2)
    assert.notEqual(created[0], created[1])
    for (const result of await Promise.all(probes)) assert.equal(result.failed, true)
  } finally { await Promise.all(probes) }
  assert.deepEqual(homes(), before)
})

test('other commands keep the sanitized original environment and never acquire a temporary HOME', async () => {
  const before = homes()
  const result = await runCommand('/usr/bin/env', [], 1_000)
  assert.equal(result.failed, false)
  assert.equal(result.code, 0)
  assert.deepEqual(Object.fromEntries(result.stdout.split('\n').map((line) => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)] })), safeEnv)
  assert.deepEqual(homes(), before)
})
