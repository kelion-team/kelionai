#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly FAST_PROFILE='fast'
readonly POWERFUL_PROFILE='powerful'
readonly FAST_ALIAS='qwen3.6-35b-a3b-local'
readonly POWERFUL_ALIAS='qwen3.5-122b-a10b-local'
readonly LLAMA_UNIT='private-ai-llm.service'
readonly WEB_UNIT='private-ai-web.service'
readonly LLAMA_BIN='/opt/private-ai/bin/llama-server'
readonly POWERFUL_ROOT='/srv/private-ai/models/qwen3.5-122b-a10b-q4_k_m'
readonly POWERFUL_FIRST='Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf'
readonly POWERFUL_SEALED_RECEIPT='/etc/private-ai/.max-model-sealed'
readonly POWERFUL_COMPLETE_RECEIPT='/etc/private-ai/.max-model-complete'
readonly RUNTIME_DROPIN_DIR='/run/systemd/system/private-ai-llm.service.d'
readonly RUNTIME_DROPIN="$RUNTIME_DROPIN_DIR/90-constructor-model.conf"
readonly LEGACY_DROPIN='/etc/systemd/system/private-ai-llm.service.d/90-qwen35-122b-max.conf'
readonly STATE_DIR='/run/private-ai'
readonly STATE_FILE="$STATE_DIR/active-model"
readonly LOCK_FILE='/run/lock/private-ai-model-switch.lock'

readonly -a POWERFUL_SHARDS=(
  'Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf'
  'Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf'
  'Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf'
)
readonly -a POWERFUL_BYTES=(
  '10943552'
  '49968146912'
  '26557874144'
)

fail() {
  printf 'constructor-model-switch: ERROR: %s\n' "$*" >&2
  return 1
}

log() {
  printf 'constructor-model-switch: %s\n' "$*"
}

prepare_lock_file() {
  [ -d /run/lock ] && [ ! -L /run/lock ] && [ "$(stat -Lc '%u' /run/lock)" = 0 ] \
    || fail 'directorul lockului este nesigur'
  if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
    local metadata
    metadata=$(stat -Lc '%U:%G:%a:%h' "$LOCK_FILE" 2>/dev/null || true)
    [ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] \
      && { [ "$metadata" = 'root:root:600:1' ] || [ "$metadata" = 'root:privateai:660:1' ]; } \
      || fail 'fișierul lock existent este nesigur'
  else
    ( set -o noclobber; umask 077; : > "$LOCK_FILE" ) 2>/dev/null \
      || [ -f "$LOCK_FILE" ] || fail 'fișierul lock nu poate fi creat'
  fi
  chown root:privateai "$LOCK_FILE"
  chmod 0660 "$LOCK_FILE"
  [ "$(stat -Lc '%U:%G:%a:%h' "$LOCK_FILE")" = 'root:privateai:660:1' ] \
    || fail 'metadatele lockului comun sunt invalide'
}

