#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly PRIVATE_AI_USER="privateai"
readonly PRIVATE_AI_GROUP="privateai"
readonly PRIVATE_AI_ROOT="/srv/private-ai"
readonly PRIVATE_AI_HOME="${PRIVATE_AI_ROOT}/home"
readonly PRIVATE_AI_WORKSPACE="${PRIVATE_AI_ROOT}/workspace"
readonly PRIVATE_AI_CACHE="${PRIVATE_AI_ROOT}/cache"
readonly PRIVATE_AI_MODEL_CACHE="${PRIVATE_AI_ROOT}/models"
readonly PRIVATE_AI_STATE="/var/lib/private-ai"
readonly PRIVATE_AI_CONFIG="/etc/private-ai"
readonly PRIVATE_AI_BIN="/opt/private-ai/bin"
readonly PRIVATE_AI_SOURCE="/opt/private-ai/src/llama.cpp"
readonly PRIVATE_AI_MARKER="${PRIVATE_AI_CONFIG}/.installer-id"
readonly PRIVATE_AI_COMPLETE="${PRIVATE_AI_CONFIG}/.install-complete"
readonly INSTALLER_ID="private-ai-contabo-v1"
readonly LLAMA_PORT="24080"
readonly OPENCODE_PORT="24096"
readonly MODEL_REPO="ggml-org/Qwen3.6-35B-A3B-GGUF"
readonly MODEL_QUANT="Q4_K_M"
readonly MODEL_ALIAS="qwen3.6-35b-a3b-local"
readonly LLAMA_CPP_REF="c1d0e7a004015f23bc0233470b747b596f29b264"
readonly OPENCODE_VERSION="1.18.25"
readonly OPENCODE_X64_SHA256="58a3729a6f3432dd6d2917fcc4a949788891a035818646ad480e12c947f56e78"
readonly OPENCODE_BASELINE_SHA256="ccd10586611b598b1eaed7c05cfbcbc68e3ec09e736b360da09b1d615d922968"

log() {
  printf '[private-ai] %s\n' "$*"
}

fail() {
  printf '[private-ai] ERROR: %s\n' "$*" >&2
  exit 1
}

on_error() {
  local line_no=$1 exit_status=$2
  printf '[private-ai] Installation failed near line %s with exit status %s. Existing unrelated services were not changed.\n' \
    "$line_no" "$exit_status" >&2
}
trap 'on_error "$LINENO" "$?"' ERR

require_root() {
  [ "$(id -u)" -eq 0 ] || fail "Run this installer as root."
}

