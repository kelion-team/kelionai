#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Upgrade-ul nu primește credentiale. Raportarea este limitată la fază, linie și
# commit, astfel încât nici mediul și nici conținutul configului live să nu poată
# ajunge în logul workflow-ului.
constructor_upgrade_phase=bootstrap
constructor_upgrade_failure_line=0
constructor_upgrade_source_commit=${KELION_CONSTRUCTOR_SOURCE_COMMIT:-unknown}
constructor_upgrade_recovery=${KELION_CONSTRUCTOR_RECOVERY:-invalid}
cutover_stage=''
activation_restore_started=0

set_constructor_upgrade_phase() {
  constructor_upgrade_phase=$1
  printf '{"ok":true,"event":"constructor_upgrade_phase","phase":"%s","source_commit":"%s"}\n' \
    "$constructor_upgrade_phase" "$constructor_upgrade_source_commit" >&2
}

cleanup_unpublished_stage() {
  [ -n "$cutover_stage" ] || return 0
  [[ "$cutover_stage" =~ ^/root/kelion/runtime/runtime-cutover\.[A-Za-z0-9]+$ ]] || return 1
  if [ -e "$cutover_stage" ] || [ -L "$cutover_stage" ]; then
    [ -d "$cutover_stage" ] && [ ! -L "$cutover_stage" ] \
      && [ "$(realpath -e -- "$cutover_stage")" = "$cutover_stage" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$cutover_stage")" = '0:0:700' ] || return 1
    [ -d "$cutover_stage/files" ] && [ ! -L "$cutover_stage/files" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$cutover_stage/files")" = '0:0:700:2' ] || return 1
    rm -f -- "$cutover_stage/files/constructor-config.codex-worker.env" "$cutover_stage/manifest"
    rmdir -- "$cutover_stage/files" "$cutover_stage"
    sync -f /root/kelion/runtime
  fi
  cutover_stage=''
}

report_constructor_upgrade_failure() {
  local status=$? cleanup_status=0
  trap - ERR EXIT
  if [ "$status" = 0 ]; then return 0; fi
  if [ "$activation_restore_started" = 1 ] \
    && [ -x /root/kelion/bin/runtime-config-cutover.sh ] \
    && [ -f /root/kelion/config/compose.production.yml ]; then
    KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
      KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
      /root/kelion/bin/runtime-config-cutover.sh \
      --recover-only /root/kelion/config/compose.production.yml --leave-constructor-quiesced \
      >/dev/null || cleanup_status=1
  fi
  cleanup_unpublished_stage || cleanup_status=1
  if [ "$cleanup_status" != 0 ]; then status=1; fi
  printf '{"ok":false,"event":"constructor_upgrade_failure","phase":"%s","line":%s,"exit_code":%s,"source_commit":"%s"}\n' \
    "$constructor_upgrade_phase" "$constructor_upgrade_failure_line" "$status" "$constructor_upgrade_source_commit" >&2
  builtin exit "$status"
}

capture_constructor_upgrade_failure() {
  local status=$?
  constructor_upgrade_failure_line=${1:-0}
  return "$status"
}

trap 'capture_constructor_upgrade_failure "$LINENO"' ERR
trap report_constructor_upgrade_failure EXIT

set_constructor_upgrade_phase preflight
[[ "$(id -u)" == 0 ]] || { echo 'upgrade-ul Constructor rulează numai ca root' >&2; exit 1; }
[[ "${KELION_CONSTRUCTOR_UPGRADE:-0}" == 1 ]] \
  || { echo 'setează KELION_CONSTRUCTOR_UPGRADE=1 după review' >&2; exit 1; }
[[ "$constructor_upgrade_source_commit" =~ ^[0-9a-f]{40}$ ]] \
  || { echo 'commitul sursă al upgrade-ului este invalid' >&2; exit 1; }
