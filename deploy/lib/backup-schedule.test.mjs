import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const deploy = read('deploy.sh')
const backup = read('backup.sh')
const service = read('systemd/kelion-backup.service')
const timer = read('systemd/kelion-backup.timer')

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

test('release-ul instalează atomic și apelează scriptul persistent', () => {
  assert.match(deploy, /PERSISTENT_BACKUP_SCRIPT=\$BACKUP_RELEASE_ROOT\/\$COMMIT_SHA\/backup\.sh/)
  assert.match(deploy, /mktemp "\$BACKUP_RELEASE_ROOT\/\$COMMIT_SHA\/backup\.XXXXXX"[\s\S]*mv -f -- "\$candidate" "\$PERSISTENT_BACKUP_SCRIPT"/)
  assert.match(deploy, /install_persistent_backup_script\n"\$PERSISTENT_BACKUP_SCRIPT"/)
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

test('orice eșec după cutover restaurează fail-closed schedulerul anterior', () => {
  const smoke = deploy.indexOf("[ \"$public_ok\" = 1 ] || die 'smoke-ul public")
  const snapshot = deploy.lastIndexOf('\nsnapshot_backup_schedule\n')
  const mutating = deploy.lastIndexOf('\nbackup_schedule_mutating=1\n')
  const activate = deploy.lastIndexOf('\nactivate_persistent_backup_script\n')
  const completed = deploy.lastIndexOf('\nbackup_schedule_mutating=0\n')
  assert.ok(smoke >= 0 && snapshot > smoke && mutating > snapshot && activate > mutating && completed > activate)
  assert.match(deploy, /rollback_switch\(\) \{[\s\S]*if ! rollback_backup_schedule; then[\s\S]*restart_previous_slot/)
  assert.match(deploy, /rollback_backup_schedule\(\) \{[\s\S]*systemctl disable --now "\$BACKUP_TIMER"[\s\S]*readlink "\$BACKUP_CURRENT_LINK"[\s\S]*systemctl daemon-reload/)
  assert.match(deploy, /backup_previous_timer_enabled[\s\S]*systemctl enable "\$BACKUP_TIMER"/)
  assert.match(deploy, /backup_previous_timer_active[\s\S]*systemctl start "\$BACKUP_TIMER"/)
  assert.match(deploy, /crontab -u root "\$backup_schedule_snapshot_dir\/root-crontab"[\s\S]*cmp -s "\$backup_schedule_snapshot_dir\/root-crontab" "\$observed"/)
  assert.match(deploy, /restore_snapshot_file "\$backup_schedule_snapshot_dir\/legacy-cron-marker"/)
  assert.doesNotMatch(deploy, /rollback_backup_schedule\(\)[\s\S]*systemctl disable --now "\$BACKUP_TIMER"[^\n]*\|\| true/)
})

test('unitățile persistente rulează zilnic, cu lock-ul scriptului și hardening', () => {
  assert.match(service, /^ExecStart=\/opt\/kelion-backup\/current\/backup\.sh$/m)
  assert.match(service, /^NoNewPrivileges=true$/m)
  assert.match(service, /^ProtectSystem=strict$/m)
  assert.match(timer, /^OnCalendar=\*-\*-\* 03:17:00 UTC$/m)
  assert.match(timer, /^Persistent=true$/m)
  assert.match(backup, /flock -n 9/)
})
