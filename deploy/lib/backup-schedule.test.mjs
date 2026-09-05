import assert from 'node:assert/strict'
import { chmodSync, lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const deploy = read('deploy.sh')
const backup = read('backup.sh')
const service = read('systemd/kelion-backup.service')
const timer = read('systemd/kelion-backup.timer')

test('backupul verifică read-only directorul runtime comun și păstrează dovada root-only', () => {
  const start = backup.indexOf('validate_backup_runtime_directory() {')
  const end = backup.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start)
  const validator = backup.slice(start, end + 2)
  assert.match(validator, /\[ -d "\$RUNTIME_DIR" \] && \[ ! -L "\$RUNTIME_DIR" \]/)
  assert.match(validator, /realpath -e -- "\$RUNTIME_DIR"/)
  assert.match(validator, /stat -Lc '%u:%g:%a' "\$RUNTIME_DIR".*'0:10050:750'/)
  assert.doesNotMatch(validator, /(?:^|\n)\s*(?:install|chmod|chown|mkdir|rm)\s/)
  assert.doesNotMatch(backup, /install -d[^\n]*"\$RUNTIME_DIR"/)
  assert.match(backup, /validate_backup_runtime_directory \\\n\s+\|\| .*exit 1; \}/)
  assert.match(backup, /chown root:root "\$temporary_proof"\nchmod 0600 "\$temporary_proof"\nmv "\$temporary_proof" "\$PROOF_FILE"/)
  const preparation = deploy.indexOf('install -d -o root -g 10050 -m 0750 "$RUNTIME_ROOT" "$RELEASE_STATE_ROOT"')
  assert.ok(preparation >= 0 && preparation < deploy.indexOf('\n"$PERSISTENT_BACKUP_SCRIPT"\n'))
})