[[ "$constructor_upgrade_recovery" =~ ^[01]$ ]] \
  || { echo 'modul recovery al upgrade-ului este invalid' >&2; exit 1; }

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
for source in \
  "$repo_root/AGENTS.md" \
  "$repo_root/deploy/instaleaza-constructor.sh" \
  "$repo_root/deploy/codex-worker.mjs" \
  "$repo_root/deploy/lib/runtime-config-cutover.sh" \
  "$repo_root/deploy/compose.production.yml"; do
  [ -f "$source" ] && [ ! -L "$source" ] \
    || { echo 'bundle-ul upgrade-ului Constructor este incomplet' >&2; exit 1; }
done
for tool in awk cmp flock grep install jq mktemp python3 readlink realpath sha256sum stat sync systemctl wc; do
  command -v "$tool" >/dev/null 2>&1 \
    || { echo "lipsește utilitarul $tool" >&2; exit 1; }
done

ROOT=/root/kelion
RUNTIME_ROOT=$ROOT/runtime
CONFIG_ROOT=$ROOT/config
PUBLICATION_LOCK=$ROOT/publicare.lock
UPGRADE_JOURNAL=$RUNTIME_ROOT/constructor-upgrade.journal
INSTALL_JOURNAL=$RUNTIME_ROOT/constructor-deploy-quiesce.journal
RUNTIME_JOURNAL=$RUNTIME_ROOT/runtime-config-cutover.journal
ACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-activation.journal
GATE_JOURNAL=$RUNTIME_ROOT/constructor-gate-refresh.journal
UNIT_MIGRATION_PENDING=$RUNTIME_ROOT/constructor-unit-migration.pending
DESTRUCTIVE_RECOVERY_JOURNAL=$RUNTIME_ROOT/destructive-cutover-recovery.json
READY_ROOT=/run/kelion
READY_STAMP=$READY_ROOT/runtime-config-recovery.ready

constructor_markers=(
  /etc/kelion/codex-worker.enabled
  /etc/kelion/constructor-publisher.enabled
  /etc/kelion/constructor-release.enabled
)
constructor_timers=(
  kelion-codex-worker.timer
  kelion-constructor-publisher.timer
  kelion-constructor-release.timer
)
constructor_services=(
  kelion-codex-worker.service
  kelion-constructor-publisher.service
  kelion-constructor-release.service
)
snapshot_marker_present=()
snapshot_timer_enabled=()
snapshot_timer_active=()
snapshot_root=''
snapshot_state_sha256=''
upgrade_phase=''

fsync_path() {
  python3 - "$1" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
before = os.stat(path, follow_symlinks=False)
if stat.S_ISLNK(before.st_mode):
    raise SystemExit(1)
flags = os.O_RDONLY | (os.O_DIRECTORY if stat.S_ISDIR(before.st_mode) else 0)
flags |= getattr(os, "O_NOFOLLOW", 0)
descriptor = os.open(path, flags)
try:
    opened = os.fstat(descriptor)
    if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
        raise SystemExit(1)
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

validate_marker_root() {
  [ -d /etc/kelion ] && [ ! -L /etc/kelion ] \
    && [ "$(realpath -e -- /etc/kelion)" = /etc/kelion ] \
    && [ "$(stat -Lc '%u:%g:%a' /etc/kelion)" = '0:0:755' ]
}

validate_ready_stamp() {
  [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] \
    && [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$READY_STAMP")" = '0:0:444:1' ] \
    && [ "$(wc -l < "$READY_STAMP")" -eq 1 ] \
    && grep -qx 'schema=1' "$READY_STAMP"
}

validate_unit_pending() {
  [ -f "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$UNIT_MIGRATION_PENDING")" = '0:0:600:1' ] \
    && [ "$(wc -l < "$UNIT_MIGRATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$UNIT_MIGRATION_PENDING"
}

publish_unit_pending() {
  local temporary
  if [ -e "$UNIT_MIGRATION_PENDING" ] || [ -L "$UNIT_MIGRATION_PENDING" ]; then
    validate_unit_pending || return 1
  else
    temporary=$(mktemp "$RUNTIME_ROOT/.constructor-unit-migration.pending.XXXXXX") || return 1
    if ! printf 'schema=1\n' > "$temporary" \
      || ! chown root:root "$temporary" || ! chmod 0600 "$temporary" \
      || ! fsync_path "$temporary" \
      || ! mv -f -- "$temporary" "$UNIT_MIGRATION_PENDING" \
      || ! fsync_path "$RUNTIME_ROOT"; then
      rm -f -- "$temporary"
      return 1
    fi
  fi
  # Bariera persistentă trebuie să fie durabilă înainte să retragem ready.
  # Astfel orice recovery generic după SIGKILL vede pending și rămâne fail-closed.
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    validate_ready_stamp || return 1
    rm -f -- "$READY_STAMP" || return 1
    fsync_path "$READY_ROOT" || return 1
  fi
}

quiesce_under_unit_pending() {
  local candidate_helper=$repo_root/deploy/lib/runtime-config-cutover.sh live_compose=$CONFIG_ROOT/compose.production.yml
  [ -f "$candidate_helper" ] && [ ! -L "$candidate_helper" ] || return 1
  [ -f "$live_compose" ] && [ ! -L "$live_compose" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$live_compose")" = '0:0:444:1' ] || return 1
  publish_unit_pending || return 1
  KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
    KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
    bash "$candidate_helper" \
    --recover-only "$live_compose" --leave-constructor-quiesced
  validate_unit_pending || return 1
  [ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] || return 1
}

validate_service_quiescence() {
  local service state unit_file_state
  for service in "${constructor_services[@]}"; do
    systemctl cat "$service" >/dev/null 2>&1 || return 1
    unit_file_state=$(systemctl show "$service" --property=UnitFileState --value) || return 1
    [ "$unit_file_state" = static ] || return 1
    state=$(systemctl show "$service" --property=ActiveState --value) || return 1
    case "$state" in inactive|failed) ;; *) return 1 ;; esac
    [ -z "$(systemctl list-jobs --no-legend --plain "$service" 2>/dev/null)" ] || return 1
  done
}

