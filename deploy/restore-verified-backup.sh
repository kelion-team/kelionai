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
RESTORE_JOURNAL=$RUNTIME_DIRECTORY/restore-verified-backup.journal
RESTORE_RECORD=$RUNTIME_DIRECTORY/last-restore.json
BUNDLE_DIRECTORY=$(cd -- "$(dirname -- "$0")" && pwd -P)
VALIDATOR=$BUNDLE_DIRECTORY/lib/restore-verified-backup.mjs
# Identitatea autentificată a backupului rămâne legată de socketul Unix local.
# Control-plane-ul restore trebuie însă să se conecteze și la `postgres`, apoi
# la baza scratch. HBA-ul de producție permite parola pe socket numai pentru
# baza live și folosește peer pentru celelalte baze; helperul root nu trebuie
# să se dea drept utilizatorul OS postgres. TCP loopback păstrează conexiunea
# strict locală și folosește aceeași credențială prin PGPASSFILE pentru toate
# bazele implicate în restore.
DATABASE_CONTROL_HOST=127.0.0.1

error_code=restore_failed
operation_mode=restore
completed=0
postgres_ready=0
swap_started=0
journal_active=0
journal_mode=0
validator_journal_file=''
journal_phase=''
work=''
database=''
database_user=''
scratch_database=''
quarantine_database=''
failed_database=''
preserved_database=''
recovery_error_code=''
recovery_rolled_back=0
backup_path=''
backup_sha256=''
backup_size=''
target_oid=null
scratch_oid=null

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

# Read-only compatibility contract shared by preflight on the live database
# and by recovery on the restored scratch database. It follows the canonical,
# privacy-minimised schema: objects deliberately removed by one-way migrations
# must never be required again. A zero result proves that every required object
# is a public table/partitioned table with the expected column.
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
    ('visit_daily', 'day'), ('visit_daily', 'path'),
    ('visit_daily', 'country_code'), ('visit_daily', 'views'),
    ('visit_daily', 'last_seen_at'),
    ('user_presence_daily', 'user_email'), ('user_presence_daily', 'day'),
    ('user_presence_daily', 'first_seen_at'),
    ('user_presence_daily', 'last_seen_at'),
    ('user_presence_daily', 'actions'), ('user_presence_daily', 'pages'),
    ('client_errors', 'id'), ('client_errors', 'type'),
    ('client_errors', 'message'), ('client_errors', 'stack'),
    ('client_errors', 'url'), ('client_errors', 'account_id'),
    ('client_errors', 'created_at'),
    ('voiceprints', 'user_email'), ('voiceprints', 'name'),
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
  'targetOid', COALESCE((SELECT oid::bigint FROM pg_database WHERE datname = :'target_database'), 0),
  'scratchOid', COALESCE((SELECT oid::bigint FROM pg_database WHERE datname = :'scratch_database'), 0),
  'quarantineOid', COALESCE((SELECT oid::bigint FROM pg_database WHERE datname = :'quarantine_database'), 0),
  'failedOid', COALESCE((SELECT oid::bigint FROM pg_database WHERE datname = :'failed_database'), 0),
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
  ), false),
  'scratchOwnedByExpectedUser', COALESCE((
    SELECT pg_get_userbyid(datdba) = :'expected_user'
    FROM pg_database WHERE datname = :'scratch_database'
  ), false),
  'failedOwnedByExpectedUser', COALESCE((
    SELECT pg_get_userbyid(datdba) = :'expected_user'
    FROM pg_database WHERE datname = :'failed_database'
  ), false)
);
SQL
}

json_boolean() {
  local document=$1 field=$2 value
  value=$(jq -r --arg field "$field" '
    if (type == "object" and has($field) and (.[$field] | type == "boolean"))
    then .[$field]
    else error("invalid boolean")
    end
  ' <<<"$document") || return 1
  case "$value" in
    true|false) printf '%s\n' "$value" ;;
    *) return 1 ;;
  esac
}

