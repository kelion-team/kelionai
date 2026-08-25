import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const deploy = readFileSync(new URL('../deploy.sh', import.meta.url), 'utf8')
const backend = readFileSync(new URL('../../backend/src/index.ts', import.meta.url), 'utf8')
const prVerify = readFileSync(new URL('../../.github/workflows/pr-verify.yml', import.meta.url), 'utf8')
const bashExecutable = process.platform === 'win32'
  ? `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`
  : 'bash'
const bashAvailable = spawnSync(bashExecutable, ['--version'], { encoding: 'utf8' }).status === 0

function body(name) {
  const match = new RegExp(`${name}\\(\\) \\{([\\s\\S]*?)\\n\\}`, 'm').exec(deploy)
  assert.ok(match, `funcția ${name} lipsește`)
  return match[1]
}

function ordered(source, labels) {
  let previous = -1
  for (const [label, fragment] of labels) {
    const index = source.indexOf(fragment)
    assert.ok(index >= 0, `${label} lipsește`)
    assert.ok(index > previous, `${label} este în afara ordinii fail-closed`)
    previous = index
  }
}

test('slotul dezactivat folosește oprirea care termină procesul', () => {
  assert.match(backend, /shutdownDeactivatedRelease\(\(\) => app\.close\(\)\)/)
  assert.doesNotMatch(backend, /app\.close\(\)\.finally\(\(\) => \{ process\.exitCode = 0 \}\)/)
})

