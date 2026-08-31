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
readonly RANGE_CHUNK_BYTES=$((512 * 1024 * 1024))
readonly RANGE_WORKERS=4
readonly RANGE_FREE_MARGIN_BYTES=$((5 * 1024 * 1024 * 1024))

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
  [ "$(sha256sum "$partial" | awk '{print $1}')" = "$sha" ] \
    || fail "SHA-256 invalid după descărcare: $name"
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
    # Never reuse size-only-validated chunks after a full-object SHA failure.
    # Keep the trusted .part prefix, discard only range outputs, then let
    # systemd retry download fresh bytes on the next invocation.
    if [ -n "${range_dir:-}" ] && [ -d "$range_dir" ] && [ ! -L "$range_dir" ]; then
      for range_path in "${range_paths[@]}"; do
        rm -f -- "$range_path"
      done
      rmdir -- "$range_dir" 2>/dev/null || true
    fi
    fail 'SHA-256 invalid pentru shardul 2; prefixul .part a fost păstrat, chunkurile vor fi redescărcate'
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
download_shard_parallel_ranges 1 &
download_pids+=("$!")
download_shard 2 &
download_pids+=("$!")
download_status=0
for download_pid in "${download_pids[@]}"; do
  wait "$download_pid" || download_status=$?
done
[ "$download_status" = 0 ] || fail 'descărcarea paralelă a shardurilor a eșuat'

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
ExecStart=$LLAMA_BIN --model $MODEL_ROOT/$MODEL_FIRST --alias $MODEL_ALIAS --host 127.0.0.1 --port 24080 --ctx-size 16384 --n-predict 4096 --threads 16 --parallel 1 --batch-size 2048 --ubatch-size 512 --load-mode mmap --cache-ram 0 --spec-type none --no-mmproj --jinja --chat-template-kwargs '{"enable_thinking":false}'
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
