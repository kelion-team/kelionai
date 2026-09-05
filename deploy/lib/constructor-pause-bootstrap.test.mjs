import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rootFilesystemTest } from './root-filesystem-test.mjs'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const helper = readFileSync(join(repository, 'deploy/lib/runtime-config-cutover.sh'), 'utf8')
const legacyCommit = 'a32bab142cc2cf1eca2b514c92732308232155b2'
const legacyHash = '833b28bd8a879c077440a2563eabd37da86dc8b19208c72f95823b2c12881cbc'
const names = [
  'worker_pause_state', 'worker_pause_bootstrap_context', 'validate_worker_pause_bootstrap',
  'publish_worker_pause', 'finish_worker_pause_bootstrap', 'bootstrap_worker_pause',
  'worker_pause_no_foreign_transaction', 'capture_worker_pause',
]
const extract = (source, name) => {
  const start = source.indexOf(name + '() {')
  const end = source.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start, 'Missing real shell function ' + name)
  return source.slice(start, end + 2)
}

function authenticLegacy() {
  const result = spawnSync('git', ['show', legacyCommit + ':deploy/lib/runtime-config-cutover.sh'], {
    cwd: repository, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
  })
  assert.equal(result.status, 0,
    'Authentic A32 helper is required; checkout must retain history (fetch-depth: 0). ' + result.stderr)
  assert.equal(createHash('sha256').update(result.stdout).digest('hex'), legacyHash,
    'A32 bootstrap fixture must be the exact authenticated helper bytes')
  return result.stdout
}

const setup = String.raw`
set -euo pipefail
umask 077
MODE=$1
FIXTURE=$2
CUT_BOUNDARY=$3
MUTATION=$4
OWNER=$5
case "$FIXTURE" in /tmp/kelion-worker-bootstrap-*|/work/tmp/kelion-worker-bootstrap-*) ;; *) exit 97 ;; esac
trap 'command rm -rf -- "$FIXTURE"' EXIT
ROOT=$FIXTURE/root
RUNTIME_ROOT=$ROOT/runtime
CONFIG_ROOT=$ROOT/config
READY_STAMP=$FIXTURE/run/runtime-config-recovery.ready
CANDIDATE=$FIXTURE/candidate.sh
LEGACY=$FIXTURE/legacy.sh
PENDING=$RUNTIME_ROOT/constructor-unit-migration.pending
MARKER=$FIXTURE/etc/codex-worker.paused
LIVE_HELPER=$ROOT/bin/runtime-config-cutover.sh
TRACE=$FIXTURE/trace
SYSTEMCTL_LOG=$FIXTURE/systemctl.log
mkdir -p "$ROOT/bin" "$RUNTIME_ROOT" "$CONFIG_ROOT" "$FIXTURE/etc" "$FIXTURE/run"
chown root:root "$FIXTURE" "$ROOT" "$ROOT/bin" "$CONFIG_ROOT" "$FIXTURE/etc" "$FIXTURE/run" "$CANDIDATE" "$LEGACY"
chmod 0755 "$ROOT" "$ROOT/bin" "$CONFIG_ROOT" "$FIXTURE/etc" "$FIXTURE/run"
chown root:10050 "$RUNTIME_ROOT"
chmod 0750 "$RUNTIME_ROOT"
chmod 0644 "$CANDIDATE" "$LEGACY"
install -o root -g root -m 0500 "$LEGACY" "$LIVE_HELPER"
printf 'schema=1\n' > "$READY_STAMP"
printf 'schema=1\n' > "$FIXTURE/etc/codex-worker.enabled"
printf 'CODEX_WORKER_EXEC_ENABLED=1\n' > "$CONFIG_ROOT/codex-worker.env"
chmod 0444 "$READY_STAMP" "$FIXTURE/etc/codex-worker.enabled"
chmod 0640 "$CONFIG_ROOT/codex-worker.env"
worker_pause_candidate_source=$CANDIDATE
boot_recovery=0
KELION_CUTOVER_LOCK_HELD=1
constructor_upgrade_owner=0
constructor_upgrade_source_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
deploy_owner_request_id=11111111-1111-4111-8111-111111111111
deploy_owner_commit=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
if [ "$OWNER" = upgrade ]; then
  constructor_upgrade_owner=1
  deploy_owner_request_id=''
  deploy_owner_commit=''
fi
SYSTEMCTL_FORBIDDEN=0
systemctl() {
  printf '%s\n' "$*" >> "$SYSTEMCTL_LOG"
  [ "$SYSTEMCTL_FORBIDDEN" = 0 ] || return 98
  case "$1" in
    show)
      case "$3" in
        --property=UnitFileState) printf 'enabled\n' ;;
        --property=ActiveState) printf 'inactive\n' ;;
        *) return 98 ;;
      esac ;;
    is-enabled) return 0 ;;
    is-active) return 1 ;;
    list-jobs) return 0 ;;
    *) return 99 ;;
  esac
}
`