check_preflight() {
  [ -r /etc/os-release ] || fail "Cannot identify the operating system."
  # shellcheck disable=SC1091
  . /etc/os-release
  [ "${ID:-}" = "ubuntu" ] || fail "Ubuntu is required."
  case "${VERSION_ID:-}" in
    24.04|24.10|25.*|26.*) ;;
    *) fail "Ubuntu 24.04 or newer is required." ;;
  esac

  [ "$(uname -m)" = "x86_64" ] || fail "This installer currently supports x86_64 only."

  if [ -e "$PRIVATE_AI_MARKER" ]; then
    [ "$(cat "$PRIVATE_AI_MARKER")" = "$INSTALLER_ID" ] \
      || fail "The existing private-ai installation has an unknown owner marker."
  else
    local existing_target
    for existing_target in \
      "$PRIVATE_AI_ROOT" \
      "$PRIVATE_AI_CONFIG" \
      "$PRIVATE_AI_STATE" \
      /opt/private-ai \
      /etc/systemd/system/private-ai-llm.service \
      /etc/systemd/system/private-ai-web.service \
      /root/private-ai-access.txt; do
      [ ! -e "$existing_target" ] || fail "Refusing to reuse unmarked target: $existing_target"
    done
    ! id -u "$PRIVATE_AI_USER" >/dev/null 2>&1 \
      || fail "Refusing to reuse the existing user $PRIVATE_AI_USER without an installer marker."
    ! getent group "$PRIVATE_AI_GROUP" >/dev/null \
      || fail "Refusing to reuse the existing group $PRIVATE_AI_GROUP without an installer marker."
  fi

  local memory_kb available_mb required_available_mb model_cache_mb
  memory_kb=$(awk '/MemTotal:/ {print $2}' /proc/meminfo)
  [ "${memory_kb:-0}" -ge 83886080 ] || fail "At least 80 GB RAM is required."

  available_mb=$(df -Pm / | awk 'NR == 2 {print $4}')
  required_available_mb=71680
  if [ -e "$PRIVATE_AI_MARKER" ] && [ -d "$PRIVATE_AI_MODEL_CACHE" ]; then
    model_cache_mb=$(du -sm "$PRIVATE_AI_MODEL_CACHE" 2>/dev/null | awk '{print $1}')
    if [ "${model_cache_mb:-0}" -ge 18432 ]; then
      # A resumable model cache already exists. Requiring the original 70 GB
      # again would prevent an idempotent recovery after the large download.
      required_available_mb=20480
    fi
  fi
  [ "${available_mb:-0}" -ge "$required_available_mb" ] \
    || fail "At least ${required_available_mb} MB free disk space is required."

  if command -v ss >/dev/null 2>&1; then
    if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)${LLAMA_PORT}$" && ! systemctl is-active --quiet private-ai-llm.service 2>/dev/null; then
      fail "TCP port ${LLAMA_PORT} is already used by another service."
    fi
    if ss -ltnH | awk '{print $4}' | grep -Eq "(^|:)${OPENCODE_PORT}$" && ! systemctl is-active --quiet private-ai-web.service 2>/dev/null; then
      fail "TCP port ${OPENCODE_PORT} is already used by another service."
    fi
  fi
}

install_packages() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    git \
    iproute2 \
    jq \
    libcurl4-openssl-dev \
    libssl-dev \
    openssl \
    pkg-config \
    procps \
    tar \
    util-linux
}

create_isolated_account() {
  if ! getent group "$PRIVATE_AI_GROUP" >/dev/null; then
    groupadd --system "$PRIVATE_AI_GROUP"
  fi

  if ! id -u "$PRIVATE_AI_USER" >/dev/null 2>&1; then
    useradd \
      --system \
      --gid "$PRIVATE_AI_GROUP" \
      --home-dir "$PRIVATE_AI_HOME" \
      --create-home \
      --shell /bin/bash \
      "$PRIVATE_AI_USER"
  fi

  install -d -o root -g root -m 0755 /opt/private-ai
  install -d -o root -g root -m 0755 "$PRIVATE_AI_BIN"
  install -d -o "$PRIVATE_AI_USER" -g "$PRIVATE_AI_GROUP" -m 0750 /opt/private-ai/src
  install -d -o root -g "$PRIVATE_AI_GROUP" -m 0750 "$PRIVATE_AI_CONFIG"
  install -d -o root -g "$PRIVATE_AI_GROUP" -m 0750 "$PRIVATE_AI_ROOT"
  install -d -o "$PRIVATE_AI_USER" -g "$PRIVATE_AI_GROUP" -m 0700 "$PRIVATE_AI_HOME"
  install -d -o "$PRIVATE_AI_USER" -g "$PRIVATE_AI_GROUP" -m 0700 \
    "$PRIVATE_AI_WORKSPACE" \
    "$PRIVATE_AI_CACHE" \
    "$PRIVATE_AI_MODEL_CACHE" \
    "$PRIVATE_AI_STATE"

  printf '%s\n' "$INSTALLER_ID" > "$PRIVATE_AI_MARKER"
  chown root:root "$PRIVATE_AI_MARKER"
  chmod 0600 "$PRIVATE_AI_MARKER"

  if [ ! -f "${PRIVATE_AI_STATE}/preinstall-services.txt" ]; then
    systemctl list-units --type=service --state=running --no-legend --no-pager \
      > "${PRIVATE_AI_STATE}/preinstall-services.txt"
    chown "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "${PRIVATE_AI_STATE}/preinstall-services.txt"
    chmod 0600 "${PRIVATE_AI_STATE}/preinstall-services.txt"
  fi
}

