#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# Raportează numai poziția și faza unei aserțiuni eșuate. Nu include comanda,
# argumentele sau mediul: instalatorul poate manipula căi și metadate sensibile,
# iar diagnosticul trebuie să rămână util fără să divulge valori.
constructor_install_phase=bootstrap
constructor_install_failure_line=0
constructor_install_source_commit=${KELION_CONSTRUCTOR_SOURCE_COMMIT:-unknown}
constructor_install_upgrade_owner=${KELION_CONSTRUCTOR_UPGRADE_OWNER:-0}
constructor_install_configure_owner=${KELION_CONSTRUCTOR_CONFIGURE_OWNER:-0}
if [[ ! "$constructor_install_source_commit" =~ ^[0-9a-f]{40}$ ]]; then
  constructor_install_source_commit=unknown
fi
case "$constructor_install_upgrade_owner" in 0|1) ;; *) constructor_install_upgrade_owner=invalid ;; esac
case "$constructor_install_configure_owner" in 0|1) ;; *) constructor_install_configure_owner=invalid ;; esac
readonly -a constructor_install_phases=(
  preflight publication-lock identity-layout recovery-preflight transaction-prepare
  quiesce transaction-supersede legacy-retirement artifact-publication unit-validation unit-cutover systemd-publication
  published-validation commit
)
set_constructor_install_phase() {
  local requested=$1 known
  for known in "${constructor_install_phases[@]}"; do
    if [ "$known" = "$requested" ]; then
      constructor_install_phase=$requested
      printf '{"ok":true,"event":"phase_start","phase":"%s","source_commit":"%s"}\n' \
        "$constructor_install_phase" "$constructor_install_source_commit" >&2
      return 0
    fi
  done
  return 1
}
constructor_install_assert() {
  local source_line=$1
  shift
  "$@" || { constructor_install_failure_line=$source_line; return 1; }
}
report_constructor_install_failure() {
  local status=$?
  local line=${constructor_install_failure_line:-0}
  trap - ERR EXIT
  if [ "$status" = 0 ]; then
    return 0
  fi
  printf '{"ok":false,"event":"installer_failure","phase":"%s","line":%s,"exit_code":%s,"source_commit":"%s"}\n' \
    "$constructor_install_phase" "$line" "$status" "$constructor_install_source_commit" >&2
  printf '::error::Constructor installer gate: phase=%s line=%s exit=%s source_commit=%s\n' \
    "$constructor_install_phase" "$line" "$status" "$constructor_install_source_commit" >&2
  builtin exit "$status"
}
capture_constructor_install_failure() {
  local status=$?
  constructor_install_failure_line=${1:-0}
  return "$status"
}
trap 'capture_constructor_install_failure "$LINENO"' ERR
trap report_constructor_install_failure EXIT
set_constructor_install_phase preflight

# Instalează codul, configul OpenCode local, identitățile, regula sudoers și
# unitățile dezactivate. Retrage cache-ul/adaptoarele Codex vechi, dar nu
# creează credentiale, nu clonează, nu activează timere și nu pornește servicii.
[[ "$(id -u)" == "0" ]] || { echo 'rulează ca root' >&2; constructor_install_failure_line=$LINENO; exit 1; }
[[ "${KELION_CONSTRUCTOR_INSTALL:-0}" == "1" ]] || {
  echo 'setează KELION_CONSTRUCTOR_INSTALL=1 după review' >&2
  constructor_install_failure_line=$LINENO; exit 1
}
[[ "$constructor_install_upgrade_owner" =~ ^[01]$ ]] || {
  echo 'KELION_CONSTRUCTOR_UPGRADE_OWNER trebuie să fie 0 sau 1' >&2
  constructor_install_failure_line=$LINENO; exit 1
}
[[ "$constructor_install_configure_owner" =~ ^[01]$ ]] || {
  echo 'KELION_CONSTRUCTOR_CONFIGURE_OWNER trebuie să fie 0 sau 1' >&2
  constructor_install_failure_line=$LINENO; exit 1
}
[ "$constructor_install_upgrade_owner" = 0 ] || [ "$constructor_install_configure_owner" = 0 ] || {
  echo 'installerul nu poate avea simultan owner upgrade și configure' >&2
  constructor_install_failure_line=$LINENO; exit 1
}
if [ "$constructor_install_configure_owner" = 1 ]; then
  [[ "$constructor_install_source_commit" =~ ^[0-9a-f]{40}$ ]] \
    && [ "${KELION_CUTOVER_LOCK_HELD:-0}" = 1 ] || {
      echo 'ownerul configure trebuie să fie pin-uit de commit și publication lock' >&2
      constructor_install_failure_line=$LINENO; exit 1
    }
fi

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ -f "$repo_root/AGENTS.md" && -f "$repo_root/deploy/constructor-publisher.mjs" ]] || {
  echo 'sursa instalării nu este repository-ul Kelion validat' >&2
  constructor_install_failure_line=$LINENO; exit 1
}
for tool in awk cmp curl find flock getent grep jq mktemp python3 readlink realpath sha256sum sleep stat sync systemctl systemd-analyze usermod visudo wc; do
  command -v "$tool" >/dev/null 2>&1 || { echo "lipsește utilitarul $tool" >&2; constructor_install_failure_line=$LINENO; exit 1; }
done
getent group privateai >/dev/null 2>&1 || {
  echo 'runtime-ul AI privat trebuie instalat înaintea Constructorului' >&2
  constructor_install_failure_line=$LINENO; exit 1
}

validate_opencode_constructor_config() {
  local file=$1
  [ -f "$file" ] && [ ! -L "$file" ] || return 1
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
      | all(.[]; $config.permission[.] == "allow")) and
    $config.instructions == ["instructions.md"] and
    $config.server == {hostname:"127.0.0.1",port:24096,mdns:false}
  ' "$file" >/dev/null
}

constructor_expected_model_profile=''
constructor_fast_model_path=''

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

validate_private_ai_base() {
  local receipt=/etc/private-ai/.install-complete config=/srv/private-ai/home/.config/opencode/opencode.json
  local instructions=/srv/private-ai/home/.config/opencode/instructions.md
  local llama_server=/opt/private-ai/bin/llama-server llama_source=/opt/private-ai/src/llama.cpp
  local llama_state=/var/lib/private-ai/llama-cpp.commit model_cache=/srv/private-ai/models
  local model_file_path fast_model_file_path llm_pid active_alias active_profile powerful_root
  local -a receipt_lines=()
  local -a model_candidates=()
  for directory in /etc/private-ai /opt/private-ai /opt/private-ai/bin /srv/private-ai /srv/private-ai/home \
    /srv/private-ai/home/.config /srv/private-ai/home/.config/opencode; do
    [ -d "$directory" ] && [ ! -L "$directory" ] \
      && [ "$(realpath -e -- "$directory")" = "$directory" ] || return 1
  done
  [ "$(stat -Lc '%U:%G:%a' /srv/private-ai/home/.config)" = 'root:privateai:750' ] || return 1
  [ "$(stat -Lc '%U:%G:%a' /srv/private-ai/home/.config/opencode)" = 'root:privateai:750' ] || return 1
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
  [ "$(env -i HOME=/srv/private-ai/home PATH=/usr/bin:/bin /opt/private-ai/bin/opencode --version)" = '1.18.25' ] || return 1
  [ -x "$llama_server" ] && [ ! -L "$llama_server" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$llama_server")" = '0:0:755:1' ] || return 1
  [ "$(sha256sum "$llama_server" | awk '{print $1}')" = \
    b80a03e8c2b22e28eef05fd4e701af696a82cebe7643290dc931ca4d9d67847e ] || return 1
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
  if [ -z "$constructor_fast_model_path" ]; then
    constructor_fast_model_path=$fast_model_file_path
  else
    [ "$constructor_fast_model_path" = "$fast_model_file_path" ] || return 1
  fi
  [ -f "$config" ] && [ ! -L "$config" ] \
    && [ "$(stat -Lc '%U:%G:%a:%h' "$config")" = 'root:privateai:640:1' ] || return 1
  [ -f "$instructions" ] && [ ! -L "$instructions" ] \
    && [ "$(stat -Lc '%U:%G:%a:%h' "$instructions")" = 'root:privateai:640:1' ] || return 1
  jq -e '
    .enabled_providers == ["llama.cpp"] and
    (.provider | keys) == ["llama.cpp"] and
    .provider["llama.cpp"].npm == "@ai-sdk/openai-compatible" and
    .provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1" and
    (.provider["llama.cpp"].options | has("apiKey") | not) and
    (.provider["llama.cpp"].models | has("qwen3.6-35b-a3b-local")) and
    (.provider["llama.cpp"].models | has("qwen3.5-122b-a10b-local"))
  ' "$config" >/dev/null || return 1
  systemctl is-active --quiet private-ai-llm.service || return 1
  active_alias=$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models \
    | jq -er '.data | select(type == "array" and length == 1) | .[0].id') || return 1
  case "$active_alias" in
    qwen3.6-35b-a3b-local)
      active_profile=fast
      model_file_path=$fast_model_file_path
      systemctl is-active --quiet private-ai-web.service || return 1
      ;;
    qwen3.5-122b-a10b-local)
      active_profile=powerful
      powerful_root=$model_cache/qwen3.5-122b-a10b-q4_k_m
      [ -f /etc/private-ai/.max-model-sealed ] && [ ! -L /etc/private-ai/.max-model-sealed ] || return 1
      validate_max_model_complete_receipt "$fast_model_file_path" || return 1
      [ -f "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf" ] \
        && [ "$(stat -Lc '%U:%G:%a:%s:%h' "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf")" = 'root:privateai:440:10943552:1' ] || return 1
      [ -f "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf" ] \
        && [ "$(stat -Lc '%U:%G:%a:%s:%h' "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00002-of-00003.gguf")" = 'root:privateai:440:49968146912:1' ] || return 1
      [ -f "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf" ] \
        && [ "$(stat -Lc '%U:%G:%a:%s:%h' "$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00003-of-00003.gguf")" = 'root:privateai:440:26557874144:1' ] || return 1
      model_file_path=$powerful_root/Qwen3.5-122B-A10B-Q4_K_M-00001-of-00003.gguf
      ! systemctl is-active --quiet private-ai-web.service || return 1
      ;;
    *) return 1 ;;
  esac
  if [ -z "$constructor_expected_model_profile" ]; then
    constructor_expected_model_profile=$active_profile
  else
    [ "$active_profile" = "$constructor_expected_model_profile" ] || return 1
  fi
  llm_pid=$(systemctl show private-ai-llm.service -p MainPID --value)
  [[ "$llm_pid" =~ ^[1-9][0-9]*$ ]] || return 1
  [ "$(readlink -f -- "/proc/$llm_pid/exe")" = "$llama_server" ] || return 1
  awk -v target="$model_file_path" '$NF == target { found=1 } END { exit !found }' \
    "/proc/$llm_pid/maps" || return 1
  curl --fail --silent --show-error --max-time 10 http://127.0.0.1:24080/health >/dev/null || return 1
  [ "$active_alias" = "$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models \
    | jq -er '.data | select(type == "array" and length == 1) | .[0].id')" ]
}

validate_opencode_constructor_config "$repo_root/deploy/opencode-constructor.json" \
  || { echo 'configurația OpenCode Constructor din bundle este invalidă' >&2; constructor_install_failure_line=$LINENO; exit 1; }
validate_private_ai_base \
  || { echo 'runtime-ul OpenCode/Qwen local nu corespunde bazei fixate' >&2; constructor_install_failure_line=$LINENO; exit 1; }
# Nu conecta `usermod --help` la `grep -q` sub pipefail: grep poate închide
# conducta după primul match, iar SIGPIPE-ul producătorului transformă o
# capabilitate prezentă într-un fals eșec. Capturăm o singură ieșire bounded și
# verificăm toate cele patru operații fără un producer concurent.
usermod_help=$(usermod --help 2>&1) \
  || { echo 'capabilitățile usermod nu pot fi citite' >&2; constructor_install_failure_line=$LINENO; exit 1; }
for required_usermod_option in \
  '--add-subuids FIRST-LAST' \
  '--del-subuids FIRST-LAST' \
  '--add-subgids FIRST-LAST' \
  '--del-subgids FIRST-LAST'; do
  grep -Fq -- "$required_usermod_option" <<<"$usermod_help" \
    || { echo 'usermod nu oferă tranzacțiile native subuid/subgid necesare' >&2; constructor_install_failure_line=$LINENO; exit 1; }
done
unset usermod_help required_usermod_option

