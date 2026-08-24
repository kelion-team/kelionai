#!/usr/bin/env bash
set -eEuo pipefail
set +x
umask 077

ROOT=/root/kelion
BACKUP_DIRECTORY=$ROOT/backups
BACKUP_KEY_FILE=$ROOT/backup.key
DATABASE_URL_FILE=$ROOT/secrets/database-url
PROOF_KEY_FILE=$ROOT/secrets/migration-backup-proof-key
RUNTIME_DIRECTORY=$ROOT/runtime
PUBLICATION_LOCK=$ROOT/publicare.lock
BACKUP_LOCK=$ROOT/backup.lock
RESTORE_LOCK=$ROOT/restore.lock
BUNDLE_DIRECTORY=$(cd -- "$(dirname -- "$0")" && pwd -P)
VALIDATOR=$BUNDLE_DIRECTORY/lib/restore-verified-backup.mjs

error_code=restore_failed
operation_mode=restore
completed=0
postgres_ready=0
swap_started=0
work=''
database=''
database_user=''
scratch_database=''
quarantine_database=''
failed_database=''
preserved_database=''

fail() {
  error_code=$1
  return 1
}

need() {
  command -v "$1" >/dev/null 2>&1 || fail "missing_$1"
}

psql_admin() {
  PGDATABASE=postgres psql -X --no-psqlrc --quiet --no-align --tuples-only \
    --set ON_ERROR_STOP=1 "$@"
}

# Read-only contract shared by preflight on the live legacy database and by
# recovery on the restored scratch database. A zero result proves that every
# required object is a public table/partitioned table with the expected column.
verify_legacy_contract() {
  local contract_database=$1 missing_count
  missing_count=$(PGDATABASE="$contract_database" psql \
    -X --no-psqlrc --quiet --no-align --tuples-only --set ON_ERROR_STOP=1 <<'SQL'
WITH required(table_name, column_name) AS (
  VALUES
    ('messages', 'id'), ('messages', 'user_email'), ('messages', 'role'),
    ('messages', 'content'), ('messages', 'created_at'),
    ('user_prefs', 'user_email'),
    ('wallets', 'user_email'), ('wallets', 'balance'), ('wallets', 'currency'),
    ('wallets', 'topup_ref'),
    ('billing_events', 'id'), ('billing_events', 'user_email'),
    ('billing_events', 'kind'), ('billing_events', 'amount'),
    ('billing_events', 'ref'), ('billing_events', 'created_at'),
    ('transactions', 'id'), ('transactions', 'user_id'), ('transactions', 'amount'),
    ('transactions', 'credits'), ('transactions', 'status'),
    ('transactions', 'payment_ref'), ('transactions', 'created_at'),
    ('cost_events', 'id'), ('cost_events', 'user_email'), ('cost_events', 'kind'),
    ('cost_events', 'cost_usd'), ('cost_events', 'created_at'),
    ('memories', 'user_email'), ('memories', 'content'),
    ('google_accounts', 'email'), ('google_accounts', 'refresh_token'),
    ('local_accounts', 'email'), ('local_accounts', 'pass_hash'),
    ('visits', 'id'), ('visits', 'fingerprint'), ('visits', 'ip'),
    ('visits', 'country'), ('visits', 'country_code'), ('visits', 'city'),
    ('visits', 'region'), ('visits', 'isp'), ('visits', 'tz'),
    ('visits', 'browser'), ('visits', 'os'), ('visits', 'device'),
    ('visits', 'lang'), ('visits', 'referrer'), ('visits', 'is_bot'),
    ('visits', 'started_at'), ('visits', 'user_email'),
    ('visits', 'last_seen_at'), ('visits', 'actions'),
    ('visits', 'photo_url'), ('visits', 'pages'),
    ('demo_uses', 'id'), ('demo_uses', 'fingerprint'), ('demo_uses', 'ip'),
    ('demo_uses', 'country'), ('demo_uses', 'country_code'),
    ('demo_uses', 'city'), ('demo_uses', 'region'), ('demo_uses', 'isp'),
    ('demo_uses', 'tz'), ('demo_uses', 'browser'), ('demo_uses', 'os'),
    ('demo_uses', 'device'), ('demo_uses', 'lang'),
    ('demo_uses', 'referrer'), ('demo_uses', 'is_bot'),
    ('demo_uses', 'started_at'), ('demo_uses', 'session_email'),
    ('app_files', 'name'), ('app_files', 'content'),
    ('app_files', 'content_type'), ('app_files', 'updated_at'),
    ('app_downloads', 'id'), ('app_downloads', 'file'),
    ('app_downloads', 'user_email'), ('app_downloads', 'ip'),
    ('app_downloads', 'country'), ('app_downloads', 'ua'),
    ('app_downloads', 'created_at'),
    ('client_errors', 'id'), ('client_errors', 'type'),
    ('client_errors', 'message'), ('client_errors', 'stack'),
    ('client_errors', 'url'), ('client_errors', 'ip'),
    ('client_errors', 'created_at'),
    ('voiceprints', 'user_email'), ('voiceprints', 'name'),
    ('voiceprints', 'gender'), ('voiceprints', 'is_admin'),
    ('voiceprints', 'features'), ('voiceprints', 'feature_meta'),
    ('voiceprints', 'audio_clip'), ('voiceprints', 'created_at'),
    ('voiceprints', 'updated_at')
), missing AS (
  SELECT required.table_name, required.column_name
  FROM required
  LEFT JOIN information_schema.columns actual
    ON actual.table_schema = 'public'
   AND actual.table_name = required.table_name
   AND actual.column_name = required.column_name
  WHERE actual.column_name IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
         AND relation.relname = required.table_name
         AND relation.relkind IN ('r', 'p')
     )
)
SELECT count(*) FROM missing;
SQL
  ) || return 1
  [ "$missing_count" = 0 ]
}

