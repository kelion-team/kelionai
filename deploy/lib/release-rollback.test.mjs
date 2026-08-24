import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8')
const backend = readFileSync(new URL('../../backend/src/index.ts', import.meta.url), 'utf8')

function body(name) {
  const match = new RegExp(`${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`, 'm').exec(deploy)
  assert.ok(match, `funcția ${name} lipsește`)
  return match[1]
}

test('slotul dezactivat folosește oprirea care termină procesul', () => {
  assert.match(backend, /shutdownDeactivatedRelease\(\(\) => app\.close\(\)\)/)
  assert.doesNotMatch(backend, /app\.close\(\)\.finally\(\(\) => \{ process\.exitCode = 0 \}\)/)
})

test('rollback-ul repornește slotul vechi și validează JSON readiness înainte de upstream', () => {
  const restart = body('restart_previous_slot')
  const rollback = body('rollback_switch')

  assert.match(restart, /docker start "\$\{containers\[@\]\}"/)
  assert.match(restart, /\.ready == true and \.release\.sideEffectsActive == true/)
  assert.match(restart, /http:\/\/127\.0\.0\.1:\$active_bind_port\/readyz/)

  const restartIndex = rollback.indexOf('restart_previous_slot')
  const upstreamIndex = rollback.indexOf('mv "$temporary" "$UPSTREAM_FILE"')
  assert.ok(restartIndex >= 0 && upstreamIndex > restartIndex)
  assert.match(rollback, /caddy validate[\s\S]*caddy reload/)
})