build_llama_cpp() {
  chown -R "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" /opt/private-ai/src
  if [ ! -d "${PRIVATE_AI_SOURCE}/.git" ]; then
    runuser -u "$PRIVATE_AI_USER" -- env -i \
      HOME="$PRIVATE_AI_HOME" \
      PATH=/usr/local/bin:/usr/bin:/bin \
      git clone --filter=blob:none --no-checkout https://github.com/ggml-org/llama.cpp.git "$PRIVATE_AI_SOURCE"
  fi

  runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    git -C "$PRIVATE_AI_SOURCE" fetch --depth 1 origin "$LLAMA_CPP_REF"
  runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    git -C "$PRIVATE_AI_SOURCE" checkout --detach "$LLAMA_CPP_REF"
  [ "$(runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    git -C "$PRIVATE_AI_SOURCE" rev-parse HEAD)" = "$LLAMA_CPP_REF" ] \
    || fail "The pinned llama.cpp revision was not checked out."

  runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    nice -n 10 ionice -c 2 -n 7 cmake \
    -S "$PRIVATE_AI_SOURCE" \
    -B "${PRIVATE_AI_SOURCE}/build" \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=OFF \
    -DGGML_NATIVE=ON \
    -DLLAMA_CURL=ON \
    -DLLAMA_OPENSSL=ON
  runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    nice -n 10 ionice -c 2 -n 7 cmake --build "${PRIVATE_AI_SOURCE}/build" \
    --config Release \
    --target llama-server llama-cli llama-bench \
    -j 6

  install -o root -g root -m 0755 "${PRIVATE_AI_SOURCE}/build/bin/llama-server" "${PRIVATE_AI_BIN}/llama-server"
  install -o root -g root -m 0755 "${PRIVATE_AI_SOURCE}/build/bin/llama-cli" "${PRIVATE_AI_BIN}/llama-cli"
  install -o root -g root -m 0755 "${PRIVATE_AI_SOURCE}/build/bin/llama-bench" "${PRIVATE_AI_BIN}/llama-bench"
  runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    git -C "$PRIVATE_AI_SOURCE" rev-parse HEAD > "${PRIVATE_AI_STATE}/llama-cpp.commit"
  chmod 0600 "${PRIVATE_AI_STATE}/llama-cpp.commit"
  chown "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "${PRIVATE_AI_STATE}/llama-cpp.commit"
}

install_opencode() {
  local opencode_asset opencode_sha256 opencode_tmp
  if grep -qwi avx2 /proc/cpuinfo; then
    opencode_asset="opencode-linux-x64.tar.gz"
    opencode_sha256="$OPENCODE_X64_SHA256"
  else
    opencode_asset="opencode-linux-x64-baseline.tar.gz"
    opencode_sha256="$OPENCODE_BASELINE_SHA256"
  fi
  opencode_tmp=$(mktemp -d -p "$PRIVATE_AI_CACHE" opencode-install.XXXXXX)
  chown "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "$opencode_tmp"
  runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    curl --fail --location --silent --show-error --proto "=https" --tlsv1.2 \
      "https://github.com/anomalyco/opencode/releases/download/v${OPENCODE_VERSION}/${opencode_asset}" \
      --output "${opencode_tmp}/${opencode_asset}"
  printf '%s  %s\n' "$opencode_sha256" "${opencode_tmp}/${opencode_asset}" \
    | sha256sum --check --strict -
  runuser -u "$PRIVATE_AI_USER" -- env -i \
    HOME="$PRIVATE_AI_HOME" \
    PATH=/usr/local/bin:/usr/bin:/bin \
    tar -xzf "${opencode_tmp}/${opencode_asset}" -C "$opencode_tmp"
  [ -x "${opencode_tmp}/opencode" ] || fail "OpenCode executable was not found in the pinned release."
  install -o root -g root -m 0755 "${opencode_tmp}/opencode" "${PRIVATE_AI_BIN}/opencode"
  rm -rf -- "$opencode_tmp"
  (
    cd "$PRIVATE_AI_WORKSPACE"
    runuser -u "$PRIVATE_AI_USER" -- env -i \
      HOME="$PRIVATE_AI_HOME" \
      PATH=/usr/local/bin:/usr/bin:/bin \
      "${PRIVATE_AI_BIN}/opencode" --version \
      > "${PRIVATE_AI_STATE}/opencode.version"
  )
  chmod 0600 "${PRIVATE_AI_STATE}/opencode.version"
  chown "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "${PRIVATE_AI_STATE}/opencode.version"
}

