import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8')
function workflowFunction(path, name) {
  const source = read(path).replace(/^ {10}/gm, '')
  const start = source.indexOf(name + '() {')
  const end = source.indexOf('\n}', start)
  assert.ok(start >= 0 && end > start, name)
  return source.slice(start, end + 2)
}

function probe(operation, scenario) {
  const name = operation === 'configure' ? 'restore_configure_recovery_and_controller' : 'validate_constructor_vector'
  const source = workflowFunction('.github/workflows/' + (operation === 'configure' ? 'vps-run.yml' : 'vps-recovery.yml'), name)
  return spawnSync('bash', ['--noprofile', '--norc', '-c', `
set -euo pipefail
PATH=/no-host-executables
scenario=$1
ready_stamp=/synthetic/ready
reactivation_journal=/synthetic/reactivation
controller_socket=/synthetic/socket
helper=/synthetic/cutover
declare -A active=() enabled=()
for unit in kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer; do
  active[$unit]=active; enabled[$unit]=enabled
done
case "$scenario" in
  paused|helper-failed|helper-malformed|worker-disabled|publisher-stopped|release-stopped) active[kelion-codex-worker.timer]=inactive ;;
  unpaused-stopped) active[kelion-codex-worker.timer]=inactive ;;
esac
[ "$scenario" != worker-disabled ] || enabled[kelion-codex-worker.timer]=disabled
[ "$scenario" != publisher-stopped ] || active[kelion-constructor-publisher.timer]=inactive
[ "$scenario" != release-stopped ] || active[kelion-constructor-release.timer]=inactive
systemctl() {
  local unit=\${@: -1}
  case "$1" in
    reset-failed|start|restart) return 0 ;;
    is-enabled) builtin [ "\${enabled[$unit]:-disabled}" = enabled ] ;;
    is-active)
      if [[ "$unit" = private-ai-* ]]; then return 1; fi
      builtin [ "\${active[$unit]:-active}" = active ] ;;
    show)
      unit=$2
      if [[ "$unit" = private-ai-* ]]; then printf 'inactive\\n'
      else printf '%s\\n' "\${active[$unit]:-active}"; fi ;;
    *) return 91 ;;
  esac
}
[() {
  case "$1:\${2:-}" in
    -L:*) return 1 ;;
    -e:/synthetic/reactivation|-e:/var/lib/kelion-codex-auth|-e:/opt/kelion-codex/profile-home) return 1 ;;
    -f:*|-e:/etc/kelion/*.enabled|-x:*|-S:*) return 0 ;;
    *) builtin [ "$@" ;;
  esac
}
stat() { if [[ "\${@: -1}" = *constructor-model-control.mjs ]]; then printf '0:0:555:1\\n'; else printf '0:0:444:1\\n'; fi; }
flock() { return 0; }
probe_configured_model_controller() { return 0; }
pauseState() {
  case "$scenario" in
    helper-failed) return 1 ;;
    helper-malformed) printf 'unknown\\n' ;;
    active|unpaused-stopped) printf 'unpaused\\n' ;;
    *) printf 'paused\\n' ;;
  esac
}
function /synthetic/cutover { builtin [ "$1" = --worker-pause-state ] || return 93; pauseState; }
function /root/kelion/bin/runtime-config-cutover.sh { builtin [ "$1" = --worker-pause-state ] || return 93; pauseState; }
function /usr/bin/node { return 0; }
${source}
${name}
printf 'worker=%s publisher=%s release=%s\\n' "\${active[kelion-codex-worker.timer]}" "\${active[kelion-constructor-publisher.timer]}" "\${active[kelion-constructor-release.timer]}"
`, 'workflow-pause', scenario], { encoding: 'utf8', timeout: 5000 })
}

for (const operation of ['configure', 'recovery']) {
  for (const scenario of ['paused', 'active']) {
    test(operation + ': accepts the measured ' + scenario + ' vector without activating worker', () => {
      const result = probe(operation, scenario)
      assert.equal(result.status, 0, result.stderr + result.stdout)
      assert.match(result.stdout, scenario === 'paused'
        ? /worker=inactive publisher=active release=active/
        : /worker=active publisher=active release=active/)
    })
  }
  for (const scenario of ['helper-failed', 'helper-malformed', 'worker-disabled', 'publisher-stopped', 'release-stopped', 'unpaused-stopped', 'paused-active']) {
    test(operation + ': rejects ' + scenario + ' rather than treating it as a pause', () => {
      const result = probe(operation, scenario)
      assert.notEqual(result.status, 0, result.stdout)
    })
  }
}