ROOT=/root/kelion
RUNTIME_ROOT=$ROOT/runtime
PUBLICATION_LOCK=$ROOT/publicare.lock
INSTALL_JOURNAL=$RUNTIME_ROOT/constructor-deploy-quiesce.journal
UPGRADE_JOURNAL=$RUNTIME_ROOT/constructor-upgrade.journal
MAX_MODEL_JOURNAL=$RUNTIME_ROOT/constructor-max-model.journal
REACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-reactivation.journal
DESTRUCTIVE_RECOVERY_JOURNAL=$RUNTIME_ROOT/destructive-cutover-recovery.json
READY_ROOT=/run/kelion
READY_STAMP=$READY_ROOT/runtime-config-recovery.ready
ACTIVATION_PENDING=$READY_ROOT/constructor-activation.pending

validate_installer_outer_upgrade_journal() {
  [ "$constructor_install_upgrade_owner" = 1 ] \
    && [[ "$constructor_install_source_commit" =~ ^[0-9a-f]{40}$ ]] \
    && [ -f "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$UPGRADE_JOURNAL")" = '0:0:600:1' ] \
    && jq -e --arg sourceCommit "$constructor_install_source_commit" '
      .schema == 1 and .kind == "constructor-upgrade" and
      (.phase == "armed" or .phase == "installed" or .phase == "committed") and
      .sourceCommit == $sourceCommit and
      (.snapshotRoot | strings | test("^/root/kelion/runtime/constructor-upgrade\\.[A-Za-z0-9]+$")) and
      (.stateSha256 | strings | test("^[0-9a-f]{64}$")) and
      (keys == ["kind","phase","schema","snapshotRoot","sourceCommit","stateSha256"])
    ' "$UPGRADE_JOURNAL" >/dev/null
}

validate_constructor_activation_pending() {
  [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
    && [ "$(realpath -e -- "$READY_ROOT")" = "$READY_ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] \
    && [ -f "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ACTIVATION_PENDING")" = '0:0:444:1' ] \
    && [ "$(wc -l < "$ACTIVATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$ACTIVATION_PENDING"
}

publish_constructor_activation_pending() {
  local temporary
  if [ -e "$READY_ROOT" ] || [ -L "$READY_ROOT" ]; then
    [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
      && [ "$(realpath -e -- "$READY_ROOT")" = "$READY_ROOT" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] || return 1
  else
    install -d -o root -g root -m 0755 "$READY_ROOT" || return 1
    sync -f /run || return 1
  fi
  # Ready dispare durabil înainte ca blockerul controllerului să fie publicat.
  # Astfel niciun request manual nu poate fi ACK-uit după începutul quiesce-ului.
  retract_ready_stamp || return 1
  if [ -e "$ACTIVATION_PENDING" ] || [ -L "$ACTIVATION_PENDING" ]; then
    validate_constructor_activation_pending
    return
  fi
  temporary=$(mktemp "$READY_ROOT/.constructor-activation.pending.XXXXXX") || return 1
  if printf 'schema=1\n' > "$temporary" \
    && chown root:root "$temporary" && chmod 0444 "$temporary" \
    && sync -f "$temporary" \
    && mv -f -- "$temporary" "$ACTIVATION_PENDING" \
    && sync -f "$READY_ROOT" \
    && validate_constructor_activation_pending; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

clear_constructor_activation_pending() {
  validate_constructor_activation_pending || return 1
  rm -f -- "$ACTIVATION_PENDING" || return 1
  sync -f "$READY_ROOT"
}

# Installerul nu poate interpreta ori consuma recovery-ul DB/release. Orice
# inode la calea fixă (inclusiv symlink sau fișier corupt) blochează toate
# mutațiile Constructor până când operația de release care îl deține se încheie.
guard_destructive_cutover_recovery_absent() {
  [ ! -e "$DESTRUCTIVE_RECOVERY_JOURNAL" ] \
    && [ ! -L "$DESTRUCTIVE_RECOVERY_JOURNAL" ]
}
validate_constructor_reactivation_journal() {
  [ -f "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$REACTIVATION_JOURNAL")" = '0:0:600:1' ] \
    && jq -e '
      .schema == 1 and .kind == "constructor-reactivation" and .phase == "pending" and
      (keys == ["kind","phase","schema"])
    ' "$REACTIVATION_JOURNAL" >/dev/null
}
validate_constructor_reactivation_state() {
  if [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ]; then return 0; fi
  validate_constructor_reactivation_journal
}
guard_destructive_cutover_recovery_absent || {
  echo 'recovery destructiv de release activ; instalarea Constructor este refuzată' >&2
  constructor_install_failure_line=$LINENO
  exit 1
}
validate_constructor_reactivation_state || {
  echo 'intentul reactivării runtime este nesigur; instalarea este refuzată' >&2
  constructor_install_failure_line=$LINENO
  exit 1
}
if [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]; then
  validate_installer_outer_upgrade_journal || {
    echo 'jurnalul exterior al upgrade-ului nu este autentic pentru installer' >&2
    constructor_install_failure_line=$LINENO
    exit 1
  }
else
  [ "$constructor_install_upgrade_owner" = 0 ] || {
    echo 'ownerul exterior al installerului nu are jurnal durabil' >&2
    constructor_install_failure_line=$LINENO
    exit 1
  }
fi
[ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] || {
  echo 'tranzacția max-model este activă; instalarea este refuzată' >&2
  constructor_install_failure_line=$LINENO
  exit 1
}
# Un marker autentic poate proveni din propriul tail întrerupt; părintele său
# există deja. Bootstrapul curat poate crea ROOT înainte de lock deoarece nu
# există încă nicio stare Constructor de recuperat.
if [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ]; then
  install -d -o root -g root -m 0755 "$ROOT"
else
  [ -d "$ROOT" ] && [ ! -L "$ROOT" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$ROOT")" = '0:0:755' ] || {
      echo 'rădăcina Kelion este nesigură pentru reluarea reactivării' >&2
      constructor_install_failure_line=$LINENO
      exit 1
    }
fi

set_constructor_install_phase publication-lock
acquire_publication_lock() {
  local inherited=${KELION_CUTOVER_LOCK_HELD:-0} fd_path fd_identity
  case "$inherited" in 0|1) ;; *) return 1 ;; esac
  if [ "$inherited" = 1 ]; then
    [ -e /proc/$$/fd/9 ] || return 1
    fd_path=$(readlink "/proc/$$/fd/9") || return 1
    [ "$fd_path" = "$PUBLICATION_LOCK" ] || return 1
    [ -f /proc/$$/fd/9 ] && [ ! -L "$PUBLICATION_LOCK" ] || return 1
    [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] || return 1
    fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9) || return 1
    [ "$fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] || return 1
    flock -n 9 || return 1
    return 0
  fi
  if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
    [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] || return 1
  fi
  exec 9<>"$PUBLICATION_LOCK"
  fd_path=$(readlink "/proc/$$/fd/9") || return 1
  [ "$fd_path" = "$PUBLICATION_LOCK" ] && [ -f /proc/$$/fd/9 ] || return 1
  [ "$(stat -Lc '%h' /proc/$$/fd/9)" = 1 ] || return 1
  fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9) || return 1
  [ "$fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] || return 1
  chown root:root /proc/$$/fd/9
  chmod 0600 /proc/$$/fd/9
  [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] || return 1
  [ ! -L "$PUBLICATION_LOCK" ] \
    && [ "$fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] || return 1
  flock -n 9 || return 1
  export KELION_CUTOVER_LOCK_HELD=1
}
acquire_publication_lock || { echo 'lock-ul de publicare nu poate fi dobândit și dovedit pe FD9' >&2; constructor_install_failure_line=$LINENO; exit 1; }
guard_destructive_cutover_recovery_absent || {
  echo 'recovery destructiv de release detectat sub publication lock; instalarea Constructor este refuzată' >&2
  constructor_install_failure_line=$LINENO
  exit 1
}
validate_constructor_reactivation_state || {
  echo 'intentul reactivării runtime s-a corupt sub publication lock' >&2
  constructor_install_failure_line=$LINENO
  exit 1
}
if [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]; then
  validate_installer_outer_upgrade_journal || {
    echo 'jurnalul exterior al upgrade-ului s-a schimbat sub publication lock' >&2
    constructor_install_failure_line=$LINENO
    exit 1
  }
else
  [ "$constructor_install_upgrade_owner" = 0 ] || {
    echo 'jurnalul exterior al ownerului a dispărut sub publication lock' >&2
    constructor_install_failure_line=$LINENO
    exit 1
  }
fi
[ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] || {
  echo 'tranzacția max-model a apărut sub publication lock' >&2
  constructor_install_failure_line=$LINENO
  exit 1
}

constructor_reactivation_postcondition() {
  local index marker timer socket=/run/kelion-constructor-model-control/control.sock
  [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] \
    && [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$READY_STAMP")" = '0:0:444:1' ] \
    && systemctl is-active --quiet kelion-constructor-model-control.service \
    && [ -S "$socket" ] && [ ! -L "$socket" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$socket")" = '0:10050:660' ] || return 1
  local -a markers=(
    /etc/kelion/codex-worker.enabled
    /etc/kelion/constructor-publisher.enabled
    /etc/kelion/constructor-release.enabled
  )
  local -a timers=(
    kelion-codex-worker.timer
    kelion-constructor-publisher.timer
    kelion-constructor-release.timer
  )
  for index in "${!markers[@]}"; do
    marker=${markers[$index]}; timer=${timers[$index]}
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

if [ -e "$REACTIVATION_JOURNAL" ] || [ -L "$REACTIVATION_JOURNAL" ]; then
  validate_constructor_reactivation_journal || {
    echo 'intentul reactivării nu mai este autentic sub publication lock' >&2
    constructor_install_failure_line=$LINENO
    exit 1
  }
  [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] || {
    echo 'reactivarea și jurnalul installerului coexistă fără un owner de recovery sigur' >&2
    constructor_install_failure_line=$LINENO
    exit 1
  }
  live_recovery_helper=$ROOT/bin/runtime-config-cutover.sh
  live_recovery_compose=$ROOT/config/compose.production.yml
  candidate_recovery_helper=$repo_root/deploy/lib/runtime-config-cutover.sh
  [ -f "$live_recovery_helper" ] && [ ! -L "$live_recovery_helper" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$live_recovery_helper")" = '0:0:500:1' ] \
    && [ -f "$candidate_recovery_helper" ] && [ ! -L "$candidate_recovery_helper" ] \
    && cmp -s -- "$candidate_recovery_helper" "$live_recovery_helper" \
    && [ -f "$live_recovery_compose" ] && [ ! -L "$live_recovery_compose" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$live_recovery_compose")" = '0:0:444:1' ] || {
      echo 'helperul/compose-ul exact al reactivării întrerupte nu poate fi autentificat' >&2
      constructor_install_failure_line=$LINENO
      exit 1
    }
  KELION_CUTOVER_LOCK_HELD=1 \
    "$live_recovery_helper" --recover-only "$live_recovery_compose" \
    || { echo 'reactivarea întreruptă nu a putut fi adoptată de installer' >&2; constructor_install_failure_line=$LINENO; exit 1; }
  constructor_reactivation_postcondition \
    || { echo 'postcondiția reactivării adoptate de installer este incompletă' >&2; constructor_install_failure_line=$LINENO; exit 1; }
fi
set_constructor_install_phase identity-layout

install_atomic() {
  local source=$1 target=$2 owner=$3 group=$4 mode=$5 temporary
  temporary=$(mktemp "$target.install.XXXXXX")
  install -o "$owner" -g "$group" -m "$mode" "$source" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$target"
  sync -f "$(dirname -- "$target")"
}

ensure_group() {
  local group_name=$1
  getent group "$group_name" >/dev/null || groupadd --system "$group_name"
}

ensure_user() {
  local user_name=$1 home_dir=$2
  if ! getent passwd "$user_name" >/dev/null; then
    useradd --system --add-subids-for-system --home-dir "$home_dir" --create-home --shell /usr/sbin/nologin "$user_name"
  fi
}

validate_subid_map() {
  local file=$1 user_name=$2 policy=${3:-require-existing}
  case "$policy" in require-existing|allow-missing) ;; *) return 1 ;; esac
  [[ "$user_name" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || return 1
  python3 - "$file" "$user_name" "$policy" <<'PY'
import pathlib
import re
import sys

path, wanted, policy = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
raw = path.read_bytes()
if len(raw) > 1024 * 1024 or (raw and not raw.endswith(b"\n")):
    raise SystemExit("fișier subid supradimensionat sau trunchiat")
try:
    lines = raw.decode("ascii").splitlines()
except UnicodeDecodeError:
    raise SystemExit("fișier subid non-ASCII")

ranges = []
owners = []
for line_number, line in enumerate(lines, 1):
    fields = line.split(":")
    if len(fields) != 3:
        raise SystemExit(f"intrare subid invalidă la linia {line_number}")
    owner, start_text, count_text = fields
    if (
        not owner
        or len(owner) > 256
        or any(ord(character) < 33 or ord(character) == 127 for character in owner)
        or ":" in owner
        or not re.fullmatch(r"0|[1-9][0-9]*", start_text)
        or not re.fullmatch(r"[1-9][0-9]*", count_text)
    ):
        raise SystemExit(f"intrare subid necanonică la linia {line_number}")
    start, count = int(start_text), int(count_text)
    end = start + count - 1
    if start < 1 or end > 0xFFFFFFFF:
        raise SystemExit(f"interval subid în afara limitelor la linia {line_number}")
    ranges.append((start, end, owner, line_number))
    if owner == wanted:
        owners.append((start, count))

previous = None
for current in sorted(ranges):
    if previous is not None and current[0] <= previous[1]:
        raise SystemExit(
            f"intervale subid suprapuse la liniile {previous[3]} și {current[3]}"
        )
    previous = current

if len(owners) == 1:
    start, count = owners[0]
    if count < 65536:
        raise SystemExit("maparea subid existentă este insuficientă")
    print("valid")
    raise SystemExit(0)
if owners:
    raise SystemExit("utilizatorul are mapări subid duplicate")
if policy != "allow-missing":
    raise SystemExit("maparea subid lipsește")

candidate = 100000
for start, end, _owner, _line_number in sorted(ranges):
    if end < candidate:
        continue
    if candidate + 65536 - 1 < start:
        break
    candidate = end + 1
if candidate + 65536 - 1 > 0xFFFFFFFF:
    raise SystemExit("nu mai există un interval subid suficient")
print(f"missing:{candidate}")
PY
}

fsync_subid_path() {
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

validate_subid_path() {
  local file=$1
  [ -f "$file" ] && [ ! -L "$file" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$file")" = '0:0:644:1' ]
}

ensure_subids() {
  local user_name=$1 prefix=${2:-} etc_root=/etc uid_file gid_file attempt
  local uid_result gid_result uid_final gid_final start end range durability_ok
  local uid_requested=0 gid_requested=0
  local -a update_command cleanup_command
  [[ "$user_name" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || return 1
  if [ -n "$prefix" ]; then
    [ -d "$prefix" ] && [ ! -L "$prefix" ] \
      && [ "$(realpath -e -- "$prefix")" = "$prefix" ] || return 1
    etc_root=$prefix/etc
  fi
  [ -d "$etc_root" ] && [ ! -L "$etc_root" ] || return 1
  uid_file=$etc_root/subuid
  gid_file=$etc_root/subgid
  validate_subid_path "$uid_file" && validate_subid_path "$gid_file" || return 1

  # usermod deschide și recitește bazele subid numai după sub_uid_lock /
  # sub_gid_lock. Opțiunile uid+gid sunt trimise într-un singur proces, astfel
  # încât niciun writer shadow concurent nu poate fi suprascris de un RMW local.
  # Calculul anterior lockului este tratat optimist: dacă alt writer ocupă
  # intervalul, validarea globală eșuează, eliminăm numai intervalul cerut prin
  # același API shadow și recalculăm bounded.
  for attempt in 1 2 3 4; do
    uid_result=$(validate_subid_map "$uid_file" "$user_name" allow-missing) || return 1
    gid_result=$(validate_subid_map "$gid_file" "$user_name" allow-missing) || return 1
    if [ "$uid_result" = valid ] && [ "$gid_result" = valid ]; then
      fsync_subid_path "$uid_file" && fsync_subid_path "$gid_file" \
        && fsync_subid_path "$etc_root" || return 1
      return 0
    fi

    update_command=(usermod)
    cleanup_command=(usermod)
    if [ -n "$prefix" ]; then
      update_command+=(--prefix "$prefix")
      cleanup_command+=(--prefix "$prefix")
    fi
    uid_requested=0
    gid_requested=0
    case "$uid_result" in
      valid) ;;
      missing:[1-9][0-9]*)
        start=${uid_result#missing:}; end=$((start + 65535))
        [ "$end" -le 4294967295 ] || return 1
        range=$start-$end
        update_command+=(--add-subuids "$range")
        cleanup_command+=(--del-subuids "$range")
        uid_requested=1
        ;;
      *) return 1 ;;
    esac
    case "$gid_result" in
      valid) ;;
      missing:[1-9][0-9]*)
        start=${gid_result#missing:}; end=$((start + 65535))
        [ "$end" -le 4294967295 ] || return 1
        range=$start-$end
        update_command+=(--add-subgids "$range")
        cleanup_command+=(--del-subgids "$range")
        gid_requested=1
        ;;
      *) return 1 ;;
    esac
    [ "$uid_requested" = 1 ] || [ "$gid_requested" = 1 ] || return 1

    # Codul de ieșire nu este autoritatea pentru succes: un writer shadow
    # concurent poate publica exact aceeași mapare între precheck și lock, iar
    # usermod poate raporta duplicate deși invariantul final este deja valid.
    "${update_command[@]}" "$user_name" || :
    durability_ok=1
    validate_subid_path "$uid_file" && validate_subid_path "$gid_file" \
      && fsync_subid_path "$uid_file" && fsync_subid_path "$gid_file" \
      && fsync_subid_path "$etc_root" || durability_ok=0
    uid_final=$(validate_subid_map "$uid_file" "$user_name" require-existing 2>/dev/null) || uid_final=invalid
    gid_final=$(validate_subid_map "$gid_file" "$user_name" require-existing 2>/dev/null) || gid_final=invalid
    if [ "$uid_final" = valid ] && [ "$gid_final" = valid ]; then
      [ "$durability_ok" = 1 ] && return 0
      return 1
    fi

    # usermod poate raporta eroare după ce unul dintre cele două fișiere a fost
    # deja publicat. Ștergerea idempotentă a intervalelor cerute repară inclusiv
    # această fereastră numai dacă invariantul final nu este valid; o mapare
    # validă publicată concurent nu ne aparține și nu trebuie ștearsă.
    "${cleanup_command[@]}" "$user_name" || return 1
    validate_subid_path "$uid_file" && validate_subid_path "$gid_file" \
      && fsync_subid_path "$uid_file" && fsync_subid_path "$gid_file" \
      && fsync_subid_path "$etc_root" || return 1
    uid_final=$(validate_subid_map "$uid_file" "$user_name" allow-missing) || return 1
    gid_final=$(validate_subid_map "$gid_file" "$user_name" allow-missing) || return 1
    case "$uid_final" in valid|missing:[1-9][0-9]*) ;; *) return 1 ;; esac
    case "$gid_final" in valid|missing:[1-9][0-9]*) ;; *) return 1 ;; esac
  done
  return 1
}

