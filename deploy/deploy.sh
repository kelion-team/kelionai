#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf 'release: %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "lipsește utilitarul $1"; }

[ "$(id -u)" -eq 0 ] || die 'rulează numai ca root pe gazda de release'
[ "${KELION_RELEASE_APPROVED:-0}" = 1 ] || die 'lipsește aprobarea explicită de release'
[[ "${KELION_CI_RUN_ID:-}" =~ ^[0-9]+$ ]] || die 'dovada CI este invalidă'
[[ "${KELION_BUILD_RUN_ID:-}" =~ ^[0-9]+$ ]] || die 'dovada build-ului este invalidă'
[[ "${KELION_RELEASE_REQUEST_ID:-}" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
  || die 'identitatea cererii de release este invalidă'
[[ "${KELION_RELEASE_WORKFLOW_RUN_ID:-}" =~ ^[1-9][0-9]*$ ]] \
  || die 'identitatea run-ului workflow de release este invalidă'

COMMIT_SHA=${1:-}
MANIFEST_FILE=${2:-}
RELEASE_MODE=${3:-release}
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'commitul trebuie să fie SHA integral'
[[ "$RELEASE_MODE" = release || "$RELEASE_MODE" = rollback ]] || die 'modul release este invalid'
[ -f "$MANIFEST_FILE" ] || die 'manifestul OCI lipsește'
GATE_MANIFEST_FILE=$(dirname -- "$MANIFEST_FILE")/codex-gates.json
[ -f "$GATE_MANIFEST_FILE" ] && [ ! -L "$GATE_MANIFEST_FILE" ] || die 'manifestul gate lipsește'
KELION_CODEX_GATE_IMAGE=$(jq -er --arg commit "$COMMIT_SHA" 'select(.schema == 1 and .commit == $commit and (.image | type == "string")) | .image' "$GATE_MANIFEST_FILE")
[[ "$KELION_CODEX_GATE_IMAGE" =~ ^ghcr.io/[a-z0-9_.-]+/[a-z0-9_.-]+/codex-gates@sha256:[0-9a-f]{64}$ ]] || die 'imaginea gate este invalidă'

need docker
need curl
need jq
need flock
need openssl
need python3
need crontab
need systemctl
need systemd-analyze
need readlink
need realpath
need sha256sum
need stat
need date

ROOT=/root/kelion
BUNDLE_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
PRODUCT_FILE=$BUNDLE_DIR/../config/product.json
COMPOSE_FILE=$BUNDLE_DIR/compose.production.yml
PROXY_COMPOSE_FILE=$BUNDLE_DIR/compose.proxy.yml
CONFIG_FILE=$ROOT/config/runtime.env
SECRET_ROOT=$ROOT/secrets
RUNTIME_ROOT=$ROOT/runtime
RELEASE_STATE_ROOT=$RUNTIME_ROOT/release-state
RELEASE_REQUEST_LEDGER_ROOT=$RELEASE_STATE_ROOT/requests
RELEASE_REQUEST_LEDGER=$RELEASE_REQUEST_LEDGER_ROOT/$KELION_RELEASE_REQUEST_ID.json
PROXY_CONFIG_ROOT=$ROOT/proxy
PROXY_STATE_ROOT=$ROOT/proxy-state
COMPOSE_BIN=$ROOT/bin/docker-compose
UPSTREAM_FILE=$PROXY_CONFIG_ROOT/upstream/kelion-upstream.caddy
LIVE_CADDYFILE=$PROXY_CONFIG_ROOT/Caddyfile
SECCOMP_PROFILE=$RUNTIME_ROOT/playwright-seccomp-v1.62.1.json
PROOF_FILE=$RUNTIME_ROOT/last-verified-backup.json
PROOF_KEY=$SECRET_ROOT/migration-backup-proof-key
migration_proof_copy=''
PUBLICATION_LOCK=$ROOT/publicare.lock
RECOVERY_JOURNAL=$RUNTIME_ROOT/destructive-cutover-recovery.json
CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL=$RUNTIME_ROOT/constructor-deploy-quiesce.journal
BACKUP_INSTALL_ROOT=/opt/kelion-backup
BACKUP_RELEASE_ROOT=$BACKUP_INSTALL_ROOT/releases
PERSISTENT_BACKUP_SCRIPT=$BACKUP_RELEASE_ROOT/$COMMIT_SHA/backup.sh
BACKUP_CURRENT_LINK=$BACKUP_INSTALL_ROOT/current
BACKUP_SERVICE=kelion-backup.service
BACKUP_TIMER=kelion-backup.timer
SYSTEMD_UNIT_ROOT=/etc/systemd/system
LEGACY_BACKUP_CRON='0 3 * * 0 /root/kelion/backup.sh >> /root/kelion/backup.log 2>&1'
LEGACY_BACKUP_CRON_MARKER=$RUNTIME_ROOT/legacy-backup-cron-retired
LEGACY_RUNTIME_CONTAINERS=(kelionai-app omniroute kelionai-coqui)

fsync_release_artifact() {
  python3 - "$1" "$2" <<'PY'
import os
import sys

path, kind = sys.argv[1:]
if kind == 'file':
    descriptor = os.open(path, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
elif kind != 'directory':
    raise SystemExit(2)
directory = path if kind == 'directory' else os.path.dirname(path)
descriptor = os.open(directory, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

container_restart_policy() {
  local container=$1 name maximum
  name=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$container" 2>/dev/null) || return 1
  maximum=$(docker inspect -f '{{.HostConfig.RestartPolicy.MaximumRetryCount}}' "$container" 2>/dev/null) || return 1
  case "$name" in
    no|always|unless-stopped) printf '%s' "$name" ;;
    on-failure)
      [[ "$maximum" =~ ^[0-9]+$ ]] || return 1
      if [ "$maximum" -gt 0 ]; then printf 'on-failure:%s' "$maximum"; else printf 'on-failure'; fi
      ;;
    *) return 1 ;;
  esac
}

set_container_restart_policy() {
  local container=$1 policy=$2
  [[ "$policy" =~ ^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$ ]] || return 1
  docker update --restart="$policy" "$container" >/dev/null || return 1
  [ "$(container_restart_policy "$container")" = "$policy" ]
}

ensure_containers_stopped() {
  local container running
  for container in "$@"; do
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
    case "$running" in
      true)
        if ! docker stop --time 30 "$container" >/dev/null; then
          running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
          [ "$running" = false ] || return 1
        fi
        ;;
      false) ;;
      *) return 1 ;;
    esac
  done
  for container in "$@"; do
    docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx false || return 1
  done
}

ensure_containers_running() {
  local container running
  for container in "$@"; do
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
    case "$running" in
      true) ;;
      false)
        if ! docker start "$container" >/dev/null; then
          running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
          [ "$running" = true ] || return 1
        fi
        ;;
      *) return 1 ;;
    esac
  done
  for container in "$@"; do
    docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx true || return 1
  done
}

retire_container_restart() {
  local container=$1
  set_container_restart_policy "$container" no || return 1
  ensure_containers_stopped "$container" || return 1
  [ "$(container_restart_policy "$container")" = no ] \
    && docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null | grep -qx false
}

validate_release_request_ledger() {
  [ -f "$RELEASE_REQUEST_LEDGER" ] && [ ! -L "$RELEASE_REQUEST_LEDGER" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RELEASE_REQUEST_LEDGER")" = '0:0:600:1' ] \
    || return 1
  jq -e \
    --arg requestId "$KELION_RELEASE_REQUEST_ID" \
    --arg commit "$COMMIT_SHA" \
    --arg mode "$RELEASE_MODE" \
    --argjson ciRunId "$KELION_CI_RUN_ID" \
    --argjson buildRunId "$KELION_BUILD_RUN_ID" '
      .schema == 1 and
      (.status == "started" or .status == "retryable" or .status == "success") and
      .requestId == $requestId and .commit == $commit and .mode == $mode and
      .ciRunId == $ciRunId and .buildRunId == $buildRunId and
      (.workflowRunId | type == "number") and .workflowRunId >= 1 and (.workflowRunId | floor) == .workflowRunId and
      (.startedAt | strings | length > 0) and
      (((.status == "started" or .status == "retryable") and .completedAt == null) or
       (.status == "success" and (.completedAt | strings | length > 0)))
    ' "$RELEASE_REQUEST_LEDGER" >/dev/null
}

prepare_release_request_ledger_root() {
  [ -d "$RELEASE_STATE_ROOT" ] && [ ! -L "$RELEASE_STATE_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$RELEASE_STATE_ROOT")" = '0:10050:750' ] || return 1
  if [ -e "$RELEASE_REQUEST_LEDGER_ROOT" ] || [ -L "$RELEASE_REQUEST_LEDGER_ROOT" ]; then
    [ -d "$RELEASE_REQUEST_LEDGER_ROOT" ] && [ ! -L "$RELEASE_REQUEST_LEDGER_ROOT" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$RELEASE_REQUEST_LEDGER_ROOT")" = '0:0:700' ] || return 1
  else
    install -d -o root -g root -m 0700 "$RELEASE_REQUEST_LEDGER_ROOT" || return 1
    fsync_release_artifact "$RELEASE_STATE_ROOT" directory || return 1
  fi
}

write_release_request_ledger() {
  local status=$1 temporary started_at
  [[ "$status" = started || "$status" = retryable || "$status" = success ]] || return 1
  prepare_release_request_ledger_root || return 1
  if [ -e "$RELEASE_REQUEST_LEDGER" ] || [ -L "$RELEASE_REQUEST_LEDGER" ]; then
    validate_release_request_ledger || return 1
    started_at=$(jq -er '.startedAt' "$RELEASE_REQUEST_LEDGER") || return 1
  else
    [ "$status" = started ] || return 1
    started_at=$(date -u +%Y-%m-%dT%H:%M:%SZ) || return 1
  fi
  temporary=$(mktemp "$RELEASE_REQUEST_LEDGER_ROOT/.${KELION_RELEASE_REQUEST_ID}.XXXXXX") || return 1
  if jq -n \
      --arg status "$status" --arg requestId "$KELION_RELEASE_REQUEST_ID" \
      --arg commit "$COMMIT_SHA" --arg mode "$RELEASE_MODE" --arg startedAt "$started_at" \
      --argjson ciRunId "$KELION_CI_RUN_ID" --argjson buildRunId "$KELION_BUILD_RUN_ID" \
      --argjson workflowRunId "$KELION_RELEASE_WORKFLOW_RUN_ID" \
      '{schema:1,status:$status,requestId:$requestId,commit:$commit,mode:$mode,
        ciRunId:$ciRunId,buildRunId:$buildRunId,workflowRunId:$workflowRunId,
        startedAt:$startedAt,completedAt:(if $status == "success" then (now|todateiso8601) else null end)}' > "$temporary" \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_release_artifact "$temporary" file \
    && mv -f -- "$temporary" "$RELEASE_REQUEST_LEDGER" \
    && fsync_release_artifact "$RELEASE_REQUEST_LEDGER_ROOT" directory; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