write_agent_configuration() {
  install -d -o root -g "$PRIVATE_AI_GROUP" -m 0750 \
    "${PRIVATE_AI_HOME}/.config" \
    "${PRIVATE_AI_HOME}/.config/opencode"
  install -d -o "$PRIVATE_AI_USER" -g "$PRIVATE_AI_GROUP" -m 0700 \
    "${PRIVATE_AI_HOME}/.local" \
    "${PRIVATE_AI_HOME}/.local/share"

  cat > "${PRIVATE_AI_HOME}/.config/opencode/instructions.md" <<'INSTRUCTIONS'
You are Adrian's private local coding agent.

Start work only after Adrian sends a new explicit command in this private web interface.
Never schedule work, poll for work, create timers, create webhooks, or continue an unfinished task after a restart.
Work only inside /srv/private-ai/workspace.
Remain independent from every other application, repository, account, credential, database, container socket, deployment system, and production path on this server.
Do not use external or paid AI providers.
Do not deploy, publish, change credentials, or touch live production paths without a separate explicit confirmation.
Do not reveal secrets in chat, command output, source files, or logs.
Ask for confirmation before destructive actions, publication, deployment, credential changes, or external communication.
Reply in Romanian unless Adrian asks for another language.
INSTRUCTIONS

  cat > "${PRIVATE_AI_HOME}/.config/opencode/opencode.json" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "model": "llama.cpp/qwen3.6-35b-a3b-local",
  "small_model": "llama.cpp/qwen3.6-35b-a3b-local",
  "enabled_providers": ["llama.cpp"],
  "share": "disabled",
  "provider": {
    "llama.cpp": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Qwen local",
      "options": {
        "baseURL": "http://127.0.0.1:24080/v1",
        "timeout": 1800000,
        "chunkTimeout": 600000
      },
      "models": {
        "qwen3.6-35b-a3b-local": {
          "name": "Qwen3.6 35B-A3B Q4 local",
          "limit": {
            "context": 32768,
            "output": 8192
          }
        }
      }
    }
  },
  "permission": {
    "*": "ask",
    "read": "allow",
    "glob": "allow",
    "grep": "allow",
    "edit": "allow",
    "bash": "ask",
    "task": "ask",
    "skill": "ask",
    "webfetch": "ask",
    "websearch": "deny",
    "external_directory": "deny"
  },
  "instructions": ["instructions.md"],
  "server": {
    "hostname": "127.0.0.1",
    "port": 24096,
    "mdns": false
  }
}
JSON

  chown -R root:"$PRIVATE_AI_GROUP" "${PRIVATE_AI_HOME}/.config"
  chown -R "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "${PRIVATE_AI_HOME}/.local"
  chmod 0640 \
    "${PRIVATE_AI_HOME}/.config/opencode/opencode.json" \
    "${PRIVATE_AI_HOME}/.config/opencode/instructions.md"

  if [ ! -s "${PRIVATE_AI_CONFIG}/opencode.env" ]; then
    local opencode_password
    opencode_password=$(openssl rand -hex 24)
    cat > "${PRIVATE_AI_CONFIG}/opencode.env" <<EOF
