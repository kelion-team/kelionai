import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const source = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8')
const extract = (name) => {
  const start = source.indexOf(`${name}() {`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, name)
  return source.slice(start, end + 2)
}
const proof = extract('constructor_recovery_unit_postproof')
const bash = process.platform === 'win32'
  ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git', 'bin', 'bash.exe') : 'bash'

function run(mode, restore = false, legacy = false) {
  // All external operations are replaced by shell functions. PATH is empty of
  // executables; neither a real host file nor a service can be read or changed.
  return spawnSync(bash, ['--noprofile', '--norc', '-c', `
set -u
PATH=/kelion-test-no-executables
mode=$1
SYSTEMD_UNIT_ROOT=/synthetic/units
BUNDLE_DIR=/synthetic/bundle
stat() {
  [ "$mode" != stat-error ] || return 1
  if [ "$3" = /run/kelion-constructor-model-control/control.sock ]; then printf '0:10050:660\\n'; return; fi
  case "$mode" in
    symlink) printf 'symbolic link:0:0:444:1\\n' ;;
    writable) printf 'regular file:0:0:644:1\\n' ;;
    foreign-owner) printf 'regular file:1000:0:444:1\\n' ;;
    hardlink) printf 'regular file:0:0:444:2\\n' ;;
    *) printf 'regular file:0:0:444:1\\n' ;;
  esac
}
cmp() { [ "$mode" != wrong-bytes ]; }
systemctl() {
  local property value
  case "$1" in
    show)
      [ "$2" = kelion-runtime-config-recovery.service ] && [ "$4" = --value ] || return 97
      property=\${3#--property=}
      [ "$mode" != "query-error:$property" ] || return 1
      case "$property" in
        FragmentPath) value=/synthetic/units/kelion-runtime-config-recovery.service ;;
        DropInPaths) value= ;;
        LoadState) value=loaded ;;
        NeedDaemonReload) value=no ;;
        UnitFileState) value=enabled ;;
        Type) value=oneshot ;;
        RemainAfterExit) value=yes ;;
        Result) value=success ;;
        ExecMainStatus|MainPID) value=0 ;;
        ActiveState) if [ "$mode" = inactive ]; then value=inactive; else value=active; fi ;;
        SubState) if [ "$mode" = inactive ]; then value=dead; else value=exited; fi ;;
        *) return 98 ;;
      esac
      if [ "$mode" = "wrong:$property" ]; then value=unexpected; fi
      if [[ "$mode" = state:* ]]; then
        local pair=\${mode#state:}
        if [ "$property" = ActiveState ]; then value=\${pair%%:*}; fi
        if [ "$property" = SubState ]; then value=\${pair#*:}; fi
      fi
      printf '%s\\n' "$value" ;;
    list-jobs)
      [ "$mode" != jobs-error ] || return 1
      if [ "$mode" = jobs-pending ]; then printf '1 synthetic waiting\\n'; fi ;;
    daemon-reload) return 0 ;;
    is-active)
      if [ "$3" = kelion-runtime-config-recovery.service ]; then [ "$mode" != inactive ];
      elif [ "$3" = kelion-constructor-model-control.service ]; then [ "$mode" != controller-failed ];
      elif [ "$3" = synthetic.timer ]; then [ "$mode" != timer-inactive ]; else return 96; fi ;;
    is-enabled) [ "$3" = synthetic.timer ] && [ "$mode" != timer-disabled ] ;;
    *) printf 'unexpected mutation: %s\\n' "$1" >&2; return 99 ;;
  esac
}
${proof}
${restore ? `
ROOT=/synthetic
constructor_release_quiesced=1
constructor_release_timers=(synthetic.timer)
constructor_release_markers=(/synthetic/marker)
KELION_RELEASE_REQUEST_ID=synthetic-request
COMMIT_SHA=synthetic-commit
helper_calls=0
constructor_deploy_quiesce_restore_proof() { return 0; }
quiesce_constructor_after_failed_reactivation_proof() { return 0; }
function /synthetic/bin/runtime-config-cutover.sh {
  helper_calls=$((helper_calls + 1))
  [ "$KELION_CUTOVER_LOCK_HELD" = 1 ] && [ "$KELION_DEPLOY_QUIESCE_PROOF" = 1 ] || return 99
  [ "$mode" != helper-failed ]
}
[() {
  case "$1:$2" in
    -S:/run/kelion-constructor-model-control/control.sock) builtin [ "$mode" != socket-absent ] ;;
    -L:/run/kelion-constructor-model-control/control.sock) return 1 ;;
    -f:/synthetic/marker) return 0 ;;
    *) builtin [ "$@" ;;
  esac
}
${legacy ? extract('restore_constructor_after_release').replace('constructor_recovery_unit_postproof || failed=1', 'systemctl is-active --quiet kelion-runtime-config-recovery.service || failed=1') : extract('restore_constructor_after_release')}
exec 8>&2
restore_constructor_after_release
status=$?
printf 'helper_calls=%s quiesced=%s\\n' "$helper_calls" "$constructor_release_quiesced"
exit "$status"
` : 'constructor_recovery_unit_postproof'}
`, 'recovery-postproof', mode], { encoding: 'utf8', timeout: 5_000 })
}

