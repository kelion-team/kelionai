#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

# This helper now owns only the existing worker lock bootstrap. Runtime model
# selection is retired; the deployed OpenCode configuration is authoritative.
readonly LOCK_FILE='/run/lock/private-ai-model-switch.lock'

fail() {
  printf 'constructor-model-switch: ERROR: %s\n' "$1" >&2
  return "${2:-1}"
}

prepare_lock_file() {
  [ -d /run/lock ] && [ ! -L /run/lock ] && [ "$(stat -Lc '%u' /run/lock)" = 0 ] \
    || fail 'directorul lockului este nesigur'
  if [ -e "$LOCK_FILE" ] || [ -L "$LOCK_FILE" ]; then
    local metadata
    metadata=$(stat -Lc '%U:%G:%a:%h' "$LOCK_FILE" 2>/dev/null || true)
    [ -f "$LOCK_FILE" ] && [ ! -L "$LOCK_FILE" ] \
      && { [ "$metadata" = 'root:root:600:1' ] || [ "$metadata" = 'root:privateai:660:1' ]; } \
      || fail 'fișierul lock existent este nesigur'
  else
    ( set -o noclobber; umask 077; : > "$LOCK_FILE" ) 2>/dev/null \
      || [ -f "$LOCK_FILE" ] || fail 'fișierul lock nu poate fi creat'
  fi
  chown root:privateai "$LOCK_FILE"
  chmod 0660 "$LOCK_FILE"
  [ "$(stat -Lc '%U:%G:%a:%h' "$LOCK_FILE")" = 'root:privateai:660:1' ] \
    || fail 'metadatele lockului comun sunt invalide'
}

[ "$#" -eq 1 ] || fail 'utilizare: constructor-model-switch --prepare-lock' 64
if [ "$1" != '--prepare-lock' ]; then
  fail 'constructor_model_switch_retired' 64
fi
[ "$(id -u)" -eq 0 ] || fail 'root_required'
prepare_lock_file
printf 'constructor-model-switch: INTERLOCK=ready\n'
