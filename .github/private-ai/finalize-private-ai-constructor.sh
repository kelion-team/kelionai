#!/usr/bin/env bash
# One-shot source alignment is validated before any VPS mutation.
set -Eeuo pipefail
umask 077

readonly BUNDLE_ROOT=${1:?bundle root required}
readonly EXPECTED_GATE_COMMIT=${2:?gate commit required}
readonly EXPECTED_GATE_IMAGE=${3:?gate image required}
readonly GATE_MANIFEST_SOURCE="$BUNDLE_ROOT/.github/private-ai/codex-gates.json"
readonly WORKER_SOURCE="$BUNDLE_ROOT/deploy/codex-worker.mjs"
readonly WORKER_TARGET=/opt/kelion-codex/codex-worker.mjs
readonly WORKER_UNIT_SOURCE="$BUNDLE_ROOT/deploy/systemd/kelion-codex-worker.service"
readonly WORKER_UNIT_TARGET=/etc/systemd/system/kelion-codex-worker.service
readonly MODEL_CONTROL_SOURCE="$BUNDLE_ROOT/deploy/constructor-model-control.mjs"
readonly MODEL_CONTROL_TARGET=/opt/kelion-constructor/constructor-model-control.mjs
readonly MODEL_SWITCH_SOURCE="$BUNDLE_ROOT/deploy/constructor-model-switch.sh"
readonly MODEL_SWITCH_TARGET=/opt/private-ai/bin/constructor-model-switch
readonly SERVICE_AUTH_SOURCE="$BUNDLE_ROOT/deploy/lib/service-auth.mjs"
readonly SERVICE_AUTH_TARGET=/opt/kelion-constructor/lib/service-auth.mjs
readonly MODEL_CONTROL_UNIT_SOURCE="$BUNDLE_ROOT/deploy/systemd/kelion-constructor-model-control.service"
readonly MODEL_CONTROL_UNIT_TARGET=/etc/systemd/system/kelion-constructor-model-control.service
readonly MODEL_CONTROL_SECRET=/root/kelion/secrets/constructor-model-control-secret
readonly MODEL_CONTROL_SOCKET=/run/kelion-constructor-model-control/control.sock
readonly SYNC_WORKER_SOURCE="$BUNDLE_ROOT/deploy/constructor-sync-worker.sh"
readonly SYNC_WORKER_TARGET=/opt/kelion-constructor/constructor-sync-worker.sh
readonly SYNC_UNIT_SOURCE="$BUNDLE_ROOT/deploy/systemd/kelion-constructor-sync.service"
readonly SYNC_UNIT_TARGET=/etc/systemd/system/kelion-constructor-sync.service
readonly SUDOERS_SOURCE="$BUNDLE_ROOT/deploy/sudoers/kelion-codex-full-access"
readonly OPENCODE_CONFIG_SOURCE="$BUNDLE_ROOT/deploy/opencode-constructor.json"
readonly OPENCODE_INSTRUCTIONS_SOURCE="$BUNDLE_ROOT/deploy/opencode-constructor-instructions.md"
readonly WEB_DROPIN_SOURCE="$BUNDLE_ROOT/deploy/systemd/private-ai-web-full-access.conf"
readonly RUNTIME_CUTOVER_SOURCE="$BUNDLE_ROOT/deploy/lib/runtime-config-cutover.sh"
readonly COMPOSE_SOURCE="$BUNDLE_ROOT/deploy/compose.production.yml"
readonly PRIVATE_AI_ROOT=/srv/private-ai
readonly PRIVATE_AI_HOME=$PRIVATE_AI_ROOT/home
readonly PRIVATE_AI_CONFIG=/etc/private-ai
readonly OPENCODE_CONFIG=$PRIVATE_AI_HOME/.config/opencode/opencode.json
readonly OPENCODE_INSTRUCTIONS=$PRIVATE_AI_HOME/.config/opencode/instructions.md
readonly OPENCODE_BIN=/opt/private-ai/bin/opencode
readonly LLAMA_SERVER=/opt/private-ai/bin/llama-server
readonly LLAMA_SOURCE=/opt/private-ai/src/llama.cpp
readonly LLAMA_COMMIT_STATE=/var/lib/private-ai/llama-cpp.commit
readonly MODEL_CACHE=$PRIVATE_AI_ROOT/models
readonly LLAMA_CPP_REF=c1d0e7a004015f23bc0233470b747b596f29b264
readonly MODEL_REPO=ggml-org/Qwen3.6-35B-A3B-GGUF
readonly MODEL_REVISION=baec3ebee244827cda0f4557eafa8b28f7545fa6
readonly MODEL_QUANT=Q4_K_M
readonly MODEL_FILE=Qwen3.6-35B-A3B-Q4_K_M.gguf
readonly MODEL_FILE_BYTES=20419565568
readonly MODEL_FILE_SHA256=671e47e0ec53c665d048b98c3ecbfd5236b5ca9c3e02ed19fc8f81f7b85140c7
readonly LLAMA_SERVER_SHA256=b80a03e8c2b22e28eef05fd4e701af696a82cebe7643290dc931ca4d9d67847e
readonly OPENCODE_BIN_SHA256=d91e0d33676d0839f7cde87924cd4127ea88c9d6784eea9f009a7d08bdc60eeb
readonly LEGACY_STATIC_RUNTIME_CUTOVER_SHA256=db72ef1d9c92660adfb656330efb4e651c16d0439643c7fd944c2dd56ee1c9de
readonly LEGACY_ACTIVATION_GC_RUNTIME_CUTOVER_SHA256=ce136f70aa3c9672f14916055644b1e0eedf9a95944bb30066689dcaa68c318e
# Generația aadb559 a fost ultimul helper instalat înaintea reparației a2a5c9b;
# hashul este autentificat de istoricul canonic al aceluiași fișier.
readonly UPGRADE_RUNTIME_CUTOVER_SHA256=4730d9f189770fafd23b4dec1807e889a62bbe357fc8e8b3f153e216bf71eaad
readonly PREVIOUS_RUNTIME_CUTOVER_SHA256=bb852ba09260b628c1fa27b3f00556ea9ebbdf8047b0e9764d3729eca7cff2b7
readonly EXPECTED_RUNTIME_CUTOVER_SHA256=829687d4571805244134feb721375cdc2f3f0b19d297daf11ad40c8c40b46057
readonly RETIRED_WORKER_DROPIN=/etc/systemd/system/kelion-codex-worker.service.d/90-local-opencode-full-access.conf
readonly LEGACY_WORKER_DROPIN=/etc/systemd/system/kelion-codex-worker.service.d/90-local-qwen-full-access.conf
readonly LEGACY_CODEX_REAL=/opt/kelion-codex/bin/codex-real
readonly LEGACY_OPENCODE_WRAPPER=/opt/private-ai/bin/opencode-constructor-root
readonly LEGACY_COMPAT_KEY=/etc/private-ai/local-codex-compat-key
readonly LEGACY_SUDOERS=/etc/sudoers.d/kelion-local-qwen-constructor
readonly CANONICAL_CODEX=/opt/kelion-codex/bin/codex
readonly WEB_DROPIN_DIR=/etc/systemd/system/private-ai-web.service.d
readonly WEB_DROPIN=$WEB_DROPIN_DIR/90-kelion-constructor-full-access.conf
readonly SUDOERS=/etc/sudoers.d/kelion-constructor-full-access
readonly RUNTIME_CUTOVER_TARGET=/root/kelion/bin/runtime-config-cutover.sh
readonly FINAL_RECEIPT=$PRIVATE_AI_CONFIG/.constructor-finalized
readonly RUNTIME_ROOT=/root/kelion/runtime
readonly RUNTIME_READY_ROOT=/run/kelion
readonly RUNTIME_READY_STAMP=$RUNTIME_READY_ROOT/runtime-config-recovery.ready
readonly RUNTIME_CUTOVER_JOURNAL=$RUNTIME_ROOT/runtime-config-cutover.journal
readonly MAX_MODEL_JOURNAL=$RUNTIME_ROOT/constructor-max-model.journal
readonly REACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-reactivation.journal
readonly FINALIZER_REACTIVATION_OWNER=$RUNTIME_ROOT/private-ai-finalize-reactivation.owner
readonly PUBLICATION_LOCK=/root/kelion/publicare.lock
readonly WORKER_ENV=/root/kelion/config/codex-worker.env
readonly PUBLISHER_ENV=/root/kelion/config/constructor-publisher.env
readonly RELEASE_ENV=/root/kelion/config/constructor-release.env
fail() {
  printf 'private-ai-finalize: ERROR: %s\n' "$*" >&2
  return 1
}

require_regular() {
  local path=$1 owner_group_mode=$2
  [ -f "$path" ] && [ ! -L "$path" ] || fail "unsafe or missing file: $path"
  [ "$(stat -Lc '%U:%G:%a' "$path")" = "$owner_group_mode" ] \
    || fail "unexpected metadata: $path"
  [ "$(stat -Lc '%h' "$path")" = 1 ] || fail "unexpected hard link: $path"
}

unit_state() {
  local unit=$1
  printf '%s:%s' \
    "$(systemctl is-enabled "$unit" 2>/dev/null || true)" \
    "$(systemctl is-active "$unit" 2>/dev/null || true)"
}

restore_unit_state() {
  local unit=$1 state=$2 enabled active failed=0
  enabled=${state%%:*}
  active=${state#*:}
  case "$enabled" in
    enabled) systemctl enable "$unit" >/dev/null 2>&1 || failed=1 ;;
    enabled-runtime)
      systemctl disable "$unit" >/dev/null 2>&1 || failed=1
      systemctl enable --runtime "$unit" >/dev/null 2>&1 || failed=1
      ;;
    *) systemctl disable "$unit" >/dev/null 2>&1 || failed=1 ;;
  esac
  case "$active" in
    active|activating) systemctl start "$unit" >/dev/null 2>&1 || failed=1 ;;
    *) systemctl stop "$unit" >/dev/null 2>&1 || failed=1 ;;
  esac
  [ "$(unit_state "$unit")" = "$state" ] || failed=1
  [ "$failed" = 0 ]
}

publish_finalizer_runtime_ready_stamp() {
  local candidate
  [ -d "$RUNTIME_READY_ROOT" ] && [ ! -L "$RUNTIME_READY_ROOT" ] \
    && [ "$(stat -Lc '%U:%G:%a' "$RUNTIME_READY_ROOT")" = root:root:755 ] \
    || fail 'runtime ready root is unsafe'
  if [ -e "$RUNTIME_READY_STAMP" ] || [ -L "$RUNTIME_READY_STAMP" ]; then
    require_regular "$RUNTIME_READY_STAMP" root:root:444
    [ "$(tr -d '\n' < "$RUNTIME_READY_STAMP")" = schema=1 ] \
      || fail 'existing runtime ready stamp is invalid'
    return 0
  fi
  candidate=$(mktemp "$RUNTIME_READY_ROOT/.runtime-config-recovery.ready.XXXXXX")
  printf 'schema=1\n' > "$candidate"
  chown root:root "$candidate"
  chmod 0444 "$candidate"
  sync -f "$candidate"
  mv -f -- "$candidate" "$RUNTIME_READY_STAMP"
  sync -f "$RUNTIME_READY_ROOT"
  require_regular "$RUNTIME_READY_STAMP" root:root:444
  [ "$(tr -d '\n' < "$RUNTIME_READY_STAMP")" = schema=1 ] \
    || fail 'published runtime ready stamp is invalid'
}

