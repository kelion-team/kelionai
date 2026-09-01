import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const workflow = await readFile(
  new URL('../.github/workflows/vps-recovery.yml', import.meta.url),
  'utf8',
)

function section(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle)
  const end = source.indexOf(endNeedle, start + startNeedle.length)
  assert.ok(start >= 0, `lipsește secțiunea ${startNeedle}`)
  assert.ok(end > start, `lipsește terminatorul ${endNeedle}`)
  return source.slice(start, end)
}

test('recovery-ul generic revine ready și declară OK numai după controllerul și socketul exacte', () => {
  const generic = section(workflow, '      - name: Recovery generic pe VPS', '          REMOTE')
  assert.doesNotMatch(generic, /--leave-constructor-quiesced/)

  const lockedRecheck = generic.lastIndexOf('if defer_for_destructive_journal; then')
  const helper = generic.indexOf(
    'KELION_CUTOVER_LOCK_HELD=1 /root/kelion/bin/runtime-config-cutover.sh',
    lockedRecheck,
  )
  const closeFd = generic.indexOf('exec 9<&-', helper)
  const rearm = generic.indexOf('rearm_runtime_recovery_after_unlock', closeFd)
  const postcondition = generic.indexOf('validate_runtime_control_plane', rearm)
  const ok = generic.indexOf('echo RECOVERY_OK', postcondition)
  assert.ok(lockedRecheck >= 0 && helper > lockedRecheck && closeFd > helper && rearm > closeFd
    && postcondition > rearm && ok > postcondition,
  'OK trebuie să urmeze helperul no-leave, închiderea FD9, rearmarea și postcondiția control-plane')
  assert.equal((generic.match(/echo RECOVERY_OK/g) ?? []).length, 1)

  const controlPlane = section(
    generic,
    'validate_runtime_control_plane() {',
    '          KELION_CUTOVER_LOCK_HELD=1',
  )
  assert.match(controlPlane,
    /kelion-runtime-config-recovery\.service[\s\S]*systemctl show "\$recovery_unit" --property=ActiveState --value[\s\S]*\[ "\$state" = active \]/)
  assert.match(controlPlane,
    /kelion-constructor-model-control\.service[\s\S]*systemctl show "\$controller_unit" --property=ActiveState --value[\s\S]*\[ "\$state" = active \]/)
  assert.match(controlPlane,
    /controller_socket=\/run\/kelion-constructor-model-control\/control\.sock[\s\S]*\[ -S "\$controller_socket" \] && \[ ! -L "\$controller_socket" \][\s\S]*stat -Lc '%u:%g:%a'[\s\S]*0:10050:660/)
  assert.doesNotMatch(generic.slice(helper, ok), /\|\|\s*(?:true|:)/)
})

test('recovery failed sau inactive este rearmat numai după închiderea FD9', () => {
  const generic = section(workflow, '      - name: Recovery generic pe VPS', '          REMOTE')
  const rearmFunction = section(
    generic,
    'rearm_runtime_recovery_after_unlock() {',
    '          KELION_CUTOVER_LOCK_HELD=1',
  ).trim()

  for (const initialState of ['failed', 'inactive']) {
    const result = spawnSync('bash', ['-c', `
set -euo pipefail
current_state=$1
calls=''
systemctl() {
  local operation=$1
  shift
  case "$operation" in
    show) printf '%s\\n' "$current_state" ;;
    reset-failed) calls="\${calls}reset-failed," ;;
    start) calls="\${calls}start,"; current_state=active ;;
    *) return 1 ;;
  esac
}
exec 9</dev/null
exec 9<&-
${rearmFunction}
rearm_runtime_recovery_after_unlock
printf '%s|%s\\n' "$calls" "$current_state"
`, 'rearm-test', initialState], { encoding: 'utf8' })
    assert.equal(result.status, 0, `${initialState}: ${result.stderr}`)
    assert.equal(result.stdout, 'reset-failed,start,|active\n')
  }

  const lockHeld = spawnSync('bash', ['-c', `
set -euo pipefail
systemctl() { echo 'systemctl nu trebuie apelat' >&2; return 99; }
exec 9</dev/null
${rearmFunction}
rearm_runtime_recovery_after_unlock
`], { encoding: 'utf8' })
  assert.notEqual(lockHeld.status, 0)
  assert.match(lockHeld.stderr, /FD9 este încă deschis înaintea rearmării recovery/)
  assert.doesNotMatch(lockHeld.stderr, /systemctl nu trebuie apelat/)
})