validate_live_activation_vector() {
  local index marker timer config present unit_file_state active_state
  validate_marker_root || return 1
  validate_ready_stamp || return 1
  for config in \
    "$CONFIG_ROOT/codex-worker.env" \
    "$CONFIG_ROOT/constructor-publisher.env" \
    "$CONFIG_ROOT/constructor-release.env"; do
    [ -f "$config" ] && [ ! -L "$config" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$config")" = '0:0:640:1' ] || return 1
  done
  for index in "${!constructor_markers[@]}"; do
    marker=${constructor_markers[$index]}
    timer=${constructor_timers[$index]}
    present=0
    if [ -e "$marker" ] || [ -L "$marker" ]; then
      [ -f "$marker" ] && [ ! -L "$marker" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$marker")" = '0:0:444:1' ] || return 1
      present=1
    fi
    systemctl cat "$timer" >/dev/null 2>&1 || return 1
    unit_file_state=$(systemctl show "$timer" --property=UnitFileState --value) || return 1
    active_state=$(systemctl show "$timer" --property=ActiveState --value) || return 1
    if [ "$present" = 1 ]; then
      [ "$unit_file_state" = enabled ] && [ "$active_state" = active ] \
        && systemctl is-enabled --quiet "$timer" && systemctl is-active --quiet "$timer" || return 1
    else
      [ "$unit_file_state" = disabled ] && [ "$active_state" = inactive ] || return 1
      if systemctl is-enabled --quiet "$timer" || systemctl is-active --quiet "$timer"; then return 1; fi
    fi
    [ -z "$(systemctl list-jobs --no-legend --plain "$timer" 2>/dev/null)" ] || return 1
  done
  [ ! -f "${constructor_markers[2]}" ] \
    || { [ -f "${constructor_markers[0]}" ] && [ -f "${constructor_markers[1]}" ]; } || return 1
  [ ! -f "${constructor_markers[1]}" ] || [ -f "${constructor_markers[0]}" ] || return 1
  validate_service_quiescence
}