database_state() {
  psql_admin \
    --set=target_database="$database" \
    --set=scratch_database="$scratch_database" \
    --set=quarantine_database="$quarantine_database" \
    --set=failed_database="$failed_database" \
    --set=expected_user="$database_user" <<'SQL'
SELECT json_build_object(
  'target', EXISTS (SELECT 1 FROM pg_database WHERE datname = :'target_database'),
  'scratch', EXISTS (SELECT 1 FROM pg_database WHERE datname = :'scratch_database'),
  'quarantine', EXISTS (SELECT 1 FROM pg_database WHERE datname = :'quarantine_database'),
  'failed', EXISTS (SELECT 1 FROM pg_database WHERE datname = :'failed_database'),
  'targetAllowsConnections', COALESCE((
    SELECT datallowconn FROM pg_database WHERE datname = :'target_database'
  ), false),
  'quarantineDisallowsConnections', COALESCE((
    SELECT NOT datallowconn FROM pg_database WHERE datname = :'quarantine_database'
  ), false),
  'targetOwnedByExpectedUser', COALESCE((
    SELECT pg_get_userbyid(datdba) = :'expected_user'
    FROM pg_database WHERE datname = :'target_database'
  ), false),
  'quarantineOwnedByExpectedUser', COALESCE((
    SELECT pg_get_userbyid(datdba) = :'expected_user'
    FROM pg_database WHERE datname = :'quarantine_database'
  ), false)
);
SQL
}

verify_lock_fd_identity() {
  local fd=$1 path=$2 label=$3 fd_path fd_target fd_identity path_identity
  fd_path=/proc/self/fd/$fd
  [ -e "$fd_path" ] || fail "${label}_lock_fd_missing"
  [ -f "$path" ] && [ ! -L "$path" ] || fail "${label}_lock_file_invalid"
  [ -f "$fd_path" ] || fail "${label}_lock_fd_invalid"
  fd_target=$(readlink -- "$fd_path") || fail "${label}_lock_fd_invalid"
  [ "$fd_target" = "$path" ] || fail "${label}_lock_fd_path_mismatch"
  fd_identity=$(stat -Lc '%d:%i' -- "$fd_path") || fail "${label}_lock_fd_invalid"
  path_identity=$(stat -Lc '%d:%i' -- "$path") || fail "${label}_lock_file_invalid"
  [ "$fd_identity" = "$path_identity" ] || fail "${label}_lock_fd_mismatch"
  [ "$(stat -Lc '%h' -- "$fd_path")" = 1 ] || fail "${label}_lock_file_invalid"
}