json_oid() {
  local document=$1 field=$2 value
  value=$(jq -r --arg field "$field" '
    if (type == "object" and has($field) and (.[$field] | type == "number")
      and (.[$field] | floor == .) and .[$field] >= 0 and .[$field] <= 4294967295)
    then .[$field]
    else error("invalid oid")
    end
  ' <<<"$document") || return 1
  [[ "$value" =~ ^[0-9]+$ ]] || return 1
  printf '%s\n' "$value"
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

fsync_path() {
  sync -f "$1"
}

validate_restore_journal() {
  local journal_json canonical journal_bytes expected_bytes acl_listing acl_mode
  [ -f "$RESTORE_JOURNAL" ] && [ ! -L "$RESTORE_JOURNAL" ] \
    || fail restore_journal_file_invalid
  exec 6<"$RESTORE_JOURNAL"
  verify_lock_fd 6 "$RESTORE_JOURNAL" restore_journal
  acl_listing=$(LC_ALL=C ls -ld -- "$RESTORE_JOURNAL") \
    || { exec 6<&-; fail restore_journal_acl_invalid; }
  acl_mode=${acl_listing%% *}
  [ "$acl_mode" = '-rw-------' ] \
    || { exec 6<&-; fail restore_journal_acl_invalid; }
  journal_json=$(cat <&6) || { exec 6<&-; fail restore_journal_read_failed; }
  verify_lock_fd 6 "$RESTORE_JOURNAL" restore_journal
  exec 6<&-
  journal_bytes=$(stat -Lc '%s' -- "$RESTORE_JOURNAL") \
    || fail restore_journal_file_invalid
  expected_bytes=$((${#journal_json} + 1))
  [ "$journal_bytes" -eq "$expected_bytes" ] || fail restore_journal_json_invalid
  canonical=$(jq -c . <<<"$journal_json") || fail restore_journal_json_invalid
  [ "$journal_json" = "$canonical" ] || fail restore_journal_json_invalid
  jq -e \
    --arg backupPath "$backup_path" \
    --arg backupSha256 "$backup_sha256" \
    --argjson backupSizeBytes "$backup_size" \
    --arg destinationDatabase "$database" \
    --arg failedDatabase "$failed_database" \
    --arg host "$pg_host" \
    --arg port "$pg_port" \
    --arg quarantineDatabase "$quarantine_database" \
    --arg scratchDatabase "$scratch_database" \
    --argjson scratchOid "$scratch_oid" \
    --argjson targetOid "$target_oid" \
    --arg user "$database_user" '
      (keys == [
        "backupPath", "backupSha256", "backupSizeBytes", "destinationDatabase",
        "failedDatabase", "host", "kind", "phase", "port",
        "quarantineDatabase", "schema", "scratchDatabase", "scratchOid",
        "targetOid", "user"
      ])
      and .schema == 1
      and .kind == "restore-verified-backup"
      and (.phase == "restoring" or .phase == "swapping" or .phase == "rolling_back" or .phase == "committed")
      and .backupPath == $backupPath
      and .backupSha256 == $backupSha256
      and .backupSizeBytes == $backupSizeBytes
      and .destinationDatabase == $destinationDatabase
      and .failedDatabase == $failedDatabase
      and .host == $host
      and .port == $port
      and .quarantineDatabase == $quarantineDatabase
      and .scratchDatabase == $scratchDatabase
      and .scratchOid == $scratchOid
      and .targetOid == $targetOid
      and .user == $user
    ' <<<"$journal_json" >/dev/null || fail restore_journal_intent_mismatch
  journal_phase=$(jq -r '.phase' <<<"$journal_json") \
    || fail restore_journal_phase_invalid
}

write_restore_journal_phase() {
  local next_phase=$1 previous_scratch_oid=${2:-$scratch_oid} journal_next next_scratch_oid
  case "$next_phase" in
    restoring|swapping|rolling_back|committed) ;;
    *) fail restore_journal_phase_invalid ;;
  esac
  if [ "$journal_active" = 1 ]; then
    next_scratch_oid=$scratch_oid
    scratch_oid=$previous_scratch_oid
    validate_restore_journal
    scratch_oid=$next_scratch_oid
  else
    [ ! -e "$RESTORE_JOURNAL" ] && [ ! -L "$RESTORE_JOURNAL" ] \
      || fail restore_journal_already_exists
  fi
  journal_next=$(mktemp "$work/restore-journal.XXXXXX") \
    || fail restore_journal_prepare_failed
  if ! jq -cn \
    --arg backupPath "$backup_path" \
    --arg backupSha256 "$backup_sha256" \
    --argjson backupSizeBytes "$backup_size" \
    --arg destinationDatabase "$database" \
    --arg failedDatabase "$failed_database" \
    --arg host "$pg_host" \
    --arg kind restore-verified-backup \
    --arg phase "$next_phase" \
    --arg port "$pg_port" \
    --arg quarantineDatabase "$quarantine_database" \
    --arg scratchDatabase "$scratch_database" \
    --argjson scratchOid "$scratch_oid" \
    --argjson targetOid "$target_oid" \
    --arg user "$database_user" \
    '{backupPath:$backupPath,backupSha256:$backupSha256,backupSizeBytes:$backupSizeBytes,destinationDatabase:$destinationDatabase,failedDatabase:$failedDatabase,host:$host,kind:$kind,phase:$phase,port:$port,quarantineDatabase:$quarantineDatabase,schema:1,scratchDatabase:$scratchDatabase,scratchOid:$scratchOid,targetOid:$targetOid,user:$user}' \
    > "$journal_next"; then
    rm -f -- "$journal_next"
    fail restore_journal_prepare_failed
  fi
  chown 0:0 -- "$journal_next" || fail restore_journal_prepare_failed
  chmod 0600 -- "$journal_next" || fail restore_journal_prepare_failed
  [ "$(stat -Lc '%u:%g:%a:%h' -- "$journal_next")" = '0:0:600:1' ] \
    || fail restore_journal_prepare_failed
  fsync_path "$journal_next" || fail restore_journal_fsync_failed
  mv -fT -- "$journal_next" "$RESTORE_JOURNAL" || fail restore_journal_publish_failed
  fsync_path "$RESTORE_JOURNAL" || fail restore_journal_fsync_failed
  fsync_path "$RUNTIME_DIRECTORY" || fail restore_journal_fsync_failed
  journal_active=1
  journal_phase=$next_phase
  validate_restore_journal
  [ "$journal_phase" = "$next_phase" ] || fail restore_journal_phase_invalid
}

clear_restore_journal() {
  [ "$journal_active" = 1 ] || fail restore_journal_state_invalid
  validate_restore_journal
  rm -f -- "$RESTORE_JOURNAL" || fail restore_journal_clear_failed
  fsync_path "$RUNTIME_DIRECTORY" || fail restore_journal_clear_fsync_failed
  [ ! -e "$RESTORE_JOURNAL" ] && [ ! -L "$RESTORE_JOURNAL" ] \
    || fail restore_journal_clear_failed
  journal_active=0
  journal_phase=''
}

cleanup_restore_work() {
  [ -n "$work" ] || return 0
  case "$work" in
    "$RUNTIME_DIRECTORY"/verified-restore.*) ;;
    *) fail restore_cleanup_path_invalid ;;
  esac
  [ -d "$work" ] && [ ! -L "$work" ] \
    || fail restore_cleanup_path_invalid
  [ "$(stat -Lc '%u:%g:%a' -- "$work")" = '0:0:700' ] \
    || fail restore_cleanup_path_invalid
  rm -rf --one-file-system -- "$work" || fail restore_cleanup_failed
  fsync_path "$RUNTIME_DIRECTORY" || fail restore_cleanup_fsync_failed
  work=''
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
  local state scratch_exists failed_exists scratch_owned failed_owned scratch_actual_oid failed_actual_oid
  state=$(database_state) || return 1
  scratch_exists=$(json_boolean "$state" scratch) || return 1
  failed_exists=$(json_boolean "$state" failed) || return 1
  scratch_owned=$(json_boolean "$state" scratchOwnedByExpectedUser) || return 1
  failed_owned=$(json_boolean "$state" failedOwnedByExpectedUser) || return 1
  scratch_actual_oid=$(json_oid "$state" scratchOid) || return 1
  failed_actual_oid=$(json_oid "$state" failedOid) || return 1
  if [ "$scratch_exists" = true ]; then
    [ "$failed_exists" = false ] || return 1
    [ "$scratch_owned" = true ] || return 1
    [ "$scratch_oid" != null ] && [ "$scratch_actual_oid" = "$scratch_oid" ] || return 1
    set_connections "$scratch_database" false || return 1
    terminate_connections "$scratch_database" || return 1
    rename_database "$scratch_database" "$failed_database" || return 1
    preserved_database=$failed_database
  elif [ "$failed_exists" = true ]; then
    [ "$failed_owned" = true ] || return 1
    [ "$scratch_oid" != null ] && [ "$failed_actual_oid" = "$scratch_oid" ] || return 1
    preserved_database=$failed_database
  fi
}

rollback_swap() {
  local state target_exists scratch_exists quarantine_exists failed_exists
  local target_owned scratch_owned quarantine_owned failed_owned
  local target_actual_oid scratch_actual_oid quarantine_actual_oid failed_actual_oid topology
  state=$(database_state) || return 1
  target_exists=$(json_boolean "$state" target) || return 1
  scratch_exists=$(json_boolean "$state" scratch) || return 1
  quarantine_exists=$(json_boolean "$state" quarantine) || return 1
  failed_exists=$(json_boolean "$state" failed) || return 1
  target_owned=$(json_boolean "$state" targetOwnedByExpectedUser) || return 1
  scratch_owned=$(json_boolean "$state" scratchOwnedByExpectedUser) || return 1
  quarantine_owned=$(json_boolean "$state" quarantineOwnedByExpectedUser) || return 1
  failed_owned=$(json_boolean "$state" failedOwnedByExpectedUser) || return 1
  target_actual_oid=$(json_oid "$state" targetOid) || return 1
  scratch_actual_oid=$(json_oid "$state" scratchOid) || return 1
  quarantine_actual_oid=$(json_oid "$state" quarantineOid) || return 1
  failed_actual_oid=$(json_oid "$state" failedOid) || return 1

  { [ "$target_exists" = false ] || [ "$target_owned" = true ]; } || return 1
  { [ "$scratch_exists" = false ] || [ "$scratch_owned" = true ]; } || return 1
  { [ "$quarantine_exists" = false ] || [ "$quarantine_owned" = true ]; } || return 1
  { [ "$failed_exists" = false ] || [ "$failed_owned" = true ]; } || return 1

  topology="$target_exists:$scratch_exists:$quarantine_exists:$failed_exists"
  if [ "$scratch_oid" = null ]; then
    [ "$topology" = 'true:false:false:false' ] || return 1
    [ "$target_actual_oid" = "$target_oid" ] || return 1
  else
    case "$topology" in
      true:true:false:false)
        [ "$target_actual_oid" = "$target_oid" ] \
          && [ "$scratch_actual_oid" = "$scratch_oid" ] || return 1
        ;;
      true:false:false:true)
        [ "$target_actual_oid" = "$target_oid" ] \
          && [ "$failed_actual_oid" = "$scratch_oid" ] || return 1
        ;;
      false:true:true:false)
        [ "$scratch_actual_oid" = "$scratch_oid" ] \
          && [ "$quarantine_actual_oid" = "$target_oid" ] || return 1
        ;;
      true:false:true:false)
        [ "$target_actual_oid" = "$scratch_oid" ] \
          && [ "$quarantine_actual_oid" = "$target_oid" ] || return 1
        ;;
      false:false:true:true)
        [ "$quarantine_actual_oid" = "$target_oid" ] \
          && [ "$failed_actual_oid" = "$scratch_oid" ] || return 1
        ;;
      *) return 1 ;;
    esac
  fi

  if [ "$scratch_oid" != null ]; then
    case "$topology" in
      true:true:false:false)
        preserve_scratch_database || return 1
        rollback_swap
        return
        ;;
      false:true:true:false)
        rename_database "$quarantine_database" "$database" || return 1
        rollback_swap
        return
        ;;
      true:false:true:false)
        [ "$scratch_exists" = false ] && [ "$failed_exists" = false ] || return 1
        set_connections "$database" false || return 1
        terminate_connections "$database" || return 1
        rename_database "$database" "$failed_database" || return 1
        preserved_database=$failed_database
        rollback_swap
        return
        ;;
      false:false:true:true)
        preserved_database=$failed_database
        rename_database "$quarantine_database" "$database" || return 1
        rollback_swap
        return
        ;;
      true:false:false:true) preserved_database=$failed_database ;;
      *) return 1 ;;
    esac
  fi
  set_connections "$database" true || return 1
  state=$(database_state) || return 1
  target_exists=$(json_boolean "$state" target) || return 1
  quarantine_exists=$(json_boolean "$state" quarantine) || return 1
  scratch_exists=$(json_boolean "$state" scratch) || return 1
  [ "$target_exists" = true ] || return 1
  [ "$quarantine_exists" = false ] || return 1
  [ "$scratch_exists" = false ] || return 1
  if [ "$scratch_oid" = null ]; then
    jq -e --argjson targetOid "$target_oid" '
      .target and (not .scratch) and (not .quarantine) and (not .failed)
      and .targetAllowsConnections and .targetOwnedByExpectedUser
      and .targetOid == $targetOid
    ' <<<"$state" >/dev/null || return 1
  else
    jq -e --argjson targetOid "$target_oid" --argjson scratchOid "$scratch_oid" '
      .target and (not .scratch) and (not .quarantine) and .failed
      and .targetAllowsConnections and .targetOwnedByExpectedUser
      and .failedOwnedByExpectedUser
      and .targetOid == $targetOid and .failedOid == $scratchOid
    ' <<<"$state" >/dev/null || return 1
  fi
}

