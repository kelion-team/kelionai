import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { rootFilesystemTest } from './root-filesystem-test.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const extract = (source, name) => {
  const start = source.indexOf(`${name}() {`)
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, name)
  return source.slice(start, end + 2)
}
const cutover = read('./runtime-config-cutover.sh')
const upgrade = read('../upgrade-constructor.sh')
const deploy = read('../deploy.sh')
const installer = read('../instaleaza-constructor.sh')

function run(operation, paused = true, boot = false) {
  const selected = operation === 'restore' ? extract(cutover, 'restore_constructor_timers')
    : operation === 'upgrade' ? extract(upgrade, 'validate_live_activation_vector')
      : operation === 'installer' ? extract(installer, 'constructor_reactivation_postcondition')
        : extract(deploy, 'restore_constructor_after_release')
  const result = spawnSync('bash', ['--noprofile', '--norc', '-c', `
set -u
PATH=/no-executables
operation=$1
paused=$2
ROOT=/synthetic
repo_root=/synthetic/repo
CONFIG_ROOT=/synthetic/config
READY_STAMP=/synthetic/ready
REACTIVATION_JOURNAL=/synthetic/reactivation
constructor_timers=(kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer)
constructor_services=(kelion-codex-worker.service kelion-constructor-publisher.service kelion-constructor-release.service)
constructor_markers=(/etc/kelion/codex-worker.enabled /etc/kelion/constructor-publisher.enabled /etc/kelion/constructor-release.enabled)
constructor_release_timers=("\${constructor_timers[@]}")
constructor_release_markers=("\${constructor_markers[@]}")
declare -A enabled=() active=()
for timer in "\${constructor_timers[@]}"; do enabled[$timer]=1; active[$timer]=1; done
constructor_upgrade_source_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
if [ "$paused" = 1 ]; then active[kelion-codex-worker.timer]=0; fi
for unit in "\${constructor_services[@]}"; do enabled[$unit]=0; active[$unit]=0; done
if [ "$operation" = restore ]; then
  for timer in "\${constructor_timers[@]}"; do enabled[$timer]=0; active[$timer]=0; done
fi
units_quiesced=1
constructor_release_quiesced=1
boot_recovery=${boot ? '1' : '0'}
KELION_RELEASE_REQUEST_ID=synthetic
COMMIT_SHA=synthetic
starts=''
systemctl() {
  local unit=\${@: -1} property
  case "$1" in
    daemon-reload|cat) return 0 ;;
    list-jobs) return 0 ;;
    enable) enabled[$unit]=1 ;;
    disable) enabled[$unit]=0; if [ "\${2:-}" = --now ]; then active[$unit]=0; fi ;;
    start) starts="$starts $unit"; active[$unit]=1 ;;
    stop) active[$unit]=0 ;;
    is-enabled) [ "\${enabled[$unit]:-0}" = 1 ] ;;
    is-active) if [ "$unit" = kelion-constructor-model-control.service ]; then return 0; fi; [ "\${active[$unit]:-0}" = 1 ] ;;
    show)
      unit=$2; property=\${3#--property=}
      case "$property" in
        UnitFileState) if [[ "$unit" = *.service ]]; then printf 'static\\n'; elif [ "\${enabled[$unit]}" = 1 ]; then printf 'enabled\\n'; else printf 'disabled\\n'; fi ;;
        ActiveState) if [ "\${active[$unit]}" = 1 ]; then printf 'active\\n'; else printf 'inactive\\n'; fi ;;
        *) return 95 ;;
      esac ;;
    *) return 96 ;;
  esac
}
[() {
  case "$1:\${2:-}" in
    -e:/etc/kelion/codex-worker.paused|-f:/etc/kelion/codex-worker.paused) builtin [ "$paused" = 1 ] ;;
    -f:/etc/kelion/*.enabled|-e:/etc/kelion/*.enabled|-f:/synthetic/config/*|-f:/synthetic/ready|-S:/run/kelion-constructor-model-control/control.sock) return 0 ;;
    -L:*) return 1 ;;
    *) builtin [ "$@" ;;
  esac
}
stat() { if [ "\${@: -1}" = /run/kelion-constructor-model-control/control.sock ]; then printf '0:10050:660\\n'; elif [[ "\${@: -1}" = *.enabled || "\${@: -1}" = /synthetic/ready ]]; then printf '0:0:444:1\\n'; else printf '0:0:640:1\\n'; fi; }
validate_marker_root() { return 0; }
validate_ready_stamp() { return 0; }
worker_pause_state() { if [ "$paused" = 1 ]; then printf 'paused\\n'; else printf 'unpaused\\n'; fi; }
bash() { worker_pause_state; }
validate_service_quiescence() { return 0; }
validate_constructor_unit_file_state() { return 0; }
start_constructor_unit() { systemctl start "$1"; }
stop_and_disable_constructor_service() { systemctl stop "$1"; }
force_quiesce_constructor_units() { return 0; }
constructor_deploy_quiesce_restore_proof() { return 0; }
constructor_recovery_unit_postproof() { return 0; }
quiesce_constructor_after_failed_reactivation_proof() { return 0; }
function /synthetic/bin/runtime-config-cutover.sh { if [ "$1" = --worker-pause-state ]; then worker_pause_state; fi; return 0; }
${selected}
exec 8>&2
${operation === 'restore' ? 'restore_constructor_timers' : operation === 'upgrade' ? 'validate_live_activation_vector' : operation === 'installer' ? 'constructor_reactivation_postcondition' : 'restore_constructor_after_release'}
status=$?
printf 'status=%s worker=%s:%s publisher=%s:%s release=%s:%s starts=%s\\n' "$status" "\${enabled[kelion-codex-worker.timer]}" "\${active[kelion-codex-worker.timer]}" "\${enabled[kelion-constructor-publisher.timer]}" "\${active[kelion-constructor-publisher.timer]}" "\${enabled[kelion-constructor-release.timer]}" "\${active[kelion-constructor-release.timer]}" "$starts"
exit "$status"
`, 'pause-fixture', operation, paused ? '1' : '0'], { encoding: 'utf8', timeout: 5_000 })
  return result
}

