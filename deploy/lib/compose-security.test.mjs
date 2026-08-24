import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const compose = readFileSync(new URL('../compose.production.yml', import.meta.url), 'utf8')
const prVerify = readFileSync(new URL('../../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')

function service(name) {
  const match = new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z][a-z0-9-]*:|^networks:)`, 'm').exec(compose)
  assert.ok(match, `serviciul ${name} lipsește`)
  return match[1]
}

function mount(block, target) {
  const lines = block.split('\n')
  const targetIndex = lines.findIndex((line) => line.trim() === `target: ${target}`)
  assert.notEqual(targetIndex, -1, `mountul ${target} lipsește`)
  let start = targetIndex
  while (start > 0 && !lines[start].includes('- type: bind')) start -= 1
  let end = targetIndex + 1
  while (end < lines.length && !lines[end].includes('- type: bind') && !/^    [a-z_]/.test(lines[end])) end += 1
  return lines.slice(start, end).join('\n')
}

function assertSandboxed(name, expectedUser) {
  const block = service(name)
  assert.match(block, new RegExp(`user: "${expectedUser}"`))
  assert.match(block, /\n    read_only: true\n/)
  assert.match(block, /\n    cap_drop: \[ALL\]\n/)
  assert.match(block, /no-new-privileges:true/)
  assert.match(block, /\n    pids_limit: [1-9]\d*\n/)
  assert.match(block, /\n    mem_limit: [1-9]\d*(?:m|g)\n/)
  assert.match(block, /\n    cpus: (?:0\.[1-9]\d*|[1-9]\d*(?:\.\d+)?)\n/)
  assert.doesNotMatch(block, /network_mode: host/)
}

test('workerii browser și converter au sandbox fail-closed', () => {
  assertSandboxed('browser-worker', '1001:1001')
  assertSandboxed('browser-egress', '1000:1000')
  assertSandboxed('converter-gateway', '1000:1000')
  assertSandboxed('converter-parser', '10001:10001')

  assert.match(service('converter-gateway'), /network_mode: none/)
  assert.match(service('converter-parser'), /network_mode: none/)
  assert.doesNotMatch(service('browser-worker'), /\n      browser-egress: \{\}/)
  assert.match(service('browser-worker'), /\n      browser-internal:\n/)
  assert.match(service('browser-egress'), /\n      browser-internal:\n[\s\S]*\n      browser-egress: \{\}/)
})

test('numai creatorul fiecărui socket are mount UDS writable', () => {
  const browserWorker = service('browser-worker')
  assert.doesNotMatch(mount(browserWorker, '/run/kelion-browser-api'), /read_only: true/)
  assert.match(mount(browserWorker, '/run/kelion-browser-egress'), /read_only: true/)

  const browserEgress = service('browser-egress')
  assert.doesNotMatch(mount(browserEgress, '/run/kelion-browser-egress'), /read_only: true/)

  const converterGateway = service('converter-gateway')
  assert.doesNotMatch(mount(converterGateway, '/run/kelion-converter-api'), /read_only: true/)
  assert.match(mount(converterGateway, '/run/kelion-converter-private'), /read_only: true/)

  const converterParser = service('converter-parser')
  assert.doesNotMatch(mount(converterParser, '/run/kelion-converter-private'), /read_only: true/)
})

test('browserul nu are rută directă de egress, iar proxy-ul este singura punte', () => {
  const internalNetwork = /^  browser-internal:\n([\s\S]*?)(?=^  [a-z][a-z0-9-]*:|\Z)/m.exec(compose)?.[1] ?? ''
  assert.match(internalNetwork, /\n    internal: true\n/)
  assert.doesNotMatch(service('browser-worker'), /\n      browser-egress: \{\}/)
  assert.match(service('browser-egress'), /\n      browser-egress: \{\}/)
  assert.doesNotMatch(compose, /network_mode: host/)
})

test('CI inițializează starea release deținută de root prin sudo', () => {
  assert.match(
    prVerify,
    /sudo install -d -o root -g 10050 -m 2770[\s\S]*?\/tmp\/kelion-ci-runtime\/release-state/,
  )
  assert.match(
    prVerify,
    /printf '%s\\n' inactive \| sudo tee \/tmp\/kelion-ci-runtime\/release-state\/active >\/dev\/null/,
  )
  assert.doesNotMatch(
    prVerify,
    /printf '%s\\n' inactive > \/tmp\/kelion-ci-runtime\/release-state\/active/,
  )
})