test('rollback-ul managed validează DB și JSON readiness înainte de upstream', () => {
  const restart = body('restart_previous_slot')
  const rollback = body('rollback_switch')
  const proxy = body('restore_proxy_after_rollback')

  assert.match(restart, /ensure_containers_running "\$\{active_runtime_containers\[@\]\}"/)
  assert.match(restart, /destructive_migration_attempted[\s\S]*database_restore_verified/)
  assert.match(restart, /verify_database_contract \|\| return 1/)
  assert.match(restart, /\.ready == true and \.release\.sideEffectsActive == true/)
  assert.match(restart, /http:\/\/127\.0\.0\.1:\$active_bind_port\/readyz/)
  assert.match(deploy, /managed_version_payload=\$\(curl[\s\S]*\/api\/version[\s\S]*previous_version_before=/)

  ordered(rollback, [
    ['oprirea candidatului', 'stop_candidate_runtime'],
    ['restaurarea DB', 'restore_database_if_required'],
    ['repornirea slotului', 'restart_previous_slot'],
    ['restaurarea proxy-ului', 'restore_proxy_after_rollback'],
  ])
  assert.match(proxy, /restore_upstream_snapshot[\s\S]*caddy validate[\s\S]*caddy reload[\s\S]*verify_public_previous_version/)
})

test('rollback-ul legacy folosește JSON-ul de versiune, nu fallback-ul SPA', () => {
  const restart = body('restart_legacy_runtime')
  const rollback = body('rollback_switch')
  const proxy = body('restore_proxy_after_rollback')

  assert.match(restart, /ensure_containers_running "\$\{legacy_runtime_running\[@\]\}"[^\n]*\|\| return 1/)
  assert.match(restart, /http:\/\/127\.0\.0\.1:8080\/api\/version/)
  assert.match(restart, /--arg expected "\$legacy_version_before"/)
  assert.match(restart, /\.v == \$expected/)
  assert.doesNotMatch(restart, /127\.0\.0\.1:8080\/(?:livez|readyz)/)
  assert.match(restart, /consecutive=\$\(\(consecutive \+ 1\)\)[\s\S]*\[ "\$consecutive" -ge 3 \]/)

  ordered(rollback, [
    ['restaurarea DB', 'restore_database_if_required'],
    ['repornirea legacy', 'restart_legacy_runtime'],
    ['restaurarea proxy-ului', 'restore_proxy_after_rollback'],
  ])
  assert.match(proxy, /ensure_containers_running kelion-caddy[\s\S]*\.State\.Running/)
  assert.match(proxy, /\.State\.Running[\s\S]*verify_public_previous_version/)
})

test('starea recuperabilă este capturată înainte de orice mutație DB', () => {
  const plan = deploy.indexOf('migration_plan=$(run_migrator')
  const captureUpstream = deploy.indexOf('old_upstream=$(cat "$UPSTREAM_FILE")')
  const captureMarker = deploy.indexOf('old_marker=$(sed -n')
  const captureContainers = deploy.indexOf('active_runtime_containers=()')
  const captureLegacyVersion = deploy.indexOf('legacy_version_payload=$(curl')
  const captureCaddyfile = deploy.indexOf('previous_caddyfile_snapshot=$(mktemp')
  const backup = deploy.indexOf('\n"$PERSISTENT_BACKUP_SCRIPT"\n')
  const mutation = deploy.indexOf('migration_output=$(docker run')

  assert.ok(plan >= 0 && captureUpstream > plan)
  for (const [label, index] of [
    ['upstreamul', captureUpstream],
    ['markerul', captureMarker],
    ['containerele', captureContainers],
    ['versiunea legacy', captureLegacyVersion],
    ['Caddyfile-ul', captureCaddyfile],
  ]) {
    assert.ok(index >= 0 && index < backup && index < mutation, `${label} nu este capturat la timp`)
  }
})

test('Caddyfile-ul live și ACL-ul sunt restaurate atomic înainte de reload', () => {
  const restore = body('restore_caddyfile_snapshot')
  const proxy = body('restore_proxy_after_rollback')

  assert.match(deploy, /stat -c '%u:%g:%a' "\$LIVE_CADDYFILE"[\s\S]*'0:0:644'/)
  assert.match(deploy, /install -o root -g root -m 0600 "\$LIVE_CADDYFILE" "\$previous_caddyfile_snapshot"/)
  assert.match(restore, /install -o root -g root -m 0644 "\$previous_caddyfile_snapshot" "\$temporary"/)
  assert.match(restore, /mv -f -- "\$temporary" "\$LIVE_CADDYFILE"/)
  assert.match(restore, /cmp -s "\$previous_caddyfile_snapshot" "\$LIVE_CADDYFILE"/)
  assert.ok(proxy.indexOf('restore_caddyfile_snapshot') < proxy.indexOf('caddy validate'))
  assert.match(deploy, /cmp -s "\$LIVE_CADDYFILE" "\$previous_caddyfile_snapshot"[\s\\]*\n[\s\S]*sync_recovery_path "\$previous_caddyfile_snapshot" file/)
})

test('rollback-ul restaurează inclusiv absența upstreamului managed la primul cutover', () => {
  const restore = body('restore_upstream_snapshot')
  const proxy = body('restore_proxy_after_rollback')

  assert.match(deploy, /old_upstream_present=0[\s\S]*old_upstream_present=1/)
  assert.match(restore, /if \[ "\$old_upstream_present" = 1 \]/)
  assert.match(restore, /mv -f -- "\$temporary" "\$UPSTREAM_FILE"/)
  assert.match(restore, /rm -f -- "\$UPSTREAM_FILE"/)
  assert.match(restore, /\[ ! -e "\$UPSTREAM_FILE" \] && \[ ! -L "\$UPSTREAM_FILE" \]/)
  assert.ok(proxy.indexOf('restore_upstream_snapshot') < proxy.indexOf('ensure_containers_running kelion-caddy'))
})

test('primul cutover consideră proxy-ul public real, chiar dacă upstreamul managed este stale', () => {
  const proxyDetection = deploy.slice(
    deploy.indexOf('managed_proxy_running=0'),
    deploy.indexOf('old_marker=$(sed -n'),
  )
  assert.match(proxyDetection, /case "\$managed_proxy_running:\$legacy_proxy_running" in/)
  assert.match(proxyDetection, /0:1\)[\s\S]*active_slot=legacy/)
  assert.match(proxyDetection, /Fișierul managed poate fi stale/)
  assert.match(proxyDetection, /\*\) die 'starea proxy-urilor publice este ambiguă/)
})

