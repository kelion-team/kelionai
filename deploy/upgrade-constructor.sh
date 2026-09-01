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
controller_commit_start_started=0

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
  local status=$? cleanup_status=0 must_block_controller=0
  trap - ERR EXIT
  if [ "$status" = 0 ]; then return 0; fi
  if [ -n "${UPGRADE_JOURNAL:-}" ] \
    && { [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]; }; then
    must_block_controller=1
  fi
  [ "${controller_commit_start_started:-0}" = 0 ] || must_block_controller=1
  if [ "$must_block_controller" = 1 ] \
    && declare -F publish_upgrade_activation_pending >/dev/null 2>&1; then
    publish_upgrade_activation_pending || cleanup_status=1
    systemctl stop kelion-constructor-model-control.service >/dev/null 2>&1 || :
  fi
  if [ "$activation_restore_started" = 1 ] \
    && [ -x /root/kelion/bin/runtime-config-cutover.sh ] \
    && [ -f /root/kelion/config/compose.production.yml ]; then
    KELION_CUTOVER_LOCK_HELD=1 KELION_CONSTRUCTOR_UPGRADE_OWNER=1 \
      KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT="$constructor_upgrade_source_commit" \
      /root/kelion/bin/runtime-config-cutover.sh \
      --recover-only /root/kelion/config/compose.production.yml --leave-constructor-quiesced \
      >/dev/null || cleanup_status=1
  fi
  if [ "$must_block_controller" = 1 ] \
    && declare -F publish_upgrade_activation_pending >/dev/null 2>&1; then
    publish_upgrade_activation_pending || cleanup_status=1
    validate_model_controller_quiesced || cleanup_status=1
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
  "$repo_root/deploy/constructor-model-control.mjs" \
  "$repo_root/deploy/constructor-model-switch.sh" \
  "$repo_root/deploy/lib/service-auth.mjs" \
  "$repo_root/deploy/opencode-constructor.json" \
  "$repo_root/deploy/opencode-constructor-instructions.md" \
  "$repo_root/deploy/systemd/private-ai-web-full-access.conf" \
  "$repo_root/deploy/sudoers/kelion-codex-full-access" \
  "$repo_root/deploy/systemd/kelion-codex-worker.service" \
  "$repo_root/deploy/systemd/kelion-constructor-model-control.service" \
  "$repo_root/deploy/lib/runtime-config-cutover.sh" \
  "$repo_root/deploy/compose.production.yml"; do
  [ -f "$source" ] && [ ! -L "$source" ] \
    || { echo 'bundle-ul upgrade-ului Constructor este incomplet' >&2; exit 1; }
done
for tool in awk cmp curl flock grep install jq mktemp python3 readlink realpath runuser sha256sum stat sync systemctl visudo wc; do
  command -v "$tool" >/dev/null 2>&1 \
    || { echo "lipsește utilitarul $tool" >&2; exit 1; }
done

ROOT=/root/kelion
RUNTIME_ROOT=$ROOT/runtime
CONFIG_ROOT=$ROOT/config
PUBLICATION_LOCK=$ROOT/publicare.lock
UPGRADE_JOURNAL=$RUNTIME_ROOT/constructor-upgrade.journal
MAX_MODEL_JOURNAL=$RUNTIME_ROOT/constructor-max-model.journal
INSTALL_JOURNAL=$RUNTIME_ROOT/constructor-deploy-quiesce.journal
RUNTIME_JOURNAL=$RUNTIME_ROOT/runtime-config-cutover.journal
ACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-activation.journal
GATE_JOURNAL=$RUNTIME_ROOT/constructor-gate-refresh.journal
UNIT_MIGRATION_PENDING=$RUNTIME_ROOT/constructor-unit-migration.pending
REACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-reactivation.journal
DESTRUCTIVE_RECOVERY_JOURNAL=$RUNTIME_ROOT/destructive-cutover-recovery.json
READY_ROOT=/run/kelion
READY_STAMP=$READY_ROOT/runtime-config-recovery.ready
ACTIVATION_PENDING=$READY_ROOT/constructor-activation.pending

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

