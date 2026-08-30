#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly BUNDLE_ROOT=${1:?bundle root required}
readonly WORKER_SOURCE="$BUNDLE_ROOT/deploy/codex-worker.mjs"
readonly WORKER_TARGET=/opt/kelion-codex/codex-worker.mjs
readonly WORKER_UNIT_SOURCE="$BUNDLE_ROOT/deploy/systemd/kelion-codex-worker.service"
readonly WORKER_UNIT_TARGET=/etc/systemd/system/kelion-codex-worker.service
readonly SUDOERS_SOURCE="$BUNDLE_ROOT/deploy/sudoers/kelion-codex-full-access"
readonly PRIVATE_AI_ROOT=/srv/private-ai
readonly PRIVATE_AI_HOME=$PRIVATE_AI_ROOT/home
readonly PRIVATE_AI_CONFIG=/etc/private-ai
readonly OPENCODE_CONFIG=$PRIVATE_AI_HOME/.config/opencode/opencode.json
readonly OPENCODE_INSTRUCTIONS=$PRIVATE_AI_HOME/.config/opencode/instructions.md
readonly OPENCODE_BIN=/opt/private-ai/bin/opencode
readonly WORKER_DROPIN_DIR=/etc/systemd/system/kelion-codex-worker.service.d
readonly WORKER_DROPIN=$WORKER_DROPIN_DIR/90-local-opencode-full-access.conf
readonly LEGACY_WORKER_DROPIN=$WORKER_DROPIN_DIR/90-local-qwen-full-access.conf
readonly LEGACY_CODEX_REAL=/opt/kelion-codex/bin/codex-real
readonly LEGACY_OPENCODE_WRAPPER=/opt/private-ai/bin/opencode-constructor-root
readonly LEGACY_COMPAT_KEY=/etc/private-ai/local-codex-compat-key
readonly LEGACY_SUDOERS=/etc/sudoers.d/kelion-local-qwen-constructor
readonly CANONICAL_CODEX=/opt/kelion-codex/bin/codex
readonly WEB_DROPIN_DIR=/etc/systemd/system/private-ai-web.service.d
readonly WEB_DROPIN=$WEB_DROPIN_DIR/90-kelion-constructor-full-access.conf
readonly SUDOERS=/etc/sudoers.d/kelion-constructor-full-access
readonly FINAL_RECEIPT=$PRIVATE_AI_CONFIG/.constructor-finalized
readonly RUNTIME_ROOT=/root/kelion/runtime
readonly PUBLICATION_LOCK=/root/kelion/publicare.lock

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
  local unit=$1 state=$2 enabled=${state%%:*} active=${state#*:}
  case "$enabled" in
    enabled|enabled-runtime) systemctl enable "$unit" >/dev/null 2>&1 || true ;;
    *) systemctl disable "$unit" >/dev/null 2>&1 || true ;;
  esac
  case "$active" in
    active|activating) systemctl start "$unit" >/dev/null 2>&1 || true ;;
    *) systemctl stop "$unit" >/dev/null 2>&1 || true ;;
  esac
}

