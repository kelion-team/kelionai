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
readonly LLAMA_BIN='/opt/private-ai/bin/llama-server'
readonly OPENCODE_BIN='/opt/private-ai/bin/opencode'
readonly OPENCODE_CONFIG='/srv/private-ai/home/.config/opencode/opencode.json'
readonly WORKER='/opt/kelion-codex/codex-worker.mjs'
readonly WORKER_UNIT='/etc/systemd/system/kelion-codex-worker.service'
readonly DROPIN_DIR='/etc/systemd/system/private-ai-llm.service.d'
readonly DROPIN="$DROPIN_DIR/90-qwen35-122b-max.conf"
readonly RECEIPT='/etc/private-ai/.max-model-complete'

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

require_regular() {
  local path=$1
  [ -f "$path" ] && [ ! -L "$path" ] || fail "fișier lipsă sau nesigur: $path"
  [ "$(stat -Lc '%h' "$path")" = 1 ] || fail "hardlink neașteptat: $path"
}

verify_shard() {
  local path=$1 bytes=$2 sha=$3
  require_regular "$path"
  [ "$(stat -Lc '%s' "$path")" = "$bytes" ] || return 1
  [ "$(sha256sum "$path" | awk '{print $1}')" = "$sha" ] || return 1
}

download_shard() {
  local index=$1 name bytes sha destination partial relative url
  name=${SHARD_NAMES[$index]}
  bytes=${SHARD_BYTES[$index]}
  sha=${SHARD_SHA256[$index]}
  destination="$MODEL_ROOT/$name"
  partial="$destination.part"
  if [ -f "$destination" ] && verify_shard "$destination" "$bytes" "$sha"; then
    log "Shard $((index + 1))/3 deja verificat."
    return 0
  fi
  [ ! -e "$destination" ] || fail "shard final existent dar invalid: $destination"
  relative="Q4_K_M/$name"
  url="https://huggingface.co/${MODEL_REPO}/resolve/${MODEL_REVISION}/${relative}?download=true"
  log "Descarc shard $((index + 1))/3 ($bytes bytes), reluabil."
  timeout --signal=TERM --kill-after=2m 21600 \
    runuser -u privateai -- env -i HOME=/srv/private-ai/home PATH=/usr/bin:/bin \
    curl --fail --location --silent --show-error \
      --retry 20 --retry-delay 5 --retry-all-errors \
      --connect-timeout 30 --continue-at - \
      --output "$partial" "$url"
  [ "$(stat -Lc '%U:%G:%s:%h' "$partial")" = "privateai:privateai:${bytes}:1" ] \
    || fail "metadate invalide după descărcare: $name"
  [ "$(sha256sum "$partial" | awk '{print $1}')" = "$sha" ] \
    || fail "SHA-256 invalid după descărcare: $name"
  mv -f -- "$partial" "$destination"
  sync -f "$destination"
  verify_shard "$destination" "$bytes" "$sha" \
    || fail "verificarea finală a shardului a eșuat: $name"
}

[ "$(id -u)" = 0 ] || fail 'root este obligatoriu'
require_regular /etc/private-ai/.install-complete
require_regular "$LLAMA_BIN"
require_regular "$OPENCODE_BIN"
require_regular "$OPENCODE_CONFIG"
require_regular "$WORKER"
require_regular "$WORKER_UNIT"
[ -x "$LLAMA_BIN" ] && [ -x "$OPENCODE_BIN" ] || fail 'binarele private AI nu sunt executabile'
[ "$(awk '/MemTotal:/ {print $2}' /proc/meminfo)" -ge 94371840 ] \
  || fail 'Qwen3.5-122B Q4 necesită VPS-ul de 96 GB RAM'
[ "$(df -PB1 /srv/private-ai | awk 'NR == 2 {print $4}')" -ge 90000000000 ] \
  || fail 'sunt necesari minimum 90 GB liberi pentru model și descărcarea reluabilă'

[ ! -L "$MODEL_ROOT" ] || fail "directorul modelului este un symlink: $MODEL_ROOT"
install -d -o privateai -g privateai -m 0700 "$MODEL_ROOT"
[ "$(stat -Lc '%U:%G:%a' "$MODEL_ROOT")" = 'privateai:privateai:700' ] \
  || fail 'metadate nesigure pentru directorul modelului'