[ "$(id -u)" -eq 0 ] || fail 'root is required'
[ -d "$BUNDLE_ROOT" ] && [ ! -L "$BUNDLE_ROOT" ] || fail 'invalid bundle root'
[[ "$EXPECTED_GATE_COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'gate commit is invalid'
[[ "$EXPECTED_GATE_IMAGE" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+/codex-gates@sha256:[0-9a-f]{64}$ ]] \
  || fail 'gate image is invalid'
[ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] \
  || fail 'a persistent max-model transaction blocks finalization'
validate_finalizer_reactivation_marker() {
  require_regular "$REACTIVATION_JOURNAL" root:root:600
  jq -e '
    .schema == 1 and .kind == "constructor-reactivation" and .phase == "pending" and
    (keys == ["kind","phase","schema"])
  ' "$REACTIVATION_JOURNAL" >/dev/null
}
require_regular "$GATE_MANIFEST_SOURCE" root:root:600
jq -e --arg commit "$EXPECTED_GATE_COMMIT" --arg image "$EXPECTED_GATE_IMAGE" '
  type == "object" and
  (keys == ["commit", "image", "schema", "sourceRunId"]) and
  .schema == 1 and
  .commit == $commit and
  .image == $image and
  (.sourceRunId | type == "number" and . > 0 and floor == .)
' "$GATE_MANIFEST_SOURCE" >/dev/null || fail 'gate manifest does not match the service arguments'
bundle_id=${BUNDLE_ROOT##*/}
[[ "$bundle_id" =~ ^[0-9a-f]{64}$ ]] || fail 'bundle id is invalid'
attempt_root=/var/lib/private-ai/finalizer-attempts
attempt_file=$attempt_root/$bundle_id

validate_finalizer_reactivation_owner() {
  require_regular "$FINALIZER_REACTIVATION_OWNER" root:root:600
  [ "$(<"$FINALIZER_REACTIVATION_OWNER")" = "bundle_id=$bundle_id" ]
}

validate_finalizer_reactivation_state() {
  local marker_present=0 owner_present=0
  if [ -e "$REACTIVATION_JOURNAL" ] || [ -L "$REACTIVATION_JOURNAL" ]; then
    validate_finalizer_reactivation_marker || return 1
    marker_present=1
  fi
  if [ -e "$FINALIZER_REACTIVATION_OWNER" ] || [ -L "$FINALIZER_REACTIVATION_OWNER" ]; then
    validate_finalizer_reactivation_owner || return 1
    owner_present=1
  fi
  [ "$marker_present" = 0 ] || [ "$owner_present" = 1 ]
}

publish_finalizer_reactivation_intent() {
  local candidate
  validate_finalizer_reactivation_state || return 1
  if [ -f "$REACTIVATION_JOURNAL" ]; then return 0; fi
  candidate=$(mktemp "$RUNTIME_ROOT/.private-ai-finalize-reactivation.owner.XXXXXX") || return 1
  if printf 'bundle_id=%s\n' "$bundle_id" > "$candidate" \
    && chown root:root "$candidate" && chmod 0600 "$candidate" \
    && sync -f "$candidate" \
    && mv -f -- "$candidate" "$FINALIZER_REACTIVATION_OWNER" \
    && sync -f "$RUNTIME_ROOT"; then
    :
  else
    rm -f -- "$candidate"
    return 1
  fi
  candidate=$(mktemp "$RUNTIME_ROOT/.constructor-reactivation.journal.XXXXXX") || return 1
  if jq -nc '{schema:1,kind:"constructor-reactivation",phase:"pending"}' > "$candidate" \
    && chown root:root "$candidate" && chmod 0600 "$candidate" \
    && sync -f "$candidate" \
    && mv -f -- "$candidate" "$REACTIVATION_JOURNAL" \
    && sync -f "$RUNTIME_ROOT" \
    && validate_finalizer_reactivation_state; then
    return 0
  fi
  rm -f -- "$candidate"
  return 1
}

clear_finalizer_reactivation_intent() {
  validate_finalizer_reactivation_state || return 1
  rm -f -- "$REACTIVATION_JOURNAL" || return 1
  sync -f "$RUNTIME_ROOT" || return 1
  rm -f -- "$FINALIZER_REACTIVATION_OWNER" || return 1
  sync -f "$RUNTIME_ROOT"
}

validate_finalizer_reactivation_state \
  || fail 'an interrupted Constructor reactivation is not owned by this exact finalizer bundle'
[ -f "$WORKER_SOURCE" ] && [ ! -L "$WORKER_SOURCE" ] || fail 'worker source missing'
[ -f "$WORKER_UNIT_SOURCE" ] && [ ! -L "$WORKER_UNIT_SOURCE" ] || fail 'worker unit source missing'
[ -f "$MODEL_CONTROL_SOURCE" ] && [ ! -L "$MODEL_CONTROL_SOURCE" ] || fail 'model controller source missing'
[ -f "$MODEL_SWITCH_SOURCE" ] && [ ! -L "$MODEL_SWITCH_SOURCE" ] || fail 'model switch source missing'
[ -f "$SERVICE_AUTH_SOURCE" ] && [ ! -L "$SERVICE_AUTH_SOURCE" ] || fail 'service auth source missing'
[ -f "$MODEL_CONTROL_UNIT_SOURCE" ] && [ ! -L "$MODEL_CONTROL_UNIT_SOURCE" ] \
  || fail 'model controller unit source missing'
[ -f "$SYNC_WORKER_SOURCE" ] && [ ! -L "$SYNC_WORKER_SOURCE" ] || fail 'sync worker source missing'
[ -f "$SYNC_UNIT_SOURCE" ] && [ ! -L "$SYNC_UNIT_SOURCE" ] || fail 'sync unit source missing'
[ -f "$SUDOERS_SOURCE" ] && [ ! -L "$SUDOERS_SOURCE" ] || fail 'worker sudoers source missing'
[ -f "$OPENCODE_CONFIG_SOURCE" ] && [ ! -L "$OPENCODE_CONFIG_SOURCE" ] \
  || fail 'canonical OpenCode config source missing'
[ -f "$OPENCODE_INSTRUCTIONS_SOURCE" ] && [ ! -L "$OPENCODE_INSTRUCTIONS_SOURCE" ] \
  || fail 'canonical OpenCode instructions source missing'
[ -f "$WEB_DROPIN_SOURCE" ] && [ ! -L "$WEB_DROPIN_SOURCE" ] \
  || fail 'canonical OpenCode web full-access drop-in source missing'
[ -f "$RUNTIME_CUTOVER_SOURCE" ] && [ ! -L "$RUNTIME_CUTOVER_SOURCE" ] \
  || fail 'canonical runtime cutover helper source missing'
[ -f "$COMPOSE_SOURCE" ] && [ ! -L "$COMPOSE_SOURCE" ] \
  || fail 'canonical production compose source missing'
node --check "$WORKER_SOURCE"
node --check "$MODEL_CONTROL_SOURCE"
bash -n "$SYNC_WORKER_SOURCE"
bash -n "$MODEL_SWITCH_SOURCE"
bash -n "$RUNTIME_CUTOVER_SOURCE"
! grep -Fq -- '! -w "$askpass"' "$SYNC_WORKER_SOURCE" \
  || fail 'sync worker uses the root-incorrect writable predicate'
grep -Fq "stat -Lc '%u:%g:%a:%h'" "$SYNC_WORKER_SOURCE" \
  || fail 'sync worker does not validate exact askpass metadata'
grep -Fq "'0:0:555:1'" "$SYNC_WORKER_SOURCE" \
  || fail 'sync worker askpass metadata contract is missing'
! grep -Eq '(^|[^[:alnum:]_])runuser([^[:alnum:]_]|$)' "$SYNC_WORKER_SOURCE" \
  || fail 'sync worker must not change identity at runtime'
grep -Fqx 'User=kelion-codex' "$SYNC_UNIT_SOURCE"
grep -Fqx 'Group=kelion-codex' "$SYNC_UNIT_SOURCE"
grep -Fqx 'NoNewPrivileges=true' "$SYNC_UNIT_SOURCE"
grep -Fqx 'RestrictSUIDSGID=true' "$SYNC_UNIT_SOURCE"
grep -Fqx 'CapabilityBoundingSet=' "$SYNC_UNIT_SOURCE"
grep -Fqx 'AmbientCapabilities=' "$SYNC_UNIT_SOURCE"
grep -q 'OPENCODE_BIN' "$WORKER_SOURCE" || fail 'worker has no direct OpenCode executor'
! grep -q 'KELION_LOCAL_QWEN_WRAPPER' "$WORKER_SOURCE" || fail 'fake Codex wrapper found in worker source'
grep -qx 'kelion-codex ALL=(ALL:ALL) NOPASSWD: ALL' "$SUDOERS_SOURCE"
[ "$(wc -l < "$SUDOERS_SOURCE")" -eq 1 ] || fail 'sudoers source is not exact'
grep -Fqx 'ExecStart=/usr/bin/flock --exclusive --wait 9000 /run/lock/private-ai-model-switch.lock /usr/bin/node /opt/kelion-codex/codex-worker.mjs --once' "$WORKER_UNIT_SOURCE"
grep -Fqx 'LoadCredential=codex-worker-secret:/root/kelion/secrets/codex-worker-secret' "$WORKER_UNIT_SOURCE"
! grep -Eq 'CODEX_BIN=|CODEX_HOME=|openai-project-key|codex-real|opencode-constructor-root' \
  "$WORKER_UNIT_SOURCE" || fail 'worker unit source still references the retired Codex adapter'
jq -e '
  . as $config |
  $config.autoupdate == false and $config.share == "disabled" and
  $config.enabled_providers == ["llama.cpp"] and
  ($config.provider | keys) == ["llama.cpp"] and
  $config.model == "llama.cpp/qwen3.6-35b-a3b-local" and
  ($config.small_model // $config.model) == "llama.cpp/qwen3.6-35b-a3b-local" and
  $config.provider["llama.cpp"].npm == "@ai-sdk/openai-compatible" and
  $config.provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1" and
  ($config.provider["llama.cpp"].options | has("apiKey") | not) and
  (["*", "read", "glob", "grep", "edit", "bash", "task", "skill",
    "webfetch", "websearch", "external_directory"]
   | all(.[]; $config.permission[.] == "allow"))
' "$OPENCODE_CONFIG_SOURCE" >/dev/null
[ -s "$OPENCODE_INSTRUCTIONS_SOURCE" ]
! grep -Eiq 'OPENAI_API_KEY|ANTHROPIC_API_KEY|login --with-api-key|paid provider' \
  "$OPENCODE_CONFIG_SOURCE" "$OPENCODE_INSTRUCTIONS_SOURCE" \
  || fail 'canonical OpenCode sources reference an external paid executor'

require_regular "$PRIVATE_AI_CONFIG/.install-complete" root:root:600
mapfile -t base_receipt < "$PRIVATE_AI_CONFIG/.install-complete"
[ "${#base_receipt[@]}" -eq 6 ] || fail 'base receipt has an unexpected schema'
[ "${base_receipt[0]}" = 'installer_id=private-ai-contabo-v1' ]
[[ "${base_receipt[1]}" =~ ^completed_at=([0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z)$ ]]
completed_at=${BASH_REMATCH[1]}
[ "$(date -u -d "$completed_at" +%FT%TZ)" = "$completed_at" ]
[ "$(date -u -d "$completed_at" +%s)" -le "$(( $(date -u +%s) + 60 ))" ]
[ "${base_receipt[2]}" = 'llama_cpp_ref=c1d0e7a004015f23bc0233470b747b596f29b264' ]
[ "${base_receipt[3]}" = 'opencode_version=1.18.25' ]
[ "${base_receipt[4]}" = 'model_repo=ggml-org/Qwen3.6-35B-A3B-GGUF' ]
[ "${base_receipt[5]}" = 'model_quant=Q4_K_M' ]
require_regular /var/lib/private-ai/model.ready privateai:privateai:600
require_regular "$OPENCODE_BIN" root:root:755
require_regular "$LLAMA_SERVER" root:root:755
require_regular "$LLAMA_COMMIT_STATE" privateai:privateai:600
require_regular "$OPENCODE_CONFIG" root:privateai:640
require_regular "$PRIVATE_AI_CONFIG/opencode.env" root:privateai:640
[ "$(tr -d '\n' < "$LLAMA_COMMIT_STATE")" = "$LLAMA_CPP_REF" ] \
  || fail 'llama.cpp state does not match the pinned revision'
[ -d "$LLAMA_SOURCE/.git" ] && [ ! -L "$LLAMA_SOURCE" ] \
  || fail 'pinned llama.cpp source checkout is missing'
[ "$(runuser -u privateai -- env -i HOME="$PRIVATE_AI_HOME" PATH=/usr/bin:/bin \
  git -C "$LLAMA_SOURCE" rev-parse HEAD)" = "$LLAMA_CPP_REF" ] \
  || fail 'llama.cpp checkout does not match the pinned revision'
mapfile -d '' -t model_candidates < <(
  find "$MODEL_CACHE" -xdev -type f -size "${MODEL_FILE_BYTES}c" -print0
)
[ "${#model_candidates[@]}" -eq 1 ] \
  || fail 'the pinned Qwen GGUF was not found exactly once in the offline cache'
model_file_path=${model_candidates[0]}
[ -f "$model_file_path" ] && [ ! -L "$model_file_path" ] \
  || fail 'the pinned Qwen GGUF cache object is unsafe'
[ "$(stat -Lc '%U:%G:%s:%h' "$model_file_path")" = \
  "privateai:privateai:${MODEL_FILE_BYTES}:1" ] \
  || fail 'the pinned Qwen GGUF metadata is invalid'
model_file_sha=$(sha256sum "$model_file_path" | awk '{print $1}')
[ "$model_file_sha" = "$MODEL_FILE_SHA256" ] \
  || fail 'the cached Qwen GGUF hash does not match the pinned artifact'
llama_server_sha=$(sha256sum "$LLAMA_SERVER" | awk '{print $1}')
opencode_bin_sha=$(sha256sum "$OPENCODE_BIN" | awk '{print $1}')
[ "$llama_server_sha" = "$LLAMA_SERVER_SHA256" ] \
  || fail 'llama-server binary does not match the pinned installed build'
[ "$opencode_bin_sha" = "$OPENCODE_BIN_SHA256" ] \
  || fail 'OpenCode binary does not match the pinned official release payload'
systemctl is-active --quiet private-ai-llm.service
systemctl cat private-ai-web.service >/dev/null
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:24080/health >/dev/null
[ "$($OPENCODE_BIN --version)" = 1.18.25 ] || fail 'unexpected OpenCode version'
jq -e '
  .model == "llama.cpp/qwen3.6-35b-a3b-local" and
  .provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1" and
  .provider["llama.cpp"].models["qwen3.6-35b-a3b-local"].name != null
' "$OPENCODE_CONFIG" >/dev/null
printf 'PRIVATE_AI_BASE_VERIFIED=yes\n'

[ -d "$RUNTIME_ROOT" ] && [ ! -L "$RUNTIME_ROOT" ] \
  && [ "$(realpath -e -- "$RUNTIME_ROOT")" = "$RUNTIME_ROOT" ] \
  || fail 'Kelion runtime root is missing or unsafe'
if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
  [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
    || fail 'unsafe publication lock'
fi
exec 9<>"$PUBLICATION_LOCK"
chown root:root /proc/$$/fd/9
chmod 0600 /proc/$$/fd/9
flock -n 9 || fail 'constructor/release publication is active'
[ ! -e "$MAX_MODEL_JOURNAL" ] && [ ! -L "$MAX_MODEL_JOURNAL" ] \
  || fail 'a persistent max-model transaction blocks finalization under publication lock'
validate_finalizer_reactivation_state \
  || fail 'an interrupted Constructor reactivation changed under publication lock'
publish_finalizer_reactivation_intent \
  || fail 'the finalizer reactivation intent could not be published durably'

# Numai o încercare care deține lock-ul global poate consuma bugetul durabil.
# Contenția cu un deploy/publicator activ nu poate epuiza retry-urile.
install -d -o root -g root -m 0700 "$attempt_root"
[ -d "$attempt_root" ] && [ ! -L "$attempt_root" ]
attempt_count=0
if [ -e "$attempt_file" ] || [ -L "$attempt_file" ]; then
  require_regular "$attempt_file" root:root:600
  attempt_count=$(<"$attempt_file")
  [[ "$attempt_count" =~ ^[0-9]+$ ]] || fail 'persistent attempt counter is invalid'
fi
if [ "$attempt_count" -ge 3 ]; then
  systemctl disable private-ai-constructor-finalize.service >/dev/null 2>&1 || true
  printf 'private-ai-finalize: ERROR: hard retry limit reached for bundle %s\n' "$bundle_id" >&2
  exit 75
fi
attempt_candidate=$(mktemp "$attempt_root/.attempt.XXXXXX")
printf '%s\n' "$((attempt_count + 1))" > "$attempt_candidate"
chown root:root "$attempt_candidate"
chmod 0600 "$attempt_candidate"
sync -f "$attempt_candidate"
mv -f -- "$attempt_candidate" "$attempt_file"
sync -f "$attempt_root"

case "$(unit_state kelion-runtime-config-recovery.service)" in
  enabled:failed)
    systemctl reset-failed kelion-runtime-config-recovery.service
    [ "$(unit_state kelion-runtime-config-recovery.service)" = enabled:inactive ] \
      || fail 'runtime recovery service did not leave the failed state'
    ;;
  enabled:active|enabled:inactive) ;;
  *) fail 'runtime recovery service is not enabled in an allowed state' ;;
esac
WORKER_TIMER_STATE=$(unit_state kelion-codex-worker.timer)
WEB_STATE=$(unit_state private-ai-web.service)
PUBLISHER_TIMER_STATE=$(unit_state kelion-constructor-publisher.timer)
RELEASE_TIMER_STATE=$(unit_state kelion-constructor-release.timer)
RECOVERY_SERVICE_STATE=$(unit_state kelion-runtime-config-recovery.service)
MODEL_CONTROL_PRESENT=0
MODEL_CONTROL_STATE=''
if systemctl cat kelion-constructor-model-control.service >/dev/null 2>&1; then
  MODEL_CONTROL_PRESENT=1
  MODEL_CONTROL_STATE=$(unit_state kelion-constructor-model-control.service)
fi
rollback_root=$(mktemp -d "$RUNTIME_ROOT/private-ai-finalize.XXXXXX")
chmod 0700 "$rollback_root"
rollback_armed=0
readonly FINALIZER_MAIN_BASHPID=$BASHPID
rollback_running=0
worker_cutover_started=0
web_cutover_started=0
canonical_codex_fake=0
worker_candidate=''
unit_candidate=''
sync_worker_candidate=''
sync_unit_candidate=''
model_control_candidate=''
model_switch_candidate=''
service_auth_candidate=''
model_control_unit_candidate=''
model_control_secret_candidate=''
sudoers_candidate=''
canonical_codex_candidate=''
config_candidate=''
web_dropin_candidate=''
instructions_candidate=''
auth_config=''
receipt_candidate=''
gate_cutover_stage=''
runtime_helper_candidate=''
committed_gate_repair_root=''
preserve_committed_gate_env=0
preserve_runtime_helper=0

snapshot_file() {
  local key=$1 target=$2
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || fail "unsafe rollback target: $target"
    cp --preserve=all -- "$target" "$rollback_root/$key"
  else
    : > "$rollback_root/$key.absent"
  fi
}

restore_file() {
  local key=$1 target=$2 candidate='' parent
  parent=$(dirname -- "$target")
  if [ -f "$rollback_root/$key.absent" ]; then
    if [ -e "$target" ] || [ -L "$target" ]; then
      [ -d "$parent" ] && [ ! -L "$parent" ] || return 1
      rm -f -- "$target" && sync -f "$parent"
    else
      # Un părinte absent implică deja starea snapshotului; nu există o
      # mutație de persistat și sync -f pe calea inexistentă ar fi un fals eșec.
      [ ! -L "$parent" ] && { [ ! -e "$parent" ] || [ -d "$parent" ]; }
    fi
  else
    [ -d "$parent" ] && [ ! -L "$parent" ] || return 1
    candidate=$(mktemp "$target.rollback.XXXXXX") || return 1
    if install --preserve-timestamps -- "$rollback_root/$key" "$candidate" \
      && chown --reference="$rollback_root/$key" "$candidate" \
      && chmod --reference="$rollback_root/$key" "$candidate" \
      && sync -f "$candidate" \
      && mv -f -- "$candidate" "$target" \
      && sync -f "$target" \
      && sync -f "$parent"; then
      return 0
    fi
    rm -f -- "$candidate"
    return 1
  fi
}

refresh_snapshot_file() {
  local key=$1 target=$2
  rm -f -- "$rollback_root/$key" "$rollback_root/$key.absent"
  snapshot_file "$key" "$target"
  sync -f "$rollback_root"
}

snapshot_legacy_path() {
  local key=$1 target=$2
  if [ -e "$target" ] || [ -L "$target" ]; then
    if [ ! -L "$target" ]; then
      [ -f "$target" ] || fail "unexpected legacy artifact type: $target"
    fi
    cp -a --no-dereference -- "$target" "$rollback_root/$key"
  else
    : > "$rollback_root/$key.absent"
  fi
}

legacy_restore_failure() {
  local key=$1 phase=$2 source=$3 target=$4 parent=$5
  printf 'PRIVATE_AI_RESTORE_LEGACY_FAILED key=%s phase=%s source=%s target=%s parent=%s\n' \
    "$key" "$phase" \
    "$(stat -c '%F:%u:%g:%a:%h' -- "$source" 2>/dev/null || printf absent)" \
    "$(stat -c '%F:%u:%g:%a:%h' -- "$target" 2>/dev/null || printf absent)" \
    "$(stat -Lc '%F:%u:%g:%a:%h' -- "$parent" 2>/dev/null || printf absent)" >&2
  return 1
}

restore_legacy_path() {
  local key=$1 target=$2 parent base candidate='' source link_target=''
  parent=$(dirname -- "$target")
  source=$rollback_root/$key
  if [ -f "$rollback_root/$key.absent" ]; then
    if [ -e "$target" ] || [ -L "$target" ]; then
      [ -d "$parent" ] && [ ! -L "$parent" ] || {
        legacy_restore_failure "$key" absent-parent "$source" "$target" "$parent"
        return 1
      }
      rm -f -- "$target" || {
        legacy_restore_failure "$key" absent-remove "$source" "$target" "$parent"
        return 1
      }
      sync -f "$parent" || {
        legacy_restore_failure "$key" absent-sync "$source" "$target" "$parent"
        return 1
      }
    else
      [ ! -L "$parent" ] && { [ ! -e "$parent" ] || [ -d "$parent" ]; } || {
        legacy_restore_failure "$key" absent-parent-state "$source" "$target" "$parent"
        return 1
      }
    fi
    return 0
  fi

  [ -d "$parent" ] && [ ! -L "$parent" ] || {
    legacy_restore_failure "$key" parent "$source" "$target" "$parent"
    return 1
  }
  base=${target##*/}
  candidate=$(mktemp "$parent/.$base.rollback.XXXXXX") || {
    legacy_restore_failure "$key" mktemp "$source" "$target" "$parent"
    return 1
  }
  if [ -L "$source" ]; then
    link_target=$(readlink -- "$source") || {
      rm -f -- "$candidate"
      legacy_restore_failure "$key" readlink "$source" "$target" "$parent"
      return 1
    }
    rm -f -- "$candidate" || {
      legacy_restore_failure "$key" symlink-unlink-candidate "$source" "$target" "$parent"
      return 1
    }
    ln -s -- "$link_target" "$candidate" || {
      rm -f -- "$candidate"
      legacy_restore_failure "$key" symlink-create "$source" "$target" "$parent"
      return 1
    }
  elif [ -f "$source" ]; then
    cp -a --no-dereference -T -- "$source" "$candidate" || {
      rm -f -- "$candidate"
      legacy_restore_failure "$key" copy "$source" "$target" "$parent"
      return 1
    }
    sync -f "$candidate" || {
      rm -f -- "$candidate"
      legacy_restore_failure "$key" candidate-sync "$source" "$target" "$parent"
      return 1
    }
  else
    rm -f -- "$candidate"
    legacy_restore_failure "$key" snapshot-type "$source" "$target" "$parent"
    return 1
  fi
  mv -fT -- "$candidate" "$target" || {
    rm -f -- "$candidate"
    legacy_restore_failure "$key" rename "$source" "$target" "$parent"
    return 1
  }
  sync -f "$parent" || {
    legacy_restore_failure "$key" parent-sync "$source" "$target" "$parent"
    return 1
  }
  return 0
}

rollback() {
  local status=$? rollback_failed=0
  if [ "$#" -gt 0 ]; then status=$1; fi
  if [ "$BASHPID" != "$FINALIZER_MAIN_BASHPID" ]; then return "$status"; fi
  if [ "$status" -eq 0 ]; then return 0; fi
  if [ "$rollback_running" -eq 1 ]; then builtin exit "$status"; fi
  rollback_running=1
  trap - ERR HUP INT TERM EXIT
  printf 'PRIVATE_AI_ROLLBACK_SNAPSHOT worker_timer=%s web=%s publisher_timer=%s release_timer=%s recovery=%s\n' \
    "$WORKER_TIMER_STATE" "$WEB_STATE" "$PUBLISHER_TIMER_STATE" \
    "$RELEASE_TIMER_STATE" "$RECOVERY_SERVICE_STATE" >&2
  for temporary in \
    "$worker_candidate" "$unit_candidate" "$sync_worker_candidate" "$sync_unit_candidate" "$sudoers_candidate" \
    "$model_control_candidate" "$model_switch_candidate" "$service_auth_candidate" \
    "$model_control_unit_candidate" "$model_control_secret_candidate" \
    "$canonical_codex_candidate" "$config_candidate" "$auth_config" \
    "$web_dropin_candidate" "$instructions_candidate" \
    "$receipt_candidate" "$runtime_helper_candidate"; do
    [ -z "$temporary" ] || rm -f -- "$temporary" >/dev/null 2>&1 || true
  done
  case "$gate_cutover_stage" in
    /root/kelion/runtime/runtime-cutover.[A-Za-z0-9]*)
      if [ -d "$gate_cutover_stage" ] && [ ! -L "$gate_cutover_stage" ]; then
        rm -rf --one-file-system -- "$gate_cutover_stage" >/dev/null 2>&1 || true
      fi
      ;;
  esac
  case "$committed_gate_repair_root" in
    /root/kelion/runtime/private-ai-committed-gate-repair.[A-Za-z0-9]*)
      if [ -d "$committed_gate_repair_root" ] && [ ! -L "$committed_gate_repair_root" ]; then
        rm -rf --one-file-system -- "$committed_gate_repair_root" >/dev/null 2>&1 || true
      fi
      ;;
  esac
  if [ "$rollback_armed" -eq 1 ]; then
    publish_finalizer_reactivation_intent \
      || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    systemctl stop \
      kelion-codex-worker.timer \
      kelion-constructor-publisher.timer \
      kelion-constructor-release.timer \
      kelion-codex-worker.service \
      kelion-constructor-sync.service \
      kelion-constructor-publisher.service \
      kelion-constructor-release.service >/dev/null 2>&1 || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    systemctl stop kelion-constructor-model-control.service >/dev/null 2>&1 || :
    if [ "$web_cutover_started" -eq 1 ]; then
      systemctl stop private-ai-web.service >/dev/null 2>&1 || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    fi
    restore_file worker "$WORKER_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file worker_unit "$WORKER_UNIT_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file sync_worker "$SYNC_WORKER_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file sync_unit "$SYNC_UNIT_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file model_control "$MODEL_CONTROL_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file model_switch "$MODEL_SWITCH_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file service_auth "$SERVICE_AUTH_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file model_control_unit "$MODEL_CONTROL_UNIT_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file model_control_secret "$MODEL_CONTROL_SECRET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file config "$OPENCODE_CONFIG" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file instructions "$OPENCODE_INSTRUCTIONS" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file retired_worker_dropin "$RETIRED_WORKER_DROPIN" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file legacy_worker_dropin "$LEGACY_WORKER_DROPIN" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file web_dropin "$WEB_DROPIN" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file sudoers "$SUDOERS" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_file receipt "$FINAL_RECEIPT" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    if [ "$preserve_runtime_helper" -eq 0 ]; then
      restore_file runtime_cutover_helper "$RUNTIME_CUTOVER_TARGET" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    fi
    if [ "$preserve_committed_gate_env" -eq 1 ]; then
      # După ce toate cele trei fișiere au fost reparate ca generație committed,
      # revenirea la snapshotul vechi ar recrea exact incidentul ownerless.  Cu
      # jurnalul încă prezent recovery-ul va continua roll-forward; cu jurnalul
      # consumat bytes-urile live sunt deja generația durabilă.
      rm -f -- "$RUNTIME_READY_STAMP" >/dev/null 2>&1 || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
      sync -f "$RUNTIME_READY_ROOT" >/dev/null 2>&1 || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    else
      restore_file runtime_ready_stamp "$RUNTIME_READY_STAMP" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
      restore_file worker_env "$WORKER_ENV" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
      restore_file publisher_env "$PUBLISHER_ENV" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
      restore_file release_env "$RELEASE_ENV" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    fi
    restore_legacy_path legacy_codex_real "$LEGACY_CODEX_REAL" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_legacy_path legacy_opencode_wrapper "$LEGACY_OPENCODE_WRAPPER" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_legacy_path legacy_compat_key "$LEGACY_COMPAT_KEY" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_legacy_path legacy_sudoers "$LEGACY_SUDOERS" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    if [ "$canonical_codex_fake" -eq 1 ]; then
      restore_legacy_path canonical_codex "$CANONICAL_CODEX" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    fi
    systemctl daemon-reload >/dev/null 2>&1 || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    if [ "$MODEL_CONTROL_PRESENT" = 1 ]; then
      restore_unit_state kelion-constructor-model-control.service "$MODEL_CONTROL_STATE" \
        || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    elif systemctl cat kelion-constructor-model-control.service >/dev/null 2>&1; then
      rollback_failed=1
      printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2
    fi
    restore_unit_state private-ai-web.service "$WEB_STATE" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_unit_state kelion-codex-worker.timer "$WORKER_TIMER_STATE" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_unit_state kelion-constructor-publisher.timer "$PUBLISHER_TIMER_STATE" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_unit_state kelion-constructor-release.timer "$RELEASE_TIMER_STATE" || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
    restore_unit_state kelion-runtime-config-recovery.service "$RECOVERY_SERVICE_STATE" \
      || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
  fi
  if [ "$rollback_failed" = 0 ]; then
    clear_finalizer_reactivation_intent \
      || { rollback_failed=1; printf 'PRIVATE_AI_ROLLBACK_STEP_FAILED=line-%s\n' "$LINENO" >&2; }
  fi
  if [ "$rollback_failed" = 0 ]; then
    printf 'PRIVATE_AI_FINALIZE_ROLLED_BACK=yes EXIT=%s\n' "$status" >&2
  else
    rm -f -- "$RUNTIME_READY_STAMP" >/dev/null 2>&1 || true
    systemctl disable --now \
      kelion-codex-worker.timer \
      kelion-constructor-publisher.timer \
      kelion-constructor-release.timer >/dev/null 2>&1 || true
    printf 'PRIVATE_AI_FINALIZE_ROLLBACK_INCOMPLETE=yes EXIT=%s\n' "$status" >&2
  fi
  exit "$status"
}
trap rollback ERR EXIT
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM

snapshot_file worker "$WORKER_TARGET"
snapshot_file worker_unit "$WORKER_UNIT_TARGET"
snapshot_file sync_worker "$SYNC_WORKER_TARGET"
snapshot_file sync_unit "$SYNC_UNIT_TARGET"
snapshot_file model_control "$MODEL_CONTROL_TARGET"
snapshot_file model_switch "$MODEL_SWITCH_TARGET"
snapshot_file service_auth "$SERVICE_AUTH_TARGET"
snapshot_file model_control_unit "$MODEL_CONTROL_UNIT_TARGET"
snapshot_file model_control_secret "$MODEL_CONTROL_SECRET"
snapshot_file config "$OPENCODE_CONFIG"
snapshot_file instructions "$OPENCODE_INSTRUCTIONS"
snapshot_file retired_worker_dropin "$RETIRED_WORKER_DROPIN"
snapshot_file legacy_worker_dropin "$LEGACY_WORKER_DROPIN"
snapshot_file web_dropin "$WEB_DROPIN"
snapshot_file sudoers "$SUDOERS"
snapshot_file receipt "$FINAL_RECEIPT"
snapshot_file runtime_cutover_helper "$RUNTIME_CUTOVER_TARGET"
snapshot_file runtime_ready_stamp "$RUNTIME_READY_STAMP"
snapshot_file worker_env "$WORKER_ENV"
snapshot_file publisher_env "$PUBLISHER_ENV"
snapshot_file release_env "$RELEASE_ENV"
snapshot_legacy_path legacy_codex_real "$LEGACY_CODEX_REAL"
snapshot_legacy_path legacy_opencode_wrapper "$LEGACY_OPENCODE_WRAPPER"
snapshot_legacy_path legacy_compat_key "$LEGACY_COMPAT_KEY"
snapshot_legacy_path legacy_sudoers "$LEGACY_SUDOERS"
if [ -e "$CANONICAL_CODEX" ] || [ -L "$CANONICAL_CODEX" ]; then
  if [ -L "$CANONICAL_CODEX" ]; then
    canonical_codex_target=$(readlink -f -- "$CANONICAL_CODEX" || true)
    case "$canonical_codex_target" in
      "$LEGACY_CODEX_REAL"|"$LEGACY_OPENCODE_WRAPPER") canonical_codex_fake=1 ;;
    esac
  elif [ -f "$CANONICAL_CODEX" ]; then
    if grep -aEq 'KELION_LOCAL_QWEN_WRAPPER|local-qwen-compat|opencode-constructor-root' \
      "$CANONICAL_CODEX"; then
      canonical_codex_fake=1
    fi
  else
    fail "unexpected canonical Codex artifact type: $CANONICAL_CODEX"
  fi
fi
if [ "$canonical_codex_fake" -eq 1 ]; then
  snapshot_legacy_path canonical_codex "$CANONICAL_CODEX"
  require_regular "$LEGACY_CODEX_REAL" root:root:555
  [ -x "$LEGACY_CODEX_REAL" ] || fail 'retired canonical Codex backup is not executable'
  ! grep -aEq 'KELION_LOCAL_QWEN_WRAPPER|local-qwen-compat|opencode-constructor-root' \
    "$LEGACY_CODEX_REAL" || fail 'retired canonical Codex backup is itself a wrapper'
fi
sync -f "$rollback_root"
rollback_armed=1

# Un retry după HUP/reboot poate găsi web-ul oprit exact între quiesce și
# restart. Îl pornim numai după publication lock, intentul persistent și
# snapshotul rollback, niciodată în preflightul read-only.
if ! systemctl is-active --quiet private-ai-web.service; then
  systemctl start private-ai-web.service
fi
systemctl is-active --quiet private-ai-web.service

quiesce_gate_consumers() {
  local gate_unit gate_state mode=${1:-require-idle}
  systemctl stop \
    kelion-codex-worker.timer \
    kelion-constructor-publisher.timer \
    kelion-constructor-release.timer
  if [ "$mode" = require-idle ]; then
    for gate_unit in \
      kelion-codex-worker.service \
      kelion-constructor-publisher.service \
      kelion-constructor-release.service; do
      gate_state=$(systemctl is-active "$gate_unit" 2>/dev/null || true)
      case "$gate_state" in
        inactive|failed) ;;
        *) fail "gate consumer is not quiescent: $gate_unit ($gate_state)" ;;
      esac
    done
  elif [ "$mode" != force ]; then
    fail "invalid gate quiesce mode: $mode"
  fi
  systemctl stop \
    kelion-codex-worker.service \
    kelion-constructor-publisher.service \
    kelion-constructor-release.service
  for gate_unit in \
    kelion-codex-worker.service \
    kelion-constructor-publisher.service \
    kelion-constructor-release.service; do
    gate_state=$(systemctl show --property=ActiveState --value "$gate_unit")
    case "$gate_state" in
      inactive|failed) ;;
      *) fail "gate consumer did not quiesce: $gate_unit" ;;
    esac
    [ "$(systemctl show --property=MainPID --value "$gate_unit")" = 0 ] \
      || fail "gate consumer still has a main process: $gate_unit"
    [ "$(systemctl show --property=ControlPID --value "$gate_unit")" = 0 ] \
      || fail "gate consumer still has a control process: $gate_unit"
    if systemctl list-jobs --no-legend --no-pager \
      | awk -v unit="$gate_unit" '$2 == unit { found=1 } END { exit(found ? 0 : 1) }'; then
      fail "gate consumer still has a systemd job: $gate_unit"
    fi
  done
}