secure_service_parent() {
  local path=$1 parent
  case "$path" in
    /var/lib/kelion-codex|/var/lib/kelion-publisher|/var/lib/kelion-release) ;;
    *) return 1 ;;
  esac
  parent=$(dirname -- "$path")
  [ -d "$parent" ] && [ ! -L "$parent" ] \
    && [ "$(realpath -e -- "$parent")" = "$parent" ] || return 1
  if [ -e "$path" ] || [ -L "$path" ]; then
    [ -d "$path" ] && [ ! -L "$path" ] \
      && [ "$(realpath -e -- "$path")" = "$path" ] || return 1
  else
    install -d -o root -g root -m 0711 "$path" || return 1
  fi
  chown root:root "$path" && chmod 0711 "$path" || return 1
  [ "$(stat -Lc '%u:%g:%a' "$path")" = '0:0:711' ] || return 1
  sync -f "$path" && sync -f "$parent"
}

ensure_service_writable_dir() {
  local path=$1 owner=$2 group=$3 parent
  parent=$(dirname -- "$path")
  [ -d "$parent" ] && [ ! -L "$parent" ] \
    && [ "$(realpath -e -- "$parent")" = "$parent" ] || return 1
  if [ -e "$path" ] || [ -L "$path" ]; then
    # Părintele direct este deja root-owned înaintea acestui test. Un symlink
    # legacy este refuzat, nu urmat de chown/chmod ca root.
    [ -d "$path" ] && [ ! -L "$path" ] \
      && [ "$(realpath -e -- "$path")" = "$path" ] || return 1
  else
    install -d -o "$owner" -g "$group" -m 0700 "$path" || return 1
  fi
  chown "$owner:$group" "$path" && chmod 0700 "$path" || return 1
  [ "$(stat -Lc '%U:%G:%a' "$path")" = "$owner:$group:700" ] || return 1
  sync -f "$path" && sync -f "$parent"
}