test('validatorul backup păstrează inode/ACL/conținut și refuză layoutul700, lipsa, fișierul și symlinkul', {
  skip: process.platform !== 'linux',
}, () => {
  const start = backup.indexOf('validate_backup_runtime_directory() {')
  const end = backup.indexOf('\n}\n', start)
  assert.ok(start >= 0 && end > start)
  const original = backup.slice(start, end + 2)
  // The fixture uses the test process's UID/GID; no chown or production path is
  // needed. The test above seals the real root:10050 policy. Every filesystem
  // predicate here is the actual shell predicate against a private directory.
  assert.equal(original.split("'0:10050:750'").length, 2)
  const validator = original.replace("'0:10050:750'", `'${process.getuid()}:${process.getgid()}:750'`)
  const root = mkdtempSync(join(tmpdir(), 'kelion-backup-runtime-layout-'))
  try {
    const runtime = join(root, 'runtime')
    mkdirSync(runtime, { mode: 0o750 })
    chmodSync(runtime, 0o750)
    const proof = join(runtime, 'last-verified-backup.json')
    writeFileSync(proof, '{"synthetic":true}\n', { mode: 0o600 })
    const before = lstatSync(runtime)
    const run = (path = runtime) => spawnSync('bash', ['--noprofile', '--norc', '-c', `${validator}\nvalidate_backup_runtime_directory`], {
      encoding: 'utf8', timeout: 5_000, env: { PATH: '/usr/bin:/bin', RUNTIME_DIR: path },
    })
    assert.equal(run().status, 0)
    const after = lstatSync(runtime)
    for (const field of ['dev', 'ino', 'uid', 'gid', 'mode', 'ctimeMs']) assert.equal(after[field], before[field], field)
    assert.equal(lstatSync(proof).mode & 0o777, 0o600)
    assert.equal(readFileSync(proof, 'utf8'), '{"synthetic":true}\n')
    chmodSync(runtime, 0o700)
    assert.notEqual(run().status, 0)
    assert.equal(lstatSync(runtime).mode & 0o777, 0o700, 'invalid ACL must not be silently rewritten')
    assert.notEqual(run(join(root, 'missing')).status, 0)
    assert.notEqual(run(proof).status, 0)
    chmodSync(runtime, 0o750)
    const link = join(root, 'linked-runtime')
    symlinkSync(runtime, link, 'dir')
    assert.notEqual(run(link).status, 0)
    assert.equal(lstatSync(runtime).mode & 0o777, 0o750)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('retenția backupului vine exclusiv din contractul runtime', () => {
  assert.match(backup, /PRIVACY_BACKUP_RETENTION_DAYS=/)
  assert.match(backup, /retention_values/)
  assert.doesNotMatch(backup, /BACKUP_KEEP_DAYS|KEEP_DAYS=\$\{[^}]+:-60\}/)
})

test('credentiala PostgreSQL nu intră în argv sau în Config.Env Docker', () => {
  assert.match(backup, /temporary_libpq_env/)
  assert.match(backup, /export \{name\}=\{shlex\.quote\(value\)\}/)
  assert.match(backup, /-v "\$temporary_libpq_env:\/run\/secrets\/libpq-env:ro"/)
  assert.match(backup, /\. \/run\/secrets\/libpq-env; exec pg_dump/)
  assert.doesNotMatch(backup, /pg_dump[^\n]*\$\(cat|pg_dump[^\n]*database-url/)
  assert.doesNotMatch(backup, /-e\s+(?:DATABASE_URL|PGPASSWORD)=/)
})

test('plaintextul folosește o identitate numerică absentă pe host și revine imediat la root', () => {
  assert.match(backup, /BACKUP_CONTAINER_UID=15050/)
  assert.match(backup, /BACKUP_CONTAINER_GID=15050/)
  assert.match(backup, /getent passwd "\$BACKUP_CONTAINER_UID"[\s\S]*getent group "\$BACKUP_CONTAINER_GID"/)
  assert.match(backup, /--user "\$BACKUP_CONTAINER_UID:\$BACKUP_CONTAINER_GID"/)
  assert.match(backup, /pg_dump[^\n]*--no-privileges'[\s\\]*\n\s*> "\$temporary_dump"[\s\S]*chown root:root "\$temporary_dump" "\$temporary_libpq_env"/)
  assert.doesNotMatch(backup, /pg_dump[^\n]*(?:--file(?:=|\s)|\s-f(?:=|\s))/)
  assert.match(backup, /pg_restore[^\n]*--dbname=kelion_restore_probe[\s\S]*< "\$temporary_restore"/)
  assert.doesNotMatch(backup, /chown (?:1000|999):|--user (?:1000|999):/)
})

test('backupul, manifestul și dovada sunt durabile înainte de migrator', () => {
  const scratchRestore = backup.indexOf("' < \"$temporary_restore\"")
  const publishBackup = backup.indexOf('mv "$temporary_output" "$output"', scratchRestore)
  const publishManifest = backup.indexOf('mv "$temporary_manifest" "$output.mac"', publishBackup)
  const syncBackup = backup.indexOf('sync_file_and_parent "$output"', publishManifest)
  const syncManifest = backup.indexOf('sync_file_and_parent "$output.mac"', syncBackup)
  const publishProof = backup.indexOf('mv "$temporary_proof" "$PROOF_FILE"', syncManifest)
  const syncProof = backup.indexOf('sync_file_and_parent "$PROOF_FILE"', publishProof)

  assert.match(backup, /sync_file_and_parent\(\)[\s\S]*os\.fsync\(handle\.fileno\(\)\)[\s\S]*os\.fsync\(fd\)/)
  assert.match(backup, /temporary_output=\$\(mktemp[\s\S]*openssl enc[^\n]*-out "\$temporary_output"/)
  assert.ok(scratchRestore >= 0 && publishBackup > scratchRestore)
  assert.ok(publishManifest > publishBackup && syncBackup > publishManifest && syncManifest > syncBackup)
  assert.ok(publishProof > syncManifest && syncProof > publishProof)
  assert.ok(backup.indexOf('sync_file_and_parent "$KEY_FILE"') < backup.indexOf('temporary_output=$(mktemp'))
})

test('release-ul instalează atomic și apelează scriptul persistent', () => {
  assert.match(deploy, /PERSISTENT_BACKUP_SCRIPT=\$BACKUP_RELEASE_ROOT\/\$COMMIT_SHA\/backup\.sh/)
  assert.match(deploy, /mktemp "\$BACKUP_RELEASE_ROOT\/\$COMMIT_SHA\/backup\.XXXXXX"[\s\S]*mv -f -- "\$candidate" "\$PERSISTENT_BACKUP_SCRIPT"/)
  const installCall = deploy.indexOf('\ninstall_persistent_backup_script\n')
  const backupCall = deploy.indexOf('\n"$PERSISTENT_BACKUP_SCRIPT"\n', installCall)
  assert.ok(installCall >= 0 && backupCall > installCall)
  assert.doesNotMatch(deploy, /bash "\$BUNDLE_DIR\/backup\.sh"/)
})

test('timerul este verificat și cronul exact este retras numai după smoke', () => {
  const smoke = deploy.indexOf("[ \"$public_ok\" = 1 ] || die 'smoke-ul public")
  const activate = deploy.lastIndexOf('\nactivate_persistent_backup_script\n')
  const schedule = deploy.lastIndexOf('\ninstall_backup_schedule\n')
  const retire = deploy.lastIndexOf('\nretire_legacy_backup_cron\n')
  assert.ok(smoke >= 0 && activate > smoke && schedule > activate && retire > schedule)
  assert.match(deploy, /ln -s "releases\/\$COMMIT_SHA" "\$candidate_link"[\s\S]*mv -Tf -- "\$candidate_link" "\$BACKUP_CURRENT_LINK"/)
  assert.match(deploy, /systemctl enable --now "\$BACKUP_TIMER"/)
  assert.match(deploy, /systemctl is-enabled --quiet "\$BACKUP_TIMER"/)
  assert.match(deploy, /systemctl is-active --quiet "\$BACKUP_TIMER"/)
  assert.match(deploy, /NextElapseUSecRealtime/)
  assert.match(deploy, /LEGACY_BACKUP_CRON='0 3 \* \* 0 \/root\/kelion\/backup\.sh >> \/root\/kelion\/backup\.log 2>&1'/)
  assert.match(deploy, /\$0 == target/)
  assert.match(deploy, /cmp -s "\$after" "\$observed"/)
  assert.doesNotMatch(deploy, /crontab\s+(?:-u root\s+)?-r/)
})

test('schedulerul este restaurat fără rollback DB după point-of-no-return', () => {
  const smoke = deploy.indexOf("[ \"$public_ok\" = 1 ] || die 'smoke-ul public")
  const snapshot = deploy.lastIndexOf('\nsnapshot_backup_schedule\n')
  const mutating = deploy.lastIndexOf('\nbackup_schedule_mutating=1\n')
  const activate = deploy.lastIndexOf('\nactivate_persistent_backup_script\n')
  const completed = deploy.lastIndexOf('\nbackup_schedule_mutating=0\n')
  assert.ok(smoke >= 0 && snapshot > smoke && mutating > snapshot && activate > mutating && completed > activate)
  assert.match(deploy, /rollback_switch\(\) \{[\s\S]*if ! rollback_backup_schedule; then[\s\S]*restart_previous_slot/)
  assert.match(deploy, /recover_schedule_after_point_of_no_return\(\) \{[\s\S]*rollback_backup_schedule[\s\S]*cleanup_backup_schedule_snapshot/)
  assert.match(deploy, /if \[ "\$point_of_no_return" = 1 \]; then[\s\S]*recover_schedule_after_point_of_no_return[\s\S]*else[\s\S]*rollback_switch/)
  assert.match(deploy, /rollback_backup_schedule\(\) \{[\s\S]*systemctl disable --now "\$BACKUP_TIMER"[\s\S]*readlink "\$BACKUP_CURRENT_LINK"[\s\S]*systemctl daemon-reload/)
  assert.match(deploy, /backup_previous_timer_enabled[\s\S]*systemctl enable "\$BACKUP_TIMER"/)
  assert.match(deploy, /backup_previous_timer_active[\s\S]*systemctl start "\$BACKUP_TIMER"/)
  assert.match(deploy, /crontab -u root "\$backup_schedule_snapshot_dir\/root-crontab"[\s\S]*cmp -s "\$backup_schedule_snapshot_dir\/root-crontab" "\$observed"/)
  assert.match(deploy, /restore_snapshot_file "\$backup_schedule_snapshot_dir\/legacy-cron-marker"/)
  assert.doesNotMatch(deploy, /rollback_backup_schedule\(\)[\s\S]*systemctl disable --now "\$BACKUP_TIMER"[^\n]*\|\| true/)
})

test('unitățile persistente rulează zilnic, cu lock-ul scriptului și hardening', () => {
  assert.match(service, /^ExecStart=\/opt\/kelion-backup\/current\/backup\.sh$/m)
  assert.match(service, /^ConditionFileIsExecutable=\/opt\/kelion-backup\/current\/backup\.sh$/m)
  assert.doesNotMatch(service, /^ConditionPathIsExecutable=/m)
  assert.match(service, /^NoNewPrivileges=true$/m)
  assert.match(service, /^ProtectSystem=strict$/m)
  assert.match(timer, /^OnCalendar=\*-\*-\* 03:17:00 UTC$/m)
  assert.match(timer, /^Persistent=true$/m)
  assert.match(backup, /flock -n 9/)
})
