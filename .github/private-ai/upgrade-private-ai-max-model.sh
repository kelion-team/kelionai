#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly MODEL_REPO='unsloth/Qwen3.5-122B-A10B-GGUF'
readonly MODEL_REVISION='a97b483a9f8cad9788776aa0112a2c63bf349e9e'
readonly MODEL_QUANT='Q4_K_M'
readonly MODEL_ALIAS='qwen3.5-122b-a10b-local'
readonly MODEL_ID="llama.cpp/${MODEL_ALIAS}"
readonly MODEL_ROOT='/srv/private-ai/models/qwen3.5-122b-a10b-q4_k_m'
readonly MODEL_FIRST='Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf'
readonly MODEL_TOTAL_BYTES='76536964608'
readonly FAST_MODEL_ALIAS='qwen3.6-35b-a3b-local'
readonly FAST_MODEL_ID="llama.cpp/${FAST_MODEL_ALIAS}"
readonly FAST_MODEL_BYTES='20419565568'
readonly FAST_MODEL_SHA256='671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7'
readonly LLAMA_BIN='/opt/private-ai/bin/llama-server'
readonly OPENCODE_BIN='/opt/private-ai/bin/opencode'
readonly OPENCODE_CONFIG='/srv/private-ai/home/.config/opencode/opencode.json'
readonly WORKER='/opt/kelion-codex/codex-worker.mjs'
readonly WORKER_UNIT='/etc/systemd/system/kelion-codex-worker.service'
readonly SWITCH_BIN='/opt/private-ai/bin/constructor-model-switch'
readonly PERSISTENT_DROPIN='/etc/systemd/system/private-ai-llm.service.d/90-qwen35-122b-max.conf'
readonly RUNTIME_DROPIN='/run/systemd/system/private-ai-llm.service.d/90-constructor-model.conf'
readonly SEALED_RECEIPT='/etc/private-ai/.max-model-sealed'
readonly RECEIPT='/etc/private-ai/.max-model-complete'
readonly SCRIPT_ROOT="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly WORKER_SOURCE="$SCRIPT_ROOT/codex-worker.mjs"
readonly CONFIG_SOURCE="$SCRIPT_ROOT/opencode-constructor.json"
readonly WORKER_UNIT_SOURCE="$SCRIPT_ROOT/kelion-codex-worker.service"
readonly SWITCH_SOURCE="$SCRIPT_ROOT/constructor-model-switch.sh"
readonly RANGE_CHUNK_BYTES=$((512 * 1024 * 1024))
readonly RANGE_WORKERS=4
readonly RANGE_FREE_MARGIN_BYTES=$((5 * 1024 * 1024 * 1024))
readonly KELION_ROOT='/root/kelion'
readonly RUNTIME_ROOT='/root/kelion/runtime'
readonly PUBLICATION_LOCK='/root/kelion/publicare.lock'
readonly MAX_MODEL_JOURNAL='/root/kelion/runtime/constructor-max-model.journal'
readonly REACTIVATION_JOURNAL='/root/kelion/runtime/constructor-reactivation.journal'
readonly ACTIVATION_PENDING='/run/kelion/constructor-activation.pending'
readonly READY_ROOT='/run/kelion'
readonly READY_STAMP='/run/kelion/runtime-config-recovery.ready'
readonly MODEL_SWITCH_LOCK='/run/lock/private-ai-model-switch.lock'
readonly MODEL_CONTROL_UNIT='kelion-constructor-model-control.service'
readonly MODEL_CONTROL_SOCKET='/run/kelion-constructor-model-control/control.sock'
readonly RUNTIME_HELPER='/root/kelion/bin/runtime-config-cutover.sh'
readonly RUNTIME_COMPOSE='/root/kelion/config/compose.production.yml'
max_model_ready_was_present=''
max_model_existing_active_profile=''

readonly -a SHARD_NAMES=(
  'Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf'
  'Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf'
  'Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf'
)
readonly -a SHARD_BYTES=(
  '10943552'
  '49968146912'
  '26557874144'
)
readonly -a SHARD_SHA256=(
  '467c9bd92ea518539cf75bf5a5fbfbd35e9a0b40d766ccaa67bf120e12041df3'
  '90db14846413aebdac365b57206441437cac5f7e5037d94b325f0167f902e6e7'
  'e3c24b8ebec070bb4f69ea0aca25a16531da7440cd515529953e046882901f97'
)

fail() { printf 'max-model: ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf 'max-model: %s\n' "$*"; }

# Orice comandă care pică sub `set -e` fără să treacă prin `fail` (test `[ … ]`,
# `jq -e`, `grep -q`, `!`, pipeline sub pipefail, helper extern) ajungea în
# journal doar ca `MAX_MODEL_ROLLBACK=yes EXIT=N`, fără nicio explicație.
# Trapul ERR de mai jos scrie comanda, linia și statusul ÎNAINTE de rollback,
# ca fiecare cădere să fie explicabilă din jurnal. `set -E` (linia 2) face ca
# trapul să fie moștenit și în funcții/subshell-uri.
report_silent_failure() {
  local status=$1 line=$2 command=$3
  printf "max-model: ERROR: comanda '%s' a picat la linia %s cu status %s\n" \
    "$command" "$line" "$status" >&2
}
trap 'report_silent_failure "$?" "$LINENO" "$BASH_COMMAND"' ERR

require_regular() {
  local path=$1
  [ -f "$path" ] && [ ! -L "$path" ] || fail "fișier lipsă sau nesigur: $path"
  [ "$(stat -Lc '%h' "$path")" = 1 ] || fail "hardlink neașteptat: $path"
}

validate_max_model_journal() {
  [ -f "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$MAX_MODEL_JOURNAL")" = '0:0:600:1' ] \
    && [ "$(wc -l < "$MAX_MODEL_JOURNAL")" -eq 3 ] \
    && [ "$(sed -n '1p' "$MAX_MODEL_JOURNAL")" = 'schema=1' ] \
    && [ "$(sed -n '2p' "$MAX_MODEL_JOURNAL")" = 'kind=constructor-max-model' ] \
    && [[ "$(sed -n '3p' "$MAX_MODEL_JOURNAL")" =~ ^ready_was_present=[01]$ ]]
}

guard_conflicting_runtime_transactions() {
  local conflict
  for conflict in \
    "$RUNTIME_ROOT/constructor-deploy-quiesce.journal" \
    "$RUNTIME_ROOT/constructor-upgrade.journal" \
    "$RUNTIME_ROOT/runtime-config-cutover.journal" \
    "$RUNTIME_ROOT/constructor-activation.journal" \
    "$RUNTIME_ROOT/constructor-gate-refresh.journal" \
    "$RUNTIME_ROOT/constructor-unit-migration.pending" \
    "$RUNTIME_ROOT/constructor-reactivation.journal" \
    "$RUNTIME_ROOT/destructive-cutover-recovery.json"; do
    [ ! -e "$conflict" ] && [ ! -L "$conflict" ] \
      || fail "altă tranzacție runtime este activă: $(basename -- "$conflict")"
  done
}

acquire_canonical_publication_lock() {
  local identity
  [ -d "$KELION_ROOT" ] && [ ! -L "$KELION_ROOT" ] \
    && [ "$(realpath -e -- "$KELION_ROOT")" = "$KELION_ROOT" ] || return 1
  [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$PUBLICATION_LOCK")" = '0:0:600:1' ] || return 1
  identity=$(stat -Lc '%d:%i' "$PUBLICATION_LOCK") || return 1
  exec 9<>"$PUBLICATION_LOCK" || return 1
  [ "$(readlink /proc/$$/fd/9)" = "$PUBLICATION_LOCK" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] \
    && [ "$(stat -Lc '%d:%i' /proc/$$/fd/9)" = "$identity" ] || return 1
  flock -n 9 || return 1
  [ ! -L "$PUBLICATION_LOCK" ] \
    && [ "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" = "$identity" ] \
    && flock -n 9
}

publish_max_model_journal() {
  local candidate ready_was_present
  [ -d "$RUNTIME_ROOT" ] && [ ! -L "$RUNTIME_ROOT" ] \
    && [ "$(realpath -e -- "$RUNTIME_ROOT")" = "$RUNTIME_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$RUNTIME_ROOT")" = '0:10050:750' ] || return 1
  if [ -e "$MAX_MODEL_JOURNAL" ] || [ -L "$MAX_MODEL_JOURNAL" ]; then
    validate_max_model_journal || return 1
    max_model_ready_was_present=$(sed -n 's/^ready_was_present=//p' "$MAX_MODEL_JOURNAL")
    return
  fi
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$READY_STAMP")" = '0:0:444:1' ] \
      && [ "$(wc -l < "$READY_STAMP")" -eq 1 ] \
      && grep -qx 'schema=1' "$READY_STAMP" || return 1
    ready_was_present=1
  else
    ready_was_present=0
  fi
  candidate=$(mktemp "$RUNTIME_ROOT/.constructor-max-model.XXXXXX") || return 1
  if printf 'schema=1\nkind=constructor-max-model\nready_was_present=%s\n' \
      "$ready_was_present" > "$candidate" \
    && chown root:root "$candidate" && chmod 0600 "$candidate" \
    && sync -f "$candidate" \
    && mv -f -- "$candidate" "$MAX_MODEL_JOURNAL" \
    && sync -f "$RUNTIME_ROOT" \
    && validate_max_model_journal; then
    max_model_ready_was_present=$ready_was_present
    return 0
  fi
  rm -f -- "$candidate"
  return 1
}

