import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const workflow = readFileSync(new URL('../../.github/workflows/vps-run.yml', import.meta.url), 'utf8')
const start = workflow.indexOf('          cleanup_remote() {')
const end = workflow.indexOf('\n          trap cleanup_remote EXIT', start)
assert.ok(start >= 0 && end > start, 'canonical upgrade cleanup must exist')
const cleanup = workflow.slice(start, end).replace(/^ {10}/gm, '')
const bash = process.platform === 'win32'
  ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe') : 'bash'

function run(mode, originalStatus = 0) {
  // No fixture needs a real host file. work is empty, rm and systemctl are shell
  // functions, and PATH contains no executables. A new external command cannot
  // accidentally mutate the test host or invoke a production helper.
  return spawnSync(bash, ['--noprofile', '--norc', '-c', `
set -u
PATH=/kelion-test-no-executables
mode=$1
original_status=$2
bundle=synthetic-bundle
work=''
cleanup_unit=kelion-constructor-upgrade-bundle-cleanup-1-1
timer_absent=0
service_absent=0
if [ "$mode" = absent ]; then timer_absent=1; service_absent=1; fi
rm() { [ "$mode" != removal-failure ]; }
systemctl() {
  local operation=$1 unit= suffix= property= absent=0
  case "$operation" in
    stop|reset-failed|show) unit=$2 ;;
    list-jobs) unit=$4 ;;
    *) return 97 ;;
  esac
  suffix=\${unit##*.}
  case "$suffix" in timer) absent=$timer_absent ;; service) absent=$service_absent ;; *) return 98 ;; esac
  case "$operation" in
    stop)
      if [ "$mode:$suffix" = stop-failure:timer ]; then return 1; fi
      if [ "$mode" = absent ] || [ "$absent" = 1 ]; then return 5; fi
      if [ "$mode" = disappear ]; then timer_absent=1; service_absent=1; fi
      return 0 ;;
    reset-failed)
      [ "$mode" != reset-failure ] && [ "$absent" = 0 ] ;;
    show)
      [ "$mode" != query-failure ] || return 1
      property=$3
      case "$property" in
        --property=LoadState) if [ "$absent" = 1 ]; then printf 'not-found\\n'; else printf 'loaded\\n'; fi ;;
        --property=ActiveState) if [ "$mode:$suffix" = stop-failure:timer ]; then printf 'active\\n'; else printf 'inactive\\n'; fi ;;
        *) return 96 ;;
      esac ;;
    list-jobs) if [ "$mode" = jobs-remain ]; then printf '1 synthetic waiting\\n'; fi ;;
  esac
}
${cleanup}
trap cleanup_remote EXIT
exit "$original_status"
`, 'cleanup-fixture', mode, String(originalStatus)], { encoding: 'utf8', timeout: 10_000 })
}

test('upgrade cleanup accepts already absent transient units and collection during stop', () => {
  for (const mode of ['absent', 'disappear', 'inactive']) {
    const result = run(mode)
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
    assert.equal(result.stderr, '')
  }
})

test('upgrade cleanup preserves real stop, reset, query, pending-job and removal failures', () => {
  const cases = [
    ['stop-failure', 'timer-stop'], ['reset-failure', 'service-reset-failed'],
    ['query-failure', 'timer-query'], ['jobs-remain', 'timer-jobs'],
    ['removal-failure', 'bundle-removal'],
  ]
  for (const [mode, component] of cases) {
    const result = run(mode)
    assert.equal(result.status, 1, mode)
    const diagnostics = result.stderr.trim().split('\n').map((line) => JSON.parse(line))
    assert.ok(diagnostics.some((item) => item.ok === false
      && item.event === 'constructor_upgrade_cleanup_failure' && item.component === component), mode)
    assert.ok(diagnostics.every((item) => Object.keys(item).sort().join(',') === 'component,event,ok'))
  }
})

test('upgrade cleanup never turns the original failure into success or replaces its exit code', () => {
  for (const mode of ['absent', 'removal-failure']) assert.equal(run(mode, 23).status, 23, mode)
})
