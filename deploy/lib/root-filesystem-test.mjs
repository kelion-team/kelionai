import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import test from 'node:test'

/** Root-only filesystem proofs remain mandatory in CI. A canonical non-root
 * gate may report absent privilege explicitly, never turn a failed proof into
 * a skip or simulate root metadata. Fixture execution must remain isolated. */
export function rootFilesystemTest(name, callback) {
  test(name, async (context) => {
    const required = process.env.KELION_REQUIRE_ROOT_PUBLICATION_BARRIER_PROBE ?? '0'
    assert.match(required, /^[01]$/)
    let rootAvailable = process.getuid?.() === 0
    if (!rootAvailable) {
      const probe = spawnSync('sudo', ['-n', '--', '/usr/bin/id', '-u'], {
        encoding: 'utf8', timeout: 5_000,
      })
      if (probe.error && probe.error.code !== 'ENOENT' && probe.error.code !== 'EACCES') {
        assert.fail('Root capability probe failed: ' + probe.error.code)
      }
      assert.equal(probe.signal, null, 'Root capability probe was interrupted')
      rootAvailable = !probe.error && probe.status === 0 && probe.stdout.trim() === '0'
    }
    if (!rootAvailable) {
      assert.notEqual(required, '1', 'Mandatory root filesystem proof requires root or non-interactive sudo')
      context.skip('Root filesystem capability unavailable: canonical non-root gate has no usable sudo; mandatory CI root proof is separate')
      return
    }
    assert.ok(process.env.CI === 'true' || existsSync('/.dockerenv') || existsSync('/run/.containerenv'),
      'Root filesystem fixtures require an isolated container or CI runner, never the VPS host')
    await callback(context)
  })
}