validate_root_owned_install_directory() {
  local path=$1 path_mode
  [ -d "$path" ] && [ ! -L "$path" ] \
    && [ "$(realpath -e -- "$path")" = "$path" ] \
    && [ "$(stat -Lc '%u:%g' "$path")" = '0:0' ] || return 1
  path_mode=$(stat -Lc '%a' "$path") || return 1
  [ $((8#$path_mode & 0022)) -eq 0 ]
}

validate_root_owned_protected_directory() {
  local path=$1 path_mode
  [ -d "$path" ] && [ ! -L "$path" ] \
    && [ "$(realpath -e -- "$path")" = "$path" ] \
    && [ "$(stat -Lc '%u' "$path")" = 0 ] || return 1
  path_mode=$(stat -Lc '%a' "$path") || return 1
  [ $((8#$path_mode & 0022)) -eq 0 ]
}

ensure_root_owned_install_directory() {
  local path=$1 mode=$2 parent
  case "$path" in
    /opt/kelion-codex|/opt/kelion-constructor|/opt/kelion-constructor/lib|/etc/systemd/system/private-ai-web.service.d) ;;
    *) return 1 ;;
  esac
  parent=$(dirname -- "$path")
  validate_root_owned_install_directory "$parent" || return 1
  if [ -e "$path" ] || [ -L "$path" ]; then
    validate_root_owned_install_directory "$path" || return 1
  else
    install -d -o root -g root -m "$mode" "$path" || return 1
  fi
  chown root:root "$path" && chmod "$mode" "$path" || return 1
  [ "$(stat -Lc '%u:%g:%a' "$path")" = "0:0:${mode#0}" ] || return 1
  sync -f "$path" && sync -f "$parent"
}

secure_handoff_spool() {
  local prefix=${1:-} var_lib=/var/lib spool child
  if [ -n "$prefix" ]; then
    [ -d "$prefix" ] && [ ! -L "$prefix" ] \
      && [ "$(realpath -e -- "$prefix")" = "$prefix" ] || return 1
    var_lib=$prefix/var/lib
  fi
  [ -d "$var_lib" ] && [ ! -L "$var_lib" ] \
    && [ "$(realpath -e -- "$var_lib")" = "$var_lib" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$var_lib")" = '0:0:755' ] || return 1
  spool=$var_lib/kelion-constructor-handoff
  if [ -e "$spool" ] || [ -L "$spool" ]; then
    [ -d "$spool" ] && [ ! -L "$spool" ] \
      && [ "$(realpath -e -- "$spool")" = "$spool" ] \
      && [ "$(stat -Lc '%u' "$spool")" = 0 ] || return 1
  else
    install -d -o root -g kelion-handoff -m 0750 "$spool" || return 1
  fi

  # Retragem întâi dreptul de rename/create din părinte. Proprietarul root
  # verificat mai sus nu poate schimba modul concurent, iar descriptorii deja
  # deschiși ai membrilor grupului sunt supuși noului mod la fiecare operație.
  chmod 00750 "$spool" && chown root:kelion-handoff "$spool" || return 1
  [ "$(stat -Lc '%U:%G:%a' "$spool")" = 'root:kelion-handoff:750' ] || return 1
  sync -f "$spool" && sync -f "$var_lib" || return 1

  for child in ready ack retired; do
    child=$spool/$child
    if [ -e "$child" ] || [ -L "$child" ]; then
      # Numele este acum stabil sub părintele root-owned, non-group-writable.
      [ -d "$child" ] && [ ! -L "$child" ] \
        && [ "$(realpath -e -- "$child")" = "$child" ] || return 1
    else
      install -d -o root -g kelion-handoff -m 2770 "$child" || return 1
    fi
    chown root:kelion-handoff "$child" && chmod 2770 "$child" || return 1
    [ "$(stat -Lc '%U:%G:%a' "$child")" = 'root:kelion-handoff:2770' ] || return 1
    sync -f "$child" || return 1
  done
  sync -f "$spool"
}

validate_constructor_sudoers() {
  local file=$1
  [ -f "$file" ] && [ ! -L "$file" ] \
    && [ "$(stat -Lc '%h' "$file")" = 1 ] \
    && [ "$(wc -l < "$file")" -eq 1 ] \
    && grep -qxF 'kelion-codex ALL=(ALL:ALL) NOPASSWD: ALL' "$file" \
    && visudo -cf "$file" >/dev/null
}

validate_private_ai_web_full_access() {
  local source=$repo_root/deploy/systemd/private-ai-web-full-access.conf
  local target=/etc/systemd/system/private-ai-web.service.d/90-kelion-constructor-full-access.conf
  local pid dropins
  [ -f "$source" ] && [ ! -L "$source" ] || return 1
  [ -f "$target" ] && [ ! -L "$target" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$target")" = '0:0:444:1' ] \
    && cmp -s -- "$source" "$target" || return 1
  dropins=$(systemctl show private-ai-web.service --property=DropInPaths --value) || return 1
  [ "$dropins" = "$target" ] || return 1
  systemctl is-enabled --quiet private-ai-web.service || return 1
  systemctl is-active --quiet private-ai-web.service || return 1
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
  pid=$(systemctl show private-ai-web.service --property=MainPID --value) || return 1
  [[ "$pid" =~ ^[1-9][0-9]*$ ]] && [ -r "/proc/$pid/status" ] \
    && [ "$(awk '/^Uid:/ { print $2 }' "/proc/$pid/status")" = 0 ]
}

retire_legacy_codex_state() {
  local auth_dir=/var/lib/kelion-codex-auth
  local profile_dir=/opt/kelion-codex/profile-home
  local canonical_codex=/opt/kelion-codex/bin/codex
  local canonical_target='' canonical_is_compat=0 remaining parent retired
  local -a retired_paths=(
    /opt/kelion-codex/codex-sandbox-probe.mjs
    /opt/kelion-codex/bin/codex-real
    /opt/private-ai/bin/opencode-constructor-root
    /etc/private-ai/local-codex-compat-key
    /etc/sudoers.d/kelion-local-qwen-constructor
    /etc/systemd/system/kelion-codex-worker.service.d/90-local-qwen-full-access.conf
    /etc/systemd/system/kelion-codex-worker.service.d/90-local-opencode-full-access.conf
  )

  for parent in \
    /opt/kelion-codex /opt/kelion-codex/bin /opt/private-ai /opt/private-ai/bin \
    /etc/private-ai /etc/sudoers.d /etc/systemd/system \
    /etc/systemd/system/kelion-codex-worker.service.d /var/lib; do
    if [ -e "$parent" ] || [ -L "$parent" ]; then
      validate_root_owned_protected_directory "$parent" || return 1
    fi
  done

  # Un adaptor one-shot mai vechi putea înlocui calea Codex cu un wrapper
  # local. Constructorul canonic nu mai execută acea cale; eliminăm numai
  # variantele recunoscute, fără a atinge un CLI Codex oficial independent.
  if [ -e "$canonical_codex" ] || [ -L "$canonical_codex" ]; then
    if [ -L "$canonical_codex" ]; then
      canonical_target=$(readlink -f -- "$canonical_codex" 2>/dev/null || true)
      case "$canonical_target" in
        /opt/kelion-codex/bin/codex-real|/opt/private-ai/bin/opencode-constructor-root)
          canonical_is_compat=1
          ;;
        '') return 1 ;;
        *)
          [ -f "$canonical_target" ] && [ ! -L "$canonical_target" ] || return 1
          if grep -aEq 'KELION_LOCAL_QWEN_WRAPPER|local-qwen-compat|opencode-constructor-root|codex-real' "$canonical_target"; then
            canonical_is_compat=1
          fi
          ;;
      esac
    elif [ -f "$canonical_codex" ]; then
      if grep -aEq 'KELION_LOCAL_QWEN_WRAPPER|local-qwen-compat|opencode-constructor-root|codex-real' "$canonical_codex"; then
        canonical_is_compat=1
      fi
    else
      return 1
    fi
  fi
  if [ "$canonical_is_compat" = 1 ]; then rm -f -- "$canonical_codex"; fi

  for retired in "${retired_paths[@]}"; do
    if [ -e "$retired" ] || [ -L "$retired" ]; then
      [ -f "$retired" ] || [ -L "$retired" ] || return 1
      rm -f -- "$retired"
    fi
  done

  if [ -e "$profile_dir" ] || [ -L "$profile_dir" ]; then
    [ -d "$profile_dir" ] && [ ! -L "$profile_dir" ] \
      && [ "$(realpath -e -- "$profile_dir")" = "$profile_dir" ] \
      && [ "$(stat -Lc '%u:%g' "$profile_dir")" = '0:0' ] || return 1
    retired=$profile_dir/kelion-worker.config.toml
    if [ -e "$retired" ] || [ -L "$retired" ]; then
      [ -f "$retired" ] || [ -L "$retired" ] || return 1
      rm -f -- "$retired"
    fi
    remaining=$(find -P "$profile_dir" -mindepth 1 -maxdepth 1 -print -quit) || return 1
    [ -z "$remaining" ] || return 1
    rmdir -- "$profile_dir"
  fi

  if [ -e "$auth_dir" ] || [ -L "$auth_dir" ]; then
    [ -d "$auth_dir" ] && [ ! -L "$auth_dir" ] \
      && [ "$(realpath -e -- "$auth_dir")" = "$auth_dir" ] \
      && [ "$(stat -Lc '%U:%G:%a' "$auth_dir")" = 'kelion-codex:kelion-codex:700' ] || return 1
    # Directorul a fost dedicat exclusiv loginului Codex retras. `-P -xdev`
    # nu urmează symlinkuri și nu traversează un mount injectat; un mount
    # rămas face rmdir să eșueze fail-closed.
    find -P "$auth_dir" -xdev -depth -mindepth 1 -delete || return 1
    remaining=$(find -P "$auth_dir" -mindepth 1 -maxdepth 1 -print -quit) || return 1
    [ -z "$remaining" ] || return 1
    rmdir -- "$auth_dir"
  fi

  for retired in "${retired_paths[@]}" "$profile_dir" "$auth_dir"; do
    [ ! -e "$retired" ] && [ ! -L "$retired" ] || return 1
  done
  if [ -e "$canonical_codex" ] || [ -L "$canonical_codex" ]; then
    canonical_target=$(realpath -e -- "$canonical_codex") || return 1
    [ -f "$canonical_target" ] || return 1
    ! grep -aEq 'KELION_LOCAL_QWEN_WRAPPER|local-qwen-compat|opencode-constructor-root|codex-real' "$canonical_target" || return 1
  fi
  for parent in \
    /opt/kelion-codex /opt/kelion-codex/bin /opt/private-ai/bin /etc/private-ai \
    /etc/sudoers.d /etc/systemd/system/kelion-codex-worker.service.d /var/lib; do
    if [ -d "$parent" ] && [ ! -L "$parent" ]; then sync -f "$parent" || return 1; fi
  done
}

ensure_group kelion-handoff
ensure_user kelion-codex /var/lib/kelion-codex
ensure_user kelion-publisher /var/lib/kelion-publisher
ensure_user kelion-release /var/lib/kelion-release
usermod -a -G kelion-handoff kelion-codex
usermod -a -G kelion-handoff kelion-publisher

validate_root_owned_install_directory /
validate_root_owned_install_directory /opt
validate_root_owned_install_directory /opt/private-ai
validate_root_owned_install_directory /opt/private-ai/bin
validate_root_owned_install_directory /etc
validate_root_owned_install_directory /etc/sudoers.d
validate_root_owned_install_directory /etc/systemd/system
ensure_root_owned_install_directory /opt/kelion-codex 0755
ensure_root_owned_install_directory /opt/kelion-constructor 0755
ensure_root_owned_install_directory /opt/kelion-constructor/lib 0755
ensure_root_owned_install_directory /etc/systemd/system/private-ai-web.service.d 0755
secure_service_parent /var/lib/kelion-codex
secure_service_parent /var/lib/kelion-publisher
secure_service_parent /var/lib/kelion-release
ensure_service_writable_dir /var/lib/kelion-codex/jobs kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-codex/.cache kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-codex/.config kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-codex/.local kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-publisher/state kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-publisher/.cache kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-publisher/.config kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-publisher/.local kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-release/state kelion-release kelion-release
secure_handoff_spool
install -d -o root -g root -m 0755 /etc/kelion
[ -d /etc/kelion ] && [ ! -L /etc/kelion ] \
  && [ "$(stat -c '%u:%g:%a' /etc/kelion)" = '0:0:755' ]
sync -f /etc/kelion
sync -f /etc
install -d -o root -g root -m 0755 "$ROOT/bin"
install -d -o root -g 10050 -m 0750 "$ROOT/config" "$RUNTIME_ROOT"

constructor_timers=(kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer)
constructor_services=(kelion-codex-worker.service kelion-constructor-publisher.service kelion-constructor-release.service)
constructor_markers=(/etc/kelion/codex-worker.enabled /etc/kelion/constructor-publisher.enabled /etc/kelion/constructor-release.enabled)
install_logicals=(
  artifact.codex-worker
  artifact.constructor-model-control
  artifact.constructor-model-switch
  authorization.kelion-codex-full-access
  configuration.opencode
  instructions.opencode
  systemd-dropin.private-ai-web-full-access
  artifact.constructor-publisher
  artifact.constructor-release
  artifact.github-askpass
  artifact.constructor-sync-worker
  artifact.constructor-service-client
  artifact.service-auth
  artifact.github-fixed-client
  runtime-helper
  compose-production
  systemd-recovery.kelion-runtime-config-recovery.service
  systemd-sync.kelion-constructor-sync.service
  systemd-timer.kelion-codex-worker.timer
  systemd-timer.kelion-constructor-publisher.timer
  systemd-timer.kelion-constructor-release.timer
  systemd-service.kelion-codex-worker.service
  systemd-service.kelion-constructor-publisher.service
  systemd-service.kelion-constructor-release.service
  systemd-controller.kelion-constructor-model-control.service
)
install_sources=(
  "$repo_root/deploy/codex-worker.mjs"
  "$repo_root/deploy/constructor-model-control.mjs"
  "$repo_root/deploy/constructor-model-switch.sh"
  "$repo_root/deploy/sudoers/kelion-codex-full-access"
  "$repo_root/deploy/opencode-constructor.json"
  "$repo_root/deploy/opencode-constructor-instructions.md"
  "$repo_root/deploy/systemd/private-ai-web-full-access.conf"
  "$repo_root/deploy/constructor-publisher.mjs"
  "$repo_root/deploy/constructor-release.mjs"
  "$repo_root/deploy/github-askpass.sh"
  "$repo_root/deploy/constructor-sync-worker.sh"
  "$repo_root/deploy/lib/constructor-service-client.mjs"
  "$repo_root/deploy/lib/service-auth.mjs"
  "$repo_root/deploy/lib/github-fixed-client.mjs"
  "$repo_root/deploy/lib/runtime-config-cutover.sh"
  "$repo_root/deploy/compose.production.yml"
  "$repo_root/deploy/systemd/kelion-runtime-config-recovery.service"
  "$repo_root/deploy/systemd/kelion-constructor-sync.service"
  "$repo_root/deploy/systemd/kelion-codex-worker.timer"
  "$repo_root/deploy/systemd/kelion-constructor-publisher.timer"
  "$repo_root/deploy/systemd/kelion-constructor-release.timer"
  "$repo_root/deploy/systemd/kelion-codex-worker.service"
  "$repo_root/deploy/systemd/kelion-constructor-publisher.service"
  "$repo_root/deploy/systemd/kelion-constructor-release.service"
  "$repo_root/deploy/systemd/kelion-constructor-model-control.service"
)
[ "${#install_logicals[@]}" -eq "${#install_sources[@]}" ]

map_install_logical() {
  local logical=$1
  install_owner=root
  install_group=root
  case "$logical" in
    artifact.codex-worker) install_target=/opt/kelion-codex/codex-worker.mjs; install_mode=555 ;;
    artifact.constructor-model-control) install_target=/opt/kelion-constructor/constructor-model-control.mjs; install_mode=555 ;;
    artifact.constructor-model-switch) install_target=/opt/private-ai/bin/constructor-model-switch; install_mode=755 ;;
    authorization.kelion-codex-full-access) install_target=/etc/sudoers.d/kelion-constructor-full-access; install_mode=440 ;;
    configuration.opencode) install_target=/srv/private-ai/home/.config/opencode/opencode.json; install_group=privateai; install_mode=640 ;;
    instructions.opencode) install_target=/srv/private-ai/home/.config/opencode/instructions.md; install_group=privateai; install_mode=640 ;;
    systemd-dropin.private-ai-web-full-access) install_target=/etc/systemd/system/private-ai-web.service.d/90-kelion-constructor-full-access.conf; install_mode=444 ;;
    artifact.constructor-publisher) install_target=/opt/kelion-constructor/constructor-publisher.mjs; install_mode=555 ;;
    artifact.constructor-release) install_target=/opt/kelion-constructor/constructor-release.mjs; install_mode=555 ;;
    artifact.github-askpass) install_target=/opt/kelion-constructor/github-askpass.sh; install_mode=555 ;;
    artifact.constructor-sync-worker) install_target=/opt/kelion-constructor/constructor-sync-worker.sh; install_mode=555 ;;
    artifact.constructor-service-client) install_target=/opt/kelion-constructor/lib/constructor-service-client.mjs; install_mode=444 ;;
    artifact.service-auth) install_target=/opt/kelion-constructor/lib/service-auth.mjs; install_mode=444 ;;
    artifact.github-fixed-client) install_target=/opt/kelion-constructor/lib/github-fixed-client.mjs; install_mode=444 ;;
    runtime-helper) install_target=$ROOT/bin/runtime-config-cutover.sh; install_mode=500 ;;
    compose-production) install_target=$ROOT/config/compose.production.yml; install_mode=444 ;;
    systemd-recovery.kelion-runtime-config-recovery.service) install_target=/etc/systemd/system/kelion-runtime-config-recovery.service; install_mode=444 ;;
    systemd-sync.kelion-constructor-sync.service) install_target=/etc/systemd/system/kelion-constructor-sync.service; install_mode=444 ;;
    systemd-timer.*) install_target=/etc/systemd/system/${logical#systemd-timer.}; install_mode=444 ;;
    systemd-service.*) install_target=/etc/systemd/system/${logical#systemd-service.}; install_mode=444 ;;
    systemd-controller.*) install_target=/etc/systemd/system/${logical#systemd-controller.}; install_mode=444 ;;
    *) return 1 ;;
  esac
}