download_shard 0
download_pids=()
for index in 1 2; do
  download_shard "$index" &
  download_pids+=("$!")
done
download_status=0
for download_pid in "${download_pids[@]}"; do
  wait "$download_pid" || download_status=$?
done
[ "$download_status" = 0 ] || fail 'descărcarea paralelă a shardurilor a eșuat'

sum=0
for index in 0 1 2; do
  verify_shard "$MODEL_ROOT/${SHARD_NAMES[$index]}" "${SHARD_BYTES[$index]}" "${SHARD_SHA256[$index]}" \
    || fail "shard invalid înainte de activare: ${SHARD_NAMES[$index]}"
  sum=$((sum + ${SHARD_BYTES[$index]}))
done
[ "$sum" = "$MODEL_TOTAL_BYTES" ] || fail 'dimensiunea totală a modelului nu corespunde'

while systemctl is-active --quiet private-ai-constructor-finalize.service 2>/dev/null; do
  log 'Aștept finalizarea tranzacției Constructor deja active.'
  sleep 10
done

rollback_root=$(mktemp -d /var/lib/private-ai/.max-model-rollback.XXXXXX)
rollback_armed=0
had_dropin=0
timer_enabled=$(systemctl is-enabled kelion-codex-worker.timer 2>/dev/null || true)
timer_active=$(systemctl is-active kelion-codex-worker.timer 2>/dev/null || true)
cp -a -- "$OPENCODE_CONFIG" "$rollback_root/opencode.json"
cp -a -- "$WORKER" "$rollback_root/codex-worker.mjs"
cp -a -- "$WORKER_UNIT" "$rollback_root/kelion-codex-worker.service"
if [ -f "$DROPIN" ] && [ ! -L "$DROPIN" ]; then
  had_dropin=1
  cp -a -- "$DROPIN" "$rollback_root/llm-dropin.conf"
elif [ -e "$DROPIN" ] || [ -L "$DROPIN" ]; then
  fail 'drop-in LLM existent dar nesigur'
fi

rollback() {
  local status=${1:-$?}
  trap - ERR EXIT HUP INT TERM
  if [ "$rollback_armed" = 1 ]; then
    set +e
    install -o root -g privateai -m 0640 "$rollback_root/opencode.json" "$OPENCODE_CONFIG"
    install -o root -g root -m 0555 "$rollback_root/codex-worker.mjs" "$WORKER"
    install -o root -g root -m 0644 "$rollback_root/kelion-codex-worker.service" "$WORKER_UNIT"
    if [ "$had_dropin" = 1 ]; then
      install -d -o root -g root -m 0755 "$DROPIN_DIR"
      install -o root -g root -m 0644 "$rollback_root/llm-dropin.conf" "$DROPIN"
    else
      rm -f -- "$DROPIN"
    fi
    systemctl daemon-reload
    systemctl restart private-ai-llm.service
    systemctl restart private-ai-web.service
    if [ "$timer_enabled" = enabled ]; then systemctl enable kelion-codex-worker.timer >/dev/null; fi
    if [ "$timer_active" = active ]; then systemctl restart kelion-codex-worker.timer; fi
    printf 'MAX_MODEL_ROLLBACK=yes EXIT=%s\n' "$status" >&2
  fi
  exit "$status"
}
trap 'rollback $?' ERR EXIT
trap 'rollback 129' HUP
trap 'rollback 130' INT
trap 'rollback 143' TERM
rollback_armed=1

systemctl stop kelion-codex-worker.timer >/dev/null 2>&1 || true
systemctl stop kelion-codex-worker.service >/dev/null 2>&1 || true
systemctl stop private-ai-web.service