release_request_live_proof() {
  local allow_deploy_quiesce=${1:-0} origin live_version live_ready
  [[ "$allow_deploy_quiesce" =~ ^[01]$ ]] || return 1
  for path in "$RUNTIME_ROOT/runtime-config-cutover.journal" \
    "$RUNTIME_ROOT/constructor-activation.journal" "$RUNTIME_ROOT/constructor-gate-refresh.journal"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] || return 1
  done
  if [ "$resume_destructive_recovery" != 1 ] && [ "${recover_pre_ponr_destructive:-0}" != 1 ]; then
    [ ! -e "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] || return 1
  fi
  if [ "$allow_deploy_quiesce" = 0 ]; then
    [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || return 1
  fi
  [ -f "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ] \
    && [ "$(stat -c '%u:%g:%a' "$RELEASE_STATE_ROOT/active")" = '0:10050:640' ] \
    && [ "$(wc -l < "$RELEASE_STATE_ROOT/active")" -eq 1 ] \
    && grep -qx "$COMMIT_SHA" "$RELEASE_STATE_ROOT/active" || return 1
  origin=$(jq -er '.publicAppOrigin | select(type == "string")' "$PRODUCT_FILE") || return 1
  live_version=$(curl --fail --silent --show-error --max-time 12 "$origin/api/version" | jq -r '.v // empty') || return 1
  live_ready=$(curl --fail --silent --show-error --max-time 12 "$origin/readyz") || return 1
  [ "$live_version" = "${COMMIT_SHA:0:7}" ] \
    && jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$live_ready" >/dev/null
}

candidate_public_live_proof() {
  local origin live_version live_ready path
  for path in "$RUNTIME_ROOT/runtime-config-cutover.journal" \
    "$RUNTIME_ROOT/constructor-activation.journal" "$RUNTIME_ROOT/constructor-gate-refresh.journal"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] || return 1
  done
  if [ "$resume_destructive_recovery" != 1 ] && [ "${recover_pre_ponr_destructive:-0}" != 1 ]; then
    [ ! -e "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] || return 1
  fi
  origin=$(jq -er '.publicAppOrigin | select(type == "string")' "$PRODUCT_FILE") || return 1
  live_version=$(curl --fail --silent --show-error --max-time 12 "$origin/api/version" | jq -r '.v // empty') || return 1
  live_ready=$(curl --fail --silent --show-error --max-time 12 "$origin/readyz") || return 1
  [ "$live_version" = "${COMMIT_SHA:0:7}" ] \
    && jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$live_ready" >/dev/null
}

prepared_candidate_public_live_proof() {
  local origin live_version live_ready path
  for path in "$RUNTIME_ROOT/runtime-config-cutover.journal" \
    "$RUNTIME_ROOT/constructor-activation.journal" "$RUNTIME_ROOT/constructor-gate-refresh.journal"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] || return 1
  done
  if [ "$resume_destructive_recovery" != 1 ] && [ "${recover_pre_ponr_destructive:-0}" != 1 ]; then
    [ ! -e "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] || return 1
  fi
  origin=$(jq -er '.publicAppOrigin | select(type == "string")' "$PRODUCT_FILE") || return 1
  live_version=$(curl --fail --silent --show-error --max-time 12 "$origin/api/version" | jq -r '.v // empty') || return 1
  live_ready=$(curl --fail --silent --show-error --max-time 12 "$origin/readyz") || return 1
  [ "$live_version" = "${COMMIT_SHA:0:7}" ] \
    && jq -e '.ready == true and .release.candidate == true and .release.sideEffectsActive == false' \
      <<<"$live_ready" >/dev/null
}

active_release_live_proof() {
  local allow_deploy_quiesce=${1:-0} active_commit origin live_version live_ready expected_legacy_version
  [[ "$allow_deploy_quiesce" =~ ^[01]$ ]] || return 1
  for path in "$RUNTIME_ROOT/runtime-config-cutover.journal" \
    "$RUNTIME_ROOT/constructor-activation.journal" "$RUNTIME_ROOT/constructor-gate-refresh.journal"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] || return 1
  done
  if [ "$resume_destructive_recovery" != 1 ] && [ "${recover_pre_ponr_destructive:-0}" != 1 ]; then
    [ ! -e "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] || return 1
  fi
  if [ "$allow_deploy_quiesce" = 0 ]; then
    [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || return 1
  fi
  [ -f "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ] \
    && [ "$(stat -c '%u:%g:%a' "$RELEASE_STATE_ROOT/active")" = '0:10050:640' ] \
    && [ "$(wc -l < "$RELEASE_STATE_ROOT/active")" -eq 1 ] || return 1
  active_commit=$(sed -n '1p' "$RELEASE_STATE_ROOT/active")
  [[ "$active_commit" =~ ^([0-9a-f]{40}|legacy)$ ]] || return 1
  origin=$(jq -er '.publicAppOrigin | select(type == "string")' "$PRODUCT_FILE") || return 1
  live_version=$(curl --fail --silent --show-error --max-time 12 "$origin/api/version" | jq -r '.v // empty') || return 1
  live_ready=$(curl --fail --silent --show-error --max-time 12 "$origin/readyz") || return 1
  if [ "$active_commit" = legacy ]; then
    expected_legacy_version=$(jq -er --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
      select(.schema == 2 and .requestId == $requestId and .commit == $commit and .activeBefore == "legacy") |
      .activeVersionBefore | select(type == "string" and test("^[0-9a-f]{7,40}$"))
    ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" 2>/dev/null) || return 1
    [ "$live_version" = "$expected_legacy_version" ] \
      && jq -e '.ready == true and ((.release.candidate // false) == false) and
        ((.release.sideEffectsActive // true) == true)' <<<"$live_ready" >/dev/null
  else
    [ "$live_version" = "${active_commit:0:7}" ] \
      && jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$live_ready" >/dev/null
  fi
}

# Receiptul pre-PONR este consumat numai după ce vechea generație, DB-ul,
# proxy-ul și ledgerul retryable sunt toate dovedite, iar jurnalul quiesce a
# fost închis. Acoperă inclusiv crash-ul dintre ștergerea quiesce și cleanup.
finalize_rolled_back_recovery_journal() {
  local active_slot_from_journal inactive_slot_from_journal old_marker_from_journal
  local previous_version_from_journal expected_contract restored_plan restored_contract
  local origin live_version live_ready old_upstream_from_journal candidate_running
  [ -e "$RECOVERY_JOURNAL" ] || [ -L "$RECOVERY_JOURNAL" ] || return 0
  [ "$release_request_state" = retryable ] || return 1
  validate_release_request_ledger || return 1
  jq -e '.status == "retryable"' "$RELEASE_REQUEST_LEDGER" >/dev/null || return 1
  [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || return 1
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] || return 1
  jq -e --arg commit "$COMMIT_SHA" '
    .schema == 1 and .commit == $commit and .phase == "rolled-back" and
    .pointOfNoReturn == false and .dbRestoreRequired == false and
    (.activeSlot == "legacy" or .activeSlot == "blue" or .activeSlot == "green") and
    (.inactiveSlot == "blue" or .inactiveSlot == "green") and
    (.oldMarker | strings | test("^([0-9a-f]{40}|legacy)$")) and
    (.previousVersion | strings | test("^[0-9a-f]{7,40}$")) and
    (.migrationContractBefore | strings | length > 0)
  ' "$RECOVERY_JOURNAL" >/dev/null || return 1
  active_slot_from_journal=$(jq -er '.activeSlot' "$RECOVERY_JOURNAL") || return 1
  inactive_slot_from_journal=$(jq -er '.inactiveSlot' "$RECOVERY_JOURNAL") || return 1
  old_marker_from_journal=$(jq -er '.oldMarker' "$RECOVERY_JOURNAL") || return 1
  previous_version_from_journal=$(jq -er '.previousVersion' "$RECOVERY_JOURNAL") || return 1
  expected_contract=$(jq -er '.migrationContractBefore' "$RECOVERY_JOURNAL") || return 1
  [ -f "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ] \
    && [ "$(stat -c '%u:%g:%a' "$RELEASE_STATE_ROOT/active")" = '0:10050:640' ] \
    && [ "$(sed -n '1p' "$RELEASE_STATE_ROOT/active")" = "$old_marker_from_journal" ] || return 1
  candidate_running=$(docker ps -q --filter 'label=com.kelion.managed=true' \
    --filter "label=com.kelion.slot=$inactive_slot_from_journal") || return 1
  [ -z "$candidate_running" ] || return 1
  case "$active_slot_from_journal" in
    legacy)
      [ "$old_marker_from_journal" = legacy ] || return 1
      docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true || return 1
      if docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true; then return 1; fi
      ;;
    blue|green)
      [[ "$old_marker_from_journal" =~ ^[0-9a-f]{40}$ ]] || return 1
      [ "$inactive_slot_from_journal" != "$active_slot_from_journal" ] || return 1
      old_upstream_from_journal=$(jq -er '.oldUpstream | select(type == "string" and length > 0)' "$RECOVERY_JOURNAL") || return 1
      [ -f "$UPSTREAM_FILE" ] && [ ! -L "$UPSTREAM_FILE" ] \
        && [ "$(cat "$UPSTREAM_FILE")" = "$old_upstream_from_journal" ] \
        && grep -q "app-$active_slot_from_journal:8080" "$UPSTREAM_FILE" || return 1
      docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true || return 1
      if docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true; then return 1; fi
      ;;
    *) return 1 ;;
  esac
  origin=$(jq -er '.publicAppOrigin | select(type == "string")' "$PRODUCT_FILE") || return 1
  live_version=$(curl --fail --silent --show-error --max-time 12 "$origin/api/version" | jq -r '.v // empty') || return 1
  live_ready=$(curl --fail --silent --show-error --max-time 12 "$origin/readyz") || return 1
  [ "$live_version" = "$previous_version_from_journal" ] \
    && jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$live_ready" >/dev/null || return 1
  restored_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan) || return 1
  restored_contract=$(jq -cS '{kind,risk,pending}' <<<"$restored_plan") || return 1
  [ "$restored_contract" = "$expected_contract" ] || return 1
  rm -f -- "$RECOVERY_JOURNAL" || return 1
  fsync_release_artifact "$RUNTIME_ROOT" directory
}

mark_existing_recovery_journal_rolled_back() {
  local temporary
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] || return 1
  temporary=$(mktemp "$RUNTIME_ROOT/destructive-cutover-recovery.XXXXXX") || return 1
  if jq --arg commit "$COMMIT_SHA" '
      select(.schema == 1 and .commit == $commit and .pointOfNoReturn == false) |
      .phase="rolled-back" | .dbRestoreRequired=false | .updatedAt=(now|todateiso8601)
    ' "$RECOVERY_JOURNAL" > "$temporary" \
    && [ -s "$temporary" ] \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_release_artifact "$temporary" file \
    && mv -f -- "$temporary" "$RECOVERY_JOURNAL" \
    && fsync_release_artifact "$RUNTIME_ROOT" directory; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

release_request_completion_record_matches() {
  [ -f "$RUNTIME_ROOT/last-release.json" ] && [ ! -L "$RUNTIME_ROOT/last-release.json" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RUNTIME_ROOT/last-release.json")" = '0:0:600:1' ] \
    || return 1
  jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" --arg mode "$RELEASE_MODE" \
    --argjson ciRunId "$KELION_CI_RUN_ID" --argjson buildRunId "$KELION_BUILD_RUN_ID" '
      .schema == 1 and .requestId == $requestId and .commit == $commit and .mode == $mode and
      .ciRunId == $ciRunId and .buildRunId == $buildRunId and (.completedAt | strings | length > 0)
    ' "$RUNTIME_ROOT/last-release.json" >/dev/null
}

write_release_completion_record() {
  local slot=$1 record
  [[ "$slot" =~ ^(blue|green)$ ]] || return 1
  record=$(mktemp "$RUNTIME_ROOT/release.XXXXXX") || return 1
  if jq -n --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" --arg slot "$slot" --arg mode "$RELEASE_MODE" \
      --argjson ciRunId "$KELION_CI_RUN_ID" --argjson buildRunId "$KELION_BUILD_RUN_ID" \
      --argjson workflowRunId "$KELION_RELEASE_WORKFLOW_RUN_ID" \
      '{schema:1,requestId:$requestId,commit:$commit,slot:$slot,mode:$mode,ciRunId:$ciRunId,
        buildRunId:$buildRunId,workflowRunId:$workflowRunId,completedAt:(now|todateiso8601)}' > "$record" \
    && chown root:root "$record" && chmod 0600 "$record" \
    && fsync_release_artifact "$record" file \
    && mv -f -- "$record" "$RUNTIME_ROOT/last-release.json" \
    && fsync_release_artifact "$RUNTIME_ROOT" directory; then
    return 0
  fi
  rm -f -- "$record"
  return 1
}

write_constructor_deploy_quiesce_journal() {
  local phase=$1 temporary active_before active_version_before worker_sha publisher_sha release_sha path sha legacy_runtime_json='[]'
  local legacy_policy_json='{}' container policy managed_json=false legacy_proxy_json=false
  local -a gate_paths=(
    "$ROOT/config/codex-worker.env"
    "$ROOT/config/constructor-publisher.env"
    "$ROOT/config/constructor-release.env"
  )
  local -a gate_hashes=()
  [[ "$phase" = armed || "$phase" = quiesced || "$phase" = active-prepared || "$phase" = active-published || "$phase" = gate-committed ]] || return 1
  if [ "$phase" = armed ]; then
    [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || return 1
    [ -f "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$RELEASE_STATE_ROOT/active")" = '0:10050:640:1' ] \
      && [ "$(wc -l < "$RELEASE_STATE_ROOT/active")" -eq 1 ] || return 1
    active_before=$(sed -n '1p' "$RELEASE_STATE_ROOT/active")
    [[ "$active_before" =~ ^([0-9a-f]{40}|legacy)$ ]] || return 1
    active_version_before=${previous_version_before:-}
    [[ "$active_version_before" =~ ^[0-9a-f]{7,40}$ ]] || return 1
    if [ "$active_before" != legacy ]; then
      [ "${active_before:0:${#active_version_before}}" = "$active_version_before" ] || return 1
    fi
    for path in "${gate_paths[@]}"; do
      if [ -e "$path" ] || [ -L "$path" ]; then
        [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$path")" = '0:0:640:1' ] || return 1
        sha=$(sha256sum "$path" | awk '{print $1}')
        [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || return 1
        gate_hashes+=("$sha")
      else
        gate_hashes+=(absent)
      fi
    done
    if [ "${gate_hashes[0]}" = absent ]; then
      [ "${gate_hashes[1]}" = absent ] && [ "${gate_hashes[2]}" = absent ] || return 1
    else
      [ "${gate_hashes[1]}" != absent ] && [ "${gate_hashes[2]}" != absent ] || return 1
    fi
    case "$active_before" in
      legacy)
        [ "${#legacy_runtime_running[@]}" -gt 0 ] \
          && [[ " ${legacy_runtime_running[*]} " == *' kelionai-app '* ]] || return 1
        legacy_runtime_json=$(printf '%s\n' "${legacy_runtime_running[@]}" \
          | jq -Rsc 'split("\n")[:-1]') || return 1
        jq -e '
          type == "array" and length >= 1 and length <= 3 and
          length == (unique | length) and
          all(.[]; . == "kelionai-app" or . == "omniroute" or . == "kelionai-coqui") and
          index("kelionai-app") != null
        ' <<<"$legacy_runtime_json" >/dev/null || return 1
        for container in "${legacy_runtime_running[@]}"; do
          policy=${legacy_restart_policies[$container]:-}
          [[ "$policy" =~ ^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$ ]] || return 1
          legacy_policy_json=$(jq -c --arg container "$container" --arg policy "$policy" \
            '. + {($container):$policy}' <<<"$legacy_policy_json") || return 1
        done
        [[ "$legacy_proxy_restart_policy" =~ ^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$ ]] \
          || return 1
        ;;
      *)
        [ "${#legacy_runtime_running[@]}" -eq 0 ] || return 1
        [ "${#legacy_restart_policies[@]}" -eq 0 ] || return 1
        ;;
    esac
    [[ "$active_slot" =~ ^(legacy|blue|green)$ ]] && [[ "$inactive_slot" =~ ^(blue|green)$ ]] \
      && [ "$active_slot" != "$inactive_slot" ] || return 1
    case "$active_slot:$inactive_slot:$managed_proxy_running:$legacy_proxy_running" in
      legacy:blue:0:1|blue:green:1:0|green:blue:1:0) ;;
      *) return 1 ;;
    esac
    [ "$previous_caddyfile_present" = 0 ] || [ "$previous_caddyfile_present" = 1 ] || return 1
    [ "$old_upstream_present" = 0 ] || [ "$old_upstream_present" = 1 ] || return 1
    if [ "$previous_caddyfile_present" = 1 ]; then
      [[ "$previous_caddyfile_snapshot" =~ ^/root/kelion/runtime/caddyfile-rollback\.[A-Za-z0-9]+$ ]] \
        && [ -f "$previous_caddyfile_snapshot" ] && [ ! -L "$previous_caddyfile_snapshot" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$previous_caddyfile_snapshot")" = '0:0:600:1' ] \
        && [ "$(sha256sum "$previous_caddyfile_snapshot" | awk '{print $1}')" = "$previous_caddyfile_sha256" ] \
        || return 1
    else
      [ -z "$previous_caddyfile_snapshot" ] && [ "$previous_caddyfile_sha256" = absent ] || return 1
    fi
    if [ "$old_upstream_present" = 1 ]; then
      [[ "$previous_upstream_snapshot" =~ ^/root/kelion/runtime/upstream-rollback\.[A-Za-z0-9]+$ ]] \
        && [ -f "$previous_upstream_snapshot" ] && [ ! -L "$previous_upstream_snapshot" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$previous_upstream_snapshot")" = '0:0:600:1' ] \
        && [ "$(sha256sum "$previous_upstream_snapshot" | awk '{print $1}')" = "$previous_upstream_sha256" ] \
        || return 1
    else
      [ -z "$previous_upstream_snapshot" ] && [ "$previous_upstream_sha256" = absent ] || return 1
    fi
    [[ "$target_caddyfile_sha256" =~ ^[0-9a-f]{64}$ ]] \
      && [[ "$target_upstream_sha256" =~ ^[0-9a-f]{64}$ ]] || return 1
    [ "$managed_proxy_running" = 0 ] || managed_json=true
    [ "$legacy_proxy_running" = 0 ] || legacy_proxy_json=true
  else
    [ -f "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL")" = '0:0:600:1' ] || return 1
  fi
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-deploy-quiesce.XXXXXX") || return 1
  if {
      if [ "$phase" = armed ]; then
        worker_sha=${gate_hashes[0]}; publisher_sha=${gate_hashes[1]}; release_sha=${gate_hashes[2]}
        jq -n --arg phase "$phase" --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" \
          --arg activeBefore "$active_before" --arg activeVersionBefore "$active_version_before" \
          --arg worker "$worker_sha" --arg publisher "$publisher_sha" --arg release "$release_sha" \
          --arg activeSlotBefore "$active_slot" --arg targetSlot "$inactive_slot" \
          --arg caddyfileSnapshot "$previous_caddyfile_snapshot" --arg caddyfileSha256 "$previous_caddyfile_sha256" \
          --arg upstreamSnapshot "$previous_upstream_snapshot" --arg upstreamSha256 "$previous_upstream_sha256" \
          --arg targetCaddyfileSha256 "$target_caddyfile_sha256" --arg targetUpstreamSha256 "$target_upstream_sha256" \
          --arg legacyProxyRestartPolicy "$legacy_proxy_restart_policy" \
          --argjson legacyContainers "$legacy_runtime_json" --argjson legacyRestartPolicies "$legacy_policy_json" \
          --argjson managedProxyWasRunning "$managed_json" --argjson legacyProxyWasRunning "$legacy_proxy_json" \
          --argjson caddyfilePresent "$previous_caddyfile_present" --argjson oldUpstreamPresent "$old_upstream_present" \
          '{schema:2,phase:$phase,requestId:$requestId,commit:$commit,activeBefore:$activeBefore,
            activeVersionBefore:$activeVersionBefore,
            legacyContainers:$legacyContainers,
            legacyRestartPolicies:$legacyRestartPolicies,
            proxyIntent:{activeSlotBefore:$activeSlotBefore,targetSlot:$targetSlot,
              managedProxyWasRunning:$managedProxyWasRunning,legacyProxyWasRunning:$legacyProxyWasRunning,
              legacyProxyRestartPolicy:(if $legacyProxyRestartPolicy == "" then null else $legacyProxyRestartPolicy end),
              caddyfilePresent:($caddyfilePresent == 1),caddyfileSnapshot:$caddyfileSnapshot,
              caddyfileSha256:$caddyfileSha256,oldUpstreamPresent:($oldUpstreamPresent == 1),
              oldUpstreamSnapshot:$upstreamSnapshot,oldUpstreamSha256:$upstreamSha256,
              targetCaddyfileSha256:$targetCaddyfileSha256,targetUpstreamSha256:$targetUpstreamSha256},
            gateSha256:{worker:$worker,publisher:$publisher,release:$release}}'
      elif [ "$phase" = gate-committed ]; then
        if [ ! -e "${gate_paths[0]}" ] && [ ! -L "${gate_paths[0]}" ] \
          && [ ! -e "${gate_paths[1]}" ] && [ ! -L "${gate_paths[1]}" ] \
          && [ ! -e "${gate_paths[2]}" ] && [ ! -L "${gate_paths[2]}" ]; then
          jq -e --arg phase "$phase" --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
            select(.schema == 2 and .requestId == $requestId and .commit == $commit and
              (.phase == "active-published" or
                (.phase == "gate-prepared" and .targetGateSha256 == {worker:"absent",publisher:"absent",release:"absent"}))) |
            .phase = $phase |
            .targetGateSha256 = {worker:"absent",publisher:"absent",release:"absent"} |
            .committedGateSha256 = .targetGateSha256
          ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL"
        else
          for path in "${gate_paths[@]}"; do
            [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$path")" = '0:0:640:1' ] || return 1
            sha=$(sha256sum "$path" | awk '{print $1}')
            [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || return 1
            gate_hashes+=("$sha")
          done
          worker_sha=${gate_hashes[0]}
          publisher_sha=${gate_hashes[1]}
          release_sha=${gate_hashes[2]}
          jq -e --arg phase "$phase" --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" \
            --arg worker "$worker_sha" --arg publisher "$publisher_sha" --arg release "$release_sha" '
            select(.schema == 2 and .requestId == $requestId and .commit == $commit and .phase == "gate-prepared" and
              .targetGateSha256 == {worker:$worker,publisher:$publisher,release:$release}) |
            .phase = $phase | .committedGateSha256 = {worker:$worker,publisher:$publisher,release:$release}
          ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL"
        fi
      else
        jq -e --arg phase "$phase" --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
          select(.schema == 2 and .requestId == $requestId and .commit == $commit and
            (($phase == "quiesced" and .phase == "armed") or
             ($phase == "active-prepared" and (.phase == "quiesced" or .phase == "active-prepared")) or
             ($phase == "active-published" and (.phase == "active-prepared" or .phase == "active-published")))) |
          .phase = $phase
        ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL"
      fi
    } > "$temporary" \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_release_artifact "$temporary" file \
    && mv -f -- "$temporary" "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" \
    && fsync_release_artifact "$RUNTIME_ROOT" directory; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

write_constructor_deploy_gate_prepared_journal() {
  local worker_source=$1 publisher_source=$2 release_source=$3 temporary source sha
  local -a sources=("$worker_source" "$publisher_source" "$release_source") hashes=()
  [ -f "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL")" = '0:0:600:1' ] || return 1
  for source in "${sources[@]}"; do
    [ -f "$source" ] && [ ! -L "$source" ] || return 1
    sha=$(sha256sum "$source" | awk '{print $1}') || return 1
    [[ "$sha" =~ ^[0-9a-f]{64}$ ]] || return 1
    hashes+=("$sha")
  done
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-deploy-quiesce.XXXXXX") || return 1
  if jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" \
      --arg worker "${hashes[0]}" --arg publisher "${hashes[1]}" --arg release "${hashes[2]}" '
      select(.schema == 2 and .requestId == $requestId and .commit == $commit and
        (.phase == "active-published" or
          (.phase == "gate-prepared" and .targetGateSha256 == {worker:$worker,publisher:$publisher,release:$release}))) |
      .phase = "gate-prepared" | .targetGateSha256 = {worker:$worker,publisher:$publisher,release:$release}
    ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" > "$temporary" \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_release_artifact "$temporary" file \
    && mv -f -- "$temporary" "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" \
    && fsync_release_artifact "$RUNTIME_ROOT" directory; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

publish_candidate_active_marker() {
  local temporary_active
  write_constructor_deploy_quiesce_journal active-prepared || return 1
  temporary_active=$(mktemp "$RELEASE_STATE_ROOT/active.XXXXXX") || return 1
  if printf '%s\n' "$COMMIT_SHA" > "$temporary_active" \
    && chown root:10050 "$temporary_active" && chmod 0640 "$temporary_active" \
    && fsync_release_artifact "$temporary_active" file \
    && mv -f -- "$temporary_active" "$RELEASE_STATE_ROOT/active" \
    && fsync_release_artifact "$RELEASE_STATE_ROOT" directory \
    && write_constructor_deploy_quiesce_journal active-published; then
    return 0
  fi
  rm -f -- "$temporary_active"
  return 1
}

install_recovery_artifact() {
  local source=$1 target=$2 owner=$3 group=$4 mode=$5 temporary
  [ -f "$source" ] && [ ! -L "$source" ] || return 1
  if [ -e "$target" ] || [ -L "$target" ]; then [ -f "$target" ] && [ ! -L "$target" ] || return 1; fi
  temporary=$(mktemp "$target.install.XXXXXX") || return 1
  if install -o "$owner" -g "$group" -m "$mode" "$source" "$temporary" \
    && fsync_release_artifact "$temporary" file \
    && mv -f -- "$temporary" "$target" \
    && fsync_release_artifact "$(dirname -- "$target")" directory; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

# Starea schedulerului este capturată chiar înainte de cutover. Orice eroare
# ulterioară smoke-ului public trebuie să poată restaura atomic selectorul,
# unitățile, starea timerului și crontabul, nu doar traficul aplicației.
backup_schedule_snapshot_dir=''
backup_schedule_mutating=0
backup_schedule_timer_touched=0
backup_previous_current_present=0
backup_previous_service_present=0
backup_previous_timer_present=0
backup_previous_marker_present=0
backup_previous_timer_enabled=0
backup_previous_timer_active=0

for file in "$PRODUCT_FILE" "$COMPOSE_FILE" "$PROXY_COMPOSE_FILE" "$BUNDLE_DIR/Caddyfile" \
  "$BUNDLE_DIR/backup.sh" "$BUNDLE_DIR/restore-verified-backup.sh" \
  "$BUNDLE_DIR/vps-curatenie.sh" \
  "$BUNDLE_DIR/lib/restore-verified-backup.mjs" \
  "$BUNDLE_DIR/systemd/$BACKUP_SERVICE" "$BUNDLE_DIR/systemd/$BACKUP_TIMER" \
  "$BUNDLE_DIR/systemd/kelion-constructor-sync.service" \
  "$BUNDLE_DIR/systemd/kelion-codex-worker.timer" \
  "$BUNDLE_DIR/systemd/kelion-constructor-publisher.timer" \
  "$BUNDLE_DIR/systemd/kelion-constructor-release.timer" \
  "$BUNDLE_DIR/systemd/kelion-codex-worker.service" \
  "$BUNDLE_DIR/systemd/kelion-constructor-publisher.service" \
  "$BUNDLE_DIR/systemd/kelion-constructor-release.service"; do
  [ -f "$file" ] || die "bundle incomplet: $(basename "$file")"
done

install_cleanup_script() {
  local candidate
  candidate=$(mktemp "$ROOT/vps-curatenie.XXXXXX")
  if ! install -o root -g root -m 0700 "$BUNDLE_DIR/vps-curatenie.sh" "$candidate" \
    || ! cmp -s -- "$BUNDLE_DIR/vps-curatenie.sh" "$candidate" \
    || [ "$(stat -Lc '%u:%g:%a:%h' "$candidate")" != '0:0:700:1' ] \
    || ! fsync_release_artifact "$candidate" file; then
    rm -f -- "$candidate"
    die 'scriptul de curățenie nu poate fi pregătit exact'
  fi
  mv -f -- "$candidate" "$ROOT/vps-curatenie.sh"
  fsync_release_artifact "$ROOT" directory \
    || die 'scriptul de curățenie nu a putut fi sincronizat durabil'
  [ -f "$ROOT/vps-curatenie.sh" ] && [ ! -L "$ROOT/vps-curatenie.sh" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ROOT/vps-curatenie.sh")" = '0:0:700:1' ] \
    && cmp -s -- "$BUNDLE_DIR/vps-curatenie.sh" "$ROOT/vps-curatenie.sh" \
    || die 'scriptul de curățenie instalat diferă de bundle'
}

install_persistent_backup_script() {
  local candidate
  install -d -o root -g root -m 0755 \
    "$BACKUP_INSTALL_ROOT" "$BACKUP_RELEASE_ROOT" "$BACKUP_RELEASE_ROOT/$COMMIT_SHA"
  fsync_release_artifact /opt directory
  fsync_release_artifact "$BACKUP_INSTALL_ROOT" directory
  fsync_release_artifact "$BACKUP_RELEASE_ROOT" directory
  candidate=$(mktemp "$BACKUP_RELEASE_ROOT/$COMMIT_SHA/backup.XXXXXX")
  install -o root -g root -m 0700 "$BUNDLE_DIR/backup.sh" "$candidate"
  fsync_release_artifact "$candidate" file
  mv -f -- "$candidate" "$PERSISTENT_BACKUP_SCRIPT"
  fsync_release_artifact "$BACKUP_RELEASE_ROOT/$COMMIT_SHA" directory
  [ "$(stat -c '%u:%g:%a' "$PERSISTENT_BACKUP_SCRIPT")" = '0:0:700' ] \
    || die 'scriptul persistent de backup are ACL invalid'
  cmp -s "$BUNDLE_DIR/backup.sh" "$PERSISTENT_BACKUP_SCRIPT" \
    || die 'scriptul persistent de backup diferă de bundle'
}

activate_persistent_backup_script() {
  local candidate_link
  [ -x "$PERSISTENT_BACKUP_SCRIPT" ] \
    || die 'candidatul persistent de backup nu este executabil'
  candidate_link=$(mktemp "$BACKUP_INSTALL_ROOT/current.XXXXXX")
  rm -f -- "$candidate_link"
  ln -s "releases/$COMMIT_SHA" "$candidate_link"
  mv -Tf -- "$candidate_link" "$BACKUP_CURRENT_LINK"
  fsync_release_artifact "$BACKUP_INSTALL_ROOT" directory
  [ "$(readlink "$BACKUP_CURRENT_LINK")" = "releases/$COMMIT_SHA" ] \
    || die 'selectorul current al backupului nu confirmă commitul candidat'
}

install_backup_schedule() {
  local unit candidate next_run
  systemd-analyze verify \
    "$BUNDLE_DIR/systemd/$BACKUP_SERVICE" \
    "$BUNDLE_DIR/systemd/$BACKUP_TIMER" >/dev/null
  for unit in "$BACKUP_SERVICE" "$BACKUP_TIMER"; do
    candidate=$(mktemp "$SYSTEMD_UNIT_ROOT/$unit.XXXXXX")
    install -o root -g root -m 0444 "$BUNDLE_DIR/systemd/$unit" "$candidate"
    fsync_release_artifact "$candidate" file
    mv -f -- "$candidate" "$SYSTEMD_UNIT_ROOT/$unit"
    cmp -s "$BUNDLE_DIR/systemd/$unit" "$SYSTEMD_UNIT_ROOT/$unit" \
      || die "unitatea persistentă $unit diferă de bundle"
  done
  fsync_release_artifact "$SYSTEMD_UNIT_ROOT" directory
  systemctl daemon-reload
  validate_effective_backup_schedule \
    || die 'unitățile efective ale backupului au fragment/drop-in/proprietăți necanonice'
  backup_schedule_timer_touched=1
  systemctl enable --now "$BACKUP_TIMER" >/dev/null
  [ -L "$SYSTEMD_UNIT_ROOT/timers.target.wants/$BACKUP_TIMER" ] \
    && [ "$(readlink "$SYSTEMD_UNIT_ROOT/timers.target.wants/$BACKUP_TIMER")" = "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] \
    || die 'enable-ul timerului persistent nu a creat linkul systemd canonic'
  fsync_release_artifact "$SYSTEMD_UNIT_ROOT/timers.target.wants" directory
  fsync_release_artifact "$SYSTEMD_UNIT_ROOT" directory
  systemctl is-enabled --quiet "$BACKUP_TIMER" \
    || die 'timerul persistent de backup nu este enabled'
  systemctl is-active --quiet "$BACKUP_TIMER" \
    || die 'timerul persistent de backup nu este activ'
  next_run=$(systemctl show "$BACKUP_TIMER" --property=NextElapseUSecRealtime --value)
  [ -n "$next_run" ] && [ "$next_run" != n/a ] \
    || die 'timerul persistent de backup nu are următoarea rulare programată'
}

validate_effective_backup_schedule() {
  local unit fragment dropins load_state need_reload exec_start calendar persistent
  for unit in "$BACKUP_SERVICE" "$BACKUP_TIMER"; do
    fragment=$(systemctl show "$unit" --property=FragmentPath --value) || return 1
    dropins=$(systemctl show "$unit" --property=DropInPaths --value) || return 1
    load_state=$(systemctl show "$unit" --property=LoadState --value) || return 1
    need_reload=$(systemctl show "$unit" --property=NeedDaemonReload --value) || return 1
    [ "$fragment" = "$SYSTEMD_UNIT_ROOT/$unit" ] \
      && [ -z "$dropins" ] && [ "$load_state" = loaded ] && [ "$need_reload" = no ] || return 1
  done
  exec_start=$(systemctl show "$BACKUP_SERVICE" --property=ExecStart --value) || return 1
  grep -Fq 'path=/opt/kelion-backup/current/backup.sh' <<<"$exec_start" \
    && grep -Fq 'argv[]=/opt/kelion-backup/current/backup.sh' <<<"$exec_start" || return 1
  calendar=$(systemctl show "$BACKUP_TIMER" --property=TimersCalendar --value) || return 1
  grep -Fq 'OnCalendar=*-*-* 03:17:00 UTC' <<<"$calendar" || return 1
  persistent=$(systemctl show "$BACKUP_TIMER" --property=Persistent --value) || return 1
  [ "$persistent" = yes ]
}

retire_legacy_backup_cron() (
  set -euo pipefail
  local work before after observed count marker_candidate backup_candidate backup_copy marker_state marker_backup marker_commit
  work=$(mktemp -d "$RUNTIME_ROOT/backup-cron-cutover.XXXXXX")
  backup_candidate=''
  cleanup_legacy_backup_cron_work() {
    if [ -n "$backup_candidate" ]; then
      case "$backup_candidate" in
        "$RUNTIME_ROOT"/root-crontab.before-backup-timer."$COMMIT_SHA".[A-Za-z0-9]*)
          rm -f -- "$backup_candidate"
          ;;
        *) return 1 ;;
      esac
    fi
    rm -rf -- "$work"
  }
  trap cleanup_legacy_backup_cron_work EXIT
  before=$work/before
  after=$work/after
  observed=$work/observed
  backup_copy=$RUNTIME_ROOT/root-crontab.before-backup-timer.$COMMIT_SHA

  validate_backup_copy() {
    local candidate=$1
    [ -f "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$candidate")" = '0:0:600:1' ] \
      && [ "$(awk -v target="$LEGACY_BACKUP_CRON" '$0 == target { count += 1 } END { print count + 0 }' "$candidate")" -eq 1 ]
  }
  write_retirement_marker() {
    local state=$1 backup_basename=$2
    [[ "$state" = prepared || "$state" = committed ]] || return 1
    [[ "$backup_basename" =~ ^root-crontab\.before-backup-timer\.[0-9a-f]{40}$ ]] || return 1
    marker_candidate=$(mktemp "$RUNTIME_ROOT/legacy-backup-cron-retired.XXXXXX") || return 1
    if jq -n --arg state "$state" --arg commit "$COMMIT_SHA" --arg backup "$backup_basename" \
        '{schema:2,state:$state,commit:$commit,backup:$backup}' > "$marker_candidate" \
      && chown root:root "$marker_candidate" && chmod 0600 "$marker_candidate" \
      && fsync_release_artifact "$marker_candidate" file \
      && mv -f -- "$marker_candidate" "$LEGACY_BACKUP_CRON_MARKER" \
      && fsync_release_artifact "$RUNTIME_ROOT" directory; then
      return 0
    fi
    rm -f -- "$marker_candidate"
    return 1
  }

  crontab -u root -l > "$before" 2>/dev/null \
    || die 'crontabul root legacy nu poate fi citit'
  count=$(awk -v target="$LEGACY_BACKUP_CRON" '$0 == target { count += 1 } END { print count + 0 }' "$before")
  if [ "$count" -eq 0 ]; then
    [ -f "$LEGACY_BACKUP_CRON_MARKER" ] && [ ! -L "$LEGACY_BACKUP_CRON_MARKER" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$LEGACY_BACKUP_CRON_MARKER")" = '0:0:600:1' ] \
      || die 'cronul legacy lipsește fără marker canonic de retragere'
    if jq -e '.schema == 2 and (.state == "prepared" or .state == "committed") and
        (.commit | strings | test("^[0-9a-f]{40}$")) and
        (.backup | strings | test("^root-crontab\\.before-backup-timer\\.[0-9a-f]{40}$"))' \
        "$LEGACY_BACKUP_CRON_MARKER" >/dev/null 2>&1; then
      marker_state=$(jq -er '.state' "$LEGACY_BACKUP_CRON_MARKER")
      marker_backup=$(jq -er '.backup' "$LEGACY_BACKUP_CRON_MARKER")
      marker_commit=$(jq -er '.commit' "$LEGACY_BACKUP_CRON_MARKER")
      validate_backup_copy "$RUNTIME_ROOT/$marker_backup" \
        || die 'backupul crontabului indicat de marker este invalid'
      awk -v target="$LEGACY_BACKUP_CRON" '$0 != target' "$RUNTIME_ROOT/$marker_backup" > "$after"
      crontab -u root -l > "$observed" 2>/dev/null \
        || die 'crontabul live nu poate fi citit la recovery-ul retragerii'
      cmp -s "$after" "$observed" \
        || die 'crontabul live diferă de backupul exact minus jobul legacy'
      systemctl is-enabled --quiet "$BACKUP_TIMER" && systemctl is-active --quiet "$BACKUP_TIMER" \
        || die 'cronul lipsește, dar timerul de backup nu este activ și enabled'
      if [ "$marker_state" = prepared ]; then
        [ "$marker_commit" = "$COMMIT_SHA" ] \
          || die 'markerul prepared al retragerii aparține altui commit'
      fi
      if [ "$marker_state" = prepared ] || [ "$marker_commit" != "$COMMIT_SHA" ]; then
        write_retirement_marker committed "$marker_backup" \
          || die 'markerul retragerii cronului nu a putut deveni committed'
      fi
      return 0
    fi
    grep -Eq '^schema=1 commit=[0-9a-f]{40} backup=root-crontab\.before-backup-timer\.[0-9a-f]{40}$' \
      "$LEGACY_BACKUP_CRON_MARKER" || die 'markerul legacy al retragerii cronului este invalid'
    marker_backup=$(sed -n 's/^.* backup=//p' "$LEGACY_BACKUP_CRON_MARKER")
    validate_backup_copy "$RUNTIME_ROOT/$marker_backup" \
      || die 'backupul markerului legacy al crontabului este invalid'
    awk -v target="$LEGACY_BACKUP_CRON" '$0 != target' "$RUNTIME_ROOT/$marker_backup" > "$after"
    crontab -u root -l > "$observed" 2>/dev/null \
      || die 'crontabul live nu poate fi citit la upgrade-ul markerului legacy'
    cmp -s "$after" "$observed" \
      || die 'crontabul live nu corespunde backupului markerului legacy'
    systemctl is-enabled --quiet "$BACKUP_TIMER" && systemctl is-active --quiet "$BACKUP_TIMER" \
      || die 'markerul legacy există, dar timerul de backup nu este sănătos'
    write_retirement_marker committed "$marker_backup" \
      || die 'markerul legacy al retragerii cronului nu a putut fi canonicalizat'
    return 0
  fi
  [ "$count" -eq 1 ] || die 'cronul legacy de backup nu apare exact o dată'

  awk -v target="$LEGACY_BACKUP_CRON" '$0 != target' "$before" > "$after"
  ! grep -Fqx -- "$LEGACY_BACKUP_CRON" "$after" \
    || die 'filtrarea cronului legacy nu a eliminat ținta exactă'
  backup_candidate=$(mktemp "$RUNTIME_ROOT/root-crontab.before-backup-timer.$COMMIT_SHA.XXXXXX")
  install -o root -g root -m 0600 "$before" "$backup_candidate"
  fsync_release_artifact "$backup_candidate" file
  mv -f -- "$backup_candidate" "$backup_copy"
  backup_candidate=''
  fsync_release_artifact "$RUNTIME_ROOT" directory
  validate_backup_copy "$backup_copy" || die 'backupul crontabului nu este exact după commit'
  write_retirement_marker prepared "$(basename "$backup_copy")" \
    || die 'markerul prepared al retragerii cronului nu a putut fi publicat'
  crontab -u root "$after"
  crontab -u root -l > "$observed" 2>/dev/null \
    || { crontab -u root "$before"; die 'crontabul root nu poate fi verificat după instalare'; }
  if ! cmp -s "$after" "$observed"; then
    crontab -u root "$before"
    die 'alte linii cron s-au schimbat; crontabul original a fost restaurat'
  fi

  write_retirement_marker committed "$(basename "$backup_copy")" \
    || die 'markerul committed al retragerii cronului nu a putut fi publicat'
)

backup_schedule_live_proof() {
  local next_run marker_backup backup_copy expected observed status=1
  [ -f "$PERSISTENT_BACKUP_SCRIPT" ] && [ ! -L "$PERSISTENT_BACKUP_SCRIPT" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$PERSISTENT_BACKUP_SCRIPT")" = '0:0:700:1' ] \
    && cmp -s -- "$BUNDLE_DIR/backup.sh" "$PERSISTENT_BACKUP_SCRIPT" || return 1
  [ -L "$BACKUP_CURRENT_LINK" ] && [ "$(readlink "$BACKUP_CURRENT_LINK")" = "releases/$COMMIT_SHA" ] \
    && [ "$(realpath -e -- "$BACKUP_CURRENT_LINK")" = "$BACKUP_RELEASE_ROOT/$COMMIT_SHA" ] || return 1
  [ -f "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] && [ ! -L "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE")" = '0:0:444:1' ] \
    && cmp -s -- "$BUNDLE_DIR/systemd/$BACKUP_SERVICE" "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" || return 1
  [ -f "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] && [ ! -L "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER")" = '0:0:444:1' ] \
    && cmp -s -- "$BUNDLE_DIR/systemd/$BACKUP_TIMER" "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" || return 1
  validate_effective_backup_schedule || return 1
  [ -L "$SYSTEMD_UNIT_ROOT/timers.target.wants/$BACKUP_TIMER" ] \
    && [ "$(readlink "$SYSTEMD_UNIT_ROOT/timers.target.wants/$BACKUP_TIMER")" = "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] || return 1
  systemctl is-enabled --quiet "$BACKUP_TIMER" && systemctl is-active --quiet "$BACKUP_TIMER" || return 1
  next_run=$(systemctl show "$BACKUP_TIMER" --property=NextElapseUSecRealtime --value) || return 1
  [ -n "$next_run" ] && [ "$next_run" != n/a ] || return 1
  [ -f "$LEGACY_BACKUP_CRON_MARKER" ] && [ ! -L "$LEGACY_BACKUP_CRON_MARKER" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$LEGACY_BACKUP_CRON_MARKER")" = '0:0:600:1' ] || return 1
  marker_backup=$(jq -er --arg commit "$COMMIT_SHA" '
    select(.schema == 2 and .state == "committed" and .commit == $commit and
      (.backup | strings | test("^root-crontab\\.before-backup-timer\\.[0-9a-f]{40}$"))) | .backup
  ' "$LEGACY_BACKUP_CRON_MARKER") || return 1
  backup_copy=$RUNTIME_ROOT/$marker_backup
  [ -f "$backup_copy" ] && [ ! -L "$backup_copy" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$backup_copy")" = '0:0:600:1' ] \
    && [ "$(awk -v target="$LEGACY_BACKUP_CRON" '$0 == target { count += 1 } END { print count + 0 }' "$backup_copy")" -eq 1 ] \
    || return 1
  expected=$(mktemp "$RUNTIME_ROOT/backup-cron-expected.XXXXXX") || return 1
  observed=$(mktemp "$RUNTIME_ROOT/backup-cron-observed.XXXXXX") || { rm -f -- "$expected"; return 1; }
  if awk -v target="$LEGACY_BACKUP_CRON" '$0 != target' "$backup_copy" > "$expected" \
    && crontab -u root -l > "$observed" 2>/dev/null \
    && cmp -s "$expected" "$observed"; then
    status=0
  fi
  rm -f -- "$expected" "$observed"
  return "$status"
}

snapshot_backup_schedule() {
  local state
  [ -z "$backup_schedule_snapshot_dir" ] \
    || die 'snapshotul schedulerului de backup a fost deja creat'
  backup_schedule_snapshot_dir=$(mktemp -d "$RUNTIME_ROOT/backup-schedule-rollback.XXXXXX")
  chmod 0700 "$backup_schedule_snapshot_dir"

  if [ -e "$BACKUP_CURRENT_LINK" ] || [ -L "$BACKUP_CURRENT_LINK" ]; then
    [ -L "$BACKUP_CURRENT_LINK" ] \
      || die 'selectorul current existent nu este symlink'
    readlink "$BACKUP_CURRENT_LINK" > "$backup_schedule_snapshot_dir/current-target"
    [ -s "$backup_schedule_snapshot_dir/current-target" ] \
      || die 'selectorul current existent are țintă invalidă'
    backup_previous_current_present=1
  fi

  if [ -e "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] || [ -L "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ]; then
    [ -f "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] && [ ! -L "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] \
      || die 'unitatea service existentă nu este fișier regulat'
    cp --preserve=mode,ownership,timestamps -- \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" "$backup_schedule_snapshot_dir/$BACKUP_SERVICE"
    backup_previous_service_present=1
  fi
  if [ -e "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] || [ -L "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ]; then
    [ -f "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] && [ ! -L "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] \
      || die 'unitatea timer existentă nu este fișier regulat'
    cp --preserve=mode,ownership,timestamps -- \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" "$backup_schedule_snapshot_dir/$BACKUP_TIMER"
    backup_previous_timer_present=1
  fi

  if systemctl is-enabled --quiet "$BACKUP_TIMER"; then
    backup_previous_timer_enabled=1
  else
    if state=$(systemctl is-enabled "$BACKUP_TIMER" 2>/dev/null); then
      die 'starea enabled a timerului s-a schimbat în timpul snapshotului'
    fi
    case "$state" in
      disabled | static | not-found) ;;
      *) die "starea enabled a timerului existent nu poate fi capturată: $state" ;;
    esac
  fi
  if systemctl is-active --quiet "$BACKUP_TIMER"; then
    backup_previous_timer_active=1
  else
    if state=$(systemctl is-active "$BACKUP_TIMER" 2>/dev/null); then
      die 'starea active a timerului s-a schimbat în timpul snapshotului'
    fi
    case "$state" in
      inactive | failed | unknown) ;;
      *) die "starea active a timerului existent nu poate fi capturată: $state" ;;
    esac
  fi
  if [ "$backup_previous_timer_enabled" = 1 ] || [ "$backup_previous_timer_active" = 1 ]; then
    [ "$backup_previous_service_present" = 1 ] \
      && [ "$backup_previous_timer_present" = 1 ] \
      && [ "$backup_previous_current_present" = 1 ] \
      || die 'timerul existent rulează fără artefactele rollback capturabile'
  fi

  crontab -u root -l > "$backup_schedule_snapshot_dir/root-crontab" 2>/dev/null \
    || die 'crontabul root nu poate fi capturat pentru rollback'
  chmod 0600 "$backup_schedule_snapshot_dir/root-crontab"

  if [ -e "$LEGACY_BACKUP_CRON_MARKER" ] || [ -L "$LEGACY_BACKUP_CRON_MARKER" ]; then
    [ -f "$LEGACY_BACKUP_CRON_MARKER" ] && [ ! -L "$LEGACY_BACKUP_CRON_MARKER" ] \
      || die 'markerul retragerii cronului nu este fișier regulat'
    cp --preserve=mode,ownership,timestamps -- \
      "$LEGACY_BACKUP_CRON_MARKER" "$backup_schedule_snapshot_dir/legacy-cron-marker"
    backup_previous_marker_present=1
  fi
}

restore_snapshot_file() {
  local snapshot=$1 destination=$2 candidate
  [ -f "$snapshot" ] && [ ! -L "$snapshot" ] || return 1
  candidate=$(mktemp "$destination.rollback.XXXXXX") || return 1
  cp --preserve=mode,ownership,timestamps -- "$snapshot" "$candidate" \
    || { rm -f -- "$candidate"; return 1; }
  fsync_release_artifact "$candidate" file || { rm -f -- "$candidate"; return 1; }
  mv -f -- "$candidate" "$destination" || return 1
  fsync_release_artifact "$(dirname -- "$destination")" directory
}

remove_new_schedule_file() {
  local target=$1
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || return 1
    rm -f -- "$target" || return 1
    fsync_release_artifact "$(dirname -- "$target")" directory
  fi
}

rollback_backup_schedule() {
  local observed candidate_link previous_target
  [ "$backup_schedule_mutating" = 1 ] || return 0
  [ -n "$backup_schedule_snapshot_dir" ] && [ -d "$backup_schedule_snapshot_dir" ] \
    || return 1

  if [ "$backup_schedule_timer_touched" = 1 ]; then
    systemctl disable --now "$BACKUP_TIMER" >/dev/null || return 1
    fsync_release_artifact "$SYSTEMD_UNIT_ROOT/timers.target.wants" directory || return 1
  fi

  if [ "$backup_previous_current_present" = 1 ]; then
    previous_target=$(sed -n '1p' "$backup_schedule_snapshot_dir/current-target")
    [ -n "$previous_target" ] || return 1
    candidate_link=$(mktemp "$BACKUP_INSTALL_ROOT/current.rollback.XXXXXX") || return 1
    rm -f -- "$candidate_link"
    ln -s "$previous_target" "$candidate_link" || return 1
    mv -Tf -- "$candidate_link" "$BACKUP_CURRENT_LINK" || return 1
    fsync_release_artifact "$BACKUP_INSTALL_ROOT" directory || return 1
    [ "$(readlink "$BACKUP_CURRENT_LINK")" = "$previous_target" ] || return 1
  elif [ -e "$BACKUP_CURRENT_LINK" ] || [ -L "$BACKUP_CURRENT_LINK" ]; then
    [ -L "$BACKUP_CURRENT_LINK" ] || return 1
    rm -f -- "$BACKUP_CURRENT_LINK" || return 1
    fsync_release_artifact "$BACKUP_INSTALL_ROOT" directory || return 1
  fi

  if [ "$backup_previous_service_present" = 1 ]; then
    restore_snapshot_file "$backup_schedule_snapshot_dir/$BACKUP_SERVICE" \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" || return 1
  else
    remove_new_schedule_file "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" || return 1
  fi
  if [ "$backup_previous_timer_present" = 1 ]; then
    restore_snapshot_file "$backup_schedule_snapshot_dir/$BACKUP_TIMER" \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" || return 1
  else
    remove_new_schedule_file "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" || return 1
  fi
  systemctl daemon-reload || return 1
  if [ "$backup_previous_timer_enabled" = 1 ]; then
    systemctl enable "$BACKUP_TIMER" >/dev/null || return 1
    fsync_release_artifact "$SYSTEMD_UNIT_ROOT/timers.target.wants" directory || return 1
  fi
  if [ "$backup_previous_timer_active" = 1 ]; then
    systemctl start "$BACKUP_TIMER" || return 1
  fi

  crontab -u root "$backup_schedule_snapshot_dir/root-crontab" || return 1
  observed=$backup_schedule_snapshot_dir/root-crontab.observed
  crontab -u root -l > "$observed" 2>/dev/null || return 1
  cmp -s "$backup_schedule_snapshot_dir/root-crontab" "$observed" || return 1

  if [ "$backup_previous_marker_present" = 1 ]; then
    restore_snapshot_file "$backup_schedule_snapshot_dir/legacy-cron-marker" \
      "$LEGACY_BACKUP_CRON_MARKER" || return 1
  else
    remove_new_schedule_file "$LEGACY_BACKUP_CRON_MARKER" || return 1
  fi
  backup_schedule_mutating=0
}

cleanup_backup_schedule_snapshot() {
  [ -n "$backup_schedule_snapshot_dir" ] || return 0
  case "$backup_schedule_snapshot_dir" in
    "$RUNTIME_ROOT"/backup-schedule-rollback.*) ;;
    *) return 1 ;;
  esac
  rm -f -- \
    "$backup_schedule_snapshot_dir/current-target" \
    "$backup_schedule_snapshot_dir/$BACKUP_SERVICE" \
    "$backup_schedule_snapshot_dir/$BACKUP_TIMER" \
    "$backup_schedule_snapshot_dir/root-crontab" \
    "$backup_schedule_snapshot_dir/root-crontab.observed" \
    "$backup_schedule_snapshot_dir/legacy-cron-marker"
  rmdir "$backup_schedule_snapshot_dir"
  backup_schedule_snapshot_dir=''
}