verify_final_receipt() {
  local fast_model_path
  local -a lines=()
  require_regular "$POWERFUL_COMPLETE_RECEIPT"
  [ "$(stat -Lc '%U:%G:%a:%h' "$POWERFUL_COMPLETE_RECEIPT")" = 'root:root:600:1' ] \
    || fail 'receiptul final 122B are metadate invalide'
  mapfile -t lines < "$POWERFUL_COMPLETE_RECEIPT"
  [ "${#lines[@]}" -eq 20 ] || fail 'receiptul final 122B are schema incompletă'
  [ "${lines[0]}" = 'schema=2' ]
  [ "${lines[1]}" = 'default_model=llama.cpp/qwen3.6-35b-a3b-local' ]
  [ "${lines[2]}" = 'powerful_model=llama.cpp/qwen3.5-122b-a10b-local' ]
  [ "${lines[3]}" = 'active_profile=fast' ]
  [ "${lines[4]}" = 'model_repo=unsloth/Qwen3.5-122B-A10B-GGUF' ]
  [ "${lines[5]}" = 'model_revision=a97b483a9f8cad9788776aa0112a2c63bf349e9e' ]
  [ "${lines[6]}" = 'model_quant=Q4_K_M' ]
  [ "${lines[7]}" = 'model_total_bytes=76536964608' ]
  [ "${lines[8]}" = 'shard_1_sha256=467c9bd92ea518539cf75bf5a5fbfbd35e9a0b40d766ccaa67bf120e12041df3' ]
  [ "${lines[9]}" = 'shard_2_sha256=90db14846413aebdac365b57206441437cac5f7e5037d94b325f0167f902e6e7' ]
  [ "${lines[10]}" = 'shard_3_sha256=e3c24b8ebec070bb4f69ea0aca25a16531da7440cd515529953e046882901f97' ]
  [ "${lines[11]}" = 'fast_model_bytes=20419565568' ]
  [ "${lines[12]}" = 'fast_model_sha256=671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7' ]
  [[ "${lines[13]}" =~ ^fast_model_path=/srv/private-ai/models/[^[:space:]]+$ ]]
  [[ "${lines[14]}" =~ ^installer_sha256=[0-9a-f]{64}$ ]]
  [[ "${lines[15]}" =~ ^worker_source_sha256=[0-9a-f]{64}$ ]]
  [[ "${lines[16]}" =~ ^config_source_sha256=[0-9a-f]{64}$ ]]
  [[ "${lines[17]}" =~ ^worker_unit_source_sha256=[0-9a-f]{64}$ ]]
  [[ "${lines[18]}" =~ ^switch_source_sha256=[0-9a-f]{64}$ ]]
  [[ "${lines[19]}" =~ ^verified_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]]
  fast_model_path=${lines[13]#fast_model_path=}
  [ "$(realpath -e -- "$fast_model_path")" = "$fast_model_path" ] \
    || fail 'calea modelului fast din receipt nu este canonică'
}

require_regular() {
  local path=$1
  [ -f "$path" ] && [ ! -L "$path" ] || fail "fișier lipsă sau nesigur: $path"
  [ "$(stat -Lc '%h' "$path")" = 1 ] || fail "hardlink neașteptat: $path"
}

expected_powerful_dropin() {
  cat <<EOF
[Service]
ExecStart=
ExecStart=$LLAMA_BIN --model $POWERFUL_ROOT/$POWERFUL_FIRST --alias $POWERFUL_ALIAS --host 127.0.0.1 --port 24080 --ctx-size 16384 --n-predict 4096 --threads 16 --parallel 1 --jinja --chat-template-kwargs '{"enable_thinking":false}'
Restart=no
TimeoutStartSec=3600
CPUQuota=1600%
MemoryHigh=84G
MemoryMax=88G
EOF
}

active_alias() {
  local payload
  payload=$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models) || return 1
  jq -er '
    .data as $models |
    if ($models | type) == "array" and ($models | length) == 1 and
       ($models[0].id | type) == "string"
    then $models[0].id else error("invalid model list") end
  ' <<<"$payload"
}

wait_for_alias() {
  local alias=$1 timeout_seconds=$2 deadline actual
  deadline=$((SECONDS + timeout_seconds))
  while [ "$SECONDS" -lt "$deadline" ]; do
    if systemctl is-failed --quiet "$LLAMA_UNIT"; then
      fail "$LLAMA_UNIT a eșuat înainte de health pentru $alias"
      return 1
    fi
    if curl --fail --silent --show-error --max-time 10 \
      http://127.0.0.1:24080/health >/dev/null 2>&1; then
      actual=$(active_alias 2>/dev/null || true)
      if [ "$actual" = "$alias" ]; then return 0; fi
    fi
    sleep 5
  done
  fail "timeout la activarea aliasului $alias"
}

verify_loopback_listener() {
  local pid=$1
  mapfile -t listeners < <(ss -ltnpH | awk '$4 == "127.0.0.1:24080"')
  [ "${#listeners[@]}" -eq 1 ] && [[ "${listeners[0]}" == *"pid=$pid,"* ]] \
    || fail 'listenerul llama.cpp nu este unic pe 127.0.0.1:24080'
  ! ss -ltnH | awk '{print $4}' | grep -Eq '(0[.]0[.]0[.]0|\[::\]):24080$' \
    || fail 'llama.cpp ascultă în afara loopbackului'
}