write_upgrade_journal() {
  local phase=$1 temporary
  case "$phase" in armed|installed|committed) ;; *) return 1 ;; esac
  [[ "$snapshot_root" =~ ^/root/kelion/runtime/constructor-upgrade\.[A-Za-z0-9]+$ ]] || return 1
  [[ "$snapshot_state_sha256" =~ ^[0-9a-f]{64}$ ]] || return 1
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-upgrade.journal.XXXXXX") || return 1
  if jq -cn \
      --arg phase "$phase" \
      --arg sourceCommit "$constructor_upgrade_source_commit" \
      --arg snapshotRoot "$snapshot_root" \
      --arg stateSha256 "$snapshot_state_sha256" \
      '{schema:1,kind:"constructor-upgrade",phase:$phase,sourceCommit:$sourceCommit,
        snapshotRoot:$snapshotRoot,stateSha256:$stateSha256}' > "$temporary" \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$UPGRADE_JOURNAL" \
    && fsync_path "$RUNTIME_ROOT"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

load_upgrade_journal() {
  local state_file line type name first second digest extra index expected_digest
  [ -f "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$UPGRADE_JOURNAL")" = '0:0:600:1' ] || return 1
  jq -e --arg commit "$constructor_upgrade_source_commit" '
    .schema == 1 and .kind == "constructor-upgrade" and
    (.phase == "armed" or .phase == "installed" or .phase == "committed") and
    .sourceCommit == $commit and
    (.snapshotRoot | strings | test("^/root/kelion/runtime/constructor-upgrade\\.[A-Za-z0-9]+$")) and
    (.stateSha256 | strings | test("^[0-9a-f]{64}$")) and
    (keys == ["kind","phase","schema","snapshotRoot","sourceCommit","stateSha256"])
  ' "$UPGRADE_JOURNAL" >/dev/null || return 1
  upgrade_phase=$(jq -er '.phase' "$UPGRADE_JOURNAL")
  snapshot_root=$(jq -er '.snapshotRoot' "$UPGRADE_JOURNAL")
  snapshot_state_sha256=$(jq -er '.stateSha256' "$UPGRADE_JOURNAL")
  [ -d "$snapshot_root" ] && [ ! -L "$snapshot_root" ] \
    && [ "$(realpath -e -- "$snapshot_root")" = "$snapshot_root" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$snapshot_root")" = '0:0:700:2' ] || return 1
  state_file=$snapshot_root/state
  [ -f "$state_file" ] && [ ! -L "$state_file" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$state_file")" = '0:0:600:1' ] \
    && [ "$(sha256sum "$state_file" | awk '{print $1}')" = "$snapshot_state_sha256" ] || return 1
  mapfile -t snapshot_lines < "$state_file"
  [ "${#snapshot_lines[@]}" -eq 6 ] || return 1
  snapshot_marker_present=()
  snapshot_timer_enabled=()
  snapshot_timer_active=()
  for index in "${!constructor_markers[@]}"; do
    line=${snapshot_lines[$index]}
    IFS=$'\t' read -r type name first second digest extra <<<"$line"
    [ "$type" = marker ] && [ "$name" = "${constructor_markers[$index]}" ] \
      && [[ "$first" =~ ^[01]$ ]] && [ "$second" = "marker.$index" ] \
      && [[ "$digest" =~ ^[0-9a-f]{64}$ ]] && [ -z "$extra" ] || return 1
    [ -f "$snapshot_root/$second" ] && [ ! -L "$snapshot_root/$second" ] || return 1
    expected_digest=$(sha256sum "$snapshot_root/$second" | awk '{print $1}') || return 1
    [ "$expected_digest" = "$digest" ] || return 1
    if [ "$first" = 1 ]; then
      [ "$(stat -Lc '%u:%g:%a:%h' "$snapshot_root/$second")" = '0:0:444:1' ] || return 1
    else
      [ "$(stat -Lc '%u:%g:%a:%h' "$snapshot_root/$second")" = '0:0:600:1' ] \
        && [ ! -s "$snapshot_root/$second" ] || return 1
    fi
    snapshot_marker_present+=("$first")
  done
  for index in "${!constructor_timers[@]}"; do
    line=${snapshot_lines[$((index + 3))]}
    IFS=$'\t' read -r type name first second digest extra <<<"$line"
    [ "$type" = timer ] && [ "$name" = "${constructor_timers[$index]}" ] \
      && [[ "$first" =~ ^[01]$ ]] && [[ "$second" =~ ^[01]$ ]] \
      && [ "$digest" = - ] && [ -z "$extra" ] || return 1
    [ "$first" = "${snapshot_marker_present[$index]}" ] \
      && [ "$second" = "${snapshot_marker_present[$index]}" ] || return 1
    snapshot_timer_enabled+=("$first")
    snapshot_timer_active+=("$second")
  done
}

