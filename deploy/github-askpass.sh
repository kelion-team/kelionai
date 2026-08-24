#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in
  *sername*) printf '%s\n' 'x-access-token' ;;
  *assword*)
    [ -n "${KELION_GITHUB_TOKEN_FILE:-}" ]
    [ -f "$KELION_GITHUB_TOKEN_FILE" ]
    [ ! -L "$KELION_GITHUB_TOKEN_FILE" ]
    exec /bin/cat -- "$KELION_GITHUB_TOKEN_FILE"
    ;;
  *) exit 1 ;;
esac