verify_powerful_artifacts() {
  local index path
  verify_final_receipt
  require_regular "$POWERFUL_SEALED_RECEIPT"
  [ "$(stat -Lc '%U:%G:%a:%h' "$POWERFUL_SEALED_RECEIPT")" = 'root:root:600:1' ] \
    || fail 'receiptul sigilat 122B are metadate invalide'
  grep -Fqx 'schema=1' "$POWERFUL_SEALED_RECEIPT"
  grep -Fqx 'model_repo=unsloth/Qwen3.5-122B-A10B-GGUF' "$POWERFUL_SEALED_RECEIPT"
  grep -Fqx 'model_revision=a97b483a9f8cad9788776aa0112a2c63bf349e9e' "$POWERFUL_SEALED_RECEIPT"
  grep -Fqx 'model_quant=Q4_K_M' "$POWERFUL_SEALED_RECEIPT"
  grep -Fqx 'model_total_bytes=76536964608' "$POWERFUL_SEALED_RECEIPT"
  grep -Fqx 'shard_1_sha256=467c9bd92ea518539cf75bf5a5fbfbd35e9a0b40d766ccaa67bf120e12041df3' "$POWERFUL_SEALED_RECEIPT"
  grep -Fqx 'shard_2_sha256=90db14846413aebdac365b57206441437cac5f7e5037d94b325f0167f902e6e7' "$POWERFUL_SEALED_RECEIPT"
  grep -Fqx 'shard_3_sha256=e3c24b8ebec070bb4f69ea0aca25a16531da7440cd515529953e046882901f97' "$POWERFUL_SEALED_RECEIPT"
  for index in "${!POWERFUL_SHARDS[@]}"; do
    path="$POWERFUL_ROOT/${POWERFUL_SHARDS[$index]}"
    require_regular "$path"
    [ "$(stat -Lc '%U:%G:%a:%s:%h' "$path")" \
        = "root:privateai:440:${POWERFUL_BYTES[$index]}:1" ] \
      || fail "metadate invalide pentru shardul $((index + 1)) 122B"
  done
}

publish_state() {
  local profile=$1 alias=$2 candidate
  install -d -o root -g root -m 0755 "$STATE_DIR"
  candidate=$(mktemp "$STATE_DIR/.active-model.XXXXXX")
  {
    printf 'schema=1\n'
    printf 'profile=%s\n' "$profile"
    printf 'alias=%s\n' "$alias"
    printf 'verified_at=%s\n' "$(date -u +%FT%TZ)"
  } > "$candidate"
  chown root:root "$candidate"
  chmod 0644 "$candidate"
  mv -f -- "$candidate" "$STATE_FILE"
  sync -f "$STATE_FILE"
}

ensure_web_active() {
  local attempt
  systemctl restart "$WEB_UNIT"
  for attempt in $(seq 1 150); do
    if systemctl is-active --quiet "$WEB_UNIT" \
      && ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24096'; then
      return 0
    fi
    sleep 2
  done
  fail "$WEB_UNIT nu a revenit pe loopback"
}

activate_fast() {
  local current pid
  current=$(active_alias 2>/dev/null || true)
  if [ ! -e "$RUNTIME_DROPIN" ] && [ ! -e "$LEGACY_DROPIN" ] \
    && [ "$current" = "$FAST_ALIAS" ] \
    && systemctl is-active --quiet "$LLAMA_UNIT" \
    && systemctl is-active --quiet "$WEB_UNIT"; then
    pid=$(systemctl show "$LLAMA_UNIT" -p MainPID --value)
    [[ "$pid" =~ ^[1-9][0-9]*$ ]]
    verify_loopback_listener "$pid"
    publish_state "$FAST_PROFILE" "$FAST_ALIAS"
    log "PROFILE=$FAST_PROFILE ALIAS=$FAST_ALIAS STATUS=already-active"
    return 0
  fi

  systemctl stop "$WEB_UNIT"
  rm -f -- "$RUNTIME_DROPIN" "$LEGACY_DROPIN"
  systemctl daemon-reload
  systemd-analyze verify "$LLAMA_UNIT" >/dev/null
  systemctl reset-failed "$LLAMA_UNIT" >/dev/null 2>&1 || true
  systemctl restart "$LLAMA_UNIT"
  wait_for_alias "$FAST_ALIAS" 1800
  pid=$(systemctl show "$LLAMA_UNIT" -p MainPID --value)
  [[ "$pid" =~ ^[1-9][0-9]*$ ]]
  [ "$(readlink -f -- "/proc/$pid/exe")" = "$LLAMA_BIN" ]
  verify_loopback_listener "$pid"
  ensure_web_active
  publish_state "$FAST_PROFILE" "$FAST_ALIAS"
  log "PROFILE=$FAST_PROFILE ALIAS=$FAST_ALIAS STATUS=active"
}

rollback_to_fast() {
  local status=${1:-1}
  trap - ERR EXIT HUP INT TERM
  set +e
  log "POWERFUL_ROLLBACK=started EXIT=$status"
  ( set -Eeuo pipefail; activate_fast )
  local rollback_status=$?
  if [ "$rollback_status" -eq 0 ]; then
    log 'POWERFUL_ROLLBACK=passed DEFAULT=fast'
  else
    printf 'constructor-model-switch: POWERFUL_ROLLBACK=failed EXIT=%s\n' \
      "$rollback_status" >&2
  fi
  exit "$status"
}