OPENCODE_SERVER_USERNAME=adrian
OPENCODE_SERVER_PASSWORD=${opencode_password}
EOF
    unset opencode_password
  fi
  grep -Eq '^OPENCODE_SERVER_USERNAME=[A-Za-z0-9._-]+$' "${PRIVATE_AI_CONFIG}/opencode.env" \
    || fail "The OpenCode username configuration is invalid."
  grep -Eq '^OPENCODE_SERVER_PASSWORD=[A-Fa-f0-9]{48}$' "${PRIVATE_AI_CONFIG}/opencode.env" \
    || fail "The OpenCode password configuration is invalid."
  chown root:"$PRIVATE_AI_GROUP" "${PRIVATE_AI_CONFIG}/opencode.env"
  chmod 0640 "${PRIVATE_AI_CONFIG}/opencode.env"
}

download_and_test_model() {
  if [ ! -f "${PRIVATE_AI_STATE}/model.ready" ]; then
    log "Downloading the local model. This is about 21 GB and can take a while."
    timeout --signal=TERM --kill-after=2m 21600 runuser -u "$PRIVATE_AI_USER" -- env -i \
      HOME="$PRIVATE_AI_HOME" \
      PATH=/usr/local/bin:/usr/bin:/bin \
      XDG_CACHE_HOME="$PRIVATE_AI_CACHE" \
      HF_HOME="$PRIVATE_AI_MODEL_CACHE" \
      "${PRIVATE_AI_BIN}/llama-cli" \
      -hf "${MODEL_REPO}:${MODEL_QUANT}" \
      --ctx-size 2048 \
      --threads "$(nproc)" \
      --n-predict 4 \
      --prompt "Reply only with OK." \
      > "${PRIVATE_AI_STATE}/model-smoke.txt"
    touch "${PRIVATE_AI_STATE}/model.ready"
    chown "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "${PRIVATE_AI_STATE}/model.ready" "${PRIVATE_AI_STATE}/model-smoke.txt"
    chmod 0600 "${PRIVATE_AI_STATE}/model.ready" "${PRIVATE_AI_STATE}/model-smoke.txt"
  fi
}

write_systemd_units() {
  cat > /etc/systemd/system/private-ai-llm.service <<EOF
[Unit]
Description=Private AI local model server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${PRIVATE_AI_USER}
Group=${PRIVATE_AI_GROUP}
WorkingDirectory=${PRIVATE_AI_WORKSPACE}
Environment=HOME=${PRIVATE_AI_HOME}
Environment=XDG_CACHE_HOME=${PRIVATE_AI_CACHE}
Environment=HF_HOME=${PRIVATE_AI_MODEL_CACHE}
ExecStart=${PRIVATE_AI_BIN}/llama-server -hf ${MODEL_REPO}:${MODEL_QUANT} --offline --alias ${MODEL_ALIAS} --host 127.0.0.1 --port ${LLAMA_PORT} --ctx-size 32768 --n-predict 8192 --threads 12 --parallel 1 --jinja
Restart=on-failure
RestartSec=10
TimeoutStartSec=1800
TimeoutStopSec=60
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectProc=invisible
ProcSubset=pid
RestrictSUIDSGID=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictRealtime=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
IPAddressDeny=any
IPAddressAllow=localhost
ReadWritePaths=${PRIVATE_AI_ROOT} ${PRIVATE_AI_STATE}
InaccessiblePaths=-/root -/home -/run/docker.sock -/var/run/docker.sock -/var/lib/docker -/var/lib/containers
CPUAccounting=yes
CPUWeight=20
CPUQuota=1200%
MemoryAccounting=yes
MemoryHigh=48G
MemoryMax=64G
TasksMax=256
OOMPolicy=stop

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/private-ai-web.service <<EOF
[Unit]
Description=Private AI coding agent web interface
After=network-online.target private-ai-llm.service
Wants=network-online.target
Requires=private-ai-llm.service

[Service]
Type=simple
User=${PRIVATE_AI_USER}
Group=${PRIVATE_AI_GROUP}
WorkingDirectory=${PRIVATE_AI_WORKSPACE}
Environment=HOME=${PRIVATE_AI_HOME}
Environment=XDG_CACHE_HOME=${PRIVATE_AI_CACHE}
Environment=XDG_DATA_HOME=${PRIVATE_AI_HOME}/.local/share
Environment=OPENCODE_DISABLE_PROJECT_CONFIG=true
Environment=OPENCODE_DISABLE_LSP_DOWNLOAD=true
EnvironmentFile=${PRIVATE_AI_CONFIG}/opencode.env
ExecStart=${PRIVATE_AI_BIN}/opencode web --hostname 127.0.0.1 --port ${OPENCODE_PORT}
Restart=on-failure
RestartSec=10
TimeoutStartSec=300
TimeoutStopSec=60
UMask=0077
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectProc=invisible
ProcSubset=pid
RestrictSUIDSGID=yes
LockPersonality=yes
CapabilityBoundingSet=
AmbientCapabilities=
RestrictRealtime=yes
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
ReadWritePaths=${PRIVATE_AI_ROOT} ${PRIVATE_AI_STATE}
InaccessiblePaths=-/root -/home -/run/docker.sock -/var/run/docker.sock -/var/lib/docker -/var/lib/containers
CPUAccounting=yes
CPUWeight=20
CPUQuota=200%
MemoryAccounting=yes
MemoryHigh=2G
MemoryMax=4G
TasksMax=128
OOMPolicy=stop

[Install]
WantedBy=multi-user.target
EOF

  chmod 0644 /etc/systemd/system/private-ai-llm.service /etc/systemd/system/private-ai-web.service
  systemctl daemon-reload
}