create_upgrade_snapshot() {
  local index marker timer present enabled active digest state_file
  validate_live_activation_vector || return 1
  snapshot_root=$(mktemp -d "$RUNTIME_ROOT/constructor-upgrade.XXXXXX") || return 1
  chown root:root "$snapshot_root"
  chmod 0700 "$snapshot_root"
  state_file=$snapshot_root/state
  : > "$state_file"
  chown root:root "$state_file"
  chmod 0600 "$state_file"
  for index in "${!constructor_markers[@]}"; do
    marker=${constructor_markers[$index]}
    present=0
    if [ -f "$marker" ]; then
      install -o root -g root -m 0444 "$marker" "$snapshot_root/marker.$index"
      cmp -s -- "$marker" "$snapshot_root/marker.$index" || return 1
      present=1
    else
      : > "$snapshot_root/marker.$index"
      chown root:root "$snapshot_root/marker.$index"
      chmod 0600 "$snapshot_root/marker.$index"
    fi
    digest=$(sha256sum "$snapshot_root/marker.$index" | awk '{print $1}') || return 1
    printf 'marker\t%s\t%s\tmarker.%s\t%s\n' "$marker" "$present" "$index" "$digest" >> "$state_file"
    fsync_path "$snapshot_root/marker.$index"
  done
  for index in "${!constructor_timers[@]}"; do
    timer=${constructor_timers[$index]}
    if systemctl is-enabled --quiet "$timer"; then enabled=1; else enabled=0; fi
    if systemctl is-active --quiet "$timer"; then active=1; else active=0; fi
    printf 'timer\t%s\t%s\t%s\t-\n' "$timer" "$enabled" "$active" >> "$state_file"
  done
  fsync_path "$state_file"
  fsync_path "$snapshot_root"
  snapshot_state_sha256=$(sha256sum "$state_file" | awk '{print $1}') || return 1
  write_upgrade_journal armed
}

restore_snapshot_markers() {
  local index marker temporary
  validate_marker_root || return 1
  for index in "${!constructor_markers[@]}"; do
    marker=${constructor_markers[$index]}
    if [ "${snapshot_marker_present[$index]}" = 1 ]; then
      temporary=$(mktemp "$marker.upgrade.XXXXXX") || return 1
      if install -o root -g root -m 0444 "$snapshot_root/marker.$index" "$temporary" \
        && cmp -s -- "$snapshot_root/marker.$index" "$temporary" \
        && fsync_path "$temporary" \
        && mv -f -- "$temporary" "$marker" \
        && fsync_path "$marker"; then
        :
      else
        rm -f -- "$temporary"
        return 1
      fi
    else
      rm -f -- "$marker" || return 1
    fi
  done
  fsync_path /etc/kelion
}

validate_installed_generation_quiesced() {
  local marker timer state
  [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] || return 1
  [ ! -e "$RUNTIME_JOURNAL" ] && [ ! -L "$RUNTIME_JOURNAL" ] || return 1
  validate_unit_pending || return 1
  [ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] || return 1
  cmp -s -- "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /opt/kelion-codex/codex-worker.mjs)" = '0:0:555:1' ] || return 1
  for marker in "${constructor_markers[@]}"; do
    [ ! -e "$marker" ] && [ ! -L "$marker" ] || return 1
  done
  for timer in "${constructor_timers[@]}"; do
    [ "$(systemctl show "$timer" --property=UnitFileState --value)" = disabled ] || return 1
    state=$(systemctl show "$timer" --property=ActiveState --value) || return 1
    case "$state" in inactive|failed) ;; *) return 1 ;; esac
    [ -z "$(systemctl list-jobs --no-legend --plain "$timer" 2>/dev/null)" ] || return 1
  done
  validate_service_quiescence
}