test('planul distructiv intră în maintenance, oprește writerii și abia apoi face backup și migrare', () => {
  const trap = deploy.indexOf('trap on_release_exit EXIT')
  const journal = deploy.indexOf('\n  write_recovery_journal maintenance 0 0\n', trap)
  const maintenance = deploy.indexOf('\n  enter_destructive_maintenance\n', journal)
  const stop = deploy.indexOf('\n  stop_active_runtime\n', maintenance)
  const stopStaleCandidate = deploy.indexOf('\n  stop_candidate_runtime\n', stop)
  const verifyMaintenance = deploy.indexOf('\n  verify_destructive_maintenance\n', stopStaleCandidate)
  const removeStaleProof = deploy.indexOf('\nrm -f -- "$PROOF_FILE"\n', verifyMaintenance)
  const backup = deploy.indexOf('\n"$PERSISTENT_BACKUP_SCRIPT"\n', removeStaleProof)
  const restorePreflight = deploy.indexOf('\n  preflight_database_restore\n', backup)
  const attempted = deploy.indexOf('\n    destructive_migration_attempted=1\n', restorePreflight)
  const restoreRequired = deploy.indexOf('\n    db_restore_required=1\n', attempted)
  const migrator = deploy.indexOf('migration_output=$(docker run', restoreRequired)
  const candidateUp = deploy.indexOf(' up -d --no-build', migrator)

  assert.ok(trap >= 0 && journal > trap)
  assert.ok(maintenance > journal && stop > maintenance && stopStaleCandidate > stop)
  assert.ok(verifyMaintenance > stopStaleCandidate)
  assert.ok(removeStaleProof > verifyMaintenance && backup > removeStaleProof)
  assert.ok(restorePreflight > backup && attempted > restorePreflight)
  assert.ok(restoreRequired > attempted && migrator > restoreRequired)
  assert.ok(candidateUp > migrator)

  const maintenanceBody = body('enter_destructive_maintenance')
  const legacyBranch = maintenanceBody.slice(
    maintenanceBody.indexOf('    legacy)'),
    maintenanceBody.indexOf('    *)'),
  )
  assert.match(legacyBranch, /kelion-caddy/)
  assert.match(legacyBranch, /legacy_proxy_running/)
  assert.doesNotMatch(legacyBranch, /docker (?:exec|start) kelion-proxy/)

  const verifyBody = body('verify_destructive_maintenance')
  assert.match(verifyBody, /--resolve "\$PUBLIC_APP_DOMAIN:443:127\.0\.0\.1"/)
  assert.match(verifyBody, /https:\/\/\$PUBLIC_APP_DOMAIN\/api\/version/)
  assert.match(verifyBody, /\[ "\$maintenance_status" = 502 \]/)
})