const instrumentation = String.raw`
boundary=0
KILL_LABEL=''
hit() {
  local tool=$1 phase=$2 target=$3 label
  boundary=$((boundary + 1))
  printf '%s|%s|%s\n' "$boundary" "$tool" "$phase" >> "$TRACE"
  label=$tool:$phase:$target
  if [ "$CUT_BOUNDARY" = "$boundary" ] || { [ -n "$KILL_LABEL" ] && [ "$KILL_LABEL" = "$label" ]; }; then
    kill -KILL "$BASHPID"
    exit 96
  fi
}
invoke() {
  local tool=$1 target='' value status
  shift
  for value in "$@"; do target=$value; done
  hit "$tool" before "$target"
  command "$tool" "$@"
  status=$?
  [ "$status" = 0 ] || return "$status"
  hit "$tool" after "$target"
}
sync() { invoke sync "$@"; }
mv() { invoke mv "$@"; }
install() { invoke install "$@"; }
rm() { invoke rm "$@"; }
snapshot() {
  local path
  for path in "$PENDING" "$MARKER" "$LIVE_HELPER"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      stat -c '%n:%F:%u:%g:%a:%h:%i:%s' "$path"
      if [ -f "$path" ] && [ ! -L "$path" ]; then sha256sum "$path" 2>/dev/null || printf 'unreadable\n'; fi
    else printf 'absent:%s\n' "$path"; fi
  done
}
assert_complete() {
  [ ! -e "$PENDING" ] && [ ! -L "$PENDING" ]
  [ "$(worker_pause_state)" = paused ]
  [ "$(stat -Lc '%u:%g:%a:%h' "$LIVE_HELPER")" = 0:0:500:1 ]
  cmp -s "$CANDIDATE" "$LIVE_HELPER"
}
start_interrupted() {
  set +e
  ( set -e; capture_worker_pause ) > "$FIXTURE/child.stdout" 2> "$FIXTURE/child.stderr"
  child_status=$?
  set -e
}
`

function legacyValidator(source) {
  const start = source.indexOf('if [ -e "$UNIT_MIGRATION_PENDING" ]')
  const end = source.indexOf('\nfi\n', start)
  assert.ok(start >= 0 && end > start, 'A32 pending validator is missing')
  const block = source.slice(start, end + 4)
  assert.ok(source.indexOf('restore_constructor_timers()') > end,
    'A32 must validate its pending barrier before restoring timers')
  return 'legacy_boot_probe() (\nUNIT_MIGRATION_PENDING=$PENDING\ndie() { exit 88; }\n'
    + block + '\nprintf "LEGACY_RESTORE_REACHED\\n"\n)\n'
}

const body = String.raw`
if [ "$MODE" = foreign ]; then KILL_LABEL=mv:after:$PENDING; fi
start_interrupted
if [ "$MODE" = baseline ]; then
  [ "$child_status" = 0 ]
  assert_complete
  printf 'BOUNDARY_COUNT=%s\n' "$(wc -l < "$TRACE")"
  cat "$TRACE"
  exit 0
fi
[ "$child_status" = 137 ]
if [ "$MODE" = foreign ]; then
  [ -f "$PENDING" ] && [ ! -e "$MARKER" ]
  case "$MUTATION" in
    request) deploy_owner_request_id=22222222-2222-4222-8222-222222222222 ;;
    commit) deploy_owner_commit=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb; constructor_upgrade_source_commit=$deploy_owner_commit ;;
    owner) constructor_upgrade_owner=1; deploy_owner_request_id=''; deploy_owner_commit='' ;;
    candidate) printf '# changed candidate\n' >> "$CANDIDATE" ;;
    helper) chmod 0600 "$LIVE_HELPER"; printf '# changed helper\n' >> "$LIVE_HELPER"; chmod 0500 "$LIVE_HELPER" ;;
    schema|old-hash|target-hash|extra-key)
      case "$MUTATION" in
        schema) filter='.schema=3' ;;
        old-hash) filter='.oldHelperSha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' ;;
        target-hash) filter='.targetHelperSha="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"' ;;
        extra-key) filter='.extra=true' ;;
      esac
      jq "$filter" "$PENDING" > "$PENDING.next"
      command mv -T -- "$PENDING.next" "$PENDING" ;;
    symlink) command mv "$PENDING" "$PENDING.target"; ln -s "$PENDING.target" "$PENDING" ;;
    hardlink) ln "$PENDING" "$PENDING.other" ;;
    ownership) chown 1000:1000 "$PENDING" ;;
    writable) chmod 0644 "$PENDING" ;;
    source-symlink) command mv "$CANDIDATE" "$CANDIDATE.target"; ln -s "$CANDIDATE.target" "$CANDIDATE" ;;
    parent) chmod 0777 "$ROOT/bin" ;;
    runtime-parent) chmod 0755 "$RUNTIME_ROOT" ;;
    journal) printf 'foreign\n' > "$RUNTIME_ROOT/constructor-upgrade.journal" ;;
    boot) boot_recovery=1 ;;
    lock) KELION_CUTOVER_LOCK_HELD=0 ;;
    *) exit 94 ;;
  esac
  before=$(snapshot)
  : > "$SYSTEMCTL_LOG"
  SYSTEMCTL_FORBIDDEN=1
  CUT_BOUNDARY=0
  KILL_LABEL=''
  if capture_worker_pause > "$FIXTURE/retry.stdout" 2> "$FIXTURE/retry.stderr"; then exit 91; fi
  [ ! -s "$SYSTEMCTL_LOG" ]
  [ "$before" = "$(snapshot)" ]
  printf 'VERIFIED foreign=%s no_mutation=true no_systemctl=true\n' "$MUTATION"
  exit 0
fi
strict_retry=0
if [ -e "$PENDING" ]; then
  [ "$(stat -Lc '%u:%g:%a:%h' "$PENDING")" = 0:0:600:1 ]
  validate_worker_pause_bootstrap
  set +e
  legacy_boot_probe > "$FIXTURE/legacy.stdout" 2> "$FIXTURE/legacy.stderr"
  legacy_status=$?
  set -e
  [ "$legacy_status" = 88 ]
  [ ! -s "$FIXTURE/legacy.stdout" ]
  strict_retry=1
elif cmp -s "$CANDIDATE" "$LIVE_HELPER"; then
  [ "$(worker_pause_state)" = paused ]
  strict_retry=1
else
  # Before the first durable barrier, no pause/helper publication may exist.
  cmp -s "$LEGACY" "$LIVE_HELPER"
  [ ! -e "$MARKER" ] && [ ! -L "$MARKER" ]
fi
: > "$SYSTEMCTL_LOG"
SYSTEMCTL_FORBIDDEN=$strict_retry
CUT_BOUNDARY=0
KILL_LABEL=''
capture_worker_pause > "$FIXTURE/retry.stdout"
assert_complete
if [ "$strict_retry" = 1 ]; then [ ! -s "$SYSTEMCTL_LOG" ]; fi
printf 'VERIFIED interrupted strict_owner_retry=%s\n' "$strict_retry"
`