if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
  [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
    || die 'lock-ul de publicare nu este fișier regulat'
fi
# `<>` nu trunchiază un eventual target schimbat într-o cursă. După open,
# validăm obiectul ținut de FD 8, link count și identitatea path↔FD înainte de
# orice chown/chmod; astfel nu urmăm și nu normalizăm un symlink arbitrar.
exec 8<>"$PUBLICATION_LOCK"
publication_fd_path=$(readlink "/proc/$$/fd/8") \
  || die 'FD 8 pentru lock-ul de publicare nu poate fi citit'
[ "$publication_fd_path" = "$PUBLICATION_LOCK" ] \
  || die 'FD 8 nu indică pathul canonic al lock-ului de publicare'
[ -f "/proc/$$/fd/8" ] || die 'FD 8 nu indică un fișier regulat'
[ "$(stat -Lc '%h' "/proc/$$/fd/8")" = 1 ] \
  || die 'lock-ul de publicare are hardlinkuri neașteptate'
publication_fd_identity=$(stat -Lc '%d:%i' "/proc/$$/fd/8")
[ "$publication_fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] \
  || die 'identitatea lock-ului diferă între path și FD 8'
chown root:root "/proc/$$/fd/8"
chmod 0600 "/proc/$$/fd/8"
[ "$(stat -Lc '%u:%g:%a:%h' "/proc/$$/fd/8")" = '0:0:600:1' ] \
  || die 'ACL-ul lock-ului de publicare nu poate fi normalizat'
[ ! -L "$PUBLICATION_LOCK" ] \
  && [ "$publication_fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] \
  || die 'pathul lock-ului a fost schimbat în timpul normalizării'
flock 8

release_request_state=none
release_pre_ponr_restored=0
recovered_constructor_quiesce_phase=''
resume_after_active_marker=0
resume_after_gate_commit=0
release_rollforward_only=0
resume_destructive_recovery=0
recover_pre_ponr_destructive=0
pre_ponr_active_prepared_restored=0
finalize_rolled_back_recovery_only=0
if [ -e "$RELEASE_REQUEST_LEDGER_ROOT" ] || [ -L "$RELEASE_REQUEST_LEDGER_ROOT" ]; then
  [ -d "$RELEASE_STATE_ROOT" ] && [ ! -L "$RELEASE_STATE_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$RELEASE_STATE_ROOT")" = '0:10050:750' ] \
    || die 'directorul release-state părinte al ledger-ului este nesigur'
  [ -d "$RELEASE_REQUEST_LEDGER_ROOT" ] && [ ! -L "$RELEASE_REQUEST_LEDGER_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$RELEASE_REQUEST_LEDGER_ROOT")" = '0:0:700' ] \
    || die 'directorul ledger-ului cererilor de release este nesigur'
fi
if [ -e "$RELEASE_REQUEST_LEDGER" ] || [ -L "$RELEASE_REQUEST_LEDGER" ]; then
  validate_release_request_ledger \
    || die 'cererea de release reutilizează un ID cu tuple diferită sau ledger nesigur'
  release_request_state=$(jq -er '.status' "$RELEASE_REQUEST_LEDGER")
fi
if [ -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || [ -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ]; then
  [ -f "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL")" = '0:0:600:1' ] \
    || die 'jurnalul quiesce existent este nesigur'
  recovered_constructor_quiesce_phase=$(jq -er \
    --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" \
    'select((.schema == 1 or .schema == 2) and .requestId == $requestId and .commit == $commit and
      (.phase == "armed" or .phase == "quiesced" or .phase == "active-prepared" or .phase == "active-published" or .phase == "gate-prepared" or .phase == "gate-committed")) | .phase' \
    "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") \
    || die 'jurnalul quiesce existent nu aparține tuplei curente'
fi

# Un refresh gate întrerupt își păstrează exact helperul care a scris jurnalul.
# Îl folosim înainte de upgrade, astfel încât recovery-ul să nu depindă de
# compatibilitatea unei versiuni ulterioare din bundle-ul candidat.
gate_recovery_journal=$RUNTIME_ROOT/constructor-gate-refresh.journal
if [ -e "$gate_recovery_journal" ] || [ -L "$gate_recovery_journal" ]; then
  [ -f "$gate_recovery_journal" ] && [ ! -L "$gate_recovery_journal" ] \
    && [ "$(stat -c '%u:%g:%a' "$gate_recovery_journal")" = '0:0:600' ] \
    || die 'jurnalul gate existent este nesigur'
  gate_recovery_root=$(jq -er 'select(.schema == 1 and (.transactionRoot | strings | test("^/root/kelion/runtime/constructor-gate-txn\\.[A-Za-z0-9]+$")) and (.helperSha256 | strings | test("^[0-9a-f]{64}$"))) | .transactionRoot' "$gate_recovery_journal") \
    || die 'jurnalul gate existent este invalid'
  [ -d "$gate_recovery_root" ] && [ ! -L "$gate_recovery_root" ] \
    && [ "$(realpath -e -- "$gate_recovery_root")" = "$gate_recovery_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$gate_recovery_root")" = '0:0:700' ] \
    || die 'directorul recovery gate este nesigur'
  [ -f "$gate_recovery_root/recovery-helper.sh" ] && [ ! -L "$gate_recovery_root/recovery-helper.sh" ] \
    && [ "$(stat -c '%u:%g:%a' "$gate_recovery_root/recovery-helper.sh")" = '0:0:500' ] \
    || die 'helperul jurnalizat pentru gate este nesigur'
  [ "$(sha256sum "$gate_recovery_root/recovery-helper.sh" | awk '{print $1}')" \
      = "$(jq -er '.helperSha256' "$gate_recovery_journal")" ] \
    || die 'hashul helperului jurnalizat pentru gate diferă'
  [ -f "$gate_recovery_root/recovery-compose.yml" ] && [ ! -L "$gate_recovery_root/recovery-compose.yml" ] \
    && [ "$(stat -c '%u:%g:%a' "$gate_recovery_root/recovery-compose.yml")" = '0:0:444' ] \
    || die 'compose-ul jurnalizat pentru gate este nesigur'
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 "$gate_recovery_root/recovery-helper.sh" --recover-only "$gate_recovery_root/recovery-compose.yml" --leave-constructor-quiesced \
    || die 'recovery-ul gate jurnalizat a eșuat'
  exec 9>&-
fi

# Jurnalele runtime/activare sunt recuperate cu helperul instalat care le-a
# creat. Abia după ce starea veche este coerentă putem înlocui helperul cu
# versiunea din bundle-ul candidat.
if [ -e "$RUNTIME_ROOT/runtime-config-cutover.journal" ] || [ -L "$RUNTIME_ROOT/runtime-config-cutover.journal" ] \
  || [ -e "$RUNTIME_ROOT/constructor-activation.journal" ] || [ -L "$RUNTIME_ROOT/constructor-activation.journal" ] \
  || [ -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || [ -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ]; then
  [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/bin/runtime-config-cutover.sh")" = '0:0:500' ] \
    || die 'helperul existent nu poate recupera jurnalul runtime/activare înainte de upgrade'
  [ -f "$ROOT/config/compose.production.yml" ] && [ ! -L "$ROOT/config/compose.production.yml" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/config/compose.production.yml")" = '0:0:444' ] \
    || die 'compose-ul existent nu poate recupera jurnalul runtime/activare înainte de upgrade'
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 \
  KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$KELION_RELEASE_REQUEST_ID" \
  KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$COMMIT_SHA" \
    "$ROOT/bin/runtime-config-cutover.sh" --recover-only "$ROOT/config/compose.production.yml" --leave-constructor-quiesced \
    || die 'recovery-ul runtime/activare cu helperul existent a eșuat'
  exec 9>&-
fi

# Upgrade atomic și fsync al recovery gate-ului de boot înainte de orice altă
# recuperare ori mutație a release-ului curent.
[ -f "$BUNDLE_DIR/lib/runtime-config-cutover.sh" ] && [ ! -L "$BUNDLE_DIR/lib/runtime-config-cutover.sh" ] \
  || die 'helperul runtime din bundle lipsește'
[ -f "$BUNDLE_DIR/systemd/kelion-runtime-config-recovery.service" ] \
  && [ ! -L "$BUNDLE_DIR/systemd/kelion-runtime-config-recovery.service" ] \
  || die 'unitatea recovery runtime din bundle lipsește'
install -d -o root -g root -m 0755 "$ROOT/bin"
install -d -o root -g 10050 -m 0750 "$ROOT/config"
recovery_helper_bootstrapped=0
recovery_helper_bootstrap_identity=''
if [ -e "$ROOT/bin/runtime-config-cutover.sh" ] || [ -L "$ROOT/bin/runtime-config-cutover.sh" ]; then
  [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ROOT/bin/runtime-config-cutover.sh")" = '0:0:500:1' ] \
    || die 'helperul persistent de recovery existent este nesigur'
else
  install_recovery_artifact "$BUNDLE_DIR/lib/runtime-config-cutover.sh" "$ROOT/bin/runtime-config-cutover.sh" root root 0500 \
    || die 'helperul persistent de recovery nu a putut fi pregătit pentru verificarea unității'
  [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ROOT/bin/runtime-config-cutover.sh")" = '0:0:500:1' ] \
    && cmp -s -- "$BUNDLE_DIR/lib/runtime-config-cutover.sh" "$ROOT/bin/runtime-config-cutover.sh" \
    || die 'helperul pregătit pentru verificarea unității diferă de bundle'
  recovery_helper_bootstrap_identity=$(stat -Lc '%d:%i' "$ROOT/bin/runtime-config-cutover.sh")
  recovery_helper_bootstrapped=1
fi
if ! systemd-analyze verify "$BUNDLE_DIR/systemd/kelion-runtime-config-recovery.service"; then
  if [ "$recovery_helper_bootstrapped" = 1 ]; then
    [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
      && [ "$recovery_helper_bootstrap_identity" = "$(stat -Lc '%d:%i' "$ROOT/bin/runtime-config-cutover.sh")" ] \
      && cmp -s -- "$BUNDLE_DIR/lib/runtime-config-cutover.sh" "$ROOT/bin/runtime-config-cutover.sh" \
      || die 'helperul bootstrap nu poate fi retras sigur după verificarea eșuată'
    rm -f -- "$ROOT/bin/runtime-config-cutover.sh"
    fsync_release_artifact "$ROOT/bin" directory \
      || die 'retragerea helperului bootstrap nu a putut fi sincronizată durabil'
  fi
  die 'unitatea recovery runtime din bundle este invalidă'
fi
if [ "$recovery_helper_bootstrapped" = 0 ]; then
  install_recovery_artifact "$BUNDLE_DIR/lib/runtime-config-cutover.sh" "$ROOT/bin/runtime-config-cutover.sh" root root 0500 \
    || die 'helperul persistent de recovery nu a putut fi instalat atomic'
fi
install_recovery_artifact "$COMPOSE_FILE" "$ROOT/config/compose.production.yml" root root 0444 \
  || die 'compose-ul persistent de recovery nu a putut fi instalat atomic'
install_recovery_artifact "$BUNDLE_DIR/systemd/kelion-runtime-config-recovery.service" \
  "$SYSTEMD_UNIT_ROOT/kelion-runtime-config-recovery.service" root root 0444 \
  || die 'unitatea persistentă de recovery nu a putut fi instalată atomic'
systemctl daemon-reload
systemctl enable kelion-runtime-config-recovery.service >/dev/null
recovery_wants_dir=$SYSTEMD_UNIT_ROOT/multi-user.target.wants
recovery_wants_link=$recovery_wants_dir/kelion-runtime-config-recovery.service
[ -d "$recovery_wants_dir" ] && [ ! -L "$recovery_wants_dir" ] \
  && [ -L "$recovery_wants_link" ] \
  && [ "$(readlink "$recovery_wants_link")" = "$SYSTEMD_UNIT_ROOT/kelion-runtime-config-recovery.service" ] \
  && [ "$(realpath -e -- "$recovery_wants_link")" = "$SYSTEMD_UNIT_ROOT/kelion-runtime-config-recovery.service" ] \
  || die 'enable-ul recovery nu a creat symlinkul canonic'
fsync_release_artifact "$recovery_wants_dir" directory
fsync_release_artifact "$SYSTEMD_UNIT_ROOT" directory
recovery_fragment=$(systemctl show kelion-runtime-config-recovery.service --property=FragmentPath --value)
recovery_dropins=$(systemctl show kelion-runtime-config-recovery.service --property=DropInPaths --value)
recovery_load_state=$(systemctl show kelion-runtime-config-recovery.service --property=LoadState --value)
recovery_need_reload=$(systemctl show kelion-runtime-config-recovery.service --property=NeedDaemonReload --value)
[ "$recovery_fragment" = "$SYSTEMD_UNIT_ROOT/kelion-runtime-config-recovery.service" ] \
  && [ -z "$recovery_dropins" ] \
  && [ "$recovery_load_state" = loaded ] \
  && [ "$recovery_need_reload" = no ] \
  && systemctl is-enabled --quiet kelion-runtime-config-recovery.service \
  || die 'unitatea recovery efectivă are fragment/drop-in/stare diferită de candidatul canonic'

# Un SIGKILL/reboot în timpul rotației runtime sau al activării Constructor
# lasă un jurnal root-only. Îl recuperăm sub același publication lock înainte
# ca release-ul să valideze ori să pornească un backend candidat.
if [ -e "$RUNTIME_ROOT/runtime-config-cutover.journal" ] || [ -L "$RUNTIME_ROOT/runtime-config-cutover.journal" ] \
  || [ -e "$RUNTIME_ROOT/constructor-activation.journal" ] || [ -L "$RUNTIME_ROOT/constructor-activation.journal" ] \
  || [ -e "$RUNTIME_ROOT/constructor-gate-refresh.journal" ] || [ -L "$RUNTIME_ROOT/constructor-gate-refresh.journal" ] \
  || [ -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || [ -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ]; then
  [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/bin/runtime-config-cutover.sh")" = '0:0:500' ] \
    || die 'helperul persistent de recovery runtime lipsește sau are ACL invalid'
  [ -f "$ROOT/config/compose.production.yml" ] && [ ! -L "$ROOT/config/compose.production.yml" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/config/compose.production.yml")" = '0:0:444' ] \
    || die 'compose-ul persistent de recovery lipsește sau are ACL invalid'
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 \
  KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$KELION_RELEASE_REQUEST_ID" \
  KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$COMMIT_SHA" \
    "$ROOT/bin/runtime-config-cutover.sh" --recover-only "$ROOT/config/compose.production.yml" --leave-constructor-quiesced \
    || die 'recovery-ul runtime persistent a eșuat înainte de release'
  exec 9>&-
fi

# O întrerupere dură nu execută trap-ul. Jurnalul root-only este autoritatea
# persistentă care împiedică o nouă publicare să ghicească dacă DB-ul poate fi
# restaurat sau dacă point-of-no-return a fost deja depășit.
if [ -e "$RECOVERY_JOURNAL" ] || [ -L "$RECOVERY_JOURNAL" ]; then
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    || die 'jurnalul recovery existent nu este fișier regulat'
  [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] \
    || die 'jurnalul recovery existent are ACL invalid'
  recovery_journal_phase=$(jq -er \
    'select(.schema == 1 and (.phase | type == "string") and
      (.pointOfNoReturn | type == "boolean")) | input_filename' \
    "$RECOVERY_JOURNAL" 2>/dev/null || true)
  # Citim separat câmpurile după validarea structurii, fără a include conținut
  # controlabil din jurnal în comenzi shell.
  if [ -n "$recovery_journal_phase" ]; then
    recovery_journal_phase=$(jq -er '.phase | select(test("^[a-z-]{3,40}$"))' "$RECOVERY_JOURNAL") \
      || die 'jurnalul recovery existent are fază invalidă'
    recovery_journal_ponr=$(jq -r '.pointOfNoReturn | if . then "true" else "false" end' \
      "$RECOVERY_JOURNAL") \
      || die 'jurnalul recovery existent are PONR invalid'
    recovery_journal_commit=$(jq -er '.commit | select(test("^[0-9a-f]{40}$"))' "$RECOVERY_JOURNAL") \
      || die 'jurnalul recovery existent are commit invalid'
    if [ "$recovery_journal_ponr" = true ] && [ "$recovery_journal_commit" = "$COMMIT_SHA" ] \
      && { [ "$recovered_constructor_quiesce_phase" = active-published ] \
        || [ "$recovered_constructor_quiesce_phase" = active-prepared ] \
        || [ "$recovered_constructor_quiesce_phase" = gate-prepared ] \
        || [ "$recovered_constructor_quiesce_phase" = gate-committed ]; }; then
      resume_destructive_recovery=1
    elif [ "$recovery_journal_ponr" = false ] && [ "$recovery_journal_commit" = "$COMMIT_SHA" ] \
      && { [ "$recovered_constructor_quiesce_phase" = quiesced ] \
        || [ "$recovered_constructor_quiesce_phase" = armed ] \
        || [ "$recovered_constructor_quiesce_phase" = active-prepared ]; } \
      && [[ "$recovery_journal_phase" =~ ^(maintenance|before-migrator|database-migrated|restore-in-progress|database-restored|rolled-back)$ ]]; then
      recover_pre_ponr_destructive=1
    elif [ "$recovery_journal_ponr" = false ] && [ "$recovery_journal_commit" = "$COMMIT_SHA" ] \
      && [ "$recovery_journal_phase" = rolled-back ] \
      && [ -z "$recovered_constructor_quiesce_phase" ] \
      && [ "$release_request_state" = retryable ]; then
      finalize_rolled_back_recovery_only=1
      recover_pre_ponr_destructive=1
    else
      die "există recovery neterminat: phase=$recovery_journal_phase pointOfNoReturn=$recovery_journal_ponr"
    fi
  else
    die 'jurnalul recovery existent este invalid'
  fi
fi

PRODUCT_ORIGIN=$(jq -er '.publicAppOrigin | select(type == "string")' "$PRODUCT_FILE")
PRODUCT_REPOSITORY=$(jq -er '.githubRepository | select(type == "string")' "$PRODUCT_FILE")
PUBLIC_APP_DOMAIN=$(python3 - "$PRODUCT_ORIGIN" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
if u.scheme != 'https' or not u.hostname or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment:
    raise SystemExit(1)
print(u.hostname.lower())
PY
) || die 'originul public din config este invalid'
[[ "$PRODUCT_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die 'repository invalid în config'

jq -e --arg sha "$COMMIT_SHA" '.schema == 1 and .commit == $sha and (.images | type == "object") and (.images | length == 5)' "$MANIFEST_FILE" >/dev/null \
  || die 'manifestul OCI nu corespunde commitului'

registry_repo=${PRODUCT_REPOSITORY,,}
image_ref() {
  local component=$1 ref
  ref=$(jq -er --arg component "$component" '.images[$component] | select(type == "string")' "$MANIFEST_FILE")
  case "$ref" in
    "ghcr.io/$registry_repo/$component@sha256:"????????????????????????????????????????????????????????????????) ;;
    *) die "referință OCI nepermisă pentru $component" ;;
  esac
  [[ "$ref" =~ @sha256:[0-9a-f]{64}$ ]] || die "digest OCI invalid pentru $component"
  printf '%s' "$ref"
}

KELION_APP_IMAGE=$(image_ref app)
KELION_BROWSER_IMAGE=$(image_ref browser)
KELION_BROWSER_EGRESS_IMAGE=$(image_ref browser-egress)
KELION_CONVERTER_GATEWAY_IMAGE=$(image_ref converter-gateway)
KELION_CONVERTER_PARSER_IMAGE=$(image_ref converter-parser)
export KELION_APP_IMAGE KELION_BROWSER_IMAGE KELION_BROWSER_EGRESS_IMAGE
export KELION_CONVERTER_GATEWAY_IMAGE KELION_CONVERTER_PARSER_IMAGE

[ -f "$CONFIG_FILE" ] || die 'configul runtime dedicat lipsește'
[ "$(stat -c '%u:%g:%a' "$CONFIG_FILE")" = '0:10050:640' ] || die 'configul runtime trebuie root:10050 mode 0640'
exec 9>&8
KELION_CUTOVER_LOCK_HELD=1 "$ROOT/bin/runtime-config-cutover.sh" --validate-env-file runtime.env "$CONFIG_FILE" \
  || die 'contractul runtime canonic a fost refuzat de validatorul comun'
exec 9>&-

declare -A allowed_config=()
for name in NODE_ENV PORT PUBLIC_APP_ORIGIN FRONTEND_ORIGIN ADMIN_EMAIL OPENAI_API_KEY_FILE OPENAI_LUNA_MODEL OPENAI_MEDIUM_MODEL OPENAI_HEAVY_MODEL OPENAI_REALTIME_MODEL OPENAI_REALTIME_TRANSCRIPTION_MODEL OPENAI_CALL_TRANSCRIPTION_MODEL OPENAI_TTS_MODEL OPENAI_IMAGE_MODEL OPENAI_VIDEO_MODEL OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND OPENAI_VIDEO_SHUTDOWN_AT DATABASE_URL_FILE SESSION_SECRET_FILE GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_ID GOOGLE_REDIRECT_URI CODEX_WORKER_ENABLED CODEX_WORKER_SECRET_FILE CONSTRUCTOR_PUBLISHER_ENABLED CONSTRUCTOR_PUBLISHER_SECRET_FILE CONSTRUCTOR_RELEASE_ENABLED CONSTRUCTOR_RELEASE_SECRET_FILE GITHUB_RELEASE_OAUTH_TOKEN_FILE CONSTRUCTOR_RETRY_BASE_SECONDS CONSTRUCTOR_RETRY_MAX_SECONDS CONSTRUCTOR_EXTERNAL_RETRY_SECONDS CONSTRUCTOR_REQUIRED_CHECKS BROWSER_WORKER_SOCKET BROWSER_WORKER_SECRET_FILE CONVERTER_WORKER_SOCKET CONVERTER_WORKER_SECRET_FILE REVOLUT_MERCHANT_SECRET_KEY_FILE REVOLUT_WEBHOOK_SIGNING_SECRET_FILE VAPID_PRIVATE_KEY_FILE VISITOR_CHAT_TTL_SECONDS VISITOR_ANALYTICS_RETENTION_DAYS SESSION_ABSOLUTE_TTL_SECONDS SESSION_IDLE_TTL_SECONDS SESSION_TOUCH_INTERVAL_SECONDS SESSION_MAX_ACTIVE_PER_ACCOUNT SESSION_RECENT_REAUTH_SECONDS NATIVE_AUTH_REQUEST_TTL_SECONDS NATIVE_AUTH_EXCHANGE_TTL_SECONDS NATIVE_CHANNEL_TICKET_TTL_SECONDS OFFLINE_SYNC_MAX_TURNS OFFLINE_SYNC_MAX_TEXT_CHARS OFFLINE_SYNC_MAX_AGE_DAYS OFFLINE_SYNC_FUTURE_SKEW_SECONDS VOCAL_LIVE_IDLE_TIMEOUT_SECONDS PRIVACY_POLICY_UPDATED DATA_CONTROLLER_NAME PRIVACY_BACKUP_RETENTION_DAYS FINANCIAL_RETENTION_YEARS JOURNAL_RETENTION_DAYS MEDIA_RETENTION_DAYS CREDIT_PRICE_MINOR CHAT_TURN_PRICE_MINOR VOICE_LIVE_MINUTE_PRICE_MINOR CALL_UTTERANCE_PRICE_MINOR BILLING_FIRST_TOPUP_MIN_MINOR BILLING_TOPUP_STEP_MINOR BILLING_TOPUP_MIN_MINOR BILLING_TOPUP_MAX_MINOR LOW_CREDIT_THRESHOLD_MINOR LOW_CREDIT_TOPUP_MINOR PAYMENT_MODE PAYMENT_CONTRACT_VERIFIED REVOLUT_MERCHANT_API_VERSION REVOLUT_ORDER_EXPIRY PUSH_ENABLED VAPID_PUBLIC_KEY PUSH_ENDPOINT_HOSTS PUSH_MAX_SUBSCRIPTIONS GOOGLE_TTS_ENABLED GOOGLE_TTS_VOICE SEARCH_ENABLED MAIL_ENABLED RELEASE_CANDIDATE_MODE; do
  allowed_config[$name]=1
done
while IFS='=' read -r name _value; do
  [ -z "$name" ] && continue
  [[ "$name" = \#* ]] && continue
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || die 'nume invalid în configul runtime'
  [ "${allowed_config[$name]:-0}" = 1 ] || die "variabilă nepermisă în configul runtime: $name"
done < "$CONFIG_FILE"

config_value() { sed -n "s/^$1=//p" "$CONFIG_FILE" | sed -n '1p'; }
[ "$(config_value NODE_ENV)" = production ] || die 'NODE_ENV trebuie production'
[ "$(config_value PUBLIC_APP_ORIGIN)" = "$PRODUCT_ORIGIN" ] || die 'PUBLIC_APP_ORIGIN diferă de configul release-ului'
[ "$(config_value FRONTEND_ORIGIN)" = "$PRODUCT_ORIGIN" ] || die 'FRONTEND_ORIGIN diferă de configul release-ului'
[ "$(config_value GOOGLE_REDIRECT_URI)" = "$PRODUCT_ORIGIN/auth/google/callback" ] || die 'redirectul Google nu este first-party exact'
admin_email=$(config_value ADMIN_EMAIL)
[[ "$admin_email" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || die 'ADMIN_EMAIL obligatoriu și normalizat'
for name in OPENAI_LUNA_MODEL OPENAI_MEDIUM_MODEL OPENAI_HEAVY_MODEL OPENAI_REALTIME_MODEL OPENAI_REALTIME_TRANSCRIPTION_MODEL OPENAI_CALL_TRANSCRIPTION_MODEL OPENAI_TTS_MODEL OPENAI_IMAGE_MODEL; do
  [[ "$(config_value "$name")" =~ ^gpt-[a-z0-9][a-z0-9._-]*$ ]] || die "$name lipsește sau este invalid"
done
[[ "$(config_value OPENAI_VIDEO_MODEL)" =~ ^sora-[a-z0-9][a-z0-9._-]*$ ]] \
  || die 'OPENAI_VIDEO_MODEL lipsește sau nu este un model video Sora valid'
for name in PRIVACY_POLICY_UPDATED DATA_CONTROLLER_NAME GOOGLE_TOKEN_ENCRYPTION_KEY_ID OPENAI_VIDEO_SHUTDOWN_AT; do
  [ -n "$(config_value "$name")" ] || die "$name lipsește"
done
[[ "$(config_value GOOGLE_TOKEN_ENCRYPTION_KEY_ID)" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || die 'GOOGLE_TOKEN_ENCRYPTION_KEY_ID invalid'
python3 - "$(config_value OPENAI_VIDEO_SHUTDOWN_AT)" <<'PY' || die 'OPENAI_VIDEO_SHUTDOWN_AT trebuie să fie ISO-8601 cu fus orar'
import datetime, sys
value = sys.argv[1]
parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
raise SystemExit(0 if parsed.tzinfo is not None else 1)
PY
constructor_retry_base_seconds=$(config_value CONSTRUCTOR_RETRY_BASE_SECONDS)
constructor_retry_max_seconds=$(config_value CONSTRUCTOR_RETRY_MAX_SECONDS)
constructor_external_retry_seconds=$(config_value CONSTRUCTOR_EXTERNAL_RETRY_SECONDS)
for value in "$constructor_retry_base_seconds" "$constructor_retry_max_seconds" "$constructor_external_retry_seconds"; do
  [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] || die 'timpii de retry Constructor trebuie să fie întregi pozitivi limitați'
done
[ "$constructor_retry_base_seconds" -ge 5 ] && [ "$constructor_retry_base_seconds" -le 3600 ] \
  || die 'CONSTRUCTOR_RETRY_BASE_SECONDS trebuie să fie între 5 și 3600'
[ "$constructor_retry_max_seconds" -ge 30 ] && [ "$constructor_retry_max_seconds" -le 86400 ] \
  || die 'CONSTRUCTOR_RETRY_MAX_SECONDS trebuie să fie între 30 și 86400'
[ "$constructor_external_retry_seconds" -ge 60 ] && [ "$constructor_external_retry_seconds" -le 86400 ] \
  || die 'CONSTRUCTOR_EXTERNAL_RETRY_SECONDS trebuie să fie între 60 și 86400'
[ "$constructor_retry_base_seconds" -le "$constructor_retry_max_seconds" ] \
  || die 'CONSTRUCTOR_RETRY_BASE_SECONDS nu poate depăși CONSTRUCTOR_RETRY_MAX_SECONDS'
constructor_required_checks=$(config_value CONSTRUCTOR_REQUIRED_CHECKS)
[[ "$constructor_required_checks" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}(,[A-Za-z0-9][A-Za-z0-9._/-]{0,79}){1,15}$ ]] \
  || die 'CONSTRUCTOR_REQUIRED_CHECKS trebuie să conțină între 2 și 16 identificatori CI siguri'
declare -A constructor_checks_seen=()
IFS=',' read -r -a constructor_checks <<<"$constructor_required_checks"
for check in "${constructor_checks[@]}"; do
  [ -z "${constructor_checks_seen[$check]:-}" ] || die 'CONSTRUCTOR_REQUIRED_CHECKS conține duplicate'
  constructor_checks_seen[$check]=1
done
[ "${constructor_checks_seen[verify]:-}" = 1 ] && [ "${constructor_checks_seen[container-isolation]:-}" = 1 ] \
  || die 'CONSTRUCTOR_REQUIRED_CHECKS trebuie să păstreze verify și container-isolation'
for name in CODEX_WORKER_ENABLED CONSTRUCTOR_PUBLISHER_ENABLED CONSTRUCTOR_RELEASE_ENABLED; do
  [[ "$(config_value "$name")" =~ ^[01]$ ]] || die "$name trebuie să fie 0 sau 1"
done
for name in VISITOR_CHAT_TTL_SECONDS VISITOR_ANALYTICS_RETENTION_DAYS SESSION_ABSOLUTE_TTL_SECONDS SESSION_IDLE_TTL_SECONDS SESSION_TOUCH_INTERVAL_SECONDS SESSION_MAX_ACTIVE_PER_ACCOUNT SESSION_RECENT_REAUTH_SECONDS NATIVE_AUTH_REQUEST_TTL_SECONDS NATIVE_AUTH_EXCHANGE_TTL_SECONDS NATIVE_CHANNEL_TICKET_TTL_SECONDS OFFLINE_SYNC_MAX_TURNS OFFLINE_SYNC_MAX_TEXT_CHARS OFFLINE_SYNC_MAX_AGE_DAYS OFFLINE_SYNC_FUTURE_SKEW_SECONDS VOCAL_LIVE_IDLE_TIMEOUT_SECONDS PRIVACY_BACKUP_RETENTION_DAYS FINANCIAL_RETENTION_YEARS JOURNAL_RETENTION_DAYS MEDIA_RETENTION_DAYS OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND CREDIT_PRICE_MINOR CHAT_TURN_PRICE_MINOR VOICE_LIVE_MINUTE_PRICE_MINOR CALL_UTTERANCE_PRICE_MINOR BILLING_FIRST_TOPUP_MIN_MINOR BILLING_TOPUP_STEP_MINOR BILLING_TOPUP_MIN_MINOR BILLING_TOPUP_MAX_MINOR LOW_CREDIT_THRESHOLD_MINOR LOW_CREDIT_TOPUP_MINOR PUSH_MAX_SUBSCRIPTIONS; do
  [[ "$(config_value "$name")" =~ ^[1-9][0-9]*$ ]] || die "$name trebuie să fie un întreg pozitiv"
done
[ "$(config_value NATIVE_CHANNEL_TICKET_TTL_SECONDS)" -le 30 ] || die 'NATIVE_CHANNEL_TICKET_TTL_SECONDS trebuie să fie cel mult 30'
payment_mode=$(config_value PAYMENT_MODE)
payment_contract_verified=$(config_value PAYMENT_CONTRACT_VERIFIED)
case "$payment_mode" in
  disabled) [ "$payment_contract_verified" = false ] || die 'modul disabled cere PAYMENT_CONTRACT_VERIFIED=false' ;;
  sandbox|production) [ "$payment_contract_verified" = true ] || die 'plățile nu pot fi active fără contract verificat' ;;
  *) die 'PAYMENT_MODE trebuie disabled, sandbox sau production' ;;
esac
[[ "$(config_value REVOLUT_MERCHANT_API_VERSION)" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] \
  || die 'REVOLUT_MERCHANT_API_VERSION trebuie să fie o dată versionată'
[[ "$(config_value REVOLUT_ORDER_EXPIRY)" =~ ^PT([1-9][0-9]{0,2}M|[1-9][0-9]?H)$ ]] \
  || die 'REVOLUT_ORDER_EXPIRY trebuie să fie o durată ISO-8601 în minute sau ore'

secret_files=(openai-project-key database-url session-secret google-client-secret google-token-encryption-key codex-worker-secret constructor-publisher-secret constructor-release-secret github-release-oauth-token browser-worker-secret converter-worker-secret revolut-merchant-secret-key revolut-webhook-signing-secret vapid-private-key migration-backup-proof-key)
[ "$(stat -c '%u:%g:%a' "$SECRET_ROOT")" = '0:10050:750' ] || die 'directorul de secrete trebuie root:10050 mode 0750'
for name in "${secret_files[@]}"; do
  path=$SECRET_ROOT/$name
  [ -f "$path" ] && [ ! -L "$path" ] && [ -s "$path" ] || die "secret-file lipsă: $name"
  [ "$(stat -c '%u:%g:%a' "$path")" = '0:10050:440' ] || die "ACL invalid pentru secret-file $name"
done
[ "$(wc -l < "$SECRET_ROOT/github-release-oauth-token")" -eq 1 ] \
  && [ "$(awk 'NR == 1 { print length; exit }' "$SECRET_ROOT/github-release-oauth-token")" -ge 32 ] \
  || die 'github-release-oauth-token trebuie să fie o credentială dedicată validă'
case "$(sed -n '1p' "$SECRET_ROOT/openai-project-key")" in
  sk-proj-*) ;;
  disabled-placeholder-*) ;;  # Mod abonament ChatGPT Pro — fără cheie API
  *) die 'cheia OpenAI runtime nu este project-scoped' ;;
esac
[ ! -e "$SECRET_ROOT/openai-admin-key" ] || die 'cheia OpenAI admin nu poate exista în secret root-ul aplicației'
for name in revolut-merchant-secret-key revolut-webhook-signing-secret; do
  path=$SECRET_ROOT/$name
  [ "$(wc -l < "$path")" -eq 1 ] || die "$name trebuie să conțină exact o linie"
  [ "$(awk 'NR == 1 { print length; exit }' "$path")" -ge 32 ] || die "$name este prea scurt"
  if [ "$payment_mode" = disabled ]; then
    grep -q '^disabled-placeholder-' "$path" || die "$name trebuie înlocuit cu placeholder când plățile sunt dezactivate"
  else
    ! grep -q '^disabled-placeholder-' "$path" || die "$name este placeholder; plățile rămân blocate"
  fi
done
push_enabled=$(config_value PUSH_ENABLED)
case "$push_enabled" in
  0)
    grep -q '^disabled-placeholder-' "$SECRET_ROOT/vapid-private-key" \
      || die 'vapid-private-key trebuie să fie placeholder când push este dezactivat'
    ;;
  1)
    [[ "$(config_value VAPID_PUBLIC_KEY)" =~ ^[A-Za-z0-9_-]{87}$ ]] || die 'VAPID_PUBLIC_KEY invalidă'
    [[ "$(sed -n '1p' "$SECRET_ROOT/vapid-private-key")" =~ ^[A-Za-z0-9_-]{43}$ ]] \
      || die 'VAPID_PRIVATE_KEY invalidă sau placeholder'
    push_endpoint_hosts=$(config_value PUSH_ENDPOINT_HOSTS)
    [ -n "$push_endpoint_hosts" ] || die 'PUSH_ENDPOINT_HOSTS obligatoriu când push este activ'
    IFS=',' read -r -a push_hosts <<< "$push_endpoint_hosts"
    for host in "${push_hosts[@]}"; do
      [[ "$host" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] \
        || die 'PUSH_ENDPOINT_HOSTS conține un domeniu invalid'
    done
    ;;
  *) die 'PUSH_ENABLED trebuie 0 sau 1' ;;
esac

install -d -o root -g 10050 -m 0750 "$RUNTIME_ROOT" "$RELEASE_STATE_ROOT"
install -d -o root -g root -m 0755 "$PROXY_CONFIG_ROOT" "$PROXY_CONFIG_ROOT/upstream" "$PROXY_STATE_ROOT"
install -d -o 1000 -g 1000 -m 0750 "$PROXY_STATE_ROOT/data" "$PROXY_STATE_ROOT/config"
if [ ! -e "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ]; then
  initial_active=$(mktemp "$RELEASE_STATE_ROOT/active.bootstrap.XXXXXX")
  printf '%s\n' legacy > "$initial_active"
  chown root:10050 "$initial_active"
  chmod 0640 "$initial_active"
  fsync_release_artifact "$initial_active" file
  mv -f -- "$initial_active" "$RELEASE_STATE_ROOT/active"
  fsync_release_artifact "$RELEASE_STATE_ROOT" directory
else
  [ -f "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ] \
    && [ "$(stat -c '%u:%g:%a' "$RELEASE_STATE_ROOT/active")" = '0:10050:640' ] \
    && [ "$(wc -l < "$RELEASE_STATE_ROOT/active")" -eq 1 ] \
    || die 'markerul release activ existent este gol sau necanonic'
  initial_marker=$(sed -n '1p' "$RELEASE_STATE_ROOT/active")
  [ "$initial_marker" = legacy ] || [[ "$initial_marker" =~ ^[0-9a-f]{40}$ ]] \
    || die 'markerul release activ existent are conținut invalid'
fi

KELION_SECCOMP_DESTINATION=$SECCOMP_PROFILE bash "$BUNDLE_DIR/pregateste-seccomp.sh"
[ -x "$COMPOSE_BIN" ] || bash "$BUNDLE_DIR/pregateste-compose.sh"
"$COMPOSE_BIN" version >/dev/null
docker network inspect kelion-proxy >/dev/null 2>&1 || docker network create --driver bridge --label com.kelion.managed=true kelion-proxy >/dev/null

for ref in "$KELION_APP_IMAGE" "$KELION_BROWSER_IMAGE" "$KELION_BROWSER_EGRESS_IMAGE" "$KELION_CONVERTER_GATEWAY_IMAGE" "$KELION_CONVERTER_PARSER_IMAGE"; do
  docker pull "$ref" >/dev/null
  [ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")" = "$COMMIT_SHA" ] \
    || die 'o imagine OCI nu poartă commitul aprobat'
done

run_migrator() {
  docker run --rm --network none --user 1000:1000 --group-add 10050 \
    --read-only --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 96 --memory 768m --cpus 1 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000 \
    -e HOME=/tmp -e npm_config_cache=/tmp/npm \
    -e DATABASE_URL_FILE=/run/secrets/database-url \
    -v /var/run/postgresql:/var/run/postgresql:ro \
    -v "$SECRET_ROOT/database-url:/run/secrets/database-url:ro" \
    "$@"
}

assert_constructor_release_handoff_drained() {
  local result blocking current
  if ! result=$(run_migrator \
    -e KELION_RELEASE_REQUEST_ID="$KELION_RELEASE_REQUEST_ID" \
    -e KELION_RELEASE_COMMIT_SHA="$COMMIT_SHA" \
    -e KELION_RELEASE_CI_RUN_ID="$KELION_CI_RUN_ID" \
    -e KELION_RELEASE_BUILD_RUN_ID="$KELION_BUILD_RUN_ID" \
    -e KELION_RELEASE_WORKFLOW_RUN_ID="$KELION_RELEASE_WORKFLOW_RUN_ID" \
    "$KELION_APP_IMAGE" node --input-type=module -e '
import fs from "node:fs"
import { createRequire } from "node:module"

const raw = fs.readFileSync("/run/secrets/database-url", "utf8")
if (!raw.endsWith("\n") || raw.slice(0, -1).includes("\n") || raw.includes("\r")) process.exit(2)
const require = createRequire("/app/backend/package.json")
const { Client } = require("pg")
const client = new Client({
  connectionString: raw.slice(0, -1),
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
  application_name: "kelion-release-constructor-drain-preflight",
})
await client.connect()
try {
  const columnResult = await client.query(`
    SELECT column_name
      FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = $1
  `, ["constructor_pipeline"])
  const columns = new Set(columnResult.rows.map((row) => row.column_name))
  const v1Columns = [
    "release_request_id", "release_workflow_run_id",
    "release_dispatch_receipt_sha256", "merged_commit_sha",
  ]
  if (!v1Columns.every((name) => columns.has(name))) process.exit(3)
  const v2Columns = [
    "release_protocol_version", "release_target_sha", "release_target_receipt_sha256",
    "release_ci_run_id", "release_build_run_id", "release_artifact_id",
    "release_candidate_receipt_sha256", "release_intent_receipt_sha256",
  ]
  const hasV2Schema = v2Columns.every((name) => columns.has(name))
  const ownershipPredicate = hasV2Schema ? `
        COALESCE(
          p.release_protocol_version = 2
          AND p.release_request_id = $3::uuid
          AND p.release_target_sha = $4
          AND p.merged_commit_sha = $4
          AND p.release_target_receipt_sha256 IS NOT NULL
          AND p.release_ci_run_id = $5::bigint
          AND p.release_build_run_id = $6::bigint
          AND p.release_artifact_id IS NOT NULL
          AND p.release_candidate_receipt_sha256 IS NOT NULL
          AND p.release_intent_receipt_sha256 IS NOT NULL
          AND (p.release_workflow_run_id IS NULL OR p.release_workflow_run_id = $7::bigint),
          false
        )
  ` : `
        COALESCE(
          p.release_request_id = $3::uuid
          AND p.merged_commit_sha = $4
          AND p.release_workflow_run_id = $7::bigint
          AND p.release_dispatch_receipt_sha256 IS NOT NULL,
          false
        )
  `
  const result = await client.query(`
    WITH in_flight AS (
      SELECT (${ownershipPredicate}) AS is_current
        FROM build_jobs b
        JOIN constructor_pipeline p ON p.job_id = b.id
       WHERE b.status = $1
         AND b.constructor_stage = ANY($2::text[])
    )
    SELECT count(*) FILTER (WHERE is_current IS NOT TRUE)::integer AS blocking,
           count(*) FILTER (WHERE is_current IS TRUE)::integer AS current
      FROM in_flight
  `, [
    "running",
    ["merged", "release_dispatched"],
    process.env.KELION_RELEASE_REQUEST_ID,
    process.env.KELION_RELEASE_COMMIT_SHA,
    process.env.KELION_RELEASE_CI_RUN_ID,
    process.env.KELION_RELEASE_BUILD_RUN_ID,
    process.env.KELION_RELEASE_WORKFLOW_RUN_ID,
  ])
  const row = result.rows[0]
  process.stdout.write(`${row?.blocking ?? "invalid"}:${row?.current ?? "invalid"}`)
} finally {
  await client.end()
}
'); then
    printf 'release: preflight-ul DB pentru handoff-ul Constructor nu a putut fi executat\n' >&2
    return 1
  fi
  IFS=: read -r blocking current <<<"$result"
  [[ "$blocking" =~ ^[0-9]+$ ]] && [[ "$current" =~ ^[0-9]+$ ]] && [ "$current" -le 1 ] || return 1
  if [ "$blocking" -ne 0 ]; then
    printf 'release: %s job(uri) Constructor străine sau legacy sunt în merged/release_dispatched; fluxul vechi trebuie lăsat să le finalizeze înainte de retry\n' "$blocking" >&2
    return 1
  fi
}

cleanup_migration_proof_copy() {
  local candidate=${migration_proof_copy:-}
  [ -n "$candidate" ] || return 0
  case "$candidate" in
    "$RUNTIME_ROOT"/migration-backup-proof.*) ;;
    *) return 1 ;;
  esac
  rm -f -- "$candidate" || return 1
  [ ! -e "$candidate" ] && [ ! -L "$candidate" ] || return 1
  migration_proof_copy=''
}

prepare_migration_proof_copy() {
  [ -z "$migration_proof_copy" ] || return 1
  [ -f "$PROOF_FILE" ] && [ ! -L "$PROOF_FILE" ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' "$PROOF_FILE")" = '0:0:600:1' ] || return 1

  migration_proof_copy=$(mktemp "$RUNTIME_ROOT/migration-backup-proof.XXXXXX") || return 1
  if ! install -o root -g 10050 -m 0440 "$PROOF_FILE" "$migration_proof_copy" \
    || [ ! -f "$migration_proof_copy" ] || [ -L "$migration_proof_copy" ] \
    || [ "$(stat -Lc '%u:%g:%a:%h' "$migration_proof_copy")" != '0:10050:440:1' ] \
    || ! cmp -s -- "$PROOF_FILE" "$migration_proof_copy" \
    || [ ! -f "$PROOF_FILE" ] || [ -L "$PROOF_FILE" ] \
    || [ "$(stat -Lc '%u:%g:%a:%h' "$PROOF_FILE")" != '0:0:600:1' ]; then
    cleanup_migration_proof_copy || true
    return 1
  fi
}

migration_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan)
jq -e '.kind == "migrations_plan" and (.risk == "safe" or .risk == "destructive") and (.pending | type == "array")' <<<"$migration_plan" >/dev/null \
  || die 'planul migrărilor este invalid'
pending_count=$(jq -er '.pending | length' <<<"$migration_plan")
migration_risk=$(jq -er '.risk' <<<"$migration_plan")
migration_contract_before=$(jq -cS '{kind,risk,pending}' <<<"$migration_plan")
destructive_cutover=0
if [ "$pending_count" -gt 0 ] && [ "$migration_risk" = destructive ]; then
  destructive_cutover=1
fi

if [ "$destructive_cutover" = 1 ]; then
  for tool in node psql pg_restore df stat readlink; do need "$tool"; done
  [[ "$(psql --version)" =~ \(PostgreSQL\)[[:space:]]16\. ]] \
    || die 'restore-ul verificat cere clientul psql 16'
  [[ "$(pg_restore --version)" =~ \(PostgreSQL\)[[:space:]]16\. ]] \
    || die 'restore-ul verificat cere clientul pg_restore 16'
  publication_lock_target=$(readlink -f "/proc/$$/fd/8") \
    || die 'FD 8 pentru lock-ul de publicare nu poate fi verificat'
  [ "$publication_lock_target" = "$(readlink -f "$ROOT/publicare.lock")" ] \
    || die 'FD 8 nu deține lock-ul de publicare așteptat'
  flock -n 8 || die 'lock-ul de publicare nu poate fi reutilizat de recovery'
fi

journal_proxy_active_before=''
journal_proxy_target_slot=''
journal_proxy_caddyfile_present=0
journal_proxy_caddyfile_snapshot=''
journal_proxy_caddyfile_sha256=''
journal_proxy_upstream_present=0
journal_proxy_upstream_snapshot=''
journal_proxy_upstream_sha256=''
journal_proxy_target_caddy_sha256=''
journal_proxy_target_upstream_sha256=''

load_deploy_proxy_intent() {
  local phase=$1
  [[ "$phase" =~ ^(armed|quiesced|active-prepared|active-published|gate-prepared|gate-committed)$ ]] || return 1
  jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" --arg phase "$phase" '
    .schema == 2 and .requestId == $requestId and .commit == $commit and .phase == $phase and
    (.proxyIntent | type == "object") and
    (if .activeBefore == "legacy" then .proxyIntent.activeSlotBefore == "legacy"
      else (.proxyIntent.activeSlotBefore == "blue" or .proxyIntent.activeSlotBefore == "green") end) and
    (.proxyIntent.targetSlot == "blue" or .proxyIntent.targetSlot == "green") and
    .proxyIntent.activeSlotBefore != .proxyIntent.targetSlot and
    (if .proxyIntent.activeSlotBefore == "legacy" then
      .proxyIntent.targetSlot == "blue" and .proxyIntent.managedProxyWasRunning == false and
      .proxyIntent.legacyProxyWasRunning == true and
      (.proxyIntent.legacyProxyRestartPolicy | strings |
        test("^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$")) and
      (.legacyContainers | type == "array" and length >= 1 and length <= 3 and
        length == (unique | length) and index("kelionai-app") != null) and
      (.legacyRestartPolicies | type == "object") and
      (.legacyContainers as $containers | (.legacyRestartPolicies | keys | sort) == ($containers | sort)) and
      all(.legacyRestartPolicies[];
        type == "string" and test("^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$"))
    else .proxyIntent.managedProxyWasRunning == true and .proxyIntent.legacyProxyWasRunning == false and
      .proxyIntent.legacyProxyRestartPolicy == null and .legacyContainers == [] and .legacyRestartPolicies == {}
    end) and
    (if .proxyIntent.caddyfilePresent then
      (.proxyIntent.caddyfileSnapshot | strings |
        test("^/root/kelion/runtime/caddyfile-rollback\\.[A-Za-z0-9]+$")) and
      (.proxyIntent.caddyfileSha256 | strings | test("^[0-9a-f]{64}$"))
    else .proxyIntent.caddyfileSnapshot == "" and .proxyIntent.caddyfileSha256 == "absent" end) and
    (if .proxyIntent.oldUpstreamPresent then
      (.proxyIntent.oldUpstreamSnapshot | strings |
        test("^/root/kelion/runtime/upstream-rollback\\.[A-Za-z0-9]+$")) and
      (.proxyIntent.oldUpstreamSha256 | strings | test("^[0-9a-f]{64}$"))
    else .proxyIntent.oldUpstreamSnapshot == "" and .proxyIntent.oldUpstreamSha256 == "absent" end) and
    (.proxyIntent.targetCaddyfileSha256 | strings | test("^[0-9a-f]{64}$")) and
    (.proxyIntent.targetUpstreamSha256 | strings | test("^[0-9a-f]{64}$"))
  ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" >/dev/null || return 1
  journal_proxy_active_before=$(jq -er '.proxyIntent.activeSlotBefore' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_target_slot=$(jq -er '.proxyIntent.targetSlot' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_caddyfile_present=$(jq -r '.proxyIntent.caddyfilePresent | if . then "1" else "0" end' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_caddyfile_snapshot=$(jq -er '.proxyIntent.caddyfileSnapshot' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_caddyfile_sha256=$(jq -er '.proxyIntent.caddyfileSha256' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_upstream_present=$(jq -r '.proxyIntent.oldUpstreamPresent | if . then "1" else "0" end' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_upstream_snapshot=$(jq -er '.proxyIntent.oldUpstreamSnapshot' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_upstream_sha256=$(jq -er '.proxyIntent.oldUpstreamSha256' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_target_caddy_sha256=$(jq -er '.proxyIntent.targetCaddyfileSha256' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  journal_proxy_target_upstream_sha256=$(jq -er '.proxyIntent.targetUpstreamSha256' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  if [ "$phase" = armed ] || [ "$phase" = quiesced ] || [ "$phase" = active-prepared ]; then
    if [ "$journal_proxy_caddyfile_present" = 1 ]; then
      [ -f "$journal_proxy_caddyfile_snapshot" ] && [ ! -L "$journal_proxy_caddyfile_snapshot" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$journal_proxy_caddyfile_snapshot")" = '0:0:600:1' ] \
        && [ "$(sha256sum "$journal_proxy_caddyfile_snapshot" | awk '{print $1}')" = "$journal_proxy_caddyfile_sha256" ] \
        || return 1
    fi
    if [ "$journal_proxy_upstream_present" = 1 ]; then
      [ -f "$journal_proxy_upstream_snapshot" ] && [ ! -L "$journal_proxy_upstream_snapshot" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$journal_proxy_upstream_snapshot")" = '0:0:600:1' ] \
        && [ "$(sha256sum "$journal_proxy_upstream_snapshot" | awk '{print $1}')" = "$journal_proxy_upstream_sha256" ] \
        || return 1
    fi
  fi
}

remove_proxy_file_durably() {
  local target=$1
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || return 1
    rm -f -- "$target" || return 1
    fsync_release_artifact "$(dirname -- "$target")" directory || return 1
  fi
}

restore_proxy_files_from_intent() {
  if [ "$journal_proxy_caddyfile_present" = 1 ]; then
    install_recovery_artifact "$journal_proxy_caddyfile_snapshot" "$LIVE_CADDYFILE" root root 0644 || return 1
    [ "$(sha256sum "$LIVE_CADDYFILE" | awk '{print $1}')" = "$journal_proxy_caddyfile_sha256" ] || return 1
  else
    remove_proxy_file_durably "$LIVE_CADDYFILE" || return 1
  fi
  if [ "$journal_proxy_upstream_present" = 1 ]; then
    install_recovery_artifact "$journal_proxy_upstream_snapshot" "$UPSTREAM_FILE" root root 0644 || return 1
    [ "$(sha256sum "$UPSTREAM_FILE" | awk '{print $1}')" = "$journal_proxy_upstream_sha256" ] || return 1
  else
    remove_proxy_file_durably "$UPSTREAM_FILE" || return 1
  fi
}

publish_target_proxy_files_from_intent() {
  local temporary observed_caddy observed_upstream
  observed_caddy=$(sha256sum "$BUNDLE_DIR/Caddyfile" | awk '{print $1}') || return 1
  [ "$observed_caddy" = "$journal_proxy_target_caddy_sha256" ] || return 1
  install_recovery_artifact "$BUNDLE_DIR/Caddyfile" "$LIVE_CADDYFILE" root root 0644 || return 1
  [ "$(sha256sum "$LIVE_CADDYFILE" | awk '{print $1}')" = "$journal_proxy_target_caddy_sha256" ] || return 1
  temporary=$(mktemp "$PROXY_CONFIG_ROOT/upstream/candidate.XXXXXX") || return 1
  if printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' \
      "$journal_proxy_target_slot" > "$temporary" \
    && chown root:root "$temporary" && chmod 0644 "$temporary" \
    && fsync_release_artifact "$temporary" file \
    && [ "$(sha256sum "$temporary" | awk '{print $1}')" = "$journal_proxy_target_upstream_sha256" ] \
    && mv -f -- "$temporary" "$UPSTREAM_FILE" \
    && fsync_release_artifact "$PROXY_CONFIG_ROOT/upstream" directory; then
    observed_upstream=$(sha256sum "$UPSTREAM_FILE" | awk '{print $1}') || return 1
    [ "$observed_upstream" = "$journal_proxy_target_upstream_sha256" ]
    return
  fi
  rm -f -- "$temporary"
  return 1
}

prepared_candidate_internal_live_proof() {
  local port version readiness
  case "$journal_proxy_target_slot" in blue) port=18080 ;; green) port=18081 ;; *) return 1 ;; esac
  version=$(curl --fail --silent --show-error --max-time 10 --noproxy '*' \
    "http://127.0.0.1:$port/api/version" | jq -er '.v') || return 1
  readiness=$(curl --fail --silent --show-error --max-time 10 --noproxy '*' \
    "http://127.0.0.1:$port/readyz") || return 1
  [ "$version" = "${COMMIT_SHA:0:7}" ] \
    && jq -e '.ready == true and .release.candidate == true and
      ((.release.sideEffectsActive == false) or (.release.sideEffectsActive == true))' \
      <<<"$readiness" >/dev/null
}

restore_legacy_generation_from_intent() {
  local container policy proxy_policy
  local -a containers=()
  [ "$journal_proxy_active_before" = legacy ] || return 1
  mapfile -t containers < <(jq -r '.legacyContainers[]' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL")
  [ "${#containers[@]}" -gt 0 ] || return 1
  for container in "${containers[@]}"; do
    policy=$(jq -er --arg container "$container" '.legacyRestartPolicies[$container]' \
      "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
    set_container_restart_policy "$container" "$policy" || return 1
  done
  proxy_policy=$(jq -er '.proxyIntent.legacyProxyRestartPolicy' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  set_container_restart_policy kelion-caddy "$proxy_policy" || return 1
  ensure_containers_running "${containers[@]}" kelion-caddy || return 1
}

retire_legacy_generation_from_deploy_journal() {
  local container
  local -a containers=()
  jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
    .schema == 2 and .requestId == $requestId and .commit == $commit and .activeBefore == "legacy" and
    (.phase == "active-prepared" or .phase == "active-published" or .phase == "gate-prepared" or .phase == "gate-committed") and
    (.legacyContainers | type == "array" and length >= 1 and length <= 3 and
      length == (unique | length) and index("kelionai-app") != null) and
    (.legacyContainers as $containers | (.legacyRestartPolicies | keys | sort) == ($containers | sort))
  ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" >/dev/null || return 1
  mapfile -t containers < <(jq -r '.legacyContainers[]' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL")
  for container in "${containers[@]}"; do retire_container_restart "$container" || return 1; done
}

retire_legacy_proxy_from_deploy_journal() {
  jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
    .schema == 2 and .requestId == $requestId and .commit == $commit and .activeBefore == "legacy" and
    (.phase == "active-prepared" or .phase == "active-published" or .phase == "gate-prepared" or .phase == "gate-committed") and
    (.proxyIntent.legacyProxyRestartPolicy | strings |
      test("^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$"))
  ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" >/dev/null || return 1
  retire_container_restart kelion-caddy
}

restore_old_proxy_intent_before_topology() {
  load_deploy_proxy_intent "$recovered_constructor_quiesce_phase" || return 1
  restore_proxy_files_from_intent || return 1
  export PUBLIC_APP_DOMAIN KELION_PROXY_CONFIG_ROOT=$PROXY_CONFIG_ROOT KELION_PROXY_STATE_ROOT=$PROXY_STATE_ROOT
  if [ "$journal_proxy_active_before" = legacy ]; then
    "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" down >/dev/null || return 1
    restore_legacy_generation_from_intent || return 1
  else
    "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" config --quiet || return 1
    "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" up -d --no-build --wait --wait-timeout 90 || return 1
    docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null || return 1
    docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null || return 1
  fi
  active_release_live_proof 1
}

roll_forward_active_prepared_before_topology() {
  local activated=0
  load_deploy_proxy_intent active-prepared || return 1
  prepared_candidate_internal_live_proof || return 1
  publish_target_proxy_files_from_intent || return 1
  export PUBLIC_APP_DOMAIN KELION_PROXY_CONFIG_ROOT=$PROXY_CONFIG_ROOT KELION_PROXY_STATE_ROOT=$PROXY_STATE_ROOT
  "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" config --quiet || return 1
  if [ "$journal_proxy_active_before" = legacy ]; then
    retire_legacy_proxy_from_deploy_journal || return 1
  fi
  "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" up -d --no-build --wait --wait-timeout 90 || return 1
  docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null || return 1
  docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null || return 1
  prepared_candidate_public_live_proof || candidate_public_live_proof || return 1
  if [ "$journal_proxy_active_before" = legacy ]; then
    retire_legacy_generation_from_deploy_journal || return 1
  fi
  publish_candidate_active_marker || return 1
  recovered_constructor_quiesce_phase=active-published
  for _attempt in $(seq 1 18); do
    if candidate_public_live_proof; then activated=1; break; fi
    sleep 2
  done
  [ "$activated" = 1 ]
}

recover_destructive_pre_ponr_before_topology() {
  local restore_required expected_contract restored_plan restored_contract active_slot_from_recovery container candidate_output=''
  local -a containers=() candidate_containers=()
  [ "$recover_pre_ponr_destructive" = 1 ] || return 0
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] || return 1
  jq -e --arg commit "$COMMIT_SHA" '
    .schema == 1 and .commit == $commit and .pointOfNoReturn == false and
    (.phase == "maintenance" or .phase == "before-migrator" or .phase == "database-migrated" or
      .phase == "restore-in-progress" or .phase == "database-restored" or .phase == "rolled-back") and
    (.dbRestoreRequired | type == "boolean") and
    (.migrationContractBefore | strings | length > 0) and
    (.activeSlot == "legacy" or .activeSlot == "blue" or .activeSlot == "green") and
    (.activeRuntimeContainers | type == "array" and length == (unique | length) and
      all(.[]; type == "string" and test("^[0-9a-f]{12,64}$")))
  ' "$RECOVERY_JOURNAL" >/dev/null || return 1
  active_slot_from_recovery=$(jq -er '.activeSlot' "$RECOVERY_JOURNAL") || return 1
  load_deploy_proxy_intent "$recovered_constructor_quiesce_phase" || return 1
  [ "$active_slot_from_recovery" = "$journal_proxy_active_before" ] || return 1
  candidate_output=$(docker ps -aq \
    --filter 'label=com.kelion.managed=true' --filter "label=com.kelion.slot=$journal_proxy_target_slot") \
    || return 1
  [ -z "$candidate_output" ] || mapfile -t candidate_containers <<<"$candidate_output"
  if [ "${#candidate_containers[@]}" -gt 0 ]; then
    ensure_containers_stopped "${candidate_containers[@]}" || return 1
  fi
  restore_required=$(jq -r '.dbRestoreRequired | if . then "1" else "0" end' "$RECOVERY_JOURNAL") || return 1
  expected_contract=$(jq -er '.migrationContractBefore' "$RECOVERY_JOURNAL") || return 1
  if [ "$restore_required" = 1 ]; then
    [ -f "$PROOF_FILE" ] && [ ! -L "$PROOF_FILE" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$PROOF_FILE")" = '0:0:600:1' ] || return 1
    KELION_RESTORE_APPROVED=1 KELION_PUBLICATION_LOCK_HELD=1 \
      bash "$BUNDLE_DIR/restore-verified-backup.sh" "$PROOF_FILE" || return 1
    restored_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan) \
      || return 1
    restored_contract=$(jq -cS '{kind,risk,pending}' <<<"$restored_plan") || return 1
    [ "$restored_contract" = "$expected_contract" ] || return 1
  fi
  if [ "$active_slot_from_recovery" != legacy ]; then
    mapfile -t containers < <(jq -r '.activeRuntimeContainers[]' "$RECOVERY_JOURNAL")
    [ "${#containers[@]}" -gt 0 ] || return 1
    for container in "${containers[@]}"; do [[ "$container" =~ ^[0-9a-f]{12,64}$ ]] || return 1; done
    ensure_containers_running "${containers[@]}" || return 1
  fi
  restore_old_proxy_intent_before_topology || return 1
  active_release_live_proof 1 || return 1
  mark_existing_recovery_journal_rolled_back || return 1
  migration_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan) \
    || return 1
  jq -e '.kind == "migrations_plan" and (.risk == "safe" or .risk == "destructive") and (.pending | type == "array")' \
    <<<"$migration_plan" >/dev/null || return 1
  pending_count=$(jq -er '.pending | length' <<<"$migration_plan") || return 1
  migration_risk=$(jq -er '.risk' <<<"$migration_plan") || return 1
  migration_contract_before=$(jq -cS '{kind,risk,pending}' <<<"$migration_plan") || return 1
  [ "$migration_contract_before" = "$expected_contract" ] || return 1
  destructive_cutover=0
  if [ "$pending_count" -gt 0 ] && [ "$migration_risk" = destructive ]; then
    destructive_cutover=1
    for tool in node psql pg_restore df stat readlink; do need "$tool"; done
    [[ "$(psql --version)" =~ \(PostgreSQL\)[[:space:]]16\. ]] || return 1
    [[ "$(pg_restore --version)" =~ \(PostgreSQL\)[[:space:]]16\. ]] || return 1
  fi
  if [ "$recovered_constructor_quiesce_phase" = active-prepared ]; then
    pre_ponr_active_prepared_restored=1
  fi
}

# Un crash după switch-ul proxy, dar înainte de marker, lasă topologia publică
# pe candidat și markerul pe generația veche. Reconciliem jurnalul înainte să
# derivăm active_slot/old_marker; altfel validarea topologiei ar bloca exact
# recovery-ul autorizat. Fără dovadă publică exactă rămânem fail-closed.
if [ "$finalize_rolled_back_recovery_only" = 1 ]; then
  finalize_rolled_back_recovery_journal \
    || die 'receiptul rollback-ului pre-PONR nu a putut fi consumat după închiderea quiesce'
  recover_pre_ponr_destructive=0
  finalize_rolled_back_recovery_only=0
fi
recover_destructive_pre_ponr_before_topology \
  || die 'recovery-ul distructiv pre-PONR nu a putut restaura exact DB/runtime/proxy'

if [ "$release_request_state" = started ] \
  && [ "$recovered_constructor_quiesce_phase" = active-prepared ] \
  && [ "$pre_ponr_active_prepared_restored" != 1 ]; then
  roll_forward_active_prepared_before_topology \
    || die 'active-prepared nu a putut reconcilia exact fișierele/proxy-ul/candidatul; Constructor rămâne quiesced'
elif [ -n "$recovered_constructor_quiesce_phase" ] \
  && { [ "$recovered_constructor_quiesce_phase" = armed ] || [ "$recovered_constructor_quiesce_phase" = quiesced ]; }; then
  restore_old_proxy_intent_before_topology \
    || die 'proxy intent pre-switch nu a putut restaura exact generația veche înainte de topologie'
fi

# Capturăm TOT ce trebuie refăcut înainte de prima mutație DB. Primul cutover
# nu are încă proxy-ul managed pe calea publică: `kelion-caddy` rămâne proxy-ul
# real, iar oprirea writerului său produce intenționat 502 fail-closed.
old_upstream=''
old_upstream_present=0
if [ -e "$UPSTREAM_FILE" ] || [ -L "$UPSTREAM_FILE" ]; then
  [ -f "$UPSTREAM_FILE" ] && [ ! -L "$UPSTREAM_FILE" ] \
    || die 'upstreamul activ nu este fișier regulat'
  [ "$(stat -c '%u:%g:%a' "$UPSTREAM_FILE")" = '0:0:644' ] \
    || die 'upstreamul activ are ACL neașteptat'
  old_upstream=$(cat "$UPSTREAM_FILE")
  old_upstream_present=1
fi

managed_proxy_running=0
legacy_proxy_running=0
docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true && managed_proxy_running=1 || true
docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true && legacy_proxy_running=1 || true
case "$managed_proxy_running:$legacy_proxy_running" in
  1:0)
    case "$old_upstream" in
      *app-blue:8080*) active_slot=blue; active_bind_port=18080; inactive_slot=green ;;
      *app-green:8080*) active_slot=green; active_bind_port=18081; inactive_slot=blue ;;
      *) die 'proxy-ul managed rulează fără un upstream activ valid' ;;
    esac
    ;;
  0:1)
    # Fișierul managed poate fi stale după un prim cutover eșuat; proxy-ul care
    # deține efectiv 80/443 este autoritatea pentru starea legacy.
    active_slot=legacy
    active_bind_port=''
    inactive_slot=blue
    ;;
  *) die 'starea proxy-urilor publice este ambiguă: trebuie să ruleze exact unul' ;;
esac

old_marker=$(sed -n '1p' "$RELEASE_STATE_ROOT/active")
[ -n "$old_marker" ] || die 'markerul release activ este gol'
case "$active_slot" in
  blue|green) [[ "$old_marker" =~ ^[0-9a-f]{40}$ ]] || die 'markerul slotului activ nu este SHA integral' ;;
  legacy) [ "$old_marker" = legacy ] || die 'markerul legacy nu corespunde proxy-ului public capturat' ;;
  *) die "slot activ necunoscut: $active_slot" ;;
esac

legacy_runtime_running=()
declare -A legacy_restart_policies=()
legacy_proxy_restart_policy=''
active_runtime_containers=()
active_runtime_output=''
legacy_version_before=''
previous_version_before=''
case "$active_slot" in
  blue|green)
    [ "$managed_proxy_running" = 1 ] || die 'slotul managed este activ fără proxy-ul managed'
    active_runtime_output=$(docker ps -q \
      --filter 'label=com.kelion.managed=true' --filter "label=com.kelion.slot=$active_slot") \
      || die 'containerele slotului activ nu pot fi enumerate'
    [ -z "$active_runtime_output" ] || mapfile -t active_runtime_containers <<<"$active_runtime_output"
    [ "${#active_runtime_containers[@]}" -gt 0 ] || die 'slotul activ nu are containere capturabile'
    managed_version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' \
      "http://127.0.0.1:$active_bind_port/api/version")
    previous_version_before=$(jq -er \
      '.v | select(type == "string" and test("^[0-9a-f]{7,40}$"))' \
      <<<"$managed_version_payload") || die 'versiunea slotului activ nu este JSON valid'
    [ "${old_marker:0:${#previous_version_before}}" = "$previous_version_before" ] \
      || die 'versiunea slotului activ nu corespunde markerului capturat'
    ;;
  legacy)
    [ "$legacy_proxy_running" = 1 ] || die 'runtime-ul legacy este activ fără kelion-caddy'
    for legacy in "${LEGACY_RUNTIME_CONTAINERS[@]}"; do
      legacy_running=$(docker inspect -f '{{.State.Running}}' "$legacy" 2>/dev/null) \
        || die "containerul legacy $legacy nu poate fi capturat"
      case "$legacy_running" in
        true)
          legacy_runtime_running+=("$legacy")
          legacy_restart_policies[$legacy]=$(container_restart_policy "$legacy") \
            || die "restart policy invalid pentru containerul legacy $legacy"
          ;;
        false) ;;
        *) die "containerul legacy $legacy are stare ambiguă" ;;
      esac
    done
    [[ " ${legacy_runtime_running[*]} " == *' kelionai-app '* ]] \
      || die 'writerul legacy kelionai-app nu este capturabil'
    legacy_proxy_restart_policy=$(container_restart_policy kelion-caddy) \
      || die 'restart policy invalid pentru proxy-ul legacy kelion-caddy'
    legacy_version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' \
      http://127.0.0.1:8080/api/version)
    legacy_version_before=$(jq -er '.v | select(type == "string" and test("^[0-9a-f]{7,40}$"))' \
      <<<"$legacy_version_payload") || die 'versiunea legacy nu este JSON valid'
    previous_version_before=$legacy_version_before
    ;;