publish_runtime_ready_stamp() {
  local candidate
  case "$max_model_ready_was_present" in 0) return 0 ;; 1) ;; *) return 1 ;; esac
  [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] || return 1
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$READY_STAMP")" = '0:0:444:1' ] \
      && [ "$(wc -l < "$READY_STAMP")" -eq 1 ] \
      && grep -qx 'schema=1' "$READY_STAMP"
    return
  fi
  candidate=$(mktemp "$READY_ROOT/.runtime-config-recovery.ready.XXXXXX") || return 1
  if printf 'schema=1\n' > "$candidate" \
    && chown root:root "$candidate" && chmod 0444 "$candidate" \
    && sync -f "$candidate" \
    && mv -f -- "$candidate" "$READY_STAMP" \
    && sync -f "$READY_ROOT"; then
    return 0
  fi
  rm -f -- "$candidate"
  return 1
}

validate_activation_pending() {
  [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
    && [ "$(realpath -e -- "$READY_ROOT")" = "$READY_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] \
    && [ -f "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ACTIVATION_PENDING")" = '0:0:444:1' ] \
    && [ "$(wc -l < "$ACTIVATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$ACTIVATION_PENDING"
}

publish_activation_pending() {
  local candidate
  if [ -e "$READY_ROOT" ] || [ -L "$READY_ROOT" ]; then
    [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
      && [ "$(realpath -e -- "$READY_ROOT")" = "$READY_ROOT" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] || return 1
  else
    install -d -o root -g root -m 0755 "$READY_ROOT" || return 1
    sync -f /run || return 1
  fi
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$READY_STAMP")" = '0:0:444:1' ] || return 1
    rm -f -- "$READY_STAMP" || return 1
    sync -f "$READY_ROOT" || return 1
  fi
  if [ -e "$ACTIVATION_PENDING" ] || [ -L "$ACTIVATION_PENDING" ]; then
    validate_activation_pending
    return
  fi
  candidate=$(mktemp "$READY_ROOT/.constructor-activation.pending.XXXXXX") || return 1
  if printf 'schema=1\n' > "$candidate" \
    && chown root:root "$candidate" && chmod 0444 "$candidate" \
    && sync -f "$candidate" \
    && mv -f -- "$candidate" "$ACTIVATION_PENDING" \
    && sync -f "$READY_ROOT" \
    && validate_activation_pending; then
    return 0
  fi
  rm -f -- "$candidate"
  return 1
}

validate_reactivation_journal() {
  [ -f "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$REACTIVATION_JOURNAL")" = '0:0:600:1' ] \
    && jq -e '
      .schema == 1 and .kind == "constructor-reactivation" and .phase == "pending" and
      (keys == ["kind","phase","schema"])
    ' "$REACTIVATION_JOURNAL" >/dev/null
}

publish_reactivation_journal() {
  local candidate
  if [ -e "$REACTIVATION_JOURNAL" ] || [ -L "$REACTIVATION_JOURNAL" ]; then
    validate_reactivation_journal
    return
  fi
  candidate=$(mktemp "$RUNTIME_ROOT/.constructor-reactivation.journal.XXXXXX") || return 1
  if jq -nc '{schema:1,kind:"constructor-reactivation",phase:"pending"}' > "$candidate" \
    && chown root:root "$candidate" && chmod 0600 "$candidate" \
    && sync -f "$candidate" \
    && mv -f -- "$candidate" "$REACTIVATION_JOURNAL" \
    && sync -f "$RUNTIME_ROOT" \
    && validate_reactivation_journal; then
    return 0
  fi
  rm -f -- "$candidate"
  return 1
}

clear_reactivation_journal() {
  validate_reactivation_journal || return 1
  rm -f -- "$REACTIVATION_JOURNAL" || return 1
  sync -f "$RUNTIME_ROOT"
}

validate_model_controller_quiesced() {
  local state
  systemctl cat "$MODEL_CONTROL_UNIT" >/dev/null 2>&1 || return 1
  state=$(systemctl show "$MODEL_CONTROL_UNIT" --property=ActiveState --value) || return 1
  case "$state" in inactive|failed) ;; *) return 1 ;; esac
  [ -z "$(systemctl list-jobs --no-legend --plain "$MODEL_CONTROL_UNIT" 2>/dev/null)" ] \
    && [ ! -e "$MODEL_CONTROL_SOCKET" ] && [ ! -L "$MODEL_CONTROL_SOCKET" ]
}

quiesce_model_controller() {
  systemctl stop "$MODEL_CONTROL_UNIT" >/dev/null 2>&1 || :
  validate_model_controller_quiesced || return 1
  "$SWITCH_BIN" --prepare-lock >/dev/null || return 1
  [ -f "$MODEL_SWITCH_LOCK" ] && [ ! -L "$MODEL_SWITCH_LOCK" ] \
    && [ "$(stat -Lc '%U:%G:%a:%h' "$MODEL_SWITCH_LOCK")" = 'root:privateai:660:1' ] || return 1
  # Drenează orice helper ACK-uit înaintea publicării blockerului. Controllerul
  # este deja oprit, deci după acest prag nu mai poate apărea un nou switch.
  flock --exclusive --wait 3600 "$MODEL_SWITCH_LOCK" /usr/bin/true || return 1
  validate_model_controller_quiesced
}

commit_max_model_gate_and_start_controller() {
  local attempt
  validate_max_model_journal && validate_activation_pending || return 1
  [ "$max_model_ready_was_present" = 1 ] || return 1
  # Jurnalul persistent rămâne autoritatea fail-closed până când sentinelul
  # volatil este retras. Înainte de unlink publicăm markerul comun, care rămâne
  # până după controller+UDS și worker.timer; serviciul worker este blocat de
  # ConditionPathExists cât markerul există.
  publish_reactivation_journal || return 1
  rm -f -- "$ACTIVATION_PENDING" || return 1
  sync -f "$READY_ROOT" || return 1
  publish_runtime_ready_stamp || return 1
  rm -f -- "$MAX_MODEL_JOURNAL" || return 1
  sync -f "$RUNTIME_ROOT" || return 1
  if ! systemctl start "$MODEL_CONTROL_UNIT"; then
    publish_max_model_journal || :
    publish_activation_pending || :
    systemctl stop "$MODEL_CONTROL_UNIT" >/dev/null 2>&1 || :
    return 1
  fi
  for ((attempt = 1; attempt <= 40; attempt++)); do
    if systemctl is-active --quiet "$MODEL_CONTROL_UNIT" \
      && [ -S "$MODEL_CONTROL_SOCKET" ] && [ ! -L "$MODEL_CONTROL_SOCKET" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$MODEL_CONTROL_SOCKET")" = '0:10050:660' ]; then
      systemctl enable kelion-codex-worker.timer >/dev/null || return 1
      systemctl restart kelion-codex-worker.timer || return 1
      systemctl is-enabled --quiet kelion-codex-worker.timer || return 1
      systemctl is-active --quiet kelion-codex-worker.timer || return 1
      clear_reactivation_journal || return 1
      return 0
    fi
    [ "$attempt" -lt 40 ] || break
    sleep 0.25
  done
  publish_max_model_journal || :
  publish_activation_pending || :
  systemctl stop "$MODEL_CONTROL_UNIT" >/dev/null 2>&1 || :
  return 1
}