warm_opencode_provider() {
  (
    cd "$PRIVATE_AI_WORKSPACE"
    timeout 300 runuser -u "$PRIVATE_AI_USER" -- env -i \
      HOME="$PRIVATE_AI_HOME" \
      PATH=/usr/local/bin:/usr/bin:/bin \
      XDG_CACHE_HOME="$PRIVATE_AI_CACHE" \
      XDG_DATA_HOME="${PRIVATE_AI_HOME}/.local/share" \
      OPENCODE_DISABLE_PROJECT_CONFIG=true \
      OPENCODE_DISABLE_LSP_DOWNLOAD=true \
      "${PRIVATE_AI_BIN}/opencode" models llama.cpp \
      > "${PRIVATE_AI_STATE}/opencode-models.txt"
  )
  chown "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "${PRIVATE_AI_STATE}/opencode-models.txt"
  chmod 0600 "${PRIVATE_AI_STATE}/opencode-models.txt"
}

start_and_verify() {
  systemctl enable private-ai-llm.service
  systemctl restart private-ai-llm.service

  local attempt
  for attempt in $(seq 1 180); do
    if curl --fail --silent --show-error --max-time 3 "http://127.0.0.1:${LLAMA_PORT}/health" >/dev/null 2>&1; then
      break
    fi
    [ "$attempt" -lt 180 ] || fail "The local model service did not become healthy."
    sleep 5
  done

  local response
  response=$(curl --fail --silent --show-error --max-time 600 \
    -H 'Content-Type: application/json' \
    -d '{"model":"qwen3.6-35b-a3b-local","messages":[{"role":"user","content":"Reply only with OK."}],"max_tokens":8,"temperature":0}' \
    "http://127.0.0.1:${LLAMA_PORT}/v1/chat/completions")
  printf '%s' "$response" | jq -e '.choices[0].message.content | length > 0' >/dev/null

  (
    cd "$PRIVATE_AI_WORKSPACE"
    timeout 900 runuser -u "$PRIVATE_AI_USER" -- env -i \
      HOME="$PRIVATE_AI_HOME" \
      PATH=/usr/local/bin:/usr/bin:/bin \
      XDG_CACHE_HOME="$PRIVATE_AI_CACHE" \
      XDG_DATA_HOME="${PRIVATE_AI_HOME}/.local/share" \
      OPENCODE_DISABLE_PROJECT_CONFIG=true \
      OPENCODE_DISABLE_LSP_DOWNLOAD=true \
      "${PRIVATE_AI_BIN}/opencode" run \
        --model "llama.cpp/${MODEL_ALIAS}" \
        "Reply only with OK." \
        > "${PRIVATE_AI_STATE}/opencode-e2e.txt"
  )
  [ -s "${PRIVATE_AI_STATE}/opencode-e2e.txt" ] \
    || fail "The OpenCode to local-model end-to-end test returned no output."
  chown "$PRIVATE_AI_USER:$PRIVATE_AI_GROUP" "${PRIVATE_AI_STATE}/opencode-e2e.txt"
  chmod 0600 "${PRIVATE_AI_STATE}/opencode-e2e.txt"

  systemctl enable private-ai-web.service
  systemctl restart private-ai-web.service

  # shellcheck disable=SC1091
  . "${PRIVATE_AI_CONFIG}/opencode.env"
  [ -n "${OPENCODE_SERVER_USERNAME:-}" ] && [ -n "${OPENCODE_SERVER_PASSWORD:-}" ] \
    || fail "OpenCode authentication is not configured."

  for attempt in $(seq 1 60); do
    if printf 'user = "%s:%s"\n' "$OPENCODE_SERVER_USERNAME" "$OPENCODE_SERVER_PASSWORD" \
      | curl --config - --fail --silent --show-error --max-time 3 \
      "http://127.0.0.1:${OPENCODE_PORT}/global/health" \
      | jq -e '.healthy == true' >/dev/null 2>&1; then
      break
    fi
    [ "$attempt" -lt 60 ] || fail "The private web interface did not become healthy."
    sleep 3
  done

  systemctl is-active --quiet private-ai-llm.service
  systemctl is-active --quiet private-ai-web.service

  ss -ltnH | awk '{print $4}' | grep -qx "127.0.0.1:${LLAMA_PORT}"
  ss -ltnH | awk '{print $4}' | grep -qx "127.0.0.1:${OPENCODE_PORT}"
  if ss -ltnH | awk '{print $4}' | grep -Eq "(0\.0\.0\.0|\[::\]):(${LLAMA_PORT}|${OPENCODE_PORT})$"; then
    fail "A private service is listening publicly."
  fi

  cat > /root/private-ai-access.txt <<EOF
Private AI is installed and healthy.

Browser URL after opening the SSH tunnel:
http://127.0.0.1:${OPENCODE_PORT}

Web username:
${OPENCODE_SERVER_USERNAME}

Web password:
${OPENCODE_SERVER_PASSWORD}

SSH tunnel from Windows PowerShell:
ssh -N -L 127.0.0.1:${OPENCODE_PORT}:127.0.0.1:${OPENCODE_PORT} root@164.68.120.87
EOF
  chmod 0600 /root/private-ai-access.txt

  unset OPENCODE_SERVER_PASSWORD
  printf '\n[private-ai] Access details were stored in /root/private-ai-access.txt (mode 0600).\n'
  printf '[private-ai] The two AI ports are bound only to 127.0.0.1.\n'
  printf '[private-ai] No paid AI API key is configured.\n'
}

