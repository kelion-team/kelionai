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

test('rollback-ul legacy verifică procesele și trei probe locale înainte de proxy', () => {
  const restart = body('restart_legacy_runtime')
  const rollback = body('rollback_switch')

  assert.match(restart, /docker start "\$\{legacy_runtime_running\[@\]\}"[^\n]*\|\| return 1/)
  assert.doesNotMatch(restart, /docker start[^\n]*\|\| true/)
  assert.match(restart, /docker inspect -f '\{\{\.State\.Running\}\}' "\$legacy"/)
  assert.match(restart, /\[ "\$legacy_state" = true \] \|\| return 1/)
  assert.match(restart, /http:\/\/127\.0\.0\.1:8080\/livez/)
  assert.match(restart, /http:\/\/127\.0\.0\.1:8080\/readyz/)
  assert.match(restart, /consecutive=\$\(\(consecutive \+ 1\)\)[\s\S]*\[ "\$consecutive" -lt 3 \] \|\| return 0/)

  const readinessIndex = rollback.indexOf('restart_legacy_runtime')
  const upstreamIndex = rollback.indexOf('mv "$temporary" "$UPSTREAM_FILE"')
  const caddyIndex = rollback.indexOf('docker start kelion-caddy')
  assert.ok(readinessIndex >= 0 && upstreamIndex > readinessIndex && caddyIndex > readinessIndex)
})

test('stackul legacy complet este doar oprit după smoke și rămâne recuperabil', () => {
  assert.match(
    deploy,
    /LEGACY_RUNTIME_CONTAINERS=\(kelionai-app omniroute kelionai-coqui\)/,
  )
  const smokeIndex = deploy.indexOf("[ \"$public_ok\" = 1 ] || die 'smoke-ul public")
  const stopIndex = deploy.indexOf('docker stop --time 30 "${legacy_runtime_running[@]}"')
  assert.ok(smokeIndex >= 0 && stopIndex > smokeIndex)
  const legacyStopTail = deploy.slice(stopIndex, deploy.indexOf('\nfi', stopIndex))
  assert.doesNotMatch(legacyStopTail, /docker stop[^\n]*\|\| true/)
  assert.match(legacyStopTail, /docker inspect -f '\{\{\.State\.Running\}\}' "\$legacy"/)
  assert.match(legacyStopTail, /\[ "\$legacy_running" = false \][\s\\]*\n[\s\\]*\|\| die/)
  assert.doesNotMatch(deploy, /docker\s+rm[^\n]*(?:kelionai-app|omniroute|kelionai-coqui)/)
  assert.doesNotMatch(deploy, /docker\s+(?:image|volume)\s+rm[^\n]*(?:kelionai-app|omniroute|kelionai-coqui)/)

  const rollback = body('rollback_switch')
  assert.match(rollback, /restart_legacy_runtime/)
})

test('slotul managed anterior este oprit printr-un case valid și fail-closed', () => {
  assert.match(deploy, /case "\$active_slot" in\s+blue\|green\)/)
  assert.match(deploy, /\*\)\s+die "slot activ necunoscut: \$active_slot"/)
  assert.doesNotMatch(deploy, /\[ "\$active_slot" = blue \|\|/)
})
