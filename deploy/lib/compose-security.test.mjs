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

test('tmpfs-urile writable aparțin utilizatorului non-root al serviciului', () => {
  for (const [name, uid] of [
    ['app', '1000'],
    ['browser-worker', '1001'],
    ['browser-egress', '1000'],
    ['converter-gateway', '1000'],
    ['converter-parser', '10001'],
  ]) {
    const block = service(name)
    const tmpfs = /\n    tmpfs:\n([\s\S]*?)(?=\n    [a-z_])/m.exec(block)?.[1] ?? ''
    assert.match(tmpfs, new RegExp(`uid=${uid},gid=${uid}`), `${name} nu deține tmpfs-ul writable`)
    assert.doesNotMatch(tmpfs, /mode=(?:0700|1770)(?![^\n]*uid=)/, `${name} are tmpfs root-only`)
  }
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
  assert.match(
    prVerify,
    /sudo find \/tmp\/kelion-ci-secrets -mindepth 1 -maxdepth 1 -type f -exec chown root:10050 \{\} \+ -exec chmod 0440 \{\} \+/,
  )
  assert.doesNotMatch(prVerify, /sudo chmod 0440 \/tmp\/kelion-ci-secrets\/\*/)
  assert.match(prVerify, /sudo chmod 0644 \/tmp\/kelion-ci-config\/runtime\.env/)
  assert.match(prVerify, /postgres_ready_streak=0/)
  assert.match(prVerify, /\[ "\$postgres_ready_streak" -ge 3 \]/)
  assert.doesNotMatch(
    prVerify,
    /pg_isready[^\n]+&& break/,
    'serverul temporar initdb nu trebuie confundat cu readiness stabil',
  )
  assert.match(
    prVerify,
    /docker exec kelion-ci-postgres pg_dump[^\n]+--format=custom \\\n\s*> \/tmp\/kelion-ci-postgres\/backup\/pre-migration\.dump/,
  )
  assert.doesNotMatch(prVerify, /docker cp kelion-ci-postgres:\/tmp\/pre-migration\.dump/)
})