current_source_sha256() {
  local index
  {
    for index in "${!install_logicals[@]}"; do
      [ -f "${install_sources[$index]}" ] && [ ! -L "${install_sources[$index]}" ] || return 1
      printf '%s\t%s\n' "${install_logicals[$index]}" \
        "$(sha256sum "${install_sources[$index]}" | awk '{print $1}')"
    done
  } | sha256sum | awk '{print $1}'
}

write_install_journal() {
  local phase=$1 temporary
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-install-journal.XXXXXX")
  jq -cn \
    --arg phase "$phase" \
    --arg requestId "$install_request_id" \
    --arg commit "$install_commit" \
    --arg transactionRoot "$install_root" \
    --arg manifestSha256 "$install_manifest_sha256" \
    --arg sourceSha256 "$install_source_sha256" \
    --arg supersededTransactionRoot "$install_superseded_root" \
    --arg supersededManifestSha256 "$install_superseded_manifest_sha256" \
    --arg supersededSourceSha256 "$install_superseded_source_sha256" \
    --arg previousSupersededTransactionRoot "$install_previous_superseded_root" \
    --arg previousSupersededManifestSha256 "$install_previous_superseded_manifest_sha256" \
    --arg previousSupersededSourceSha256 "$install_previous_superseded_source_sha256" \
    '{schema:1,kind:"constructor-install",phase:$phase,requestId:$requestId,commit:$commit,
      transactionRoot:$transactionRoot,manifestSha256:$manifestSha256,sourceSha256:$sourceSha256}
      + if $supersededTransactionRoot == "" then {} else {
          supersededTransactionRoot:$supersededTransactionRoot,
          supersededManifestSha256:$supersededManifestSha256,
          supersededSourceSha256:$supersededSourceSha256
        } end
      + if $previousSupersededTransactionRoot == "" then {} else {
          previousSupersededTransactionRoot:$previousSupersededTransactionRoot,
          previousSupersededManifestSha256:$previousSupersededManifestSha256,
          previousSupersededSourceSha256:$previousSupersededSourceSha256
        } end' > "$temporary"
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$INSTALL_JOURNAL"
  sync -f "$RUNTIME_ROOT"
}