[ "$(id -u)" -eq 0 ] || fail 'root is required'
[ -d "$BUNDLE_ROOT" ] && [ ! -L "$BUNDLE_ROOT" ] || fail 'invalid bundle root'
[ -f "$WORKER_SOURCE" ] && [ ! -L "$WORKER_SOURCE" ] || fail 'worker source missing'
[ -f "$WORKER_UNIT_SOURCE" ] && [ ! -L "$WORKER_UNIT_SOURCE" ] || fail 'worker unit source missing'
[ -f "$SUDOERS_SOURCE" ] && [ ! -L "$SUDOERS_SOURCE" ] || fail 'worker sudoers source missing'
node --check "$WORKER_SOURCE"
grep -q 'OPENCODE_BIN' "$WORKER_SOURCE" || fail 'worker has no direct OpenCode executor'
! grep -q 'KELION_LOCAL_QWEN_WRAPPER' "$WORKER_SOURCE" || fail 'fake Codex wrapper found in worker source'
grep -qx 'kelion-codex ALL=(ALL:ALL) NOPASSWD: ALL' "$SUDOERS_SOURCE"
[ "$(wc -l < "$SUDOERS_SOURCE")" -eq 1 ] || fail 'sudoers source is not exact'
grep -Fqx 'ExecStart=/usr/bin/node /opt/kelion-codex/codex-worker.mjs --once' "$WORKER_UNIT_SOURCE"
grep -Fqx 'LoadCredential=codex-worker-secret:/root/kelion/secrets/codex-worker-secret' "$WORKER_UNIT_SOURCE"
! grep -Eq 'CODEX_BIN=|CODEX_HOME=|openai-project-key|codex-real|opencode-constructor-root' \
  "$WORKER_UNIT_SOURCE" || fail 'worker unit source still references the retired Codex adapter'

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
require_regular "$OPENCODE_CONFIG" root:privateai:640
require_regular "$PRIVATE_AI_CONFIG/opencode.env" root:privateai:640
systemctl is-active --quiet private-ai-llm.service
systemctl is-active --quiet private-ai-web.service
curl --fail --silent --show-error --max-time 10 http://127.0.0.1:24080/health >/dev/null
[ "$($OPENCODE_BIN --version)" = 1.18.25 ] || fail 'unexpected OpenCode version'
jq -e '
  .model == "llama.cpp/qwen3.6-35b-a3b-local" and
  .provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1" and
  .provider["llama.cpp"].models["qwen3.6-35b-a3b-local"].name != null
' "$OPENCODE_CONFIG" >/dev/null
printf 'PRIVATE_AI_BASE_VERIFIED=yes\n'

install -d -o root -g root -m 0700 "$RUNTIME_ROOT"
if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
  [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
    || fail 'unsafe publication lock'
fi
exec 9<>"$PUBLICATION_LOCK"
chown root:root /proc/$$/fd/9
chmod 0600 /proc/$$/fd/9
flock -n 9 || fail 'constructor/release publication is active'

readonly WORKER_TIMER_STATE=$(unit_state kelion-codex-worker.timer)
readonly WEB_STATE=$(unit_state private-ai-web.service)
readonly PUBLISHER_TIMER_STATE=$(unit_state kelion-constructor-publisher.timer)
readonly RELEASE_TIMER_STATE=$(unit_state kelion-constructor-release.timer)
rollback_root=$(mktemp -d "$RUNTIME_ROOT/private-ai-finalize.XXXXXX")
chmod 0700 "$rollback_root"
rollback_armed=0
worker_cutover_started=0
web_cutover_started=0
canonical_codex_fake=0
worker_candidate=''
unit_candidate=''
sudoers_candidate=''
canonical_codex_candidate=''
config_candidate=''
worker_dropin_candidate=''
web_dropin_candidate=''
instructions_candidate=''
auth_config=''
receipt_candidate=''

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
  local key=$1 target=$2
  if [ -f "$rollback_root/$key.absent" ]; then
    rm -f -- "$target"
  else
    install -D --preserve-timestamps -- "$rollback_root/$key" "$target"
    chown --reference="$rollback_root/$key" "$target"
    chmod --reference="$rollback_root/$key" "$target"
  fi
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

restore_legacy_path() {
  local key=$1 target=$2
  rm -f -- "$target"
  if [ ! -f "$rollback_root/$key.absent" ]; then
    cp -a --no-dereference -- "$rollback_root/$key" "$target"
  fi
}

rollback() {
  local status=$?
  trap - ERR INT TERM EXIT
  for temporary in \
    "$worker_candidate" "$unit_candidate" "$sudoers_candidate" \
    "$canonical_codex_candidate" "$config_candidate" "$auth_config" \
    "$worker_dropin_candidate" "$web_dropin_candidate" "$instructions_candidate" \
    "$receipt_candidate"; do
    [ -z "$temporary" ] || rm -f -- "$temporary" >/dev/null 2>&1 || true
  done
  if [ "$rollback_armed" -eq 1 ]; then
    if [ "$worker_cutover_started" -eq 1 ]; then
      systemctl stop kelion-codex-worker.service >/dev/null 2>&1 || true
    fi
    if [ "$web_cutover_started" -eq 1 ]; then
      systemctl stop private-ai-web.service >/dev/null 2>&1 || true
    fi
    restore_file worker "$WORKER_TARGET" || true
    restore_file worker_unit "$WORKER_UNIT_TARGET" || true
    restore_file config "$OPENCODE_CONFIG" || true
    restore_file instructions "$OPENCODE_INSTRUCTIONS" || true
    restore_file worker_dropin "$WORKER_DROPIN" || true
    restore_file legacy_worker_dropin "$LEGACY_WORKER_DROPIN" || true
    restore_file web_dropin "$WEB_DROPIN" || true
    restore_file sudoers "$SUDOERS" || true
    restore_file receipt "$FINAL_RECEIPT" || true
    restore_legacy_path legacy_codex_real "$LEGACY_CODEX_REAL" || true
    restore_legacy_path legacy_opencode_wrapper "$LEGACY_OPENCODE_WRAPPER" || true
    restore_legacy_path legacy_compat_key "$LEGACY_COMPAT_KEY" || true
    restore_legacy_path legacy_sudoers "$LEGACY_SUDOERS" || true
    if [ "$canonical_codex_fake" -eq 1 ]; then
      restore_legacy_path canonical_codex "$CANONICAL_CODEX" || true
    fi
    systemctl daemon-reload >/dev/null 2>&1 || true
    restore_unit_state private-ai-web.service "$WEB_STATE"
    restore_unit_state kelion-codex-worker.timer "$WORKER_TIMER_STATE"
  fi
  printf 'PRIVATE_AI_FINALIZE_ROLLED_BACK=yes EXIT=%s\n' "$status" >&2
  exit "$status"
}
trap rollback ERR INT TERM

snapshot_file worker "$WORKER_TARGET"
snapshot_file worker_unit "$WORKER_UNIT_TARGET"
snapshot_file config "$OPENCODE_CONFIG"
snapshot_file instructions "$OPENCODE_INSTRUCTIONS"
snapshot_file worker_dropin "$WORKER_DROPIN"
snapshot_file legacy_worker_dropin "$LEGACY_WORKER_DROPIN"
snapshot_file web_dropin "$WEB_DROPIN"
snapshot_file sudoers "$SUDOERS"
snapshot_file receipt "$FINAL_RECEIPT"
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

systemctl stop kelion-codex-worker.timer
worker_before=$(systemctl is-active kelion-codex-worker.service 2>/dev/null || true)
case "$worker_before" in
  inactive|failed) ;;
  *) fail "worker is not quiescent; retry after the current queue turn: $worker_before" ;;