function runCase(mode, cut = 0, mutation = '', owner = 'release') {
  const legacy = authenticLegacy()
  const fixture = mkdtempSync(join(tmpdir(), 'kelion-worker-bootstrap-'))
  writeFileSync(join(fixture, 'candidate.sh'), helper)
  writeFileSync(join(fixture, 'legacy.sh'), legacy)
  const functions = names.map((name) => extract(helper, name)
    .replaceAll('/etc/kelion', fixture + '/etc')
    .replaceAll('/run/kelion', fixture + '/run')).join('\n')
  const script = setup + '\n' + functions + '\n' + instrumentation + '\n'
    + legacyValidator(legacy) + '\n' + body
  try {
    const root = process.getuid?.() === 0
    return spawnSync(root ? 'bash' : 'sudo',
      [...(root ? [] : ['-n', '--', 'bash']), '--noprofile', '--norc', '-c',
        script, 'worker-bootstrap-fixture', mode, fixture, String(cut), mutation, owner],
      { encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024 })
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
}

rootFilesystemTest('pause bootstrap survives process death before/after every real publication operation', async (context) => {
  const baseline = runCase('baseline')
  assert.equal(baseline.status, 0, baseline.stderr + baseline.stdout)
  const count = Number(/BOUNDARY_COUNT=(\d+)/.exec(baseline.stdout)?.[1])
  assert.ok(count >= 24 && count <= 80, 'Expected all rename/fsync/install/unlink boundaries')
  for (const operation of ['sync', 'mv', 'install', 'rm']) {
    assert.match(baseline.stdout, new RegExp('\\|' + operation + '\\|before'))
    assert.match(baseline.stdout, new RegExp('\\|' + operation + '\\|after'))
  }
  for (let cut = 1; cut <= count; cut++) {
    await context.test('SIGKILL at publication boundary ' + cut, () => {
      const result = runCase('interrupt', cut)
      assert.equal(result.status, 0, result.stderr + result.stdout)
      assert.match(result.stdout, /VERIFIED interrupted strict_owner_retry=[01]/)
    })
  }
})

rootFilesystemTest('upgrade owner retries its exact durable bootstrap without reinferring timer state', () => {
  const baseline = runCase('baseline', 0, '', 'upgrade')
  assert.equal(baseline.status, 0, baseline.stderr + baseline.stdout)
  const result = runCase('interrupt', 4, '', 'upgrade')
  assert.equal(result.status, 0, result.stderr + result.stdout)
  assert.match(result.stdout, /strict_owner_retry=1/)
})

for (const mutation of [
  'request', 'commit', 'owner', 'candidate', 'helper', 'schema', 'old-hash',
  'target-hash', 'extra-key', 'symlink', 'hardlink', 'ownership', 'writable',
  'source-symlink', 'parent', 'runtime-parent', 'journal', 'boot', 'lock',
]) {
  rootFilesystemTest('pause bootstrap rejects foreign or unsafe ' + mutation + ' without mutations', () => {
    const result = runCase('foreign', 0, mutation)
    assert.equal(result.status, 0, result.stderr + result.stdout)
    assert.match(result.stdout, /no_mutation=true no_systemctl=true/)
  })
}