verify_lock_fd() {
  local fd=$1 path=$2 label=$3 lock_metadata
  verify_lock_fd_identity "$fd" "$path" "$label"
  lock_metadata=$(stat -Lc '%u:%g:%a:%h' -- "/proc/self/fd/$fd") \
    || fail "${label}_lock_file_invalid"
  [ "$lock_metadata" = '0:0:600:1' ] || fail "${label}_lock_file_invalid"
}

normalize_lock_fd() {
  local fd=$1 path=$2 label=$3 fd_path
  fd_path=/proc/self/fd/$fd
  verify_lock_fd_identity "$fd" "$path" "$label"
  chown 0:0 -- "$fd_path" || fail "${label}_lock_metadata_normalization_failed"
  chmod 0600 -- "$fd_path" || fail "${label}_lock_metadata_normalization_failed"
  verify_lock_fd "$fd" "$path" "$label"
}

verify_publication_lock_fd() {
  verify_lock_fd 8 "$PUBLICATION_LOCK" publication
}

acquire_publication_lock() {
  case "${KELION_PUBLICATION_LOCK_HELD:-0}" in
    0)
      if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
        [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
          || fail publication_lock_file_invalid
      fi
      exec 8<>"$PUBLICATION_LOCK"
      normalize_lock_fd 8 "$PUBLICATION_LOCK" publication
      ;;
    1)
      # deploy.sh owns FD 8 already. Bash children inherit the same open file
      # description, so this re-lock succeeds without competing with the parent.
      verify_publication_lock_fd
      ;;
    *) fail inherited_publication_lock_flag_invalid ;;
  esac
  flock -n 8 || fail release_operation_active
}

set_connections() {
  local name=$1 allowed=$2
  psql_admin --set=database_name="$name" --set=allow_connections="$allowed" >/dev/null <<'SQL'
SELECT format(
  'ALTER DATABASE %I WITH ALLOW_CONNECTIONS %s',
  :'database_name',
  CASE :'allow_connections' WHEN 'true' THEN 'true' ELSE 'false' END
)
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = :'database_name');
\gexec
SQL
}

terminate_connections() {
  local name=$1
  psql_admin --set=database_name="$name" >/dev/null <<'SQL'
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'database_name' AND pid <> pg_backend_pid();
SQL
  local remaining
  remaining=$(psql_admin --set=database_name="$name" <<'SQL'
SELECT count(*) FROM pg_stat_activity
WHERE datname = :'database_name' AND pid <> pg_backend_pid();
SQL
  )
  [ "$remaining" = 0 ]
}

rename_database() {
  local source=$1 destination=$2
  psql_admin --set=source_database="$source" --set=destination_database="$destination" >/dev/null <<'SQL'
SELECT format('ALTER DATABASE %I RENAME TO %I', :'source_database', :'destination_database')
WHERE EXISTS (SELECT 1 FROM pg_database WHERE datname = :'source_database')
  AND NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'destination_database');
\gexec
SQL
  local renamed
  renamed=$(psql_admin --set=source_database="$source" --set=destination_database="$destination" <<'SQL'
SELECT (
  NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'source_database')
  AND EXISTS (SELECT 1 FROM pg_database WHERE datname = :'destination_database')
)::int;
SQL
  )
  [ "$renamed" = 1 ]
}

preserve_scratch_database() {
  local state scratch_exists failed_exists
  state=$(database_state) || return 1
  scratch_exists=$(jq -er '.scratch' <<<"$state") || return 1
  failed_exists=$(jq -er '.failed' <<<"$state") || return 1
  if [ "$scratch_exists" = true ]; then
    [ "$failed_exists" = false ] || return 1
    set_connections "$scratch_database" false || return 1
    terminate_connections "$scratch_database" || return 1
    rename_database "$scratch_database" "$failed_database" || return 1
    preserved_database=$failed_database
  elif [ "$failed_exists" = true ]; then
    preserved_database=$failed_database
  fi
}