esac
worker_cutover_started=1
systemctl stop kelion-codex-worker.service
web_cutover_started=1
systemctl stop private-ai-web.service

export DEBIAN_FRONTEND=noninteractive
if ! command -v sudo >/dev/null 2>&1 || ! command -v visudo >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y --no-install-recommends sudo >/dev/null
fi

worker_candidate=$(mktemp "$WORKER_TARGET.candidate.XXXXXX")
install -o root -g root -m 0555 "$WORKER_SOURCE" "$worker_candidate"
node --check "$worker_candidate"
mv -f -- "$worker_candidate" "$WORKER_TARGET"
sync -f "$WORKER_TARGET"
sync -f "$(dirname "$WORKER_TARGET")"

unit_candidate=$(mktemp "$WORKER_UNIT_TARGET.candidate.XXXXXX")
install -o root -g root -m 0444 "$WORKER_UNIT_SOURCE" "$unit_candidate"
mv -f -- "$unit_candidate" "$WORKER_UNIT_TARGET"
sync -f "$WORKER_UNIT_TARGET"

install -d -o root -g root -m 0755 "$WORKER_DROPIN_DIR" "$WEB_DROPIN_DIR"
worker_dropin_candidate=$(mktemp "$WORKER_DROPIN.candidate.XXXXXX")
cat > "$worker_dropin_candidate" <<'UNIT'
[Service]
Environment=CODEX_WORKER_EXECUTOR=opencode
Environment=OPENCODE_BIN=/opt/private-ai/bin/opencode
Environment=OPENCODE_CONFIG_HOME=/srv/private-ai/home/.config
Environment=OPENCODE_CONFIG=/srv/private-ai/home/.config/opencode/opencode.json
Environment=OPENCODE_MODEL=llama.cpp/qwen3.6-35b-a3b-local
Environment=OPENCODE_BASE_URL=http://127.0.0.1:24080/v1
LoadCredential=
LoadCredential=codex-worker-secret:/root/kelion/secrets/codex-worker-secret
SupplementaryGroups=
SupplementaryGroups=kelion-handoff privateai
NoNewPrivileges=false
PrivateIPC=false
PrivateDevices=false
PrivateTmp=false
ProtectClock=false
ProtectControlGroups=false
ProtectHome=false
ProtectHostname=false
ProtectKernelLogs=false
ProtectKernelModules=false
ProtectKernelTunables=false
ProtectProc=default
ProcSubset=all
ProtectSystem=false
RestrictAddressFamilies=
RestrictNamespaces=false
RestrictRealtime=false
RestrictSUIDSGID=false
LockPersonality=false
CapabilityBoundingSet=~
ReadWritePaths=
MemoryMax=infinity
TasksMax=infinity
UNIT
chown root:root "$worker_dropin_candidate"
chmod 0644 "$worker_dropin_candidate"
mv -f -- "$worker_dropin_candidate" "$WORKER_DROPIN"
worker_dropin_candidate=''
sync -f "$WORKER_DROPIN"
rm -f -- "$LEGACY_WORKER_DROPIN"