recover_interrupted_max_model_reactivation() {
  if [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ]; then return 0; fi
  validate_reactivation_journal || return 1
  if [ -e "$MAX_MODEL_JOURNAL" ] || [ -L "$MAX_MODEL_JOURNAL" ]; then
    # MAX + sentinelul volatil sunt încă autoritatea mai veche; controllerul
    # este redrenat înainte ca markerul redundant să fie retras.
    validate_max_model_journal && validate_activation_pending || return 1
    quiesce_model_controller || return 1
    clear_reactivation_journal
    return
  fi
  [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] || return 1
  validate_existing_complete_install || return 1
  [ -f "$RUNTIME_HELPER" ] && [ ! -L "$RUNTIME_HELPER" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RUNTIME_HELPER")" = '0:0:500:1' ] || return 1
  [ -f "$RUNTIME_COMPOSE" ] && [ ! -L "$RUNTIME_COMPOSE" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RUNTIME_COMPOSE")" = '0:0:444:1' ] || return 1
  KELION_CUTOVER_LOCK_HELD=1 "$RUNTIME_HELPER" --recover-only "$RUNTIME_COMPOSE" || return 1
  [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ]
}

verify_shard() {
  local path=$1 bytes=$2 sha=$3
  require_regular "$path"
  [ "$(stat -Lc '%s' "$path")" = "$bytes" ] || return 1
  [ "$(sha256sum "$path" | awk '{print $1}')" = "$sha" ] || return 1
}

