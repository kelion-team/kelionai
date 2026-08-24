#!/usr/bin/env bash
set -euo pipefail
umask 077

DESTINATION=${KELION_SECCOMP_DESTINATION:-/root/kelion/runtime/playwright-seccomp-v1.62.1.json}
SOURCE=https://api.github.com/repos/microsoft/playwright/contents/utils/docker/seccomp_profile.json?ref=v1.62.1
EXPECTED_SHA256=cc3e61cabda6bbc1e53e54d27ba4d55a9d3be829b6dd1a596f4a7b31b1cc7849

case "$DESTINATION" in
  /*/playwright-seccomp-v1.62.1.json) ;;
  *) printf '%s\n' 'playwright-seccomp: destinație invalidă'; exit 1 ;;
esac
destination_dir=$(dirname "$DESTINATION")
mkdir -p "$destination_dir"
temporary=$(mktemp "$destination_dir/seccomp.XXXXXX")
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT

curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --header 'Accept: application/vnd.github.raw+json' \
  --output "$temporary" "$SOURCE"
printf '%s  %s\n' "$EXPECTED_SHA256" "$temporary" | sha256sum --check --status
install -o root -g root -m 0644 "$temporary" "$DESTINATION"
printf '%s\n' 'playwright-seccomp: pregătit și verificat'