test('jurnalul exterior valid defer-ează explicit quiesced, iar ambiguitatea eșuează închis', () => {
  const generic = section(workflow, '      - name: Recovery generic pe VPS', '          REMOTE')
  const validator = section(
    generic,
    'defer_for_destructive_journal() {',
    '          publication_lock=/root/kelion/publicare.lock',
  )
  const malformed = validator.indexOf('RECOVERY_INVALID: jurnalul distructiv este malformat')
  const deferred = validator.indexOf('RECOVERY_DEFERRED_QUIESCED:')
  const firstExit = validator.indexOf('exit 0', deferred)
  assert.ok(malformed >= 0 && deferred > malformed && firstExit > deferred,
    'numai jurnalul autentificat poate ajunge la rezultatul deferred')
  assert.match(validator, /RECOVERY_DEFERRED_QUIESCED:[^\n]*nu declară succes/)
  assert.doesNotMatch(validator.slice(0, firstExit), /RECOVERY_OK/)
  assert.match(validator, /RECOVERY_INVALID: jurnalul distructiv are ACL sau tip nesigur[^\n]*exit 1/)
  assert.match(validator, /RECOVERY_INVALID: jurnalul distructiv este malformat[^\n]*exit 1/)
})

test('poststarea incidentului, inclusiv already-complete, dovedește control-plane-ul activ', () => {
  const incident = section(
    workflow,
    '      - name: Recuperează exact incidentul gate-prepared aadb',
    '      - name: Recovery generic pe VPS',
  )
  const controlPlane = section(
    incident,
    'validate_runtime_control_plane() {',
    '          validate_complete_poststate() {',
  )
  assert.match(controlPlane,
    /systemctl show "\$recovery_unit" --property=ActiveState --value\)" = active/)
  assert.match(controlPlane,
    /systemctl show "\$controller_unit" --property=ActiveState --value\)" = active/)
  assert.match(controlPlane,
    /\[ -S "\$controller_socket" \][\s\S]*\[ ! -L "\$controller_socket" \][\s\S]*stat -Lc '%u:%g:%a'[\s\S]*0:10050:660/)

  const complete = section(
    incident,
    'validate_complete_poststate() {',
    '          emit_complete_receipt() {',
  )
  assert.match(complete,
    /validate_rejected_journals_absent/)
  assert.match(incident,
    /"\$runtime\/constructor-reactivation\.journal"[\s\S]*\[ ! -e "\$rejected" \][\s\S]*\[ ! -L "\$rejected" \]/)
  assert.match(complete, /validate_constructor_vector\s+validate_runtime_control_plane\s*$/m)

  const alreadyComplete = section(
    incident,
    'if [ ! -e "$outer" ] && [ ! -L "$outer" ]; then',
    '          [ -f "$outer" ]',
  )
  assert.match(alreadyComplete,
    /phase=already-complete-proof[\s\S]*validate_complete_poststate[\s\S]*sync -f "\$runtime"[\s\S]*validate_complete_poststate[\s\S]*emit_complete_receipt already-complete/)
  assert.match(incident,
    /reactivation_journal:"absent",runtime_ready:true,[\s\S]*runtime_recovery:"active",model_control:"active",[\s\S]*model_control_socket:"root:10050:660"/)
})