web_dropin_candidate=$(mktemp "$WEB_DROPIN.candidate.XXXXXX")
cat > "$web_dropin_candidate" <<'UNIT'
[Service]
User=root
Group=root
WorkingDirectory=/srv/private-ai/workspace
NoNewPrivileges=false
PrivateIPC=false
PrivateDevices=false
PrivateTmp=false
ProtectClock=false
ProtectControlGroups=false
ProtectHome=false
ProtectHostname=false
ProtectKernelLogs=false
ProtectKernelModules=false
ProtectKernelTunables=false
ProtectProc=default
ProcSubset=all
ProtectSystem=false
RestrictAddressFamilies=
RestrictNamespaces=false
RestrictRealtime=false
RestrictSUIDSGID=false
LockPersonality=false
CapabilityBoundingSet=~
ReadWritePaths=
InaccessiblePaths=
IPAddressDeny=
IPAddressAllow=
CPUQuota=infinity
CPUWeight=100
MemoryHigh=infinity
MemoryMax=infinity
TasksMax=infinity
UNIT
chown root:root "$web_dropin_candidate"
chmod 0644 "$web_dropin_candidate"
mv -f -- "$web_dropin_candidate" "$WEB_DROPIN"
web_dropin_candidate=''
sync -f "$WEB_DROPIN"

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
  "$LEGACY_WORKER_DROPIN"; do
  [ ! -e "$retired_artifact" ] && [ ! -L "$retired_artifact" ] \
    || fail "retired Codex adapter remains: $retired_artifact"
done
if [ -e "$CANONICAL_CODEX" ] || [ -L "$CANONICAL_CODEX" ]; then
  [ -f "$CANONICAL_CODEX" ] && [ ! -L "$CANONICAL_CODEX" ] \
    || fail 'canonical Codex path is unsafe'
  ! grep -aEq 'KELION_LOCAL_QWEN_WRAPPER|local-qwen-compat|opencode-constructor-root' \
    "$CANONICAL_CODEX" || fail 'fake canonical Codex wrapper remains'
fi

chown privateai:privateai "$PRIVATE_AI_HOME"
chmod 0750 "$PRIVATE_AI_HOME"
chown root:privateai "$PRIVATE_AI_HOME/.config" "$PRIVATE_AI_HOME/.config/opencode"
chmod 0750 "$PRIVATE_AI_HOME/.config" "$PRIVATE_AI_HOME/.config/opencode"
install -d -o kelion-codex -g kelion-codex -m 0700 \
  /var/lib/kelion-codex/.cache /var/lib/kelion-codex/.local /var/lib/kelion-codex/.local/share

