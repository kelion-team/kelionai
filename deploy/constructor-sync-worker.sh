#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" == "0" ]] || { echo 'sincronizarea clonei rulează numai ca root' >&2; exit 1; }
repo=/var/lib/kelion-codex/repo
askpass=/opt/kelion-constructor/github-askpass.sh
token=${CREDENTIALS_DIRECTORY:?lipsește directorul systemd credentials}/github-worker-token
repository=${KELION_GITHUB_REPOSITORY:-}
[[ "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'repository configurat invalid' >&2; exit 1; }
[[ -d "$repo/.git" && ! -L "$repo" && ! -L "$repo/.git" && -f "$repo/.git/config" && ! -L "$repo/.git/config" ]] || { echo 'clona workerului lipsește sau nu este canonică' >&2; exit 1; }
[[ -f "$askpass" && ! -L "$askpass" && ! -w "$askpass" ]] || { echo 'askpass invalid' >&2; exit 1; }
[[ -f "$token" && ! -L "$token" ]] || { echo 'credentială GitHub read-only lipsă' >&2; exit 1; }

origin=$(runuser -u kelion-codex -- env HOME=/var/lib/kelion-codex \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git -C "$repo" remote get-url origin)
[[ "$origin" == "https://github.com/$repository.git" ]] || {
  echo 'remote worker necanonic' >&2
  exit 1
}
config_keys=$(runuser -u kelion-codex -- env HOME=/var/lib/kelion-codex \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git -C "$repo" config --local --name-only --list | sort -u)
unexpected=$(printf '%s\n' "$config_keys" | grep -Ev \
  '^(core\.repositoryformatversion|core\.filemode|core\.bare|core\.logallrefupdates|remote\.origin\.url|remote\.origin\.fetch|branch\.master\.remote|branch\.master\.merge)$' || true)
[[ -z "$unexpected" ]] || { echo 'config Git de transport sau executabil nepermis' >&2; exit 1; }

env HOME=/root \
  PATH=/usr/bin:/bin \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
  GIT_ASKPASS="$askpass" KELION_GITHUB_TOKEN_FILE="$token" \
  git -c safe.directory="$repo" -C "$repo" -c core.hooksPath=/dev/null -c core.fsmonitor=false \
  fetch --prune --no-tags origin '+refs/heads/master:refs/remotes/origin/master'
chown -R kelion-codex:kelion-codex "$repo/.git"
runuser -u kelion-codex -- git -C "$repo" rev-parse --verify 'origin/master^{commit}' >/dev/null
printf '%s\n' 'clona privată a workerului este sincronizată'
