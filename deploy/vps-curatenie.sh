#!/usr/bin/env bash
set -euo pipefail
umask 077

PUBLICATION_LOCK_FILE=/root/kelion/publicare.lock
RECOVERY_JOURNAL=/root/kelion/runtime/destructive-cutover-recovery.json
LOG_FILE=/root/kelion/maintenance.log

# Același lock este deținut de deploy.sh pe toată publicarea. Curățenia trebuie
# să fie complet absentă din fereastra în care containerele sunt oprite pentru
# cutover/rollback; altfel `container prune` șterge exact runtime-ul de salvare.
if [ -e "$PUBLICATION_LOCK_FILE" ] || [ -L "$PUBLICATION_LOCK_FILE" ]; then
  [ -f "$PUBLICATION_LOCK_FILE" ] && [ ! -L "$PUBLICATION_LOCK_FILE" ] || exit 1
fi
exec 9<>"$PUBLICATION_LOCK_FILE"
publication_fd_path=$(readlink "/proc/self/fd/9") || exit 1
[ "$publication_fd_path" = "$PUBLICATION_LOCK_FILE" ] || exit 1
[ -f "/proc/self/fd/9" ] || exit 1
publication_fd_identity=$(stat -Lc '%d:%i' -- "/proc/self/fd/9") || exit 1
[ "$(stat -Lc '%u:%g:%a:%h' -- "/proc/self/fd/9")" = '0:0:600:1' ] || exit 1
[ ! -L "$PUBLICATION_LOCK_FILE" ] || exit 1
[ "$publication_fd_identity" = "$(stat -Lc '%d:%i' -- "$PUBLICATION_LOCK_FILE")" ] || exit 1
flock -n 9 || exit 0

{
  printf 'maintenance %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
  df -h / | tail -1

  # Imaginile etichetate și containerele de rollback rămân intacte. Se elimină
  # numai obiecte dangling/oprite mai vechi decât fereastra de recuperare.
  docker image prune --force --filter until=168h
  # Jurnalul este șters numai după succes sau rollback verificat. Orice jurnal
  # prezent (inclusiv unul invalid/symlink) înseamnă fail-closed: containerele
  # oprite pot fi singura cale de revenire și nu sunt eligibile pentru prune.
  if [ -e "$RECOVERY_JOURNAL" ] || [ -L "$RECOVERY_JOURNAL" ]; then
    printf 'container prune skipped: destructive cutover recovery is active\n'
  else
    docker container prune --force --filter until=168h
  fi
  docker builder prune --force --filter until=168h --keep-storage 8GB

  # Toate operațiile Docker s-au încheiat; abia acum publicarea poate lua lock-ul.
  flock -u 9
  exec 9>&-
  journalctl --vacuum-size=200M

  df -h / | tail -1
} >> "$LOG_FILE" 2>&1

temporary_log=$(mktemp /root/kelion/maintenance-log.XXXXXX)
tail -c 262144 "$LOG_FILE" > "$temporary_log"
install -o root -g root -m 0600 "$temporary_log" "$LOG_FILE"
rm -f -- "$temporary_log"