instructions_candidate=$(mktemp "$OPENCODE_INSTRUCTIONS.candidate.XXXXXX")
cat > "$instructions_candidate" <<'INSTRUCTIONS'
You are Adrian's Kelion Constructor, powered only by the local Qwen model through llama.cpp.
You are the same Constructor used by the Kelion admin chat queue and by the separate laptop application.
You have Adrian's requested full host access. Use passwordless sudo when an explicit task needs root access to the Kelion repository, VPS runtime, services, containers, production files, or configured credentials.
For queue work, edit the current worktree and leave publication to the existing immutable handoff, offline gates, publisher, protected PR, and release pipeline.
Never use a paid or external AI provider. Never expose secret values in chat, files, commits, or logs.
Never claim completion without measured evidence from the real target.
Reply in Romanian unless Adrian asks otherwise.
INSTRUCTIONS
chown root:privateai "$instructions_candidate"
chmod 0640 "$instructions_candidate"
mv -f -- "$instructions_candidate" "$OPENCODE_INSTRUCTIONS"
instructions_candidate=''
sync -f "$OPENCODE_INSTRUCTIONS"

config_candidate=$(mktemp "$OPENCODE_CONFIG.candidate.XXXXXX")
jq '
  .autoupdate = false
  | .model = "llama.cpp/qwen3.6-35b-a3b-local"
  | .small_model = "llama.cpp/qwen3.6-35b-a3b-local"
  | .enabled_providers = ["llama.cpp"]
  | .provider = {"llama.cpp": .provider["llama.cpp"]}
  | del(.provider["llama.cpp"].options.apiKey)
  | .share = "disabled"
  | .permission = {
      "*":"allow", "read":"allow", "glob":"allow", "grep":"allow",
      "edit":"allow", "bash":"allow", "task":"allow", "skill":"allow",
      "webfetch":"allow", "websearch":"allow", "external_directory":"allow"
    }
  | .instructions = ["instructions.md"]
  | .server = {"hostname":"127.0.0.1","port":24096,"mdns":false}
' "$OPENCODE_CONFIG" > "$config_candidate"
mv -f -- "$config_candidate" "$OPENCODE_CONFIG"
config_candidate=''
chown root:privateai "$OPENCODE_CONFIG" "$OPENCODE_INSTRUCTIONS"
chmod 0640 "$OPENCODE_CONFIG" "$OPENCODE_INSTRUCTIONS"

jq -e '
  .autoupdate == false and .share == "disabled" and
  .enabled_providers == ["llama.cpp"] and
  (.provider | keys) == ["llama.cpp"] and
  .model == "llama.cpp/qwen3.6-35b-a3b-local" and
  .provider["llama.cpp"].npm == "@ai-sdk/openai-compatible" and
  .provider["llama.cpp"].options.baseURL == "http://127.0.0.1:24080/v1" and
  (.provider["llama.cpp"].options | has("apiKey") | not) and
  .permission["*"] == "allow" and .permission.external_directory == "allow" and
  .server.hostname == "127.0.0.1" and .server.port == 24096 and .server.mdns == false
' "$OPENCODE_CONFIG" >/dev/null

systemctl daemon-reload
systemd-analyze verify private-ai-web.service kelion-codex-worker.service >/dev/null
systemctl cat kelion-codex-worker.service > "$rollback_root/effective-worker.unit"
grep -Fq 'ExecStart=/usr/bin/node /opt/kelion-codex/codex-worker.mjs --once' \
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
effective_groups=" $(systemctl show kelion-codex-worker.service -p SupplementaryGroups --value) "
[[ "$effective_groups" == *' kelion-handoff '* ]]
[[ "$effective_groups" == *' privateai '* ]]
systemctl restart private-ai-web.service
systemctl is-active --quiet private-ai-web.service
systemctl is-active --quiet private-ai-llm.service
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
curl --config "$auth_config" --fail --silent --show-error --max-time 10 \
  http://127.0.0.1:24096/global/health | jq -e '.healthy == true' >/dev/null
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

transport_unit="kelion-opencode-transport-smoke-$$.service"
transport_smoke=$(systemd-run --quiet --wait --pipe --collect \
  --unit="$transport_unit" \
  --property=Type=oneshot \
  --property=User=kelion-codex \
  --property=Group=kelion-codex \
  --property=SupplementaryGroups=privateai \
  --property=LoadCredential=codex-worker-secret:/root/kelion/secrets/codex-worker-secret \
  --setenv=PATH=/opt/private-ai/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  --setenv=HOME=/var/lib/kelion-codex \
  --setenv=KELION_CODEX_API="$KELION_CODEX_API" \
  --setenv=LANG=C.UTF-8 --setenv=LC_ALL=C.UTF-8 --setenv=CI=1 --setenv=NO_COLOR=1 \
  /usr/bin/node "$WORKER_TARGET" --transport-smoke)