esac

sync_recovery_path() {
  local path=$1 mode=$2
  python3 - "$path" "$mode" <<'PY'
import os
import sys

path, mode = sys.argv[1:]
if mode == 'file':
    with open(path, 'rb') as handle:
        os.fsync(handle.fileno())
    raise SystemExit(0)
if mode == 'dir-self':
    directory = path
elif mode == 'parent':
    directory = os.path.dirname(path)
else:
    raise SystemExit(2)
flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0)
fd = os.open(directory, flags)
try:
    os.fsync(fd)
finally:
    os.close(fd)
PY
}

# Acest snapshot este ultima operație de capture și nu este urmat de nicio
# validare care ar putea ieși înainte de armarea trap-ului de recovery.
previous_caddyfile_present=0
previous_caddyfile_snapshot=''
previous_caddyfile_sha256=absent
previous_upstream_snapshot=''
previous_upstream_sha256=absent
target_caddyfile_sha256=$(sha256sum "$BUNDLE_DIR/Caddyfile" | awk '{print $1}') \
  || die 'hashul Caddyfile candidat nu poate fi calculat'
target_upstream_sha256=$(printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' "$inactive_slot" \
  | sha256sum | awk '{print $1}') || die 'hashul upstream candidat nu poate fi calculat'
[[ "$target_caddyfile_sha256" =~ ^[0-9a-f]{64}$ ]] \
  && [[ "$target_upstream_sha256" =~ ^[0-9a-f]{64}$ ]] \
  || die 'hashurile proxy candidat sunt invalide'
if [ -e "$LIVE_CADDYFILE" ] || [ -L "$LIVE_CADDYFILE" ]; then
  [ -f "$LIVE_CADDYFILE" ] && [ ! -L "$LIVE_CADDYFILE" ] \
    || die 'Caddyfile-ul live nu este fișier regulat'
  [ "$(stat -c '%u:%g:%a' "$LIVE_CADDYFILE")" = '0:0:644' ] \
    || die 'Caddyfile-ul live are ACL neașteptat'
  previous_caddyfile_snapshot=$(mktemp "$RUNTIME_ROOT/caddyfile-rollback.XXXXXX") \
    || die 'snapshotul Caddyfile nu poate fi creat'
  if ! install -o root -g root -m 0600 "$LIVE_CADDYFILE" "$previous_caddyfile_snapshot" \
    || ! cmp -s "$LIVE_CADDYFILE" "$previous_caddyfile_snapshot" \
    || ! sync_recovery_path "$previous_caddyfile_snapshot" file \
    || ! sync_recovery_path "$previous_caddyfile_snapshot" parent; then
    rm -f -- "$previous_caddyfile_snapshot"
    die 'Caddyfile-ul live nu poate fi capturat exact'
  fi
  previous_caddyfile_present=1
  previous_caddyfile_sha256=$(sha256sum "$previous_caddyfile_snapshot" | awk '{print $1}') \
    || die 'hashul snapshotului Caddyfile nu poate fi calculat'
fi
if [ "$active_slot" != legacy ] && [ "$previous_caddyfile_present" != 1 ]; then
  die 'proxy-ul managed nu are Caddyfile recuperabil'
fi
if [ "$old_upstream_present" = 1 ]; then
  previous_upstream_snapshot=$(mktemp "$RUNTIME_ROOT/upstream-rollback.XXXXXX") \
    || die 'snapshotul upstream nu poate fi creat'
  if ! install -o root -g root -m 0600 "$UPSTREAM_FILE" "$previous_upstream_snapshot" \
    || ! cmp -s "$UPSTREAM_FILE" "$previous_upstream_snapshot" \
    || ! sync_recovery_path "$previous_upstream_snapshot" file \
    || ! sync_recovery_path "$previous_upstream_snapshot" parent; then
    rm -f -- "$previous_upstream_snapshot"
    die 'upstreamul live nu poate fi capturat exact'
  fi
  previous_upstream_sha256=$(sha256sum "$previous_upstream_snapshot" | awk '{print $1}') \
    || die 'hashul snapshotului upstream nu poate fi calculat'
fi
[[ "$previous_caddyfile_sha256" = absent || "$previous_caddyfile_sha256" =~ ^[0-9a-f]{64}$ ]] \
  && [[ "$previous_upstream_sha256" = absent || "$previous_upstream_sha256" =~ ^[0-9a-f]{64}$ ]] \
  || die 'hashurile snapshoturilor proxy sunt invalide'

active_runtime_stopped=0
db_restore_required=0
database_restore_verified=0
destructive_migration_attempted=0
point_of_no_return=0
recovery_armed=0
if [ "$resume_destructive_recovery" = 1 ]; then point_of_no_return=1; fi

write_recovery_journal() {
  local phase=$1 ponr=$2 restore_required=$3 temporary
  local ponr_json=false restore_json=false active_runtime_json='[]' legacy_runtime_json='[]'
  case "$phase" in
    maintenance|before-migrator|database-migrated|restore-in-progress|database-restored|point-of-no-return|rolled-back|completed) ;;
    *) return 1 ;;
  esac
  case "$ponr:$restore_required" in
    0:0|0:1|1:0|1:1) ;;
    *) return 1 ;;
  esac
  [ "$ponr" = 0 ] || ponr_json=true
  [ "$restore_required" = 0 ] || restore_json=true
  if [ "${#active_runtime_containers[@]}" -gt 0 ]; then
    active_runtime_json=$(printf '%s\n' "${active_runtime_containers[@]}" | jq -Rsc 'split("\n")[:-1]') \
      || return 1
  fi
  if [ "${#legacy_runtime_running[@]}" -gt 0 ]; then
    legacy_runtime_json=$(printf '%s\n' "${legacy_runtime_running[@]}" | jq -Rsc 'split("\n")[:-1]') \
      || return 1
  fi
  temporary=$(mktemp "$RUNTIME_ROOT/destructive-cutover-recovery.XXXXXX") || return 1
  if ! jq -n \
    --arg commit "$COMMIT_SHA" \
    --arg phase "$phase" \
    --arg activeSlot "$active_slot" \
    --arg inactiveSlot "$inactive_slot" \
    --arg oldMarker "$old_marker" \
    --arg previousVersion "$previous_version_before" \
    --arg migrationContractBefore "$migration_contract_before" \
    --arg caddyfileSnapshot "$previous_caddyfile_snapshot" \
    --arg oldUpstream "$old_upstream" \
    --argjson pointOfNoReturn "$ponr_json" \
    --argjson dbRestoreRequired "$restore_json" \
    --argjson oldUpstreamPresent "$old_upstream_present" \
    --argjson activeRuntimeContainers "$active_runtime_json" \
    --argjson legacyRuntimeContainers "$legacy_runtime_json" \
    '{schema:1,commit:$commit,phase:$phase,pointOfNoReturn:$pointOfNoReturn,
      dbRestoreRequired:$dbRestoreRequired,activeSlot:$activeSlot,inactiveSlot:$inactiveSlot,
      oldMarker:$oldMarker,previousVersion:$previousVersion,
      migrationContractBefore:$migrationContractBefore,
      activeRuntimeContainers:$activeRuntimeContainers,
      legacyRuntimeContainers:$legacyRuntimeContainers,
      oldUpstreamPresent:($oldUpstreamPresent == 1),oldUpstream:$oldUpstream,
      caddyfileSnapshot:$caddyfileSnapshot,updatedAt:(now|todateiso8601)}' > "$temporary" \
    || ! chown root:root "$temporary" \
    || ! chmod 0600 "$temporary" \
    || ! mv -f -- "$temporary" "$RECOVERY_JOURNAL" \
    || ! sync_recovery_path "$RECOVERY_JOURNAL" file \
    || ! sync_recovery_path "$RECOVERY_JOURNAL" parent; then
    rm -f -- "$temporary"
    return 1
  fi
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] \
    || return 1
}