stage_install_transaction() {
  local index logical digest
  install_source_sha256=$(current_source_sha256)
  [[ "$install_source_sha256" =~ ^[0-9a-f]{64}$ ]]
  install_commit=${install_source_sha256:0:40}
  install_request_id=$(tr 'A-F' 'a-f' < /proc/sys/kernel/random/uuid)
  [[ "$install_request_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
  install_root=$(mktemp -d "$RUNTIME_ROOT/constructor-install.XXXXXX")
  chown root:root "$install_root"
  chmod 0700 "$install_root"
  install -d -o root -g root -m 0700 "$install_root/files"
  : > "$install_root/manifest"
  chown root:root "$install_root/manifest"
  chmod 0600 "$install_root/manifest"
  for index in "${!install_logicals[@]}"; do
    logical=${install_logicals[$index]}
    install -o root -g root -m 0600 "${install_sources[$index]}" "$install_root/files/$logical"
    digest=$(sha256sum "$install_root/files/$logical" | awk '{print $1}')
    printf '%s\t%s\n' "$logical" "$digest" >> "$install_root/manifest"
    sync -f "$install_root/files/$logical"
  done
  sync -f "$install_root/manifest"
  sync -f "$install_root/files"
  sync -f "$install_root"
  install_manifest_sha256=$(sha256sum "$install_root/manifest" | awk '{print $1}')
  write_install_journal armed
}

load_install_transaction() {
  local index=0 logical digest extra candidate
  [ -f "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] \
    && [ "$(stat -c '%u:%g:%a' "$INSTALL_JOURNAL")" = '0:0:600' ] || return 1
  jq -e '.schema == 1 and .kind == "constructor-install" and
    (.phase == "armed" or .phase == "quiesced") and
    (.requestId | strings | test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and
    (.commit | strings | test("^[0-9a-f]{40}$")) and
    (.transactionRoot | strings | test("^/root/kelion/runtime/constructor-install\\.[A-Za-z0-9]+$")) and
    (.manifestSha256 | strings | test("^[0-9a-f]{64}$")) and
    (.sourceSha256 | strings | test("^[0-9a-f]{64}$")) and
    (.sourceSha256 == .manifestSha256) and
    (((has("supersededTransactionRoot") | not) and
      (has("supersededManifestSha256") | not) and
      (has("supersededSourceSha256") | not)) or
      ((.supersededTransactionRoot | strings | test("^/root/kelion/runtime/constructor-install\\.[A-Za-z0-9]+$")) and
       (.supersededManifestSha256 | strings | test("^[0-9a-f]{64}$")) and
       (.supersededSourceSha256 | strings | test("^[0-9a-f]{64}$")) and
       (.supersededSourceSha256 == .supersededManifestSha256) and
       (.supersededSourceSha256 != .sourceSha256) and
       (.supersededTransactionRoot != .transactionRoot))) and
    (((has("previousSupersededTransactionRoot") | not) and
      (has("previousSupersededManifestSha256") | not) and
      (has("previousSupersededSourceSha256") | not)) or
      ((has("supersededTransactionRoot")) and
       (.previousSupersededTransactionRoot | strings | test("^/root/kelion/runtime/constructor-install\\.[A-Za-z0-9]+$")) and
       (.previousSupersededManifestSha256 | strings | test("^[0-9a-f]{64}$")) and
       (.previousSupersededSourceSha256 | strings | test("^[0-9a-f]{64}$")) and
       (.previousSupersededSourceSha256 == .previousSupersededManifestSha256) and
       (.previousSupersededSourceSha256 != .sourceSha256) and
       (.previousSupersededSourceSha256 != .supersededSourceSha256) and
       (.previousSupersededTransactionRoot != .transactionRoot) and
       (.previousSupersededTransactionRoot != .supersededTransactionRoot)))' "$INSTALL_JOURNAL" >/dev/null || return 1
  install_request_id=$(jq -er '.requestId' "$INSTALL_JOURNAL")
  install_commit=$(jq -er '.commit' "$INSTALL_JOURNAL")
  install_root=$(jq -er '.transactionRoot' "$INSTALL_JOURNAL")
  install_manifest_sha256=$(jq -er '.manifestSha256' "$INSTALL_JOURNAL")
  install_source_sha256=$(jq -er '.sourceSha256' "$INSTALL_JOURNAL")
  install_superseded_root=$(jq -er '.supersededTransactionRoot // ""' "$INSTALL_JOURNAL")
  install_superseded_manifest_sha256=$(jq -er '.supersededManifestSha256 // ""' "$INSTALL_JOURNAL")
  install_superseded_source_sha256=$(jq -er '.supersededSourceSha256 // ""' "$INSTALL_JOURNAL")
  install_previous_superseded_root=$(jq -er '.previousSupersededTransactionRoot // ""' "$INSTALL_JOURNAL")
  install_previous_superseded_manifest_sha256=$(jq -er '.previousSupersededManifestSha256 // ""' "$INSTALL_JOURNAL")
  install_previous_superseded_source_sha256=$(jq -er '.previousSupersededSourceSha256 // ""' "$INSTALL_JOURNAL")
  [ "${install_source_sha256:0:40}" = "$install_commit" ] || return 1
  [ -d "$install_root" ] && [ ! -L "$install_root" ] \
    && [ "$(realpath -e -- "$install_root")" = "$install_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$install_root")" = '0:0:700' ] || return 1
  [ -d "$install_root/files" ] && [ ! -L "$install_root/files" ] \
    && [ "$(stat -c '%u:%g:%a' "$install_root/files")" = '0:0:700' ] || return 1
  [ -f "$install_root/manifest" ] && [ ! -L "$install_root/manifest" ] \
    && [ "$(stat -c '%u:%g:%a' "$install_root/manifest")" = '0:0:600' ] \
    && [ "$(sha256sum "$install_root/manifest" | awk '{print $1}')" = "$install_manifest_sha256" ] || return 1
  while IFS=$'\t' read -r logical digest extra; do
    [ "$index" -lt "${#install_logicals[@]}" ] && [ -z "$extra" ] \
      && [ "$logical" = "${install_logicals[$index]}" ] \
      && [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    candidate=$install_root/files/$logical
    [ -f "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:600' ] \
      && [ "$(sha256sum "$candidate" | awk '{print $1}')" = "$digest" ] || return 1
    index=$((index + 1))
  done < "$install_root/manifest"
  [ "$index" -eq "${#install_logicals[@]}" ] || return 1
  if [ -n "$install_superseded_root" ]; then
    validate_superseded_install_root "$install_superseded_root" "$install_superseded_manifest_sha256"
  fi
  if [ -n "$install_previous_superseded_root" ]; then
    validate_superseded_install_root "$install_previous_superseded_root" "$install_previous_superseded_manifest_sha256"
  fi
}

validate_superseded_install_root() {
  local root=$1 manifest_sha256=$2 index=0 logical digest extra candidate
  [[ "$root" =~ ^/root/kelion/runtime/constructor-install\.[A-Za-z0-9]+$ ]] || return 1
  [[ "$manifest_sha256" =~ ^[0-9a-f]{64}$ ]] || return 1
  [ -e "$root" ] || [ -L "$root" ] || return 1
  [ -d "$root" ] && [ ! -L "$root" ] \
    && [ "$(realpath -e -- "$root")" = "$root" ] \
    && [ "$(stat -c '%u:%g:%a' "$root")" = '0:0:700' ] || return 1
  [ -d "$root/files" ] && [ ! -L "$root/files" ] \
    && [ "$(stat -c '%u:%g:%a' "$root/files")" = '0:0:700' ] || return 1
  [ -f "$root/manifest" ] && [ ! -L "$root/manifest" ] \
    && [ "$(stat -c '%u:%g:%a' "$root/manifest")" = '0:0:600' ] \
    && [ "$(sha256sum "$root/manifest" | awk '{print $1}')" = "$manifest_sha256" ] || return 1
  while IFS=$'\t' read -r logical digest extra; do
    [ "$index" -lt "${#install_logicals[@]}" ] && [ -z "$extra" ] \
      && [ "$logical" = "${install_logicals[$index]}" ] \
      && [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    candidate=$root/files/$logical
    [ -f "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:600' ] \
      && [ "$(sha256sum "$candidate" | awk '{print $1}')" = "$digest" ] || return 1
    index=$((index + 1))
  done < "$root/manifest"
  [ "$index" -eq "${#install_logicals[@]}" ]
}

remove_superseded_install_root() {
  local logical root=$install_superseded_root
  [ -n "$root" ] || return 0
  validate_superseded_install_root "$root" "$install_superseded_manifest_sha256" || return 1
  if [ -e "$root" ] || [ -L "$root" ]; then
    for logical in "${install_logicals[@]}"; do rm -f -- "$root/files/$logical"; done
    rm -f -- "$root/manifest"
    rmdir -- "$root/files"
    rmdir -- "$root"
    sync -f "$RUNTIME_ROOT"
  fi
}

remove_previous_superseded_install_root() {
  local logical root=$install_previous_superseded_root
  [ -n "$root" ] || return 0
  validate_superseded_install_root "$root" "$install_previous_superseded_manifest_sha256" || return 1
  if [ -e "$root" ] || [ -L "$root" ]; then
    for logical in "${install_logicals[@]}"; do rm -f -- "$root/files/$logical"; done
    rm -f -- "$root/manifest"
    rmdir -- "$root/files"
    rmdir -- "$root"
    sync -f "$RUNTIME_ROOT"
  fi
}

supersede_quiesced_install_transaction() {
  local old_root=$install_root
  local old_manifest_sha256=$install_manifest_sha256
  local old_source_sha256=$install_source_sha256

  # Jurnalul nou, construit integral din checkoutul curent, înlocuiește atomic
  # intentul vechi. Referința autentificată la rădăcina veche rămâne în jurnal
  # până la commitul durabil al noii generații; cleanup-ul începe numai după
  # unlink+fsync al jurnalului, astfel încât un crash înainte sau după switch
  # are întotdeauna exact un owner durabil și recuperabil.
  # Maximum două generații supersedate autentificate. A doua mută referința
  # veche în slotul precedent; o a treia este refuzată înainte de orice switch.
  if [ -n "$install_superseded_root" ]; then
    [ -z "$install_previous_superseded_root" ] || return 1
    install_previous_superseded_root=$install_superseded_root
    install_previous_superseded_manifest_sha256=$install_superseded_manifest_sha256
    install_previous_superseded_source_sha256=$install_superseded_source_sha256
  fi
  install_superseded_root=$old_root
  install_superseded_manifest_sha256=$old_manifest_sha256
  install_superseded_source_sha256=$old_source_sha256
  stage_install_transaction
  [ "$install_source_sha256" != "$install_superseded_source_sha256" ]
  [ -z "$install_previous_superseded_source_sha256" ] \
    || [ "$install_source_sha256" != "$install_previous_superseded_source_sha256" ]
  write_install_journal quiesced
  # Rădăcina veche rămâne intactă și referită până când noua generație trece
  # toate validările. Cleanup-ul ambelor rădăcini începe numai după unlink+fsync
  # al jurnalului la commit; un crash poate lăsa astfel doar un orphan root-only,
  # niciodată un jurnal care indică o tranzacție ștearsă parțial.
  printf '{"ok":true,"event":"install_intent_superseded","superseded_source_sha256":"%s","current_source_sha256":"%s","source_commit":"%s"}\n' \
    "$old_source_sha256" "$install_source_sha256" "$constructor_install_source_commit" >&2
}

publish_install_candidate() {
  local logical=$1 candidate=$install_root/files/$1
  map_install_logical "$logical"
  install_atomic "$candidate" "$install_target" "$install_owner" "$install_group" "$install_mode"
  [ "$(stat -Lc '%U:%G:%a:%h' "$install_target")" = "$install_owner:$install_group:$install_mode:1" ]
  cmp -s -- "$candidate" "$install_target"
}

validate_published_candidate() {
  local logical=$1 candidate=$install_root/files/$1
  map_install_logical "$logical"
  [ -f "$install_target" ] && [ ! -L "$install_target" ] \
    && [ "$(stat -Lc '%U:%G:%a:%h' "$install_target")" = "$install_owner:$install_group:$install_mode:1" ] \
    && cmp -s -- "$candidate" "$install_target"
}

validate_systemd_text_file_bytes() {
  local file=$1 original_size clean_size last_byte
  [ -s "$file" ] && [ "$(stat -c '%s' "$file")" -le 65536 ] || return 1
  original_size=$(wc -c < "$file")
  clean_size=$(LC_ALL=C tr -d '\000-\011\013-\037\177' < "$file" | wc -c)
  [ "$original_size" -eq "$clean_size" ] || return 1
  last_byte=$(tail -c 1 -- "$file" | od -An -t u1 | tr -d '[:space:]')
  [ "$last_byte" = 10 ]
}

validate_source_systemd_text_files() {
  local index logical count=0
  for index in "${!install_logicals[@]}"; do
    logical=${install_logicals[$index]}
    case "$logical" in
      systemd-*)
        validate_systemd_text_file_bytes "${install_sources[$index]}" || return 1
        count=$((count + 1))
        ;;
    esac
  done
  [ "$count" -eq 10 ]
}

verify_candidate_units() {
  local allow_legacy_text=${1:-0} verify_root=$install_root/verify index result=0 verify_help
  local -a verify_logicals=(
    systemd-recovery.kelion-runtime-config-recovery.service
    systemd-sync.kelion-constructor-sync.service
    systemd-timer.kelion-codex-worker.timer
    systemd-timer.kelion-constructor-publisher.timer
    systemd-timer.kelion-constructor-release.timer
    systemd-service.kelion-codex-worker.service
    systemd-service.kelion-constructor-publisher.service
    systemd-service.kelion-constructor-release.service
    systemd-controller.kelion-constructor-model-control.service
  )
  local -a verify_names=(
    kelion-runtime-config-recovery.service
    kelion-constructor-sync.service
    kelion-codex-worker.timer
    kelion-constructor-publisher.timer
    kelion-constructor-release.timer
    kelion-codex-worker.service
    kelion-constructor-publisher.service
    kelion-constructor-release.service
    kelion-constructor-model-control.service
  )
  local -a verify_paths=()

  case "$allow_legacy_text" in 0|1) ;; *) return 1 ;; esac
  verify_help=$(systemd-analyze verify --help 2>&1) || return 1
  grep -q -- '--recursive-errors=' <<<"$verify_help" \
    || { echo 'systemd-analyze nu poate valida recursiv dependențele candidate' >&2; return 1; }
  if [ -e "$verify_root" ] || [ -L "$verify_root" ]; then
    [ -d "$verify_root" ] && [ ! -L "$verify_root" ] \
      && [ "$(stat -c '%u:%g:%a' "$verify_root")" = '0:0:700' ] || return 1
  else
    install -d -o root -g root -m 0700 "$verify_root"
  fi
  for index in "${!verify_logicals[@]}"; do
    if [ "$allow_legacy_text" = 0 ]; then
      validate_systemd_text_file_bytes "$install_root/files/${verify_logicals[$index]}" \
        || return 1
    fi
    verify_paths+=("$verify_root/${verify_names[$index]}")
    install_atomic "$install_root/files/${verify_logicals[$index]}" \
      "${verify_paths[$index]}" root root 0600
    cmp -s -- "${verify_paths[$index]}" "$install_root/files/${verify_logicals[$index]}"
  done
  # Toată tupla este încărcată într-un singur namespace candidat, sub numele
  # systemd reale. Astfel Unit=/Requires=/After nu se pot rezolva accidental
  # la generația live veche și orice dependență lipsă devine eroare.
  if ! systemd-analyze verify --recursive-errors=yes "${verify_paths[@]}"; then result=1; fi
  for index in "${!verify_paths[@]}"; do rm -f -- "${verify_paths[$index]}"; done
  sync -f "$verify_root"
  rmdir -- "$verify_root"
  sync -f "$install_root"
  return "$result"
}

validate_effective_installed_unit() {
  local unit=$1 expected=/etc/systemd/system/$1 fragment dropins load_state need_reload
  fragment=$(systemctl show "$unit" --property=FragmentPath --value) || return 1
  dropins=$(systemctl show "$unit" --property=DropInPaths --value) || return 1
  load_state=$(systemctl show "$unit" --property=LoadState --value) || return 1
  need_reload=$(systemctl show "$unit" --property=NeedDaemonReload --value) || return 1
  [ "$fragment" = "$expected" ] && [ -z "$dropins" ] \
    && [ "$load_state" = loaded ] && [ "$need_reload" = no ]
}

validate_constructor_unit_file_state() {
  local unit=$1 state
  state=$(systemctl show "$unit" --property=UnitFileState --value 2>/dev/null) || return 1
  case "$unit" in
    kelion-codex-worker.timer|kelion-constructor-publisher.timer|kelion-constructor-release.timer)
      [ "$state" = disabled ] ;;
    kelion-codex-worker.service|kelion-constructor-publisher.service|kelion-constructor-release.service)
      # Serviciile oneshot nu au [Install]; starea canonică este static, nu
      # enabled/disabled. Numai timerele dețin capabilitatea de pornire.
      [ "$state" = static ] ;;
    *) return 1 ;;
  esac
}

validate_constructor_prepublication_unit_file_state() {
  local unit=$1 state
  state=$(systemctl show "$unit" --property=UnitFileState --value 2>/dev/null) || return 1
  case "$unit" in
    kelion-codex-worker.timer|kelion-constructor-publisher.timer|kelion-constructor-release.timer)
      [ "$state" = disabled ] ;;
    kelion-codex-worker.service|kelion-constructor-publisher.service|kelion-constructor-release.service)
      # Înainte de publicare pot exista fie unități legacy enable-able curățate
      # la disabled, fie serviciile canonice fără [Install], deci static.
      case "$state" in disabled|static) ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}

stop_and_disable_constructor_timer() {
  local unit=$1
  case "$unit" in
    kelion-codex-worker.timer|kelion-constructor-publisher.timer|kelion-constructor-release.timer) ;;
    *) return 1 ;;
  esac
  systemctl stop "$unit" >/dev/null 2>&1 || :
  systemctl disable --no-reload "$unit" >/dev/null 2>&1 || :
}

stop_and_disable_constructor_service() {
  local unit=$1
  case "$unit" in
    kelion-codex-worker.service|kelion-constructor-publisher.service|kelion-constructor-release.service) ;;
    *) return 1 ;;
  esac
  systemctl stop "$unit" >/dev/null 2>&1 || :
  # Unitățile vechi pot avea [Install], cele canonice sunt statice. Retragem
  # best-effort legăturile legacy și folosim numai postcondiția verificată mai
  # jos ca autoritate pentru succes.
  systemctl disable --no-reload "$unit" >/dev/null 2>&1 || :
}

validate_install_quiesce_postconditions() {
  local expected_count=${1:-} unit state count=0
  case "$expected_count" in 0|6) ;; *) return 1 ;; esac
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    count=$((count + 1))
    state=$(systemctl show "$unit" --property=ActiveState --value) || return 1
    case "$state" in inactive|failed) ;; *) return 1 ;; esac
    validate_constructor_prepublication_unit_file_state "$unit" || return 1
    [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ] || return 1
  done
  [ "$count" -eq "$expected_count" ] || return 1
  for unit in kelion-constructor-sync.service kelion-constructor-model-control.service kelion-runtime-config-recovery.service; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    state=$(systemctl show "$unit" --property=ActiveState --value) || return 1
    case "$state" in inactive|failed) ;; *) return 1 ;; esac
    [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ] || return 1
  done
  [ ! -e /run/kelion-constructor-model-control/control.sock ] \
    && [ ! -L /run/kelion-constructor-model-control/control.sock ]
}

wait_for_install_quiesce_postconditions() {
  local expected_count=${1:-} attempt
  for ((attempt = 1; attempt <= 12; attempt++)); do
    if validate_install_quiesce_postconditions "$expected_count"; then return 0; fi
    [ "$attempt" -lt 12 ] || break
    sleep 0.25
  done
  return 1
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

start_model_controller_after_install_commit() {
  local attempt socket=/run/kelion-constructor-model-control/control.sock
  [ ! -e "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] \
    && [ ! -e "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    && [ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] \
    && [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] || return 1
  systemctl daemon-reload || return 1
  systemctl enable kelion-constructor-model-control.service >/dev/null || return 1
  systemctl restart kelion-constructor-model-control.service || return 1
  for ((attempt = 1; attempt <= 40; attempt++)); do
    if systemctl is-active --quiet kelion-constructor-model-control.service \
      && [ -S "$socket" ] && [ ! -L "$socket" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$socket")" = '0:10050:660' ]; then
      return 0
    fi
    [ "$attempt" -lt 40 ] || break
    sleep 0.25
  done
  return 1
}

validate_published_systemd_postconditions() {
  local unit state
  for unit in \
    kelion-runtime-config-recovery.service kelion-constructor-sync.service \
    "${constructor_timers[@]}" "${constructor_services[@]}"; do
    validate_effective_installed_unit "$unit" || return 1
  done
  systemctl is-enabled --quiet kelion-runtime-config-recovery.service || return 1
  validate_effective_installed_unit kelion-constructor-model-control.service || return 1
  systemctl is-enabled --quiet kelion-constructor-model-control.service || return 1
  validate_model_controller_quiesced || return 1
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    state=$(systemctl show "$unit" --property=ActiveState --value) || return 1
    case "$state" in inactive|failed) ;; *) return 1 ;; esac
    validate_constructor_unit_file_state "$unit" || return 1
    [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ] || return 1
  done
}