rollback_swap() {
  local state target_exists scratch_exists quarantine_exists failed_exists
  state=$(database_state) || return 1
  target_exists=$(jq -er '.target' <<<"$state") || return 1
  scratch_exists=$(jq -er '.scratch' <<<"$state") || return 1
  quarantine_exists=$(jq -er '.quarantine' <<<"$state") || return 1
  failed_exists=$(jq -er '.failed' <<<"$state") || return 1

  if [ "$quarantine_exists" = true ]; then
    [ "$failed_exists" = false ] || return 1
    if [ "$target_exists" = true ]; then
      [ "$scratch_exists" = false ] || return 1
      set_connections "$database" false || return 1
      terminate_connections "$database" || return 1
      rename_database "$database" "$failed_database" || return 1
      preserved_database=$failed_database
    fi
    rename_database "$quarantine_database" "$database" || return 1
  fi
  set_connections "$database" true || return 1
  preserve_scratch_database || return 1
  state=$(database_state) || return 1
  [ "$(jq -er '.target' <<<"$state")" = true ] || return 1
  [ "$(jq -er '.quarantine' <<<"$state")" = false ] || return 1
  [ "$(jq -er '.scratch' <<<"$state")" = false ] || return 1
}

on_exit() {
  local rc=$?
  trap - EXIT HUP INT TERM
  set +e
  if [ "$rc" -ne 0 ] && [ "$postgres_ready" = 1 ] && [ "$operation_mode" = restore ]; then
    if [ "$swap_started" = 1 ]; then
      if ! rollback_swap >/dev/null 2>&1; then
        error_code=restore_rollback_failed
      fi
    else
      if ! preserve_scratch_database >/dev/null 2>&1; then
        error_code=restore_failure_quarantine_failed
      fi
    fi
  fi
  if [ -n "$work" ]; then
    case "$work" in
      "$RUNTIME_DIRECTORY"/verified-restore.*)
        if ! rm -rf -- "$work"; then
          error_code=restore_cleanup_failed
          rc=1
        fi
        ;;
      *) error_code=restore_cleanup_path_invalid; rc=1 ;;
    esac
  fi
  if [ "$rc" -ne 0 ] || [ "$completed" != 1 ]; then
    if [ -n "$preserved_database" ]; then
      printf '{"schema":1,"ok":false,"error":"%s","preservedDatabase":"%s"}\n' \
        "$error_code" "$preserved_database" >&2
    else
      printf '{"schema":1,"ok":false,"error":"%s","preservedDatabase":null}\n' \
        "$error_code" >&2
    fi
    [ "$rc" -ne 0 ] || rc=1
  fi
  exit "$rc"
}

trap on_exit EXIT
trap 'error_code=restore_interrupted; exit 130' HUP INT TERM

[ "$(id -u)" -eq 0 ] || fail restore_requires_root
if [ "${1:-}" = --preflight ]; then
  [ "$#" -eq 2 ] || fail restore_preflight_proof_argument_required
  operation_mode=preflight
  proof_file=$2
else
  [ "$#" -eq 1 ] || fail restore_proof_argument_required
  [ "${KELION_RESTORE_APPROVED:-0}" = 1 ] || fail restore_approval_required
  proof_file=$1