clear_recovery_journal() {
  [ -e "$RECOVERY_JOURNAL" ] || [ -L "$RECOVERY_JOURNAL" ] || return 0
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] \
    || return 1
  rm -f -- "$RECOVERY_JOURNAL" || return 1
  sync_recovery_path "$RECOVERY_JOURNAL" parent
}

mark_point_of_no_return() {
  [ "$destructive_cutover" = 1 ] || return 0
  # RAM-ul devine conservator înainte de operația întreruptibilă de persistare:
  # un semnal între assignment și fsync nu poate porni rollback-ul vechi. Jurnalul
  # este apoi durabil înainte ca proxy-ul să poată accepta trafic.
  point_of_no_return=1
  write_recovery_journal point-of-no-return 1 "$db_restore_required" || return 1
}

restore_release_marker() {
  local temporary
  temporary=$(mktemp "$RELEASE_STATE_ROOT/rollback.XXXXXX") || return 1
  if printf '%s\n' "$old_marker" > "$temporary" \
    && chown root:10050 "$temporary" \
    && chmod 0640 "$temporary" \
    && fsync_release_artifact "$temporary" file \
    && mv -f -- "$temporary" "$RELEASE_STATE_ROOT/active" \
    && fsync_release_artifact "$RELEASE_STATE_ROOT" directory; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

cleanup_caddyfile_snapshot() {
  local candidate
  for candidate in "$previous_caddyfile_snapshot" "$previous_upstream_snapshot" \
    "$journal_proxy_caddyfile_snapshot" "$journal_proxy_upstream_snapshot"; do
    [ -n "$candidate" ] || continue
    [[ "$candidate" =~ ^/root/kelion/runtime/(caddyfile|upstream)-rollback\.[A-Za-z0-9]+$ ]] || return 1
    if [ -e "$candidate" ] || [ -L "$candidate" ]; then
      [ -f "$candidate" ] && [ ! -L "$candidate" ] || return 1
      [ "$(realpath -e -- "$candidate")" = "$candidate" ] || return 1
      rm -f -- "$candidate" || return 1
    fi
  done
  fsync_release_artifact "$RUNTIME_ROOT" directory || return 1
  previous_caddyfile_snapshot=''
  previous_upstream_snapshot=''
  journal_proxy_caddyfile_snapshot=''
  journal_proxy_upstream_snapshot=''
}

restore_caddyfile_snapshot() {
  local temporary=''
  if [ "$previous_caddyfile_present" = 1 ]; then
    [ -f "$previous_caddyfile_snapshot" ] && [ ! -L "$previous_caddyfile_snapshot" ] \
      || return 1
    [ "$(stat -c '%u:%g:%a' "$previous_caddyfile_snapshot")" = '0:0:600' ] \
      || return 1
    temporary=$(mktemp "$PROXY_CONFIG_ROOT/Caddyfile.rollback.XXXXXX") || return 1
    if ! install -o root -g root -m 0644 "$previous_caddyfile_snapshot" "$temporary" \
      || ! sync_recovery_path "$temporary" file; then
      rm -f -- "$temporary"
      return 1
    fi
    mv -f -- "$temporary" "$LIVE_CADDYFILE" || return 1
    sync_recovery_path "$LIVE_CADDYFILE" parent || return 1
    [ "$(stat -c '%u:%g:%a' "$LIVE_CADDYFILE")" = '0:0:644' ] || return 1
    cmp -s "$previous_caddyfile_snapshot" "$LIVE_CADDYFILE" || return 1
  else
    [ ! -L "$LIVE_CADDYFILE" ] || return 1
    rm -f -- "$LIVE_CADDYFILE" || return 1
    sync_recovery_path "$LIVE_CADDYFILE" parent || return 1
    [ ! -e "$LIVE_CADDYFILE" ] && [ ! -L "$LIVE_CADDYFILE" ] || return 1
  fi
}

restore_upstream_snapshot() {
  local temporary=''
  if [ "$old_upstream_present" = 1 ]; then
    [ -f "$previous_upstream_snapshot" ] && [ ! -L "$previous_upstream_snapshot" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$previous_upstream_snapshot")" = '0:0:600:1' ] \
      && [ "$(sha256sum "$previous_upstream_snapshot" | awk '{print $1}')" = "$previous_upstream_sha256" ] \
      || return 1
    temporary=$(mktemp "$PROXY_CONFIG_ROOT/upstream/rollback.XXXXXX") || return 1
    if ! install -o root -g root -m 0644 "$previous_upstream_snapshot" "$temporary" \
      || ! sync_recovery_path "$temporary" file; then
      rm -f -- "$temporary"
      return 1
    fi
    if ! mv -f -- "$temporary" "$UPSTREAM_FILE"; then
      rm -f -- "$temporary"
      return 1
    fi
    sync_recovery_path "$UPSTREAM_FILE" parent || return 1
    [ "$(stat -c '%u:%g:%a' "$UPSTREAM_FILE")" = '0:0:644' ] || return 1
  else
    [ ! -L "$UPSTREAM_FILE" ] || return 1
    rm -f -- "$UPSTREAM_FILE" || return 1
    sync_recovery_path "$UPSTREAM_FILE" parent || return 1
    [ ! -e "$UPSTREAM_FILE" ] && [ ! -L "$UPSTREAM_FILE" ] || return 1
  fi
}

verify_database_contract() {
  local restored_plan restored_contract
  restored_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan) \
    || return 1
  jq -e '.kind == "migrations_plan" and (.risk == "safe" or .risk == "destructive") and (.pending | type == "array")' \
    <<<"$restored_plan" >/dev/null || return 1
  restored_contract=$(jq -cS '{kind,risk,pending}' <<<"$restored_plan") || return 1
  [ "$restored_contract" = "$migration_contract_before" ]
}