verify_final_restore_state() {
  local final_state
  final_state=$(database_state) || fail restore_final_state_unavailable
  jq -e --argjson targetOid "$target_oid" --argjson scratchOid "$scratch_oid" '
    .target
    and (not .scratch)
    and .quarantine
    and (not .failed)
    and .targetAllowsConnections
    and .quarantineDisallowsConnections
    and .targetOwnedByExpectedUser
    and .quarantineOwnedByExpectedUser
    and .targetOid == $scratchOid
    and .quarantineOid == $targetOid
  ' <<<"$final_state" >/dev/null || fail restore_final_state_invalid
}

complete_swap() {
  local state target_exists scratch_exists quarantine_exists failed_exists
  local target_owned scratch_owned quarantine_owned
  local target_actual_oid scratch_actual_oid quarantine_actual_oid topology
  state=$(database_state) || return 1
  target_exists=$(json_boolean "$state" target) || return 1
  scratch_exists=$(json_boolean "$state" scratch) || return 1
  quarantine_exists=$(json_boolean "$state" quarantine) || return 1
  failed_exists=$(json_boolean "$state" failed) || return 1
  target_owned=$(json_boolean "$state" targetOwnedByExpectedUser) || return 1
  scratch_owned=$(json_boolean "$state" scratchOwnedByExpectedUser) || return 1
  quarantine_owned=$(json_boolean "$state" quarantineOwnedByExpectedUser) || return 1
  target_actual_oid=$(json_oid "$state" targetOid) || return 1
  scratch_actual_oid=$(json_oid "$state" scratchOid) || return 1
  quarantine_actual_oid=$(json_oid "$state" quarantineOid) || return 1

  [ "$failed_exists" = false ] || return 1
  { [ "$target_exists" = false ] || [ "$target_owned" = true ]; } || return 1
  { [ "$scratch_exists" = false ] || [ "$scratch_owned" = true ]; } || return 1
  { [ "$quarantine_exists" = false ] || [ "$quarantine_owned" = true ]; } || return 1
  [ "$scratch_oid" != null ] || return 1

  topology="$target_exists:$scratch_exists:$quarantine_exists"
  case "$topology" in
    true:true:false)
      [ "$target_actual_oid" = "$target_oid" ] \
        && [ "$scratch_actual_oid" = "$scratch_oid" ] || return 1
      ;;
    false:true:true)
      [ "$scratch_actual_oid" = "$scratch_oid" ] \
        && [ "$quarantine_actual_oid" = "$target_oid" ] || return 1
      ;;
    true:false:true)
      [ "$target_actual_oid" = "$scratch_oid" ] \
        && [ "$quarantine_actual_oid" = "$target_oid" ] || return 1
      ;;
    *) return 1 ;;
  esac

  case "$topology" in
    true:true:false)
      set_connections "$scratch_database" false || return 1
      terminate_connections "$scratch_database" || return 1
      set_connections "$database" false || return 1
      terminate_connections "$database" || return 1
      rename_database "$database" "$quarantine_database" || return 1
      complete_swap
      return
      ;;
    false:true:true)
      set_connections "$scratch_database" false || return 1
      terminate_connections "$scratch_database" || return 1
      rename_database "$scratch_database" "$database" || return 1
      complete_swap
      return
      ;;
    true:false:true)
      set_connections "$database" true || return 1
      verify_final_restore_state
      ;;
  esac
}