test('recovery postproof accepts successful active oneshot and successful stopped wrapper', () => {
  for (const mode of ['active', 'inactive']) {
    const result = run(mode)
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
    assert.equal(result.stderr, '')
  }
})

test('recovery postproof rejects wrong metadata, bytes, pending work and every failed state query', () => {
  const properties = ['FragmentPath', 'DropInPaths', 'LoadState', 'NeedDaemonReload',
    'UnitFileState', 'Type', 'RemainAfterExit', 'Result', 'ExecMainStatus', 'MainPID', 'ActiveState', 'SubState']
  const modes = ['stat-error', 'symlink', 'writable', 'foreign-owner', 'hardlink', 'wrong-bytes',
    'jobs-error', 'jobs-pending', 'state:failed:failed', 'state:activating:start', 'state:active:running',
    'state:deactivating:stop', 'state:active:dead', 'state:inactive:exited',
    ...properties.flatMap((property) => [`wrong:${property}`, `query-error:${property}`])]
  for (const mode of modes) {
    const result = run(mode)
    assert.equal(result.status, 1, `${mode}: ${result.stderr}`)
    assert.equal(result.stderr, '')
  }
})

test('actual release restore accepts the stopped wrapper only after successful CLI and complete remaining proofs', () => {
  const before = run('inactive', true, true)
  assert.equal(before.status, 1, before.stderr)
  assert.equal(before.stdout, 'helper_calls=1 quiesced=1\n', 'the old liveness-only predicate rejects completed recovery')
  for (const mode of ['active', 'inactive']) {
    const result = run(mode, true)
    assert.equal(result.status, 0, `${mode}: ${result.stderr}`)
    assert.equal(result.stdout, 'helper_calls=1 quiesced=0\n')
  }
  for (const mode of ['helper-failed', 'wrong:Result', 'wrong-bytes', 'controller-failed',
    'socket-absent', 'timer-inactive', 'timer-disabled']) {
    const result = run(mode, true)
    assert.equal(result.status, 1, `${mode}: ${result.stderr}`)
    assert.equal(result.stdout, 'helper_calls=1 quiesced=1\n')
  }
})

test('recovery unit postproof follows successful CLI helper and never starts a unit under the lock', () => {
  for (const name of ['restore_constructor_after_release', 'reconcile_constructor_after_completed_release']) {
    const caller = extract(name)
    const helper = caller.indexOf('"$ROOT/bin/runtime-config-cutover.sh"')
    const failureGuard = caller.indexOf('if [ "$failed" = 0 ]; then', helper)
    const postproof = caller.indexOf('constructor_recovery_unit_postproof || failed=1', failureGuard)
    assert.ok(helper >= 0 && failureGuard > helper && postproof > failureGuard, name)
    assert.match(caller.slice(0, helper), /exec 9>&8[\s\S]*KELION_CUTOVER_LOCK_HELD=1/)
    assert.match(caller, /compose\.production\.yml"[^\n]*(?:\\\n\s*)?\|\| failed=1/)
    assert.match(caller, /systemctl is-enabled --quiet "\$timer"[\s\S]*systemctl is-active --quiet "\$timer"/)
    assert.doesNotMatch(caller, /systemctl (?:start|restart)|flock\s+-u|exec 8>&-/)
  }
  assert.doesNotMatch(proof, /systemctl (?:start|restart|reset-failed)|flock\s+-u/)
  const restore = extract('restore_constructor_after_release')
  assert.match(restore, /constructor_recovery_unit_postproof[\s\S]*systemctl is-active --quiet kelion-constructor-model-control\.service[\s\S]*control\.sock[\s\S]*0:10050:660/)
})