enter_destructive_maintenance() {
  local temporary maintenance_status
  case "$active_slot" in
    blue|green)
      temporary=$(mktemp "$PROXY_CONFIG_ROOT/upstream/maintenance.XXXXXX") || return 1
      printf 'respond "Service temporarily unavailable" 503\n' > "$temporary"
      chmod 0644 "$temporary" || return 1
      sync_recovery_path "$temporary" file || return 1
      mv "$temporary" "$UPSTREAM_FILE" || return 1
      sync_recovery_path "$UPSTREAM_FILE" parent || return 1
      docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null || return 1
      docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null || return 1
      maintenance_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
        --max-time 10 --noproxy '*' http://127.0.0.1:18079/ || true)
      [ "$maintenance_status" = 503 ] || return 1
      ;;
    legacy)
      # kelion-caddy este încă proxy-ul public și nu importă UPSTREAM_FILE.
      # Oprirea runtime-ului imediat după această funcție este maintenance-ul
      # fail-closed real (502), fără a porni prematur kelion-proxy.
      [ "$legacy_proxy_running" = 1 ] || return 1
      ;;
    *) return 1 ;;
  esac
}

stop_active_runtime() {
  [ "$active_runtime_stopped" = 0 ] || return 0
  active_runtime_stopped=1
  case "$active_slot" in
    blue|green)
      ensure_containers_stopped "${active_runtime_containers[@]}" || return 1
      ;;
    legacy)
      ensure_containers_stopped "${legacy_runtime_running[@]}" || return 1
      ;;
    *) return 1 ;;
  esac
}

verify_destructive_maintenance() {
  local maintenance_status
  case "$active_slot" in
    blue|green)
      # enter_destructive_maintenance a verificat deja 503 pe control-plane.
      return 0
      ;;
    legacy)
      # kelion-caddy rămâne proxy-ul public. Cu writerul legacy oprit trebuie să
      # răspundă 502 real, nu un 200 din fallback-ul SPA.
      maintenance_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
        --max-time 10 --noproxy '*' --resolve "$PUBLIC_APP_DOMAIN:443:127.0.0.1" \
        "https://$PUBLIC_APP_DOMAIN/api/version" || true)
      [ "$maintenance_status" = 502 ]
      ;;
    *) return 1 ;;
  esac
}

stop_candidate_runtime() {
  local output=''
  local -a containers=()
  output=$(docker ps -aq \
    --filter 'label=com.kelion.managed=true' --filter "label=com.kelion.slot=$inactive_slot") \
    || return 1
  [ -z "$output" ] || mapfile -t containers <<<"$output"
  if [ "${#containers[@]}" -gt 0 ]; then
    ensure_containers_stopped "${containers[@]}" || return 1
  fi
}

stop_legacy_runtime_from_deploy_journal() {
  retire_legacy_generation_from_deploy_journal || return 1
  retire_legacy_proxy_from_deploy_journal
}

restore_database_if_required() {
  [ "$db_restore_required" = 1 ] || return 0
  [ "$point_of_no_return" = 0 ] || {
    printf 'release: point-of-no-return depășit; restore-ul automat ar putea pierde scrieri\n' >&2
    return 1
  }
  write_recovery_journal restore-in-progress 0 1 || return 1
  KELION_RESTORE_APPROVED=1 KELION_PUBLICATION_LOCK_HELD=1 \
    bash "$BUNDLE_DIR/restore-verified-backup.sh" "$PROOF_FILE" \
    || return 1
  verify_database_contract || return 1
  database_restore_verified=1
  db_restore_required=0
  write_recovery_journal database-restored 0 0 || return 1
}

preflight_database_restore() {
  KELION_RESTORE_APPROVED=1 KELION_PUBLICATION_LOCK_HELD=1 \
    bash "$BUNDLE_DIR/restore-verified-backup.sh" --preflight "$PROOF_FILE"
}

restart_previous_slot() {
  local rollback_ready=''
  [ "$db_restore_required" = 0 ] || return 1
  if [ "$destructive_migration_attempted" = 1 ]; then
    [ "$database_restore_verified" = 1 ] || return 1
    verify_database_contract || return 1
  fi
  [ "${#active_runtime_containers[@]}" -gt 0 ] || return 1
  restore_release_marker || return 1
  ensure_containers_running "${active_runtime_containers[@]}" || return 1
  for _attempt in $(seq 1 45); do
    rollback_ready=$(curl --fail --silent --show-error --max-time 10 \
      "http://127.0.0.1:$active_bind_port/readyz" || true)
    if jq -e '.ready == true and .release.sideEffectsActive == true' \
      <<<"$rollback_ready" >/dev/null 2>&1; then
      active_runtime_stopped=0
      return 0
    fi
    sleep 2
  done
  return 1
}

restart_legacy_runtime() {
  local consecutive=0 version_payload='' container policy
  [ "$db_restore_required" = 0 ] || return 1
  if [ "$destructive_migration_attempted" = 1 ]; then
    [ "$database_restore_verified" = 1 ] || return 1
    verify_database_contract || return 1
  fi
  [ "${#legacy_runtime_running[@]}" -gt 0 ] || return 1
  restore_release_marker || return 1
  for container in "${legacy_runtime_running[@]}"; do
    policy=${legacy_restart_policies[$container]:-}
    [ -n "$policy" ] && set_container_restart_policy "$container" "$policy" || return 1
  done
  ensure_containers_running "${legacy_runtime_running[@]}" || return 1

  # Legacy nu are /livez sau /readyz: răspunsurile 200 erau fallback-ul SPA.
  # Cerem JSON-ul /api/version exact și contractul DB verificat mai sus, de trei ori.
  for _attempt in $(seq 1 30); do
    version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' \
      http://127.0.0.1:8080/api/version || true)
    if jq -e --arg expected "$legacy_version_before" \
      '.v == $expected and (.v | type == "string")' <<<"$version_payload" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
      if [ "$consecutive" -ge 3 ]; then
        active_runtime_stopped=0
        return 0
      fi
    else
      consecutive=0
    fi
    sleep 2
  done
  return 1
}

verify_public_previous_version() {
  local consecutive=0 version_payload=''
  [ -n "$previous_version_before" ] || return 1
  for _attempt in $(seq 1 30); do
    version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' --resolve "$PUBLIC_APP_DOMAIN:443:127.0.0.1" \
      "https://$PUBLIC_APP_DOMAIN/api/version" || true)
    if jq -e --arg expected "$previous_version_before" \
      '.v == $expected and (.v | type == "string")' <<<"$version_payload" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
      [ "$consecutive" -lt 3 ] || return 0
    else
      consecutive=0
    fi
    sleep 2
  done
  return 1
}

restore_proxy_after_rollback() {
  restore_caddyfile_snapshot || return 1
  restore_upstream_snapshot || return 1
  case "$active_slot" in
    blue|green)
      [ "$old_upstream_present" = 1 ] && [ -n "$old_upstream" ] || return 1
      docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null || return 1
      docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null || return 1
      ;;
    legacy)
      if docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true; then
        "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" down >/dev/null || return 1
      fi
      [ "$legacy_proxy_running" = 1 ] || return 1
      [ -n "$legacy_proxy_restart_policy" ] \
        && set_container_restart_policy kelion-caddy "$legacy_proxy_restart_policy" || return 1
      ensure_containers_running kelion-caddy || return 1
      docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true || return 1
      ;;
    *) return 1 ;;
  esac
  # Starea Docker `Running` și probele directe nu dovedesc TLS/rutarea publică.
  # Dezarmăm recovery-ul numai după trei răspunsuri JSON cu versiunea capturată.
  verify_public_previous_version
}

rollback_switch() {
  local rollback_failed=0 runtime_ready=0
  [ "$recovery_armed" = 1 ] || return 0
  [ "$point_of_no_return" = 0 ] || return 1

  # Ordine de fier: niciun writer candidat în timpul restore-ului; DB întâi;
  # abia apoi runtime-ul vechi și proxy-ul public.
  if ! stop_candidate_runtime; then
    printf 'release: recovery a refuzat restore-ul cât candidatul poate scrie\n' >&2
    return 1
  fi
  if ! restore_database_if_required; then
    printf 'release: backupul verificat nu a putut restaura și schimba baza\n' >&2
    return 1
  fi
  if ! rollback_backup_schedule; then
    printf 'release: rollback-ul nu poate restaura schedulerul de backup\n' >&2
    rollback_failed=1
  elif ! cleanup_backup_schedule_snapshot; then
    printf 'release: snapshotul schedulerului de backup nu poate fi curățat\n' >&2
    rollback_failed=1
  fi

  if [ "$active_slot" = blue ] || [ "$active_slot" = green ]; then
    # Markerul poate dezactiva singur runtime-ul vechi înainte ca shell-ul să-l
    # marcheze oprit. Îl restaurăm și îl verificăm întotdeauna, idempotent.
    if restart_previous_slot; then runtime_ready=1; else rollback_failed=1; fi
  else
    # Și primul cutover trebuie să refacă markerul `legacy` chiar dacă procesele
    # vechi nu au fost încă oprite. Helperul de start acceptă starea running.
    if restart_legacy_runtime; then runtime_ready=1; else rollback_failed=1; fi
  fi
  if [ "$runtime_ready" = 1 ]; then
    restore_proxy_after_rollback || rollback_failed=1
  fi
  [ "$rollback_failed" = 0 ] || return 1
  if [ "$destructive_cutover" = 1 ]; then
    write_recovery_journal rolled-back 0 0 || return 1
  fi
  recovery_armed=0
}

recover_schedule_after_point_of_no_return() {
  # Schedulerul nu poate produce write-uri în aplicație și are propriul snapshot;
  # îl putem repara fără să atingem candidatul, DB-ul, runtime-ul sau proxy-ul.
  if ! rollback_backup_schedule; then
    printf 'release: schedulerul de backup nu a putut fi restaurat după point-of-no-return\n' >&2
    return 1
  fi
  cleanup_backup_schedule_snapshot
}

constructor_release_timers=(
  kelion-codex-worker.timer
  kelion-constructor-publisher.timer
  kelion-constructor-release.timer
)
constructor_release_services=(
  kelion-codex-worker.service
  kelion-constructor-publisher.service
  kelion-constructor-release.service
)
constructor_release_auxiliary_services=(
  kelion-constructor-sync.service
)
constructor_release_markers=(
  /etc/kelion/codex-worker.enabled
  /etc/kelion/constructor-publisher.enabled
  /etc/kelion/constructor-release.enabled
)
constructor_release_configs=(
  /root/kelion/config/codex-worker.env
  /root/kelion/config/constructor-publisher.env
  /root/kelion/config/constructor-release.env
)
constructor_release_exec_flags=(
  CODEX_WORKER_EXEC_ENABLED
  CONSTRUCTOR_PUBLISHER_EXEC_ENABLED
  CONSTRUCTOR_RELEASE_EXEC_ENABLED
)
constructor_release_quiesced=0
constructor_release_unit_count=0
gate_matches_active_release=1
release_cutover_committed=0

force_quiesce_constructor_release() {
  local unit state failed=0 ready_root=/run/kelion ready_stamp=/run/kelion/runtime-config-recovery.ready
  constructor_release_quiesced=1
  if [ -e "$ready_root" ] || [ -L "$ready_root" ]; then
    [ -d "$ready_root" ] && [ ! -L "$ready_root" ] \
      && [ "$(stat -c '%u:%g:%a' "$ready_root")" = '0:0:755' ] || return 1
    if [ -e "$ready_stamp" ] || [ -L "$ready_stamp" ]; then
      [ -f "$ready_stamp" ] && [ ! -L "$ready_stamp" ] \
        && [ "$(stat -c '%u:%g:%a' "$ready_stamp")" = '0:0:444' ] || return 1
      rm -f -- "$ready_stamp" || return 1
      fsync_release_artifact "$ready_root" directory || return 1
    fi
  fi
  for unit in "${constructor_release_timers[@]}"; do systemctl disable --now "$unit" >/dev/null || failed=1; done
  for unit in "${constructor_release_services[@]}"; do systemctl disable --now "$unit" >/dev/null || failed=1; done
  for unit in "${constructor_release_auxiliary_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    systemctl stop "$unit" >/dev/null || failed=1
  done
  for unit in "${constructor_release_timers[@]}" "${constructor_release_services[@]}" "${constructor_release_auxiliary_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    state=$(systemctl show "$unit" --property=ActiveState --value) || { failed=1; continue; }
    case "$state" in inactive|failed) ;; *) failed=1 ;; esac
    if [ -n "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ]; then failed=1; fi
  done
  [ "$failed" = 0 ]
}

quiesce_constructor_before_candidate() {
  local config_count=0 marker_count=0 unit_count=0 path unit state index
  for path in "${constructor_release_configs[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:640' ] \
        || return 1
      config_count=$((config_count + 1))
    fi
  done
  case "$config_count" in 0|3) ;; *) return 1 ;; esac
  for path in "${constructor_release_markers[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
        || return 1
      [ "$config_count" = 3 ] || return 1
      marker_count=$((marker_count + 1))
    fi
  done
  if [ -f "${constructor_release_markers[2]}" ]; then
    [ -f "${constructor_release_markers[0]}" ] && [ -f "${constructor_release_markers[1]}" ] || return 1
  fi
  if [ -f "${constructor_release_markers[1]}" ]; then
    [ -f "${constructor_release_markers[0]}" ] || return 1
  fi
  local -a flags=(CODEX_WORKER_ENABLED CONSTRUCTOR_PUBLISHER_ENABLED CONSTRUCTOR_RELEASE_ENABLED)
  for index in "${!constructor_release_markers[@]}"; do
    if [ -f "${constructor_release_markers[$index]}" ]; then
      [ "$(config_value "${flags[$index]}")" = 1 ] || return 1
      [ "$(grep -c "^${constructor_release_exec_flags[$index]}=1$" "${constructor_release_configs[$index]}")" -eq 1 ] \
        || return 1
    fi
  done
  for unit in "${constructor_release_timers[@]}" "${constructor_release_services[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then unit_count=$((unit_count + 1)); fi
  done
  case "$unit_count" in
    0)
      [ "$config_count" = 0 ] && [ "$marker_count" = 0 ] || return 1
      constructor_release_unit_count=0
      constructor_release_quiesced=1
      ;;
    6) constructor_release_unit_count=6 ;;
    *) return 1 ;;
  esac
  # Oprirea efectivă este delegată helperului jurnalizat din upgrade; aici
  # validăm numai inventarul și armăm cleanup-ul release-ului.
  constructor_release_quiesced=1
}