wait_for_published_systemd_postconditions() {
  local attempt
  for ((attempt = 1; attempt <= 12; attempt++)); do
    if validate_published_systemd_postconditions; then return 0; fi
    [ "$attempt" -lt 12 ] || break
    sleep 0.25
  done
  return 1
}

retract_ready_stamp() {
  if [ ! -e "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ]; then return 0; fi
  [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
    && [ "$(stat -c '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] || return 1
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    if [ -d "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ]; then
      rmdir -- "$READY_STAMP" || return 1
    else
      rm -f -- "$READY_STAMP" || return 1
    fi
    sync -f "$READY_ROOT"
  fi
}

quiesce_before_install() {
  local unit count=0 failed=0
  retract_ready_stamp || failed=1
  for unit in "${constructor_timers[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then
      count=$((count + 1))
      stop_and_disable_constructor_timer "$unit" || failed=1
    fi
  done
  for unit in "${constructor_services[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then
      count=$((count + 1))
      stop_and_disable_constructor_service "$unit" || failed=1
    fi
  done
  for unit in kelion-constructor-sync.service kelion-constructor-model-control.service kelion-runtime-config-recovery.service; do
    if systemctl cat "$unit" >/dev/null 2>&1; then systemctl stop "$unit" >/dev/null 2>&1 || :; fi
  done
  systemctl daemon-reload || failed=1
  case "$count" in 0|6) ;; *) failed=1 ;; esac
  [ "$failed" = 0 ] || return 1
  wait_for_install_quiesce_postconditions "$count"
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

validate_manual_model_dropin_state() {
  local legacy=/etc/systemd/system/private-ai-llm.service.d/90-qwen35-122b-max.conf
  local runtime=/run/systemd/system/private-ai-llm.service.d/90-constructor-model.conf
  local dropins
  [ ! -e "$legacy" ] && [ ! -L "$legacy" ] || return 1
  dropins=$(systemctl show private-ai-llm.service --property=DropInPaths --value) || return 1
  [[ " $dropins " != *" $legacy "* ]] || return 1
  if [ "$constructor_expected_model_profile" = powerful ]; then
    [ -f "$runtime" ] && [ ! -L "$runtime" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$runtime")" = '0:0:644:1' ] \
      && [ "$(<"$runtime")" = "$(expected_powerful_runtime_dropin)" ] \
      && [[ " $dropins " == *" $runtime "* ]] || return 1
  else
    [ ! -e "$runtime" ] && [ ! -L "$runtime" ] || return 1
    [[ " $dropins " != *" $runtime "* ]] || return 1
  fi
}

retire_legacy_model_dropin() {
  local legacy_dir=/etc/systemd/system/private-ai-llm.service.d
  local legacy=$legacy_dir/90-qwen35-122b-max.conf
  local runtime_dir=/run/systemd/system/private-ai-llm.service.d
  local runtime=$runtime_dir/90-constructor-model.conf
  local model_lock=/run/lock/private-ai-model-switch.lock model_lock_identity
  local candidate='' expected alias_before alias_after
  bash "$repo_root/deploy/constructor-model-switch.sh" --prepare-lock >/dev/null || return 1
  [ -f "$model_lock" ] && [ ! -L "$model_lock" ] \
    && [ "$(stat -Lc '%U:%G:%a:%h' "$model_lock")" = 'root:privateai:660:1' ] || return 1
  model_lock_identity=$(stat -Lc '%d:%i' "$model_lock") || return 1
  exec 8<>"$model_lock" || return 1
  [ "$(readlink "/proc/$$/fd/8")" = "$model_lock" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/8")" = "$model_lock_identity" ] \
    && [ "$(stat -Lc '%U:%G:%a:%h' "/proc/$$/fd/8")" = 'root:privateai:660:1' ] || return 1
  flock -w 3600 8 || return 1
  [ ! -L "$model_lock" ] \
    && [ "$(stat -Lc '%d:%i' "$model_lock")" = "$model_lock_identity" ] \
    && [ "$(stat -Lc '%d:%i' "/proc/$$/fd/8")" = "$model_lock_identity" ] || return 1
  expected=$(expected_powerful_runtime_dropin) || return 1
  alias_before=$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models \
    | jq -er '.data | select(type == "array" and length == 1) | .[0].id') || return 1
  case "$constructor_expected_model_profile:$alias_before" in
    fast:qwen3.6-35b-a3b-local|powerful:qwen3.5-122b-a10b-local) ;;
    *) return 1 ;;
  esac

  if [ -e "$legacy" ] || [ -L "$legacy" ]; then
    [ -d "$legacy_dir" ] && [ ! -L "$legacy_dir" ] \
      && [ "$(realpath -e -- "$legacy_dir")" = "$legacy_dir" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$legacy_dir")" = '0:0:755' ] || return 1
    [ -f "$legacy" ] && [ ! -L "$legacy" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$legacy")" = '0:0:644:1' ] \
      && [ "$(<"$legacy")" = "$expected" ] || return 1
  fi

  if [ "$constructor_expected_model_profile" = powerful ]; then
    validate_max_model_complete_receipt "$constructor_fast_model_path" || return 1
    if [ -e "$runtime_dir" ] || [ -L "$runtime_dir" ]; then
      [ -d "$runtime_dir" ] && [ ! -L "$runtime_dir" ] \
        && [ "$(realpath -e -- "$runtime_dir")" = "$runtime_dir" ] \
        && [ "$(stat -Lc '%u:%g:%a' "$runtime_dir")" = '0:0:755' ] || return 1
    else
      install -d -o root -g root -m 0755 "$runtime_dir" || return 1
      sync -f /run/systemd/system || return 1
    fi
    candidate=$(mktemp "$runtime_dir/.90-constructor-model.XXXXXX") || return 1
    if ! expected_powerful_runtime_dropin > "$candidate" \
      || ! chown root:root "$candidate" \
      || ! chmod 0644 "$candidate" \
      || ! sync -f "$candidate" \
      || ! mv -f -- "$candidate" "$runtime" \
      || ! sync -f "$runtime" \
      || ! sync -f "$runtime_dir"; then
      rm -f -- "$candidate"
      return 1
    fi
  elif [ -e "$runtime" ] || [ -L "$runtime" ]; then
    [ -d "$runtime_dir" ] && [ ! -L "$runtime_dir" ] \
      && [ "$(realpath -e -- "$runtime_dir")" = "$runtime_dir" ] || return 1
    [ ! -d "$runtime" ] || return 1
    rm -f -- "$runtime" || return 1
    sync -f "$runtime_dir" || return 1
  fi

  if [ -e "$legacy" ] || [ -L "$legacy" ]; then
    rm -f -- "$legacy" || return 1
    sync -f "$legacy_dir" || return 1
  fi
  systemctl daemon-reload || return 1
  alias_after=$(curl --fail --silent --show-error --max-time 30 \
    http://127.0.0.1:24080/v1/models \
    | jq -er '.data | select(type == "array" and length == 1) | .[0].id') || return 1
  [ "$alias_after" = "$alias_before" ] || return 1
  validate_manual_model_dropin_state
}

