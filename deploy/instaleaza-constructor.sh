#!/usr/bin/env bash
set -euo pipefail

# Instalează numai codul, identitățile și unitățile dezactivate. Nu creează
# credentiale, nu clonează, nu activează timere și nu pornește servicii.
[[ "$(id -u)" == "0" ]] || { echo 'rulează ca root' >&2; exit 1; }
[[ "${KELION_CONSTRUCTOR_INSTALL:-0}" == "1" ]] || {
  echo 'setează KELION_CONSTRUCTOR_INSTALL=1 după review' >&2
  exit 1
}

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ -f "$repo_root/AGENTS.md" && -f "$repo_root/deploy/constructor-publisher.mjs" ]] || {
  echo 'sursa instalării nu este repository-ul Kelion validat' >&2
  exit 1
}

ensure_group() {
  local group_name="$1"
  getent group "$group_name" >/dev/null || groupadd --system "$group_name"
}

ensure_user() {
  local user_name="$1" home_dir="$2"
  if ! getent passwd "$user_name" >/dev/null; then
    useradd --system --add-subids-for-system --home-dir "$home_dir" --create-home --shell /usr/sbin/nologin "$user_name"
  fi
}

ensure_subids() {
  local user_name="$1" file start
  for file in /etc/subuid /etc/subgid; do
    [ -f "$file" ] && [ ! -L "$file" ]
    if ! grep -q "^${user_name}:" "$file"; then
      start=$(awk -F: 'BEGIN { max=99999 } { end=$2+$3-1; if (end>max) max=end } END { print int((max+65536)/65536)*65536 }' "$file")
      printf '%s:%s:65536\n' "$user_name" "$start" >> "$file"
    fi
  done
}

ensure_group kelion-handoff
ensure_user kelion-codex /var/lib/kelion-codex
ensure_user kelion-publisher /var/lib/kelion-publisher
ensure_user kelion-release /var/lib/kelion-release
ensure_subids kelion-codex
ensure_subids kelion-publisher
usermod -a -G kelion-handoff kelion-codex
usermod -a -G kelion-handoff kelion-publisher

install -d -o root -g root -m 0755 /opt/kelion-codex /opt/kelion-constructor /opt/kelion-constructor/lib
install -d -o root -g root -m 0755 /opt/kelion-codex/profile-home
install -d -o kelion-codex -g kelion-codex -m 0700 /var/lib/kelion-codex /var/lib/kelion-codex-auth /var/lib/kelion-codex/jobs
install -d -o kelion-publisher -g kelion-publisher -m 0700 /var/lib/kelion-publisher /var/lib/kelion-publisher/state
install -d -o kelion-release -g kelion-release -m 0700 /var/lib/kelion-release /var/lib/kelion-release/state
install -d -o root -g kelion-handoff -m 2770 /var/lib/kelion-constructor-handoff /var/lib/kelion-constructor-handoff/ready /var/lib/kelion-constructor-handoff/ack
install -d -o root -g root -m 0750 /etc/kelion

install -o root -g root -m 0555 "$repo_root/deploy/codex-worker.mjs" /opt/kelion-codex/codex-worker.mjs
install -o root -g root -m 0444 "$repo_root/deploy/codex-sandbox-probe.mjs" /opt/kelion-codex/codex-sandbox-probe.mjs
install -o root -g root -m 0444 "$repo_root/deploy/codex-worker.profile.toml" /opt/kelion-codex/profile-home/kelion-worker.config.toml
install -o root -g root -m 0555 "$repo_root/deploy/constructor-publisher.mjs" /opt/kelion-constructor/constructor-publisher.mjs
install -o root -g root -m 0555 "$repo_root/deploy/constructor-release.mjs" /opt/kelion-constructor/constructor-release.mjs
install -o root -g root -m 0555 "$repo_root/deploy/github-askpass.sh" /opt/kelion-constructor/github-askpass.sh
install -o root -g root -m 0555 "$repo_root/deploy/constructor-sync-worker.sh" /opt/kelion-constructor/constructor-sync-worker.sh
install -o root -g root -m 0444 "$repo_root/deploy/lib/constructor-service-client.mjs" /opt/kelion-constructor/lib/constructor-service-client.mjs
install -o root -g root -m 0444 "$repo_root/deploy/lib/github-fixed-client.mjs" /opt/kelion-constructor/lib/github-fixed-client.mjs

for unit in \
  kelion-constructor-sync.service \
  kelion-codex-worker.service kelion-codex-worker.timer \
  kelion-constructor-publisher.service kelion-constructor-publisher.timer \
  kelion-constructor-release.service kelion-constructor-release.timer
do
  systemd-analyze verify "$repo_root/deploy/systemd/$unit"
  install -o root -g root -m 0444 "$repo_root/deploy/systemd/$unit" "/etc/systemd/system/$unit"
done

rm -f -- \
  /etc/kelion/codex-worker.enabled \
  /etc/kelion/constructor-publisher.enabled \
  /etc/kelion/constructor-release.enabled
systemctl daemon-reload
echo 'Constructor instalat dezactivat; configurarea si activarea sunt etape separate.'