for (const operation of ['restore', 'upgrade', 'deploy', 'installer']) {
  test(`${operation}: preserve paused worker without pausing publisher/release`, () => {
    const result = run(operation)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /worker=1:0 publisher=1:1 release=1:1/)
    assert.doesNotMatch(result.stdout, /starts=.*kelion-codex-worker\.timer/)
  })
  test(`${operation}: an unpaused configured vector remains active`, () => {
    const result = run(operation, false)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /worker=1:1 publisher=1:1 release=1:1/)
  })
}

test('boot recovery restores active publisher/release but never starts a durably paused worker', () => {
  const result = run('restore', true, true)
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /worker=1:0 publisher=1:1 release=1:1/)
  assert.doesNotMatch(result.stdout, /starts=.*kelion-codex-worker\.timer/)
})

function filesystemCase(mode) {
  assert.ok(process.env.CI === 'true' || existsSync('/.dockerenv') || existsSync('/run/.containerenv'),
    'root filesystem fixtures require an isolated container or CI runner, never the VPS host')
  const fixture = mkdtempSync(join(tmpdir(), 'kelion-worker-pause-'))
  const relocate = (source) => source.replaceAll('/etc/kelion', `${fixture}/etc`)
    .replaceAll('/run/kelion', `${fixture}/run`)
    .replaceAll('/root/kelion/runtime', `${fixture}/runtime`)
  const functions = ['worker_pause_state', 'worker_pause_bootstrap_context', 'validate_worker_pause_bootstrap',
    'publish_worker_pause', 'finish_worker_pause_bootstrap', 'bootstrap_worker_pause', 'worker_pause_no_foreign_transaction',
    'capture_worker_pause'].map((name) => relocate(extract(cutover, name))).join('\n')
  const unitValidator = extract(cutover, 'validate_worker_pause_unit')
  const snapshotFunctions = ['write_upgrade_journal', 'load_upgrade_journal', 'create_upgrade_snapshot']
    .map((name) => relocate(extract(upgrade, name))).join('\n')
  const script = `
set -euo pipefail
mode=$1
FIXTURE=$2
[[ "$FIXTURE" = /tmp/kelion-worker-pause-* ]] || exit 97
trap 'rm -rf -- "$FIXTURE"' EXIT
chown root:root "$FIXTURE"
mkdir "$FIXTURE/etc" "$FIXTURE/run" "$FIXTURE/runtime" "$FIXTURE/config" "$FIXTURE/bin"
chmod 0755 "$FIXTURE" "$FIXTURE/etc" "$FIXTURE/run" "$FIXTURE/bin"
chown root:10050 "$FIXTURE/runtime"
chmod 0750 "$FIXTURE/runtime"
ROOT=$FIXTURE
RUNTIME_ROOT=$FIXTURE/runtime
CONFIG_ROOT=$FIXTURE/config
worker_pause_candidate_source=${new URL('./runtime-config-cutover.sh', import.meta.url).pathname}
install -o root -g root -m 0500 "$worker_pause_candidate_source" "$FIXTURE/bin/runtime-config-cutover.sh"
KELION_CUTOVER_LOCK_HELD=1
constructor_upgrade_owner=0
deploy_owner_request_id=11111111-1111-4111-8111-111111111111
deploy_owner_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
READY_STAMP=$FIXTURE/run/runtime-config-recovery.ready
marker=$FIXTURE/etc/codex-worker.paused
printf 'schema=1\\n' > "$READY_STAMP"
printf 'schema=1\\n' > "$FIXTURE/etc/codex-worker.enabled"
printf 'CODEX_WORKER_EXEC_ENABLED=1\\n' > "$CONFIG_ROOT/codex-worker.env"
chmod 0444 "$READY_STAMP" "$FIXTURE/etc/codex-worker.enabled"
chmod 0640 "$CONFIG_ROOT/codex-worker.env"
boot_recovery=0
worker_active=inactive
systemctl() {
  local unit=\${@: -1}
  case "$1" in
    show)
      case "$3" in
        --property=UnitFileState) printf 'enabled\\n' ;;
        --property=ActiveState) if [ "$2" = kelion-codex-worker.timer ]; then printf '%s\\n' "$worker_active"; else printf 'inactive\\n'; fi ;;
        *) return 98 ;;
      esac ;;
    is-enabled) return 0 ;;
    is-active) if [ "$unit" = kelion-codex-worker.timer ]; then [ "$worker_active" = active ]; else return 0; fi ;;
    list-jobs) [ "$mode" != query-error ] ;;
    *) return 99 ;;
  esac
}
${functions}
${unitValidator}
case "$mode" in
  capture)
    capture_worker_pause
    [ "$(worker_pause_state)" = paused ]
    [ "$(stat -c '%u:%g:%a:%h:%s' "$marker")" = 0:0:444:1:9 ]
    before=$(stat -c '%i' "$marker")
    capture_worker_pause
    [ "$before" = "$(stat -c '%i' "$marker")" ] ;;
  active) worker_active=active; capture_worker_pause; [ ! -e "$marker" ] ;;
  boot) boot_recovery=1; if capture_worker_pause; then exit 91; fi; [ ! -e "$marker" ] ;;
  journals)
    for name in runtime-config-cutover.journal constructor-activation.journal constructor-gate-refresh.journal constructor-deploy-quiesce.journal constructor-upgrade.journal constructor-reactivation.journal constructor-unit-migration.pending constructor-max-model.journal destructive-cutover-recovery.json; do
      touch "$RUNTIME_ROOT/$name"; if capture_worker_pause; then exit 91; fi; [ ! -e "$marker" ]; rm "$RUNTIME_ROOT/$name"
    done ;;
  no-ready) rm "$READY_STAMP"; if capture_worker_pause; then exit 91; fi; [ ! -e "$marker" ] ;;
  query-error) if capture_worker_pause; then exit 91; fi; [ ! -e "$marker" ] ;;
  sync-before)
    sync() { return 1; }
    if capture_worker_pause; then exit 91; fi
    [ ! -e "$marker" ] ;;
  sync-after)
    sync_count=0
    sync() { sync_count=$((sync_count + 1)); [ "$sync_count" -lt 2 ]; }
    if capture_worker_pause; then exit 91; fi
    [ ! -e "$marker" ]
    [ -f "$RUNTIME_ROOT/constructor-unit-migration.pending" ]
    unset -f sync
    capture_worker_pause >/dev/null
    [ "$(worker_pause_state)" = paused ] ;;
  legacy-unit)
    for unit in kelion-codex-worker.timer kelion-codex-worker.service; do
      source=${new URL('../systemd/', import.meta.url).pathname}"$unit"
      sed '\\|^ConditionPathExists=!/etc/kelion/codex-worker.paused$|d' "$source" > "$FIXTURE/$unit"
      if [ "$unit" = kelion-codex-worker.timer ]; then sed -i 's/isolated server OpenCode/local OpenCode\\/Qwen/' "$FIXTURE/$unit"; fi
      validate_worker_pause_unit "$FIXTURE/$unit" "$unit"
      printf '# unsupported mutation\\n' >> "$FIXTURE/$unit"
      if validate_worker_pause_unit "$FIXTURE/$unit" "$unit"; then exit 91; fi
      validate_worker_pause_unit "$source" "$unit"
      cp "$source" "$FIXTURE/new-$unit"
      printf 'ConditionPathExists=|/tmp/unexpected\\n' >> "$FIXTURE/new-$unit"
      if validate_worker_pause_unit "$FIXTURE/new-$unit" "$unit"; then exit 91; fi
    done ;;
  snapshot)
    repo_root=/synthetic
    UPGRADE_JOURNAL=$RUNTIME_ROOT/constructor-upgrade.journal
    constructor_upgrade_source_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
    constructor_markers=("$FIXTURE/etc/codex-worker.enabled" "$FIXTURE/etc/constructor-publisher.enabled" "$FIXTURE/etc/constructor-release.enabled")
    constructor_timers=(kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer)
    for enabled_marker in "\${constructor_markers[@]}"; do if [ ! -f "$enabled_marker" ]; then printf 'schema=1\\n' > "$enabled_marker"; fi; chmod 0444 "$enabled_marker"; done
    validate_live_activation_vector() { return 0; }
    fsync_path() { sync -f "$1"; }
    bash() { case "\${@: -1}" in --capture-worker-pause) capture_worker_pause ;; --worker-pause-state) worker_pause_state ;; *) return 99 ;; esac; }
    ${snapshotFunctions}
    create_upgrade_snapshot
    load_upgrade_journal
    [ "\${snapshot_timer_enabled[*]}" = '1 1 1' ]
    [ "\${snapshot_timer_active[*]}" = '0 1 1' ]
    # A restarted reader must accept the durable paused vector, then reject a
    # missing marker; it must never reinterpret that snapshot as active.
    snapshot_timer_active=()
    load_upgrade_journal
    [ "\${snapshot_timer_active[0]}" = 0 ]
    rm "$marker"
    if load_upgrade_journal; then exit 91; fi ;;
  *)
    capture_worker_pause
    case "$mode" in
      symlink) mv "$marker" "$marker.target"; ln -s "$marker.target" "$marker" ;;
      hardlink) ln "$marker" "$marker.link" ;;
      writable) chmod 0644 "$marker" ;;
      foreign-owner) chown 1000:1000 "$marker" ;;
      malformed) chmod 0644 "$marker"; printf 'schema=2\\n' > "$marker"; chmod 0444 "$marker" ;;
      unsafe-parent) chmod 0777 "$FIXTURE/etc" ;;
      *) exit 92 ;;
    esac
    if worker_pause_state; then exit 91; fi ;;
esac
printf 'verified:%s\\n' "$mode"
`
  try {
    const root = process.getuid?.() === 0
    return spawnSync(root ? 'bash' : 'sudo', [...(root ? [] : ['-n', '--', 'bash']), '--noprofile', '--norc', '-c', script, 'pause-filesystem', mode, fixture], { encoding: 'utf8', timeout: 20_000 })
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

for (const mode of ['capture', 'active', 'boot', 'journals', 'no-ready', 'query-error', 'sync-before', 'sync-after', 'snapshot', 'legacy-unit', 'symlink', 'hardlink', 'writable', 'foreign-owner', 'malformed', 'unsafe-parent']) {
  rootFilesystemTest(`durable worker pause with real filesystem: ${mode}`, () => {
    const result = filesystemCase(mode)
    assert.equal(result.status, 0, `${mode}: ${result.error ?? ''}${result.stderr}${result.stdout}`)
    assert.equal(result.stdout, `verified:${mode}\n`)
  })
}

test('both worker systemd units enforce pause independently of timer restoration', () => {
  for (const unit of ['kelion-codex-worker.timer', 'kelion-codex-worker.service']) {
    const content = read(`../systemd/${unit}`)
    assert.equal(content.split('\n').filter((line) => line === 'ConditionPathExists=!/etc/kelion/codex-worker.paused').length, 1)
  }
  const barrier = cutover.indexOf('early_recover_only_barrier \\\n')
  assert.ok(barrier > 0)
  assert.doesNotMatch(cutover.slice(barrier), /capture_worker_pause/)
  assert.ok(deploy.indexOf('--capture-worker-pause') < deploy.indexOf('# Un crash după clear-ul jurnalului interior'))
  assert.match(extract(upgrade, 'create_upgrade_snapshot'), /validate_live_activation_vector[\s\S]*--capture-worker-pause[\s\S]*mktemp/)
})