clear_install_transaction() {
  local logical
  [ -f "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] || return 1
  rm -f -- "$INSTALL_JOURNAL"
  sync -f "$RUNTIME_ROOT"
  for logical in "${install_logicals[@]}"; do rm -f -- "$install_root/files/$logical"; done
  rm -f -- "$install_root/manifest"
  rmdir -- "$install_root/files"
  rmdir -- "$install_root"
  remove_superseded_install_root
  remove_previous_superseded_install_root
  sync -f "$RUNTIME_ROOT"
}

install_root=''
install_request_id=''
install_commit=''
install_manifest_sha256=''
install_source_sha256=''
install_superseded_root=''
install_superseded_manifest_sha256=''
install_superseded_source_sha256=''
install_previous_superseded_root=''
install_previous_superseded_manifest_sha256=''
install_previous_superseded_source_sha256=''
resume_different_source=0

# b911 a publicat serviciile canonice statice și jurnalul runtime `prepared`,
# apoi helperul său a rămas blocat deoarece a tratat exit-ul `disable` pentru o
# unitate statică drept eșec. Compatibilitatea este intenționat one-shot și
# dublu pin-uită: helperul live trebuie să fie exact generația cunoscută, iar
# copia de recovery trebuie să fie exact helperul auditat din acest bundle.
readonly LEGACY_STATIC_RUNTIME_HELPER_SHA256=db72ef1d9c92660adfb656330efb4e651c16d0439643c7fd944c2dd56ee1c9de
readonly COMPATIBLE_RUNTIME_HELPER_SHA256=22c6cf4e8b8dd2f0abdaad24370661065323a46228c116b2bd577588e3476708

recover_existing_runtime_journal() {
  local runtime_journal=$RUNTIME_ROOT/runtime-config-cutover.journal
  local live_helper=$ROOT/bin/runtime-config-cutover.sh
  local live_compose=$ROOT/config/compose.production.yml
  local candidate_helper=$repo_root/deploy/lib/runtime-config-cutover.sh
  local live_sha candidate_sha recovery_helper temporary='' status=0 cleanup_failed=0

  [ -f "$runtime_journal" ] && [ ! -L "$runtime_journal" ] \
    && [ "$(stat -c '%u:%g:%a' "$runtime_journal")" = '0:0:600' ] || return 1
  [ -f "$live_helper" ] && [ ! -L "$live_helper" ] \
    && [ "$(stat -c '%u:%g:%a' "$live_helper")" = '0:0:500' ] || return 1
  [ -f "$live_compose" ] && [ ! -L "$live_compose" ] \
    && [ "$(stat -c '%u:%g:%a' "$live_compose")" = '0:0:444' ] || return 1
  live_sha=$(sha256sum "$live_helper" | awk '{print $1}') || return 1
  recovery_helper=$live_helper

  if [ "$live_sha" = "$LEGACY_STATIC_RUNTIME_HELPER_SHA256" ]; then
    # Jurnalul installerului autentifică tranzacția b911, iar manifestul ei
    # leagă helperul și compose-ul live de candidații root-only cu hash.
    load_install_transaction || return 1
    validate_published_candidate runtime-helper || return 1
    validate_published_candidate compose-production || return 1
    jq -e '
      .schema == 1 and .phase == "prepared" and
      (.transactionRoot | strings | test("^/root/kelion/runtime/runtime-config-txn\\.[A-Za-z0-9]+$")) and
      (keys == ["phase","schema","transactionRoot"])
    ' "$runtime_journal" >/dev/null || return 1
    [ -f "$candidate_helper" ] && [ ! -L "$candidate_helper" ] || return 1
    candidate_sha=$(sha256sum "$candidate_helper" | awk '{print $1}') || return 1
    [ "$candidate_sha" = "$COMPATIBLE_RUNTIME_HELPER_SHA256" ] || return 1

    temporary=$(mktemp /run/kelion-runtime-recovery-helper.XXXXXX) || return 1
    if ! install -o root -g root -m 0500 "$candidate_helper" "$temporary" \
      || [ -L "$temporary" ] \
      || [ "$(stat -c '%u:%g:%a' "$temporary")" != '0:0:500' ] \
      || [ "$(sha256sum "$temporary" | awk '{print $1}')" != "$COMPATIBLE_RUNTIME_HELPER_SHA256" ] \
      || ! sync -f "$temporary"; then
      rm -f -- "$temporary" || true
      return 1
    fi
    recovery_helper=$temporary
    if KELION_CUTOVER_LOCK_HELD=1 \
      KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$install_request_id" \
      KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$install_commit" \
      bash "$recovery_helper" --recover-only "$live_compose" --leave-constructor-quiesced; then
      status=0
    else
      status=$?
    fi
  elif KELION_CUTOVER_LOCK_HELD=1 \
    "$recovery_helper" --recover-only "$live_compose" --leave-constructor-quiesced; then
    status=0
  else
    status=$?
  fi

  if [ -n "$temporary" ]; then
    rm -f -- "$temporary" || cleanup_failed=1
    sync -f /run || cleanup_failed=1
  fi
  [ "$status" = 0 ] && [ "$cleanup_failed" = 0 ] \
    && [ ! -e "$runtime_journal" ] && [ ! -L "$runtime_journal" ]
}

# În mod normal jurnalul este consumat de helperul live care l-a creat. Ramura
# allowlist de mai sus este singura migrare compatibilă și nu înlocuiește live
# helperul înainte ca absența jurnalului să fie dovedită.
set_constructor_install_phase recovery-preflight
if [ -e "$RUNTIME_ROOT/runtime-config-cutover.journal" ] || [ -L "$RUNTIME_ROOT/runtime-config-cutover.journal" ]; then
  recover_existing_runtime_journal
fi
for journal in "$RUNTIME_ROOT/constructor-activation.journal" "$RUNTIME_ROOT/constructor-gate-refresh.journal"; do
  [ ! -e "$journal" ] && [ ! -L "$journal" ] \
    || { echo "recovery Constructor activ; instalarea este refuzată: $journal" >&2; constructor_install_failure_line=$LINENO; exit 1; }
done

validate_source_systemd_text_files \
  || { echo 'sursa unităților systemd încalcă contractul strict de bytes' >&2; constructor_install_failure_line=$LINENO; exit 1; }
validate_constructor_sudoers "$repo_root/deploy/sudoers/kelion-codex-full-access" \
  || { echo 'regula sudoers Constructor este invalidă' >&2; constructor_install_failure_line=$LINENO; exit 1; }

set_constructor_install_phase transaction-prepare
if [ -e "$INSTALL_JOURNAL" ] || [ -L "$INSTALL_JOURNAL" ]; then
  load_install_transaction \
    || { echo 'jurnalul de instalare/deploy existent nu este un intent Constructor autentic' >&2; constructor_install_failure_line=$LINENO; exit 1; }
  current_source=$(current_source_sha256)
  if [ "$current_source" != "$install_source_sha256" ]; then resume_different_source=1; fi
else
  stage_install_transaction
fi

# Intentul root-only și candidații cu hash sunt durabili înainte de prima oprire
# ori mutație live. Boot recovery recunoaște jurnalul schema 1 și nu poate
# republica stamp-ul fără owner; retry-ul rescrie toată generația din candidați.
set_constructor_install_phase quiesce
publish_constructor_activation_pending \
  || { echo 'sentinelul controllerului manual nu poate fi publicat durabil' >&2; constructor_install_failure_line=$LINENO; exit 1; }
quiesce_before_install \
  || { echo 'unitățile Constructor nu pot fi dovedite complet quiesced' >&2; constructor_install_failure_line=$LINENO; exit 1; }
write_install_journal quiesced
# /etc/subuid și /etc/subgid nu pot fi comise printr-un singur rename. Le
# publicăm numai după intentul durabil și quiesce: un crash între fișiere lasă
# jurnalul prezent, ready retras și toate unitățile oprite până la retry.
ensure_subids kelion-codex
ensure_subids kelion-publisher
rm -f -- "${constructor_markers[@]}"
sync -f /etc/kelion
for marker in "${constructor_markers[@]}"; do
  [ ! -e "$marker" ] && [ ! -L "$marker" ] || { echo "markerul nu a putut fi retras: $marker" >&2; constructor_install_failure_line=$LINENO; exit 1; }
done

if [ "$resume_different_source" = 1 ]; then
  set_constructor_install_phase transaction-supersede
  # Sunt permise cel mult două generații supersedate, ambele autentificate și
  # păstrate până după unlink+fsync al jurnalului. A treia este refuzată.
  [ -z "$install_previous_superseded_root" ]
  [ -z "$install_superseded_source_sha256" ] \
    || [ "$current_source" != "$install_superseded_source_sha256" ]
  [ ! -e "$RUNTIME_ROOT/runtime-config-cutover.journal" ] && [ ! -L "$RUNTIME_ROOT/runtime-config-cutover.journal" ]
  [ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ]
  for marker in "${constructor_markers[@]}"; do [ ! -e "$marker" ] && [ ! -L "$marker" ]; done
  [ -f "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
    && [ ! -L "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
    && [ "$(stat -c '%u:%g:%a' "$RUNTIME_ROOT/constructor-unit-migration.pending")" = '0:0:600' ] \
    && [ "$(wc -l < "$RUNTIME_ROOT/constructor-unit-migration.pending")" -eq 1 ] \
  && grep -qx 'schema=1' "$RUNTIME_ROOT/constructor-unit-migration.pending"
  for logical in \
    artifact.codex-worker artifact.constructor-model-control artifact.constructor-model-switch \
    authorization.kelion-codex-full-access \
    configuration.opencode instructions.opencode systemd-dropin.private-ai-web-full-access \
    artifact.constructor-publisher artifact.constructor-release artifact.github-askpass \
    artifact.constructor-sync-worker artifact.constructor-service-client artifact.service-auth artifact.github-fixed-client \
    runtime-helper compose-production; do
    validate_published_candidate "$logical"
  done
  # O generație veche, deja autentificată și quiesced, poate proveni dinaintea
  # porții stricte de bytes. systemd-analyze o dovedește numai pentru a permite
  # supersedarea; noua sursă a trecut deja contractul strict înainte de intent.
  verify_candidate_units 1
  supersede_quiesced_install_transaction
  resume_different_source=0
fi

set_constructor_install_phase legacy-retirement
retire_legacy_codex_state \
  || { echo 'starea legacy Codex nu poate fi retrasă sigur' >&2; constructor_install_failure_line=$LINENO; exit 1; }
retire_legacy_model_dropin \
  || { echo 'drop-inul persistent legacy al modelului nu poate fi migrat sigur' >&2; constructor_install_failure_line=$LINENO; exit 1; }

set_constructor_install_phase artifact-publication
for logical in \
  artifact.codex-worker artifact.constructor-model-control artifact.constructor-model-switch \
  authorization.kelion-codex-full-access \
  configuration.opencode instructions.opencode systemd-dropin.private-ai-web-full-access \
  artifact.constructor-publisher artifact.constructor-release artifact.github-askpass \
  artifact.constructor-sync-worker artifact.constructor-service-client artifact.service-auth artifact.github-fixed-client \
  runtime-helper compose-production; do
  publish_install_candidate "$logical"
done

set_constructor_install_phase unit-validation
verify_candidate_units \
  || { echo 'tupla systemd Constructor candidată este invalidă' >&2; constructor_install_failure_line=$LINENO; exit 1; }

# Cele șase unități-capabilitate sunt publicate exclusiv prin tranzacția
# unit-only jurnalizată. Bariera pending rămâne după succes și poate fi
# consumată numai de cutover-ul mixt care validează noul runtime.env.
set_constructor_install_phase unit-cutover
unit_stage=$(mktemp -d "$RUNTIME_ROOT/runtime-cutover.XXXXXX")
chown root:root "$unit_stage"
chmod 0700 "$unit_stage"
install -d -o root -g root -m 0700 "$unit_stage/files"
: > "$unit_stage/manifest"
chown root:root "$unit_stage/manifest"
chmod 0600 "$unit_stage/manifest"
for unit in "${constructor_timers[@]}"; do
  install -o root -g root -m 0600 "$install_root/files/systemd-timer.$unit" "$unit_stage/files/systemd-timer.$unit"
  printf '%s\n' "systemd-timer.$unit" >> "$unit_stage/manifest"
done
for unit in "${constructor_services[@]}"; do
  install -o root -g root -m 0600 "$install_root/files/systemd-service.$unit" "$unit_stage/files/systemd-service.$unit"
  printf '%s\n' "systemd-service.$unit" >> "$unit_stage/manifest"
done
KELION_CUTOVER_LOCK_HELD=1 \
KELION_DEFER_SECRET_GATES_TO_STRICT_CUTOVER=1 \
KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$install_request_id" \
KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$install_commit" \
  "$ROOT/bin/runtime-config-cutover.sh" \
    "$unit_stage" "$ROOT/config/compose.production.yml" --leave-constructor-quiesced

set_constructor_install_phase systemd-publication
publish_install_candidate systemd-recovery.kelion-runtime-config-recovery.service
publish_install_candidate systemd-sync.kelion-constructor-sync.service
publish_install_candidate systemd-controller.kelion-constructor-model-control.service
systemctl daemon-reload
if [ "$constructor_expected_model_profile" = fast ]; then
  systemctl restart private-ai-web.service
  validate_private_ai_web_full_access \
    || { echo 'OpenCode web nu rulează cu acces complet la host' >&2; constructor_install_failure_line=$LINENO; exit 1; }
else
  systemctl stop private-ai-web.service >/dev/null 2>&1 || :
  ! systemctl is-active --quiet private-ai-web.service
fi
for unit in "${constructor_timers[@]}"; do
  stop_and_disable_constructor_timer "$unit"
done
for unit in "${constructor_services[@]}"; do
  stop_and_disable_constructor_service "$unit"
done
systemctl daemon-reload
systemctl enable kelion-runtime-config-recovery.service >/dev/null
[ -f /root/kelion/secrets/constructor-model-control-secret ] \
  && [ ! -L /root/kelion/secrets/constructor-model-control-secret ] \
  && [ "$(stat -Lc '%u:%g:%a:%h' /root/kelion/secrets/constructor-model-control-secret)" = '0:10050:440:1' ]
systemctl enable kelion-constructor-model-control.service >/dev/null
recovery_wants_dir=/etc/systemd/system/multi-user.target.wants
recovery_wants_link=$recovery_wants_dir/kelion-runtime-config-recovery.service
constructor_install_assert "$LINENO" test -d "$recovery_wants_dir"
constructor_install_assert "$LINENO" test ! -L "$recovery_wants_dir"
constructor_install_assert "$LINENO" test -L "$recovery_wants_link"
constructor_install_assert "$LINENO" test "$(readlink "$recovery_wants_link")" = /etc/systemd/system/kelion-runtime-config-recovery.service
constructor_install_assert "$LINENO" test "$(realpath -e -- "$recovery_wants_link")" = /etc/systemd/system/kelion-runtime-config-recovery.service
sync -f "$recovery_wants_dir"
sync -f /etc/systemd/system

set_constructor_install_phase published-validation
for logical in "${install_logicals[@]}"; do validate_published_candidate "$logical"; done
validate_constructor_sudoers /etc/sudoers.d/kelion-constructor-full-access
validate_opencode_constructor_config /srv/private-ai/home/.config/opencode/opencode.json
validate_private_ai_base
validate_manual_model_dropin_state
if [ "$constructor_expected_model_profile" = fast ]; then validate_private_ai_web_full_access; fi
for marker in "${constructor_markers[@]}"; do [ ! -e "$marker" ] && [ ! -L "$marker" ]; done
[ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ]
validate_constructor_activation_pending
[ -f "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
  && [ ! -L "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
  && [ "$(stat -c '%u:%g:%a' "$RUNTIME_ROOT/constructor-unit-migration.pending")" = '0:0:600' ] \
  && grep -qx 'schema=1' "$RUNTIME_ROOT/constructor-unit-migration.pending"
wait_for_published_systemd_postconditions

set_constructor_install_phase commit
if [ "$constructor_install_configure_owner" = 1 ]; then
  # Configure deține jurnalul installerului până când cutover-ul strict a
  # consumat pending-ul unit-only. Jurnalul autentic face orice crash reluabil
  # și continuă să blocheze controllerul după dispariția pending-ului.
  validate_constructor_activation_pending
  validate_model_controller_quiesced
  load_install_transaction
  [ -f "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
    && [ ! -L "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RUNTIME_ROOT/constructor-unit-migration.pending")" = '0:0:600:1' ] \
    && grep -qx 'schema=1' "$RUNTIME_ROOT/constructor-unit-migration.pending"
elif [ "$constructor_install_upgrade_owner" = 1 ]; then
  clear_install_transaction
  # Ownerul exterior păstrează controllerul oprit până după commitul și clear-ul
  # jurnalului său. Niciun ACK manual nu poate scăpa între cele două tranzacții.
  validate_constructor_activation_pending
  validate_model_controller_quiesced
else
  clear_install_transaction
  clear_constructor_activation_pending
  KELION_CUTOVER_LOCK_HELD=1 \
    "$ROOT/bin/runtime-config-cutover.sh" --recover-only "$ROOT/config/compose.production.yml" \
    || { echo 'runtime-ul și controllerul nu au revenit după commitul installerului' >&2; constructor_install_failure_line=$LINENO; exit 1; }
fi
echo 'Constructor OpenCode/Qwen instalat dezactivat; configurarea și activarea sunt etape separate.'