strict_constructor_config_recommit() {
  local config_file=$CONFIG_ROOT/codex-worker.env helper=$ROOT/bin/runtime-config-cutover.sh compose=$CONFIG_ROOT/compose.production.yml
  [ -f "$helper" ] && [ ! -L "$helper" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$helper")" = '0:0:500:1' ] || return 1
  [ -f "$compose" ] && [ ! -L "$compose" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$compose")" = '0:0:444:1' ] || return 1
  [ -f "$config_file" ] && [ ! -L "$config_file" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$config_file")" = '0:0:640:1' ] || return 1

  # Normalizează orice retry al cutover-ului strict în starea quiesced. Helperul
  # live este deja candidatul autentificat/publicat de installer.
  KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
    KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
    "$helper" --recover-only "$compose" --leave-constructor-quiesced
  restore_snapshot_markers

  cutover_stage=$(mktemp -d "$RUNTIME_ROOT/runtime-cutover.XXXXXX") || return 1
  chown root:root "$cutover_stage"
  chmod 0700 "$cutover_stage"
  install -d -o root -g root -m 0700 "$cutover_stage/files"
  install -o root -g root -m 0600 "$config_file" "$cutover_stage/files/constructor-config.codex-worker.env"
  cmp -s -- "$config_file" "$cutover_stage/files/constructor-config.codex-worker.env" || return 1
  printf 'constructor-config.codex-worker.env\n' > "$cutover_stage/manifest"
  chown root:root "$cutover_stage/manifest"
  chmod 0600 "$cutover_stage/manifest"
  fsync_path "$cutover_stage/files/constructor-config.codex-worker.env"
  fsync_path "$cutover_stage/manifest"
  fsync_path "$cutover_stage/files"
  fsync_path "$cutover_stage"
  KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
    KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
    "$helper" "$cutover_stage" "$compose" --leave-constructor-quiesced
  cutover_stage=''
}

validate_committed_activation_vector_quiesced() {
  local index marker timer unit_file_state active_state
  [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] || return 1
  [ ! -e "$RUNTIME_JOURNAL" ] && [ ! -L "$RUNTIME_JOURNAL" ] || return 1
  [ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ] || return 1
  [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] || return 1
  [ ! -e "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] || return 1
  [ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] || return 1
  cmp -s -- "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs || return 1
  for index in "${!constructor_markers[@]}"; do
    marker=${constructor_markers[$index]}
    timer=${constructor_timers[$index]}
    if [ "${snapshot_marker_present[$index]}" = 1 ]; then
      [ -f "$marker" ] && [ ! -L "$marker" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$marker")" = '0:0:444:1' ] \
        && cmp -s -- "$snapshot_root/marker.$index" "$marker" || return 1
    else
      [ ! -e "$marker" ] && [ ! -L "$marker" ] || return 1
    fi
    unit_file_state=$(systemctl show "$timer" --property=UnitFileState --value) || return 1
    active_state=$(systemctl show "$timer" --property=ActiveState --value) || return 1
    [ "$unit_file_state" = disabled ] || return 1
    case "$active_state" in inactive|failed) ;; *) return 1 ;; esac
    if systemctl is-enabled --quiet "$timer" || systemctl is-active --quiet "$timer"; then return 1; fi
    [ -z "$(systemctl list-jobs --no-legend --plain "$timer" 2>/dev/null)" ] || return 1
  done
  validate_service_quiescence
}

finalize_committed_activation() {
  local helper=$ROOT/bin/runtime-config-cutover.sh compose=$CONFIG_ROOT/compose.production.yml
  [ -f "$helper" ] && [ ! -L "$helper" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$helper")" = '0:0:500:1' ] || return 1
  [ -f "$compose" ] && [ ! -L "$compose" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$compose")" = '0:0:444:1' ] || return 1
  KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
    KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
    "$helper" --recover-only "$compose"
}

quiesce_committed_activation() {
  local helper=$ROOT/bin/runtime-config-cutover.sh compose=$CONFIG_ROOT/compose.production.yml
  [ -f "$helper" ] && [ ! -L "$helper" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$helper")" = '0:0:500:1' ] || return 1
  [ -f "$compose" ] && [ ! -L "$compose" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$compose")" = '0:0:444:1' ] || return 1
  KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
    KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
    "$helper" --recover-only "$compose" --leave-constructor-quiesced
}