publish_restore_record() {
  local completed_at record
  completed_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ') \
    || fail restore_record_time_failed
  record=$(mktemp "$RUNTIME_DIRECTORY/restore-record.XXXXXX") \
    || fail restore_record_prepare_failed
  if ! jq -cn \
    --arg backupSha256 "$backup_sha256" \
    --argjson backupSizeBytes "$backup_size" \
    --arg database "$database" \
    --arg quarantineDatabase "$quarantine_database" \
    --arg completedAt "$completed_at" \
    --argjson scratchOid "$scratch_oid" \
    --argjson targetOid "$target_oid" \
    '{schema:1,ok:true,action:"restore_verified_backup",backupSha256:$backupSha256,backupSizeBytes:$backupSizeBytes,database:$database,quarantineDatabase:$quarantineDatabase,targetOid:$targetOid,scratchOid:$scratchOid,completedAt:$completedAt}' \
    > "$record"; then
    rm -f -- "$record"
    fail restore_record_prepare_failed
  fi
  chown 0:0 -- "$record" || fail restore_record_prepare_failed
  chmod 0600 -- "$record" || fail restore_record_prepare_failed
  [ "$(stat -Lc '%u:%g:%a:%h' -- "$record")" = '0:0:600:1' ] \
    || fail restore_record_prepare_failed
  fsync_path "$record" || fail restore_record_fsync_failed
  mv -fT -- "$record" "$RESTORE_RECORD" || fail restore_record_publish_failed
  fsync_path "$RESTORE_RECORD" || fail restore_record_fsync_failed
  fsync_path "$RUNTIME_DIRECTORY" || fail restore_record_fsync_failed
  [ -f "$RESTORE_RECORD" ] && [ ! -L "$RESTORE_RECORD" ] \
    || fail restore_record_invalid
  [ "$(stat -Lc '%u:%g:%a:%h' -- "$RESTORE_RECORD")" = '0:0:600:1' ] \
    || fail restore_record_invalid
  jq -e \
    --arg backupSha256 "$backup_sha256" \
    --argjson backupSizeBytes "$backup_size" \
    --arg database "$database" \
    --arg quarantineDatabase "$quarantine_database" \
    --argjson scratchOid "$scratch_oid" \
    --argjson targetOid "$target_oid" '
      (keys == ["action", "backupSha256", "backupSizeBytes", "completedAt", "database", "ok", "quarantineDatabase", "schema", "scratchOid", "targetOid"])
      and .schema == 1 and .ok == true and .action == "restore_verified_backup"
      and .backupSha256 == $backupSha256 and .database == $database
      and .backupSizeBytes == $backupSizeBytes
      and .quarantineDatabase == $quarantineDatabase
      and .scratchOid == $scratchOid and .targetOid == $targetOid
      and (.completedAt | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$"))
    ' "$RESTORE_RECORD" >/dev/null || fail restore_record_invalid
}

bind_recoverable_scratch_oid() {
  local state target_exists scratch_exists quarantine_exists failed_exists
  local target_owned scratch_owned target_actual_oid scratch_actual_oid binding_phase
  [ "$scratch_oid" = null ] || return 0
  state=$(database_state) || fail restore_scratch_identity_unavailable
  target_exists=$(json_boolean "$state" target) || fail restore_scratch_identity_invalid
  scratch_exists=$(json_boolean "$state" scratch) || fail restore_scratch_identity_invalid
  quarantine_exists=$(json_boolean "$state" quarantine) || fail restore_scratch_identity_invalid
  failed_exists=$(json_boolean "$state" failed) || fail restore_scratch_identity_invalid
  target_owned=$(json_boolean "$state" targetOwnedByExpectedUser) || fail restore_scratch_identity_invalid
  scratch_owned=$(json_boolean "$state" scratchOwnedByExpectedUser) || fail restore_scratch_identity_invalid
  target_actual_oid=$(json_oid "$state" targetOid) || fail restore_scratch_identity_invalid
  [ "$target_exists" = true ] && [ "$target_owned" = true ] \
    && [ "$target_actual_oid" = "$target_oid" ] \
    && [ "$quarantine_exists" = false ] && [ "$failed_exists" = false ] \
    || fail restore_scratch_identity_invalid
  [ "$scratch_exists" = true ] || return 0
  [ "$scratch_owned" = true ] || fail restore_scratch_identity_invalid
  scratch_actual_oid=$(json_oid "$state" scratchOid) || fail restore_scratch_identity_invalid
  [ "$scratch_actual_oid" -gt 0 ] && [ "$scratch_actual_oid" != "$target_oid" ] \
    || fail restore_scratch_identity_invalid
  binding_phase=$journal_phase
  scratch_oid=$scratch_actual_oid
  # The fixed journal already reserved this deterministic name while it was
  # absent. Bind the newly-created OID durably before recovery moves it.
  write_restore_journal_phase "$binding_phase" null
}

recover_interrupted_restore() {
  validate_restore_journal
  case "$journal_phase" in
    restoring)
      bind_recoverable_scratch_oid
      write_restore_journal_phase rolling_back
      rollback_swap || fail restore_recovery_rollback_failed
      cleanup_restore_work
      clear_restore_journal
      error_code=restore_interrupted_rolled_back
      recovery_rolled_back=1
      return 0
      ;;
    rolling_back)
      bind_recoverable_scratch_oid
      rollback_swap || fail restore_recovery_rollback_failed
      cleanup_restore_work
      clear_restore_journal
      error_code=restore_interrupted_rolled_back
      recovery_rolled_back=1
      return 0
      ;;
    swapping)
      swap_started=1
      complete_swap || fail restore_recovery_rollforward_failed
      write_restore_journal_phase committed
      ;;
    committed)
      verify_final_restore_state
      ;;
    *) fail restore_journal_phase_invalid ;;
  esac
  publish_restore_record
  cleanup_restore_work
  clear_restore_journal
  completed=1
  swap_started=0
  cat "$RESTORE_RECORD"
}