check_resume_preflight() {
  require_root
  [ -f "$PRIVATE_AI_MARKER" ] && [ ! -L "$PRIVATE_AI_MARKER" ] \
    || fail "The private AI ownership marker is missing or unsafe."
  [ "$(cat "$PRIVATE_AI_MARKER")" = "$INSTALLER_ID" ] \
    || fail "The private AI ownership marker is not recognized."
  [ "$(stat -c '%U:%G:%a' "$PRIVATE_AI_MARKER")" = 'root:root:600' ] \
    || fail "The private AI ownership marker metadata is invalid."
  id -u "$PRIVATE_AI_USER" >/dev/null 2>&1 \
    || fail "The dedicated private AI account is missing."
  getent group "$PRIVATE_AI_GROUP" >/dev/null \
    || fail "The dedicated private AI group is missing."

  local required_dir required_file required_bin
  for required_dir in \
    "$PRIVATE_AI_ROOT" "$PRIVATE_AI_HOME" "$PRIVATE_AI_WORKSPACE" \
    "$PRIVATE_AI_CACHE" "$PRIVATE_AI_MODEL_CACHE" "$PRIVATE_AI_STATE" \
    "$PRIVATE_AI_CONFIG" "$PRIVATE_AI_BIN"; do
    [ -d "$required_dir" ] && [ ! -L "$required_dir" ] \
      || fail "Unsafe or missing resume directory: $required_dir"
  done
  for required_file in \
    "${PRIVATE_AI_HOME}/.config/opencode/opencode.json" \
    "${PRIVATE_AI_HOME}/.config/opencode/instructions.md" \
    "${PRIVATE_AI_CONFIG}/opencode.env"; do
    [ -f "$required_file" ] && [ ! -L "$required_file" ] \
      || fail "Unsafe or missing resume configuration: $required_file"
  done
  for required_bin in \
    "${PRIVATE_AI_BIN}/llama-cli" "${PRIVATE_AI_BIN}/llama-server" \
    "${PRIVATE_AI_BIN}/opencode"; do
    [ -x "$required_bin" ] && [ ! -L "$required_bin" ] \
      || fail "Unsafe or missing resume executable: $required_bin"
    [ "$(stat -c '%U:%G' "$required_bin")" = 'root:root' ] \
      || fail "Unexpected executable owner: $required_bin"
  done
}