fi
case "$proof_file" in
  /*) ;;
  *) fail restore_proof_path_must_be_absolute ;;
esac
case "$proof_file" in *$'\n'*|*$'\r'*) fail restore_proof_path_invalid ;; esac

need flock
need node
need jq
need openssl
need psql
need pg_restore
need df
need stat
need readlink
need chown
need sha256sum

psql_version=$(psql --version)
pg_restore_version=$(pg_restore --version)
[[ "$psql_version" =~ \(PostgreSQL\)[[:space:]]16\. ]] || fail psql_16_required
[[ "$pg_restore_version" =~ \(PostgreSQL\)[[:space:]]16\. ]] || fail pg_restore_16_required

[ -d "$RUNTIME_DIRECTORY" ] && [ ! -L "$RUNTIME_DIRECTORY" ] || fail restore_runtime_directory_invalid
[ "$(stat -Lc '%u:%g:%a' -- "$RUNTIME_DIRECTORY")" = '0:0:700' ] \
  || fail restore_runtime_directory_invalid
[ -f "$VALIDATOR" ] && [ ! -L "$VALIDATOR" ] || fail restore_validator_invalid

# Same acquisition order as deploy.sh -> backup.sh. A direct invocation takes
# the publication lock here; a child of deploy.sh explicitly reuses its verified
# inherited FD 8 instead of opening a competing file description.
acquire_publication_lock
if [ -e "$BACKUP_LOCK" ] || [ -L "$BACKUP_LOCK" ]; then
  [ -f "$BACKUP_LOCK" ] && [ ! -L "$BACKUP_LOCK" ] || fail backup_lock_file_invalid
fi
exec 7<>"$BACKUP_LOCK"
normalize_lock_fd 7 "$BACKUP_LOCK" backup
flock -n 7 || fail backup_operation_active
if [ -e "$RESTORE_LOCK" ] || [ -L "$RESTORE_LOCK" ]; then
  [ -f "$RESTORE_LOCK" ] && [ ! -L "$RESTORE_LOCK" ] || fail restore_lock_file_invalid
fi
exec 9<>"$RESTORE_LOCK"
normalize_lock_fd 9 "$RESTORE_LOCK" restore
flock -n 9 || fail restore_operation_active

work=$(mktemp -d "$RUNTIME_DIRECTORY/verified-restore.XXXXXX")
chmod 0700 "$work"
plan_file=$work/plan.json
encryption_key_file=$work/encryption-key
pgpass_file=$work/pgpass
plaintext_dump=$work/backup.dump
diagnostic_file=$work/diagnostic.log

if ! KELION_BACKUP_DIRECTORY="$BACKUP_DIRECTORY" \
  KELION_BACKUP_KEY_FILE="$BACKUP_KEY_FILE" \
  KELION_DATABASE_URL_FILE="$DATABASE_URL_FILE" \
  KELION_PROOF_KEY_FILE="$PROOF_KEY_FILE" \
  KELION_RESTORE_PROOF_FILE="$proof_file" \
  KELION_RESTORE_PLAN_FILE="$plan_file" \
  KELION_RESTORE_ENCRYPTION_KEY_FILE="$encryption_key_file" \
  KELION_RESTORE_PGPASS_FILE="$pgpass_file" \
  node "$VALIDATOR" >/dev/null 2>"$diagnostic_file"; then
  fail restore_backup_validation_failed
fi

jq -e '
  (keys == [
    "backupPath", "backupSha256", "database", "failedDatabase", "host",
    "port", "quarantineDatabase", "schema", "scratchDatabase", "user"
  ])
  and .schema == 1
  and (.backupPath | test("^/root/kelion/backups/kelion-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\\.dump\\.enc$"))
  and (.backupSha256 | test("^[a-f0-9]{64}$"))
  and (.database | test("^[A-Za-z_][A-Za-z0-9_$]{0,62}$"))
  and (.user | test("^[A-Za-z_][A-Za-z0-9_$]{0,62}$"))
  and (.host == "/var/run/postgresql")
  and (.port | test("^[0-9]{1,5}$"))
  and (.scratchDatabase | test("^kelion_restore_[a-f0-9]{12}$"))
  and (.quarantineDatabase | test("^kelion_quarantine_[0-9]{14}_[a-f0-9]{6}$"))
  and (.failedDatabase | test("^kelion_restore_failed_[a-f0-9]{12}$"))
' "$plan_file" >/dev/null || fail restore_plan_invalid

backup_path=$(jq -er '.backupPath' "$plan_file")
backup_sha256=$(jq -er '.backupSha256' "$plan_file")
database=$(jq -er '.database' "$plan_file")
database_user=$(jq -er '.user' "$plan_file")
pg_host=$(jq -er '.host' "$plan_file")
pg_port=$(jq -er '.port' "$plan_file")
scratch_database=$(jq -er '.scratchDatabase' "$plan_file")
quarantine_database=$(jq -er '.quarantineDatabase' "$plan_file")
failed_database=$(jq -er '.failedDatabase' "$plan_file")

[ -f "$backup_path" ] && [ ! -L "$backup_path" ] || fail restore_backup_file_invalid
[ "$(stat -Lc '%u:%g:%a:%h' -- "$backup_path")" = '0:0:600:1' ] \
  || fail restore_backup_file_invalid
checksum_line=$(sha256sum -- "$backup_path") || fail restore_backup_hash_unavailable
[ "${checksum_line%% *}" = "$backup_sha256" ] || fail restore_backup_hash_changed

export PGHOST=$pg_host PGPORT=$pg_port PGUSER=$database_user PGPASSFILE=$pgpass_file
export PGCONNECT_TIMEOUT=10 PGAPPNAME=kelion-verified-restore
unset PGPASSWORD DATABASE_URL DATABASE_URL_FILE

# pg_restore can stop reading a custom archive after its TOC, which would send
# SIGPIPE to a streaming decryptor. Decrypt exactly once into the root-only
# work directory, validate the complete file, then reuse it for restore. In
# --preflight the EXIT cleanup removes it without any database mutation.
if ! openssl enc -d -aes-256-cbc -pbkdf2 \
  -in "$backup_path" -pass file:"$encryption_key_file" -out "$plaintext_dump" \
  2>"$diagnostic_file"; then
  fail restore_backup_decryption_failed
fi
chmod 0400 "$plaintext_dump"
if ! pg_restore --list < "$plaintext_dump" >/dev/null 2>"$diagnostic_file"; then
  fail restore_dump_format_invalid
fi

if ! preflight=$(psql_admin \
  --set=target_database="$database" \
  --set=expected_user="$database_user" \
  --set=scratch_database="$scratch_database" \
  --set=quarantine_database="$quarantine_database" \
  --set=failed_database="$failed_database" 2>"$diagnostic_file" <<'SQL'
WITH role_state AS (
  SELECT rolsuper, rolcreatedb FROM pg_roles WHERE rolname = current_user
), database_state AS (
  SELECT datdba, datallowconn, datistemplate
  FROM pg_database WHERE datname = :'target_database'
)
SELECT json_build_object(
  'serverVersionNum', current_setting('server_version_num')::integer,
  'currentUserMatches', current_user = :'expected_user',
  'roleCanCreateDatabase', COALESCE((SELECT rolsuper OR rolcreatedb FROM role_state), false),
  'databaseExists', EXISTS (SELECT 1 FROM database_state),
  'databaseOwnedByUser', COALESCE((SELECT pg_get_userbyid(datdba) = :'expected_user' FROM database_state), false),
  'databaseAllowsConnections', COALESCE((SELECT datallowconn FROM database_state), false),
  'databaseIsNotTemplate', COALESCE((SELECT NOT datistemplate FROM database_state), false),
  'databaseSizeBytes', COALESCE(pg_database_size(:'target_database'), 0),
  'scratchAbsent', NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'scratch_database'),
  'quarantineAbsent', NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'quarantine_database'),
  'failedAbsent', NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'failed_database')
);
SQL
); then
  fail restore_database_preflight_failed
fi
jq -e '
  (.serverVersionNum >= 160000 and .serverVersionNum < 170000)
  and .currentUserMatches
  and .roleCanCreateDatabase
  and .databaseExists
  and .databaseOwnedByUser
  and .databaseAllowsConnections
  and .databaseIsNotTemplate
  and (.databaseSizeBytes > 0)
  and .scratchAbsent
  and .quarantineAbsent
  and .failedAbsent
' <<<"$preflight" >/dev/null || fail restore_database_preflight_rejected

database_size=$(jq -er '.databaseSizeBytes' <<<"$preflight")
[[ "$database_size" =~ ^[0-9]+$ ]] || fail restore_database_size_invalid
[ "$database_size" -le 4611686017890516991 ] || fail restore_disk_capacity_overflow
backup_size=$(stat -Lc '%s' -- "$backup_path") || fail restore_backup_size_unavailable
[[ "$backup_size" =~ ^[0-9]+$ ]] && [ "$backup_size" -gt 0 ] \
  || fail restore_backup_size_invalid
data_directory=$(psql_admin 2>"$diagnostic_file" <<'SQL'
SHOW data_directory;
SQL
) || fail restore_data_directory_unavailable
case "$data_directory" in /*) ;; *) fail restore_data_directory_invalid ;; esac
[ -d "$data_directory" ] || fail restore_data_directory_invalid
available_bytes=$(df --output=avail -B1 -- "$data_directory" | tail -n 1 | tr -d '[:space:]') \
  || fail restore_disk_capacity_unknown
[[ "$available_bytes" =~ ^[0-9]+$ ]] || fail restore_disk_capacity_unknown
# Free space must hold both the scratch cluster-sized restore and a decrypted
# custom archive that can approach the source database size, plus a fixed
# operational margin. The live database is already reflected in df's usage.
required_bytes=$((database_size * 2 + 1073741824))
[ "$available_bytes" -ge "$required_bytes" ] || fail restore_disk_capacity_insufficient

if [ "$operation_mode" = preflight ]; then
  if ! verify_legacy_contract "$database" 2>"$diagnostic_file"; then
    fail restore_preflight_legacy_contract_invalid
  fi
  server_version_num=$(jq -er '.serverVersionNum' <<<"$preflight")
  jq -cn \
    --arg status restore_preflight_ok \
    --arg backupSha256 "$backup_sha256" \
    --arg database "$database" \
    --argjson serverVersionNum "$server_version_num" \
    --argjson requiredBytes "$required_bytes" \
    --argjson availableBytes "$available_bytes" \
    '{schema:1,ok:true,action:"restore_verified_backup_preflight",status:$status,backupSha256:$backupSha256,database:$database,serverVersionNum:$serverVersionNum,requiredBytes:$requiredBytes,availableBytes:$availableBytes}'
  completed=1
  exit 0
fi

postgres_ready=1

if ! psql_admin --set=scratch_database="$scratch_database" --set=database_owner="$database_user" \
  >/dev/null 2>"$diagnostic_file" <<'SQL'
SELECT format(
  'CREATE DATABASE %I WITH TEMPLATE template0 OWNER %I',
  :'scratch_database',
  :'database_owner'
);
\gexec
SQL
then
  fail restore_scratch_create_failed
fi

if ! PGDATABASE="$scratch_database" pg_restore \
  --exit-on-error --single-transaction --no-owner --no-privileges \
  < "$plaintext_dump" >/dev/null 2>"$diagnostic_file"; then
  fail restore_scratch_import_failed
fi

if ! verify_legacy_contract "$scratch_database" 2>"$diagnostic_file"; then
  fail restore_legacy_contract_invalid
fi

swap_started=1
if ! psql_admin \
  --set=target_database="$database" \
  --set=scratch_database="$scratch_database" \
  --set=quarantine_database="$quarantine_database" \
  >/dev/null 2>"$diagnostic_file" <<'SQL'
SELECT format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS false', :'scratch_database');
\gexec
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'scratch_database' AND pid <> pg_backend_pid();
SELECT format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS false', :'target_database');
\gexec
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = :'target_database' AND pid <> pg_backend_pid();
SELECT format('ALTER DATABASE %I RENAME TO %I', :'target_database', :'quarantine_database');
\gexec
SELECT format('ALTER DATABASE %I RENAME TO %I', :'scratch_database', :'target_database');
\gexec
SELECT format('ALTER DATABASE %I WITH ALLOW_CONNECTIONS true', :'target_database');
\gexec
SQL
then
  fail restore_database_swap_failed
fi

final_state=$(database_state) || fail restore_final_state_unavailable
jq -e '
  .target
  and (not .scratch)
  and .quarantine
  and (not .failed)
  and .targetAllowsConnections
  and .quarantineDisallowsConnections
  and .targetOwnedByExpectedUser
  and .quarantineOwnedByExpectedUser
' \
  <<<"$final_state" >/dev/null || fail restore_final_state_invalid

completed_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
record=$(mktemp "$RUNTIME_DIRECTORY/restore-record.XXXXXX")
jq -n \
  --arg backupSha256 "$backup_sha256" \
  --arg database "$database" \
  --arg quarantineDatabase "$quarantine_database" \
  --arg completedAt "$completed_at" \
  '{schema:1,ok:true,action:"restore_verified_backup",backupSha256:$backupSha256,database:$database,quarantineDatabase:$quarantineDatabase,completedAt:$completedAt}' \
  > "$record"
chmod 0600 "$record"
mv -f -- "$record" "$RUNTIME_DIRECTORY/last-restore.json"
completed=1
swap_started=0
cat "$RUNTIME_DIRECTORY/last-restore.json"