# Freeze every consumer before touching either canonical Git repository or its
# rootless Podman runtime. Timers stay stopped until the cutover and probes end.
# Recovery remains enabled because it is part of the strict live contract; the
# publication lock serializes it, iar starea inactive împiedică execuția aici.
case "$RECOVERY_SERVICE_STATE" in
  enabled:active|enabled:inactive) ;;
  enabled:failed)
    # Un eșec anterior lasă corect recovery-ul enabled:failed. Normalizăm numai
    # latch-ul systemd; helperul pin-uit recuperează jurnalul durabil real.
    systemctl reset-failed kelion-runtime-config-recovery.service
    RECOVERY_SERVICE_STATE=enabled:inactive
    ;;
  *) fail "runtime recovery service is not canonical before finalization: $RECOVERY_SERVICE_STATE" ;;
esac
case "$(unit_state kelion-runtime-config-recovery.service)" in
  enabled:active|enabled:inactive) ;;
  *) fail 'runtime recovery service is not enabled before finalization' ;;
esac
[ "$(systemctl show --property=MainPID --value kelion-runtime-config-recovery.service)" = 0 ]
[ "$(systemctl show --property=ControlPID --value kelion-runtime-config-recovery.service)" = 0 ]
quiesce_gate_consumers

require_regular "$WORKER_ENV" root:root:640
require_regular "$PUBLISHER_ENV" root:root:640
require_regular "$RELEASE_ENV" root:root:640

