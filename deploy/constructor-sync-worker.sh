#!/usr/bin/env bash
set -euo pipefail

[[ "$(id -u)" == "0" ]] || { echo 'sincronizarea clonei rulează numai ca root' >&2; exit 1; }
repo=/var/lib/kelion-codex/repo
askpass=/opt/kelion-constructor/github-askpass.sh
token=${CREDENTIALS_DIRECTORY:?lipsește directorul systemd credentials}/github-worker-token
[[ -d "$repo/.git" && ! -L "$repo" ]] || { echo 'clona workerului lipsește sau nu este canonică' >&2; exit 1; }
[[ -f "$askpass" && ! -L "$askpass" && ! -w "$askpass" ]] || { echo 'askpass invalid' >&2; exit 1; }
[[ -f "$token" && ! -L "$token" ]] || { echo 'credentială GitHub read-only lipsă' >&2; exit 1; }

runuser -u kelion-codex -- env \
  HOME=/var/lib/kelion-codex \
  PATH=/usr/bin:/bin \
  LANG=C.UTF-8 LC_ALL=C.UTF-8 \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  GIT_OPTIONAL_LOCKS=0 GIT_TERMINAL_PROMPT=0 \
  GIT_ASKPASS="$askpass" KELION_GITHUB_TOKEN_FILE="$token" \
  git -C "$repo" -c core.hooksPath=/dev/null -c core.fsmonitor=false \
  fetch --prune --no-tags origin '+refs/heads/master:refs/remotes/origin/master'

origin=$(runuser -u kelion-codex -- env HOME=/var/lib/kelion-codex \
  GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null \
  git -C "$repo" remote get-url origin)
[[ "$origin" == 'https://github.com/kelion-team/kelionai.git' ]] || {
  echo 'remote worker necanonic' >&2
  exit 1
}
git -C "$repo" rev-parse --verify 'origin/master^{commit}' >/dev/null
printf '%s\n' 'clona privată a workerului este sincronizată'