on_exit() {
  local rc=$? exit_recovery_status
  trap - EXIT HUP INT TERM
  set +e
  if [ "$rc" -ne 0 ] && [ "$postgres_ready" = 1 ] \
    && [ "$operation_mode" = restore ] && [ "$journal_active" = 1 ]; then
    if [ "$journal_phase" != committed ]; then
      (
        set -e
        bind_recoverable_scratch_oid
        write_restore_journal_phase rolling_back
        rollback_swap
        cleanup_restore_work
        clear_restore_journal
      ) >/dev/null 2>&1
      exit_recovery_status=$?
      if [ "$exit_recovery_status" -eq 0 ]; then
        if [ "$scratch_oid" != null ]; then preserved_database=$failed_database; fi
        work=''
        journal_active=0
        journal_phase=''
      else
        if [ "$swap_started" = 1 ]; then
          recovery_error_code=restore_rollback_failed
        else
          recovery_error_code=restore_failure_quarantine_failed
        fi
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
    if [ -n "$recovery_error_code" ] && [ -n "$preserved_database" ]; then
      printf '{"schema":1,"ok":false,"error":"%s","recoveryError":"%s","preservedDatabase":"%s"}\n' \
        "$error_code" "$recovery_error_code" "$preserved_database" >&2
    elif [ -n "$recovery_error_code" ]; then
      printf '{"schema":1,"ok":false,"error":"%s","recoveryError":"%s","preservedDatabase":null}\n' \
        "$error_code" "$recovery_error_code" >&2
    elif [ -n "$preserved_database" ]; then
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
need realpath
need chown
need sha256sum
need sync
need ls

psql_version=$(psql --version)
pg_restore_version=$(pg_restore --version)
[[ "$psql_version" =~ \(PostgreSQL\)[[:space:]]16\. ]] || fail psql_16_required
[[ "$pg_restore_version" =~ \(PostgreSQL\)[[:space:]]16\. ]] || fail pg_restore_16_required

[ -d "$RUNTIME_DIRECTORY" ] && [ ! -L "$RUNTIME_DIRECTORY" ] || fail restore_runtime_directory_invalid
# Shared application/Constructor runtime; only the restore work and evidence
# below remain root-only. Validate this directory without rewriting its ACL.
[ "$(realpath -e -- "$RUNTIME_DIRECTORY")" = "$RUNTIME_DIRECTORY" ] \
  && [ "$(stat -Lc '%u:%g:%a' -- "$RUNTIME_DIRECTORY")" = '0:10050:750' ] \
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

if [ -e "$RESTORE_JOURNAL" ] || [ -L "$RESTORE_JOURNAL" ]; then
  [ "$operation_mode" != preflight ] || fail restore_recovery_required
  operation_mode=recovery
  journal_mode=1
  validator_journal_file=$RESTORE_JOURNAL
fi

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
  KELION_RESTORE_JOURNAL_FILE="$validator_journal_file" \
  KELION_RESTORE_PROOF_FILE="$proof_file" \
  KELION_RESTORE_PLAN_FILE="$plan_file" \
  KELION_RESTORE_ENCRYPTION_KEY_FILE="$encryption_key_file" \
  KELION_RESTORE_PGPASS_FILE="$pgpass_file" \
  node "$VALIDATOR" >/dev/null 2>"$diagnostic_file"; then
  fail restore_backup_validation_failed
fi

jq -e '
  (keys == [
    "backupPath", "backupSha256", "backupSizeBytes", "database", "failedDatabase", "host",
    "port", "quarantineDatabase", "schema", "scratchDatabase", "scratchOid", "targetOid", "user"
  ])
  and .schema == 1
  and (.backupPath | test("^/root/kelion/backups/kelion-[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{6}\\.dump\\.enc$"))
  and (.backupSha256 | test("^[a-f0-9]{64}$"))
  and (.database | test("^[A-Za-z_][A-Za-z0-9_$]{0,62}$"))
  and (.user | test("^[A-Za-z_][A-Za-z0-9_$]{0,62}$"))
  and (.host == "/var/run/postgresql")
  and (.port | test("^[0-9]{1,5}$"))
  and (.backupSizeBytes | type == "number" and floor == . and . > 0)
  and (.scratchDatabase | test("^kelion_restore_[a-f0-9]{12}$"))
  and (.quarantineDatabase | test("^kelion_quarantine_[a-f0-9]{12}$"))
  and (.failedDatabase | test("^kelion_restore_failed_[a-f0-9]{12}$"))
  and ((.targetOid == null) or (.targetOid | type == "number" and floor == . and . > 0))
  and ((.scratchOid == null) or (.scratchOid | type == "number" and floor == . and . > 0))
' "$plan_file" >/dev/null || fail restore_plan_invalid

backup_path=$(jq -er '.backupPath' "$plan_file")
backup_sha256=$(jq -er '.backupSha256' "$plan_file")
backup_size=$(jq -er '.backupSizeBytes' "$plan_file")
database=$(jq -er '.database' "$plan_file")
database_user=$(jq -er '.user' "$plan_file")
pg_host=$(jq -er '.host' "$plan_file")
pg_port=$(jq -er '.port' "$plan_file")
scratch_database=$(jq -er '.scratchDatabase' "$plan_file")
quarantine_database=$(jq -er '.quarantineDatabase' "$plan_file")
failed_database=$(jq -er '.failedDatabase' "$plan_file")
target_oid=$(jq -r '.targetOid' "$plan_file")
scratch_oid=$(jq -r '.scratchOid' "$plan_file")
[ "$pg_host" = /var/run/postgresql ] || fail restore_plan_invalid

[ -f "$backup_path" ] && [ ! -L "$backup_path" ] || fail restore_backup_file_invalid
[ "$(stat -Lc '%u:%g:%a:%h' -- "$backup_path")" = '0:0:600:1' ] \
  || fail restore_backup_file_invalid
checksum_line=$(sha256sum -- "$backup_path") || fail restore_backup_hash_unavailable
[ "${checksum_line%% *}" = "$backup_sha256" ] || fail restore_backup_hash_changed
[ "$(stat -Lc '%s' -- "$backup_path")" = "$backup_size" ] \
  || fail restore_backup_size_changed

export PGHOST=$DATABASE_CONTROL_HOST PGPORT=$pg_port PGUSER=$database_user PGPASSFILE=$pgpass_file
export PGCONNECT_TIMEOUT=10 PGAPPNAME=kelion-verified-restore
unset PGPASSWORD DATABASE_URL DATABASE_URL_FILE

if [ "$journal_mode" = 1 ]; then
  postgres_ready=1
  journal_active=1
  validate_restore_journal
  recover_interrupted_restore
  if [ "$recovery_rolled_back" = 1 ]; then
    exit 1
  fi
  exit 0
fi

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
  'serverAddressIsLoopback', inet_server_addr() = inet '127.0.0.1',
  'currentUserMatches', current_user = :'expected_user',
  'roleCanCreateDatabase', COALESCE((SELECT rolsuper OR rolcreatedb FROM role_state), false),
  'databaseExists', EXISTS (SELECT 1 FROM database_state),
  'targetDatabaseOid', COALESCE((SELECT oid::bigint FROM pg_database WHERE datname = :'target_database'), 0),
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
  and .serverAddressIsLoopback
  and .currentUserMatches
  and .roleCanCreateDatabase
  and .databaseExists
  and (.targetDatabaseOid | type == "number" and floor == . and . > 0)
  and .databaseOwnedByUser
  and .databaseAllowsConnections
  and .databaseIsNotTemplate
  and (.databaseSizeBytes > 0)
  and .scratchAbsent
  and .quarantineAbsent
  and .failedAbsent
' <<<"$preflight" >/dev/null || fail restore_database_preflight_rejected

target_oid=$(jq -er '.targetDatabaseOid' <<<"$preflight")
[[ "$target_oid" =~ ^[0-9]+$ ]] && [ "$target_oid" -gt 0 ] \
  || fail restore_target_oid_invalid
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
write_restore_journal_phase restoring null

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

scratch_created_state=$(database_state) || fail restore_scratch_identity_unavailable
jq -e --argjson targetOid "$target_oid" '
  .target and .scratch and (not .quarantine) and (not .failed)
  and .targetOwnedByExpectedUser and .scratchOwnedByExpectedUser
  and .targetOid == $targetOid
  and (.scratchOid | type == "number" and floor == . and . > 0)
' <<<"$scratch_created_state" >/dev/null || fail restore_scratch_identity_invalid
scratch_oid=$(json_oid "$scratch_created_state" scratchOid) \
  || fail restore_scratch_identity_invalid
write_restore_journal_phase restoring null

if ! pg_restore \
  --dbname="$scratch_database" \
  --exit-on-error --single-transaction --no-owner --no-privileges \
  < "$plaintext_dump" >/dev/null 2>"$diagnostic_file"; then
  fail restore_scratch_import_failed
fi

if ! verify_legacy_contract "$scratch_database" 2>"$diagnostic_file"; then
  fail restore_legacy_contract_invalid
fi

swap_started=1
write_restore_journal_phase swapping
complete_swap || fail restore_database_swap_failed
write_restore_journal_phase committed
publish_restore_record
cleanup_restore_work
clear_restore_journal
completed=1
swap_started=0
cat "$RESTORE_RECORD"