refresh_public_master() {
  local user=$1 home=$2 repo=$3 origin dangerous
  [ -d "$repo/.git" ] && [ ! -L "$repo" ] \
    || fail "canonical repository is missing for $user"
  origin=$(runuser -u "$user" -- env -i HOME="$home" PATH=/usr/bin:/bin \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    git -C "$repo" remote get-url origin)
  [ "$origin" = https://github.com/kelion-team/kelionai.git ] \
    || fail "canonical repository origin is invalid for $user"
  dangerous=$(runuser -u "$user" -- env -i HOME="$home" PATH=/usr/bin:/bin \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
    git -C "$repo" config --local --get-regexp \
      '^(credential\.|http\..*\.extraheader|filter\.|core\.hooksPath|core\.fsmonitor|include\.|includeIf\.)' \
    || true)
  [ -z "$dangerous" ] || fail "unsafe Git configuration for $user"
  runuser -u "$user" -- env -i HOME="$home" PATH=/usr/bin:/bin \
    GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0 \
    git -C "$repo" fetch --no-tags --prune origin \
      +refs/heads/master:refs/remotes/origin/master
}

refresh_public_master kelion-codex /var/lib/kelion-codex /var/lib/kelion-codex/repo
refresh_public_master kelion-publisher /var/lib/kelion-publisher /var/lib/kelion-publisher/repo
worker_source_commit=$(runuser -u kelion-codex -- env -i \
  HOME=/var/lib/kelion-codex PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git -C /var/lib/kelion-codex/repo rev-parse 'origin/master^{commit}')
publisher_source_commit=$(runuser -u kelion-publisher -- env -i \
  HOME=/var/lib/kelion-publisher PATH=/usr/bin:/bin GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git -C /var/lib/kelion-publisher/repo rev-parse 'origin/master^{commit}')
[ "$worker_source_commit" = "$EXPECTED_GATE_COMMIT" ] \
  || fail 'worker origin/master differs from the signed gate commit'
[ "$publisher_source_commit" = "$EXPECTED_GATE_COMMIT" ] \
  || fail 'publisher origin/master differs from the signed gate commit'

validate_rootless_gate_image() {
  local user=$1 home=$2 runtime=$3 digest revision
  if [ -e "$runtime" ] || [ -L "$runtime" ]; then
    [ -d "$runtime" ] && [ ! -L "$runtime" ] \
      || fail "unsafe rootless Podman runtime type for $user"
  fi
  # RuntimeDirectory for a completed oneshot may be removed or later recreated
  # with deployment-era metadata.  The publication lock held above proves that
  # no gate consumer is active, so establish the canonical private directory
  # before asking rootless Podman to use it.
  install -d -o "$user" -g "$user" -m 0700 -- "$runtime"
  [ "$(stat -Lc '%U:%G:%a' "$runtime")" = "$user:$user:700" ] \
    || fail "unsafe rootless Podman runtime metadata for $user"
  digest=$(cd "$runtime" && runuser -u "$user" -- env -i \
    HOME="$home" XDG_RUNTIME_DIR="$runtime" PATH=/usr/bin:/bin \
    podman image inspect --format '{{.Digest}}' "$EXPECTED_GATE_IMAGE")
  [ "$digest" = "${EXPECTED_GATE_IMAGE##*@}" ] \
    || fail "gate image digest mismatch for $user"
  revision=$(cd "$runtime" && runuser -u "$user" -- env -i \
    HOME="$home" XDG_RUNTIME_DIR="$runtime" PATH=/usr/bin:/bin \
    podman image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
      "$EXPECTED_GATE_IMAGE")
  [ "$revision" = "$EXPECTED_GATE_COMMIT" ] \
    || fail "gate image revision mismatch for $user"
}

validate_rootless_gate_image kelion-codex /var/lib/kelion-codex /run/kelion-codex
validate_rootless_gate_image kelion-publisher /var/lib/kelion-publisher /run/kelion-publisher

deploy_quiesce_journal=$RUNTIME_ROOT/constructor-deploy-quiesce.journal
if [ -e "$deploy_quiesce_journal" ] || [ -L "$deploy_quiesce_journal" ]; then
  require_regular "$deploy_quiesce_journal" root:root:600
  jq -e '.schema == 2 and .phase == "gate-prepared" and
    (.requestId | strings | test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and
    (.commit | strings | test("^[0-9a-f]{40}$")) and
    (.activeBefore | strings | test("^[0-9a-f]{40}$")) and
    .commit != .activeBefore and .committedGateSha256 == null and
    ([.gateSha256.worker,.gateSha256.publisher,.gateSha256.release,
      .targetGateSha256.worker,.targetGateSha256.publisher,.targetGateSha256.release] |
      all(.[]; type == "string" and test("^[0-9a-f]{64}$")))' \
    "$deploy_quiesce_journal" >/dev/null \
    || fail 'active deploy journal is not the exact recoverable gate-prepared incident'
  deploy_request=$(jq -er '.requestId' "$deploy_quiesce_journal")
  deploy_commit=$(jq -er '.commit' "$deploy_quiesce_journal")
  deploy_active=$(jq -er '.activeBefore' "$deploy_quiesce_journal")
  [ "$(sed -n '1p' "$RUNTIME_ROOT/release-state/active")" = "$deploy_active" ] \
    || fail 'active release differs from the recoverable deploy generation'
  [ "$(sha256sum "$WORKER_ENV" | awk '{print $1}')" = \
      "$(jq -er '.gateSha256.worker' "$deploy_quiesce_journal")" ]
  [ "$(sha256sum "$PUBLISHER_ENV" | awk '{print $1}')" = \
      "$(jq -er '.gateSha256.publisher' "$deploy_quiesce_journal")" ]
  [ "$(sha256sum "$RELEASE_ENV" | awk '{print $1}')" = \
      "$(jq -er '.gateSha256.release' "$deploy_quiesce_journal")" ]
  live_compose=/root/kelion/config/compose.production.yml
  require_regular "$live_compose" root:root:444
  KELION_CUTOVER_LOCK_HELD=1 \
  KELION_DEPLOY_QUIESCE_PROOF=1 \
  KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$deploy_request" \
  KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$deploy_commit" \
    bash "$RUNTIME_CUTOVER_SOURCE" --discard-unmutated-gate-prepared \
      "$deploy_request" "$deploy_commit" "$deploy_active" "$live_compose"
  # Recovery consumed the old transaction.  Any later rollback must return to
  # this reconciled state, never to the ownerless quiesced pre-recovery vector.
  WORKER_TIMER_STATE=$(unit_state kelion-codex-worker.timer)
  WEB_STATE=$(unit_state private-ai-web.service)
  PUBLISHER_TIMER_STATE=$(unit_state kelion-constructor-publisher.timer)
  RELEASE_TIMER_STATE=$(unit_state kelion-constructor-release.timer)
  quiesce_gate_consumers force
  [ ! -e "$deploy_quiesce_journal" ] && [ ! -L "$deploy_quiesce_journal" ] \
    || fail 'recovered deploy journal was not consumed'
  printf 'STALE_DEPLOY_GATE_PREPARED_RECOVERED=yes\n'
fi

install_persistent_runtime_helper() {
  local gate_journal=$RUNTIME_ROOT/constructor-gate-refresh.journal source_sha current_sha
  for gate_artifact in "$gate_journal" "$RUNTIME_ROOT"/constructor-gate-txn.* \
    "$RUNTIME_ROOT"/constructor-gate-discarded.* "$RUNTIME_ROOT"/constructor-gate-gc.*; do
    [ ! -e "$gate_artifact" ] && [ ! -L "$gate_artifact" ] \
      || fail 'a pending gate recovery blocks the persistent helper update'
  done
  require_regular "$RUNTIME_CUTOVER_TARGET" root:root:500
  source_sha=$(sha256sum "$RUNTIME_CUTOVER_SOURCE" | awk '{print $1}')
  [ "$source_sha" = "$EXPECTED_RUNTIME_CUTOVER_SHA256" ] \
    || fail 'bundled runtime helper hash is not the pinned repair generation'
  current_sha=$(sha256sum "$RUNTIME_CUTOVER_TARGET" | awk '{print $1}')
  case "$current_sha" in
    "$LEGACY_STATIC_RUNTIME_CUTOVER_SHA256"|"$LEGACY_ACTIVATION_GC_RUNTIME_CUTOVER_SHA256"|\
      "$UPGRADE_RUNTIME_CUTOVER_SHA256"|"$PREVIOUS_RUNTIME_CUTOVER_SHA256"|\
      "$EXPECTED_RUNTIME_CUTOVER_SHA256") ;;
    *) fail "persistent runtime helper is not an allowed predecessor: $current_sha" ;;
  esac
  runtime_helper_candidate=$(mktemp "$RUNTIME_CUTOVER_TARGET.private-ai.XXXXXX")
  install -o root -g root -m 0500 "$RUNTIME_CUTOVER_SOURCE" "$runtime_helper_candidate"
  bash -n "$runtime_helper_candidate"
  sync -f "$runtime_helper_candidate"
  mv -f -- "$runtime_helper_candidate" "$RUNTIME_CUTOVER_TARGET"
  preserve_runtime_helper=1
  runtime_helper_candidate=''
  sync -f "$RUNTIME_CUTOVER_TARGET"
  sync -f "$(dirname -- "$RUNTIME_CUTOVER_TARGET")"
  require_regular "$RUNTIME_CUTOVER_TARGET" root:root:500
  cmp -s -- "$RUNTIME_CUTOVER_TARGET" "$RUNTIME_CUTOVER_SOURCE" \
    || fail 'persistent runtime helper does not match the pinned bundle'
  refresh_snapshot_file runtime_cutover_helper "$RUNTIME_CUTOVER_TARGET"
  preserve_runtime_helper=0
  printf 'PERSISTENT_RUNTIME_HELPER_UPDATED=yes\n'
}

install_persistent_runtime_helper