upgrade_constructor_timer_units_quiesced() (
  set -euo pipefail
  local unit stage verify_help fragment dropins load_state need_reload
  # Helperul owner retrage+fsync stamp-ul înainte de primul stop și oprește
  # inclusiv sync. Contractul poate fi încă legacy până publicăm candidatul.
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 \
    KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$KELION_RELEASE_REQUEST_ID" \
    KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$COMMIT_SHA" \
    "$ROOT/bin/runtime-config-cutover.sh" \
    --recover-only "$ROOT/config/compose.production.yml" --leave-constructor-quiesced
  exec 9>&-
  [ "$constructor_release_unit_count" = 6 ] || return 0
  verify_help=$(systemd-analyze verify --help 2>&1)
  grep -q -- '--recursive-errors=' <<<"$verify_help"
  systemd-analyze verify --recursive-errors=yes \
    "$BUNDLE_DIR/systemd/kelion-runtime-config-recovery.service" \
    "$BUNDLE_DIR/systemd/kelion-constructor-sync.service" \
    "$BUNDLE_DIR/systemd/kelion-codex-worker.timer" \
    "$BUNDLE_DIR/systemd/kelion-constructor-publisher.timer" \
    "$BUNDLE_DIR/systemd/kelion-constructor-release.timer" \
    "$BUNDLE_DIR/systemd/kelion-codex-worker.service" \
    "$BUNDLE_DIR/systemd/kelion-constructor-publisher.service" \
    "$BUNDLE_DIR/systemd/kelion-constructor-release.service" >/dev/null
  install_recovery_artifact "$BUNDLE_DIR/systemd/kelion-constructor-sync.service" \
    "$SYSTEMD_UNIT_ROOT/kelion-constructor-sync.service" root root 0444
  systemctl daemon-reload
  for unit in kelion-runtime-config-recovery.service kelion-constructor-sync.service; do
    fragment=$(systemctl show "$unit" --property=FragmentPath --value)
    dropins=$(systemctl show "$unit" --property=DropInPaths --value)
    load_state=$(systemctl show "$unit" --property=LoadState --value)
    need_reload=$(systemctl show "$unit" --property=NeedDaemonReload --value)
    [ "$fragment" = "$SYSTEMD_UNIT_ROOT/$unit" ] \
      && [ -z "$dropins" ] && [ "$load_state" = loaded ] && [ "$need_reload" = no ]
  done
  stage=$(mktemp -d "$RUNTIME_ROOT/runtime-cutover.XXXXXX")
  chown root:root "$stage"; chmod 0700 "$stage"
  install -d -o root -g root -m 0700 "$stage/files"
  : > "$stage/manifest"; chown root:root "$stage/manifest"; chmod 0600 "$stage/manifest"
  for unit in "${constructor_release_timers[@]}"; do
    install -o root -g root -m 0600 "$BUNDLE_DIR/systemd/$unit" "$stage/files/systemd-timer.$unit"
    printf '%s\n' "systemd-timer.$unit" >> "$stage/manifest"
  done
  for unit in "${constructor_release_services[@]}"; do
    install -o root -g root -m 0600 "$BUNDLE_DIR/systemd/$unit" "$stage/files/systemd-service.$unit"
    printf '%s\n' "systemd-service.$unit" >> "$stage/manifest"
  done
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 \
    KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$KELION_RELEASE_REQUEST_ID" \
    KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$COMMIT_SHA" \
    "$ROOT/bin/runtime-config-cutover.sh" \
    "$stage" "$ROOT/config/compose.production.yml" --leave-constructor-quiesced
  exec 9>&-
)

constructor_deploy_quiesce_snapshot_matches_previous() {
  local active_before expected actual index path phase
  local -a keys=(worker publisher release)
  [ -f "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL")" = '0:0:600:1' ] || return 1
  jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
    .schema == 2 and .requestId == $requestId and .commit == $commit and
    (.phase == "armed" or .phase == "quiesced" or .phase == "active-prepared" or .phase == "active-published" or .phase == "gate-prepared" or .phase == "gate-committed") and
    (.activeBefore | strings | test("^([0-9a-f]{40}|legacy)$")) and
    (.activeVersionBefore | strings | test("^[0-9a-f]{7,40}$")) and
    (.activeBefore as $activeBefore | .activeVersionBefore as $activeVersionBefore |
      if $activeBefore == "legacy" then true
      else ($activeBefore | startswith($activeVersionBefore)) end) and
    (.legacyContainers | type == "array" and length <= 3 and length == (unique | length) and
      all(.[]; . == "kelionai-app" or . == "omniroute" or . == "kelionai-coqui")) and
    (if .activeBefore == "legacy" then
      (.legacyContainers | length >= 1 and index("kelionai-app") != null)
    else (.legacyContainers | length == 0) end) and
    ([.gateSha256.worker,.gateSha256.publisher,.gateSha256.release] |
      (all(.[]; type == "string" and test("^[0-9a-f]{64}$")) or all(.[]; . == "absent")))
  ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" >/dev/null || return 1
  phase=$(jq -er '.phase' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  load_deploy_proxy_intent "$phase" || return 1
  active_before=$(jq -er '.activeBefore' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
  [ -f "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RELEASE_STATE_ROOT/active")" = '0:10050:640:1' ] \
    && [ "$(wc -l < "$RELEASE_STATE_ROOT/active")" -eq 1 ] \
    && grep -qx "$active_before" "$RELEASE_STATE_ROOT/active" || return 1
  for index in "${!constructor_release_configs[@]}"; do
    path=${constructor_release_configs[$index]}
    expected=$(jq -er --arg key "${keys[$index]}" '.gateSha256[$key]' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
    if [ "$expected" = absent ]; then
      [ ! -e "$path" ] && [ ! -L "$path" ] || return 1
    else
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -Lc '%u:%g:%a:%h' "$path")" = '0:0:640:1' ] || return 1
      actual=$(sha256sum "$path" | awk '{print $1}') || return 1
      [ "$actual" = "$expected" ] || return 1
    fi
  done
}

constructor_deploy_quiesce_restore_proof() {
  local phase
  constructor_deploy_quiesce_snapshot_matches_previous && return 0
  phase=$(jq -er --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
    select(.schema == 2 and .requestId == $requestId and .commit == $commit and .phase == "gate-committed") | .phase
  ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" 2>/dev/null) || return 1
  [ "$phase" = gate-committed ] && constructor_gate_matches_candidate
}

constructor_deploy_gate_hashes_match() {
  local field=$1 expected actual index path
  local -a keys=(worker publisher release)
  [[ "$field" = gateSha256 || "$field" = targetGateSha256 ]] || return 1
  [ -f "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL")" = '0:0:600:1' ] \
    || return 1
  jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" --arg field "$field" '
    .schema == 2 and .requestId == $requestId and .commit == $commit and
    (.phase == "gate-prepared" or .phase == "gate-committed") and
    (.[ $field ] | type == "object") and
    (if $field == "targetGateSha256" then
      ([.[ $field ].worker,.[ $field ].publisher,.[ $field ].release] |
        (all(.[]; type == "string" and test("^[0-9a-f]{64}$")) or all(.[]; . == "absent")))
    else
      ([.[ $field ].worker,.[ $field ].publisher,.[ $field ].release] |
        (all(.[]; type == "string" and test("^[0-9a-f]{64}$")) or all(.[]; . == "absent")))
    end)
  ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" >/dev/null || return 1
  for index in "${!constructor_release_configs[@]}"; do
    path=${constructor_release_configs[$index]}
    expected=$(jq -er --arg field "$field" --arg key "${keys[$index]}" '.[ $field ][ $key ]' \
      "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL") || return 1
    if [ "$expected" = absent ]; then
      [ ! -e "$path" ] && [ ! -L "$path" ] || return 1
    else
      [ -f "$path" ] && [ ! -L "$path" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$path")" = '0:0:640:1' ] || return 1
      actual=$(sha256sum "$path" | awk '{print $1}') || return 1
      [ "$actual" = "$expected" ] || return 1
    fi
  done
}

classify_gate_prepared_failure() {
  local phase active_commit
  phase=$(jq -er --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
    select(.schema == 2 and .requestId == $requestId and .commit == $commit and
      (.phase == "gate-prepared" or
        (.phase == "gate-committed" and .committedGateSha256 == .targetGateSha256))) | .phase
  ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" 2>/dev/null) || return 0
  [[ "$phase" = gate-prepared || "$phase" = gate-committed ]] || return 0
  [ -f "$RELEASE_STATE_ROOT/active" ] && [ ! -L "$RELEASE_STATE_ROOT/active" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RELEASE_STATE_ROOT/active")" = '0:10050:640:1' ] \
    && [ "$(wc -l < "$RELEASE_STATE_ROOT/active")" -eq 1 ] || {
      release_rollforward_only=1
      gate_matches_active_release=0
      return 0
    }
  active_commit=$(sed -n '1p' "$RELEASE_STATE_ROOT/active") || return 1
  if [ "$active_commit" = "$COMMIT_SHA" ] \
    && constructor_deploy_gate_hashes_match targetGateSha256; then
    release_rollforward_only=1
    gate_matches_active_release=1
    return 0
  fi
  if [ "$phase" = gate-committed ]; then
    # Jurnalul durabil este deja pragul app+gate. Chiar dacă proba live devine
    # temporar indisponibilă, revenirea aplicației vechi ar crea generații mixte.
    release_rollforward_only=1
    gate_matches_active_release=0
    return 0
  fi
  if constructor_deploy_gate_hashes_match gateSha256; then
    return 0
  fi
  # O generație mixtă/necunoscută nu autorizează niciodată revenirea aplicației
  # vechi peste un gate posibil nou. Păstrăm candidatul și toate unitățile oprite.
  release_rollforward_only=1
  gate_matches_active_release=0
}

restore_constructor_after_release() {
  local index timer marker failed=0
  [ "$constructor_release_quiesced" = 1 ] || return 0
  constructor_deploy_quiesce_restore_proof || return 1
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 \
    KELION_DEPLOY_QUIESCE_PROOF=1 \
    KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$KELION_RELEASE_REQUEST_ID" \
    KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$COMMIT_SHA" \
    "$ROOT/bin/runtime-config-cutover.sh" --recover-only "$ROOT/config/compose.production.yml" \
    || failed=1
  exec 9>&-
  if [ "$failed" = 0 ]; then
    systemctl daemon-reload || failed=1
    for index in "${!constructor_release_timers[@]}"; do
      timer=${constructor_release_timers[$index]}
      marker=${constructor_release_markers[$index]}
      if [ -f "$marker" ]; then
        systemctl is-enabled --quiet "$timer" || failed=1
        systemctl is-active --quiet "$timer" || failed=1
      else
        if systemctl is-enabled --quiet "$timer" || systemctl is-active --quiet "$timer"; then failed=1; fi
      fi
    done
  fi
  if [ "$failed" != 0 ]; then
    force_quiesce_constructor_release || true
    return 1
  fi
  constructor_release_quiesced=0
}

reconcile_constructor_after_completed_release() {
  local index timer marker failed=0
  [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] || return 1
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 "$ROOT/bin/runtime-config-cutover.sh" \
    --recover-only "$ROOT/config/compose.production.yml" || failed=1
  exec 9>&-
  if [ "$failed" = 0 ]; then
    for index in "${!constructor_release_timers[@]}"; do
      timer=${constructor_release_timers[$index]}
      marker=${constructor_release_markers[$index]}
      if [ -f "$marker" ]; then
        systemctl is-enabled --quiet "$timer" || failed=1
        systemctl is-active --quiet "$timer" || failed=1
      elif systemctl is-enabled --quiet "$timer" || systemctl is-active --quiet "$timer"; then
        failed=1
      fi
    done
  fi
  if [ "$failed" = 0 ]; then backup_schedule_live_proof || failed=1; fi
  if [ "$failed" != 0 ]; then
    force_quiesce_constructor_release || true
    return 1
  fi
}

constructor_gate_matches_candidate() {
  local worker_env=${constructor_release_configs[0]}
  local publisher_env=${constructor_release_configs[1]}
  local release_env=${constructor_release_configs[2]}
  local active_file=$RELEASE_STATE_ROOT/active expected_checks path index config_count=0 marker_count=0 unit_count=0 unit
  [ -f "$active_file" ] && [ ! -L "$active_file" ] && [ "$(stat -c '%u:%g:%a' "$active_file")" = '0:10050:640' ] \
    && [ "$(wc -l < "$active_file")" -eq 1 ] && grep -qx "$COMMIT_SHA" "$active_file" || return 1
  for path in "$worker_env" "$publisher_env" "$release_env"; do
    if [ -e "$path" ] || [ -L "$path" ]; then config_count=$((config_count + 1)); fi
  done
  for path in "${constructor_release_markers[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then marker_count=$((marker_count + 1)); fi
  done
  if [ "$config_count" = 0 ] && [ "$marker_count" = 0 ]; then
    for unit in "${constructor_release_timers[@]}" "${constructor_release_services[@]}"; do
      if systemctl cat "$unit" >/dev/null 2>&1; then unit_count=$((unit_count + 1)); fi
      if systemctl is-enabled --quiet "$unit" || systemctl is-active --quiet "$unit"; then return 1; fi
    done
    case "$unit_count" in
      0|6) return 0 ;;
      *) return 1 ;;
    esac
  fi
  [ "$config_count" = 3 ] || return 1
  expected_checks=$(config_value CONSTRUCTOR_REQUIRED_CHECKS)
  for path in "$worker_env" "$publisher_env" "$release_env"; do
    [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:640' ] || return 1
  done
  [ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$worker_env")" -eq 1 ] \
    && grep -qx "KELION_CODEX_GATE_IMAGE=$KELION_CODEX_GATE_IMAGE" "$worker_env" || return 1
  [ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$publisher_env")" -eq 1 ] \
    && grep -qx "KELION_CODEX_GATE_IMAGE=$KELION_CODEX_GATE_IMAGE" "$publisher_env" || return 1
  [ "$(grep -c '^CONSTRUCTOR_REQUIRED_CHECKS=' "$publisher_env")" -eq 1 ] \
    && grep -qx "CONSTRUCTOR_REQUIRED_CHECKS=$expected_checks" "$publisher_env" || return 1
  [ "$(grep -c '^CONSTRUCTOR_RELEASE_REQUIRED_CHECKS=' "$release_env")" -eq 1 ] \
    && grep -qx "CONSTRUCTOR_RELEASE_REQUIRED_CHECKS=$expected_checks" "$release_env" || return 1
  for index in "${!constructor_release_markers[@]}"; do
    if [ -f "${constructor_release_markers[$index]}" ]; then
      [ "$(grep -c "^${constructor_release_exec_flags[$index]}=1$" "${constructor_release_configs[$index]}")" -eq 1 ] \
        || return 1
    fi
  done
}

on_release_exit() {
  local rc=$?
  # Recovery-ul nu poate fi întrerupt la al doilea Ctrl-C/TERM. SIGKILL/reboot
  # este acoperit de jurnalul durabil și va bloca următoarea publicare.
  trap '' HUP INT TERM
  trap - EXIT
  if ! cleanup_migration_proof_copy; then
    printf 'release: copia temporară a dovezii migratorului nu a putut fi eliminată\n' >&2
    [ "$rc" -ne 0 ] || rc=1
  fi
  if [ "$rc" -ne 0 ] && [ "$recovery_armed" = 1 ]; then
    classify_gate_prepared_failure || release_rollforward_only=1
    if [ "$release_cutover_committed" = 1 ] || [ "$release_rollforward_only" = 1 ]; then
      printf 'release: eșec după commitul app+gate; candidatul rămâne activ, iar Constructor rămâne quiesced pentru recovery exact\n' >&2
    elif [ "$point_of_no_return" = 1 ]; then
      recover_schedule_after_point_of_no_return \
        || printf 'release: RECOVERY INCOMPLET pentru schedulerul de backup\n' >&2
      printf 'release: eșec după point-of-no-return; candidatul, DB și proxy-ul rămân nemodificate\n' >&2
    else
      if rollback_switch; then
        if constructor_deploy_quiesce_snapshot_matches_previous; then
          gate_matches_active_release=1
          if [ "$release_request_state" = started ]; then
            if write_release_request_ledger retryable; then
              release_request_state=retryable
            else
              gate_matches_active_release=0
              printf 'release: rollback verificat, dar retryable nu a putut fi jurnalizat; Constructor rămâne quiesced\n' >&2
            fi
          fi
        else
          gate_matches_active_release=0
        fi
        release_pre_ponr_restored=1
      else
        printf 'release: RECOVERY INCOMPLET; runtime-ul vechi rămâne oprit\n' >&2
      fi
    fi
  fi
  if [ "$constructor_release_quiesced" = 1 ] \
    && { [ "$rc" -eq 0 ] \
      || { [ "$release_cutover_committed" != 1 ] && [ "$release_rollforward_only" != 1 ]; }; }; then
    if [ "$gate_matches_active_release" != 1 ] && constructor_gate_matches_candidate; then
      gate_matches_active_release=1
    fi
    if [ "$gate_matches_active_release" != 1 ]; then
      printf 'release: gate-ul Constructor nu corespunde release-ului activ; toate unitățile rămân oprite\n' >&2
      [ "$rc" -ne 0 ] || rc=1
    elif ! restore_constructor_after_release; then
      printf 'release: unitățile Constructor rămân oprite după un rollback incomplet\n' >&2
      [ "$rc" -ne 0 ] || rc=1
    fi
  fi
  if [ "$constructor_release_quiesced" = 0 ] \
    && [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ]; then
    if ! cleanup_caddyfile_snapshot; then
      printf 'release: snapshoturile proxy nu au putut fi curățate după recovery\n' >&2
      [ "$rc" -ne 0 ] || rc=1
    fi
  fi
  if [ "$rc" -ne 0 ] && [ "$release_request_state" = started ] \
    && [ "$point_of_no_return" = 0 ] && [ "$release_pre_ponr_restored" = 1 ] \
    && [ "$constructor_release_quiesced" = 0 ] \
    && [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ]; then
    if write_release_request_ledger retryable; then
      release_request_state=retryable
    else
      printf 'release: rollback verificat, dar ledger-ul nu a putut deveni retryable\n' >&2
    fi
  fi
  if [ "$release_request_state" = retryable ] \
    && [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] \
    && { [ -e "$RECOVERY_JOURNAL" ] || [ -L "$RECOVERY_JOURNAL" ]; }; then
    if ! finalize_rolled_back_recovery_journal; then
      printf 'release: receiptul durabil rolled-back nu a putut fi consumat sigur\n' >&2
      [ "$rc" -ne 0 ] || rc=1
    fi
  fi
  exit "$rc"
}

# Cererea devine durabilă înainte de prima mutație a release-ului. Recovery-ul
# nu consumă niciodată jurnalul quiesce generic: mai întâi dovedește exact
# generația veche (retry) sau candidatul+gate împreună (completion).
if { [ "$release_request_state" = none ] || [ "$release_request_state" = started ] || [ "$release_request_state" = retryable ]; } \
  && { [ "$recovered_constructor_quiesce_phase" = armed ] \
    || [ "$recovered_constructor_quiesce_phase" = quiesced ] \
    || [ "$recovered_constructor_quiesce_phase" = active-prepared ]; } \
  && constructor_deploy_quiesce_snapshot_matches_previous \
  && active_release_live_proof 1; then
  quiesce_constructor_before_candidate \
    || die 'inventarul Constructor nu poate fi reluat după hard-crash'
  upgrade_constructor_timer_units_quiesced \
    || die 'migrarea systemd Constructor nu a putut converge după hard-crash'
  write_constructor_deploy_quiesce_journal quiesced \
    || die 'quiesce-ul reluat nu a putut fi jurnalizat durabil'
  if [ "$release_request_state" = started ]; then
    write_release_request_ledger retryable \
      || die 'rollback-ul hard-crash a fost verificat, dar ledger-ul nu a putut deveni retryable'
    release_request_state=retryable
  fi
  constructor_release_quiesced=1
  gate_matches_active_release=1
  restore_constructor_after_release \
    || die 'generația veche a fost verificată, dar Constructor nu a putut fi reactivat sigur'
  if [ "$recover_pre_ponr_destructive" = 1 ]; then
    finalize_rolled_back_recovery_journal \
      || die 'rollback-ul recuperat nu a putut consuma receiptul după ledger+quiesce'
    recover_pre_ponr_destructive=0
  fi
fi
if { [ "$release_request_state" = started ] || [ "$release_request_state" = success ]; } \
  && [ "$recovered_constructor_quiesce_phase" = gate-committed ] \
  && release_request_live_proof 1 \
  && constructor_gate_matches_candidate; then
  resume_after_gate_commit=1
  release_rollforward_only=1
  constructor_release_quiesced=1
  gate_matches_active_release=1
fi
if [ "$release_request_state" = started ] \
  && { [ "$recovered_constructor_quiesce_phase" = active-published ] || [ "$recovered_constructor_quiesce_phase" = gate-prepared ]; } \
  && release_request_live_proof 1; then
  resume_after_active_marker=1
  release_rollforward_only=1
  constructor_release_quiesced=1
  gate_matches_active_release=0
fi
if [ "$release_request_state" = started ] \
  && [ "$resume_after_active_marker" = 0 ] && [ "$resume_after_gate_commit" = 0 ]; then
  if release_request_completion_record_matches && release_request_live_proof \
    && constructor_gate_matches_candidate \
    && reconcile_constructor_after_completed_release; then
    write_release_request_ledger success \
      || die 'ledger-ul unei cereri deja finalizate nu a putut fi comis ca success'
    printf 'release_noop request=%s commit=%s status=recovered-success\n' "$KELION_RELEASE_REQUEST_ID" "$COMMIT_SHA"
    exit 0
  fi
  die 'cererea de release are un cutover început fără dovadă durabilă de completion; intervenție manuală obligatorie'
fi
if [ "$release_request_state" = success ] && [ "$resume_after_gate_commit" = 0 ]; then
  if release_request_completion_record_matches && release_request_live_proof \
    && constructor_gate_matches_candidate \
    && reconcile_constructor_after_completed_release; then
    printf 'release_noop request=%s commit=%s status=already-succeeded\n' "$KELION_RELEASE_REQUEST_ID" "$COMMIT_SHA"
    exit 0
  fi
  die 'ledger-ul success nu mai are dovada exactă app+gate+Constructor; cutover-ul nu se repetă'
fi
[ "$resume_after_active_marker" = 1 ] || [ "$resume_after_gate_commit" = 1 ] \
  || { [ ! -e "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" ]; } \
  || die 'jurnalul quiesce nu a putut fi reconciliat înaintea retry-ului'
if [ "$resume_after_active_marker" = 0 ] && [ "$resume_after_gate_commit" = 0 ]; then
write_constructor_deploy_quiesce_journal armed \
  || die 'jurnalul durabil pentru quiesce Constructor nu a putut fi armat'
write_release_request_ledger started \
  || die 'intentul durabil al cererii de release nu a putut fi publicat'
release_request_state=started

# Trap-ul este armat înainte de maintenance, backup și mai ales înainte de
# migrator. Orice eșec ulterior revine prin aceeași ordine DB → runtime → proxy.
recovery_armed=1
trap on_release_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Constructorul rămâne oprit pe toată fereastra de backup/migrare/candidat.
# Astfel niciun oneshot nu poate observa backendul vechi oprit ori candidatul
# înainte ca generația coerentă de config să fie comisă.
quiesce_constructor_before_candidate \
  || die 'inventarul celor șase unități Constructor este invalid înaintea release-ului'
upgrade_constructor_timer_units_quiesced \
  || die 'unitățile Constructor actualizate nu au putut fi instalate atomic sub quiesce'
write_constructor_deploy_quiesce_journal quiesced \
  || die 'starea quiesced a Constructorului nu a putut fi jurnalizată durabil'
assert_constructor_release_handoff_drained \
  || die 'release refuzat înainte de PONR: există handoff-uri Constructor merged/release_dispatched nedrenate'

# Cronul existent indică acest path. Îl actualizăm sub publication lock înainte
# de maintenance, astfel încât niciun release viitor să nu poată pierde
# containerele de rollback printr-un container prune concurent.
install_cleanup_script
install_persistent_backup_script
if [ "$destructive_cutover" = 1 ]; then
  write_recovery_journal maintenance 0 0
  enter_destructive_maintenance
  stop_active_runtime
  stop_candidate_runtime
  verify_destructive_maintenance
fi
rm -f -- "$PROOF_FILE"
"$PERSISTENT_BACKUP_SCRIPT"
[ -s "$PROOF_FILE" ] || die 'backup-ul nu a produs dovada verificată'
if [ "$destructive_cutover" = 1 ]; then
  # Exercită validatorul, arhiva, rolul DB, spațiul și restore-ul scratch fără
  # swap. Numai după această dovadă permitem migratorului să mute baza live.
  preflight_database_restore
fi

if [ "$pending_count" -gt 0 ]; then
  migration_args=(
    --rm --network none --user 1000:1000 --group-add 10050
    --read-only --cap-drop ALL --security-opt no-new-privileges
    --pids-limit 96 --memory 768m --cpus 1
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000
    -e HOME=/tmp -e npm_config_cache=/tmp/npm
    -e DATABASE_URL_FILE=/run/secrets/database-url
    -v /var/run/postgresql:/var/run/postgresql:ro
    -v "$SECRET_ROOT/database-url:/run/secrets/database-url:ro"
  )
  if [ "$destructive_cutover" = 1 ]; then
    prepare_migration_proof_copy \
      || die 'dovada backupului nu poate fi expusă migratorului cu ACL minim'
    migration_args+=(
      -e MIGRATION_BACKUP_PROOF_FILE=/run/proof/backup.json
      -e MIGRATION_BACKUP_PROOF_KEY_FILE=/run/secrets/migration-backup-proof-key
      -v "$migration_proof_copy:/run/proof/backup.json:ro"
      -v "$PROOF_KEY:/run/secrets/migration-backup-proof-key:ro"
    )
    # Fail-closed: comanda poate muta DB înainte să întoarcă o eroare, deci
    # recovery-ul devine obligatoriu ÎNAINTE de pornirea migratorului.
    destructive_migration_attempted=1
    db_restore_required=1
    write_recovery_journal before-migrator 0 1
  fi
  migration_output=$(docker run "${migration_args[@]}" "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate)
  if [ "$destructive_cutover" = 1 ]; then
    cleanup_migration_proof_copy \
      || die 'copia temporară a dovezii migratorului nu a putut fi eliminată'
  fi
  [ "$migration_output" = migrations_ok ] || die 'migrările nu au confirmat succesul'
  if [ "$destructive_cutover" = 1 ]; then
    write_recovery_journal database-migrated 0 1
  fi
fi

case "$inactive_slot" in
  blue)
    KELION_BIND_PORT=18080
    KELION_BROWSER_SUBNET=172.29.10.0/24
    KELION_BROWSER_WORKER_IP=172.29.10.2
    KELION_BROWSER_PROXY_IP=172.29.10.3
    ;;
  green)
    KELION_BIND_PORT=18081
    KELION_BROWSER_SUBNET=172.29.11.0/24
    KELION_BROWSER_WORKER_IP=172.29.11.2
    KELION_BROWSER_PROXY_IP=172.29.11.3
    ;;
  *) die 'slot invalid' ;;
esac

KELION_SLOT=$inactive_slot
KELION_COMMIT_SHA=$COMMIT_SHA
KELION_RUNTIME_ROOT=$RUNTIME_ROOT/slots/$inactive_slot
KELION_RELEASE_STATE_ROOT=$RELEASE_STATE_ROOT
KELION_CONFIG_FILE=$CONFIG_FILE
KELION_SECRET_ROOT=$SECRET_ROOT
KELION_SECCOMP_PROFILE=$SECCOMP_PROFILE
export KELION_SLOT KELION_COMMIT_SHA KELION_RUNTIME_ROOT KELION_RELEASE_STATE_ROOT
export KELION_CONFIG_FILE KELION_SECRET_ROOT KELION_SECCOMP_PROFILE
export KELION_BIND_PORT KELION_BROWSER_SUBNET KELION_BROWSER_WORKER_IP KELION_BROWSER_PROXY_IP

project=kelion-$inactive_slot
"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
for directory in browser-api browser-egress converter-api converter-private; do
  install -d -o root -g 10050 -m 2770 "$KELION_RUNTIME_ROOT/$directory"
done
"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" config --quiet
"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" up -d --no-build --remove-orphans --wait --wait-timeout 180

readiness=$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$KELION_BIND_PORT/readyz")
jq -e '.ready == true and .release.candidate == true and .release.sideEffectsActive == false' <<<"$readiness" >/dev/null \
  || die 'candidatul nu este ready și inactiv'
candidate_version=$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$KELION_BIND_PORT/api/version" | jq -er '.v')
[ "$candidate_version" = "${COMMIT_SHA:0:7}" ] || die 'versiunea candidatului nu corespunde commitului'

NODE_PROBE_IMAGE=node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066
docker run --rm --network none --user 1000:1000 --group-add 10050 \
  --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 128m \
  -v "$BUNDLE_DIR:/probe:ro" \
  -v "$KELION_RUNTIME_ROOT/browser-api:/run/kelion-browser-api:ro" \
  -v "$SECRET_ROOT/browser-worker-secret:/run/secrets/browser-worker-secret:ro" \
  "$NODE_PROBE_IMAGE" node /probe/probe-browser-ssrf.mjs
docker run --rm --network none --user 1000:1000 --group-add 10050 \
  --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 128m \
  -v "$BUNDLE_DIR:/probe:ro" \
  -v "$KELION_RUNTIME_ROOT/converter-api:/run/kelion-converter-api:ro" \
  -v "$SECRET_ROOT/converter-worker-secret:/run/secrets/converter-worker-secret:ro" \
  "$NODE_PROBE_IMAGE" node /probe/probe-converter-sandbox.mjs

temporary_proxy=$(mktemp -d "$RUNTIME_ROOT/proxy-validation.XXXXXX")
install -m 0644 "$BUNDLE_DIR/Caddyfile" "$temporary_proxy/Caddyfile"
printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' "$inactive_slot" > "$temporary_proxy/kelion-upstream.caddy"
chmod 0755 "$temporary_proxy"
chmod 0644 "$temporary_proxy/kelion-upstream.caddy"
docker run --rm --network kelion-proxy --user 1000:1000 --read-only \
  --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,uid=1000,gid=1000,mode=0700 \
  -e PUBLIC_APP_DOMAIN="$PUBLIC_APP_DOMAIN" \
  -v "$temporary_proxy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$temporary_proxy:/etc/caddy/upstream:ro" \
  caddy:2@sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a \
  caddy validate --config /etc/caddy/Caddyfile
rm -f -- "$temporary_proxy/Caddyfile" "$temporary_proxy/kelion-upstream.caddy"
rmdir "$temporary_proxy"

# Faza pregătită este durabilă înaintea primei mutații care poate face
# candidatul public sau poate schimba configurația proxy-ului de pe disc.
# Jurnalul conține snapshoturile/hashurile old+target, deci recovery-ul nu
# deduce niciodată starea dintr-un mv/reload parțial.
write_constructor_deploy_quiesce_journal active-prepared \
  || die 'faza active-prepared nu a putut fi publicată înainte de switch-ul proxy'
load_deploy_proxy_intent active-prepared \
  || die 'proxy intent-ul durabil al candidatului nu poate fi recitit exact'
# Pentru un slot managed, următorul mv poate deveni public la reload. Din acest
# punct snapshotul nu mai poate fi aplicat fără risc de a pierde scrieri.
if [ "$destructive_cutover" = 1 ] && [ "$active_slot" != legacy ]; then
  mark_point_of_no_return
fi
publish_target_proxy_files_from_intent \
  || die 'Caddyfile/upstream candidat nu au putut fi publicate atomic și sincronizate'

export PUBLIC_APP_DOMAIN KELION_PROXY_CONFIG_ROOT=$PROXY_CONFIG_ROOT KELION_PROXY_STATE_ROOT=$PROXY_STATE_ROOT
"$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" config --quiet
if [ "$active_slot" = legacy ]; then
  # La primul cutover UPSTREAM_FILE nu este public cât timp kelion-caddy deține
  # 80/443. Punctul ireversibil este chiar înainte ca noul proxy să poată primi
  # trafic; după el recovery-ul nu oprește candidatul și nu restaurează snapshotul.
  if [ "$destructive_cutover" = 1 ]; then
    mark_point_of_no_return
  fi
  retire_legacy_proxy_from_deploy_journal \
    || die 'proxy-ul legacy nu a putut fi retras persistent înainte de proxy-ul managed'
fi
# `up` reconciliază inclusiv un proxy deja pornit. Este obligatoriu când se
# schimbă structura bind mount-urilor; altfel reload-ul ar putea citi în
# continuare inode-ul vechi al Caddyfile-ului înlocuit atomic.
"$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" up -d --no-build --wait --wait-timeout 90
docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null
docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null
prepared_candidate_public_live_proof \
  || die 'proxy-ul candidat nu expune exact versiunea pregătită înainte de activare'

# Legacy nu citește markerul release-state. Îl retragem (inclusiv restart policy)
# înainte de activarea side effects a candidatului, altfel primul cutover ar avea
# doi writeri până la tail-ul release-ului ori după un reboot Docker.
if [ "$active_slot" = legacy ]; then
  retire_legacy_generation_from_deploy_journal \
    || die 'writerul legacy nu a putut fi retras persistent înainte de markerul candidat'
  active_runtime_stopped=1
fi

publish_candidate_active_marker \
  || die 'markerul release candidat și fazele active-prepared/active-published nu au putut fi comise'
gate_matches_active_release=0

for _attempt in $(seq 1 18); do
  active_ready=$(curl --silent --show-error --max-time 10 "http://127.0.0.1:$KELION_BIND_PORT/readyz" || true)
  if jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$active_ready" >/dev/null 2>&1; then break; fi
  sleep 2
done
jq -e '.ready == true and .release.sideEffectsActive == true' <<<"${active_ready:-}" >/dev/null \
  || die 'activarea candidatului nu a fost observată'

public_ok=0
for _attempt in $(seq 1 18); do
  live_version=$(curl --fail --silent --show-error --max-time 12 "$PRODUCT_ORIGIN/api/version" | jq -r '.v // empty' || true)
  live_ready=$(curl --fail --silent --show-error --max-time 12 "$PRODUCT_ORIGIN/readyz" || true)
  if [ "$live_version" = "${COMMIT_SHA:0:7}" ] \
    && jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$live_ready" >/dev/null 2>&1; then
    public_ok=1
    break
  fi
  sleep 5
done
[ "$public_ok" = 1 ] || die 'smoke-ul public nu confirmă commitul și readiness'
else
  # Candidatul este deja public și jurnalul exact a fost verificat. Nu repetăm
  # backupul/migrarea; continuăm strict roll-forward cu Constructor quiesced.
  recovery_armed=1
  trap on_release_exit EXIT
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
fi

refresh_constructor_gate() (
  set -euo pipefail
  local worker_env=/root/kelion/config/codex-worker.env
  local publisher_env=/root/kelion/config/constructor-publisher.env
  local release_env=/root/kelion/config/constructor-release.env
  local token_file=/root/kelion/gate-secrets/github-ghcr-read-token
  local -a targets=("$worker_env" "$publisher_env" "$release_env")
  local -a roles=(worker publisher release)
  local -a logicals=(constructor-config.codex-worker.env constructor-config.constructor-publisher.env constructor-config.constructor-release.env)
  local -a markers=(/etc/kelion/codex-worker.enabled /etc/kelion/constructor-publisher.enabled /etc/kelion/constructor-release.enabled)
  local -a timers=(kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer)
  local -a services=(kelion-codex-worker.service kelion-constructor-publisher.service kelion-constructor-release.service)
  local -a staged=() backups=()
  local authfile='' temporary='' journal_temporary='' user runtime required_checks path state gate_txn='' gate_journal=$RUNTIME_ROOT/constructor-gate-refresh.journal
  local configured=0 units_touched=0 mutation_started=0 config_consistent=1 operation_succeeded=0
  local journal_written=0

  for path in "${targets[@]}" "${markers[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then configured=1; fi
  done
  [ "$configured" = 1 ] || return 0
  for path in "${targets[@]}"; do
    [ -f "$path" ] && [ ! -L "$path" ] || die "config Constructor lipsă sau nesigur: $path"
    [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:640' ] || die "ACL invalid pentru configul Constructor: $path"
  done
  for path in "${markers[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
        || die "marker Constructor nesigur: $path"
    fi
  done
  [ -f "$token_file" ] && [ ! -L "$token_file" ] || die 'credentiala GHCR read-only pentru gate lipsește'
  [ "$(stat -c '%u:%g:%a' "$token_file")" = '0:0:400' ] \
    || die 'ACL invalid pentru credentiala GHCR read-only folosită la gate'
  required_checks=$(config_value CONSTRUCTOR_REQUIRED_CHECKS)

  stop_constructor_units() {
    local unit
    for unit in "${timers[@]}"; do systemctl disable --now "$unit" >/dev/null || return 1; done
    for unit in "${services[@]}"; do systemctl disable --now "$unit" >/dev/null || return 1; done
    for unit in "${timers[@]}" "${services[@]}"; do
      state=$(systemctl show "$unit" --property=ActiveState --value) || return 1
      case "$state" in inactive|failed) ;; *) return 1 ;; esac
    done
  }

  restore_constructor_configs() {
    local index target backup restored failed=0
    for index in "${!targets[@]}"; do
      target=${targets[$index]}
      backup=${backups[$index]:-}
      restored=''
      [ -f "$backup" ] || { failed=1; continue; }
      restored=$(mktemp "$target.restore.XXXXXX") || { failed=1; continue; }
      if cp --preserve=mode,ownership,timestamps -- "$backup" "$restored" \
        && mv -f -- "$restored" "$target" \
        && cmp -s -- "$target" "$backup" \
        && [ "$(stat -c '%u:%g:%a' "$target")" = '0:0:640' ]; then
        :
      else
        rm -f -- "$restored"
        failed=1
      fi
    done
    [ "$failed" = 0 ]
  }

  cleanup_constructor_gate() {
    local status=$? cleanup_failed=0 item
    trap - EXIT
    set +e
    [ -z "$authfile" ] || rm -f -- "$authfile"
    [ -z "$temporary" ] || rm -f -- "$temporary"
    [ -z "$journal_temporary" ] || rm -f -- "$journal_temporary"
    if { [ "$journal_written" = 1 ] || [ -e "$gate_journal" ] || [ -L "$gate_journal" ]; } \
      && [ "$operation_succeeded" != 1 ]; then
      config_consistent=0
      if stop_constructor_units \
        && [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
        && [ "$(stat -c '%u:%g:%a' "$ROOT/bin/runtime-config-cutover.sh")" = '0:0:500' ] \
        && [ -f "$ROOT/config/compose.production.yml" ] && [ ! -L "$ROOT/config/compose.production.yml" ] \
        && [ "$(stat -c '%u:%g:%a' "$ROOT/config/compose.production.yml")" = '0:0:444' ]; then
        exec 9>&8
        if KELION_CUTOVER_LOCK_HELD=1 "$ROOT/bin/runtime-config-cutover.sh" --recover-only "$ROOT/config/compose.production.yml" --leave-constructor-quiesced; then
          config_consistent=1
          journal_written=0
        else
          cleanup_failed=1
        fi
        exec 9>&-
      else
        cleanup_failed=1
      fi
    elif [ "$mutation_started" = 1 ] && [ "$operation_succeeded" != 1 ]; then
      config_consistent=0
      if restore_constructor_configs; then config_consistent=1; else cleanup_failed=1; fi
    fi
    for item in "${staged[@]:-}" "${backups[@]:-}"; do [ -z "$item" ] || rm -f -- "$item" || cleanup_failed=1; done
    if [ "$journal_written" = 0 ] && [ -n "$gate_txn" ] && [ -e "$gate_txn" ]; then
      if [[ "$gate_txn" =~ ^/root/kelion/runtime/constructor-gate-txn\.[A-Za-z0-9]+$ ]] \
        && [ -d "$gate_txn" ] && [ ! -L "$gate_txn" ] && [ "$(realpath -e -- "$gate_txn")" = "$gate_txn" ]; then
        rm -rf -- "$gate_txn" || cleanup_failed=1
      else
        cleanup_failed=1
      fi
    fi
    if [ "$units_touched" = 1 ] && ! stop_constructor_units; then
      cleanup_failed=1
    fi
    if [ "$cleanup_failed" != 0 ]; then
      printf 'release: refresh-ul Constructor nu a putut restaura o stare coerentă\n' >&2
      status=1
    fi
    exit "$status"
  }
  trap cleanup_constructor_gate EXIT
  units_touched=1
  stop_constructor_units || die 'unitățile Constructor nu s-au oprit complet'
  for user in kelion-codex kelion-publisher; do
    runtime=/run/$user
    install -d -o "$user" -g "$user" -m 0700 "$runtime"
    local registry_owner
    registry_owner="${KELION_CODEX_GATE_IMAGE#ghcr.io/}"
    registry_owner="${registry_owner%%/*}"
    authfile=$runtime/release-gate-auth.json
    rm -f -- "$authfile"
    cat "$token_file" | runuser -u "$user" -- env HOME="/var/lib/$user" XDG_RUNTIME_DIR="$runtime" podman login --authfile "$authfile" ghcr.io --username "$registry_owner" --password-stdin >/dev/null
    if ! runuser -u "$user" -- env HOME="/var/lib/$user" XDG_RUNTIME_DIR="$runtime" podman pull --authfile "$authfile" "$KELION_CODEX_GATE_IMAGE" >/dev/null; then
      runuser -u "$user" -- env HOME="/var/lib/$user" XDG_RUNTIME_DIR="$runtime" podman logout --authfile "$authfile" ghcr.io >/dev/null 2>&1 || true
      exit 1
    fi
    runuser -u "$user" -- env HOME="/var/lib/$user" XDG_RUNTIME_DIR="$runtime" podman logout --authfile "$authfile" ghcr.io >/dev/null
    rm -f -- "$authfile"
    authfile=''
  done

  stage_constructor_env() {
    local target=$1 role=$2
    temporary=$(mktemp "$target.XXXXXX")
    case "$role" in
      worker)
        awk -F= -v image="$KELION_CODEX_GATE_IMAGE" '
          $1 == "KELION_CODEX_GATE_IMAGE" { if (!image_written) print "KELION_CODEX_GATE_IMAGE=" image; image_written=1; next }
          { print }
          END { if (!image_written) print "KELION_CODEX_GATE_IMAGE=" image }
        ' "$target" > "$temporary"
        ;;
      publisher)
        awk -F= -v image="$KELION_CODEX_GATE_IMAGE" -v checks="$required_checks" '
          $1 == "KELION_CODEX_GATE_IMAGE" { if (!image_written) print "KELION_CODEX_GATE_IMAGE=" image; image_written=1; next }
          $1 == "CONSTRUCTOR_REQUIRED_CHECKS" { if (!checks_written) print "CONSTRUCTOR_REQUIRED_CHECKS=" checks; checks_written=1; next }
          { print }
          END {
            if (!image_written) print "KELION_CODEX_GATE_IMAGE=" image
            if (!checks_written) print "CONSTRUCTOR_REQUIRED_CHECKS=" checks
          }
        ' "$target" > "$temporary"
        ;;
      release)
        awk -F= -v checks="$required_checks" '
          $1 == "CONSTRUCTOR_RELEASE_REQUIRED_CHECKS" { if (!checks_written) print "CONSTRUCTOR_RELEASE_REQUIRED_CHECKS=" checks; checks_written=1; next }
          { print }
          END { if (!checks_written) print "CONSTRUCTOR_RELEASE_REQUIRED_CHECKS=" checks }
        ' "$target" > "$temporary"
        ;;
      *) die 'rol necunoscut pentru configul Constructor' ;;
    esac
    chown root:root "$temporary"
    chmod 0640 "$temporary"
    staged+=("$temporary")
    temporary=''
  }

  constructor_env_value() {
    local file=$1 name=$2
    awk -F= -v wanted="$name" '$1 == wanted { print substr($0, index($0, "=") + 1) }' "$file"
  }
  assert_constructor_env_value() {
    local file=$1 name=$2 expected=$3 observed
    observed=$(constructor_env_value "$file" "$name")
    [ "$observed" = "$expected" ] && [ "$(grep -c "^${name}=" "$file")" -eq 1 ] \
      || die "valoare Constructor nealiniată în $file: $name"
  }

  local index helper_sha
  for index in "${!targets[@]}"; do stage_constructor_env "${targets[$index]}" "${roles[$index]}"; done
  assert_constructor_env_value "${staged[0]}" KELION_CODEX_GATE_IMAGE "$KELION_CODEX_GATE_IMAGE"
  assert_constructor_env_value "${staged[1]}" KELION_CODEX_GATE_IMAGE "$KELION_CODEX_GATE_IMAGE"
  assert_constructor_env_value "${staged[1]}" CONSTRUCTOR_REQUIRED_CHECKS "$required_checks"
  assert_constructor_env_value "${staged[2]}" CONSTRUCTOR_RELEASE_REQUIRED_CHECKS "$required_checks"
  # Publicăm jurnalul numai după ce helperul curent a validat allowlist-ul și
  # setul obligatoriu complet pentru fiecare rol. Un config legacy invalid nu
  # poate crea astfel un jurnal pe care recovery-ul însuși l-ar refuza.
  exec 9>&8
  for index in "${!staged[@]}"; do
    KELION_CUTOVER_LOCK_HELD=1 "$ROOT/bin/runtime-config-cutover.sh" \
      --validate-env-file "${logicals[$index]}" "${staged[$index]}" \
      || die "config Constructor candidat invalid: ${roles[$index]}"
  done
  exec 9>&-
  write_constructor_deploy_gate_prepared_journal "${staged[0]}" "${staged[1]}" "${staged[2]}" \
    || die 'hashurile gate candidat nu au putut fi publicate înainte de tranzacția gate'
  [ ! -e "$gate_journal" ] && [ ! -L "$gate_journal" ] || die 'există deja un jurnal de refresh gate'
  gate_txn=$(mktemp -d "$RUNTIME_ROOT/constructor-gate-txn.XXXXXX")
  chown root:root "$gate_txn"; chmod 0700 "$gate_txn"
  install -d -o root -g root -m 0700 "$gate_txn/new"
  install -o root -g root -m 0500 "$BUNDLE_DIR/lib/runtime-config-cutover.sh" "$gate_txn/recovery-helper.sh"
  install -o root -g root -m 0444 "$COMPOSE_FILE" "$gate_txn/recovery-compose.yml"
  sync_recovery_path "$gate_txn/recovery-helper.sh" file
  sync_recovery_path "$gate_txn/recovery-compose.yml" file
  helper_sha=$(sha256sum "$gate_txn/recovery-helper.sh" | awk '{print $1}')
  [[ "$helper_sha" =~ ^[0-9a-f]{64}$ ]] || die 'hash invalid pentru helperul recovery gate'
  for index in "${!targets[@]}"; do
    install -o root -g root -m 0600 "${staged[$index]}" "$gate_txn/new/$(basename -- "${targets[$index]}")"
    sync_recovery_path "$gate_txn/new/$(basename -- "${targets[$index]}")" file
  done
  sync_recovery_path "$gate_txn/new" dir-self
  sync_recovery_path "$gate_txn" dir-self
  sync_recovery_path "$RUNTIME_ROOT" dir-self
  journal_temporary=$(mktemp "$RUNTIME_ROOT/constructor-gate-refresh.XXXXXX")
  jq -n --arg commit "$COMMIT_SHA" --arg transactionRoot "$gate_txn" --arg helperSha256 "$helper_sha" \
    '{schema:1,commit:$commit,transactionRoot:$transactionRoot,helperSha256:$helperSha256}' > "$journal_temporary"
  chown root:root "$journal_temporary"; chmod 0600 "$journal_temporary"
  sync_recovery_path "$journal_temporary" file
  mv -f -- "$journal_temporary" "$gate_journal"
  journal_temporary=''
  sync_recovery_path "$gate_journal" file
  sync_recovery_path "$gate_journal" parent
  journal_written=1
  config_consistent=0
  [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/bin/runtime-config-cutover.sh")" = '0:0:500' ] \
    || die 'helperul persistent de recovery gate lipsește sau are ACL invalid'
  [ -f "$ROOT/config/compose.production.yml" ] && [ ! -L "$ROOT/config/compose.production.yml" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/config/compose.production.yml")" = '0:0:444' ] \
    || die 'compose-ul persistent de recovery gate lipsește sau are ACL invalid'
  exec 9>&8
  KELION_CUTOVER_LOCK_HELD=1 "$ROOT/bin/runtime-config-cutover.sh" --recover-only "$ROOT/config/compose.production.yml" --leave-constructor-quiesced
  exec 9>&-
  journal_written=0
  assert_constructor_env_value "$worker_env" KELION_CODEX_GATE_IMAGE "$KELION_CODEX_GATE_IMAGE"
  assert_constructor_env_value "$publisher_env" KELION_CODEX_GATE_IMAGE "$KELION_CODEX_GATE_IMAGE"
  assert_constructor_env_value "$publisher_env" CONSTRUCTOR_REQUIRED_CHECKS "$required_checks"
  assert_constructor_env_value "$release_env" CONSTRUCTOR_RELEASE_REQUIRED_CHECKS "$required_checks"
  for path in "${targets[@]}"; do
    [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:640' ] \
      || die "config Constructor invalid după commit: $path"
  done
  config_consistent=1
  operation_succeeded=1
)
if [ "$resume_after_gate_commit" = 0 ]; then
  refresh_constructor_gate
  constructor_gate_matches_candidate || die 'gate-ul Constructor nu corespunde release-ului activ după refresh'
  write_constructor_deploy_quiesce_journal gate-committed \
    || die 'commitul app+gate nu a putut fi jurnalizat durabil'