test('restore-ul este probat complet fără swap înainte de migrator', () => {
  const preflight = body('preflight_database_restore')
  const call = deploy.indexOf('\n  preflight_database_restore\n')
  const restoreRequired = deploy.indexOf('\n    db_restore_required=1\n', call)
  const migrator = deploy.indexOf('migration_output=$(docker run', restoreRequired)

  assert.match(preflight, /KELION_RESTORE_APPROVED=1 KELION_PUBLICATION_LOCK_HELD=1/)
  assert.match(preflight, /restore-verified-backup\.sh" --preflight "\$PROOF_FILE"/)
  assert.ok(call >= 0 && restoreRequired > call && migrator > restoreRequired)
})

test('migratorul primește numai copia exactă cu ACL minim a dovezii root-only', () => {
  const prepare = body('prepare_migration_proof_copy')
  const cleanup = body('cleanup_migration_proof_copy')
  const exitHandler = body('on_release_exit')
  const prepareCall = deploy.indexOf('\n    prepare_migration_proof_copy \\\n')
  const mountCopy = deploy.indexOf('-v "$migration_proof_copy:/run/proof/backup.json:ro"', prepareCall)
  const migrator = deploy.indexOf('migration_output=$(docker run', mountCopy)
  const cleanupCall = deploy.indexOf('\n    cleanup_migration_proof_copy \\\n', migrator)
  const confirmMigration = deploy.indexOf('[ "$migration_output" = migrations_ok ]', cleanupCall)

  assert.match(prepare, /\[ -f "\$PROOF_FILE" \] && \[ ! -L "\$PROOF_FILE" \]/)
  assert.match(prepare, /stat -Lc '%u:%g:%a:%h' "\$PROOF_FILE"[\s\S]*'0:0:600:1'/)
  assert.match(prepare, /mktemp "\$RUNTIME_ROOT\/migration-backup-proof\.XXXXXX"/)
  assert.match(prepare, /install -o root -g 10050 -m 0440 "\$PROOF_FILE" "\$migration_proof_copy"/)
  assert.match(prepare, /\[ ! -f "\$migration_proof_copy" \] \|\| \[ -L "\$migration_proof_copy" \]/)
  assert.match(prepare, /stat -Lc '%u:%g:%a:%h' "\$migration_proof_copy"[\s\S]*'0:10050:440:1'/)
  assert.match(prepare, /cmp -s -- "\$PROOF_FILE" "\$migration_proof_copy"/)
  assert.doesNotMatch(prepare, /(?:chown|chmod)[^\n]*"\$PROOF_FILE"/)
  assert.match(cleanup, /"\$RUNTIME_ROOT"\/migration-backup-proof\.\*/)
  assert.match(cleanup, /rm -f -- "\$candidate"/)
  assert.match(exitHandler, /cleanup_migration_proof_copy/)
  assert.ok(exitHandler.indexOf('cleanup_migration_proof_copy') < exitHandler.indexOf('rollback_switch'))
  assert.doesNotMatch(deploy, /-v "\$PROOF_FILE:\/run\/proof\/backup\.json:ro"/)
  assert.ok(prepareCall >= 0 && mountCopy > prepareCall)
  assert.ok(migrator > mountCopy && cleanupCall > migrator && confirmMigration > cleanupCall)
})

test('CI reproduce ACL-ul canonic și copia montată din release', () => {
  const canonicalAcl = prVerify.indexOf('sudo chmod 0600 /tmp/kelion-ci-postgres/backup/proof.json')
  const copy = prVerify.indexOf('migration_proof_copy=/tmp/kelion-ci-postgres/backup/proof.migrator.json', canonicalAcl)
  const install = prVerify.indexOf('sudo install -o root -g 10050 -m 0440', copy)
  const mount = prVerify.indexOf('-v "$migration_proof_copy:/run/proof/backup.json:ro"', install)
  const migrator = prVerify.indexOf('"$KELION_APP_IMAGE" node /app/backend/dist/migrate.js)', mount)
  const remove = prVerify.indexOf('sudo rm -f -- "$migration_proof_copy"', migrator)

  assert.ok(canonicalAcl >= 0 && copy > canonicalAcl && install > copy)
  assert.ok(mount > install && migrator > mount && remove > migrator)
  assert.match(prVerify, /stat -c '%u:%g:%a' \/tmp\/kelion-ci-postgres\/backup\/proof\.json\)" = '0:0:600'/)
  assert.match(prVerify, /stat -c '%u:%g:%a' "\$migration_proof_copy"\)" = '0:10050:440'/)
  assert.match(prVerify, /cmp -s -- \/tmp\/kelion-ci-postgres\/backup\/proof\.json "\$migration_proof_copy"/)
})

test('copia dovezii se curăță și când pregătirea ACL eșuează', {
  skip: bashAvailable ? false : 'Bash nu este disponibil pentru proba comportamentală',
}, () => {
  const script = `
set -euo pipefail
${'cleanup_migration_proof_copy'}() {${body('cleanup_migration_proof_copy')}
}
${'prepare_migration_proof_copy'}() {${body('prepare_migration_proof_copy')}
}
RUNTIME_ROOT=$(mktemp -d)
PROOF_FILE="$RUNTIME_ROOT/last-verified-backup.json"
printf '%s\\n' exact-proof > "$PROOF_FILE"
migration_proof_copy=''
stat() {
  local candidate="\${!#}"
  if [ "$candidate" = "$PROOF_FILE" ]; then
    printf '%s\\n' '0:0:600:1'
  else
    printf '%s\\n' '0:10050:440:1'
  fi
}
install() {
  command cp -- "\${@: -2:1}" "\${@: -1}"
}
prepare_migration_proof_copy
prepared=$migration_proof_copy
[ -f "$prepared" ] && cmp -s -- "$PROOF_FILE" "$prepared"
cleanup_migration_proof_copy
[ -z "$migration_proof_copy" ] && [ ! -e "$prepared" ] && [ ! -L "$prepared" ]
install() { return 1; }
if prepare_migration_proof_copy; then exit 1; fi
[ -z "$migration_proof_copy" ]
if compgen -G "$RUNTIME_ROOT/migration-backup-proof.*" >/dev/null; then exit 1; fi
rm -f -- "$PROOF_FILE"
rmdir "$RUNTIME_ROOT"
`
  const result = spawnSync(bashExecutable, ['-c', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('restore-ul verificat este obligatoriu înainte de orice writer sau proxy vechi', () => {
  const restore = body('restore_database_if_required')
  const restartManaged = body('restart_previous_slot')
  const restartLegacy = body('restart_legacy_runtime')
  const rollback = body('rollback_switch')

  ordered(restore, [
    ['permisiunea de restore', '[ "$point_of_no_return" = 0 ]'],
    ['lock-ul de publicare moștenit', 'KELION_RESTORE_APPROVED=1 KELION_PUBLICATION_LOCK_HELD=1'],
    ['helperul de restore', 'bash "$BUNDLE_DIR/restore-verified-backup.sh" "$PROOF_FILE"'],
    ['contractul DB', 'verify_database_contract || return 1'],
    ['dovada restaurării', 'database_restore_verified=1'],
    ['dezarmarea obligației de restore', 'db_restore_required=0'],
  ])
  assert.match(restartManaged, /\[ "\$db_restore_required" = 0 \] \|\| return 1/)
  assert.match(restartManaged, /\[ "\$database_restore_verified" = 1 \] \|\| return 1/)
  assert.match(restartLegacy, /\[ "\$db_restore_required" = 0 \] \|\| return 1/)
  assert.match(restartLegacy, /\[ "\$database_restore_verified" = 1 \] \|\| return 1/)
  assert.ok(rollback.indexOf('restore_database_if_required') < rollback.indexOf('restart_previous_slot'))
  assert.ok(rollback.indexOf('restart_previous_slot') < rollback.indexOf('restore_proxy_after_rollback'))
  assert.match(deploy, /exec 8<>"\$PUBLICATION_LOCK"[\s\S]*flock 8/)
  assert.match(deploy, /"\$BUNDLE_DIR\/backup\.sh" "\$BUNDLE_DIR\/restore-verified-backup\.sh"[\s\\]*\n[\s\\]*"\$BUNDLE_DIR\/vps-curatenie\.sh"[\s\\]*\n[\s\\]*"\$BUNDLE_DIR\/lib\/restore-verified-backup\.mjs"/)
  assert.match(deploy, /psql --version[\s\S]*PostgreSQL[\s\S]*16/)
  assert.match(deploy, /pg_restore --version[\s\S]*PostgreSQL[\s\S]*16/)
  assert.match(deploy, /readlink -f "\/proc\/\$\$\/fd\/8"[\s\S]*flock -n 8/)
})

test('lock-ul de publicare este normalizat prin FD fără symlink sau hardlink', () => {
  const lockStart = deploy.indexOf('if [ -e "$PUBLICATION_LOCK" ]')
  const lockEnd = deploy.indexOf('\nflock 8\n', lockStart)
  const lock = deploy.slice(lockStart, lockEnd)

  assert.match(lock, /\[ -f "\$PUBLICATION_LOCK" \] && \[ ! -L "\$PUBLICATION_LOCK" \]/)
  assert.match(lock, /exec 8<>"\$PUBLICATION_LOCK"/)
  assert.doesNotMatch(lock, /exec 8>"\$PUBLICATION_LOCK"/)
  assert.match(lock, /readlink "\/proc\/\$\$\/fd\/8"/)
  assert.match(lock, /stat -Lc '%h' "\/proc\/\$\$\/fd\/8"/)
  assert.match(lock, /publication_fd_identity=.*stat -Lc '%d:%i'/)
  assert.ok(lock.indexOf('publication_fd_identity=') < lock.indexOf('chown root:root'))
  assert.match(lock, /chown root:root "\/proc\/\$\$\/fd\/8"[\s\S]*chmod 0600/)
  assert.match(lock, /stat -Lc '%u:%g:%a:%h'[\s\S]*'0:0:600:1'/)
  assert.match(lock, /\[ ! -L "\$PUBLICATION_LOCK" \][\s\\]*\n[\s\S]*publication_fd_identity/)
})

test('rollback-ul managed restaurează markerul chiar dacă vechiul proces s-a auto-oprit', () => {
  const restart = body('restart_previous_slot')
  const rollback = body('rollback_switch')
  const managedBranch = rollback.slice(
    rollback.indexOf('  if [ "$active_slot" = blue ]'),
    rollback.indexOf('  else'),
  )

  assert.ok(restart.indexOf('restore_release_marker') < restart.indexOf('ensure_containers_running'))
  assert.match(managedBranch, /restart_previous_slot/)
  assert.doesNotMatch(managedBranch, /active_runtime_stopped/)
  assert.match(deploy, /mv "\$temporary_active" "\$RELEASE_STATE_ROOT\/active"/)
})

test('rollback-ul primului cutover reface markerul legacy chiar dacă runtime-ul rulează', () => {
  const restart = body('restart_legacy_runtime')
  const rollback = body('rollback_switch')
  const legacyBranch = rollback.slice(
    rollback.indexOf('  else'),
    rollback.indexOf('  fi', rollback.indexOf('  else')),
  )

  assert.ok(restart.indexOf('restore_release_marker') < restart.indexOf('ensure_containers_running'))
  assert.match(restart, /api\/version/)
  assert.match(legacyBranch, /restart_legacy_runtime/)
  assert.doesNotMatch(rollback, /active_runtime_stopped" = 0/)
})

test('tranzițiile containerelor sunt idempotente pentru stări mixte true/false', () => {
  const start = body('ensure_containers_running')
  const stop = body('ensure_containers_stopped')
  const candidateStop = body('stop_candidate_runtime')
  const activeStop = body('stop_active_runtime')

  assert.match(start, /case "\$running" in[\s\S]*true\) ;;[\s\S]*false\)[\s\S]*docker start "\$container"/)
  assert.match(start, /\[ "\$running" = true \] \|\| return 1/)
  assert.match(start, /if ! docker start[\s\S]*docker inspect[\s\S]*"\$running" = true/)
  assert.doesNotMatch(start, /docker start "\$@"|docker start "\$\{[^}]+\[@\]\}"/)
  assert.match(stop, /case "\$running" in[\s\S]*true\)[\s\S]*docker stop --time 30 "\$container"[\s\S]*false\) ;;/)
  assert.match(stop, /\[ "\$running" = false \] \|\| return 1/)
  assert.match(stop, /if ! docker stop[\s\S]*docker inspect[\s\S]*"\$running" = false/)
  assert.match(candidateStop, /ensure_containers_stopped "\$\{containers\[@\]\}"/)
  assert.match(candidateStop, /output=\$\(docker ps -aq[\s\S]*\) \\[\s\S]*\|\| return 1/)
  assert.match(activeStop, /ensure_containers_stopped "\$\{active_runtime_containers\[@\]\}"/)
  assert.match(activeStop, /ensure_containers_stopped "\$\{legacy_runtime_running\[@\]\}"/)
})

test('helperii acceptă și cursele Docker already-started/already-stopped', {
  skip: bashAvailable ? false : 'Bash nu este disponibil pentru proba comportamentală',
}, () => {
  const script = `
set -euo pipefail
${'ensure_containers_running'}() {${body('ensure_containers_running')}
}
${'ensure_containers_stopped'}() {${body('ensure_containers_stopped')}
}
declare -A states=(
  [running]=true [stopped]=false [start_race]=false
  [stop_race]=true [pre_stopped]=false
)
calls=''
docker() {
  local command=$1 name
  shift
  case "$command" in
    inspect)
      name="\${!#}"
      printf '%s\\n' "\${states[$name]}"
      ;;
    start)
      name=$1
      calls="\${calls}start:\${name},"
      states[$name]=true
      [ "$name" != start_race ]
      ;;
    stop)
      name="\${!#}"
      calls="\${calls}stop:\${name},"
      states[$name]=false
      [ "$name" != stop_race ]
      ;;
    *) return 1 ;;
  esac
}
ensure_containers_running running stopped start_race
[ "\${states[running]}:\${states[stopped]}:\${states[start_race]}" = true:true:true ]
ensure_containers_stopped running stopped start_race stop_race pre_stopped
for name in running stopped start_race stop_race pre_stopped; do
  [ "\${states[$name]}" = false ]
done
case "$calls" in *start:running,*|*start:pre_stopped,*) exit 1 ;; esac
case "$calls" in *start:stopped,*start:start_race,*stop:stop_race,*) ;; *) exit 1 ;; esac
printf '%s\\n' "$calls"
`
  const result = spawnSync(bashExecutable, ['-c', script], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('după expunerea posibilă a candidatului rollback-ul rămâne fail-closed', () => {
  const managedPoint = deploy.indexOf('\n  mark_point_of_no_return\n')
  const exposeCandidate = deploy.indexOf('\nmv "$temporary_upstream" "$UPSTREAM_FILE"\n', managedPoint)
  const activateCandidate = deploy.indexOf('\nmv "$temporary_active" "$RELEASE_STATE_ROOT/active"\n', exposeCandidate)
  const restore = body('restore_database_if_required')
  const rollback = body('rollback_switch')
  const exitHandler = body('on_release_exit')

  assert.ok(managedPoint >= 0 && exposeCandidate > managedPoint)
  assert.ok(activateCandidate > exposeCandidate)
  assert.ok(restore.indexOf('point_of_no_return') < restore.indexOf('restore-verified-backup.sh'))
  assert.ok(rollback.indexOf('point_of_no_return') < rollback.indexOf('stop_candidate_runtime'))
  assert.ok(exitHandler.indexOf('point_of_no_return') < exitHandler.indexOf('rollback_switch'))
  const postPointBranch = exitHandler.slice(
    exitHandler.indexOf('    if [ "$point_of_no_return" = 1 ]'),
    exitHandler.indexOf('    else'),
  )
  assert.doesNotMatch(postPointBranch, /stop_candidate_runtime|restore_database_if_required|restart_legacy_runtime|rollback_switch/)
  assert.match(postPointBranch, /recover_schedule_after_point_of_no_return/)
  assert.match(deploy, /point-of-no-return depășit; restore-ul automat ar putea pierde scrieri/)
  assert.match(exitHandler, /eșec după point-of-no-return; candidatul, DB și proxy-ul rămân nemodificate/)

  const legacyProxyStart = deploy.indexOf(' up -d --no-build --wait --wait-timeout 90')
  const legacyPoint = deploy.lastIndexOf('\n    mark_point_of_no_return\n', legacyProxyStart)
  const upstreamWrite = deploy.indexOf('\nmv "$temporary_upstream" "$UPSTREAM_FILE"\n')
  assert.ok(legacyPoint > upstreamWrite && legacyProxyStart > legacyPoint)
})

test('recovery-ul distructiv persistă faza și ignoră semnale repetate', () => {
  const writeJournal = body('write_recovery_journal')
  const markPoint = body('mark_point_of_no_return')
  const rollback = body('rollback_switch')
  const exitHandler = body('on_release_exit')
  const staleJournal = deploy.indexOf('există recovery neterminat: phase=')
  const migrationPlan = deploy.indexOf('migration_plan=$(run_migrator')
  const beforeMigrator = deploy.indexOf('\n    write_recovery_journal before-migrator 0 1\n')
  const migrator = deploy.indexOf('migration_output=$(docker run', beforeMigrator)
  const migrated = deploy.indexOf('\n    write_recovery_journal database-migrated 0 1\n', migrator)

  assert.ok(staleJournal >= 0 && staleJournal < migrationPlan)
  ordered(writeJournal, [
    ['fișierul temporar', 'mktemp "$RUNTIME_ROOT/destructive-cutover-recovery.XXXXXX"'],
    ['serializarea JSON', 'jq -n'],
    ['ACL-ul root-only', 'chmod 0600 "$temporary"'],
    ['publicarea atomică', 'mv -f -- "$temporary" "$RECOVERY_JOURNAL"'],
    ['sincronizarea durabilă', 'sync_recovery_path "$RECOVERY_JOURNAL" file'],
  ])
  assert.ok(beforeMigrator >= 0 && migrator > beforeMigrator && migrated > migrator)
  assert.ok(markPoint.indexOf('point_of_no_return=1') < markPoint.indexOf('write_recovery_journal point-of-no-return'))
  assert.ok(deploy.indexOf('\n  mark_point_of_no_return\n') < deploy.indexOf('\nmv "$temporary_upstream" "$UPSTREAM_FILE"\n'))
  assert.ok(rollback.indexOf('write_recovery_journal rolled-back') < rollback.indexOf('recovery_armed=0'))
  assert.ok(rollback.indexOf('clear_recovery_journal') < rollback.indexOf('recovery_armed=0'))
  assert.ok(exitHandler.indexOf("trap '' HUP INT TERM") < exitHandler.indexOf('rollback_switch'))
  assert.doesNotMatch(exitHandler, /trap - HUP INT TERM/)
})

test('rollback-ul este dezarmat numai după versiunea JSON publică exactă', () => {
  const publicProbe = body('verify_public_previous_version')
  const proxy = body('restore_proxy_after_rollback')
  const rollback = body('rollback_switch')

  assert.match(publicProbe, /--resolve "\$PUBLIC_APP_DOMAIN:443:127\.0\.0\.1"/)
  assert.match(publicProbe, /https:\/\/\$PUBLIC_APP_DOMAIN\/api\/version/)
  assert.match(publicProbe, /--arg expected "\$previous_version_before"/)
  assert.match(publicProbe, /\.v == \$expected/)
  assert.match(publicProbe, /consecutive=\$\(\(consecutive \+ 1\)\)[\s\S]*\[ "\$consecutive" -lt 3 \] \|\| return 0/)
  assert.ok(proxy.indexOf('verify_public_previous_version') > proxy.indexOf('ensure_containers_running kelion-caddy'))
  assert.ok(rollback.indexOf('restore_proxy_after_rollback') < rollback.indexOf('write_recovery_journal rolled-back'))
  assert.ok(rollback.indexOf('write_recovery_journal rolled-back') < rollback.indexOf('recovery_armed=0'))
})

test('stackul vechi rămâne recuperabil și este oprit idempotent', () => {
  const stop = body('stop_active_runtime')
  assert.match(deploy, /LEGACY_RUNTIME_CONTAINERS=\(kelionai-app omniroute kelionai-coqui\)/)
  assert.match(stop, /ensure_containers_stopped "\$\{legacy_runtime_running\[@\]\}"[^\n]*\|\| return 1/)
  assert.doesNotMatch(deploy, /docker\s+rm[^\n]*(?:kelionai-app|omniroute|kelionai-coqui)/)
  assert.doesNotMatch(deploy, /docker\s+(?:image|volume)\s+rm[^\n]*(?:kelionai-app|omniroute|kelionai-coqui)/)

  const smoke = deploy.indexOf("[ \"$public_ok\" = 1 ] || die 'smoke-ul public")
  const normalStop = deploy.lastIndexOf('\nstop_active_runtime\n')
  assert.ok(smoke >= 0 && normalStop > smoke)
})

test('dovada backupului rămâne disponibilă până când release-ul este comis', () => {
  const releaseRecord = deploy.indexOf('mv "$record" "$RUNTIME_ROOT/last-release.json"')
  assert.ok(releaseRecord >= 0)
  const finalization = deploy.slice(releaseRecord)
  ordered(finalization, [
    ['recordul release-ului', 'mv "$record" "$RUNTIME_ROOT/last-release.json"'],
    ['dezarmarea recovery', 'recovery_armed=0'],
    ['eliminarea trap-ului', 'trap - HUP INT TERM EXIT'],
    ['ștergerea dovezii', 'rm -f -- "$PROOF_FILE"'],
  ])
})

test('slotul activ este validat printr-un case fail-closed', () => {
  assert.match(deploy, /case "\$active_slot" in[\s\S]*blue\|green\)[\s\S]*legacy\)[\s\S]*\*\) return 1 ;;/)
  assert.doesNotMatch(deploy, /\[ "\$active_slot" = blue \|\|/)
})