publish_install_receipt() {
  local receipt_tmp
  receipt_tmp=$(mktemp "${PRIVATE_AI_CONFIG}/.install-complete.XXXXXX")
  printf '%s\n' \
    "installer_id=${INSTALLER_ID}" \
    "completed_at=$(date -u +%FT%TZ)" \
    "llama_cpp_ref=${LLAMA_CPP_REF}" \
    "opencode_version=${OPENCODE_VERSION}" \
    "model_repo=${MODEL_REPO}" \
    "model_quant=${MODEL_QUANT}" \
    > "$receipt_tmp"
  chown root:root "$receipt_tmp"
  chmod 0600 "$receipt_tmp"
  mv -f -- "$receipt_tmp" "$PRIVATE_AI_COMPLETE"
}

resume_model_install() {
  check_resume_preflight
  if [ -e "$PRIVATE_AI_COMPLETE" ]; then
    [ -f "$PRIVATE_AI_COMPLETE" ] && [ ! -L "$PRIVATE_AI_COMPLETE" ] \
      || fail "The existing completion receipt is unsafe."
    [ "$(stat -c '%U:%G:%a' "$PRIVATE_AI_COMPLETE")" = 'root:root:600' ] \
      || fail "The existing completion receipt metadata is invalid."
    rm -f -- "$PRIVATE_AI_COMPLETE"
  fi
  log "Resuming the model download and smoke test from the existing cache."
  download_and_test_model
  log "Caching the OpenCode local provider."
  warm_opencode_provider
  log "Creating dedicated systemd services."
  write_systemd_units
  log "Starting and verifying the private agent."
  start_and_verify
  publish_install_receipt
  log "Resumed installation completed successfully."
}

main() {
  require_root
  log "Running read-only preflight checks."
  check_preflight
  log "Installing required Ubuntu packages."
  install_packages
  log "Creating the dedicated isolated account and directories."
  create_isolated_account
  log "Building llama.cpp from its official repository."
  build_llama_cpp
  log "Installing OpenCode under the dedicated account."
  install_opencode
  log "Writing private local-only configuration."
  write_agent_configuration
  log "Downloading and smoke-testing the local Qwen model."
  download_and_test_model
  log "Caching the OpenCode local provider."
  warm_opencode_provider
  log "Creating dedicated systemd services."
  write_systemd_units
  log "Starting and verifying the private agent."
  start_and_verify
  publish_install_receipt
  log "Installation completed successfully."
}

case "${1:-}" in
  '') main ;;
  --resume-model) resume_model_install ;;
  *) fail "Unsupported installer argument: $1" ;;
esac