config_candidate=$(mktemp /srv/private-ai/home/.config/opencode/.opencode.max.XXXXXX)
cat > "$config_candidate" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "model": "llama.cpp/qwen3.5-122b-a10b-local",
  "small_model": "llama.cpp/qwen3.5-122b-a10b-local",
  "enabled_providers": ["llama.cpp"],
  "share": "disabled",
  "provider": {
    "llama.cpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Qwen3.5 122B local",
      "options": {
        "baseURL": "http://127.0.0.1:24080/v1",
        "timeout": 3600000,
        "chunkTimeout": 1200000
      },
      "models": {
        "qwen3.5-122b-a10b-local": {
          "name": "Qwen3.5 122B-A10B Q4_K_M local",
          "limit": {"context": 16384, "output": 4096}
        }
      }
    }
  },
  "permission": {
    "*": "allow",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "edit": "allow",
    "bash": "allow",
    "task": "allow",
    "skill": "allow",
    "webfetch": "allow",
    "websearch": "allow",
    "external_directory": "allow"
  },
  "instructions": ["instructions.md"],
  "server": {"hostname": "127.0.0.1", "port": 24096, "mdns": false}
}
JSON
jq -e --arg model "$MODEL_ID" '
  .model == $model and .small_model == $model and
  .enabled_providers == ["llama.cpp"] and
  .provider["llama.cpp"].models["qwen3.5-122b-a10b-local"].limit.context == 16384 and
  .permission["*"] == "allow"
' "$config_candidate" >/dev/null
chown root:privateai "$config_candidate"
chmod 0640 "$config_candidate"
mv -f -- "$config_candidate" "$OPENCODE_CONFIG"
sync -f "$OPENCODE_CONFIG"

worker_candidate=$(mktemp /opt/kelion-codex/.codex-worker.max.XXXXXX)
sed 's/qwen3\.6-35b-a3b-local/qwen3.5-122b-a10b-local/g' "$WORKER" > "$worker_candidate"
! grep -Fq 'qwen3.6-35b-a3b-local' "$worker_candidate"
grep -Fq 'qwen3.5-122b-a10b-local' "$worker_candidate"
node --check "$worker_candidate"
chown root:root "$worker_candidate"
chmod 0555 "$worker_candidate"
mv -f -- "$worker_candidate" "$WORKER"
sync -f "$WORKER"

worker_unit_candidate=$(mktemp /etc/systemd/system/.kelion-codex-worker.max.XXXXXX)
sed 's#^Environment=OPENCODE_MODEL=llama\.cpp/qwen3\.6-35b-a3b-local$#Environment=OPENCODE_MODEL=llama.cpp/qwen3.5-122b-a10b-local#' \
  "$WORKER_UNIT" > "$worker_unit_candidate"
[ "$(grep -c '^Environment=OPENCODE_MODEL=llama.cpp/qwen3.5-122b-a10b-local$' \
  "$worker_unit_candidate")" -eq 1 ]
! grep -Fq 'Environment=OPENCODE_MODEL=llama.cpp/qwen3.6-35b-a3b-local' \
  "$worker_unit_candidate"
chown root:root "$worker_unit_candidate"
chmod 0644 "$worker_unit_candidate"
mv -f -- "$worker_unit_candidate" "$WORKER_UNIT"
sync -f "$WORKER_UNIT"

install -d -o root -g root -m 0755 "$DROPIN_DIR"
dropin_candidate=$(mktemp "$DROPIN_DIR/.90-qwen35-122b-max.XXXXXX")
cat > "$dropin_candidate" <<EOF
[Service]
ExecStart=
ExecStart=$LLAMA_BIN --model $MODEL_ROOT/$MODEL_FIRST --alias $MODEL_ALIAS --host 127.0.0.1 --port 24080 --ctx-size 16384 --n-predict 4096 --threads 16 --parallel 1 --jinja --chat-template-kwargs '{"enable_thinking":false}'
TimeoutStartSec=3600
CPUQuota=1600%
MemoryHigh=84G
MemoryMax=88G
EOF
chown root:root "$dropin_candidate"
chmod 0644 "$dropin_candidate"
mv -f -- "$dropin_candidate" "$DROPIN"
sync -f "$DROPIN"

systemctl daemon-reload
systemd-analyze verify private-ai-llm.service
systemd-analyze verify "$WORKER_UNIT"
systemctl restart private-ai-llm.service

deadline=$((SECONDS + 3600))
while ! curl --fail --silent --show-error --max-time 10 http://127.0.0.1:24080/health >/dev/null; do
  if systemctl is-failed --quiet private-ai-llm.service; then
    journalctl --no-pager --output=cat --unit=private-ai-llm.service --lines=200 >&2
    fail 'llama-server a eșuat la încărcarea modelului 122B'
  fi
  [ "$SECONDS" -lt "$deadline" ] || fail 'timeout la încărcarea modelului 122B'
  sleep 10
done