validate_restored_activation_vector() {
  local index marker timer unit_file_state active_state
  [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] || return 1
  [ ! -e "$RUNTIME_JOURNAL" ] && [ ! -L "$RUNTIME_JOURNAL" ] || return 1
  [ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ] || return 1
  [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] || return 1
  [ ! -e "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] || return 1
  validate_ready_stamp || return 1
  cmp -s -- "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs || return 1
  for index in "${!constructor_markers[@]}"; do
    marker=${constructor_markers[$index]}
    timer=${constructor_timers[$index]}
    if [ "${snapshot_marker_present[$index]}" = 1 ]; then
      [ -f "$marker" ] && [ ! -L "$marker" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$marker")" = '0:0:444:1' ] \
        && cmp -s -- "$snapshot_root/marker.$index" "$marker" || return 1
    else
      [ ! -e "$marker" ] && [ ! -L "$marker" ] || return 1
    fi
    unit_file_state=$(systemctl show "$timer" --property=UnitFileState --value) || return 1
    active_state=$(systemctl show "$timer" --property=ActiveState --value) || return 1
    if [ "${snapshot_timer_enabled[$index]}" = 1 ]; then
      [ "$unit_file_state" = enabled ] && systemctl is-enabled --quiet "$timer" || return 1
    else
      [ "$unit_file_state" = disabled ] || return 1
      if systemctl is-enabled --quiet "$timer"; then return 1; fi
    fi
    if [ "${snapshot_timer_active[$index]}" = 1 ]; then
      [ "$active_state" = active ] && systemctl is-active --quiet "$timer" || return 1
    else
      [ "$active_state" = inactive ] || return 1
      if systemctl is-active --quiet "$timer"; then return 1; fi
    fi
    [ -z "$(systemctl list-jobs --no-legend --plain "$timer" 2>/dev/null)" ] || return 1
  done
  validate_service_quiescence
}

clear_upgrade_transaction() {
  local index root=$snapshot_root cleanup_failed=0
  load_upgrade_journal || return 1
  [ "$upgrade_phase" = committed ] || return 1
  rm -f -- "$UPGRADE_JOURNAL" || return 1
  fsync_path "$RUNTIME_ROOT" || return 1
  for index in "${!constructor_markers[@]}"; do rm -f -- "$root/marker.$index" || cleanup_failed=1; done
  rm -f -- "$root/state" || cleanup_failed=1
  if [ "$cleanup_failed" = 0 ]; then rmdir -- "$root" || cleanup_failed=1; fi
  fsync_path "$RUNTIME_ROOT" || cleanup_failed=1
  if [ "$cleanup_failed" != 0 ]; then
    echo 'avertisment: snapshotul finalizat a rămas root-only; commitul activ rămâne valid' >&2
  fi
  return 0
}

[ -d "$ROOT" ] && [ ! -L "$ROOT" ] && [ "$(realpath -e -- "$ROOT")" = "$ROOT" ]
[ -d "$RUNTIME_ROOT" ] && [ ! -L "$RUNTIME_ROOT" ] \
  && [ "$(realpath -e -- "$RUNTIME_ROOT")" = "$RUNTIME_ROOT" ] \
  && [ "$(stat -Lc '%u:%g:%a' "$RUNTIME_ROOT")" = '0:10050:750' ]
if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
  [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$PUBLICATION_LOCK")" = '0:0:600:1' ] \
    || { echo 'lock-ul de publicare este nesigur' >&2; exit 1; }
else
  install -o root -g root -m 0600 /dev/null "$PUBLICATION_LOCK"
  fsync_path "$ROOT"
fi
exec 9<>"$PUBLICATION_LOCK"
[ "$(readlink /proc/$$/fd/9)" = "$PUBLICATION_LOCK" ]
[ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ]
flock -n 9 || { echo 'altă operație de publicare este activă' >&2; exit 1; }
[ "$(readlink /proc/$$/fd/9)" = "$PUBLICATION_LOCK" ] \
  && [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] \
  && [ ! -L "$PUBLICATION_LOCK" ] \
  && [ "$(stat -Lc '%d:%i' /proc/$$/fd/9)" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] \
  || { echo 'lock-ul de publicare s-a schimbat după flock' >&2; exit 1; }

if [ "$constructor_upgrade_recovery" = 0 ]; then
  [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    || { echo 'un jurnal existent cere selectarea recovery pin-uită' >&2; exit 1; }
  set_constructor_upgrade_phase snapshot
  for conflict in \
    "$INSTALL_JOURNAL" "$RUNTIME_JOURNAL" "$ACTIVATION_JOURNAL" "$GATE_JOURNAL" \
    "$UNIT_MIGRATION_PENDING" "$DESTRUCTIVE_RECOVERY_JOURNAL"; do
    [ ! -e "$conflict" ] && [ ! -L "$conflict" ] \
      || { echo 'alt recovery Constructor este activ; upgrade-ul este refuzat' >&2; exit 1; }
  done
  create_upgrade_snapshot || { echo 'starea activă Constructor nu poate fi capturată canonic' >&2; exit 1; }
else
  [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ] \
    || { echo 'recovery pin-uit cere jurnalul exterior existent' >&2; exit 1; }
fi

load_upgrade_journal || { echo 'jurnalul upgrade-ului Constructor este invalid sau aparține altui commit' >&2; exit 1; }
[ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ]
[ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ]

if [ "$upgrade_phase" = armed ]; then
  set_constructor_upgrade_phase quiesce
  quiesce_under_unit_pending \
    || { echo 'bariera persistentă a upgrade-ului nu poate ține Constructorul quiesced' >&2; exit 1; }
  set_constructor_upgrade_phase artifact-publication
  KELION_CONSTRUCTOR_INSTALL=1 \
  KELION_CUTOVER_LOCK_HELD=1 \
  KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
  KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
  KELION_CONSTRUCTOR_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
    bash "$repo_root/deploy/instaleaza-constructor.sh"
  validate_installed_generation_quiesced \
    || { echo 'generația Constructor publicată nu este completă și quiesced' >&2; exit 1; }
  set_constructor_upgrade_phase installed-commit
  write_upgrade_journal installed
  load_upgrade_journal
fi

if [ "$upgrade_phase" = installed ]; then
  set_constructor_upgrade_phase activation-prepare
  activation_restore_started=1
  strict_constructor_config_recommit
  validate_committed_activation_vector_quiesced \
    || { echo 'generația comisă nu a rămas exactă și quiesced' >&2; exit 1; }
  set_constructor_upgrade_phase activation-commit
  write_upgrade_journal committed
  load_upgrade_journal
fi

[ "$upgrade_phase" = committed ]
set_constructor_upgrade_phase activation-restore
activation_restore_started=1
quiesce_committed_activation
validate_committed_activation_vector_quiesced \
  || { echo 'faza committed nu poate fi revalidată exact și quiesced' >&2; exit 1; }
# Un rename committed observabil după SIGKILL nu dovedește fsync-ul directorului.
# Republicăm idempotent pragul sub quiesce la fiecare retry, astfel încât ready și
# primul start să urmeze întotdeauna unui committed durabil în execuția curentă.
write_upgrade_journal committed
load_upgrade_journal
finalize_committed_activation
validate_restored_activation_vector \
  || { echo 'starea markerelor și timerelor nu a fost restaurată exact' >&2; exit 1; }

set_constructor_upgrade_phase commit
worker_sha256=$(sha256sum /opt/kelion-codex/codex-worker.mjs | awk '{print $1}')
# Committed este republicat durabil, iar vectorul activ și workerul sunt dovedite
# exact. Orice eșec al clear-ului trebuie să păstreze această stare: outer prezent
# reia committed, iar outer absent permite unui fresh upgrade s-o captureze.
activation_restore_started=0
clear_upgrade_transaction
printf '{"ok":true,"event":"constructor_upgrade_complete","source_commit":"%s","worker_sha256":"%s"}\n' \
  "$constructor_upgrade_source_commit" "$worker_sha256"