validate_upgrade_activation_pending() {
  [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
    && [ "$(realpath -e -- "$READY_ROOT")" = "$READY_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] \
    && [ -f "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ACTIVATION_PENDING")" = '0:0:444:1' ] \
    && [ "$(wc -l < "$ACTIVATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$ACTIVATION_PENDING"
}

publish_upgrade_activation_pending() {
  local temporary
  if [ -e "$READY_ROOT" ] || [ -L "$READY_ROOT" ]; then
    [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
      && [ "$(realpath -e -- "$READY_ROOT")" = "$READY_ROOT" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] || return 1
  else
    install -d -o root -g root -m 0755 "$READY_ROOT" || return 1
    fsync_path /run || return 1
  fi
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$READY_STAMP")" = '0:0:444:1' ] || return 1
    rm -f -- "$READY_STAMP" || return 1
    fsync_path "$READY_ROOT" || return 1
  fi
  if [ -e "$ACTIVATION_PENDING" ] || [ -L "$ACTIVATION_PENDING" ]; then
    validate_upgrade_activation_pending
    return
  fi
  temporary=$(mktemp "$READY_ROOT/.constructor-activation.pending.XXXXXX") || return 1
  if printf 'schema=1\n' > "$temporary" \
    && chown root:root "$temporary" && chmod 0444 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$ACTIVATION_PENDING" \
    && fsync_path "$READY_ROOT" \
    && validate_upgrade_activation_pending; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

clear_upgrade_activation_pending() {
  validate_upgrade_activation_pending || return 1
  rm -f -- "$ACTIVATION_PENDING" || return 1
  fsync_path "$READY_ROOT"
}

validate_model_controller_quiesced() {
  local unit=kelion-constructor-model-control.service state
  systemctl cat "$unit" >/dev/null 2>&1 || return 1
  state=$(systemctl show "$unit" --property=ActiveState --value) || return 1
  case "$state" in inactive|failed) ;; *) return 1 ;; esac
  [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ] \
    && [ ! -e /run/kelion-constructor-model-control/control.sock ] \
    && [ ! -L /run/kelion-constructor-model-control/control.sock ]
}

start_model_controller_after_upgrade_commit() {
  local helper=$ROOT/bin/runtime-config-cutover.sh compose=$CONFIG_ROOT/compose.production.yml
  [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    && [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] \
    && [ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] \
    && [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] || return 1
  validate_reactivation_journal || return 1
  [ -f "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] || return 1
  [ -f "$helper" ] && [ ! -L "$helper" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$helper")" = '0:0:500:1' ] || return 1
  [ -f "$compose" ] && [ ! -L "$compose" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$compose")" = '0:0:444:1' ] || return 1
  # După unlink-ul outer, helperul generic adoptă markerul persistent, reface
  # sincron controllerul+socketul și timerele, apoi îl șterge/fsync ultimul.
  KELION_CUTOVER_LOCK_HELD=1 "$helper" --recover-only "$compose" || return 1
  [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ]
}

validate_reactivation_journal() {
  [ -f "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$REACTIVATION_JOURNAL")" = '0:0:600:1' ] \
    && jq -e '
      .schema == 1 and .kind == "constructor-reactivation" and .phase == "pending" and
      (keys == ["kind","phase","schema"])
    ' "$REACTIVATION_JOURNAL" >/dev/null
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

validate_reactivation_postcondition() {
  local index marker timer socket=/run/kelion-constructor-model-control/control.sock
  [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] \
    && validate_ready_stamp \
    && systemctl is-active --quiet kelion-constructor-model-control.service \
    && [ -S "$socket" ] && [ ! -L "$socket" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$socket")" = '0:10050:660' ] || return 1
  for index in "${!constructor_markers[@]}"; do
    marker=${constructor_markers[$index]}; timer=${constructor_timers[$index]}
    if [ -e "$marker" ] || [ -L "$marker" ]; then
      [ -f "$marker" ] && [ ! -L "$marker" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$marker")" = '0:0:444:1' ] \
        && systemctl is-enabled --quiet "$timer" \
        && systemctl is-active --quiet "$timer" || return 1
    elif systemctl is-enabled --quiet "$timer" || systemctl is-active --quiet "$timer"; then
      return 1
    fi
  done
}

recover_orphaned_reactivation_before_upgrade() {
  local helper=$ROOT/bin/runtime-config-cutover.sh compose=$CONFIG_ROOT/compose.production.yml
  validate_reactivation_journal || return 1
  [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    && [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] \
    && [ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] \
    && [ ! -e "$RUNTIME_JOURNAL" ] && [ ! -L "$RUNTIME_JOURNAL" ] \
    && [ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ] \
    && [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] \
    && [ ! -e "$DESTRUCTIVE_RECOVERY_JOURNAL" ] && [ ! -L "$DESTRUCTIVE_RECOVERY_JOURNAL" ] \
    || return 1
  [ -f "$helper" ] && [ ! -L "$helper" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$helper")" = '0:0:500:1' ] \
    && cmp -s -- "$repo_root/deploy/lib/runtime-config-cutover.sh" "$helper" \
    && [ -f "$compose" ] && [ ! -L "$compose" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$compose")" = '0:0:444:1' ] || return 1
  KELION_CUTOVER_LOCK_HELD=1 "$helper" --recover-only "$compose" || return 1
  validate_reactivation_postcondition
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

validate_max_model_complete_receipt() {
  local receipt=/etc/private-ai/.max-model-complete
  local expected_fast_path=$1
  local -a lines=()
  [ -f "$receipt" ] && [ ! -L "$receipt" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$receipt")" = '0:0:600:1' ] || return 1
  mapfile -t lines < "$receipt"
  [ "${#lines[@]}" -eq 20 ] || return 1
  [ "${lines[0]}" = 'schema=2' ] || return 1
  [ "${lines[1]}" = 'default_model=llama.cpp/qwen3.6-35b-a3b-local' ] || return 1
  [ "${lines[2]}" = 'powerful_model=llama.cpp/qwen3.5-122b-a10b-local' ] || return 1
  [ "${lines[3]}" = 'active_profile=fast' ] || return 1
  [ "${lines[4]}" = 'model_repo=unsloth/Qwen3.5-122B-A10B-GGUF' ] || return 1
  [ "${lines[5]}" = 'model_revision=a97b483a9f8cad9788776aa0112a2c63bf349e9e' ] || return 1
  [ "${lines[6]}" = 'model_quant=Q4_K_M' ] || return 1
  [ "${lines[7]}" = 'model_total_bytes=76536964608' ] || return 1
  [ "${lines[8]}" = 'shard_1_sha256=467c9bd92ea518539cf75bf5a5fbfbd35e9a0b40d766ccaa67bf120e12041df3' ] || return 1
  [ "${lines[9]}" = 'shard_2_sha256=90db14846413aebdac365b57206441437cac5f7e5037d94b325f0167f902e6e7' ] || return 1
  [ "${lines[10]}" = 'shard_3_sha256=e3c24b8ebec070bb4f69ea0aca25a16531da7440cd515529953e046882901f97' ] || return 1
  [ "${lines[11]}" = 'fast_model_bytes=20419565568' ] || return 1
  [ "${lines[12]}" = 'fast_model_sha256=671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7' ] || return 1
  [[ "$expected_fast_path" == /srv/private-ai/models/* ]] \
    && [ "$(realpath -e -- "$expected_fast_path")" = "$expected_fast_path" ] \
    && [ "${lines[13]}" = "fast_model_path=$expected_fast_path" ] || return 1
  [[ "${lines[14]}" =~ ^installer_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[15]}" =~ ^worker_source_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[16]}" =~ ^config_source_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[17]}" =~ ^worker_unit_source_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[18]}" =~ ^switch_source_sha256=[0-9a-f]{64}$ ]] || return 1
  [[ "${lines[19]}" =~ ^verified_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
}

expected_powerful_runtime_dropin() {
  cat <<'EOF'
[Service]
ExecStart=
ExecStart=/opt/private-ai/bin/llama-server --model /srv/private-ai/models/qwen3.5-122b-a10b-q4_k_m/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf --alias qwen3.5-122b-a10b-local --host 127.0.0.1 --port 24080 --ctx-size 16384 --n-predict 4096 --threads 16 --parallel 1 --jinja --chat-template-kwargs '{"enable_thinking":false}'
Restart=no
TimeoutStartSec=3600
CPUQuota=1600%
MemoryHigh=84G
MemoryMax=88G
EOF
}

validate_private_ai_executor() {
  local expected_controller_state=${1:-active}
  local receipt=/etc/private-ai/.install-complete
  local config=/srv/private-ai/home/.config/opencode/opencode.json
  local instructions=/srv/private-ai/home/.config/opencode/instructions.md
  local llama_server=/opt/private-ai/bin/llama-server llama_source=/opt/private-ai/src/llama.cpp
  local llama_state=/var/lib/private-ai/llama-cpp.commit model_cache=/srv/private-ai/models
  local unit_text self_test_output web_dropin web_pid web_dropins model_file_path fast_model_file_path llm_pid active_alias powerful_root
  local legacy_model_dropin=/etc/systemd/system/private-ai-llm.service.d/90-qwen35-122b-max.conf
  local runtime_model_dropin=/run/systemd/system/private-ai-llm.service.d/90-constructor-model.conf model_dropins
  local -a receipt_lines=()
  local -a model_candidates=()
  case "$expected_controller_state" in active|quiesced) ;; *) return 1 ;; esac
  [ -f "$receipt" ] && [ ! -L "$receipt" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$receipt")" = '0:0:600:1' ] || return 1
  mapfile -t receipt_lines < "$receipt"
  [ "${#receipt_lines[@]}" -eq 6 ] || return 1
  [ "${receipt_lines[0]}" = 'installer_id=private-ai-contabo-v1' ] || return 1
  [[ "${receipt_lines[1]}" =~ ^completed_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] || return 1
  [ "${receipt_lines[2]}" = 'llama_cpp_ref=c1d0e7a004015f23bc0233470b747b596f29b264' ] || return 1
  [ "${receipt_lines[3]}" = 'opencode_version=1.18.25' ] || return 1
  [ "${receipt_lines[4]}" = 'model_repo=ggml-org/Qwen3.6-35B-A3B-GGUF' ] || return 1
  [ "${receipt_lines[5]}" = 'model_quant=Q4_K_M' ] || return 1
  [ -x /opt/private-ai/bin/opencode ] && [ ! -L /opt/private-ai/bin/opencode ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' /opt/private-ai/bin/opencode)" = '0:0:755:1' ] || return 1
  [ "$(sha256sum /opt/private-ai/bin/opencode | awk '{print $1}')" = \
    d91e0d33676d0839f7cde87924cd4127ea88c9d6784eea9f009a7d08bdc60eeb ] || return 1
  [ "$(env -i HOME=/srv/private-ai/home PATH=/usr/bin:/bin /opt/private-ai/bin/opencode --version)" = 1.18.25 ] || return 1
  [ -x "$llama_server" ] && [ ! -L "$llama_server" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$llama_server")" = '0:0:755:1' ] || return 1
  [ "$(sha256sum "$llama_server" | awk '{print $1}')" = \
    bc27b0436ccf37e04135acede4acb25c0cb377272bc52219b9c0df2f1211dbc0 ] || return 1
  [ -f "$llama_state" ] && [ ! -L "$llama_state" ] \
    && [ "$(stat -Lc '%U:%G:%a:%h' "$llama_state")" = 'privateai:privateai:600:1' ] || return 1
  [ "$(tr -d '\n' < "$llama_state")" = c1d0e7a004015f23bc0233470b747b596f29b264 ] || return 1
  [ -d "$llama_source/.git" ] && [ ! -L "$llama_source" ] || return 1
  [ "$(runuser -u privateai -- env -i HOME=/srv/private-ai/home PATH=/usr/bin:/bin \
    git -C "$llama_source" rev-parse HEAD)" = c1d0e7a004015f23bc0233470b747b596f29b264 ] || return 1
  mapfile -d '' -t model_candidates < <(
    find "$model_cache" -xdev -type f -size 20419565568c -print0
  )
  [ "${#model_candidates[@]}" -eq 1 ] || return 1
  fast_model_file_path=${model_candidates[0]}
  [ -f "$fast_model_file_path" ] && [ ! -L "$fast_model_file_path" ] \
    && [ "$(stat -Lc '%U:%G:%s:%h' "$fast_model_file_path")" = \
      'privateai:privateai:20419565568:1' ] || return 1
  [ "$(sha256sum "$fast_model_file_path" | awk '{print $1}')" = \
    671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7 ] || return 1
  systemctl is-active --quiet private-ai-llm.service || return 1
  active_alias=$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models \
    | jq -er '.data | select(type == "array" and length == 1) | .[0].id') || return 1
  [ ! -e "$legacy_model_dropin" ] && [ ! -L "$legacy_model_dropin" ] || return 1
  model_dropins=$(systemctl show private-ai-llm.service --property=DropInPaths --value) || return 1
  [[ " $model_dropins " != *" $legacy_model_dropin "* ]] || return 1
  case "$active_alias" in
    qwen3.6-35b-a3b-local)
      model_file_path=$fast_model_file_path
      [ ! -e "$runtime_model_dropin" ] && [ ! -L "$runtime_model_dropin" ] || return 1
      [[ " $model_dropins " != *" $runtime_model_dropin "* ]] || return 1
      systemctl is-active --quiet private-ai-web.service || return 1
      ;;
    qwen3.5-122b-a10b-local)
      powerful_root=$model_cache/qwen3.5-122b-a10b-q4_k_m
      [ -f /etc/private-ai/.max-model-sealed ] && [ ! -L /etc/private-ai/.max-model-sealed ] || return 1
      validate_max_model_complete_receipt "$fast_model_file_path" || return 1
      [ -f "$runtime_model_dropin" ] && [ ! -L "$runtime_model_dropin" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$runtime_model_dropin")" = '0:0:644:1' ] \
        && [ "$(<"$runtime_model_dropin")" = "$(expected_powerful_runtime_dropin)" ] \
        && [[ " $model_dropins " == *" $runtime_model_dropin "* ]] || return 1
      [ "$(stat -Lc '%U:%G:%a:%s:%h' "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf")" = 'root:privateai:440:10943552:1' ] || return 1
      [ "$(stat -Lc '%U:%G:%a:%s:%h' "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf")" = 'root:privateai:440:49968146912:1' ] || return 1
      [ "$(stat -Lc '%U:%G:%a:%s:%h' "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf")" = 'root:privateai:440:26557874144:1' ] || return 1
      model_file_path=$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf
      ! systemctl is-active --quiet private-ai-web.service || return 1
      ;;
    *) return 1 ;;
  esac
  llm_pid=$(systemctl show private-ai-llm.service -p MainPID --value)
  [[ "$llm_pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [ "$(readlink -f -- "/proc/$llm_pid/exe")" = "$llama_server" ] || return 1
  awk -v target="$model_file_path" '$NF == target { found=1 } END { exit !found }' \
    "/proc/$llm_pid/maps" || return 1
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:24080/health >/dev/null || return 1
  [ "$active_alias" = "$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models \
    | jq -er '.data | select(type == "array" and length == 1) | .[0].id')" ] || return 1
  cmp -s -- "$repo_root/deploy/opencode-constructor.json" "$config" || return 1
  cmp -s -- "$repo_root/deploy/opencode-constructor-instructions.md" "$instructions" || return 1
  [ "$(stat -Lc '%U:%G:%a:%h' "$config")" = 'root:privateai:640:1' ] || return 1
  [ "$(stat -Lc '%U:%G:%a:%h' "$instructions")" = 'root:privateai:640:1' ] || return 1
  jq -e '
    . as $config |
    $config.autoupdate == false and $config.share == "disabled" and
    $config.model == "llama.cpp/qwen3.6-35b-a3b-local" and
    ($config.small_model // $config.model) == "llama.cpp/qwen3.6-35b-a3b-local" and
    $config.enabled_providers == ["llama.cpp"] and
    ($config.provider | keys) == ["llama.cpp"] and
    $config.provider["llama.cpp"].npm == "@ai-sdk/openai-compatible" and
    $config.provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1" and
    ($config.provider["llama.cpp"].options | has("apiKey") | not) and
    ($config.provider["llama.cpp"].models | has("qwen3.6-35b-a3b-local")) and
    ($config.provider["llama.cpp"].models | has("qwen3.5-122b-a10b-local")) and
    (["*","read","glob","grep","edit","bash","task","skill","webfetch","websearch","external_directory"]
      | all(.[]; $config.permission[.] == "allow"))
  ' "$config" >/dev/null || return 1
  cmp -s -- "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs || return 1
  cmp -s -- "$repo_root/deploy/constructor-model-control.mjs" /opt/kelion-constructor/constructor-model-control.mjs || return 1
  cmp -s -- "$repo_root/deploy/constructor-model-switch.sh" /opt/private-ai/bin/constructor-model-switch || return 1
  cmp -s -- "$repo_root/deploy/lib/service-auth.mjs" /opt/kelion-constructor/lib/service-auth.mjs || return 1
  cmp -s -- "$repo_root/deploy/systemd/kelion-codex-worker.service" /etc/systemd/system/kelion-codex-worker.service || return 1
  cmp -s -- "$repo_root/deploy/systemd/kelion-constructor-model-control.service" /etc/systemd/system/kelion-constructor-model-control.service || return 1
  cmp -s -- "$repo_root/deploy/sudoers/kelion-codex-full-access" /etc/sudoers.d/kelion-constructor-full-access || return 1
  web_dropin=/etc/systemd/system/private-ai-web.service.d/90-kelion-constructor-full-access.conf
  cmp -s -- "$repo_root/deploy/systemd/private-ai-web-full-access.conf" "$web_dropin" || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /opt/kelion-codex/codex-worker.mjs)" = '0:0:555:1' ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /opt/kelion-constructor/constructor-model-control.mjs)" = '0:0:555:1' ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /opt/private-ai/bin/constructor-model-switch)" = '0:0:755:1' ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /opt/kelion-constructor/lib/service-auth.mjs)" = '0:0:444:1' ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /etc/systemd/system/kelion-codex-worker.service)" = '0:0:444:1' ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /etc/systemd/system/kelion-constructor-model-control.service)" = '0:0:444:1' ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' /etc/sudoers.d/kelion-constructor-full-access)" = '0:0:440:1' ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' "$web_dropin")" = '0:0:444:1' ] || return 1
  [ "$(wc -l < /etc/sudoers.d/kelion-constructor-full-access)" -eq 1 ] || return 1
  grep -qxF 'kelion-codex ALL=(ALL:ALL) NOPASSWD: ALL' /etc/sudoers.d/kelion-constructor-full-access || return 1
  visudo -cf /etc/sudoers.d/kelion-constructor-full-access >/dev/null || return 1
  [ "$(systemctl show kelion-codex-worker.service --property=FragmentPath --value)" = /etc/systemd/system/kelion-codex-worker.service ] || return 1
  [ "$(systemctl show kelion-constructor-model-control.service --property=FragmentPath --value)" = /etc/systemd/system/kelion-constructor-model-control.service ] || return 1
  [ -z "$(systemctl show kelion-constructor-model-control.service --property=DropInPaths --value)" ] || return 1
  systemctl is-enabled --quiet kelion-constructor-model-control.service || return 1
  if [ "$expected_controller_state" = active ]; then
    systemctl is-active --quiet kelion-constructor-model-control.service || return 1
    [ -S /run/kelion-constructor-model-control/control.sock ] \
      && [ ! -L /run/kelion-constructor-model-control/control.sock ] \
      && [ "$(stat -Lc '%u:%g:%a' /run/kelion-constructor-model-control/control.sock)" = '0:10050:660' ] || return 1
  else
    validate_model_controller_quiesced || return 1
  fi
  [ -z "$(systemctl show kelion-codex-worker.service --property=DropInPaths --value)" ] || return 1
  unit_text=$(systemctl cat kelion-codex-worker.service) || return 1
  grep -Fqx 'Environment=OPENCODE_BIN=/opt/private-ai/bin/opencode' <<<"$unit_text" || return 1
  ! grep -Eqi 'CODEX_(BIN|HOME)|OPENAI_(API|ADMIN)_KEY|openai-project-key|codex-real|opencode-constructor-root' <<<"$unit_text" || return 1
  web_dropins=$(systemctl show private-ai-web.service --property=DropInPaths --value) || return 1
  [ "$web_dropins" = "$web_dropin" ] || return 1
  [ "$(systemctl show private-ai-web.service --property=User --value)" = root ] || return 1
  [ "$(systemctl show private-ai-web.service --property=Group --value)" = root ] || return 1
  [ "$(systemctl show private-ai-web.service --property=NoNewPrivileges --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=PrivateIPC --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=PrivateDevices --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=PrivateTmp --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=ProtectHome --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=ProtectControlGroups --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=ProtectKernelLogs --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=ProtectKernelModules --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=ProtectKernelTunables --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=ProtectSystem --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=RestrictNamespaces --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=RestrictSUIDSGID --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=LockPersonality --value)" = no ] || return 1
  [ "$(systemctl show private-ai-web.service --property=CPUQuotaPerSecUSec --value)" = infinity ] || return 1
  [ "$(systemctl show private-ai-web.service --property=CPUWeight --value)" = 100 ] || return 1
  [ "$(systemctl show private-ai-web.service --property=MemoryHigh --value)" = infinity ] || return 1
  [ "$(systemctl show private-ai-web.service --property=MemoryMax --value)" = infinity ] || return 1
  [ "$(systemctl show private-ai-web.service --property=TasksMax --value)" = infinity ] || return 1
  if [ "$active_alias" = qwen3.6-35b-a3b-local ]; then
    web_pid=$(systemctl show private-ai-web.service --property=MainPID --value) || return 1
    [[ "$web_pid" =~ ^[1-9][0-9]*$ ]] && [ -r "/proc/$web_pid/status" ] \
      && [ "$(awk '/^Uid:/ { print $2 }' "/proc/$web_pid/status")" = 0 ] || return 1
  fi
  for retired in \
    /var/lib/kelion-codex-auth /opt/kelion-codex/bin/codex-real \
    /opt/private-ai/bin/opencode-constructor-root /etc/private-ai/local-codex-compat-key \
    /etc/sudoers.d/kelion-local-qwen-constructor \
    /etc/systemd/system/kelion-codex-worker.service.d/90-local-qwen-full-access.conf \
    /etc/systemd/system/kelion-codex-worker.service.d/90-local-opencode-full-access.conf; do
    [ ! -e "$retired" ] && [ ! -L "$retired" ] || return 1
  done
  [ "$(runuser -u kelion-codex -- env -i PATH=/usr/bin:/bin \
    /usr/bin/sudo -n -u root -- /usr/bin/id -u)" = 0 ] || return 1
  self_test_output=$(runuser -u kelion-codex -- env -i HOME=/var/lib/kelion-codex PATH=/usr/bin:/bin \
    /usr/bin/node /opt/kelion-codex/codex-worker.mjs --self-test) || return 1
  [ "$self_test_output" = 'codex-worker self-test: TRECE' ]
}

validate_installed_generation_quiesced() {
  local marker timer state
  [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] || return 1
  [ ! -e "$RUNTIME_JOURNAL" ] && [ ! -L "$RUNTIME_JOURNAL" ] || return 1
  validate_unit_pending || return 1
  [ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] || return 1
  validate_upgrade_activation_pending || return 1
  cmp -s -- "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs || return 1
  validate_private_ai_executor quiesced || return 1
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
  validate_upgrade_activation_pending || return 1
  cmp -s -- "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs || return 1
  validate_private_ai_executor quiesced || return 1
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
  [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] || return 1
  validate_reactivation_journal || return 1
  validate_ready_stamp || return 1
  cmp -s -- "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs || return 1
  validate_private_ai_executor quiesced || return 1
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
  validate_reactivation_journal || return 1
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

if { [ -e "$REACTIVATION_JOURNAL" ] || [ -L "$REACTIVATION_JOURNAL" ]; } \
  && { [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ]; }; then
  set_constructor_upgrade_phase reactivation-recovery
  recover_orphaned_reactivation_before_upgrade \
    || { echo 'reactivarea orphaned din tail-ul upgrade-ului nu poate fi adoptată sigur' >&2; exit 1; }
fi

if [ "$constructor_upgrade_recovery" = 0 ]; then
  [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    || { echo 'un jurnal existent cere selectarea recovery pin-uită' >&2; exit 1; }
  set_constructor_upgrade_phase snapshot
  for conflict in \
    "$INSTALL_JOURNAL" "$RUNTIME_JOURNAL" "$ACTIVATION_JOURNAL" "$GATE_JOURNAL" \
    "$UNIT_MIGRATION_PENDING" "$REACTIVATION_JOURNAL" "$MAX_MODEL_JOURNAL" "$DESTRUCTIVE_RECOVERY_JOURNAL"; do
    [ ! -e "$conflict" ] && [ ! -L "$conflict" ] \
      || { echo 'alt recovery Constructor este activ; upgrade-ul este refuzat' >&2; exit 1; }
  done
  create_upgrade_snapshot || { echo 'starea activă Constructor nu poate fi capturată canonic' >&2; exit 1; }
else
  [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ] \
    || { echo 'recovery pin-uit cere jurnalul exterior existent' >&2; exit 1; }
  [ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] \
    || { echo 'tranzacția max-model blochează recovery-ul upgrade-ului' >&2; exit 1; }
fi

load_upgrade_journal || { echo 'jurnalul upgrade-ului Constructor este invalid sau aparține altui commit' >&2; exit 1; }
[ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ]
[ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ]
publish_upgrade_activation_pending \
  || { echo 'sentinelul exterior al controllerului nu poate fi publicat durabil' >&2; exit 1; }

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
# Jurnalul exterior committed continuă să țină controllerul oprit în helper.
# Retragem sentinelul numai pentru ca ready/timerele să poată fi restaurate;
# controllerul va fi pornit explicit abia după clear-ul jurnalului exterior.
clear_upgrade_activation_pending
finalize_committed_activation
validate_restored_activation_vector \
  || { echo 'starea markerelor și timerelor nu a fost restaurată exact' >&2; exit 1; }

set_constructor_upgrade_phase commit
worker_sha256=$(sha256sum /opt/kelion-codex/codex-worker.mjs | awk '{print $1}')
# Committed este republicat durabil, iar vectorul activ și workerul sunt dovedite
# exact. Orice eșec al clear-ului trebuie să păstreze această stare: outer prezent
# reia committed, iar outer absent permite unui fresh upgrade s-o captureze.
clear_upgrade_transaction
start_model_controller_after_upgrade_commit \
  || { echo 'controllerul manual nu a pornit după clear-ul upgrade-ului' >&2; exit 1; }
activation_restore_started=0
printf '{"ok":true,"event":"constructor_upgrade_complete","source_commit":"%s","worker_sha256":"%s"}\n' \
  "$constructor_upgrade_source_commit" "$worker_sha256"