models=$(curl --fail --silent --show-error --max-time 30 http://127.0.0.1:24080/v1/models)
jq -e --arg id "$MODEL_ALIAS" '.data | any(.id == $id)' <<<"$models" >/dev/null
reply=$(curl --fail --silent --show-error --max-time 1800 \
  -H 'Content-Type: application/json' \
  --data-binary "{\"model\":\"$MODEL_ALIAS\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply only with OK.\"}],\"max_tokens\":16,\"temperature\":0}" \
  http://127.0.0.1:24080/v1/chat/completions)
jq -e '.choices[0].message.content | type == "string" and length > 0' <<<"$reply" >/dev/null

systemctl restart private-ai-web.service
for attempt in $(seq 1 120); do
  if ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24096'; then break; fi
  [ "$attempt" -lt 120 ] || fail 'OpenCode web nu a revenit pe 127.0.0.1:24096'
  sleep 2
done

HOME=/srv/private-ai/home XDG_CONFIG_HOME=/srv/private-ai/home/.config \
  "$OPENCODE_BIN" models llama.cpp | grep -Fq "$MODEL_ALIAS"
node "$WORKER" --self-test | grep -qx 'codex-worker self-test: TRECE'
systemctl show kelion-codex-worker.service -p Environment --value \
  | tr ' ' '\n' \
  | grep -qx 'OPENCODE_MODEL=llama.cpp/qwen3.5-122b-a10b-local'
systemctl enable kelion-codex-worker.timer >/dev/null
systemctl restart kelion-codex-worker.timer

llm_pid=$(systemctl show private-ai-llm.service -p MainPID --value)
[[ "$llm_pid" =~ ^[1-9][0-9]*$ ]]
awk -v target="$MODEL_ROOT/$MODEL_FIRST" '$NF == target {found=1} END {exit !found}' "/proc/$llm_pid/maps"
ss -ltnH | awk '{print $4}' | grep -qx '127.0.0.1:24080'
! ss -ltnH | awk '{print $4}' | grep -Eq '(0\.0\.0\.0|\[::\]):24080$'

receipt_candidate=$(mktemp /etc/private-ai/.max-model-complete.XXXXXX)
{
  printf 'schema=1\n'
  printf 'model=%s\n' "$MODEL_ID"
  printf 'model_repo=%s\n' "$MODEL_REPO"
  printf 'model_revision=%s\n' "$MODEL_REVISION"
  printf 'model_quant=%s\n' "$MODEL_QUANT"
  printf 'model_total_bytes=%s\n' "$MODEL_TOTAL_BYTES"
  for index in 0 1 2; do
    printf 'shard_%s_sha256=%s\n' "$((index + 1))" "${SHARD_SHA256[$index]}"
  done
  printf 'context=16384\n'
  printf 'worker_unit_model=%s\n' "$MODEL_ID"
  printf 'verified_at=%s\n' "$(date -u +%FT%TZ)"
} > "$receipt_candidate"
chown root:root "$receipt_candidate"
chmod 0600 "$receipt_candidate"
mv -f -- "$receipt_candidate" "$RECEIPT"
sync -f "$RECEIPT"

rollback_armed=0
trap - ERR EXIT HUP INT TERM
rm -rf --one-file-system "$rollback_root"

printf 'MODEL_ID=%s\n' "$MODEL_ID"
printf 'MODEL_REPO=%s\n' "$MODEL_REPO"
printf 'MODEL_REVISION=%s\n' "$MODEL_REVISION"
printf 'MODEL_QUANT=%s\n' "$MODEL_QUANT"
printf 'MODEL_TOTAL_BYTES=%s\n' "$MODEL_TOTAL_BYTES"
printf 'MODEL_CONTEXT=16384\n'
printf 'VPS_MEMORY_TOTAL_BYTES=%s\n' "$(awk '/MemTotal:/ {print $2 * 1024}' /proc/meminfo | cut -d. -f1)"
printf 'VPS_CPU_THREADS=%s\n' "$(nproc)"
printf 'LLAMA_HEALTH=ok\n'
printf 'LLAMA_INFERENCE=passed\n'
printf 'OPENCODE_PROVIDER=passed\n'
printf 'WORKER_SELF_TEST=passed\n'
printf 'WORKER_UNIT_MODEL=passed\n'
printf 'MAX_MODEL_INSTALLED=yes\n'