else
  constructor_gate_matches_candidate \
    || die 'gate-ul Constructor recuperat nu mai corespunde candidatului activ'
fi
gate_matches_active_release=1
release_cutover_committed=1

# Schedulerul persistent este o mutație de producție: îl instalăm, activăm și
# verificăm numai după dovada publică exactă. Cronul vechi dispare abia după ce
# timerul are o următoare rulare. Snapshotul rămâne activ până la ultima dovadă
# de release, astfel încât orice eșec ulterior restaurează întregul scheduler.
snapshot_backup_schedule
backup_schedule_mutating=1
activate_persistent_backup_script
install_backup_schedule
retire_legacy_backup_cron
backup_schedule_live_proof \
  || die 'schedulerul persistent nu trece dovada durabilă înainte de completion'

# Pentru un plan distructiv writerul vechi este deja oprit înainte de backup;
# pentru orice alt plan îl oprim numai după smoke-ul public exact. Funcția este
# idempotentă și păstrează containerele pentru recovery.
if [ "$resume_after_active_marker" = 0 ] && [ "$resume_after_gate_commit" = 0 ]; then
  stop_active_runtime
else
  # La primul cutover, parserul upstream vede blue după crash și nu mai poate
  # reconstrui lista legacy. Jurnalul armat înainte de switch este autoritatea.
  if jq -e --arg requestId "$KELION_RELEASE_REQUEST_ID" --arg commit "$COMMIT_SHA" '
      .schema == 2 and .requestId == $requestId and .commit == $commit and .activeBefore == "legacy"
    ' "$CONSTRUCTOR_DEPLOY_QUIESCE_JOURNAL" >/dev/null 2>&1; then
    stop_legacy_runtime_from_deploy_journal \
      || die 'runtime-ul legacy capturat nu a putut fi oprit exact la resume'
  else
    # Pentru managed→managed, runtime-ul vechi este acum exact inactive_slot.
    stop_candidate_runtime
  fi
fi

release_completed_slot=$inactive_slot
if [ "$resume_after_active_marker" = 1 ] || [ "$resume_after_gate_commit" = 1 ]; then
  release_completed_slot=$active_slot
fi
backup_schedule_live_proof \
  || die 'schedulerul persistent nu mai trece dovada exactă înainte de recordul completion'
write_release_completion_record "$release_completed_slot" \
  || die 'recordul durabil de completion al release-ului nu a putut fi publicat'
backup_schedule_mutating=0
if ! cleanup_backup_schedule_snapshot; then
  printf 'release: avertisment: snapshotul schedulerului a rămas root-only în runtime\n' >&2
fi
db_restore_required=0
if [ "$destructive_cutover" = 1 ] || [ "$resume_destructive_recovery" = 1 ]; then
  [ "$point_of_no_return" = 1 ] || die 'release-ul distructiv nu a înregistrat point-of-no-return'
  if [ "$resume_destructive_recovery" = 1 ]; then
    [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] \
      && jq -e --arg commit "$COMMIT_SHA" \
        '.schema == 1 and .commit == $commit and .pointOfNoReturn == true' "$RECOVERY_JOURNAL" >/dev/null \
      || die 'jurnalul distructiv reluat nu mai dovedește PONR pentru commitul curent'
  fi
  write_recovery_journal completed 1 0
  clear_recovery_journal
fi
restore_constructor_after_release \
  || die 'timer-ele Constructor nu au putut fi reactivate după ultimul commit rollbackable'
if ! cleanup_caddyfile_snapshot; then
  printf 'release: avertisment: snapshoturile proxy au rămas root-only în runtime\n' >&2
fi
write_release_request_ledger success \
  || die 'ledger-ul success al cererii de release nu a putut fi comis durabil'
release_request_state=success
recovery_armed=0
trap - HUP INT TERM EXIT
if ! rm -f -- "$PROOF_FILE"; then
  printf 'release: avertisment: dovada backupului a rămas root-only în runtime\n' >&2
fi
printf 'release_ok commit=%s slot=%s\n' "$COMMIT_SHA" "$release_completed_slot"