activate_powerful() {
  local candidate expected current pid
  verify_powerful_artifacts
  expected=$(expected_powerful_dropin)
  current=$(active_alias 2>/dev/null || true)
  if [ -f "$RUNTIME_DROPIN" ] && [ ! -L "$RUNTIME_DROPIN" ] \
    && [ "$(<"$RUNTIME_DROPIN")" = "$expected" ] \
    && [ ! -e "$LEGACY_DROPIN" ] \
    && [ "$current" = "$POWERFUL_ALIAS" ] \
    && systemctl is-active --quiet "$LLAMA_UNIT" \
    && ! systemctl is-active --quiet "$WEB_UNIT"; then
    pid=$(systemctl show "$LLAMA_UNIT" -p MainPID --value)
    [[ "$pid" =~ ^[1-9][0-9]*$ ]]
    [ "$(readlink -f -- "/proc/$pid/exe")" = "$LLAMA_BIN" ]
    awk -v target="$POWERFUL_ROOT/$POWERFUL_FIRST" \
      '$NF == target {found=1} END {exit !found}' "/proc/$pid/maps"
    verify_loopback_listener "$pid"
    publish_state "$POWERFUL_PROFILE" "$POWERFUL_ALIAS"
    log "PROFILE=$POWERFUL_PROFILE ALIAS=$POWERFUL_ALIAS STATUS=already-active"
    return 0
  fi

  trap 'rollback_to_fast $?' ERR EXIT
  trap 'rollback_to_fast 129' HUP
  trap 'rollback_to_fast 130' INT
  trap 'rollback_to_fast 143' TERM
  systemctl stop "$WEB_UNIT"
  rm -f -- "$LEGACY_DROPIN"
  install -d -o root -g root -m 0755 "$RUNTIME_DROPIN_DIR"
  candidate=$(mktemp "$RUNTIME_DROPIN_DIR/.90-constructor-model.XXXXXX")
  expected_powerful_dropin > "$candidate"
  chown root:root "$candidate"
  chmod 0644 "$candidate"
  mv -f -- "$candidate" "$RUNTIME_DROPIN"
  sync -f "$RUNTIME_DROPIN"
  systemctl daemon-reload
  systemd-analyze verify "$LLAMA_UNIT" >/dev/null
  systemctl reset-failed "$LLAMA_UNIT" >/dev/null 2>&1 || true
  systemctl restart "$LLAMA_UNIT"
  wait_for_alias "$POWERFUL_ALIAS" 3600
  pid=$(systemctl show "$LLAMA_UNIT" -p MainPID --value)
  [[ "$pid" =~ ^[1-9][0-9]*$ ]]
  [ "$(readlink -f -- "/proc/$pid/exe")" = "$LLAMA_BIN" ]
  awk -v target="$POWERFUL_ROOT/$POWERFUL_FIRST" \
    '$NF == target {found=1} END {exit !found}' "/proc/$pid/maps"
  verify_loopback_listener "$pid"
  publish_state "$POWERFUL_PROFILE" "$POWERFUL_ALIAS"
  trap - ERR EXIT HUP INT TERM
  log "PROFILE=$POWERFUL_PROFILE ALIAS=$POWERFUL_ALIAS STATUS=active WEB=stopped"
}

[ "$(id -u)" = 0 ] || { fail 'root este obligatoriu'; exit 1; }
[ "$#" -eq 1 ] || { fail 'utilizare: constructor-model-switch --prepare-lock|fast|powerful'; exit 2; }
if [ "$1" = --prepare-lock ]; then
  prepare_lock_file
  log 'INTERLOCK=ready'
  exit 0
fi
profile=$1
case "$profile" in
  "$FAST_PROFILE"|"$POWERFUL_PROFILE") ;;
  *) fail 'profil necunoscut; sunt permise numai fast și powerful'; exit 2 ;;
esac

require_regular "$LLAMA_BIN"
prepare_lock_file
exec 9<>"$LOCK_FILE"
[ ! -L "$LOCK_FILE" ] \
  && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/9")" = "$(stat -Lc '%d:%i' "$LOCK_FILE")" ] \
  || { fail 'identitatea lockului s-a schimbat'; exit 1; }
flock -w 3600 9 || { fail 'timeout la lockul exclusiv al modelului'; exit 1; }

case "$profile" in
  "$FAST_PROFILE") activate_fast ;;
  "$POWERFUL_PROFILE") activate_powerful ;;
esac