repair_stale_committed_gate_journal() {
  local recovery_root rollback_manifest recovery_compose backups_root observed expected
  local journal_sha manifest_sha compose_sha logical target backup candidate temporary index
  local runtime_journal=/root/kelion/runtime/runtime-config-cutover.journal
  local live_vector_allowed=1
  local -a logicals=(
    constructor-config.codex-worker.env
    constructor-config.constructor-publisher.env
    constructor-config.constructor-release.env
  )
  local -a targets=("$WORKER_ENV" "$PUBLISHER_ENV" "$RELEASE_ENV")
  local -a backup_shas=() candidates=()

  [ "$runtime_journal" = "$RUNTIME_CUTOVER_JOURNAL" ]
  if [ ! -e "$runtime_journal" ] && [ ! -L "$runtime_journal" ]; then
    return 0
  fi
  require_regular "$runtime_journal" root:root:600
  jq -e '
    (keys | sort) == ["phase","schema","transactionRoot"] and
    .schema == 1 and .phase == "committed" and
    (.transactionRoot | strings |
      test("^/root/kelion/runtime/runtime-config-txn\\.[A-Za-z0-9]+$"))
  ' "$runtime_journal" >/dev/null \
    || fail 'runtime journal is not the exact stale committed gate incident'
  recovery_root=$(jq -er '.transactionRoot' "$runtime_journal")
  [[ "$recovery_root" =~ ^/root/kelion/runtime/runtime-config-txn\.[A-Za-z0-9]+$ ]]
  [ -d "$recovery_root" ] && [ ! -L "$recovery_root" ] \
    && [ "$(realpath -e -- "$recovery_root")" = "$recovery_root" ] \
    && [ "$(stat -Lc '%U:%G:%a' "$recovery_root")" = root:root:700 ] \
    || fail 'stale committed transaction root is unsafe'
  rollback_manifest=$recovery_root/rollback-manifest
  recovery_compose=$recovery_root/recovery-compose.yml
  backups_root=$recovery_root/backups
  observed=$(find "$recovery_root" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)
  expected=$'backups:d\nrecovery-compose.yml:f\nrollback-manifest:f'
  [ "$observed" = "$expected" ] \
    || fail 'stale committed transaction has unexpected top-level entries'
  [ -d "$backups_root" ] && [ ! -L "$backups_root" ] \
    && [ "$(realpath -e -- "$backups_root")" = "$backups_root" ] \
    && [ "$(stat -Lc '%U:%G:%a' "$backups_root")" = root:root:700 ] \
    || fail 'stale committed backup root is unsafe'
  require_regular "$rollback_manifest" root:root:600
  require_regular "$recovery_compose" root:root:600
  cmp -s -- "$recovery_compose" "$COMPOSE_SOURCE" \
    || fail 'stale committed recovery compose differs from the pinned bundle'
  mapfile -t committed_manifest < "$rollback_manifest"
  [ "${#committed_manifest[@]}" -eq 3 ] \
    && [ "${committed_manifest[0]}" = $'constructor-config.codex-worker.env\t1' ] \
    && [ "${committed_manifest[1]}" = $'constructor-config.constructor-publisher.env\t1' ] \
    && [ "${committed_manifest[2]}" = $'constructor-config.constructor-release.env\t1' ] \
    || fail 'stale committed rollback manifest is not the exact three-gate allowlist'
  observed=$(find "$backups_root" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort)
  expected=$'constructor-config.codex-worker.env:f\nconstructor-config.constructor-publisher.env:f\nconstructor-config.constructor-release.env:f'
  [ "$observed" = "$expected" ] \
    || fail 'stale committed backup inventory has an unexpected logical'

  journal_sha=$(sha256sum "$runtime_journal" | awk '{print $1}')
  manifest_sha=$(sha256sum "$rollback_manifest" | awk '{print $1}')
  compose_sha=$(sha256sum "$recovery_compose" | awk '{print $1}')
  committed_gate_repair_root=$(mktemp -d "$RUNTIME_ROOT/private-ai-committed-gate-repair.XXXXXX")
  chown root:root "$committed_gate_repair_root"
  chmod 0700 "$committed_gate_repair_root"

  for index in "${!logicals[@]}"; do
    logical=${logicals[$index]}
    target=${targets[$index]}
    backup=$backups_root/$logical
    candidate=$committed_gate_repair_root/$logical
    require_regular "$backup" root:root:640
    require_regular "$target" root:root:640
    backup_shas+=("$(sha256sum "$backup" | awk '{print $1}')")
    if [ "$index" -lt 2 ]; then
      [ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$backup")" -eq 1 ] \
        || fail "stale committed backup has a non-exact gate field: $logical"
      awk -F= -v image="$EXPECTED_GATE_IMAGE" '
        $1 == "KELION_CODEX_GATE_IMAGE" {
          if (!written++) print "KELION_CODEX_GATE_IMAGE=" image
          next
        }
        { print }
      ' "$backup" > "$candidate"
    else
      install -o root -g root -m 0600 "$backup" "$candidate"
    fi
    chown root:root "$candidate"
    chmod 0600 "$candidate"
    if [ "$index" -lt 2 ]; then
      [ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$candidate")" -eq 1 ] \
        || fail "repaired candidate has a non-exact gate field: $logical"
      grep -Fqx "KELION_CODEX_GATE_IMAGE=$EXPECTED_GATE_IMAGE" "$candidate"
    else
      [ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$candidate")" -eq 0 ]
      cmp -s -- "$candidate" "$backup"
    fi
    KELION_CUTOVER_LOCK_HELD=1 bash "$RUNTIME_CUTOVER_SOURCE" \
      --validate-env-file "$logical" "$candidate"
    cmp -s -- "$target" "$backup" || cmp -s -- "$target" "$candidate" \
      || live_vector_allowed=0
    candidates+=("$candidate")
  done
  [ "$live_vector_allowed" -eq 1 ] \
    || fail 'live gate config is neither rollback nor reconstructed forward bytes'

  # Reautentificăm toate dovezile imediat înainte de prima mutație live.
  require_regular "$runtime_journal" root:root:600
  [ "$(sha256sum "$runtime_journal" | awk '{print $1}')" = "$journal_sha" ]
  [ "$(sha256sum "$rollback_manifest" | awk '{print $1}')" = "$manifest_sha" ]
  [ "$(sha256sum "$recovery_compose" | awk '{print $1}')" = "$compose_sha" ]
  for index in "${!logicals[@]}"; do
    backup=$backups_root/${logicals[$index]}
    target=${targets[$index]}
    [ "$(sha256sum "$backup" | awk '{print $1}')" = "${backup_shas[$index]}" ]
    cmp -s -- "$target" "$backup" || cmp -s -- "$target" "${candidates[$index]}"
  done
  quiesce_gate_consumers force
  systemctl stop kelion-constructor-sync.service
  case "$(systemctl is-active kelion-constructor-sync.service 2>/dev/null || true)" in
    inactive|failed) ;;
    *) fail 'constructor sync is not quiesced for committed gate repair' ;;
  esac
  if [ -e "$RUNTIME_READY_STAMP" ] || [ -L "$RUNTIME_READY_STAMP" ]; then
    require_regular "$RUNTIME_READY_STAMP" root:root:444
    [ "$(tr -d '\n' < "$RUNTIME_READY_STAMP")" = schema=1 ]
    rm -f -- "$RUNTIME_READY_STAMP"
    sync -f "$RUNTIME_READY_ROOT"
  fi
  systemctl is-enabled --quiet kelion-runtime-config-recovery.service
  [ "$(systemctl show --property=MainPID --value kelion-runtime-config-recovery.service)" = 0 ]
  [ "$(systemctl show --property=ControlPID --value kelion-runtime-config-recovery.service)" = 0 ]

  for index in "${!logicals[@]}"; do
    target=${targets[$index]}
    candidate=${candidates[$index]}
    temporary=$(mktemp "$target.private-ai-repair.XXXXXX")
    install -o root -g root -m 0640 "$candidate" "$temporary"
    sync -f "$temporary"
    mv -f -- "$temporary" "$target"
    sync -f "$target"
    sync -f "$(dirname -- "$target")"
    require_regular "$target" root:root:640
    cmp -s -- "$target" "$candidate"
  done
  # Din acest prag toate cele trei ținte sunt generația forward completă.
  # Rollbackul exterior nu mai are voie să le înlocuiască cu backupurile vechi.
  preserve_committed_gate_env=1

  KELION_CUTOVER_LOCK_HELD=1 bash "$RUNTIME_CUTOVER_SOURCE" \
    --recover-only "$COMPOSE_SOURCE" --leave-constructor-quiesced
  [ ! -e "$runtime_journal" ] && [ ! -L "$runtime_journal" ] \
    || fail 'recovered runtime journal was not consumed'

  # Rebazăm rollbackul numai după consumarea durabilă a jurnalului. Până când
  # toate snapshoturile sunt sincronizate, flagul de mai sus păstrează live-ul.
  refresh_snapshot_file worker_env "$WORKER_ENV"
  refresh_snapshot_file publisher_env "$PUBLISHER_ENV"
  refresh_snapshot_file release_env "$RELEASE_ENV"
  refresh_snapshot_file runtime_ready_stamp "$RUNTIME_READY_STAMP"
  preserve_committed_gate_env=0
  rm -rf --one-file-system -- "$committed_gate_repair_root"
  committed_gate_repair_root=''
  WORKER_TIMER_STATE=$(unit_state kelion-codex-worker.timer)
  PUBLISHER_TIMER_STATE=$(unit_state kelion-constructor-publisher.timer)
  RELEASE_TIMER_STATE=$(unit_state kelion-constructor-release.timer)
  printf 'STALE_RUNTIME_COMMITTED_GATE_REPAIRED=yes\n'
}

repair_stale_committed_gate_journal

gate_cutover_stage=$(mktemp -d "$RUNTIME_ROOT/runtime-cutover.XXXXXX")
chown root:root "$gate_cutover_stage"
chmod 0700 "$gate_cutover_stage"
install -d -o root -g root -m 0700 "$gate_cutover_stage/files"
: > "$gate_cutover_stage/manifest"
chown root:root "$gate_cutover_stage/manifest"
chmod 0600 "$gate_cutover_stage/manifest"

stage_gate_env() {
  local source logical target
  source=$1
  logical=$2
  target=$gate_cutover_stage/files/$logical
  [ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$source")" -eq 1 ] \
    || fail "gate image field is not exact in $source"
  awk -F= -v image="$EXPECTED_GATE_IMAGE" '
    $1 == "KELION_CODEX_GATE_IMAGE" {
      if (!written++) print "KELION_CODEX_GATE_IMAGE=" image
      next
    }
    { print }
  ' "$source" > "$target"
  chown root:root "$target"
  chmod 0600 "$target"
  [ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$target")" -eq 1 ]
  grep -Fqx "KELION_CODEX_GATE_IMAGE=$EXPECTED_GATE_IMAGE" "$target"
  printf '%s\n' "$logical" >> "$gate_cutover_stage/manifest"
}

stage_gate_env "$WORKER_ENV" constructor-config.codex-worker.env
stage_gate_env "$PUBLISHER_ENV" constructor-config.constructor-publisher.env
install -o root -g root -m 0600 "$RELEASE_ENV" \
  "$gate_cutover_stage/files/constructor-config.constructor-release.env"
printf '%s\n' constructor-config.constructor-release.env >> "$gate_cutover_stage/manifest"
sync -f "$gate_cutover_stage/manifest"
sync -f "$gate_cutover_stage/files"
sync -f "$gate_cutover_stage"

systemctl is-enabled --quiet kelion-runtime-config-recovery.service
KELION_CUTOVER_LOCK_HELD=1 bash "$RUNTIME_CUTOVER_SOURCE" \
  "$gate_cutover_stage" "$COMPOSE_SOURCE" --leave-constructor-quiesced
gate_cutover_stage=''
quiesce_gate_consumers force
[ ! -e "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
  && [ ! -L "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
  || fail 'unit-only migration barrier remains after the strict cutover'
[ ! -e "$RUNTIME_READY_STAMP" ] && [ ! -L "$RUNTIME_READY_STAMP" ] \
  || fail 'runtime ready stamp was published before the OpenCode cutover proof'
for quiesced_timer in \
  kelion-codex-worker.timer \
  kelion-constructor-publisher.timer \
  kelion-constructor-release.timer; do
  [ "$(unit_state "$quiesced_timer")" = disabled:inactive ] \
    || fail "timer is not exactly quiesced after gate refresh: $quiesced_timer"
done
require_regular "$WORKER_ENV" root:root:640
require_regular "$PUBLISHER_ENV" root:root:640
grep -Fqx "KELION_CODEX_GATE_IMAGE=$EXPECTED_GATE_IMAGE" "$WORKER_ENV"
grep -Fqx "KELION_CODEX_GATE_IMAGE=$EXPECTED_GATE_IMAGE" "$PUBLISHER_ENV"
printf 'CONSTRUCTOR_GATE_IMAGE_REFRESHED=%s\n' "$EXPECTED_GATE_IMAGE"

systemctl stop kelion-codex-worker.timer
worker_before=$(systemctl is-active kelion-codex-worker.service 2>/dev/null || true)
case "$worker_before" in
  inactive|failed) ;;
  *) fail "worker is not quiescent; retry after the current queue turn: $worker_before" ;;
esac
worker_cutover_started=1
systemctl stop kelion-codex-worker.service kelion-constructor-sync.service
web_cutover_started=1
systemctl stop private-ai-web.service

export DEBIAN_FRONTEND=noninteractive
if ! command -v sudo >/dev/null 2>&1 || ! command -v visudo >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends sudo >/dev/null
fi

# Publicăm control-plane-ul manual complet înaintea workerului care îl declară
# Requires=. Toate rename-urile sunt sub intentul persistent al finalizerului;
# serviciul este pornit abia după ready, iar endpointurile rămân blocate până
# la clear-ul final al markerului.
install -d -o root -g root -m 0755 /opt/kelion-constructor
install -d -o root -g root -m 0755 /opt/kelion-constructor/lib
install -d -o root -g root -m 0755 /opt/private-ai/bin
install -d -o root -g 10050 -m 0750 /root/kelion/secrets
getent group 10050 >/dev/null

model_control_candidate=$(mktemp "$MODEL_CONTROL_TARGET.candidate.XXXXXX")
install -o root -g root -m 0555 "$MODEL_CONTROL_SOURCE" "$model_control_candidate"
node --input-type=module --check < "$model_control_candidate"
mv -f -- "$model_control_candidate" "$MODEL_CONTROL_TARGET"
model_control_candidate=''
sync -f "$MODEL_CONTROL_TARGET"
sync -f "$(dirname -- "$MODEL_CONTROL_TARGET")"

model_switch_candidate=$(mktemp "$MODEL_SWITCH_TARGET.candidate.XXXXXX")
install -o root -g root -m 0555 "$MODEL_SWITCH_SOURCE" "$model_switch_candidate"
bash -n "$model_switch_candidate"
mv -f -- "$model_switch_candidate" "$MODEL_SWITCH_TARGET"
model_switch_candidate=''
sync -f "$MODEL_SWITCH_TARGET"
sync -f "$(dirname -- "$MODEL_SWITCH_TARGET")"

service_auth_candidate=$(mktemp "$SERVICE_AUTH_TARGET.candidate.XXXXXX")
install -o root -g root -m 0444 "$SERVICE_AUTH_SOURCE" "$service_auth_candidate"
mv -f -- "$service_auth_candidate" "$SERVICE_AUTH_TARGET"
service_auth_candidate=''
sync -f "$SERVICE_AUTH_TARGET"
sync -f "$(dirname -- "$SERVICE_AUTH_TARGET")"

model_control_unit_candidate=$(mktemp "$MODEL_CONTROL_UNIT_TARGET.candidate.XXXXXX")
install -o root -g root -m 0444 "$MODEL_CONTROL_UNIT_SOURCE" "$model_control_unit_candidate"
mv -f -- "$model_control_unit_candidate" "$MODEL_CONTROL_UNIT_TARGET"
model_control_unit_candidate=''
sync -f "$MODEL_CONTROL_UNIT_TARGET"
sync -f "$(dirname -- "$MODEL_CONTROL_UNIT_TARGET")"

