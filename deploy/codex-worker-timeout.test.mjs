import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

import {
  executionTimeoutMsForOrder,
  gateTimeoutMs,
  parseRequestedAuditMinutes,
  smokeTimeoutMs,
  createOpenCodeProgress,
  openCodeContainerArgs,
  openCodeExecArgs,
  validateOpenCodeConfig,
  validateProviderAddresses,
} from './codex-worker.mjs'

test('durata explicită de audit devine timeout efectiv cu marjă de handoff', () => {
  assert.equal(parseRequestedAuditMinutes('audit pentru 90 de minute'), 90)
  assert.equal(parseRequestedAuditMinutes('auditează timp de 2 ore'), 120)
  assert.equal(parseRequestedAuditMinutes('30 min audit Constructor'), 30)
  assert.equal(parseRequestedAuditMinutes('ordin generic fără durată'), null)
  assert.equal(executionTimeoutMsForOrder('audit pentru 90 de minute', {}), 95 * 60_000)
  assert.equal(executionTimeoutMsForOrder('ordin generic', {}), 4 * 60 * 60_000)
})

test('providerul Constructor rămâne anonim, cu modelul unic aprobat și fără fallback', () => {
  const config = JSON.parse(readFileSync(new URL('./opencode-constructor.json', import.meta.url), 'utf8'))
  assert.equal(validateOpenCodeConfig(config), true)
  for (const mutate of [
    (value) => { value.small_model = 'opencode-free/paid-model' },
    (value) => { value.provider['opencode-free'].models.other = {} },
    (value) => { value.provider['opencode-free'].options.apiKey = 'synthetic-not-a-key' },
    (value) => { value.provider['opencode-free'].options.headers = { Authorization: 'synthetic' } },
    (value) => { value.enabled_providers.push('another') },
    (value) => { value.permission.external_directory = 'allow' },
    (value) => { value.plugin = ['unapproved'] },
    (value) => { value.agent = { build: { model: 'paid/model' } } },
    (value) => { value.provider['opencode-free'].models['big-pickle'].options = { apiKey: 'synthetic' } },
  ]) {
    const invalid = structuredClone(config)
    mutate(invalid)
    assert.throws(() => validateOpenCodeConfig(invalid))
  }
  assert.throws(() => openCodeExecArgs('/var/lib/kelion-codex/jobs/test/worktree', '/var/lib/kelion-codex/jobs/test/order.md', 'powerful'))
  assert.throws(() => openCodeExecArgs('/var/lib/kelion-codex/jobs/test/worktree', '/var/lib/kelion-codex/jobs/other/order.md'))
})

test('progresul provine numai din unelte confirmate, fără textul fișierelor sau procent inventat', () => {
  const messages = []
  const progress = createOpenCodeProgress((message) => messages.push(message))
  const event = (type, tool, status, callID) => JSON.stringify({ type, part: { tool, callID, state: { status, input: { secret: 'synthetic-private' }, output: 'synthetic-private' } } }) + '\n'
  const reading = event('tool_use', 'read', 'completed', 'one')
  progress.consume(reading.slice(0, 25))
  assert.equal(messages.length, 0)
  progress.consume(reading.slice(25))
  progress.consume(reading)
  progress.consume(event('tool_use', 'bash', 'running', 'two'))
  progress.consume(event('tool_use', 'bash', 'error', 'two'))
  progress.consume(event('text', 'edit', 'completed', 'three'))
  assert.equal(messages.length, 1)
  progress.consume(event('tool_use', 'edit', 'completed', 'three'))
  assert.deepEqual(progress.snapshot(), { completedTools: 2, stage: 'Modificare aplicată', failed: false })
  assert.equal(messages.length, 2)
  assert.doesNotMatch(messages.join('\n'), /synthetic-private|%|secret|output/)
  progress.consume('{"type":"error","error":{"message":"synthetic-private"}}\n')
  assert.equal(progress.snapshot().failed, true)
  assert.equal(messages.length, 2)
})

test('executorul rootless montează doar codul ordinului și configurația fără secrete', () => {
  const args = openCodeContainerArgs('/var/lib/kelion-codex/jobs/test/worktree', '/var/lib/kelion-codex/jobs/test/order.md', ['1.1.1.1'], 'pinned-test-image', { uid: 1000, gid: 1000 })
  assert.ok(args.includes('--pull=never'))
  assert.ok(args.includes('--read-only'))
  assert.deepEqual(args.slice(0, 2), ['--runtime', '/usr/bin/crun'])
  assert.ok(args.includes('--cgroups=disabled'))
  assert.doesNotMatch(args.join('\n'), /--(?:pids-limit|memory|cpus)=/)
  assert.ok(args.includes('--security-opt=no-new-privileges'))
  assert.ok(args.includes('--network=slirp4netns:allow_host_loopback=false,enable_ipv6=false'))
  assert.ok(args.includes('opencode.ai:1.1.1.1'))
  assert.ok(args.includes('OPENCODE_CONFIG=/constructor/opencode.json'))
  const mounts = args.filter((_, index) => args[index - 1] === '--mount')
  assert.equal(mounts.filter((value) => value.startsWith('type=tmpfs,') && value.endsWith('tmpfs-mode=0700,U=true')).length, 2)
  assert.ok(mounts.filter((value) => !value.startsWith('type=tmpfs,')).every((value) => !value.includes('U=true')))
  assert.equal(mounts.filter((value) => value.endsWith('ro=false')).length, 1)
  assert.ok(mounts.some((value) => value.endsWith('dst=/work/repo/.git,ro=true')))
  assert.doesNotMatch(mounts.join('\n'), /src=\/(?:root|run|etc)|src=\/var\/lib\/kelion-codex\/repo\/\.git|docker\.sock|podman\.sock|auth\.json/)
  assert.doesNotMatch(args.join('\n'), /OPENAI_API_KEY|CREDENTIALS_DIRECTORY|CODEX_WORKER_SECRET|--privileged|--network=host|sudo/)
  assert.throws(() => openCodeContainerArgs('/var/lib/kelion-codex/jobs/test/worktree', '/var/lib/kelion-codex/jobs/test/order.md', ['1.1.1.1'], 'test', { uid: 0, gid: 0 }))
})

test('rezolvarea providerului refuză adrese locale și IPv6 în loc să folosească host DNS modificat', () => {
  assert.deepEqual(validateProviderAddresses(['1.1.1.1', '1.1.1.1']), ['1.1.1.1'])
  for (const addresses of [[], ['::1'], ['127.0.0.1'], ['10.0.0.1'], ['172.16.0.1'], ['192.168.0.1'], ['169.254.169.254'], ['100.64.0.1'], ['bad']]) {
    assert.throws(() => validateProviderAddresses(addresses))
  }
})

test('timeout-urile configurabile refuză valori nesigure și plafonează auditul', () => {
  assert.equal(executionTimeoutMsForOrder('audit 500 minute', {}), 4 * 60 * 60_000)
  assert.equal(executionTimeoutMsForOrder('ordin generic', { CODEX_WORKER_EXEC_TIMEOUT_SECONDS: '3600' }), 60 * 60_000)
  assert.equal(gateTimeoutMs({ CODEX_WORKER_GATE_TIMEOUT_SECONDS: '3600' }), 60 * 60_000)
  assert.equal(smokeTimeoutMs({ CODEX_WORKER_SMOKE_TIMEOUT_SECONDS: '1800' }), 30 * 60_000)
  assert.throws(
    () => executionTimeoutMsForOrder('ordin generic', { CODEX_WORKER_EXEC_TIMEOUT_SECONDS: '60' }),
    /între 300 și 14400 secunde/,
  )
})
