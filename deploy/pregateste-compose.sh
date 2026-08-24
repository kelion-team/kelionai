#!/usr/bin/env bash
set -euo pipefail
umask 077

VERSION=v5.4.0
EXPECTED_SHA256=837fd1d35bf6a494f41b5b5988269a7be79de337cf1a1a6ff0e45ab51bb4e9be
SOURCE="https://github.com/docker/compose/releases/download/$VERSION/docker-compose-linux-x86_64"
DESTINATION=/root/kelion/bin/docker-compose

[ "$(uname -s)" = Linux ] && [ "$(uname -m)" = x86_64 ] || {
  printf '%s\n' 'docker-compose: platformă nesuportată'
  exit 1
}

install -d -o root -g root -m 0755 /root/kelion/bin
temporary=$(mktemp /root/kelion/bin/docker-compose.XXXXXX)
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --location \
  --output "$temporary" "$SOURCE"
printf '%s  %s\n' "$EXPECTED_SHA256" "$temporary" | sha256sum --check --status
chmod 0755 "$temporary"
"$temporary" version >/dev/null
mv "$temporary" "$DESTINATION"
printf 'docker-compose %s: pregătit și verificat\n' "$VERSION"
