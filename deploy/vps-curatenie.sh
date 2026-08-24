#!/usr/bin/env bash
set -euo pipefail
umask 077

LOCK_FILE=/root/kelion/maintenance.lock
LOG_FILE=/root/kelion/maintenance.log

exec 9>"$LOCK_FILE"
flock -n 9 || exit 0

{
  printf 'maintenance %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  df -h / | tail -1

  # Imaginile etichetate și containerele de rollback rămân intacte. Se elimină
  # numai obiecte dangling/oprite mai vechi decât fereastra de recuperare.
  docker image prune --force --filter until=168h
  docker container prune --force --filter until=168h
  docker builder prune --force --filter until=168h --keep-storage 8GB
  journalctl --vacuum-size=200M

  df -h / | tail -1
} >> "$LOG_FILE" 2>&1

temporary_log=$(mktemp /root/kelion/maintenance-log.XXXXXX)
tail -c 262144 "$LOG_FILE" > "$temporary_log"
install -o root -g root -m 0600 "$temporary_log" "$LOG_FILE"
rm -f -- "$temporary_log"