if [ -e "$MODEL_CONTROL_SECRET" ] || [ -L "$MODEL_CONTROL_SECRET" ]; then
  [ -f "$MODEL_CONTROL_SECRET" ] && [ ! -L "$MODEL_CONTROL_SECRET" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$MODEL_CONTROL_SECRET")" = '0:10050:440:1' ] \
    && [ "$(wc -l < "$MODEL_CONTROL_SECRET")" -eq 1 ] \
    && grep -Eq '^[0-9a-f]{64}$' "$MODEL_CONTROL_SECRET" \
    || fail 'existing model-control secret is unsafe'
else
  model_control_secret_candidate=$(mktemp /root/kelion/secrets/.constructor-model-control-secret.XXXXXX)
  openssl rand -hex 32 > "$model_control_secret_candidate"
  chown root:10050 "$model_control_secret_candidate"
  chmod 0440 "$model_control_secret_candidate"
  [ "$(wc -l < "$model_control_secret_candidate")" -eq 1 ]
  grep -Eq '^[0-9a-f]{64}$' "$model_control_secret_candidate"
  sync -f "$model_control_secret_candidate"
  mv -f -- "$model_control_secret_candidate" "$MODEL_CONTROL_SECRET"
  model_control_secret_candidate=''
  sync -f /root/kelion/secrets
fi
[ "$(stat -Lc '%u:%g:%a:%h' "$MODEL_CONTROL_SECRET")" = '0:10050:440:1' ]
cmp -s -- "$MODEL_CONTROL_SOURCE" "$MODEL_CONTROL_TARGET"
cmp -s -- "$MODEL_SWITCH_SOURCE" "$MODEL_SWITCH_TARGET"
cmp -s -- "$SERVICE_AUTH_SOURCE" "$SERVICE_AUTH_TARGET"
cmp -s -- "$MODEL_CONTROL_UNIT_SOURCE" "$MODEL_CONTROL_UNIT_TARGET"
"$MODEL_SWITCH_TARGET" --prepare-lock
/usr/bin/node "$MODEL_CONTROL_TARGET" --self-test

worker_candidate=$(mktemp "$WORKER_TARGET.candidate.XXXXXX")
install -o root -g root -m 0555 "$WORKER_SOURCE" "$worker_candidate"
node --input-type=module --check < "$worker_candidate"
mv -f -- "$worker_candidate" "$WORKER_TARGET"
sync -f "$WORKER_TARGET"
sync -f "$(dirname "$WORKER_TARGET")"

sync_worker_candidate=$(mktemp "$SYNC_WORKER_TARGET.candidate.XXXXXX")
install -o root -g root -m 0555 "$SYNC_WORKER_SOURCE" "$sync_worker_candidate"
bash -n "$sync_worker_candidate"
mv -f -- "$sync_worker_candidate" "$SYNC_WORKER_TARGET"
sync_worker_candidate=''
sync -f "$SYNC_WORKER_TARGET"
sync -f "$(dirname "$SYNC_WORKER_TARGET")"
require_regular "$SYNC_WORKER_TARGET" root:root:555
cmp -s -- "$SYNC_WORKER_SOURCE" "$SYNC_WORKER_TARGET"

sync_unit_candidate=$(mktemp "$SYNC_UNIT_TARGET.candidate.XXXXXX")
install -o root -g root -m 0444 "$SYNC_UNIT_SOURCE" "$sync_unit_candidate"
mv -f -- "$sync_unit_candidate" "$SYNC_UNIT_TARGET"
sync_unit_candidate=''
sync -f "$SYNC_UNIT_TARGET"
require_regular "$SYNC_UNIT_TARGET" root:root:444
cmp -s -- "$SYNC_UNIT_SOURCE" "$SYNC_UNIT_TARGET"

unit_candidate=$(mktemp "$WORKER_UNIT_TARGET.candidate.XXXXXX")
install -o root -g root -m 0444 "$WORKER_UNIT_SOURCE" "$unit_candidate"
mv -f -- "$unit_candidate" "$WORKER_UNIT_TARGET"
sync -f "$WORKER_UNIT_TARGET"

install -d -o root -g root -m 0755 "$WEB_DROPIN_DIR"
rm -f -- "$LEGACY_WORKER_DROPIN" "$RETIRED_WORKER_DROPIN"

web_dropin_candidate=$(mktemp "$WEB_DROPIN.candidate.XXXXXX")
install -o root -g root -m 0444 "$WEB_DROPIN_SOURCE" "$web_dropin_candidate"
mv -f -- "$web_dropin_candidate" "$WEB_DROPIN"
web_dropin_candidate=''
sync -f "$WEB_DROPIN"
[ "$(sha256sum "$WEB_DROPIN" | awk '{print $1}')" = \
  "$(sha256sum "$WEB_DROPIN_SOURCE" | awk '{print $1}')" ]

sudoers_candidate=$(mktemp /etc/sudoers.d/.kelion-constructor.XXXXXX)
install -o root -g root -m 0440 "$SUDOERS_SOURCE" "$sudoers_candidate"
chown root:root "$sudoers_candidate"
chmod 0440 "$sudoers_candidate"
visudo -cf "$sudoers_candidate" >/dev/null
mv -f -- "$sudoers_candidate" "$SUDOERS"
visudo -cf "$SUDOERS" >/dev/null

if [ "$canonical_codex_fake" -eq 1 ]; then
  canonical_codex_candidate=$(mktemp "$CANONICAL_CODEX.candidate.XXXXXX")
  install -o root -g root -m 0555 "$LEGACY_CODEX_REAL" "$canonical_codex_candidate"
  env -i PATH=/usr/bin:/bin timeout 30 "$canonical_codex_candidate" --version >/dev/null
  mv -f -- "$canonical_codex_candidate" "$CANONICAL_CODEX"
  sync -f "$CANONICAL_CODEX"
fi
rm -f -- \
  "$LEGACY_CODEX_REAL" \
  "$LEGACY_OPENCODE_WRAPPER" \
  "$LEGACY_COMPAT_KEY" \
  "$LEGACY_SUDOERS"
for retired_artifact in \
  "$LEGACY_CODEX_REAL" \
  "$LEGACY_OPENCODE_WRAPPER" \
  "$LEGACY_COMPAT_KEY" \
  "$LEGACY_SUDOERS" \
  "$LEGACY_WORKER_DROPIN" \
  "$RETIRED_WORKER_DROPIN"; do
  [ ! -e "$retired_artifact" ] && [ ! -L "$retired_artifact" ] \
    || fail "retired Codex adapter remains: $retired_artifact"