grep -qx 'OPENCODE_WORKER_TRANSPORT_VERIFIED no_claim=true' <<<"$transport_smoke"
printf '%s\n' "$transport_smoke"
printf 'WORKER_HMAC_HEARTBEAT_E2E=passed\n'

[ "$(unit_state kelion-constructor-publisher.timer)" = "$PUBLISHER_TIMER_STATE" ] \
  || fail 'publisher timer state changed'
[ "$(unit_state kelion-constructor-release.timer)" = "$RELEASE_TIMER_STATE" ] \
  || fail 'release timer state changed'

claim_cursor=$(journalctl --no-pager --lines=0 --show-cursor \
  | sed -n 's/^-- cursor: //p')
[ -n "$claim_cursor" ] || fail 'journald did not provide a queue-proof cursor'
systemctl enable --now kelion-codex-worker.timer >/dev/null
systemctl start --no-block kelion-codex-worker.service
claim_proof=''
claim_invocation=''
for _ in $(seq 1 60); do
  claim_record=$(journalctl --no-pager --quiet --output=json \
    --unit=kelion-codex-worker.service --after-cursor="$claim_cursor" \
    | jq -r '
        select((.MESSAGE // "")
          | test("^OPENCODE_WORKER_CLAIM_VERIFIED state=(no_claimable_job|pipeline_active|claimed)$"))
        | [._SYSTEMD_INVOCATION_ID, .MESSAGE] | @tsv
      ' \
    | tail -n 1 || true)
  if [ -n "$claim_record" ]; then
    IFS=$'\t' read -r claim_invocation claim_proof <<<"$claim_record"
    [[ "$claim_invocation" =~ ^[0-9a-f]{32}$ ]]
    break
  fi
  sleep 2
done
[ -n "$claim_proof" ] || fail 'the real worker invocation produced no validated queue claim marker'
printf 'WORKER_CLAIM_INVOCATION_ID=%s\n' "$claim_invocation"
printf '%s\n' "$claim_proof"
printf 'WORKER_CLAIM_E2E=passed\n'

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
worker_unit_sha=$(sha256sum "$WORKER_UNIT_TARGET" | awk '{print $1}')
sudoers_sha=$(sha256sum "$SUDOERS" | awk '{print $1}')
config_sha=$(sha256sum "$OPENCODE_CONFIG" | awk '{print $1}')
receipt_candidate=$(mktemp "$PRIVATE_AI_CONFIG/.constructor-finalized.XXXXXX")
printf '%s\n' \
  'schema=1' \
  'executor=opencode' \
  'opencode_version=1.18.25' \
  'model=llama.cpp/qwen3.6-35b-a3b-local' \
  "worker_sha256=$worker_sha" \
  "config_sha256=$config_sha" \
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

rollback_armed=0
trap - ERR INT TERM
rm -rf --one-file-system -- "$rollback_root"
printf 'WORKER_INSTALLED_SHA256=%s\n' "$worker_sha"
printf 'WORKER_UNIT_INSTALLED_SHA256=%s\n' "$worker_unit_sha"
printf 'WORKER_SUDOERS_INSTALLED_SHA256=%s\n' "$sudoers_sha"
printf 'OPENCODE_CONFIG_SHA256=%s\n' "$config_sha"
printf 'FINAL_RECEIPT_SHA256=%s\n' "$final_receipt_sha"
printf 'WORKER_QUEUE_STATE=%s RESULT=%s EXIT=%s\n' "$worker_active" "$worker_result" "$worker_exit"
printf 'PUBLISHER_TIMER_PRESERVED=%s\n' "$PUBLISHER_TIMER_STATE"
printf 'RELEASE_TIMER_PRESERVED=%s\n' "$RELEASE_TIMER_STATE"
printf 'LEGACY_CODEX_COMPAT_REMOVED=yes\n'
printf 'PRIVATE_AI_DUAL_ACCESS_VERIFIED=yes\n'
printf 'PRIVATE_AI_CONSTRUCTOR_FINALIZED=yes\n'
