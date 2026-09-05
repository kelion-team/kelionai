import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./constructor-model-switch.sh', import.meta.url), 'utf8')

test('helperul păstrează numai bootstrapul lockului folosit de worker', () => {
  assert.match(source, /readonly LOCK_FILE='\/run\/lock\/private-ai-model-switch[.]lock'/)
  assert.match(source, /root:privateai:660:1/)
  assert.match(source, /\[ ! -L "\$LOCK_FILE" \]/)
  assert.match(source, /chown root:privateai "\$LOCK_FILE"/)
  assert.match(source, /chmod 0660 "\$LOCK_FILE"/)
  assert.match(source, /constructor-model-switch --prepare-lock/)
  assert.doesNotMatch(source, /systemctl|curl|wget|llama|qwen|hf |https?:|runtime_dropin/i)
})

test('comenzile de schimbare retrase eșuează înaintea oricărui acces la host', (context) => {
  if (process.platform !== 'linux') return context.skip('Bash behavior runs in the isolated Linux gate')
  for (const args of [['fast'], ['powerful'], ['anything'], [], ['--prepare-lock', 'unexpected']]) {
    // Every selected branch exits before prepare_lock_file; never invoke the
    // host-mutating bootstrap in a test process.
    const result = spawnSync('/bin/bash', ['-s', '--', ...args], {
      input: source, encoding: 'utf8', timeout: 5_000, env: { PATH: '/usr/bin:/bin' },
    })
    assert.equal(result.error, undefined)
    assert.equal(result.status, 64, result.stderr)
    assert.doesNotMatch(result.stdout, /INTERLOCK=ready/)
    assert.match(result.stderr, /constructor_model_switch_retired|utilizare:/)
  }
})

test('bootstrapul lockului necesită root și validează calea înainte de mutații', () => {
  const prepare = source.indexOf('prepare_lock_file()')
  const guard = source.indexOf('[ "$(id -u)" -eq 0 ]')
  const invocation = source.lastIndexOf('\nprepare_lock_file')
  assert.ok(prepare >= 0 && guard > prepare && invocation > guard)
  const pathValidation = source.indexOf('[ -d /run/lock ] && [ ! -L /run/lock ]')
  const mutation = source.indexOf('chown root:privateai')
  assert.ok(pathValidation >= 0 && pathValidation < mutation)
})