done
if [ -e "$CANONICAL_CODEX" ] || [ -L "$CANONICAL_CODEX" ]; then
  canonical_codex_verified=$CANONICAL_CODEX
  if [ -L "$CANONICAL_CODEX" ]; then
    canonical_codex_verified=$(readlink -f -- "$CANONICAL_CODEX" || true)
    [ -n "$canonical_codex_verified" ] && [ -f "$canonical_codex_verified" ] \
      || fail 'canonical Codex symlink target is unsafe'
    case "$canonical_codex_verified" in
      "$LEGACY_CODEX_REAL"|"$LEGACY_OPENCODE_WRAPPER"|"$OPENCODE_BIN"|/opt/private-ai/*)
        fail 'canonical Codex symlink still targets the retired local adapter'
        ;;
    esac
  else
    [ -f "$CANONICAL_CODEX" ] || fail 'canonical Codex path is unsafe'
  fi
  [ "$(stat -Lc '%u:%g' "$canonical_codex_verified")" = '0:0' ] \
    || fail 'canonical Codex target is not root owned'
  [ $((8#$(stat -Lc '%a' "$canonical_codex_verified") & 8#022)) -eq 0 ] \
    || fail 'canonical Codex target is writable outside root'
  [ -x "$canonical_codex_verified" ] || fail 'canonical Codex target is not executable'
  ! grep -aEq 'KELION_LOCAL_QWEN_WRAPPER|local-qwen-compat|opencode-constructor-root' \
    "$canonical_codex_verified" || fail 'fake canonical Codex wrapper remains'
fi

chown privateai:privateai "$PRIVATE_AI_HOME"
chmod 0750 "$PRIVATE_AI_HOME"
chown root:privateai "$PRIVATE_AI_HOME/.config" "$PRIVATE_AI_HOME/.config/opencode"
chmod 0750 "$PRIVATE_AI_HOME/.config" "$PRIVATE_AI_HOME/.config/opencode"
install -d -o kelion-codex -g kelion-codex -m 0700 \
  /var/lib/kelion-codex/.cache /var/lib/kelion-codex/.local /var/lib/kelion-codex/.local/share \
  /run/kelion-codex
[ "$(stat -Lc '%U:%G:%a' /run/kelion-codex)" = 'kelion-codex:kelion-codex:700' ]

instructions_candidate=$(mktemp "$OPENCODE_INSTRUCTIONS.candidate.XXXXXX")
install -o root -g privateai -m 0640 "$OPENCODE_INSTRUCTIONS_SOURCE" "$instructions_candidate"
mv -f -- "$instructions_candidate" "$OPENCODE_INSTRUCTIONS"
instructions_candidate=''
sync -f "$OPENCODE_INSTRUCTIONS"

config_candidate=$(mktemp "$OPENCODE_CONFIG.candidate.XXXXXX")
install -o root -g privateai -m 0640 "$OPENCODE_CONFIG_SOURCE" "$config_candidate"
mv -f -- "$config_candidate" "$OPENCODE_CONFIG"
config_candidate=''
sync -f "$OPENCODE_CONFIG"

[ "$(sha256sum "$OPENCODE_CONFIG" | awk '{print $1}')" = \
  "$(sha256sum "$OPENCODE_CONFIG_SOURCE" | awk '{print $1}')" ]
[ "$(sha256sum "$OPENCODE_INSTRUCTIONS" | awk '{print $1}')" = \
  "$(sha256sum "$OPENCODE_INSTRUCTIONS_SOURCE" | awk '{print $1}')" ]

jq -e '
  . as $config |
  $config.autoupdate == false and $config.share == "disabled" and
  $config.enabled_providers == ["llama.cpp"] and
  ($config.provider | keys) == ["llama.cpp"] and
  $config.model == "llama.cpp/qwen3.6-35b-a3b-local" and
  ($config.small_model // $config.model) == "llama.cpp/qwen3.6-35b-a3b-local" and
  $config.provider["llama.cpp"].npm == "@ai-sdk/openai-compatible" and
  $config.provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1" and
  ($config.provider["llama.cpp"].options | has("apiKey") | not) and
  (["*", "read", "glob", "grep", "edit", "bash", "task", "skill",
    "webfetch", "websearch", "external_directory"]
   | all(.[]; $config.permission[.] == "allow")) and
  $config.server.hostname == "127.0.0.1" and
  $config.server.port == 24096 and $config.server.mdns == false
' "$OPENCODE_CONFIG" >/dev/null

systemctl daemon-reload
systemd-analyze verify private-ai-web.service kelion-codex-worker.service \
  kelion-constructor-sync.service kelion-constructor-model-control.service >/dev/null
systemctl enable kelion-constructor-model-control.service >/dev/null
[ "$(systemctl show kelion-constructor-model-control.service -p FragmentPath --value)" = \
  "$MODEL_CONTROL_UNIT_TARGET" ]
[ -z "$(systemctl show kelion-constructor-model-control.service -p DropInPaths --value)" ]
[ "$(systemctl show kelion-codex-worker.service -p FragmentPath --value)" = \
  "$WORKER_UNIT_TARGET" ]
[ -z "$(systemctl show kelion-codex-worker.service -p DropInPaths --value)" ]
systemctl cat kelion-codex-worker.service > "$rollback_root/effective-worker.unit"
grep -Fq 'ExecStart=/usr/bin/flock --exclusive --wait 9000 /run/lock/private-ai-model-switch.lock /usr/bin/node /opt/kelion-codex/codex-worker.mjs --once' \
  "$rollback_root/effective-worker.unit"
grep -Fq 'Environment=OPENCODE_BIN=/opt/private-ai/bin/opencode' \
  "$rollback_root/effective-worker.unit"
grep -Fq 'LoadCredential=codex-worker-secret:/root/kelion/secrets/codex-worker-secret' \
  "$rollback_root/effective-worker.unit"
! grep -Eq 'CODEX_BIN=|CODEX_HOME=|openai-project-key|codex-real|opencode-constructor-root' \
  "$rollback_root/effective-worker.unit" || fail 'effective worker unit still references the retired Codex adapter'
[ "$(systemctl show kelion-codex-worker.service -p User --value)" = kelion-codex ]
[ "$(systemctl show kelion-codex-worker.service -p Group --value)" = kelion-codex ]
[ "$(systemctl show kelion-codex-worker.service -p NoNewPrivileges --value)" = no ]
[ "$(systemctl show kelion-codex-worker.service -p ProtectSystem --value)" = no ]
[ "$(systemctl show kelion-codex-worker.service -p ProtectHome --value)" = no ]
systemctl cat kelion-constructor-sync.service > "$rollback_root/effective-sync.unit"
[ "$(systemctl show kelion-constructor-sync.service -p FragmentPath --value)" = \
  "$SYNC_UNIT_TARGET" ]
[ "$(systemctl show kelion-constructor-sync.service -p User --value)" = kelion-codex ]
[ "$(systemctl show kelion-constructor-sync.service -p Group --value)" = kelion-codex ]
[ "$(systemctl show kelion-constructor-sync.service -p NoNewPrivileges --value)" = yes ]
[ -z "$(systemctl show kelion-constructor-sync.service -p CapabilityBoundingSet --value)" ]
[ -z "$(systemctl show kelion-constructor-sync.service -p AmbientCapabilities --value)" ]
grep -Fq 'ExecStart=/opt/kelion-constructor/constructor-sync-worker.sh' \
  "$rollback_root/effective-sync.unit"
effective_groups=" $(systemctl show kelion-codex-worker.service -p SupplementaryGroups --value) "
[[ "$effective_groups" == *' kelion-handoff '* ]]
[[ "$effective_groups" == *' privateai '* ]]
systemctl restart private-ai-web.service
systemctl is-active --quiet private-ai-web.service
systemctl is-active --quiet private-ai-llm.service
[ "$(systemctl show private-ai-web.service -p FragmentPath --value)" = \
  /etc/systemd/system/private-ai-web.service ]
[ "$(systemctl show private-ai-web.service -p DropInPaths --value)" = "$WEB_DROPIN" ]
[ "$(systemctl show private-ai-llm.service -p FragmentPath --value)" = \
  /etc/systemd/system/private-ai-llm.service ]
[ -z "$(systemctl show private-ai-llm.service -p DropInPaths --value)" ]
[ "$(systemctl show private-ai-web.service -p User --value)" = root ]
[ "$(systemctl show private-ai-web.service -p Group --value)" = root ]
[ "$(systemctl show private-ai-web.service -p NoNewPrivileges --value)" = no ]
[ "$(systemctl show private-ai-web.service -p ProtectSystem --value)" = no ]
[ "$(systemctl show private-ai-web.service -p ProtectHome --value)" = no ]
[ "$(systemctl show private-ai-web.service -p LockPersonality --value)" = no ]
[ "$(systemctl show private-ai-web.service -p RestrictRealtime --value)" = no ]
[ "$(systemctl show private-ai-web.service -p CPUQuotaPerSecUSec --value)" = infinity ]
[ "$(systemctl show private-ai-web.service -p CPUWeight --value)" = 100 ]
[ "$(systemctl show private-ai-web.service -p MemoryHigh --value)" = infinity ]
[ "$(systemctl show private-ai-web.service -p MemoryMax --value)" = infinity ]
[ "$(systemctl show private-ai-web.service -p TasksMax --value)" = infinity ]
web_pid=$(systemctl show private-ai-web.service -p MainPID --value)
[[ "$web_pid" =~ ^[1-9][0-9]*$ ]]
[ "$(awk '/^Uid:/ { print $2 }' "/proc/$web_pid/status")" = 0 ]
[ "$(readlink -f -- "/proc/$web_pid/exe")" = "$OPENCODE_BIN" ]
mapfile -d '' -t web_argv < "/proc/$web_pid/cmdline"
expected_web_argv=("$OPENCODE_BIN" web --hostname 127.0.0.1 --port 24096)
[ "${#web_argv[@]}" -eq "${#expected_web_argv[@]}" ]
for argv_index in "${!expected_web_argv[@]}"; do
  [ "${web_argv[$argv_index]}" = "${expected_web_argv[$argv_index]}" ]
done
llm_pid=$(systemctl show private-ai-llm.service -p MainPID --value)
[[ "$llm_pid" =~ ^[1-9][0-9]*$ ]]
[ "$(awk '/^Uid:/ { print $2 }' "/proc/$llm_pid/status")" = "$(id -u privateai)" ]
[ "$(readlink -f -- "/proc/$llm_pid/exe")" = "$LLAMA_SERVER" ]
mapfile -d '' -t llm_argv < "/proc/$llm_pid/cmdline"
expected_llm_argv=(
  "$LLAMA_SERVER" -hf "${MODEL_REPO}:${MODEL_QUANT}" --offline
  --alias qwen3.6-35b-a3b-local --host 127.0.0.1 --port 24080
  --ctx-size 32768 --n-predict 8192 --threads 12 --parallel 1 --jinja
  --chat-template-kwargs '{"enable_thinking":false}'
)
[ "${#llm_argv[@]}" -eq "${#expected_llm_argv[@]}" ]
for argv_index in "${!expected_llm_argv[@]}"; do
  [ "${llm_argv[$argv_index]}" = "${expected_llm_argv[$argv_index]}" ]
done
awk -v target="$model_file_path" '$NF == target { found=1 } END { exit !found }' \
  "/proc/$llm_pid/maps" \
  || fail 'running llama-server is not mapped to the pinned Qwen GGUF object'
printf 'OPENCODE_WEB_FULL_HOST_PROBE=uid0\n'
for attempt in $(seq 1 60); do
  if ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24096'; then
    break
  fi
  [ "$attempt" -lt 60 ] || fail 'OpenCode web did not bind its loopback port'
  sleep 2
done
ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24080'
ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24096'
! ss -ltnH | awk '{print $4}' | grep -Eq '(0\.0\.0\.0|\[::\]):(24080|24096)$'
mapfile -t llm_listeners < <(ss -ltnpH | awk '$4 == "127.0.0.1:24080"')
mapfile -t web_listeners < <(ss -ltnpH | awk '$4 == "127.0.0.1:24096"')
[ "${#llm_listeners[@]}" -eq 1 ] && [[ "${llm_listeners[0]}" == *"pid=$llm_pid,"* ]]
[ "${#web_listeners[@]}" -eq 1 ] && [[ "${web_listeners[0]}" == *"pid=$web_pid,"* ]]

mapfile -t opencode_env_lines < "$PRIVATE_AI_CONFIG/opencode.env"
[ "${#opencode_env_lines[@]}" -eq 2 ] || fail 'OpenCode web auth schema is not exact'
[ "$(grep -c '^OPENCODE_SERVER_USERNAME=' "$PRIVATE_AI_CONFIG/opencode.env")" -eq 1 ]
[ "$(grep -c '^OPENCODE_SERVER_PASSWORD=' "$PRIVATE_AI_CONFIG/opencode.env")" -eq 1 ]
OPENCODE_SERVER_USERNAME=$(sed -n 's/^OPENCODE_SERVER_USERNAME=//p' "$PRIVATE_AI_CONFIG/opencode.env")
OPENCODE_SERVER_PASSWORD=$(sed -n 's/^OPENCODE_SERVER_PASSWORD=//p' "$PRIVATE_AI_CONFIG/opencode.env")
[[ "$OPENCODE_SERVER_USERNAME" =~ ^[A-Za-z0-9._-]+$ ]]
[[ "$OPENCODE_SERVER_PASSWORD" =~ ^[A-Fa-f0-9]{48}$ ]]
auth_config=$(mktemp)
printf 'user = "%s:%s"\n' "$OPENCODE_SERVER_USERNAME" "$OPENCODE_SERVER_PASSWORD" > "$auth_config"
chmod 0600 "$auth_config"
web_health_ready=0
for attempt in $(seq 1 30); do
  if curl --config "$auth_config" --fail --silent --show-error --max-time 10 \
      http://127.0.0.1:24096/global/health \
      | jq -e '.healthy == true' >/dev/null; then
    web_health_ready=1
    break
  fi
  sleep 2
done
[ "$web_health_ready" -eq 1 ] || fail 'OpenCode web health did not become ready'
systemctl is-active --quiet private-ai-web.service
[ "$(systemctl show private-ai-web.service -p MainPID --value)" = "$web_pid" ]
[ "$(readlink -f -- "/proc/$web_pid/exe")" = "$OPENCODE_BIN" ]
mapfile -t web_listeners < <(ss -ltnpH | awk '$4 == "127.0.0.1:24096"')
[ "${#web_listeners[@]}" -eq 1 ] && [[ "${web_listeners[0]}" == *"pid=$web_pid,"* ]]
rm -f -- "$auth_config"
auth_config=''
unset OPENCODE_SERVER_PASSWORD

worker_env=/root/kelion/config/codex-worker.env
require_regular "$worker_env" root:root:640
mapfile -t worker_env_lines < "$worker_env"
[ "${#worker_env_lines[@]}" -eq 4 ] || fail 'worker config schema is not exact'
[ "$(grep -c '^CODEX_WORKER_EXEC_ENABLED=' "$worker_env")" -eq 1 ]
[ "$(grep -c '^KELION_CODEX_API=' "$worker_env")" -eq 1 ]
[ "$(grep -c '^KELION_GITHUB_REPOSITORY=' "$worker_env")" -eq 1 ]
[ "$(grep -c '^KELION_CODEX_GATE_IMAGE=' "$worker_env")" -eq 1 ]
CODEX_WORKER_EXEC_ENABLED=$(sed -n 's/^CODEX_WORKER_EXEC_ENABLED=//p' "$worker_env")
KELION_CODEX_API=$(sed -n 's/^KELION_CODEX_API=//p' "$worker_env")
KELION_GITHUB_REPOSITORY=$(sed -n 's/^KELION_GITHUB_REPOSITORY=//p' "$worker_env")
KELION_CODEX_GATE_IMAGE=$(sed -n 's/^KELION_CODEX_GATE_IMAGE=//p' "$worker_env")
[ "$CODEX_WORKER_EXEC_ENABLED" = 1 ] || fail 'worker execution is not enabled'
[ "$KELION_CODEX_API" = http://127.0.0.1:18079 ] || fail 'worker API is not the canonical loopback endpoint'
[[ "$KELION_GITHUB_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]
[[ "$KELION_CODEX_GATE_IMAGE" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+/codex-gates@sha256:[0-9a-f]{64}$ ]]
preflight_output=$(runuser -u kelion-codex -G privateai -G kelion-handoff -- env -i \
  PATH=/opt/private-ai/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/var/lib/kelion-codex \
  XDG_CONFIG_HOME=/srv/private-ai/home/.config \
  XDG_CACHE_HOME=/var/lib/kelion-codex/.cache \
  XDG_DATA_HOME=/var/lib/kelion-codex/.local/share \
  OPENCODE_DISABLE_PROJECT_CONFIG=true \
  OPENCODE_DISABLE_LSP_DOWNLOAD=true \
  CODEX_WORKER_EXEC_ENABLED=1 \
  CODEX_WORKER_EXECUTOR=opencode \
  OPENCODE_BIN=/opt/private-ai/bin/opencode \
  OPENCODE_CONFIG_HOME=/srv/private-ai/home/.config \
  OPENCODE_CONFIG=/srv/private-ai/home/.config/opencode/opencode.json \
  OPENCODE_MODEL=llama.cpp/qwen3.6-35b-a3b-local \
  OPENCODE_BASE_URL=http://127.0.0.1:24080/v1 \
  KELION_CODEX_API="$KELION_CODEX_API" \
  KELION_GITHUB_REPOSITORY="$KELION_GITHUB_REPOSITORY" \
  KELION_CODEX_GATE_IMAGE="$KELION_CODEX_GATE_IMAGE" \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 CI=1 NO_COLOR=1 \
  /usr/bin/node "$WORKER_TARGET" --preflight)
grep -qx 'opencode 1.18.25' <<<"$preflight_output"
grep -qx 'opencode-local-full-access: TRECE' <<<"$preflight_output"

[ "$(runuser -u kelion-codex -- sudo -n /usr/bin/id -u)" = 0 ]
printf 'FULL_HOST_SUDO_PROBE=uid0\n'

mapfile -t codex_api_listeners < <(ss -ltnpH | awk '$4 == "127.0.0.1:18079"')
[ "${#codex_api_listeners[@]}" -eq 1 ] \
  || fail 'Constructor API does not have exactly one canonical loopback listener'

transport_unit="kelion-opencode-transport-${bundle_id:0:12}-$((attempt_count + 1)).service"
transport_status=0
transport_smoke=''
if transport_smoke=$(systemd-run --quiet --wait --pipe \
  --unit="$transport_unit" \
  --property=Type=oneshot \
  --property=User=kelion-codex \
  --property=Group=kelion-codex \
  --property="SupplementaryGroups=kelion-handoff privateai" \
  --property=WorkingDirectory=/var/lib/kelion-codex \
  --property=RuntimeMaxSec=60s \
  --property=TimeoutStopSec=10s \
  --property=LoadCredential=codex-worker-secret:/root/kelion/secrets/codex-worker-secret \
  --setenv=PATH=/opt/private-ai/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv=HOME=/var/lib/kelion-codex \
  --setenv=KELION_CODEX_API="$KELION_CODEX_API" \
  --setenv=LANG=C.UTF-8 --setenv=LC_ALL=C.UTF-8 --setenv=CI=1 --setenv=NO_COLOR=1 \
  /usr/bin/node "$WORKER_TARGET" --transport-smoke </dev/null 2>&1); then
  :
else
  transport_status=$?
  transport_diagnostic=$(printf '%s\n' "$transport_smoke" \
    | tail -c 8192 | LC_ALL=C tr -cd '\11\12\15\40-\176')
  printf 'PRIVATE_AI_TRANSPORT_SMOKE_FAILED status=%s unit=%s diagnostic-begin\n%s\nPRIVATE_AI_TRANSPORT_SMOKE_DIAGNOSTIC_END=yes\n' \
    "$transport_status" "$transport_unit" "$transport_diagnostic" >&2
  systemctl show "$transport_unit" --no-pager \
    -p Result -p ExecMainCode -p ExecMainStatus >&2 || true
  systemctl reset-failed "$transport_unit" >/dev/null 2>&1 || true
  fail "transport smoke failed with status $transport_status"
fi
if ! grep -qx 'OPENCODE_WORKER_TRANSPORT_VERIFIED no_claim=true' <<<"$transport_smoke"; then
  transport_diagnostic=$(printf '%s\n' "$transport_smoke" \
    | tail -c 8192 | LC_ALL=C tr -cd '\11\12\15\40-\176')
  printf 'PRIVATE_AI_TRANSPORT_SMOKE_MARKER_MISMATCH diagnostic-begin\n%s\nPRIVATE_AI_TRANSPORT_SMOKE_DIAGNOSTIC_END=yes\n' \
    "$transport_diagnostic" >&2
  fail 'transport smoke returned without the exact proof marker'
fi
printf '%s\n' "$transport_smoke"
printf 'WORKER_HMAC_HEARTBEAT_E2E=passed\n'
# Executorul rulează din worktree și folosește numai flagurile noninteractive
# documentate pentru OpenCode 1.18.25; self-testul workerului fixează argv-ul.
executor_smoke=$(runuser -u kelion-codex -G privateai -G kelion-handoff -- env -i \
  PATH=/opt/private-ai/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/var/lib/kelion-codex \
  XDG_CONFIG_HOME=/srv/private-ai/home/.config \
  XDG_CACHE_HOME=/var/lib/kelion-codex/.cache \
  XDG_DATA_HOME=/var/lib/kelion-codex/.local/share \
  OPENCODE_DISABLE_PROJECT_CONFIG=true \
  OPENCODE_DISABLE_LSP_DOWNLOAD=true \
  CODEX_WORKER_EXEC_ENABLED=1 \
  CODEX_WORKER_EXECUTOR=opencode \
  OPENCODE_BIN=/opt/private-ai/bin/opencode \
  OPENCODE_CONFIG_HOME=/srv/private-ai/home/.config \
  OPENCODE_CONFIG=/srv/private-ai/home/.config/opencode/opencode.json \
  OPENCODE_MODEL=llama.cpp/qwen3.6-35b-a3b-local \
  OPENCODE_BASE_URL=http://127.0.0.1:24080/v1 \
  KELION_CODEX_API="$KELION_CODEX_API" \
  KELION_GITHUB_REPOSITORY="$KELION_GITHUB_REPOSITORY" \
  KELION_CODEX_GATE_IMAGE="$KELION_CODEX_GATE_IMAGE" \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 CI=1 NO_COLOR=1 \
  /usr/bin/node "$WORKER_TARGET" --executor-smoke)
grep -qx 'OPENCODE_EXECUTOR_GIT_VERIFIED status=porcelain-v1' <<<"$executor_smoke"
grep -Eq '^OPENCODE_EXECUTOR_SMOKE_VERIFIED sha256=[0-9a-f]{64}$' <<<"$executor_smoke"
printf '%s\n' "$executor_smoke"
printf 'OPENCODE_EXECUTOR_E2E=passed\n'



require_regular /etc/kelion/codex-worker.enabled root:root:444
[ ! -e /run/kelion/constructor-activation.pending ] \
  && [ ! -L /run/kelion/constructor-activation.pending ] \
  || fail 'Constructor activation barrier is pending'
publish_finalizer_runtime_ready_stamp
printf 'CONSTRUCTOR_RUNTIME_READY_PUBLISHED=yes\n'
require_regular "$RUNTIME_READY_STAMP" root:root:444
[ "$(tr -d '\n' < "$RUNTIME_READY_STAMP")" = schema=1 ]

systemctl reset-failed kelion-constructor-model-control.service >/dev/null 2>&1 || true
systemctl restart kelion-constructor-model-control.service
systemctl is-active --quiet kelion-constructor-model-control.service
for _ in $(seq 1 40); do
  if [ -S "$MODEL_CONTROL_SOCKET" ] && [ ! -L "$MODEL_CONTROL_SOCKET" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$MODEL_CONTROL_SOCKET")" = '0:10050:660' ]; then
    break
  fi
  sleep 0.25
done
[ -S "$MODEL_CONTROL_SOCKET" ] && [ ! -L "$MODEL_CONTROL_SOCKET" ] \
  && [ "$(stat -Lc '%u:%g:%a' "$MODEL_CONTROL_SOCKET")" = '0:10050:660' ] \
  || fail 'manual model controller socket did not become ready'
printf 'MODEL_CONTROL_E2E=passed\n'

systemctl enable --now \
  kelion-codex-worker.timer \
  kelion-constructor-publisher.timer \
  kelion-constructor-release.timer >/dev/null
[ "$(unit_state kelion-codex-worker.timer)" = enabled:active ] \
  || fail 'worker timer is not enabled and active under the reactivation intent'
[ "$(unit_state kelion-constructor-publisher.timer)" = enabled:active ] \
  || fail 'publisher timer is not enabled and active after gate recovery'
[ "$(unit_state kelion-constructor-release.timer)" = enabled:active ] \
  || fail 'release timer is not enabled and active after gate recovery'

# Controllerul și toate timerele sunt acum dovedite, iar serviciile cu side
# effects au rămas Condition-skipped cât markerul a existat. Clear-ul durabil
# este ultimul commit operațional; timerul worker oferă retry chiar dacă hostul
# cade înaintea probei one-shot de mai jos.
clear_finalizer_reactivation_intent \
  || fail 'finalizer reactivation intent could not be cleared after control-plane proof'
old_claim_invocation=$(systemctl show kelion-codex-worker.service -p InvocationID --value 2>/dev/null || true)
[ -z "$old_claim_invocation" ] || [[ "$old_claim_invocation" =~ ^[0-9a-f]{32}$ ]] \
  || fail 'worker exposed an invalid previous invocation id'
systemctl reset-failed kelion-codex-worker.service kelion-constructor-sync.service >/dev/null 2>&1 || true
claim_cursor=$(journalctl --no-pager --lines=0 --show-cursor \
  | sed -n 's/^-- cursor: //p')
[ -n "$claim_cursor" ] || fail 'journald did not provide a queue-proof cursor'
systemctl start --no-block kelion-codex-worker.service
claim_proof=''
claim_invocation=''
for _ in $(seq 1 420); do
  current_claim_invocation=$(systemctl show kelion-codex-worker.service -p InvocationID --value 2>/dev/null || true)
  if [[ "$current_claim_invocation" =~ ^[0-9a-f]{32}$ ]] \
    && [ "$current_claim_invocation" != "$old_claim_invocation" ]; then
    claim_invocation=$current_claim_invocation
    claim_proof=$(journalctl --no-pager --quiet --output=cat \
      --unit=kelion-codex-worker.service "_SYSTEMD_INVOCATION_ID=$claim_invocation" \
      | grep -E '^OPENCODE_WORKER_CLAIM_VERIFIED state=(no_claimable_job|pipeline_active|claimed)$' \
      | tail -n 1 || true)
    [ -z "$claim_proof" ] || break
  fi
  sync_active=$(systemctl show kelion-constructor-sync.service -p ActiveState --value 2>/dev/null || true)
  sync_result=$(systemctl show kelion-constructor-sync.service -p Result --value 2>/dev/null || true)
  if [ "$sync_active" = failed ] || [[ "$sync_result" =~ ^(exit-code|signal|timeout|watchdog|resources|protocol)$ ]]; then
    break
  fi
  sleep 1
done
if [ -z "$claim_proof" ]; then
  claim_unit_state=$(systemctl show kelion-codex-worker.service --no-pager \
    -p ActiveState -p SubState -p Result -p ExecMainCode -p ExecMainStatus \
    -p InvocationID -p ConditionResult -p AssertResult 2>&1 || true)
  sync_unit_state=$(systemctl show kelion-constructor-sync.service --no-pager \
    -p ActiveState -p SubState -p Result -p ExecMainCode -p ExecMainStatus \
    -p InvocationID -p ConditionResult -p AssertResult 2>&1 || true)
  if [[ "$claim_invocation" =~ ^[0-9a-f]{32}$ ]]; then
    claim_diagnostic=$(journalctl --no-pager --quiet --output=short-iso \
      --unit=kelion-codex-worker.service "_SYSTEMD_INVOCATION_ID=$claim_invocation" \
      --lines=200 2>&1 || true)
  else
    claim_diagnostic=$(journalctl --no-pager --quiet --output=short-iso \
      --unit=kelion-codex-worker.service --after-cursor="$claim_cursor" \
      --lines=200 2>&1 || true)
  fi
  sync_invocation=$(systemctl show kelion-constructor-sync.service -p InvocationID --value 2>/dev/null || true)
  if [[ "$sync_invocation" =~ ^[0-9a-f]{32}$ ]]; then
    sync_diagnostic=$(journalctl --no-pager --quiet --output=short-iso \
      --unit=kelion-constructor-sync.service "_SYSTEMD_INVOCATION_ID=$sync_invocation" \
      --lines=200 2>&1 || true)
  else
    sync_diagnostic=$(journalctl --no-pager --quiet --output=short-iso \
      --unit=kelion-constructor-sync.service --after-cursor="$claim_cursor" \
      --lines=200 2>&1 || true)
  fi
  claim_diagnostic=$(printf '%s\n' "$claim_diagnostic" \
    | tail -c 16384 | LC_ALL=C tr -cd '\11\12\15\40-\176')
  sync_diagnostic=$(printf '%s\n' "$sync_diagnostic" \
    | tail -c 16384 | LC_ALL=C tr -cd '\11\12\15\40-\176')
  printf 'PRIVATE_AI_WORKER_CLAIM_FAILED worker-state-begin\n%s\nPRIVATE_AI_WORKER_CLAIM_STATE_END=yes worker-diagnostic-begin\n%s\nPRIVATE_AI_WORKER_CLAIM_DIAGNOSTIC_END=yes sync-state-begin\n%s\nPRIVATE_AI_SYNC_STATE_END=yes sync-diagnostic-begin\n%s\nPRIVATE_AI_SYNC_DIAGNOSTIC_END=yes\n' \
    "$claim_unit_state" "$claim_diagnostic" "$sync_unit_state" "$sync_diagnostic" >&2
  fail 'the exact real worker invocation produced no validated queue claim marker'
fi
sync_invocation=$(systemctl show kelion-constructor-sync.service -p InvocationID --value)
[[ "$sync_invocation" =~ ^[0-9a-f]{32}$ ]] || fail 'sync service has no valid invocation id'
[ "$(systemctl show kelion-constructor-sync.service -p Result --value)" = success ]
[ "$(systemctl show kelion-constructor-sync.service -p ExecMainStatus --value)" = 0 ]
journalctl --no-pager --quiet --output=cat \
  --unit=kelion-constructor-sync.service "_SYSTEMD_INVOCATION_ID=$sync_invocation" \
  | grep -Fqx 'clona privată a workerului este sincronizată'
printf 'SYNC_SERVICE_E2E=passed\n'
printf 'WORKER_CLAIM_INVOCATION_ID=%s\n' "$claim_invocation"
printf '%s\n' "$claim_proof"
printf 'WORKER_CLAIM_E2E=passed\n'
systemctl enable --now kelion-codex-worker.timer >/dev/null
[ "$(unit_state kelion-codex-worker.timer)" = enabled:active ] \
  || fail 'worker timer is not enabled and active after the exact claim proof'

worker_active=$(systemctl is-active kelion-codex-worker.service 2>/dev/null || true)
worker_result=$(systemctl show kelion-codex-worker.service -p Result --value)
worker_exit=$(systemctl show kelion-codex-worker.service -p ExecMainStatus --value)
case "$worker_active:$worker_result:$worker_exit" in
  active:success:0|activating:success:0|inactive:success:0) ;;
  *) fail "worker queue/heartbeat probe failed: $worker_active:$worker_result:$worker_exit" ;;
esac

systemctl is-enabled --quiet kelion-codex-worker.timer
systemctl is-active --quiet kelion-codex-worker.timer

worker_sha=$(sha256sum "$WORKER_TARGET" | awk '{print $1}')
sync_worker_sha=$(sha256sum "$SYNC_WORKER_TARGET" | awk '{print $1}')
[ "$sync_worker_sha" = "$(sha256sum "$SYNC_WORKER_SOURCE" | awk '{print $1}')" ]
sync_unit_sha=$(sha256sum "$SYNC_UNIT_TARGET" | awk '{print $1}')
[ "$sync_unit_sha" = "$(sha256sum "$SYNC_UNIT_SOURCE" | awk '{print $1}')" ]
worker_unit_sha=$(sha256sum "$WORKER_UNIT_TARGET" | awk '{print $1}')
model_control_sha=$(sha256sum "$MODEL_CONTROL_TARGET" | awk '{print $1}')
model_switch_sha=$(sha256sum "$MODEL_SWITCH_TARGET" | awk '{print $1}')
service_auth_sha=$(sha256sum "$SERVICE_AUTH_TARGET" | awk '{print $1}')
model_control_unit_sha=$(sha256sum "$MODEL_CONTROL_UNIT_TARGET" | awk '{print $1}')
sudoers_sha=$(sha256sum "$SUDOERS" | awk '{print $1}')
config_sha=$(sha256sum "$OPENCODE_CONFIG" | awk '{print $1}')
instructions_sha=$(sha256sum "$OPENCODE_INSTRUCTIONS" | awk '{print $1}')
web_dropin_sha=$(sha256sum "$WEB_DROPIN" | awk '{print $1}')
[ "$(sha256sum "$LLAMA_SERVER" | awk '{print $1}')" = "$llama_server_sha" ]
[ "$(sha256sum "$OPENCODE_BIN" | awk '{print $1}')" = "$opencode_bin_sha" ]
[ "$(stat -Lc '%s' "$model_file_path")" = "$MODEL_FILE_BYTES" ]
[ "$(sha256sum "$model_file_path" | awk '{print $1}')" = "$MODEL_FILE_SHA256" ]
receipt_candidate=$(mktemp "$PRIVATE_AI_CONFIG/.constructor-finalized.XXXXXX")
printf '%s\n' \
  'schema=3' \
  'executor=opencode' \
  'opencode_version=1.18.25' \
  'model=llama.cpp/qwen3.6-35b-a3b-local' \
  "llama_cpp_ref=$LLAMA_CPP_REF" \
  "llama_server_sha256=$llama_server_sha" \
  "opencode_bin_sha256=$opencode_bin_sha" \
  "model_repo=$MODEL_REPO" \
  "model_revision=$MODEL_REVISION" \
  "model_quant=$MODEL_QUANT" \
  "model_file=$MODEL_FILE" \
  "model_file_bytes=$MODEL_FILE_BYTES" \
  "model_file_sha256=$MODEL_FILE_SHA256" \
  "worker_sha256=$worker_sha" \
  "worker_unit_sha256=$worker_unit_sha" \
  "sudoers_sha256=$sudoers_sha" \
  "config_sha256=$config_sha" \
  "instructions_sha256=$instructions_sha" \
  "web_dropin_sha256=$web_dropin_sha" \
  "verified_at=$(date -u +%FT%TZ)" \
  'base_verified=yes' \
  'executor_e2e=passed' \
  'hmac_heartbeat_e2e=passed' \
  "claim_e2e=${claim_proof#OPENCODE_WORKER_CLAIM_VERIFIED state=}" \
  'full_host_sudo_probe=uid0' \
  'web_full_host_probe=uid0' \
  'queue_worker_started=yes' \
  'web_loopback_only=yes' \
  > "$receipt_candidate"
chown root:root "$receipt_candidate"
chmod 0600 "$receipt_candidate"
sync -f "$receipt_candidate"
mv -f -- "$receipt_candidate" "$FINAL_RECEIPT"
receipt_candidate=''
sync -f "$PRIVATE_AI_CONFIG"
final_receipt_sha=$(sha256sum "$FINAL_RECEIPT" | awk '{print $1}')

systemctl enable kelion-runtime-config-recovery.service >/dev/null
systemctl reset-failed kelion-runtime-config-recovery.service >/dev/null 2>&1 || true
case "$(unit_state kelion-runtime-config-recovery.service)" in
  enabled:active|enabled:inactive) ;;
  *) fail 'runtime recovery service was not restored after final receipt commit' ;;
esac

rollback_armed=0
trap - ERR HUP INT TERM EXIT
rm -rf --one-file-system -- "$rollback_root"
rm -f -- "$attempt_file"
sync -f "$attempt_root"
printf 'WORKER_INSTALLED_SHA256=%s\n' "$worker_sha"
printf 'SYNC_WORKER_INSTALLED_SHA256=%s\n' "$sync_worker_sha"
printf 'SYNC_UNIT_INSTALLED_SHA256=%s\n' "$sync_unit_sha"
printf 'WORKER_UNIT_INSTALLED_SHA256=%s\n' "$worker_unit_sha"
printf 'MODEL_CONTROL_INSTALLED_SHA256=%s\n' "$model_control_sha"
printf 'MODEL_SWITCH_INSTALLED_SHA256=%s\n' "$model_switch_sha"
printf 'SERVICE_AUTH_INSTALLED_SHA256=%s\n' "$service_auth_sha"
printf 'MODEL_CONTROL_UNIT_INSTALLED_SHA256=%s\n' "$model_control_unit_sha"
printf 'WORKER_SUDOERS_INSTALLED_SHA256=%s\n' "$sudoers_sha"
printf 'OPENCODE_CONFIG_SHA256=%s\n' "$config_sha"
printf 'OPENCODE_INSTRUCTIONS_SHA256=%s\n' "$instructions_sha"
printf 'OPENCODE_WEB_DROPIN_SHA256=%s\n' "$web_dropin_sha"
printf 'LLAMA_CPP_REF=%s\n' "$LLAMA_CPP_REF"
printf 'LLAMA_SERVER_SHA256=%s\n' "$llama_server_sha"
printf 'OPENCODE_BIN_SHA256=%s\n' "$opencode_bin_sha"
printf 'MODEL_REVISION=%s\n' "$MODEL_REVISION"
printf 'MODEL_FILE=%s\n' "$MODEL_FILE"
printf 'MODEL_FILE_BYTES=%s\n' "$MODEL_FILE_BYTES"
printf 'MODEL_FILE_SHA256=%s\n' "$MODEL_FILE_SHA256"
printf 'FINAL_RECEIPT_SHA256=%s\n' "$final_receipt_sha"
printf 'WORKER_QUEUE_STATE=%s RESULT=%s EXIT=%s\n' "$worker_active" "$worker_result" "$worker_exit"
printf 'PUBLISHER_TIMER_PRESERVED=%s\n' "$PUBLISHER_TIMER_STATE"
printf 'RELEASE_TIMER_PRESERVED=%s\n' "$RELEASE_TIMER_STATE"
printf 'LEGACY_CODEX_COMPAT_REMOVED=yes\n'
printf 'PRIVATE_AI_DUAL_ACCESS_VERIFIED=yes\n'
printf 'PRIVATE_AI_CONSTRUCTOR_FINALIZED=yes\n'