validate_existing_complete_install() {
  local fast_model_path active_alias active_profile model_path llm_pid dropins index
  local -a lines=() sealed_lines=()
  [ "$(stat -Lc '%U:%G:%a' "$MODEL_ROOT")" = 'root:privateai:750' ] || return 1
  require_regular "$RECEIPT"
  [ "$(stat -Lc '%u:%g:%a:%h' "$RECEIPT")" = '0:0:600:1' ] || return 1
  mapfile -t lines < "$RECEIPT"
  [ "${#lines[@]}" -eq 20 ] || return 1
  [ "${lines[0]}" = 'schema=2' ] \
    && [ "${lines[1]}" = "default_model=$FAST_MODEL_ID" ] \
    && [ "${lines[2]}" = "powerful_model=$MODEL_ID" ] \
    && [ "${lines[3]}" = 'active_profile=fast' ] \
    && [ "${lines[4]}" = "model_repo=$MODEL_REPO" ] \
    && [ "${lines[5]}" = "model_revision=$MODEL_REVISION" ] \
    && [ "${lines[6]}" = "model_quant=$MODEL_QUANT" ] \
    && [ "${lines[7]}" = "model_total_bytes=$MODEL_TOTAL_BYTES" ] \
    && [ "${lines[8]}" = "shard_1_sha256=${SHARD_SHA256[0]}" ] \
    && [ "${lines[9]}" = "shard_2_sha256=${SHARD_SHA256[1]}" ] \
    && [ "${lines[10]}" = "shard_3_sha256=${SHARD_SHA256[2]}" ] \
    && [ "${lines[11]}" = "fast_model_bytes=$FAST_MODEL_BYTES" ] \
    && [ "${lines[12]}" = "fast_model_sha256=$FAST_MODEL_SHA256" ] || return 1
  fast_model_path=${lines[13]#fast_model_path=}
  [ "${lines[13]}" = "fast_model_path=$fast_model_path" ] \
    && [[ "$fast_model_path" == /srv/private-ai/models/* ]] \
    && [ "$(realpath -e -- "$fast_model_path")" = "$fast_model_path" ] || return 1
  [[ "${lines[14]}" =~ ^installer_sha256=[0-9a-f]{64}$ ]] \
    && [[ "${lines[15]}" =~ ^worker_source_sha256=[0-9a-f]{64}$ ]] \
    && [[ "${lines[16]}" =~ ^config_source_sha256=[0-9a-f]{64}$ ]] \
    && [[ "${lines[17]}" =~ ^worker_unit_source_sha256=[0-9a-f]{64}$ ]] \
    && [[ "${lines[18]}" =~ ^switch_source_sha256=[0-9a-f]{64}$ ]] \
    && [[ "${lines[19]}" =~ ^verified_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || return 1
  require_regular "$fast_model_path"
  [ "$(stat -Lc '%U:%G:%s:%h' "$fast_model_path")" \
      = "privateai:privateai:${FAST_MODEL_BYTES}:1" ] || return 1
  [ "$(sha256sum "$fast_model_path" | awk '{print $1}')" = "$FAST_MODEL_SHA256" ] || return 1

  require_regular "$SEALED_RECEIPT"
  [ "$(stat -Lc '%u:%g:%a:%h' "$SEALED_RECEIPT")" = '0:0:600:1' ] || return 1
  mapfile -t sealed_lines < "$SEALED_RECEIPT"
  [ "${#sealed_lines[@]}" -eq 9 ] \
    && [ "${sealed_lines[0]}" = 'schema=1' ] \
    && [ "${sealed_lines[1]}" = "model_repo=$MODEL_REPO" ] \
    && [ "${sealed_lines[2]}" = "model_revision=$MODEL_REVISION" ] \
    && [ "${sealed_lines[3]}" = "model_quant=$MODEL_QUANT" ] \
    && [ "${sealed_lines[4]}" = "model_total_bytes=$MODEL_TOTAL_BYTES" ] \
    && [ "${sealed_lines[5]}" = "shard_1_sha256=${SHARD_SHA256[0]}" ] \
    && [ "${sealed_lines[6]}" = "shard_2_sha256=${SHARD_SHA256[1]}" ] \
    && [ "${sealed_lines[7]}" = "shard_3_sha256=${SHARD_SHA256[2]}" ] \
    && [[ "${sealed_lines[8]}" =~ ^sealed_at=[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$ ]] \
    || return 1
  for index in 0 1 2; do
    verify_shard "$MODEL_ROOT/${SHARD_NAMES[$index]}" \
      "${SHARD_BYTES[$index]}" "${SHARD_SHA256[$index]}" || return 1
    [ "$(stat -Lc '%U:%G:%a:%s:%h' "$MODEL_ROOT/${SHARD_NAMES[$index]}")" \
        = "root:privateai:440:${SHARD_BYTES[$index]}:1" ] || return 1
  done
  [ ! -e "$PERSISTENT_DROPIN" ] && [ ! -L "$PERSISTENT_DROPIN" ] || return 1
  systemctl is-active --quiet private-ai-llm.service || return 1
  active_alias=$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models \
    | jq -er '.data | select(type == "array" and length == 1) | .[0].id') || return 1
  dropins=$(systemctl show private-ai-llm.service --property=DropInPaths --value) || return 1
  case "$active_alias" in
    "$FAST_MODEL_ALIAS")
      active_profile=fast
      model_path=$fast_model_path
      [ ! -e "$RUNTIME_DROPIN" ] && [ ! -L "$RUNTIME_DROPIN" ] \
        && [[ " $dropins " != *" $RUNTIME_DROPIN "* ]] \
        && systemctl is-active --quiet private-ai-web.service || return 1
      ;;
    "$MODEL_ALIAS")
      active_profile=powerful
      model_path="$MODEL_ROOT/$MODEL_FIRST"
      [ -f "$RUNTIME_DROPIN" ] && [ ! -L "$RUNTIME_DROPIN" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "$RUNTIME_DROPIN")" = '0:0:644:1' ] \
        && [[ " $dropins " == *" $RUNTIME_DROPIN "* ]] \
        && ! systemctl is-active --quiet private-ai-web.service || return 1
      ;;
    *) return 1 ;;
  esac
  llm_pid=$(systemctl show private-ai-llm.service --property=MainPID --value) || return 1
  [[ "$llm_pid" =~ ^[1-9][0-9]*$ ]] \
    && [ "$(readlink -f -- "/proc/$llm_pid/exe")" = "$LLAMA_BIN" ] \
    && awk -v target="$model_path" '$NF == target {found=1} END {exit !found}' \
      "/proc/$llm_pid/maps" \
    && curl --fail --silent --show-error --max-time 10 \
      http://127.0.0.1:24080/health >/dev/null || return 1
  max_model_existing_active_profile=$active_profile
}

remaining_bytes_after_cache() {
  local total=$1 prefix=$2 cached_ranges=${3:-0}
  [[ "$total" =~ ^[0-9]+$ && "$prefix" =~ ^[0-9]+$ && "$cached_ranges" =~ ^[0-9]+$ ]] \
    || return 1
  [ "$prefix" -le "$total" ] && [ "$cached_ranges" -le "$((total - prefix))" ] || return 1
  printf '%s\n' "$((total - prefix - cached_ranges))"
}

calculate_remaining_model_bytes() {
  local index name bytes sha destination partial partial_size range_dir
  local range_start range_end range_bytes range_path cached_range_bytes shard_remaining
  local total_remaining=0
  for index in 0 1 2; do
    name=${SHARD_NAMES[$index]}
    bytes=${SHARD_BYTES[$index]}
    sha=${SHARD_SHA256[$index]}
    destination="$MODEL_ROOT/$name"
    partial="$destination.part"
    if [ -e "$destination" ] || [ -L "$destination" ]; then
      verify_shard "$destination" "$bytes" "$sha" \
        || fail "shard final existent dar invalid: $destination"
      continue
    fi

    partial_size=0
    if [ -e "$partial" ] || [ -L "$partial" ]; then
      require_regular "$partial"
      [ "$(stat -Lc '%U:%G:%a:%h' "$partial")" = 'privateai:privateai:600:1' ] \
        || fail "metadate nesigure pentru descărcarea parțială: $name"
      partial_size=$(stat -Lc '%s' "$partial")
      [[ "$partial_size" =~ ^[0-9]+$ ]] && [ "$partial_size" -le "$bytes" ] \
        || fail "dimensiune parțială invalidă: $name"
    fi

    cached_range_bytes=0
    if [ "$index" = 1 ] && [ "$partial_size" -lt "$bytes" ]; then
      range_dir="${partial}.ranges.${partial_size}.${sha}"
      if [ -e "$range_dir" ] || [ -L "$range_dir" ]; then
        [ -d "$range_dir" ] && [ ! -L "$range_dir" ] \
          && [ "$(stat -Lc '%U:%G:%a' "$range_dir")" = 'privateai:privateai:700' ] \
          || fail "director HTTP Range nesigur: $range_dir"
        for ((range_start = partial_size; range_start < bytes; range_start += RANGE_CHUNK_BYTES)); do
          range_end=$((range_start + RANGE_CHUNK_BYTES - 1))
          [ "$range_end" -lt "$bytes" ] || range_end=$((bytes - 1))
          range_bytes=$((range_end - range_start + 1))
          range_path="$range_dir/$range_start-$range_end.ok"
          if [ -e "$range_path" ] || [ -L "$range_path" ]; then
            require_regular "$range_path"
            [ "$(stat -Lc '%U:%G:%a:%s:%h' "$range_path")" \
                = "privateai:privateai:600:${range_bytes}:1" ] \
              || fail "chunk HTTP Range existent dar invalid: $range_path"
            cached_range_bytes=$((cached_range_bytes + range_bytes))
          fi
        done
      fi
    fi
    shard_remaining=$(remaining_bytes_after_cache "$bytes" "$partial_size" "$cached_range_bytes") \
      || fail "cache parțial inconsistent pentru $name"
    total_remaining=$((total_remaining + shard_remaining))
  done
  printf '%s\n' "$total_remaining"
}

download_shard() {
  local index=$1 name bytes sha destination partial relative url partial_size
  name=${SHARD_NAMES[$index]}
  bytes=${SHARD_BYTES[$index]}
  sha=${SHARD_SHA256[$index]}
  destination="$MODEL_ROOT/$name"
  partial="$destination.part"
  if [ -f "$destination" ] && verify_shard "$destination" "$bytes" "$sha"; then
    chown root:privateai "$destination"
    chmod 0440 "$destination"
    log "Shard $((index + 1))/3 deja verificat."
    return 0
  fi
  [ ! -e "$destination" ] || fail "shard final existent dar invalid: $destination"
  if [ -e "$partial" ] || [ -L "$partial" ]; then
    require_regular "$partial"
    [ "$(stat -Lc '%U:%G:%h' "$partial")" = 'privateai:privateai:1' ] \
      || fail "metadate nesigure pentru descărcarea parțială: $name"
    partial_size=$(stat -Lc '%s' "$partial")
    [[ "$partial_size" =~ ^[0-9]+$ ]] && [ "$partial_size" -le "$bytes" ] \
      || fail "dimensiune parțială invalidă: $name"
  else
    partial_size=0
  fi
  relative="Q4_K_M/$name"
  url="https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${relative}?download=true"
  if [ "$partial_size" -lt "$bytes" ]; then
    log "Descarc shard $((index + 1))/3 ($bytes bytes), reluabil de la $partial_size."
    timeout --signal=TERM --kill-after=2m 21600 \
      runuser -u privateai -- env -i HOME=/srv/private-ai/home PATH=/usr/bin:/bin \
      curl --fail --location --silent --show-error \
        --retry 20 --retry-delay 5 --retry-all-errors \
        --connect-timeout 30 --continue-at - \
        --output "$partial" "$url"
  else
    log "Shard $((index + 1))/3 complet ca dimensiune; verific SHA-256 fără redescărcare."
  fi
  [ "$(stat -Lc '%U:%G:%s:%h' "$partial")" = "privateai:privateai:${bytes}:1" ] \
    || fail "metadate invalide după descărcare: $name"
  if [ "$(sha256sum "$partial" | awk '{print $1}')" != "$sha" ]; then
    rm -f -- "$partial"
    sync -f "$MODEL_ROOT"
    fail "SHA-256 invalid după descărcare; cache retras: $name"
  fi
  mv -f -- "$partial" "$destination"
  chown root:privateai "$destination"
  chmod 0440 "$destination"
  sync -f "$destination"
  [ "$(stat -Lc '%U:%G:%a:%s:%h' "$destination")" = "root:privateai:440:${bytes}:1" ] \
    || fail "metadate invalide după publicarea shardului: $name"
}

download_shard_parallel_ranges() {
  local index=$1 name bytes sha destination partial relative url partial_size
  local range_dir range_start range_end range_bytes range_path
  local free_bytes missing_bytes required_free actual_sha assembly assembly_q
  local range_index batch_status range_pid
  local -a range_starts=() range_ends=() range_paths=() batch_pids=()

  [ "$index" = 1 ] || fail 'descărcarea HTTP Range este permisă numai pentru shardul 2'
  name=${SHARD_NAMES[$index]}
  bytes=${SHARD_BYTES[$index]}
  sha=${SHARD_SHA256[$index]}
  destination="$MODEL_ROOT/$name"
  partial="$destination.part"
  if [ -f "$destination" ] && verify_shard "$destination" "$bytes" "$sha"; then
    chown root:privateai "$destination"
    chmod 0440 "$destination"
    log 'Shard 2/3 deja verificat.'
    return 0
  fi
  [ ! -e "$destination" ] || fail "shard final existent dar invalid: $destination"

  if [ -e "$partial" ] || [ -L "$partial" ]; then
    require_regular "$partial"
    [ "$(stat -Lc '%U:%G:%h' "$partial")" = 'privateai:privateai:1' ] \
      || fail "metadate nesigure pentru descărcarea parțială: $name"
  else
    install -o privateai -g privateai -m 0600 /dev/null "$partial"
    sync -f "$partial"
  fi
  partial_size=$(stat -Lc '%s' "$partial")
  [[ "$partial_size" =~ ^[0-9]+$ ]] && [ "$partial_size" -le "$bytes" ] \
    || fail "dimensiune parțială invalidă: $name"

  relative="Q4_K_M/$name"
  url="https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${relative}?download=true"
  range_dir="${partial}.ranges.${partial_size}.${sha}"

  if [ "$partial_size" -lt "$bytes" ]; then
    [ ! -L "$range_dir" ] || fail "director HTTP Range nesigur: $range_dir"
    install -d -o privateai -g privateai -m 0700 "$range_dir"
    [ -d "$range_dir" ] && [ ! -L "$range_dir" ] \
      && [ "$(stat -Lc '%U:%G:%a' "$range_dir")" = 'privateai:privateai:700' ] \
      || fail "metadate nesigure pentru directorul HTTP Range: $range_dir"

    missing_bytes=0
    for ((range_start = partial_size; range_start < bytes; range_start += RANGE_CHUNK_BYTES)); do
      range_end=$((range_start + RANGE_CHUNK_BYTES - 1))
      [ "$range_end" -lt "$bytes" ] || range_end=$((bytes - 1))
      range_bytes=$((range_end - range_start + 1))
      range_path="$range_dir/$range_start-$range_end.ok"
      range_starts+=("$range_start")
      range_ends+=("$range_end")
      range_paths+=("$range_path")
      if [ -e "$range_path" ] || [ -L "$range_path" ]; then
        require_regular "$range_path"
        [ "$(stat -Lc '%U:%G:%a:%s:%h' "$range_path")" \
            = "privateai:privateai:600:${range_bytes}:1" ] \
          || fail "chunk HTTP Range existent dar invalid: $range_path"
      else
        missing_bytes=$((missing_bytes + range_bytes))
      fi
    done

    free_bytes=$(df -PB1 "$MODEL_ROOT" | awk 'NR == 2 {print $4}')
    [[ "$free_bytes" =~ ^[0-9]+$ ]]
    required_free=$((bytes + missing_bytes + RANGE_FREE_MARGIN_BYTES))
    [ "$free_bytes" -ge "$required_free" ] \
      || fail "spațiu insuficient pentru chunks și asamblarea sigură a shardului 2: necesar $required_free, liber $free_bytes"

    download_range_chunk() {
      local start=$1 end=$2 output=$3 expected_size tmp headers tmp_q headers_q
      local http_code actual_content_range
      expected_size=$((end - start + 1))
      if [ -e "$output" ] || [ -L "$output" ]; then
        require_regular "$output"
        [ "$(stat -Lc '%U:%G:%a:%s:%h' "$output")" \
            = "privateai:privateai:600:${expected_size}:1" ] \
          || fail "chunk HTTP Range invalid: $output"
        return 0
      fi

      tmp=$(runuser -u privateai -- env -i HOME=/srv/private-ai/home PATH=/usr/bin:/bin \
        mktemp "$range_dir/.range.$start.$end.XXXXXX")
      headers="$tmp.headers"
      printf -v tmp_q '%q' "$tmp"
      printf -v headers_q '%q' "$headers"
      trap "rm -f -- $tmp_q $headers_q" EXIT HUP INT TERM
      if http_code=$(timeout --signal=TERM --kill-after=1m 3600 \
        runuser -u privateai -- env -i HOME=/srv/private-ai/home PATH=/usr/bin:/bin \
        curl --fail --location --silent --show-error \
          --retry 20 --retry-delay 5 --retry-all-errors \
          --connect-timeout 30 --remove-on-error --max-filesize "$expected_size" \
          --range "$start-$end" --dump-header "$headers" \
          --output "$tmp" --write-out '%{http_code}' "$url"); then
        :
      else
        return $?
      fi
      [ "$http_code" = 206 ] || fail "HTTP Range nu a răspuns cu 206: $start-$end ($http_code)"
      actual_content_range=$(tr -d '\r' < "$headers" | awk \
        'tolower($1) == "content-range:" {value=tolower($0)} END {print value}')
      [ "$actual_content_range" = "content-range: bytes $start-$end/$bytes" ] \
        || fail "Content-Range invalid: $start-$end"
      [ "$(stat -Lc '%U:%G:%a:%s:%h' "$tmp")" \
          = "privateai:privateai:600:${expected_size}:1" ] \
        || fail "dimensiune sau metadate invalide pentru chunk: $start-$end"
      rm -f -- "$headers"
      mv -T -- "$tmp" "$output"
      sync -f "$output"
      trap - EXIT HUP INT TERM
    }

    log "Accelerez shardul 2/3 de la $partial_size cu $RANGE_WORKERS conexiuni HTTP Range."
    batch_status=0
    for range_index in "${!range_paths[@]}"; do
      if [ ! -e "${range_paths[$range_index]}" ]; then
        download_range_chunk "${range_starts[$range_index]}" \
          "${range_ends[$range_index]}" "${range_paths[$range_index]}" &
        batch_pids+=("$!")
      fi
      if [ "${#batch_pids[@]}" -eq "$RANGE_WORKERS" ]; then
        for range_pid in "${batch_pids[@]}"; do
          wait "$range_pid" || batch_status=$?
        done
        [ "$batch_status" = 0 ] || fail 'descărcarea unui batch HTTP Range a eșuat; prefixul .part a fost păstrat'
        batch_pids=()
      fi
    done
    for range_pid in "${batch_pids[@]}"; do
      wait "$range_pid" || batch_status=$?
    done
    [ "$batch_status" = 0 ] || fail 'descărcarea HTTP Range a eșuat; prefixul .part a fost păstrat'

    for range_index in "${!range_paths[@]}"; do
      range_bytes=$((${range_ends[$range_index]} - ${range_starts[$range_index]} + 1))
      require_regular "${range_paths[$range_index]}"
      [ "$(stat -Lc '%U:%G:%a:%s:%h' "${range_paths[$range_index]}")" \
          = "privateai:privateai:600:${range_bytes}:1" ] \
        || fail "chunk invalid înainte de asamblare: ${range_paths[$range_index]}"
    done

    [ "$(stat -Lc '%s' "$partial")" = "$partial_size" ] \
      || fail 'prefixul .part s-a modificat în timpul descărcării HTTP Range'
    assembly=$(mktemp "$MODEL_ROOT/.${name}.assembly.XXXXXX")
    printf -v assembly_q '%q' "$assembly"
    trap "rm -f -- $assembly_q" EXIT HUP INT TERM
    cp --reflink=auto -- "$partial" "$assembly"
    [ "$(stat -Lc '%s' "$assembly")" = "$partial_size" ] \
      || fail 'copierea prefixului în assembly a eșuat'
    for range_path in "${range_paths[@]}"; do
      cat -- "$range_path" >> "$assembly"
    done
    [ "$(stat -Lc '%s' "$assembly")" = "$bytes" ] \
      || fail 'dimensiunea assembly nu corespunde shardului 2'
  else
    log 'Shard 2/3 complet ca dimensiune; verific SHA-256 fără redescărcare.'
    assembly=$partial
    assembly_q=''
  fi

  actual_sha=$(sha256sum "$assembly" | awk '{print $1}')
  if [ "$actual_sha" != "$sha" ]; then
    # Nici prefixul .part, nici chunkurile validate numai prin dimensiune nu mai
    # sunt reutilizabile după ce hashul obiectului complet a eșuat. Retragem tot
    # cache-ul acestui shard și forțăm reluarea byte-zero la următoarea invocare.
    if [ -n "${range_dir:-}" ] && [ -d "$range_dir" ] && [ ! -L "$range_dir" ]; then
      for range_path in "${range_paths[@]}"; do
        rm -f -- "$range_path"
      done
      rmdir -- "$range_dir" 2>/dev/null || true
    fi
    if [ -e "$partial" ] || [ -L "$partial" ]; then
      require_regular "$partial"
      rm -f -- "$partial"
    fi
    sync -f "$MODEL_ROOT"
    fail 'SHA-256 invalid pentru shardul 2; cache-ul neautentificat a fost retras și va fi redescărcat integral'
  fi
  chown root:privateai "$assembly"
  chmod 0440 "$assembly"
  [ "$(stat -Lc '%U:%G:%a:%s:%h' "$assembly")" = "root:privateai:440:${bytes}:1" ] \
    || fail 'metadate invalide pentru assembly shard 2'
  mv -T -- "$assembly" "$destination"
  sync -f "$destination"
  [ "$(stat -Lc '%U:%G:%a:%s:%h' "$destination")" = "root:privateai:440:${bytes}:1" ] \
    || fail 'metadate invalide după publicarea shardului 2'
  trap - EXIT HUP INT TERM
  if [ -e "$partial" ] && [ "$partial" != "$destination" ]; then
    rm -f -- "$partial"
  fi
  if [ -n "${range_dir:-}" ] && [ -d "$range_dir" ] && [ ! -L "$range_dir" ]; then
    for range_path in "${range_paths[@]}"; do
      rm -f -- "$range_path"
    done
    rmdir -- "$range_dir" 2>/dev/null || true
  fi
}

[ "$(id -u)" = 0 ] || fail 'root este obligatoriu'
require_regular /etc/private-ai/.install-complete
require_regular "$LLAMA_BIN"
require_regular "$OPENCODE_BIN"
require_regular "$OPENCODE_CONFIG"
require_regular "$WORKER"
require_regular "$WORKER_UNIT"
require_regular "$SWITCH_BIN"
for source in "$WORKER_SOURCE" "$CONFIG_SOURCE" "$WORKER_UNIT_SOURCE" "$SWITCH_SOURCE"; do
  require_regular "$source"
  [ "$(stat -Lc '%u:%g:%a:%h' "$source")" = '0:0:400:1' ] \
    || fail "sursă canonică transportată cu metadate invalide: $source"
done
[ -x "$LLAMA_BIN" ] && [ -x "$OPENCODE_BIN" ] || fail 'binarele private AI nu sunt executabile'
[ "$(awk '/MemTotal:/ {print $2}' /proc/meminfo)" -ge 94371840 ] \
  || fail 'Qwen3.5-122B Q4 necesită VPS-ul de 96 GB RAM'

node --check "$WORKER_SOURCE"
bash -n "$SWITCH_SOURCE"
jq -e --arg fast "$FAST_MODEL_ID" --arg powerful "$MODEL_ID" '
  .model == $fast and .small_model == $fast and
  .enabled_providers == ["llama.cpp"] and
  (.provider | keys) == ["llama.cpp"] and
  (.provider["llama.cpp"].options | has("apiKey") | not) and
  (.provider["llama.cpp"].models | has("qwen3.6-35b-a3b-local")) and
  (.provider["llama.cpp"].models | has("qwen3.5-122b-a10b-local")) and
  .provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1"
' "$CONFIG_SOURCE" >/dev/null
[ "$(grep -c '^Environment=OPENCODE_MODEL=llama.cpp/qwen3.6-35b-a3b-local$' \
  "$WORKER_UNIT_SOURCE")" -eq 1 ]
! grep -q '^Environment=OPENCODE_POWERFUL_MODEL=' "$WORKER_UNIT_SOURCE"
! grep -Fq 'Environment=OPENCODE_MODEL=llama.cpp/qwen3.5-122b-a10b-local' \
  "$WORKER_UNIT_SOURCE"
! grep -Eq '^ExecStopPost=.*constructor-model-switch[[:space:]]+fast([[:space:]]|$)' \
  "$WORKER_UNIT_SOURCE"

acquire_canonical_publication_lock \
  || fail 'lock-ul canonic /root/kelion/publicare.lock este ocupat sau nesigur'
recover_interrupted_max_model_reactivation \
  || fail 'reactivarea max-model întreruptă nu poate fi reluată sigur'
guard_conflicting_runtime_transactions
if [ -e "$MAX_MODEL_JOURNAL" ] || [ -L "$MAX_MODEL_JOURNAL" ]; then
  validate_max_model_journal || fail 'jurnalul max-model existent este nesigur'
elif [ -e "$ACTIVATION_PENDING" ] || [ -L "$ACTIVATION_PENDING" ]; then
  fail 'un blocker de activare fără jurnal max-model este deja prezent'
fi
publish_max_model_journal || fail 'jurnalul persistent max-model nu poate fi publicat'
publish_activation_pending || fail 'sentinelul volatil max-model nu poate fi publicat'
quiesce_model_controller || fail 'controllerul manual nu poate fi oprit și drenat înainte de max-model'
guard_conflicting_runtime_transactions

# Până la crearea snapshotului de runtime și armarea rollbackului nu s-a
# modificat încă runtime-ul activ. Eșecurile de download/cache păstrează
# intenționat jurnalul + sentinelul și controllerul oprit: următoarea invocare
# reia sub aceleași lockuri, fără să expună un ACK concurent peste bytes parțiali.

[ ! -L "$MODEL_ROOT" ] || fail "directorul modelului este un symlink: $MODEL_ROOT"
if [ -e "$MODEL_ROOT" ]; then
  [ -d "$MODEL_ROOT" ] && [ ! -L "$MODEL_ROOT" ] \
    && [ "$(realpath -e -- "$MODEL_ROOT")" = "$MODEL_ROOT" ] \
    || fail 'directorul modelului existent este nesigur'
  case "$(stat -Lc '%U:%G:%a' "$MODEL_ROOT")" in
    privateai:privateai:700|root:privateai:750) ;;
    *) fail 'metadate nesigure pentru directorul modelului' ;;
  esac
else
  install -d -o privateai -g privateai -m 0700 "$MODEL_ROOT"
  [ "$(stat -Lc '%U:%G:%a' "$MODEL_ROOT")" = 'privateai:privateai:700' ] \
    || fail 'metadate nesigure pentru directorul modelului'
fi
if [ -e "$RECEIPT" ] || [ -L "$RECEIPT" ]; then
  validate_existing_complete_install \
    || fail 'receiptul max-model existent nu dovedește o instalare completă și coerentă'
  commit_max_model_gate_and_start_controller \
    || fail 'controllerul manual nu a revenit după no-op-ul max-model committed'
  printf 'ACTIVE_PROFILE=%s\n' "$max_model_existing_active_profile"
  printf 'DUAL_MODELS_ON_DISK=yes\n'
  printf 'MAX_MODEL_ALREADY_INSTALLED=yes\n'
  printf 'MAX_MODEL_INSTALLED=yes\n'
  exit 0
fi
remaining_model_bytes=$(calculate_remaining_model_bytes)
if [ "$remaining_model_bytes" -gt 0 ]; then
  free_model_bytes=$(df -PB1 "$MODEL_ROOT" | awk 'NR == 2 {print $4}')
  [[ "$free_model_bytes" =~ ^[0-9]+$ ]]
  required_model_free_bytes=$((remaining_model_bytes + RANGE_FREE_MARGIN_BYTES))
  [ "$free_model_bytes" -ge "$required_model_free_bytes" ] \
    || fail "spațiu insuficient pentru bytes rămași și headroom: necesar $required_model_free_bytes, liber $free_model_bytes"
fi
download_shard 0
# Shardul 2 poate avea nevoie de un assembly complet dacă filesystemul nu oferă
# reflink. Îl finalizăm și îi retragem scratch-ul înainte să pornim shardul 3;
# astfel gate-ul său `bytes + missing + headroom` nu concurează cu încă 26,5 GB.
download_shard_parallel_ranges 1
download_shard 2

sum=0
for index in 0 1 2; do
  require_regular "$MODEL_ROOT/${SHARD_NAMES[$index]}"
  [ "$(stat -Lc '%U:%G:%a:%s:%h' "$MODEL_ROOT/${SHARD_NAMES[$index]}")" \
      = "root:privateai:440:${SHARD_BYTES[$index]}:1" ] \
    || fail "shard invalid înainte de activare: ${SHARD_NAMES[$index]}"
  sum=$((sum + ${SHARD_BYTES[$index]}))
done
[ "$sum" = "$MODEL_TOTAL_BYTES" ] || fail 'dimensiunea totală a modelului nu corespunde'
chown root:privateai "$MODEL_ROOT"
chmod 0750 "$MODEL_ROOT"
[ "$(stat -Lc '%U:%G:%a' "$MODEL_ROOT")" = 'root:privateai:750' ] \
  || fail 'directorul modelului nu a putut fi sigilat'

[ ! -L "$SEALED_RECEIPT" ] || fail 'receiptul sealed 122B este un symlink'
sealed_candidate=$(mktemp /etc/private-ai/.max-model-sealed.XXXXXX)
{
  printf 'schema=1\n'
  printf 'model_repo=%s\n' "$MODEL_REPO"
  printf 'model_revision=%s\n' "$MODEL_REVISION"
  printf 'model_quant=%s\n' "$MODEL_QUANT"
  printf 'model_total_bytes=%s\n' "$MODEL_TOTAL_BYTES"
  for index in 0 1 2; do
    printf 'shard_%s_sha256=%s\n' "$((index + 1))" "${SHARD_SHA256[$index]}"
  done
  printf 'sealed_at=%s\n' "$(date -u +%FT%TZ)"
} > "$sealed_candidate"
chown root:root "$sealed_candidate"
chmod 0600 "$sealed_candidate"
mv -f -- "$sealed_candidate" "$SEALED_RECEIPT"
sync -f "$SEALED_RECEIPT"

mapfile -d '' -t fast_model_candidates < <(
  find /srv/private-ai/models -xdev -type f -size "${FAST_MODEL_BYTES}c" -print0
)
[ "${#fast_model_candidates[@]}" -eq 1 ] \
  || fail 'modelul fast 35B fixat nu este unic pe disc'
fast_model_path=${fast_model_candidates[0]}
require_regular "$fast_model_path"
[ "$(stat -Lc '%U:%G:%s:%h' "$fast_model_path")" = \
  "privateai:privateai:${FAST_MODEL_BYTES}:1" ] \
  || fail 'metadatele modelului fast 35B sunt invalide'
[ "$(sha256sum "$fast_model_path" | awk '{print $1}')" = "$FAST_MODEL_SHA256" ] \
  || fail 'SHA-256 al modelului fast 35B este invalid'

rollback_root=$(mktemp -d /var/lib/private-ai/.max-model-rollback.XXXXXX)
rollback_armed=0
had_switch=0
current_stage='snapshot-current-runtime'
failure_diagnostic_emitted=0
llm_cutover_attempted=0
cutover_started_at=$(date -u +%FT%TZ)
web_active=$(systemctl is-active private-ai-web.service 2>/dev/null || true)
cp -a -- "$OPENCODE_CONFIG" "$rollback_root/opencode.json"
cp -a -- "$WORKER" "$rollback_root/codex-worker.mjs"
cp -a -- "$WORKER_UNIT" "$rollback_root/kelion-codex-worker.service"
if [ -f "$SWITCH_BIN" ] && [ ! -L "$SWITCH_BIN" ]; then
  had_switch=1
  cp -a -- "$SWITCH_BIN" "$rollback_root/constructor-model-switch"
elif [ -e "$SWITCH_BIN" ] || [ -L "$SWITCH_BIN" ]; then
  fail 'helperul de switch existent este nesigur'
fi
for dropin in "$PERSISTENT_DROPIN" "$RUNTIME_DROPIN"; do
  [ ! -L "$dropin" ] || fail "drop-in LLM existent dar nesigur: $dropin"
done

worker_source_sha=$(sha256sum "$WORKER_SOURCE" | awk '{print $1}')
config_source_sha=$(sha256sum "$CONFIG_SOURCE" | awk '{print $1}')
worker_unit_source_sha=$(sha256sum "$WORKER_UNIT_SOURCE" | awk '{print $1}')
switch_source_sha=$(sha256sum "$SWITCH_SOURCE" | awk '{print $1}')
installer_source_sha=$(sha256sum "${BASH_SOURCE[0]}" | awk '{print $1}')

set_stage() {
  current_stage=$1
  log "STAGE=$current_stage"
}

redact_diagnostic_stream() {
  sed -E \
    -e 's/(Authorization:[[:space:]]*(Bearer|Basic))[[:space:]]+[^[:space:]]+/\1 [REDACTED]/Ig' \
    -e "s/((api[_-]?key|token|secret)[\"']?[=:][[:space:]]*[\"']?)[^\"'[:space:],}]+/\\1[REDACTED]/Ig" \
    -e 's/(sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_-]{8,})/[REDACTED]/g' \
    -e 's#(https?://)[^/@[:space:]]+:[^/@[:space:]]+@#\1[REDACTED]@#g'
}

diagnose_failure() {
  local status=$1 invocation_id
  [ "$failure_diagnostic_emitted" = 0 ] || return 0
  failure_diagnostic_emitted=1

  printf 'MAX_MODEL_FAILURE_STAGE=%s\n' "$current_stage" >&2
  printf 'MAX_MODEL_FAILURE_EXIT=%s\n' "$status" >&2
  printf 'MAX_MODEL_LLM_STATE_BEGIN=yes\n' >&2
  systemctl show private-ai-llm.service \
    -p ActiveState -p SubState -p Result -p MainPID -p ExecMainStatus -p NRestarts \
    2>&1 | redact_diagnostic_stream >&2 || true
  printf 'MAX_MODEL_LLM_STATE_END=yes\n' >&2

  invocation_id=$(systemctl show private-ai-llm.service -p InvocationID --value \
    2>/dev/null || true)
  printf 'MAX_MODEL_LLM_JOURNAL_BEGIN=yes\n' >&2
  if [ "$llm_cutover_attempted" = 1 ] \
    && [[ "$invocation_id" =~ ^[0-9a-f]{32}$ ]]; then
    journalctl --no-pager --no-hostname --output=short-iso-precise \
      "_SYSTEMD_INVOCATION_ID=$invocation_id" --lines=200 2>&1 \
      | redact_diagnostic_stream >&2 || true
  else
    journalctl --no-pager --no-hostname --output=short-iso-precise \
      --unit=private-ai-llm.service --since "$cutover_started_at" --lines=200 2>&1 \
      | redact_diagnostic_stream >&2 || true
  fi
  printf 'MAX_MODEL_LLM_JOURNAL_END=yes\n' >&2
}

publish_canonical() {
  local source=$1 target=$2 owner=$3 group=$4 mode=$5 parent base candidate
  parent=$(dirname -- "$target")
  base=$(basename -- "$target")
  [ -d "$parent" ] && [ ! -L "$parent" ] \
    || fail "director țintă nesigur: $parent"
  [ ! -L "$target" ] || fail "țintă canonică symlink: $target"
  candidate=$(mktemp "$parent/.$base.max-model.XXXXXX")
  install -o "$owner" -g "$group" -m "$mode" "$source" "$candidate"
  cmp -s -- "$source" "$candidate"
  sync -f "$candidate"
  mv -fT -- "$candidate" "$target"
  sync -f "$target"
  sync -f "$parent"
}

rollback() {
  # GARANȚIE: rollback-ul restaurează NUMAI runtime-ul (config OpenCode, worker,
  # unitate, helper switch, drop-in-uri LLM și receiptul final). Nu atinge
  # niciodată `$MODEL_ROOT`, shardurile `.gguf` verificate prin SHA-256 sau
  # receiptul sigilat: 76,5 GB descărcați și autentificați rămân pe disc pentru
  # reluare, indiferent de etapa în care a picat cutover-ul. Singurele ștergeri
  # din acest installer vizează cache-ul neautentificat (`.part`, chunkuri
  # HTTP Range) și numai după un SHA-256 invalid.
  local status=${1:-$?} fast_rollback=failed deadline alias
  trap - ERR EXIT HUP INT TERM
  if [ "$rollback_armed" = 1 ]; then
    set +e
    publish_max_model_journal
    publish_activation_pending
    systemctl stop "$MODEL_CONTROL_UNIT" >/dev/null 2>&1 || true
    diagnose_failure "$status"
    systemctl stop kelion-codex-worker.timer >/dev/null 2>&1 || true
    systemctl stop kelion-codex-worker.service >/dev/null 2>&1 || true
    systemctl stop private-ai-web.service >/dev/null 2>&1 || true
    install -o root -g privateai -m 0640 "$rollback_root/opencode.json" "$OPENCODE_CONFIG"
    install -o root -g root -m 0555 "$rollback_root/codex-worker.mjs" "$WORKER"
    install -o root -g root -m 0644 "$rollback_root/kelion-codex-worker.service" "$WORKER_UNIT"
    if [ "$had_switch" = 1 ]; then
      install -o root -g root -m 0755 \
        "$rollback_root/constructor-model-switch" "$SWITCH_BIN"
    else
      rm -f -- "$SWITCH_BIN"
    fi
    rm -f -- "$RUNTIME_DROPIN" "$PERSISTENT_DROPIN" "$RECEIPT"
    systemctl daemon-reload
    systemctl reset-failed private-ai-llm.service >/dev/null 2>&1 || true
    systemctl restart private-ai-llm.service
    deadline=$((SECONDS + 1800))
    while [ "$SECONDS" -lt "$deadline" ]; do
      alias=$(curl --fail --silent --max-time 20 \
        http://127.0.0.1:24080/v1/models 2>/dev/null \
        | jq -er '.data | select(type == "array" and length == 1) | .[0].id' \
        2>/dev/null || true)
      if [ "$alias" = "$FAST_MODEL_ALIAS" ]; then
        fast_rollback=passed
        break
      fi
      systemctl is-failed --quiet private-ai-llm.service && break
      sleep 5
    done
    if [ "$fast_rollback" = passed ]; then
      if [ "$web_active" = active ]; then
        systemctl restart private-ai-web.service
      fi
      systemctl disable --now kelion-codex-worker.timer >/dev/null 2>&1 || true
    else
      systemctl stop private-ai-web.service >/dev/null 2>&1 || true
      systemctl stop kelion-codex-worker.timer >/dev/null 2>&1 || true
      systemctl stop kelion-codex-worker.service >/dev/null 2>&1 || true
    fi
    printf 'MAX_MODEL_ROLLBACK=yes EXIT=%s FAST=%s\n' \
      "$status" "$fast_rollback" >&2
    publish_max_model_journal
    publish_activation_pending
    systemctl stop "$MODEL_CONTROL_UNIT" >/dev/null 2>&1 || true
  fi
  exit "$status"
}
# ERR: raportăm comanda mută înainte de rollback; EXIT acoperă `fail` (exit 1).
trap 'max_model_status=$?; report_silent_failure "$max_model_status" "$LINENO" "$BASH_COMMAND"; rollback "$max_model_status"' ERR
trap 'rollback $?' EXIT
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM
rollback_armed=1

set_stage 'quiesce-constructor'
systemctl stop kelion-codex-worker.timer >/dev/null 2>&1 || true
systemctl stop kelion-codex-worker.service >/dev/null 2>&1 || true
systemctl stop private-ai-web.service

set_stage 'publish-canonical-fast-runtime'
publish_canonical "$CONFIG_SOURCE" "$OPENCODE_CONFIG" root privateai 0640
publish_canonical "$WORKER_SOURCE" "$WORKER" root root 0555
publish_canonical "$SWITCH_SOURCE" "$SWITCH_BIN" root root 0755
publish_canonical "$WORKER_UNIT_SOURCE" "$WORKER_UNIT" root root 0644

set_stage 'verify-canonical-fast-runtime'
[ "$(sha256sum "$OPENCODE_CONFIG" | awk '{print $1}')" = "$config_source_sha" ]
[ "$(sha256sum "$WORKER" | awk '{print $1}')" = "$worker_source_sha" ]
[ "$(sha256sum "$WORKER_UNIT" | awk '{print $1}')" = "$worker_unit_source_sha" ]
[ "$(sha256sum "$SWITCH_BIN" | awk '{print $1}')" = "$switch_source_sha" ]
[ "$(stat -Lc '%U:%G:%a:%h' "$SWITCH_BIN")" = 'root:root:755:1' ]
systemctl daemon-reload
systemd-analyze verify private-ai-llm.service
systemd-analyze verify "$WORKER_UNIT"

set_stage 'activate-powerful-profile'
llm_cutover_attempted=1
# Receiptul final `$RECEIPT` nu există încă (este scris abia după probele de
# inferență). Helperul acceptă `powerful` fără receipt final numai cât timp
# jurnalul max-model `$MAX_MODEL_JOURNAL` este deschis, verificând în schimb
# receiptul sigilat și metadatele shardurilor.
"$SWITCH_BIN" powerful
! systemctl is-active --quiet private-ai-web.service
! systemctl is-active --quiet kelion-codex-worker.timer

set_stage 'probe-qwen-122b-model-list'
models=$(curl --fail --silent --show-error --max-time 30 http://127.0.0.1:24080/v1/models)
jq -e --arg id "$MODEL_ALIAS" '
  .data | type == "array" and length == 1 and .[0].id == $id
' <<<"$models" >/dev/null
set_stage 'probe-qwen-122b-inference'
reply=$(curl --fail --silent --show-error --max-time 1800 \
  -H 'Content-Type: application/json' \
  --data-binary "{\"model\":\"$MODEL_ALIAS\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply only with OK.\"}],\"max_tokens\":16,\"temperature\":0}" \
  http://127.0.0.1:24080/v1/chat/completions)
jq -e '.choices[0].message.content | type == "string" and length > 0' <<<"$reply" >/dev/null

set_stage 'restore-fast-profile'
"$SWITCH_BIN" fast
[ ! -e "$RUNTIME_DROPIN" ]
[ ! -e "$PERSISTENT_DROPIN" ]

set_stage 'probe-qwen-35b-model-list'
models=$(curl --fail --silent --show-error --max-time 30 http://127.0.0.1:24080/v1/models)
jq -e --arg id "$FAST_MODEL_ALIAS" '
  .data | type == "array" and length == 1 and .[0].id == $id
' <<<"$models" >/dev/null
set_stage 'probe-qwen-35b-inference'
reply=$(curl --fail --silent --show-error --max-time 1800 \
  -H 'Content-Type: application/json' \
  --data-binary "{\"model\":\"$FAST_MODEL_ALIAS\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply only with OK.\"}],\"max_tokens\":16,\"temperature\":0}" \
  http://127.0.0.1:24080/v1/chat/completions)
jq -e '.choices[0].message.content | type == "string" and length > 0' <<<"$reply" >/dev/null

set_stage 'probe-opencode-and-worker'
HOME=/srv/private-ai/home XDG_CONFIG_HOME=/srv/private-ai/home/.config \
  "$OPENCODE_BIN" models llama.cpp | grep -Fq "$FAST_MODEL_ALIAS"
HOME=/srv/private-ai/home XDG_CONFIG_HOME=/srv/private-ai/home/.config \
  "$OPENCODE_BIN" models llama.cpp | grep -Fq "$MODEL_ALIAS"
node "$WORKER" --self-test | grep -qx 'codex-worker self-test: TRECE'
systemctl show kelion-codex-worker.service -p Environment --value \
  | tr ' ' '\n' \
  | grep -qx 'OPENCODE_MODEL=llama.cpp/qwen3.6-35b-a3b-local'
! systemctl show kelion-codex-worker.service -p Environment --value \
  | tr ' ' '\n' \
  | grep -q '^OPENCODE_POWERFUL_MODEL='
set_stage 'verify-fast-steady-state'
systemctl is-active --quiet private-ai-llm.service
systemctl is-active --quiet private-ai-web.service
llm_pid=$(systemctl show private-ai-llm.service -p MainPID --value)
[[ "$llm_pid" =~ ^[1-9][0-9]*$ ]]
awk -v target="$fast_model_path" '$NF == target {found=1} END {exit !found}' "/proc/$llm_pid/maps"
ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24080'
! ss -ltnH | awk '{print $4}' | grep -Eq '(0\.0\.0\.0|\[::\]):24080$'
ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24096'
for index in 0 1 2; do
  require_regular "$MODEL_ROOT/${SHARD_NAMES[$index]}"
  [ "$(stat -Lc '%s' "$MODEL_ROOT/${SHARD_NAMES[$index]}")" = "${SHARD_BYTES[$index]}" ]
done

set_stage 'write-max-model-receipt'
receipt_candidate=$(mktemp /etc/private-ai/.max-model-complete.XXXXXX)
{
  printf 'schema=2\n'
  printf 'default_model=%s\n' "$FAST_MODEL_ID"
  printf 'powerful_model=%s\n' "$MODEL_ID"
  printf 'active_profile=fast\n'
  printf 'model_repo=%s\n' "$MODEL_REPO"
  printf 'model_revision=%s\n' "$MODEL_REVISION"
  printf 'model_quant=%s\n' "$MODEL_QUANT"
  printf 'model_total_bytes=%s\n' "$MODEL_TOTAL_BYTES"
  for index in 0 1 2; do
    printf 'shard_%s_sha256=%s\n' "$((index + 1))" "${SHARD_SHA256[$index]}"
  done
  printf 'fast_model_bytes=%s\n' "$FAST_MODEL_BYTES"
  printf 'fast_model_sha256=%s\n' "$FAST_MODEL_SHA256"
  printf 'fast_model_path=%s\n' "$fast_model_path"
  printf 'installer_sha256=%s\n' "$installer_source_sha"
  printf 'worker_source_sha256=%s\n' "$worker_source_sha"
  printf 'config_source_sha256=%s\n' "$config_source_sha"
  printf 'worker_unit_source_sha256=%s\n' "$worker_unit_source_sha"
  printf 'switch_source_sha256=%s\n' "$switch_source_sha"
  printf 'verified_at=%s\n' "$(date -u +%FT%TZ)"
} > "$receipt_candidate"
chown root:root "$receipt_candidate"
chmod 0600 "$receipt_candidate"
mv -f -- "$receipt_candidate" "$RECEIPT"
sync -f "$RECEIPT"

commit_max_model_gate_and_start_controller \
  || fail 'controllerul manual nu a revenit numai după receiptul final și FAST committed'
rollback_armed=0
trap - ERR EXIT HUP INT TERM
rm -rf --one-file-system "$rollback_root"

printf 'DEFAULT_MODEL_ID=%s\n' "$FAST_MODEL_ID"
printf 'POWERFUL_MODEL_ID=%s\n' "$MODEL_ID"
printf 'ACTIVE_PROFILE=fast\n'
printf 'MODEL_REPO=%s\n' "$MODEL_REPO"
printf 'MODEL_REVISION=%s\n' "$MODEL_REVISION"
printf 'MODEL_QUANT=%s\n' "$MODEL_QUANT"
printf 'MODEL_TOTAL_BYTES=%s\n' "$MODEL_TOTAL_BYTES"
printf 'MODEL_CONTEXT=16384\n'
printf 'VPS_MEMORY_TOTAL_BYTES=%s\n' "$(awk '/MemTotal:/ {print $2 * 1024}' /proc/meminfo | cut -d. -f1)"
printf 'VPS_CPU_THREADS=%s\n' "$(nproc)"
printf 'LLAMA_HEALTH=ok\n'
printf 'POWERFUL_INFERENCE=passed\n'
printf 'FAST_INFERENCE=passed\n'
printf 'OPENCODE_PROVIDER=passed\n'
printf 'WORKER_SELF_TEST=passed\n'
printf 'WORKER_UNIT_MODEL=passed\n'
printf 'DUAL_MODELS_ON_DISK=yes\n'
printf 'MAX_MODEL_INSTALLED=yes\n'
