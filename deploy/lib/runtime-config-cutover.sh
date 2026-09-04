#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf 'runtime-cutover: %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die 'rulează numai ca root'
recover_only=0
validate_only=0
leave_constructor_quiesced=0
discard_unmutated_prepared=0
discard_target_commit=''
discard_unmutated_gate_prepared=0
discard_gate_request_id=''
discard_gate_commit=''
discard_gate_active_commit=''
boot_recovery=${KELION_RECOVERY_BOOT:-0}
case "$boot_recovery" in 0|1) ;; *) die 'KELION_RECOVERY_BOOT trebuie 0 sau 1' ;; esac
activation_resume_operation=${KELION_ACTIVATION_RESUME_OPERATION:-}
case "$activation_resume_operation" in
  ''|activate-worker-publisher|activate-release) ;;
  *) die 'KELION_ACTIVATION_RESUME_OPERATION este invalid' ;;
esac
deploy_quiesce_proof=${KELION_DEPLOY_QUIESCE_PROOF:-0}
case "$deploy_quiesce_proof" in 0|1) ;; *) die 'KELION_DEPLOY_QUIESCE_PROOF trebuie 0 sau 1' ;; esac
defer_secret_gates=${KELION_DEFER_SECRET_GATES_TO_STRICT_CUTOVER:-0}
case "$defer_secret_gates" in 0|1) ;; *) die 'KELION_DEFER_SECRET_GATES_TO_STRICT_CUTOVER trebuie 0 sau 1' ;; esac
constructor_upgrade_owner=${KELION_CONSTRUCTOR_UPGRADE_OWNER:-0}
case "$constructor_upgrade_owner" in 0|1) ;; *) die 'KELION_CONSTRUCTOR_UPGRADE_OWNER trebuie 0 sau 1' ;; esac
constructor_upgrade_source_commit=${KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT:-}
if [ "$constructor_upgrade_owner" = 1 ]; then
  [[ "$constructor_upgrade_source_commit" =~ ^[0-9a-f]{40}$ ]] \
    || die 'KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT este invalid'
else
  [ -z "$constructor_upgrade_source_commit" ] \
    || die 'sursa upgrade-ului este permisă numai ownerului explicit'
fi
unset KELION_CONSTRUCTOR_UPGRADE_OWNER
unset KELION_CONSTRUCTOR_UPGRADE_SOURCE_COMMIT
deploy_owner_request_id=${KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID:-}
deploy_owner_commit=${KELION_DEPLOY_QUIESCE_OWNER_COMMIT:-}
if [ -n "$deploy_owner_request_id" ] || [ -n "$deploy_owner_commit" ]; then
  [[ "$deploy_owner_request_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
    || die 'KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID este invalid'
  [[ "$deploy_owner_commit" =~ ^[0-9a-f]{40}$ ]] || die 'KELION_DEPLOY_QUIESCE_OWNER_COMMIT este invalid'
fi
stage_root=''
stage_canonical=''
validation_logical=''
validation_file=''
compose_file=''
case "${1:-}" in
  --discard-unmutated-gate-prepared)
    [ "$#" -eq 5 ] \
      || die 'utilizare: runtime-config-cutover.sh --discard-unmutated-gate-prepared REQUEST_ID COMMIT ACTIVE_COMMIT COMPOSE_FILE'
    [[ "$2" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]] \
      || die 'requestul discard gate este invalid'
    [[ "$3" =~ ^[0-9a-f]{40}$ ]] || die 'commitul discard gate este invalid'
    [[ "$4" =~ ^[0-9a-f]{40}$ ]] || die 'commitul activ așteptat pentru discard gate este invalid'
    [ "$3" != "$4" ] || die 'commitul candidat și commitul activ al discardului gate trebuie să difere'
    discard_unmutated_gate_prepared=1
    discard_gate_request_id=$2
    discard_gate_commit=$3
    discard_gate_active_commit=$4
    recover_only=1
    compose_file=$5
    ;;
  --discard-unmutated-prepared)
    [ "$#" -eq 3 ] \
      || die 'utilizare: runtime-config-cutover.sh --discard-unmutated-prepared COMMIT COMPOSE_FILE'
    [[ "$2" =~ ^[0-9a-f]{40}$ ]] || die 'commitul recovery este invalid'
    discard_unmutated_prepared=1
    discard_target_commit=$2
    recover_only=1
    leave_constructor_quiesced=1
    compose_file=$3
    ;;
  --recover-only)
    [ "$#" -eq 2 ] || { [ "$#" -eq 3 ] && [ "$3" = --leave-constructor-quiesced ]; } \
      || die 'utilizare: runtime-config-cutover.sh --recover-only COMPOSE_FILE [--leave-constructor-quiesced]'
    recover_only=1
    compose_file=$2
    [ "$#" -eq 2 ] || leave_constructor_quiesced=1
    ;;
  --validate-env-file)
    [ "$#" -eq 3 ] || die 'utilizare: runtime-config-cutover.sh --validate-env-file LOGICAL FILE'
    validate_only=1
    validation_logical=$2
    validation_file=$3
    ;;
  *)
    [ "$#" -eq 2 ] || { [ "$#" -eq 3 ] && [ "$3" = --leave-constructor-quiesced ]; } \
      || die 'utilizare: runtime-config-cutover.sh STAGE_DIR COMPOSE_FILE [--leave-constructor-quiesced]'
    stage_root=$1
    compose_file=$2
    [ "$#" -eq 2 ] || leave_constructor_quiesced=1
    ;;
esac
if [ -n "$activation_resume_operation" ]; then
  [ "$recover_only" = 1 ] && [ "$discard_unmutated_prepared" = 0 ] \
    && [ "$discard_unmutated_gate_prepared" = 0 ] \
    || die 'resume-ul activării este permis numai în recover-only generic'
  if [ "$leave_constructor_quiesced" = 1 ]; then
    [ "$activation_resume_operation" = activate-worker-publisher ] \
      || die 'resume+leave este rezervat migrării worker/publisher pin-uite'
  fi
fi

# Bariera minimă rulează înainte de validarea compose-ului, inventarul de
# utilitare și publication lock. La boot, orice astfel de eroare trebuie să
# lase stamp-ul absent și inclusiv unitățile legacy disabled/inactive.
validate_constructor_unit_file_state() {
  local unit=$1 state
  state=$(systemctl show "$unit" --property=UnitFileState --value 2>/dev/null) || return 1
  case "$unit" in
    kelion-codex-worker.timer|kelion-constructor-publisher.timer|kelion-constructor-release.timer)
      [ "$state" = disabled ] ;;
    kelion-codex-worker.service|kelion-constructor-publisher.service|kelion-constructor-release.service)
      # Serviciile oneshot sunt intenționat statice: numai timerele le pot
      # porni, iar validatorul unității interzice [Install]/WantedBy.
      [ "$state" = static ] ;;
    *) return 1 ;;
  esac
}

validate_constructor_prepublication_unit_file_state() {
  local unit=$1 state
  state=$(systemctl show "$unit" --property=UnitFileState --value 2>/dev/null) || return 1
  case "$unit" in
    kelion-codex-worker.timer|kelion-constructor-publisher.timer|kelion-constructor-release.timer)
      [ "$state" = disabled ] ;;
    kelion-codex-worker.service|kelion-constructor-publisher.service|kelion-constructor-release.service)
      case "$state" in disabled|static) ;; *) return 1 ;; esac ;;
    *) return 1 ;;
  esac
}

# Serviciile canonice sunt statice și `systemctl disable` întoarce non-zero
# chiar dacă postcondiția sigură este deja satisfăcută. Oprim sincron serviciul,
# încercăm să retragem orice symlink [Install] legacy, iar apelantul validează
# apoi UnitFileState, ActiveState și absența joburilor. Codul de ieșire al
# mutatorului nu poate înlocui acele postcondiții.
stop_and_disable_constructor_timer() {
  local unit=$1
  case "$unit" in
    kelion-codex-worker.timer|kelion-constructor-publisher.timer|kelion-constructor-release.timer) ;;
    *) return 1 ;;
  esac
  systemctl stop "$unit" >/dev/null 2>&1 || :
  systemctl disable --no-reload "$unit" >/dev/null 2>&1 || :
}

stop_and_disable_constructor_service() {
  local unit=$1
  case "$unit" in
    kelion-codex-worker.service|kelion-constructor-publisher.service|kelion-constructor-release.service) ;;
    *) return 1 ;;
  esac
  systemctl stop "$unit" >/dev/null 2>&1 || :
  systemctl disable --no-reload "$unit" >/dev/null 2>&1 || :
}

report_quiesce_postcondition_failure() {
  printf 'runtime-cutover: quiesce-postcondition:%s:%s\n' "$1" "$2" >&2
}

early_recover_only_barrier() {
  local unit state failed=0 ready_root=/run/kelion ready_stamp=/run/kelion/runtime-config-recovery.ready
  if [ -e "$ready_root" ] || [ -L "$ready_root" ]; then
    if [ -d "$ready_root" ] && [ ! -L "$ready_root" ] \
      && [ "$(stat -c '%u:%g:%a' "$ready_root" 2>/dev/null)" = '0:0:755' ]; then
      if [ -e "$ready_stamp" ] || [ -L "$ready_stamp" ]; then
        if [ -d "$ready_stamp" ] && [ ! -L "$ready_stamp" ]; then
          rmdir -- "$ready_stamp" || failed=1
        else
          rm -f -- "$ready_stamp" || failed=1
        fi
        sync -f "$ready_root" || failed=1
      fi
    else
      failed=1
    fi
  fi
  for unit in \
    kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer \
    kelion-codex-worker.service kelion-constructor-publisher.service kelion-constructor-release.service \
    kelion-constructor-sync.service kelion-constructor-model-control.service; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    case "$unit" in
      kelion-constructor-sync.service|kelion-constructor-model-control.service) systemctl stop "$unit" >/dev/null 2>&1 || : ;;
      *.timer) stop_and_disable_constructor_timer "$unit" || failed=1 ;;
      *.service) stop_and_disable_constructor_service "$unit" || failed=1 ;;
      *) failed=1 ;;
    esac
  done
  systemctl daemon-reload || { report_quiesce_postcondition_failure systemd daemon-reload; failed=1; }
  for unit in \
    kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer \
    kelion-codex-worker.service kelion-constructor-publisher.service kelion-constructor-release.service \
    kelion-constructor-sync.service kelion-constructor-model-control.service; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    state=$(systemctl show "$unit" --property=ActiveState --value 2>/dev/null) \
      || { report_quiesce_postcondition_failure "$unit" active-state-query; failed=1; continue; }
    case "$state" in inactive|failed) ;; *) report_quiesce_postcondition_failure "$unit" active-state; failed=1 ;; esac
    if [ "$unit" != kelion-constructor-sync.service ] && [ "$unit" != kelion-constructor-model-control.service ]; then
      validate_constructor_prepublication_unit_file_state "$unit" \
        || { report_quiesce_postcondition_failure "$unit" unit-file-state; failed=1; }
    fi
    if [ -n "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ]; then
      report_quiesce_postcondition_failure "$unit" pending-job; failed=1
    fi
  done
  [ ! -e /run/kelion-constructor-model-control/control.sock ] \
    && [ ! -L /run/kelion-constructor-model-control/control.sock ] || failed=1
  [ "$failed" = 0 ]
}

ROOT=/root/kelion
CONFIG_ROOT=$ROOT/config
SECRET_ROOT=$ROOT/secrets
RUNTIME_ROOT=$ROOT/runtime
COMPOSE_BIN=$ROOT/bin/docker-compose
PUBLICATION_LOCK=$ROOT/publicare.lock
JOURNAL=$RUNTIME_ROOT/runtime-config-cutover.journal
ACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-activation.journal
GATE_JOURNAL=$RUNTIME_ROOT/constructor-gate-refresh.journal
DEPLOY_QUIESCE_JOURNAL=$RUNTIME_ROOT/constructor-deploy-quiesce.journal
UNIT_MIGRATION_PENDING=$RUNTIME_ROOT/constructor-unit-migration.pending
REACTIVATION_JOURNAL=$RUNTIME_ROOT/constructor-reactivation.journal
UPGRADE_JOURNAL=$RUNTIME_ROOT/constructor-upgrade.journal
MAX_MODEL_JOURNAL=$RUNTIME_ROOT/constructor-max-model.journal
DESTRUCTIVE_RECOVERY_JOURNAL=$RUNTIME_ROOT/destructive-cutover-recovery.json
READY_ROOT=/run/kelion
READY_STAMP=$READY_ROOT/runtime-config-recovery.ready
ACTIVATION_PENDING=$READY_ROOT/constructor-activation.pending

for early_tool in flock readlink stat; do
  command -v "$early_tool" >/dev/null 2>&1 || die "lipsește utilitarul $early_tool"
done
if [ "${KELION_CUTOVER_LOCK_HELD:-0}" = 1 ]; then
  [ -f /proc/$$/fd/9 ] \
    && [ "$(readlink /proc/$$/fd/9)" = "$PUBLICATION_LOCK" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] \
    || die 'FD9 moștenit nu este lock-ul canonic de publicare'
  publication_fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9)
  flock -n 9 || die 'lock-ul de publicare moștenit nu este deținut'
else
  [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$PUBLICATION_LOCK")" = '0:0:600:1' ] \
    || die 'pathul lock-ului de publicare este nesigur'
  exec 9<>"$PUBLICATION_LOCK"
  [ -f /proc/$$/fd/9 ] \
    && [ "$(readlink /proc/$$/fd/9)" = "$PUBLICATION_LOCK" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] \
    || die 'FD9 nu este lock-ul canonic de publicare'
  publication_fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9)
  [ "$publication_fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] \
    || die 'pathul și FD9 nu indică același lock de publicare'
  flock -n 9 || die 'altă operație de publicare este activă'
fi
[ ! -L "$PUBLICATION_LOCK" ] \
  && [ "$(readlink /proc/$$/fd/9)" = "$PUBLICATION_LOCK" ] \
  && [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] \
  && [ "$publication_fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] \
  || die 'lock-ul de publicare s-a schimbat după flock'

if [ -e "$MAX_MODEL_JOURNAL" ] || [ -L "$MAX_MODEL_JOURNAL" ]; then
  die 'o tranzacție max-model este pending; cutover-ul runtime este refuzat'
fi

# Bariera rămâne înaintea validării compose/tooling, dar numai după
# serializarea cu toți ceilalți mutatori ai publicației.
if [ "$recover_only" = 1 ]; then
  early_recover_only_barrier \
    || die 'bariera recovery nu a putut retrage stamp-ul și opri toate unitățile înainte de preflight'
fi

command -v realpath >/dev/null 2>&1 || die 'lipsește utilitarul realpath'
if [ "$recover_only" = 0 ] && [ "$validate_only" = 0 ]; then
  [[ "$stage_root" =~ ^/root/kelion/runtime/runtime-cutover\.[A-Za-z0-9]+$ ]] \
    || die 'directorul de staging este în afara runtime-ului permis'
  [ -d "$stage_root" ] && [ ! -L "$stage_root" ] || die 'directorul de staging lipsește sau este symlink'
  stage_canonical=$(realpath -e -- "$stage_root") || die 'directorul de staging nu poate fi canonizat'
  [ "$stage_canonical" = "$stage_root" ] || die 'directorul de staging nu este calea canonică exactă'
  [ "$(stat -c '%u:%g:%a' "$stage_canonical")" = '0:0:700' ] || die 'directorul de staging trebuie să fie root:root mode 0700'
  stage_root=$stage_canonical
  [ -f "$stage_root/manifest" ] && [ ! -L "$stage_root/manifest" ] || die 'manifestul de staging lipsește'
  [ -d "$stage_root/files" ] && [ ! -L "$stage_root/files" ] || die 'fișierele de staging lipsesc'
fi
if [ "$validate_only" = 0 ]; then
  [ -f "$compose_file" ] && [ ! -L "$compose_file" ] || die 'compose.production.yml lipsește sau este symlink'
fi

for tool in awk cmp curl dirname docker find findmnt flock getent grep jq mktemp mountpoint od python3 readlink rmdir sed sha256sum sleep sort stat sync systemctl tail tr uniq wc; do
  command -v "$tool" >/dev/null 2>&1 || die "lipsește utilitarul $tool"
done

upgrade_journal_phase=''
if [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]; then
  [ "$constructor_upgrade_owner" = 1 ] \
    || die 'un upgrade Constructor exterior este pending; cutover-ul generic este refuzat'
  [ "${KELION_CUTOVER_LOCK_HELD:-0}" = 1 ] \
    || die 'ownerul upgrade-ului Constructor trebuie să moștenească publication lock'
  [ -f "$UPGRADE_JOURNAL" ] && [ ! -L "$UPGRADE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$UPGRADE_JOURNAL")" = '0:0:600:1' ] \
    && jq -e --arg sourceCommit "$constructor_upgrade_source_commit" '
      .schema == 1 and .kind == "constructor-upgrade" and
      (.phase == "armed" or .phase == "installed" or .phase == "committed") and
      .sourceCommit == $sourceCommit and
      (.snapshotRoot | strings | test("^/root/kelion/runtime/constructor-upgrade\\.[A-Za-z0-9]+$")) and
      (.stateSha256 | strings | test("^[0-9a-f]{64}$")) and
      (keys == ["kind","phase","schema","snapshotRoot","sourceCommit","stateSha256"])
    ' "$UPGRADE_JOURNAL" >/dev/null \
    || die 'jurnalul exterior al upgrade-ului Constructor este nesigur'
  upgrade_journal_phase=$(jq -er '.phase' "$UPGRADE_JOURNAL")
  if [ "$validate_only" = 0 ] && [ "$upgrade_journal_phase" != committed ]; then
    [ "$leave_constructor_quiesced" = 1 ] \
      || die 'jurnalul upgrade-ului blochează ready și timerele până la faza committed durabilă'
  fi
else
  [ "$constructor_upgrade_owner" = 0 ] \
    || die 'ownerul upgrade-ului Constructor nu are jurnalul exterior durabil'
fi

if [ -e "$UNIT_MIGRATION_PENDING" ] || [ -L "$UNIT_MIGRATION_PENDING" ]; then
  [ -f "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$UNIT_MIGRATION_PENDING")" = '0:0:600:1' ] \
    && [ "$(wc -l < "$UNIT_MIGRATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$UNIT_MIGRATION_PENDING" \
    || die 'bariera unit-only existentă este nesigură'
fi

validate_reactivation_journal() {
  if [ ! -e "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ]; then return 0; fi
  [ -f "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$REACTIVATION_JOURNAL")" = '0:0:600:1' ] \
    && jq -e '
      .schema == 1 and .kind == "constructor-reactivation" and .phase == "pending" and
      (keys == ["kind","phase","schema"])
    ' "$REACTIVATION_JOURNAL" >/dev/null
}

publish_reactivation_journal() {
  local temporary
  validate_reactivation_journal || return 1
  if [ -f "$REACTIVATION_JOURNAL" ]; then return 0; fi
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-reactivation.journal.XXXXXX") || return 1
  if jq -nc '{schema:1,kind:"constructor-reactivation",phase:"pending"}' > "$temporary" \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$REACTIVATION_JOURNAL" \
    && fsync_path "$RUNTIME_ROOT"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

clear_reactivation_journal() {
  validate_reactivation_journal || return 1
  if [ -f "$REACTIVATION_JOURNAL" ]; then
    rm -f -- "$REACTIVATION_JOURNAL" || return 1
    fsync_path "$RUNTIME_ROOT" || return 1
  fi
}

clear_reactivation_journal_or_defer() {
  validate_reactivation_journal || return 1
  if [ "$constructor_upgrade_owner" = 1 ] \
    && [ "$upgrade_journal_phase" = committed ] \
    && { [ -e "$UPGRADE_JOURNAL" ] || [ -L "$UPGRADE_JOURNAL" ]; }; then
    # Upgrade-ul exterior trebuie să poată șterge propriul jurnal înainte ca
    # controllerul să pornească, dar markerul reactivării rămâne autoritatea
    # crash-safe până când ownerul cheamă recover-only generic după acel clear.
    [ -f "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ]
    return
  fi
  clear_reactivation_journal
}

validate_reactivation_journal \
  || die 'jurnalul persistent al reactivării Constructor este nesigur'
if [ "$recover_only" = 0 ] && [ "$validate_only" = 0 ] && [ "$leave_constructor_quiesced" = 0 ] \
  && { [ -e "$REACTIVATION_JOURNAL" ] || [ -L "$REACTIVATION_JOURNAL" ]; }; then
  die 'o reactivare Constructor întreruptă trebuie reluată prin recover-only'
fi

fsync_path() {
  python3 - "$1" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
mode = os.stat(path, follow_symlinks=False).st_mode
if stat.S_ISLNK(mode):
    raise SystemExit(1)
flags = os.O_RDONLY | (os.O_DIRECTORY if stat.S_ISDIR(mode) else 0)
descriptor = os.open(path, flags)
try:
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

validate_constructor_marker_root() {
  [ -d /etc/kelion ] && [ ! -L /etc/kelion ] \
    && [ "$(realpath -e -- /etc/kelion)" = /etc/kelion ] \
    && [ "$(stat -c '%u:%g:%a' /etc/kelion)" = '0:0:755' ]
}

ensure_constructor_marker_root_durable() {
  local ownership mode
  if [ -e /etc/kelion ] || [ -L /etc/kelion ]; then
    [ -d /etc/kelion ] && [ ! -L /etc/kelion ] \
      && [ "$(realpath -e -- /etc/kelion)" = /etc/kelion ] || return 1
    ownership=$(stat -c '%u:%g' /etc/kelion) || return 1
    mode=$(stat -c '%a' /etc/kelion) || return 1
    [ "$ownership" = '0:0' ] || return 1
    case "$mode" in 750|755) ;; *) return 1 ;; esac
    chmod 0755 /etc/kelion || return 1
  else
    install -d -o root -g root -m 0755 /etc/kelion || return 1
  fi
  validate_constructor_marker_root || return 1
  # fsync pe director persistă ACL-ul; fsync pe /etc persistă și eventuala creare.
  fsync_path /etc/kelion && fsync_path /etc
}

clear_runtime_ready_stamp() {
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
      && [ "$(stat -c '%u:%g:%a' "$READY_STAMP")" = '0:0:444' ] || return 1
    rm -f -- "$READY_STAMP" || return 1
    fsync_path "$READY_ROOT" || return 1
  fi
}

validate_activation_pending() {
  if [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ]; then return 0; fi
  [ -f "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] \
    && [ "$(stat -c '%u:%g:%a' "$ACTIVATION_PENDING")" = '0:0:444' ] \
    && [ "$(wc -l < "$ACTIVATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$ACTIVATION_PENDING"
}

publish_activation_pending() {
  local temporary
  if [ -e "$READY_ROOT" ] || [ -L "$READY_ROOT" ]; then
    [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
      && [ "$(stat -c '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] || return 1
  else
    install -d -o root -g root -m 0755 "$READY_ROOT" || return 1
    fsync_path /run || return 1
  fi
  # Pending și ready sunt capabilități mutual exclusive. Ready dispare
  # durabil înainte ca gate-ul negativ al unităților să fie publicat.
  clear_runtime_ready_stamp || return 1
  validate_activation_pending || return 1
  if [ -f "$ACTIVATION_PENDING" ]; then return 0; fi
  temporary=$(mktemp "$READY_ROOT/.constructor-activation.pending.XXXXXX") || return 1
  if printf 'schema=1\n' > "$temporary" \
    && chown root:root "$temporary" && chmod 0444 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$ACTIVATION_PENDING" \
    && fsync_path "$READY_ROOT"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

clear_activation_pending() {
  validate_activation_pending || return 1
  if [ -f "$ACTIVATION_PENDING" ]; then
    rm -f -- "$ACTIVATION_PENDING" || return 1
    fsync_path "$READY_ROOT" || return 1
  fi
}

retract_runtime_ready_stamp_for_recovery() {
  # Recovery-ul de boot nu poate avea încredere în ACL-ul/conținutul stamp-ului
  # pe care tocmai trebuie să-l invalideze. Validăm numai părintele fix și
  # ștergem nodul exact fără să urmăm vreun symlink.
  if [ ! -e "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ]; then return 0; fi
  [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
    && [ "$(stat -c '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] || return 1
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    if [ -d "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ]; then
      rmdir -- "$READY_STAMP" || return 1
    else
      rm -f -- "$READY_STAMP" || return 1
    fi
    fsync_path "$READY_ROOT" || return 1
  fi
}

validate_runtime_ready_stamp() {
  validate_activation_pending || return 1
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] || return 1
    [ -f "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
      && [ "$(stat -c '%u:%g:%a' "$READY_STAMP")" = '0:0:444' ] \
      && [ "$(wc -l < "$READY_STAMP")" -eq 1 ] \
      && grep -qx 'schema=1' "$READY_STAMP" || return 1
  fi
}

validate_unit_migration_pending() {
  if [ ! -e "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ]; then return 0; fi
  [ -f "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] \
    && [ "$(stat -c '%u:%g:%a' "$UNIT_MIGRATION_PENDING")" = '0:0:600' ] \
    && [ "$(wc -l < "$UNIT_MIGRATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$UNIT_MIGRATION_PENDING"
}

publish_unit_migration_pending() {
  local temporary
  validate_unit_migration_pending || return 1
  # Pending și ready sunt capabilități mutual exclusive. Retragerea stamp-ului
  # este durabilă înainte de publicarea intentului și înainte de primul stop.
  clear_runtime_ready_stamp || return 1
  if [ -f "$UNIT_MIGRATION_PENDING" ]; then return 0; fi
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-unit-migration.pending.XXXXXX") || return 1
  if printf 'schema=1\n' > "$temporary" \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$UNIT_MIGRATION_PENDING" \
    && fsync_path "$RUNTIME_ROOT"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

clear_unit_migration_pending() {
  validate_unit_migration_pending || return 1
  if [ -f "$UNIT_MIGRATION_PENDING" ]; then
    rm -f -- "$UNIT_MIGRATION_PENDING" || return 1
    fsync_path "$RUNTIME_ROOT" || return 1
  fi
}

publish_runtime_ready_stamp() {
  local temporary
  # Stamp-ul este o capabilitate de pornire pentru toate unitățile Constructor.
  # Nu îl publicăm niciodată peste o tuplă live config/unități parțială.
  validate_unit_migration_pending || return 1
  [ ! -e "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] || return 1
  validate_activation_pending || return 1
  [ ! -e "$ACTIVATION_PENDING" ] && [ ! -L "$ACTIVATION_PENDING" ] || return 1
  validate_live_runtime_contract || return 1
  install -d -o root -g root -m 0755 "$READY_ROOT" || return 1
  clear_runtime_ready_stamp || return 1
  temporary=$(mktemp "$READY_ROOT/.runtime-config-recovery.ready.XXXXXX") || return 1
  if printf 'schema=1\n' > "$temporary" \
    && chown root:root "$temporary" && chmod 0444 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$READY_STAMP" \
    && fsync_path "$READY_ROOT"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

validate_deploy_quiesce_journal() {
  if [ ! -e "$DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$DEPLOY_QUIESCE_JOURNAL" ]; then return 0; fi
  [ -f "$DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$DEPLOY_QUIESCE_JOURNAL" ] \
    && [ "$(stat -c '%u:%g:%a' "$DEPLOY_QUIESCE_JOURNAL")" = '0:0:600' ] \
    && jq -e '((.schema == 1 and (.phase == "armed" or .phase == "quiesced")) or
      (.schema == 2 and
        (.phase == "armed" or .phase == "quiesced" or .phase == "active-prepared" or .phase == "active-published" or .phase == "gate-prepared" or .phase == "gate-committed") and
        (.activeBefore | strings | test("^([0-9a-f]{40}|legacy)$")) and
        (.activeVersionBefore | strings | test("^[0-9a-f]{7,40}$")) and
        (.activeBefore as $activeBefore | .activeVersionBefore as $activeVersionBefore |
          if $activeBefore == "legacy" then true
          else ($activeBefore | startswith($activeVersionBefore)) end) and
        (.legacyContainers | type == "array" and length <= 3 and length == (unique | length) and
          all(.[]; . == "kelionai-app" or . == "omniroute" or . == "kelionai-coqui")) and
        (if .activeBefore == "legacy" then
          (.legacyContainers | length >= 1 and index("kelionai-app") != null)
        else (.legacyContainers | length == 0) end) and
        (.legacyRestartPolicies | type == "object") and
        (.legacyContainers as $containers |
          (.legacyRestartPolicies | keys | sort) == ($containers | sort) and
          all(.legacyRestartPolicies[];
            type == "string" and test("^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$"))) and
        (.proxyIntent | type == "object") and
        (if .activeBefore == "legacy" then .proxyIntent.activeSlotBefore == "legacy"
          else (.proxyIntent.activeSlotBefore == "blue" or .proxyIntent.activeSlotBefore == "green") end) and
        (.proxyIntent.activeSlotBefore | strings | test("^(legacy|blue|green)$")) and
        (.proxyIntent.targetSlot | strings | test("^(blue|green)$")) and
        .proxyIntent.activeSlotBefore != .proxyIntent.targetSlot and
        (if .proxyIntent.activeSlotBefore == "legacy" then
          .proxyIntent.targetSlot == "blue" and .proxyIntent.managedProxyWasRunning == false and
          .proxyIntent.legacyProxyWasRunning == true and
          (.proxyIntent.legacyProxyRestartPolicy | strings |
            test("^(no|always|unless-stopped|on-failure(:[1-9][0-9]{0,8})?)$"))
        elif .proxyIntent.activeSlotBefore == "blue" then
          .proxyIntent.targetSlot == "green" and .proxyIntent.managedProxyWasRunning == true and
          .proxyIntent.legacyProxyWasRunning == false and .proxyIntent.legacyProxyRestartPolicy == null
        else
          .proxyIntent.targetSlot == "blue" and .proxyIntent.managedProxyWasRunning == true and
          .proxyIntent.legacyProxyWasRunning == false and .proxyIntent.legacyProxyRestartPolicy == null
        end) and
        (if .proxyIntent.caddyfilePresent then
          (.proxyIntent.caddyfileSnapshot | strings |
            test("^/root/kelion/runtime/caddyfile-rollback\\.[A-Za-z0-9]+$")) and
          (.proxyIntent.caddyfileSha256 | strings | test("^[0-9a-f]{64}$"))
        else .proxyIntent.caddyfileSnapshot == "" and .proxyIntent.caddyfileSha256 == "absent" end) and
        (if .proxyIntent.oldUpstreamPresent then
          (.proxyIntent.oldUpstreamSnapshot | strings |
            test("^/root/kelion/runtime/upstream-rollback\\.[A-Za-z0-9]+$")) and
          (.proxyIntent.oldUpstreamSha256 | strings | test("^[0-9a-f]{64}$"))
        else .proxyIntent.oldUpstreamSnapshot == "" and .proxyIntent.oldUpstreamSha256 == "absent" end) and
        (.proxyIntent.targetCaddyfileSha256 | strings | test("^[0-9a-f]{64}$")) and
        (.proxyIntent.targetUpstreamSha256 | strings | test("^[0-9a-f]{64}$")) and
        ([.gateSha256.worker,.gateSha256.publisher,.gateSha256.release] |
          (all(.[]; type == "string" and test("^[0-9a-f]{64}$")) or all(.[]; . == "absent"))) and
        ((.phase != "gate-prepared" and .phase != "gate-committed") or
          ([.targetGateSha256.worker,.targetGateSha256.publisher,.targetGateSha256.release] |
            (all(.[]; type == "string" and test("^[0-9a-f]{64}$")) or all(.[]; . == "absent")))) and
        (.phase != "gate-committed" or
          ([.committedGateSha256.worker,.committedGateSha256.publisher,.committedGateSha256.release] |
            (all(.[]; type == "string" and test("^[0-9a-f]{64}$")) or all(.[]; . == "absent"))) and
          .committedGateSha256 == .targetGateSha256))) and
      (.requestId | strings | test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and
      (.commit | strings | test("^[0-9a-f]{40}$"))' "$DEPLOY_QUIESCE_JOURNAL" >/dev/null
}

deploy_quiesce_owned_by_caller() {
  [ -n "$deploy_owner_request_id" ] && [ -n "$deploy_owner_commit" ] || return 1
  jq -e --arg requestId "$deploy_owner_request_id" --arg commit "$deploy_owner_commit" '
    (.schema == 1 or .schema == 2) and .requestId == $requestId and .commit == $commit
  ' "$DEPLOY_QUIESCE_JOURNAL" >/dev/null
}

# Pending-ul unit-only este folosit atât de upgrade-ul Constructor, cât și de
# release-ul care publică cele șase unități înainte de refresh-ul gate-ului.
# Ownerul upgrade-ului este autentificat de outer journal mai sus. Orice alt
# recover-only poate trece de această barieră numai ca owner exact al jurnalului
# deploy, sub lock moștenit, într-una dintre cele două faze canonice. Operația
# incident este separată și nu poate publica ready înaintea dovezii ei complete.
strict_pending_deploy_recovery_owner() {
  local phase
  [ "$recover_only" = 1 ] && [ "$boot_recovery" = 0 ] \
    && [ "${KELION_CUTOVER_LOCK_HELD:-0}" = 1 ] \
    && validate_deploy_quiesce_journal \
    && [ -f "$DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$DEPLOY_QUIESCE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$DEPLOY_QUIESCE_JOURNAL")" = '0:0:600:1' ] \
    && deploy_quiesce_owned_by_caller \
    || return 1
  phase=$(jq -er '.phase' "$DEPLOY_QUIESCE_JOURNAL") || return 1
  if [ "$discard_unmutated_gate_prepared" = 1 ]; then
    [ "$leave_constructor_quiesced" = 0 ] && [ "$deploy_quiesce_proof" = 1 ] \
      && [ "$phase" = gate-prepared ] \
      && [ "$deploy_owner_request_id" = "$discard_gate_request_id" ] \
      && [ "$deploy_owner_commit" = "$discard_gate_commit" ] \
      && jq -e --arg requestId "$discard_gate_request_id" --arg commit "$discard_gate_commit" \
        --arg active "$discard_gate_active_commit" '
          .schema == 2 and .phase == "gate-prepared" and
          .requestId == $requestId and .commit == $commit and .activeBefore == $active
        ' "$DEPLOY_QUIESCE_JOURNAL" >/dev/null
    return
  fi
  if [ "$leave_constructor_quiesced" = 1 ]; then
    [ "$deploy_quiesce_proof" = 0 ] || return 1
    # Ownerul își reia propriul deploy căzut înainte de marker: pending-ul
    # rămâne, unitățile rămân oprite, iar generația veche trebuie să fie exact
    # cea jurnalizată. Fără această cale, deploy-ul retry ar fi refuzat chiar de
    # bariera pe care tot el a publicat-o.
    if deploy_quiesce_pre_ponr_rollback_proof; then return 0; fi
    [ "$phase" = gate-prepared ] \
      && { { [ -f "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] \
            && [ "$(stat -Lc '%u:%g:%a:%h' "$GATE_JOURNAL")" = '0:0:600:1' ] \
            && jq -e --arg commit "$deploy_owner_commit" '
              .schema == 1 and .commit == $commit and
              (.helperSha256 | strings | test("^[0-9a-f]{64}$")) and
              (.transactionRoot | strings | test("^/root/kelion/runtime/constructor-gate-txn\\.[A-Za-z0-9]+$"))
            ' "$GATE_JOURNAL" >/dev/null; } \
        || { [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] \
            && deploy_quiesce_generation_proof target; }; }
    return
  fi
  [ "$deploy_quiesce_proof" = 1 ] || return 1
  # Reactivarea owner-aware acceptă fie commitul app+gate (roll-forward), fie
  # rollback-ul pre-PONR verificat (generația veche exactă). În ambele cazuri
  # pending-ul unit-only al aceluiași deploy este consumat de helper.
  if deploy_quiesce_pre_ponr_rollback_proof; then return 0; fi
  [ "$phase" = gate-committed ] \
    && [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] \
    && deploy_quiesce_generation_proof committed
}

deploy_quiesce_generation_proof() {
  local scope=${1:-either} phase active_expected active_observed expected actual index
  local -a keys=(worker publisher release)
  local -a proof_configs=(
    "$CONFIG_ROOT/codex-worker.env"
    "$CONFIG_ROOT/constructor-publisher.env"
    "$CONFIG_ROOT/constructor-release.env"
  )
  case "$scope" in either|old|target|committed) ;; *) return 1 ;; esac
  [ -f "$RUNTIME_ROOT/release-state/active" ] && [ ! -L "$RUNTIME_ROOT/release-state/active" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RUNTIME_ROOT/release-state/active")" = '0:10050:640:1' ] \
    && [ "$(wc -l < "$RUNTIME_ROOT/release-state/active")" -eq 1 ] || return 1
  phase=$(jq -er '.phase' "$DEPLOY_QUIESCE_JOURNAL") || return 1
  active_observed=$(sed -n '1p' "$RUNTIME_ROOT/release-state/active") || return 1
  if [ "$scope" != committed ] \
    && active_expected=$(jq -er '.activeBefore' "$DEPLOY_QUIESCE_JOURNAL" 2>/dev/null) \
    && [ "$active_observed" = "$active_expected" ]; then
    for index in "${!proof_configs[@]}"; do
      expected=$(jq -er --arg key "${keys[$index]}" '.gateSha256[$key]' "$DEPLOY_QUIESCE_JOURNAL") || return 1
      if [ "$expected" = absent ]; then
        [ ! -e "${proof_configs[$index]}" ] && [ ! -L "${proof_configs[$index]}" ] || return 1
      else
        [ -f "${proof_configs[$index]}" ] && [ ! -L "${proof_configs[$index]}" ] \
          && [ "$(stat -Lc '%u:%g:%a:%h' "${proof_configs[$index]}")" = '0:0:640:1' ] || return 1
        actual=$(sha256sum "${proof_configs[$index]}" | awk '{print $1}') || return 1
        [ "$actual" = "$expected" ] || return 1
      fi
    done
    return 0
  fi
  [ "$scope" != old ] || return 1
  if [ "$scope" = target ]; then
    [ "$phase" = gate-prepared ] || return 1
  else
    [ "$phase" = gate-committed ] || return 1
  fi
  active_expected=$(jq -er '.commit' "$DEPLOY_QUIESCE_JOURNAL") || return 1
  [ "$active_observed" = "$active_expected" ] || return 1
  for index in "${!proof_configs[@]}"; do
    if [ "$scope" = target ]; then
      expected=$(jq -er --arg key "${keys[$index]}" '.targetGateSha256[$key]' "$DEPLOY_QUIESCE_JOURNAL") || return 1
    else
      expected=$(jq -er --arg key "${keys[$index]}" '.committedGateSha256[$key]' "$DEPLOY_QUIESCE_JOURNAL") || return 1
    fi
    if [ "$expected" = absent ]; then
      [ ! -e "${proof_configs[$index]}" ] && [ ! -L "${proof_configs[$index]}" ] || return 1
    else
      [ -f "${proof_configs[$index]}" ] && [ ! -L "${proof_configs[$index]}" ] \
        && [ "$(stat -Lc '%u:%g:%a:%h' "${proof_configs[$index]}")" = '0:0:640:1' ] || return 1
      actual=$(sha256sum "${proof_configs[$index]}" | awk '{print $1}') || return 1
      [ "$actual" = "$expected" ] || return 1
    fi
  done
}

# Rollback-ul pre-PONR al deploy-ului owner: jurnalul nu a trecut de publicarea
# markerului (armed/quiesced/active-prepared), nu există refresh gate început,
# iar markerul activ și hashurile celor trei configuri sunt exact generația de
# dinaintea quiesce-ului. Numai atunci pending-ul unit-only publicat de același
# deploy poate fi consumat fără cutover strict; altfel deploy-ul retry, boot-ul
# și activarea s-ar refuza reciproc pe aceeași barieră, fără cale automată.
deploy_quiesce_pre_ponr_rollback_proof() {
  local phase
  [ -f "$DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$DEPLOY_QUIESCE_JOURNAL" ] || return 1
  deploy_quiesce_owned_by_caller || return 1
  phase=$(jq -er '.phase' "$DEPLOY_QUIESCE_JOURNAL") || return 1
  case "$phase" in armed|quiesced|active-prepared) ;; *) return 1 ;; esac
  [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] || return 1
  deploy_quiesce_generation_proof old
}

if [ -f "$UNIT_MIGRATION_PENDING" ] && [ "$constructor_upgrade_owner" != 1 ] \
  && [ "$recover_only" = 1 ]; then
  strict_pending_deploy_recovery_owner \
    || die 'bariera unit-only ține recovery-ul generic quiesced până la cutover-ul strict'
fi

clear_deploy_quiesce_journal() {
  [ -f "$DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$DEPLOY_QUIESCE_JOURNAL" ] || return 1
  rm -f -- "$DEPLOY_QUIESCE_JOURNAL" || return 1
  # După unlink păstrăm recovery_in_progress armat până când controllerul are
  # socketul probat și abia apoi repornim timerele. Orice eșec de fsync/start
  # retrage ready și lasă întreg vectorul quiesced, chiar dacă jurnalul nu mai
  # poate fi restaurat; următorul recover-only reia starea ownerless sigură.
  deploy_quiesce_journal_unlinked=1
  fsync_path "$RUNTIME_ROOT"
}

remove_transaction_dir() {
  local candidate=$1 canonical
  [[ "$candidate" =~ ^/root/kelion/runtime/runtime-config-txn\.[A-Za-z0-9]+$ ]] || return 1
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || return 1
  canonical=$(realpath -e -- "$candidate") || return 1
  [ "$canonical" = "$candidate" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:700' ] || return 1
  rm -rf -- "$canonical"
}

remove_activation_dir() {
  local candidate=$1 canonical
  [[ "$candidate" =~ ^/root/kelion/runtime/constructor-activation\.[A-Za-z0-9._-]+$ ]] || return 1
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || return 1
  canonical=$(realpath -e -- "$candidate") || return 1
  [ "$canonical" = "$candidate" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:700' ] || return 1
  rm -rf -- "$canonical"
}

write_activation_journal_phase() {
  local phase=$1 temporary
  case "$phase" in quiesced|applied) ;; *) return 1 ;; esac
  [ -f "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ] \
    && [ "$(stat -c '%u:%g:%a' "$ACTIVATION_JOURNAL")" = '0:0:600' ] || return 1
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-activation.journal.XXXXXX") || return 1
  if jq --arg phase "$phase" '.schema=2 | .phase=$phase' "$ACTIVATION_JOURNAL" > "$temporary" \
    && jq -e '.schema == 2 and (.phase == "quiesced" or .phase == "applied") and (.activationRoot | type == "string") and
      (.operation == "activate-worker-publisher" or .operation == "activate-release")' "$temporary" >/dev/null \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$ACTIVATION_JOURNAL" \
    && fsync_path "$RUNTIME_ROOT"; then
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

remove_gate_transaction_dir() {
  local candidate=$1 canonical
  [[ "$candidate" =~ ^/root/kelion/runtime/constructor-gate-txn\.[A-Za-z0-9]+$ ]] || return 1
  [ -d "$candidate" ] && [ ! -L "$candidate" ] || return 1
  canonical=$(realpath -e -- "$candidate") || return 1
  [ "$canonical" = "$candidate" ] || return 1
  [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:700' ] || return 1
  rm -rf -- "$canonical"
}

write_journal_phase() {
  local phase=$1 temporary
  [[ "$phase" =~ ^(prepared|files-committed|backend-recreated|committed|timers-restored)$ ]] || return 1
  [[ "$transaction_root" =~ ^/root/kelion/runtime/runtime-config-txn\.[A-Za-z0-9]+$ ]] || return 1
  if [ "$phase" = prepared ]; then
    [ ! -e "$JOURNAL" ] && [ ! -L "$JOURNAL" ] || return 1
  else
    [ -f "$JOURNAL" ] && [ ! -L "$JOURNAL" ] && [ "$(stat -c '%u:%g:%a' "$JOURNAL")" = '0:0:600' ] || return 1
  fi
  temporary=$(mktemp "$RUNTIME_ROOT/.runtime-config-cutover.journal.XXXXXX") || return 1
  if jq -n --arg phase "$phase" --arg transactionRoot "$transaction_root" \
      '{schema:1,phase:$phase,transactionRoot:$transactionRoot}' > "$temporary" \
    && chown root:root "$temporary" && chmod 0600 "$temporary" \
    && fsync_path "$temporary" \
    && mv -f -- "$temporary" "$JOURNAL" \
    && fsync_path "$RUNTIME_ROOT"; then
    journal_owned=1
    journal_clear_durable=0
    return 0
  fi
  rm -f -- "$temporary"
  return 1
}

validate_owned_runtime_journal() {
  [ -f "$JOURNAL" ] && [ ! -L "$JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$JOURNAL")" = '0:0:600:1' ] \
    && jq -e --arg transactionRoot "$transaction_root" '
      .schema == 1 and .transactionRoot == $transactionRoot and
      (.phase == "prepared" or .phase == "files-committed" or
       .phase == "backend-recreated" or .phase == "committed" or
       .phase == "timers-restored") and
      (keys | sort) == ["phase", "schema", "transactionRoot"]
    ' "$JOURNAL" >/dev/null
}

clear_journal() {
  [ -f "$JOURNAL" ] && [ ! -L "$JOURNAL" ] || return 1
  rm -f -- "$JOURNAL" || return 1
  fsync_path "$RUNTIME_ROOT" || return 1
  journal_owned=0
  journal_clear_durable=1
}

remove_transaction_after_durable_journal_clear() {
  local candidate=$1
  [ "$journal_clear_durable" = 1 ] || return 1
  [ ! -e "$JOURNAL" ] && [ ! -L "$JOURNAL" ] || return 1
  remove_transaction_dir "$candidate"
}

constructor_timers=(
  kelion-codex-worker.timer
  kelion-constructor-publisher.timer
  kelion-constructor-release.timer
)
constructor_services=(
  kelion-codex-worker.service
  kelion-constructor-publisher.service
  kelion-constructor-release.service
)
constructor_auxiliary_services=(
  kelion-constructor-sync.service
  kelion-constructor-model-control.service
)
constructor_markers=(
  /etc/kelion/codex-worker.enabled
  /etc/kelion/constructor-publisher.enabled
  /etc/kelion/constructor-release.enabled
)
constructor_flags=(
  CODEX_WORKER_ENABLED
  CONSTRUCTOR_PUBLISHER_ENABLED
  CONSTRUCTOR_RELEASE_ENABLED
)
constructor_exec_flags=(
  CODEX_WORKER_EXEC_ENABLED
  CONSTRUCTOR_PUBLISHER_EXEC_ENABLED
  CONSTRUCTOR_RELEASE_EXEC_ENABLED
)
constructor_configs=(
  "$CONFIG_ROOT/codex-worker.env"
  "$CONFIG_ROOT/constructor-publisher.env"
  "$CONFIG_ROOT/constructor-release.env"
)

declare -a logical_names=() targets=() owner_ids=() group_ids=() modes=()
declare -a prepared=() backups=() backup_present=()
declare -A seen_logical=()
units_quiesced=0
constructor_configured=0
constructor_staged_unit_count=0
unit_only_transaction=0
mutation_started=0
config_consistent=1
backend_consistent=1
operation_succeeded=0
restart_required=0
restart_guarded=0
transaction_root=''
journal_owned=0
journal_clear_durable=0
activation_barrier_pending=0
activation_outer_commit_pending=0
gate_journal_clear_durable=0
recovery_in_progress=0
deploy_quiesce_journal_unlinked=0

group_id() {
  local group=$1 record
  if [[ "$group" =~ ^[0-9]+$ ]]; then
    getent group "$group" >/dev/null || return 1
    printf '%s' "$group"
    return 0
  fi
  record=$(getent group "$group") || return 1
  printf '%s' "$record" | awk -F: '{ print $3 }'
}

map_logical() {
  local logical=$1 secret_name=${1#*.}
  mapped_owner=0
  mapped_group=0
  mapped_mode=400
  case "$logical" in
    runtime.env)
      mapped_target=$CONFIG_ROOT/runtime.env; mapped_group=10050; mapped_mode=640; restart_required=1 ;;
    app-secret.openai-project-key|app-secret.openai-admin-key|app-secret.database-url|app-secret.session-secret|app-secret.google-client-secret|app-secret.google-token-encryption-key|app-secret.codex-worker-secret|app-secret.constructor-model-control-secret|app-secret.constructor-publisher-secret|app-secret.constructor-release-secret|app-secret.browser-worker-secret|app-secret.converter-worker-secret|app-secret.revolut-merchant-secret-key|app-secret.revolut-webhook-signing-secret|app-secret.vapid-private-key|app-secret.github-release-oauth-token|app-secret.migration-backup-proof-key)
      mapped_target=$SECRET_ROOT/$secret_name; mapped_group=10050; mapped_mode=440; restart_required=1 ;;
    gate-secret.github-ghcr-read-token)
      mapped_target=$ROOT/gate-secrets/github-ghcr-read-token; mapped_mode=400 ;;
    worker-secret.github-worker-token)
      mapped_target=$ROOT/worker-secrets/github-worker-token; mapped_mode=440 ;;
    publisher-secret.github-publisher-token)
      mapped_target=$ROOT/publisher-secrets/github-publisher-token
      mapped_group=$(group_id kelion-publisher) || die 'grupul kelion-publisher lipsește'
      mapped_mode=440 ;;
    release-secret.github-release-token)
      mapped_target=$ROOT/release-secrets/github-release-token
      mapped_group=$(group_id kelion-release) || die 'grupul kelion-release lipsește'
      mapped_mode=440 ;;
    constructor-config.codex-worker.env)
      mapped_target=$CONFIG_ROOT/codex-worker.env; mapped_mode=640 ;;
    constructor-config.constructor-publisher.env)
      mapped_target=$CONFIG_ROOT/constructor-publisher.env; mapped_mode=640 ;;
    constructor-config.constructor-release.env)
      mapped_target=$CONFIG_ROOT/constructor-release.env; mapped_mode=640 ;;
    systemd-timer.kelion-codex-worker.timer|systemd-timer.kelion-constructor-publisher.timer|systemd-timer.kelion-constructor-release.timer)
      mapped_target=/etc/systemd/system/${logical#systemd-timer.}; mapped_mode=444 ;;
    systemd-service.kelion-codex-worker.service|systemd-service.kelion-constructor-publisher.service|systemd-service.kelion-constructor-release.service)
      mapped_target=/etc/systemd/system/${logical#systemd-service.}; mapped_mode=444 ;;
    *) die "intrare nepermisă în manifest: $logical" ;;
  esac
}

validate_text_file_bytes() {
  local file=$1 original_size clean_size last_byte
  [ -s "$file" ] && [ "$(stat -c '%s' "$file")" -le 65536 ] || return 1
  original_size=$(wc -c < "$file")
  clean_size=$(LC_ALL=C tr -d '\000-\011\013-\037\177' < "$file" | wc -c)
  [ "$original_size" -eq "$clean_size" ] || return 1
  last_byte=$(tail -c 1 -- "$file" | od -An -t u1 | tr -d '[:space:]')
  [ "$last_byte" = 10 ]
}

validate_env_file() {
  local file=$1 logical=$2 name value line base maximum checks allowed_names required_names='' require_nonempty=0
  local -A allowed=() seen=() values=()
  validate_text_file_bytes "$file" || return 1
  case "$logical" in
    runtime.env)
      allowed_names='NODE_ENV PORT PUBLIC_APP_ORIGIN FRONTEND_ORIGIN ADMIN_EMAIL OPENAI_API_KEY_FILE OPENAI_ADMIN_KEY_FILE OPENAI_LUNA_MODEL OPENAI_MEDIUM_MODEL OPENAI_HEAVY_MODEL OPENAI_REALTIME_MODEL OPENAI_REALTIME_TRANSCRIPTION_MODEL OPENAI_CALL_TRANSCRIPTION_MODEL OPENAI_TTS_MODEL OPENAI_IMAGE_MODEL OPENAI_VIDEO_MODEL OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND OPENAI_VIDEO_SHUTDOWN_AT DATABASE_URL_FILE SESSION_SECRET_FILE GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_ID GOOGLE_REDIRECT_URI CODEX_WORKER_ENABLED CODEX_WORKER_SECRET_FILE CONSTRUCTOR_MODEL_CONTROL_ENABLED CONSTRUCTOR_MODEL_CONTROL_SOCKET CONSTRUCTOR_MODEL_CONTROL_SECRET_FILE CONSTRUCTOR_PUBLISHER_ENABLED CONSTRUCTOR_PUBLISHER_SECRET_FILE CONSTRUCTOR_RELEASE_ENABLED CONSTRUCTOR_RELEASE_SECRET_FILE GITHUB_RELEASE_OAUTH_TOKEN_FILE CONSTRUCTOR_RETRY_BASE_SECONDS CONSTRUCTOR_RETRY_MAX_SECONDS CONSTRUCTOR_EXTERNAL_RETRY_SECONDS CONSTRUCTOR_REQUIRED_CHECKS BROWSER_WORKER_SOCKET BROWSER_WORKER_SECRET_FILE CONVERTER_WORKER_SOCKET CONVERTER_WORKER_SECRET_FILE REVOLUT_MERCHANT_SECRET_KEY_FILE REVOLUT_WEBHOOK_SIGNING_SECRET_FILE VAPID_PRIVATE_KEY_FILE VISITOR_CHAT_TTL_SECONDS VISITOR_ANALYTICS_RETENTION_DAYS SESSION_ABSOLUTE_TTL_SECONDS SESSION_IDLE_TTL_SECONDS SESSION_TOUCH_INTERVAL_SECONDS SESSION_MAX_ACTIVE_PER_ACCOUNT SESSION_RECENT_REAUTH_SECONDS NATIVE_AUTH_EXCHANGE_TTL_SECONDS NATIVE_AUTH_REQUEST_TTL_SECONDS NATIVE_CHANNEL_TICKET_TTL_SECONDS OFFLINE_SYNC_FUTURE_SKEW_SECONDS OFFLINE_SYNC_MAX_AGE_DAYS OFFLINE_SYNC_MAX_TEXT_CHARS OFFLINE_SYNC_MAX_TURNS VOCAL_LIVE_IDLE_TIMEOUT_SECONDS PRIVACY_POLICY_UPDATED DATA_CONTROLLER_NAME PRIVACY_BACKUP_RETENTION_DAYS FINANCIAL_RETENTION_YEARS JOURNAL_RETENTION_DAYS MEDIA_RETENTION_DAYS CREDIT_PRICE_MINOR CHAT_TURN_PRICE_MINOR VOICE_LIVE_MINUTE_PRICE_MINOR CALL_UTTERANCE_PRICE_MINOR BILLING_FIRST_TOPUP_MIN_MINOR BILLING_TOPUP_STEP_MINOR BILLING_TOPUP_MIN_MINOR BILLING_TOPUP_MAX_MINOR LOW_CREDIT_THRESHOLD_MINOR LOW_CREDIT_TOPUP_MINOR PAYMENT_MODE PAYMENT_CONTRACT_VERIFIED REVOLUT_MERCHANT_API_VERSION REVOLUT_ORDER_EXPIRY PUSH_ENABLED VAPID_PUBLIC_KEY PUSH_ENDPOINT_HOSTS PUSH_MAX_SUBSCRIPTIONS GOOGLE_TTS_ENABLED GOOGLE_TTS_VOICE SEARCH_ENABLED MAIL_ENABLED RELEASE_CANDIDATE_MODE'
      required_names=$allowed_names
      ;;
    constructor-config.codex-worker.env)
      allowed_names='CODEX_WORKER_EXEC_ENABLED KELION_CODEX_API KELION_GITHUB_REPOSITORY KELION_CODEX_GATE_IMAGE'
      required_names=$allowed_names
      require_nonempty=1
      ;;
    constructor-config.constructor-publisher.env)
      allowed_names='CONSTRUCTOR_PUBLISHER_EXEC_ENABLED KELION_CONSTRUCTOR_API KELION_GITHUB_REPOSITORY KELION_CODEX_GATE_IMAGE CONSTRUCTOR_REQUIRED_CHECKS CONSTRUCTOR_GIT_AUTHOR_NAME CONSTRUCTOR_GIT_AUTHOR_EMAIL CONSTRUCTOR_GIT_SIGNING_FINGERPRINT'
      required_names=$allowed_names
      require_nonempty=1
      ;;
    constructor-config.constructor-release.env)
      allowed_names='CONSTRUCTOR_RELEASE_EXEC_ENABLED KELION_CONSTRUCTOR_API KELION_GITHUB_REPOSITORY KELION_PUBLIC_APP_ORIGIN CONSTRUCTOR_RELEASE_WORKFLOW CONSTRUCTOR_RELEASE_REQUIRED_CHECKS'
      required_names=$allowed_names
      require_nonempty=1
      ;;
    *) return 1 ;;
  esac
  for name in $allowed_names; do allowed[$name]=1; done
  while IFS= read -r line; do
    [ -n "$line" ] && [[ "$line" == *=* ]] || return 1
    name=${line%%=*}
    value=${line#*=}
    [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || return 1
    [ -n "${allowed[$name]:-}" ] || return 1
    [ -z "${seen[$name]:-}" ] || return 1
    [ "${#value}" -le 2048 ] || return 1
    seen[$name]=1
    values[$name]=$value
    case "$name" in
      CODEX_WORKER_ENABLED|CONSTRUCTOR_PUBLISHER_ENABLED|CONSTRUCTOR_RELEASE_ENABLED|CODEX_WORKER_EXEC_ENABLED|CONSTRUCTOR_PUBLISHER_EXEC_ENABLED|CONSTRUCTOR_RELEASE_EXEC_ENABLED)
        [[ "$value" =~ ^[01]$ ]] || return 1 ;;
      KELION_CODEX_API|KELION_CONSTRUCTOR_API)
        [ "$value" = 'http://127.0.0.1:18079' ] || return 1 ;;
      KELION_PUBLIC_APP_ORIGIN)
        python3 - "$value" <<'PY' || return 1
import sys
from urllib.parse import urlsplit
value = sys.argv[1]
parsed = urlsplit(value)
if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password:
    raise SystemExit(1)
if parsed.path or parsed.query or parsed.fragment or value != f'https://{parsed.netloc}':
    raise SystemExit(1)
PY
        ;;
      KELION_GITHUB_REPOSITORY)
        [[ "$value" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || return 1 ;;
      KELION_CODEX_GATE_IMAGE)
        [[ "$value" =~ ^ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+/codex-gates@sha256:[0-9a-f]{64}$ ]] || return 1 ;;
      CONSTRUCTOR_GIT_AUTHOR_EMAIL)
        [[ "$value" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$ ]] || return 1 ;;
      CONSTRUCTOR_GIT_SIGNING_FINGERPRINT)
        [[ "$value" =~ ^SHA256:[A-Za-z0-9+/]{43}$ ]] || return 1 ;;
      CONSTRUCTOR_RELEASE_WORKFLOW)
        [[ "$value" =~ ^[A-Za-z0-9_.-]+\.yml$ ]] || return 1 ;;
      CONSTRUCTOR_REQUIRED_CHECKS|CONSTRUCTOR_RELEASE_REQUIRED_CHECKS)
        [[ "$value" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}(,[A-Za-z0-9][A-Za-z0-9._/-]{0,79}){1,15}$ ]] || return 1
        case ",$value," in *,verify,*) ;; *) return 1 ;; esac
        case ",$value," in *,container-isolation,*) ;; *) return 1 ;; esac
        [ "$(tr ',' '\n' <<<"$value" | sort | uniq -d | wc -l)" -eq 0 ] || return 1 ;;
    esac
  done < "$file"
  [ "${#seen[@]}" -gt 0 ] || return 1
  for name in $required_names; do
    [ -n "${seen[$name]:-}" ] || return 1
    if [ "$require_nonempty" = 1 ]; then [ -n "${values[$name]}" ] || return 1; fi
  done
  if [ "$logical" = runtime.env ]; then
    [ "${values[NODE_ENV]}" = production ] || return 1
    [ "${values[PORT]}" = 8080 ] || return 1
    python3 - "${values[PUBLIC_APP_ORIGIN]}" "${values[FRONTEND_ORIGIN]}" "${values[GOOGLE_REDIRECT_URI]}" <<'PY' || return 1
import re
import sys
from urllib.parse import urlsplit

origin, frontend, redirect = sys.argv[1:]
try:
    parsed = urlsplit(origin)
    port = parsed.port
except ValueError:
    raise SystemExit(1)
host = parsed.hostname or ""
labels = host.split(".")
if (
    parsed.scheme != "https"
    or parsed.username is not None
    or parsed.password is not None
    or parsed.path != ""
    or parsed.query != ""
    or parsed.fragment != ""
    or len(host) > 253
    or not labels
    or not all(re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels)
    or host.endswith(".")
    or port == 443
    or origin != f"https://{parsed.netloc}"
    or frontend != origin
    or redirect != f"{origin}/auth/google/callback"
):
    raise SystemExit(1)
PY
    while IFS=$'\t' read -r name value; do
      [ "${values[$name]}" = "$value" ] || return 1
    done <<'CONSTANTS'
OPENAI_API_KEY_FILE	/run/secrets/openai-project-key
OPENAI_ADMIN_KEY_FILE	/run/secrets/openai-admin-key
DATABASE_URL_FILE	/run/secrets/database-url
SESSION_SECRET_FILE	/run/secrets/session-secret
GOOGLE_CLIENT_SECRET_FILE	/run/secrets/google-client-secret
GOOGLE_TOKEN_ENCRYPTION_KEY_FILE	/run/secrets/google-token-encryption-key
CODEX_WORKER_SECRET_FILE	/run/secrets/codex-worker-secret
CONSTRUCTOR_MODEL_CONTROL_ENABLED	1
CONSTRUCTOR_MODEL_CONTROL_SOCKET	/run/kelion-constructor-model-control/control.sock
CONSTRUCTOR_MODEL_CONTROL_SECRET_FILE	/run/secrets/constructor-model-control-secret
CONSTRUCTOR_PUBLISHER_SECRET_FILE	/run/secrets/constructor-publisher-secret
CONSTRUCTOR_RELEASE_SECRET_FILE	/run/secrets/constructor-release-secret
GITHUB_RELEASE_OAUTH_TOKEN_FILE	/run/secrets/github-release-oauth-token
BROWSER_WORKER_SOCKET	/run/kelion-browser-api/browser.sock
BROWSER_WORKER_SECRET_FILE	/run/secrets/browser-worker-secret
CONVERTER_WORKER_SOCKET	/run/kelion-converter-api/converter.sock
CONVERTER_WORKER_SECRET_FILE	/run/secrets/converter-worker-secret
REVOLUT_MERCHANT_SECRET_KEY_FILE	/run/secrets/revolut-merchant-secret-key
REVOLUT_WEBHOOK_SIGNING_SECRET_FILE	/run/secrets/revolut-webhook-signing-secret
VAPID_PRIVATE_KEY_FILE	/run/secrets/vapid-private-key
CONSTANTS
    for name in CONSTRUCTOR_RETRY_BASE_SECONDS CONSTRUCTOR_RETRY_MAX_SECONDS CONSTRUCTOR_EXTERNAL_RETRY_SECONDS CONSTRUCTOR_REQUIRED_CHECKS; do
      [ "$(grep -c "^${name}=" "$file")" -eq 1 ] || return 1
    done
    base=$(sed -n 's/^CONSTRUCTOR_RETRY_BASE_SECONDS=//p' "$file")
    maximum=$(sed -n 's/^CONSTRUCTOR_RETRY_MAX_SECONDS=//p' "$file")
    value=$(sed -n 's/^CONSTRUCTOR_EXTERNAL_RETRY_SECONDS=//p' "$file")
    checks=$(sed -n 's/^CONSTRUCTOR_REQUIRED_CHECKS=//p' "$file")
    [[ "$base" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$base" -ge 5 ] && [ "$base" -le 3600 ] || return 1
    [[ "$maximum" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$maximum" -ge 30 ] && [ "$maximum" -le 86400 ] || return 1
    [[ "$value" =~ ^[1-9][0-9]{0,4}$ ]] && [ "$value" -ge 60 ] && [ "$value" -le 86400 ] || return 1
    [ "$base" -le "$maximum" ] || return 1
    [[ "$checks" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,79}(,[A-Za-z0-9][A-Za-z0-9._/-]{0,79}){1,15}$ ]] || return 1
    [ "$(tr ',' '\n' <<<"$checks" | sort | uniq -d | wc -l)" -eq 0 ] || return 1
    case ",$checks," in *,verify,*) ;; *) return 1 ;; esac
    case ",$checks," in *,container-isolation,*) ;; *) return 1 ;; esac
  fi
}

validate_constructor_checks_contract() {
  local runtime_checks=$1 publisher_checks=$2 release_checks=$3
  [ "$runtime_checks" = "$publisher_checks" ] \
    && [ "$release_checks" = 'verify,container-isolation' ]
}

validate_constructor_timer_unit() {
  local file logical timer service
  file=$1
  logical=$2
  timer=${logical#systemd-timer.}
  validate_text_file_bytes "$file" || return 1
  case "$timer" in
    kelion-codex-worker.timer) service=kelion-codex-worker.service ;;
    kelion-constructor-publisher.timer) service=kelion-constructor-publisher.service ;;
    kelion-constructor-release.timer) service=kelion-constructor-release.service ;;
    *) return 1 ;;
  esac
  [ "$(grep -c '^After=kelion-runtime-config-recovery.service$' "$file")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=/run/kelion/runtime-config-recovery.ready$' "$file")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=!/run/kelion/constructor-activation.pending$' "$file")" -eq 1 ] \
    && [ "$(grep -c '^Requires=kelion-runtime-config-recovery.service$' "$file")" -eq 0 ] \
    && [ "$(grep -c "^Unit=$service$" "$file")" -eq 1 ] \
    && [ "$(grep -c '^WantedBy=timers.target$' "$file")" -eq 1 ]
}

validate_constructor_service_unit() {
  local file logical service marker user exec_start
  file=$1
  logical=$2
  service=${logical#systemd-service.}
  validate_text_file_bytes "$file" || return 1
  case "$service" in
    kelion-codex-worker.service)
      marker=codex-worker; user=kelion-codex
      exec_start='/usr/bin/flock --exclusive --wait 9000 /run/lock/private-ai-model-switch.lock /usr/bin/node /opt/kelion-codex/codex-worker.mjs --once' ;;
    kelion-constructor-publisher.service)
      marker=constructor-publisher; user=kelion-publisher
      exec_start='/usr/bin/node /opt/kelion-constructor/constructor-publisher.mjs --once' ;;
    kelion-constructor-release.service)
      marker=constructor-release; user=kelion-release
      exec_start='/usr/bin/node /opt/kelion-constructor/constructor-release.mjs --once' ;;
    *) return 1 ;;
  esac
  [ "$(grep -c '^After=.*kelion-runtime-config-recovery.service' "$file")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=/run/kelion/runtime-config-recovery.ready$' "$file")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=!/run/kelion/constructor-activation.pending$' "$file")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=!/root/kelion/runtime/constructor-reactivation.journal$' "$file")" -eq 1 ] \
    && [ "$(grep -c "^ConditionPathExists=/etc/kelion/$marker.enabled$" "$file")" -eq 1 ] \
    && [ "$(grep -c '^Type=oneshot$' "$file")" -eq 1 ] \
    && [ "$(grep -c "^User=$user$" "$file")" -eq 1 ] \
    && [ "$(grep -Fxc "ExecStart=$exec_start" "$file")" -eq 1 ] \
    && [ "$(grep -c '^WantedBy=' "$file")" -eq 0 ] \
    && [ "$(grep -c '^\[Install\]$' "$file")" -eq 0 ]
}

report_live_constructor_quiesce_failure() {
  local unit=${1:-unknown} predicate=${2:-unknown}
  case "$unit" in
    runtime-ready-stamp|systemd|\
    kelion-codex-worker.timer|kelion-constructor-publisher.timer|kelion-constructor-release.timer|\
    kelion-codex-worker.service|kelion-constructor-publisher.service|kelion-constructor-release.service|\
    kelion-constructor-sync.service|kelion-constructor-model-control.service|kelion-runtime-config-recovery.service) ;;
    *) unit=unknown ;;
  esac
  case "$predicate" in
    ready-stamp-present|file-type|file-metadata-query|file-metadata|timer-contract|service-contract|\
    unit-catalog|fragment-query|fragment-path|dropins-query|dropins-present|load-state-query|load-state|\
    reload-state-query|reload-needed|unit-count|timer-unit-file-state|service-unit-file-state|\
    active-state-query|active-state|pending-job|auxiliary-active-state-query|auxiliary-active-state|\
    auxiliary-pending-job) ;;
    *) predicate=unknown ;;
  esac
  printf 'runtime-cutover: live-quiesce-contract:%s:%s\n' "$unit" "$predicate" >&2
}

validate_effective_constructor_unit() {
  local unit=$1 report=${2:-0} expected=/etc/systemd/system/$1 fragment dropins load_state need_reload
  case "$report" in 0|1) ;; *) return 1 ;; esac
  fragment=$(systemctl show "$unit" --property=FragmentPath --value) \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" fragment-query; return 1; }
  dropins=$(systemctl show "$unit" --property=DropInPaths --value) \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" dropins-query; return 1; }
  load_state=$(systemctl show "$unit" --property=LoadState --value) \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" load-state-query; return 1; }
  need_reload=$(systemctl show "$unit" --property=NeedDaemonReload --value) \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" reload-state-query; return 1; }
  [ "$load_state" = loaded ] \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" load-state; return 1; }
  [ "$fragment" = "$expected" ] \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" fragment-path; return 1; }
  [ -z "$dropins" ] \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" dropins-present; return 1; }
  [ "$need_reload" = no ] \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" reload-needed; return 1; }
}

validate_live_runtime_recovery_unit() {
  local unit=kelion-runtime-config-recovery.service path=/etc/systemd/system/kelion-runtime-config-recovery.service
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
    && validate_text_file_bytes "$path" \
    && [ "$(grep -c '^Wants=docker.service$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^After=local-fs.target docker.service$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^Before=kelion-constructor-sync.service kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer kelion-codex-worker.service kelion-constructor-publisher.service kelion-constructor-release.service$' "$path")" -eq 1 ] \
    && [ "$(grep -c 'kelion-constructor-model-control.service' "$path")" -eq 0 ] \
    && [ "$(grep -c '^Type=oneshot$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^Environment=KELION_RECOVERY_BOOT=1$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^ExecStart=/root/kelion/bin/runtime-config-cutover.sh --recover-only /root/kelion/config/compose.production.yml$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^RemainAfterExit=yes$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^WantedBy=multi-user.target$' "$path")" -eq 1 ] \
    && validate_effective_constructor_unit "$unit" \
    && systemctl is-enabled --quiet "$unit"
}

validate_live_constructor_sync_unit() {
  local unit=kelion-constructor-sync.service path=/etc/systemd/system/kelion-constructor-sync.service
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
    && validate_text_file_bytes "$path" \
    && [ "$(grep -c '^After=.*kelion-runtime-config-recovery.service' "$path")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=/run/kelion/runtime-config-recovery.ready$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=!/run/kelion/constructor-activation.pending$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^ConditionPathExists=!/root/kelion/runtime/constructor-reactivation.journal$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^Type=oneshot$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^User=kelion-codex$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^Group=kelion-codex$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^ExecStart=/opt/kelion-constructor/constructor-sync-worker.sh$' "$path")" -eq 1 ] \
    && [ "$(grep -c '^WantedBy=' "$path")" -eq 0 ] \
    && [ "$(grep -c '^\[Install\]$' "$path")" -eq 0 ] \
    && validate_effective_constructor_unit "$unit"
}

validate_secret_file() {
  local file=$1 original_size without_cr_size without_nul_size
  [ -s "$file" ] && [ "$(stat -c '%s' "$file")" -le 65536 ] || return 1
  [ "$(wc -l < "$file")" -eq 1 ] || return 1
  original_size=$(wc -c < "$file")
  without_cr_size=$(tr -d '\015' < "$file" | wc -c)
  [ "$original_size" -eq "$without_cr_size" ] || return 1
  without_nul_size=$(tr -d '\000' < "$file" | wc -c)
  [ "$original_size" -eq "$without_nul_size" ]
}

if [ "$validate_only" = 1 ]; then
  case "$validation_logical" in
    runtime.env|constructor-config.codex-worker.env|constructor-config.constructor-publisher.env|constructor-config.constructor-release.env) ;;
    *) die 'rol env necunoscut pentru validarea izolată' ;;
  esac
  [ -f "$validation_file" ] && [ ! -L "$validation_file" ] \
    || die 'fișierul env pentru validare lipsește sau este symlink'
  validate_env_file "$validation_file" "$validation_logical" \
    || die "env invalid: $validation_logical"
  exit 0
fi

validate_live_runtime_contract() {
  local index path config_count=0 marker_count=0 unit_count=0 unit runtime_checks publisher_checks release_checks
  local worker_enabled publisher_enabled release_enabled worker_gate_image publisher_gate_image
  local -a config_logicals=(
    constructor-config.codex-worker.env
    constructor-config.constructor-publisher.env
    constructor-config.constructor-release.env
  )
  validate_live_runtime_recovery_unit || return 1
  validate_constructor_marker_root || return 1
  [ -f "$CONFIG_ROOT/runtime.env" ] && [ ! -L "$CONFIG_ROOT/runtime.env" ] \
    && [ "$(stat -c '%u:%g:%a' "$CONFIG_ROOT/runtime.env")" = '0:10050:640' ] \
    && validate_env_file "$CONFIG_ROOT/runtime.env" runtime.env \
    || return 1
  worker_enabled=$(sed -n 's/^CODEX_WORKER_ENABLED=//p' "$CONFIG_ROOT/runtime.env")
  publisher_enabled=$(sed -n 's/^CONSTRUCTOR_PUBLISHER_ENABLED=//p' "$CONFIG_ROOT/runtime.env")
  release_enabled=$(sed -n 's/^CONSTRUCTOR_RELEASE_ENABLED=//p' "$CONFIG_ROOT/runtime.env")
  for index in "${!constructor_configs[@]}"; do
    path=${constructor_configs[$index]}
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:640' ] \
        && validate_env_file "$path" "${config_logicals[$index]}" || return 1
      config_count=$((config_count + 1))
    fi
  done
  case "$config_count" in 0|3) ;; *) return 1 ;; esac
  if [ "$config_count" = 3 ]; then
    runtime_checks=$(sed -n 's/^CONSTRUCTOR_REQUIRED_CHECKS=//p' "$CONFIG_ROOT/runtime.env")
    publisher_checks=$(sed -n 's/^CONSTRUCTOR_REQUIRED_CHECKS=//p' "${constructor_configs[1]}")
    release_checks=$(sed -n 's/^CONSTRUCTOR_RELEASE_REQUIRED_CHECKS=//p' "${constructor_configs[2]}")
    validate_constructor_checks_contract "$runtime_checks" "$publisher_checks" "$release_checks" || return 1
    worker_gate_image=$(sed -n 's/^KELION_CODEX_GATE_IMAGE=//p' "${constructor_configs[0]}")
    publisher_gate_image=$(sed -n 's/^KELION_CODEX_GATE_IMAGE=//p' "${constructor_configs[1]}")
    [ -n "$worker_gate_image" ] && [ "$worker_gate_image" = "$publisher_gate_image" ] || return 1
  fi
  for index in "${!constructor_markers[@]}"; do
    path=${constructor_markers[$index]}
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
        && [ "$config_count" = 3 ] \
        && [ "$(grep -c "^${constructor_flags[$index]}=1$" "$CONFIG_ROOT/runtime.env")" -eq 1 ] \
        && [ "$(grep -c "^${constructor_exec_flags[$index]}=1$" "${constructor_configs[$index]}")" -eq 1 ] \
        || return 1
      marker_count=$((marker_count + 1))
    fi
  done
  if [ -f "${constructor_markers[2]}" ]; then
    [ -f "${constructor_markers[0]}" ] && [ -f "${constructor_markers[1]}" ] || return 1
  fi
  if [ -f "${constructor_markers[1]}" ]; then [ -f "${constructor_markers[0]}" ] || return 1; fi
  for unit in "${constructor_timers[@]}"; do
    path=/etc/systemd/system/$unit
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
        && validate_constructor_timer_unit "$path" "systemd-timer.$unit" \
        && systemctl cat "$unit" >/dev/null 2>&1 \
        && validate_effective_constructor_unit "$unit" || return 1
      unit_count=$((unit_count + 1))
    fi
  done
  for unit in "${constructor_services[@]}"; do
    path=/etc/systemd/system/$unit
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
        && validate_constructor_service_unit "$path" "systemd-service.$unit" \
        && systemctl cat "$unit" >/dev/null 2>&1 \
        && validate_effective_constructor_unit "$unit" || return 1
      unit_count=$((unit_count + 1))
    fi
  done
  case "$unit_count" in
    0) [ "$config_count" -eq 0 ] && [ "$marker_count" -eq 0 ] || return 1 ;;
    6) ;;
    *) return 1 ;;
  esac
  if [ "$config_count" -eq 3 ] || [ "$marker_count" -gt 0 ]; then
    [ "$unit_count" -eq 6 ] || return 1
  fi
  if [ "$unit_count" -eq 6 ]; then validate_live_constructor_sync_unit || return 1; fi
  if [ "$config_count" -eq 0 ]; then
    [ "$worker_enabled" = 0 ] && [ "$publisher_enabled" = 0 ] && [ "$release_enabled" = 0 ] || return 1
  fi
  if [ "$worker_enabled" = 1 ] || [ "$publisher_enabled" = 1 ] || [ "$release_enabled" = 1 ]; then
    [ "$config_count" -eq 3 ] && [ "$unit_count" -eq 6 ] || return 1
  fi
  if [ "$publisher_enabled" = 1 ]; then [ "$worker_enabled" = 1 ] || return 1; fi
  if [ "$release_enabled" = 1 ]; then
    [ "$worker_enabled" = 1 ] && [ "$publisher_enabled" = 1 ] || return 1
  fi
}

validate_live_constructor_units_quiesced() {
  local report=${1:-0} unit path metadata count=0
  case "$report" in 0|1) ;; *) return 1 ;; esac
  [ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ] \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure runtime-ready-stamp ready-stamp-present; return 1; }
  for unit in "${constructor_timers[@]}"; do
    path=/etc/systemd/system/$unit
    [ -f "$path" ] && [ ! -L "$path" ] \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" file-type; return 1; }
    metadata=$(stat -c '%u:%g:%a' "$path") \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" file-metadata-query; return 1; }
    [ "$metadata" = '0:0:444' ] \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" file-metadata; return 1; }
    validate_constructor_timer_unit "$path" "systemd-timer.$unit" \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" timer-contract; return 1; }
    systemctl cat "$unit" >/dev/null 2>&1 \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" unit-catalog; return 1; }
    validate_effective_constructor_unit "$unit" "$report" || return 1
    count=$((count + 1))
  done
  for unit in "${constructor_services[@]}"; do
    path=/etc/systemd/system/$unit
    [ -f "$path" ] && [ ! -L "$path" ] \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" file-type; return 1; }
    metadata=$(stat -c '%u:%g:%a' "$path") \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" file-metadata-query; return 1; }
    [ "$metadata" = '0:0:444' ] \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" file-metadata; return 1; }
    validate_constructor_service_unit "$path" "systemd-service.$unit" \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" service-contract; return 1; }
    systemctl cat "$unit" >/dev/null 2>&1 \
      || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" unit-catalog; return 1; }
    validate_effective_constructor_unit "$unit" "$report" || return 1
    count=$((count + 1))
  done
  [ "$count" -eq 6 ] \
    || { [ "$report" = 0 ] || report_live_constructor_quiesce_failure systemd unit-count; return 1; }
  validate_constructor_quiesce_barrier "$report"
}

wait_for_live_constructor_units_quiesced() {
  local attempt report
  for ((attempt = 1; attempt <= 12; attempt++)); do
    report=0
    [ "$attempt" -lt 12 ] || report=1
    if validate_live_constructor_units_quiesced "$report"; then return 0; fi
    [ "$attempt" -lt 12 ] || break
    # systemctl daemon-reload este sincron, dar proprietățile efective pot fi
    # observate tranzitoriu din generații diferite. Repetăm numai dovada
    # read-only; niciun predicat și nicio mutație nu sunt relaxate.
    sleep 0.25
  done
  return 1
}

validate_constructor_quiesce_barrier() {
  local report=${1:-0} unit state count=0 predicate
  case "$report" in 0|1) ;; *) return 1 ;; esac
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    [ "$report" = 0 ] || report_live_constructor_quiesce_failure runtime-ready-stamp ready-stamp-present
    return 1
  fi
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    count=$((count + 1))
    if ! validate_constructor_unit_file_state "$unit"; then
      case "$unit" in *.timer) predicate=timer-unit-file-state ;; *) predicate=service-unit-file-state ;; esac
      [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" "$predicate"
      return 1
    fi
    state=$(systemctl show "$unit" --property=ActiveState --value) || {
      [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" active-state-query
      return 1
    }
    case "$state" in
      inactive|failed) ;;
      *)
        [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" active-state
        return 1 ;;
    esac
    if [ -n "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ]; then
      [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" pending-job
      return 1
    fi
  done
  case "$count" in
    0|6) ;;
    *)
      [ "$report" = 0 ] || report_live_constructor_quiesce_failure systemd unit-count
      return 1 ;;
  esac
  for unit in "${constructor_auxiliary_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    state=$(systemctl show "$unit" --property=ActiveState --value) || {
      [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" auxiliary-active-state-query
      return 1
    }
    case "$state" in
      inactive|failed) ;;
      *)
        [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" auxiliary-active-state
        return 1 ;;
    esac
    if [ -n "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ]; then
      [ "$report" = 0 ] || report_live_constructor_quiesce_failure "$unit" auxiliary-pending-job
      return 1
    fi
  done
}

validate_constructor_state() {
  local path config_count=0 staged_config_count=0 staged_unit_count=0 unit_count=0 effective_unit_count=0
  local marker_count=0 unit logical index runtime_candidate worker_enabled publisher_enabled release_enabled
  for path in "${constructor_configs[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:640' ] \
        || die "config Constructor live nesigur: $path"
      config_count=$((config_count + 1))
    fi
  done
  case "$config_count" in 0|3) ;; *) die 'stare parțială a celor trei configuri Constructor' ;; esac
  for logical in constructor-config.codex-worker.env constructor-config.constructor-publisher.env constructor-config.constructor-release.env; do
    if [ -n "${seen_logical[$logical]:-}" ]; then staged_config_count=$((staged_config_count + 1)); fi
  done
  case "$staged_config_count" in 0|3) ;; *) die 'staging parțial al celor trei configuri Constructor' ;; esac
  constructor_configured=$config_count
  if [ "$staged_config_count" -eq 3 ]; then constructor_configured=3; fi
  for logical in \
    systemd-timer.kelion-codex-worker.timer \
    systemd-timer.kelion-constructor-publisher.timer \
    systemd-timer.kelion-constructor-release.timer \
    systemd-service.kelion-codex-worker.service \
    systemd-service.kelion-constructor-publisher.service \
    systemd-service.kelion-constructor-release.service; do
    if [ -n "${seen_logical[$logical]:-}" ]; then staged_unit_count=$((staged_unit_count + 1)); fi
  done
  case "$staged_unit_count" in 0|6) ;; *) die 'staging parțial al celor șase unități Constructor' ;; esac
  constructor_staged_unit_count=$staged_unit_count
  if [ "$staged_unit_count" -eq 6 ] && [ "${#logical_names[@]}" -eq 6 ]; then
    unit_only_transaction=1
    [ "$leave_constructor_quiesced" = 1 ] \
      || die 'tranzacția unit-only trebuie urmată de un cutover strict și rămâne quiesced'
  fi
  for path in "${constructor_markers[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] \
        || die "marker Constructor nesigur: $path"
      [ "$constructor_configured" -eq 3 ] || die 'marker Constructor activ fără toate configurile efective'
      marker_count=$((marker_count + 1))
    fi
  done
  if [ -f "${constructor_markers[2]}" ]; then
    [ -f "${constructor_markers[0]}" ] && [ -f "${constructor_markers[1]}" ] \
      || die 'markerul release cere workerul și publisherul active'
  fi
  if [ -f "${constructor_markers[1]}" ]; then
    [ -f "${constructor_markers[0]}" ] || die 'markerul publisher cere workerul activ'
  fi
  if [ -n "${seen_logical[runtime.env]:-}" ]; then
    runtime_candidate=$stage_root/files/runtime.env
  else
    runtime_candidate=$CONFIG_ROOT/runtime.env
  fi
  [ -f "$runtime_candidate" ] && [ ! -L "$runtime_candidate" ] \
    || die 'runtime.env efectiv lipsește sau este symlink'
  worker_enabled=$(sed -n 's/^CODEX_WORKER_ENABLED=//p' "$runtime_candidate")
  publisher_enabled=$(sed -n 's/^CONSTRUCTOR_PUBLISHER_ENABLED=//p' "$runtime_candidate")
  release_enabled=$(sed -n 's/^CONSTRUCTOR_RELEASE_ENABLED=//p' "$runtime_candidate")
  for index in "${!constructor_markers[@]}"; do
    if [ -f "${constructor_markers[$index]}" ]; then
      [ -f "$runtime_candidate" ] && [ ! -L "$runtime_candidate" ] \
        && grep -qx "${constructor_flags[$index]}=1" "$runtime_candidate" \
        || die "marker Constructor activ cu ${constructor_flags[$index]} dezactivat"
    fi
  done
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then unit_count=$((unit_count + 1)); fi
  done
  case "$unit_count" in
    0|6) ;;
    *) die 'set parțial de unități Constructor' ;;
  esac
  effective_unit_count=$unit_count
  if [ "$staged_unit_count" -eq 6 ]; then effective_unit_count=6; fi
  if [ "$effective_unit_count" -eq 0 ]; then
    [ "$constructor_configured" -eq 0 ] && [ "$marker_count" -eq 0 ] \
      || die 'config sau markere Constructor fără toate unitățile systemd efective'
  fi
  if [ "$constructor_configured" -eq 3 ] || [ "$marker_count" -gt 0 ]; then
    [ "$effective_unit_count" -eq 6 ] \
      || die 'tupla efectivă Constructor config/unități este incompletă'
  fi
  if [ "$constructor_configured" -eq 0 ]; then
    [ "$worker_enabled" = 0 ] && [ "$publisher_enabled" = 0 ] && [ "$release_enabled" = 0 ] \
      || die 'runtime-ul efectiv activează Constructor fără cele trei configuri'
  fi
  if [ "$worker_enabled" = 1 ] || [ "$publisher_enabled" = 1 ] || [ "$release_enabled" = 1 ]; then
    [ "$constructor_configured" -eq 3 ] && [ "$effective_unit_count" -eq 6 ] \
      || die 'flagurile runtime active cer configuri și unități Constructor complete'
  fi
  if [ "$publisher_enabled" = 1 ]; then
    [ "$worker_enabled" = 1 ] || die 'publisherul runtime cere workerul activ'
  fi
  if [ "$release_enabled" = 1 ]; then
    [ "$worker_enabled" = 1 ] && [ "$publisher_enabled" = 1 ] \
      || die 'release-ul runtime cere workerul și publisherul active'
  fi
  constructor_unit_count=$unit_count
}

quiesce_constructor_units() {
  force_quiesce_constructor_units
}

validate_constructor_quiesce_postconditions() {
  local allow_partial=${1:-0} unit state failed=0 count=0
  case "$allow_partial" in 0|1) ;; *) return 1 ;; esac
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    count=$((count + 1))
    state=$(systemctl show "$unit" --property=ActiveState --value) \
      || { report_quiesce_postcondition_failure "$unit" active-state-query; failed=1; continue; }
    case "$state" in inactive|failed) ;; *) report_quiesce_postcondition_failure "$unit" active-state; failed=1 ;; esac
    validate_constructor_prepublication_unit_file_state "$unit" \
      || { report_quiesce_postcondition_failure "$unit" unit-file-state; failed=1; }
    # La boot, un legacy WantedBy poate avea deja un start job care așteaptă
    # după Before=. Stop-ul sincron urmat de postcondiția fără job trebuie să-l
    # anuleze; altfel ar porni imediat după recovery-ul fail-closed.
    if [ -n "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ]; then
      report_quiesce_postcondition_failure "$unit" pending-job; failed=1
    fi
  done
  if [ "$count" -ne 0 ] && [ "$count" -ne 6 ] && [ "$allow_partial" != 1 ]; then failed=1; fi
  constructor_unit_count=$count
  for unit in "${constructor_auxiliary_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    state=$(systemctl show "$unit" --property=ActiveState --value) \
      || { report_quiesce_postcondition_failure "$unit" active-state-query; failed=1; continue; }
    case "$state" in inactive|failed) ;; *) report_quiesce_postcondition_failure "$unit" active-state; failed=1 ;; esac
    if [ -n "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ]; then
      report_quiesce_postcondition_failure "$unit" pending-job; failed=1
    fi
  done
  [ "$failed" = 0 ]
}

wait_for_constructor_quiesce_postconditions() {
  local allow_partial=${1:-0} attempt
  case "$allow_partial" in 0|1) ;; *) return 1 ;; esac
  for ((attempt = 1; attempt <= 12; attempt++)); do
    if validate_constructor_quiesce_postconditions "$allow_partial"; then return 0; fi
    [ "$attempt" -lt 12 ] || break
    sleep 0.25
  done
  return 1
}

force_quiesce_constructor_units() {
  local allow_partial=${1:-0} unit
  case "$allow_partial" in 0|1) ;; *) return 1 ;; esac
  # Stamp-ul este capabilitatea de execuție a întregului lanț. Îl retragem și
  # sincronizăm înainte de primul stop, astfel încât niciun SIGKILL să nu poată
  # lăsa o stare false-ready cu numai o parte dintre unități oprite.
  clear_runtime_ready_stamp || return 1
  units_quiesced=1
  for unit in "${constructor_timers[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    stop_and_disable_constructor_timer "$unit"
  done
  for unit in "${constructor_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    stop_and_disable_constructor_service "$unit"
  done
  for unit in "${constructor_auxiliary_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    systemctl stop "$unit" >/dev/null 2>&1 || :
  done
  systemctl daemon-reload \
    || { report_quiesce_postcondition_failure systemd daemon-reload; return 1; }
  wait_for_constructor_quiesce_postconditions "$allow_partial"
}

start_constructor_unit() {
  if [ "$boot_recovery" = 1 ]; then
    systemctl start --no-block "$1"
  else
    systemctl start "$1"
  fi
}

restore_constructor_model_control() {
  local unit=kelion-constructor-model-control.service socket=/run/kelion-constructor-model-control/control.sock attempt state
  if ! systemctl cat "$unit" >/dev/null 2>&1; then
    [ "$leave_constructor_quiesced" = 1 ] && return 0
    return 1
  fi
  validate_effective_constructor_unit "$unit" || return 1
  systemctl is-enabled --quiet "$unit" || return 1
  if [ -e "$JOURNAL" ] || [ -L "$JOURNAL" ] \
    || [ -e "$ACTIVATION_PENDING" ] || [ -L "$ACTIVATION_PENDING" ] \
    || { [ "$constructor_upgrade_owner" = 1 ] && [ -n "$upgrade_journal_phase" ]; }; then
    # Installerul și upgrade-ul exterior dețin aceeași barieră. Controllerul
    # rămâne oprit chiar dacă fișierele/configul intermediar au fost comise;
    # ownerul îl pornește numai după clear-ul durabil al jurnalului exterior.
    validate_activation_pending || return 1
    if [ -e "$JOURNAL" ] || [ -L "$JOURNAL" ]; then
      validate_owned_runtime_journal || return 1
    fi
    if [ -e "$ACTIVATION_PENDING" ] || [ -L "$ACTIVATION_PENDING" ]; then
      [ -f "$ACTIVATION_PENDING" ] || return 1
    fi
    systemctl stop "$unit" >/dev/null 2>&1 || :
    state=$(systemctl show "$unit" --property=ActiveState --value) || return 1
    case "$state" in inactive|failed) ;; *) return 1 ;; esac
    [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ] \
      && [ ! -e "$socket" ] && [ ! -L "$socket" ]
    return
  fi
  systemctl restart "$unit" || return 1
  systemctl is-active --quiet "$unit" || return 1
  for ((attempt = 1; attempt <= 40; attempt++)); do
    if [ -S "$socket" ] && [ ! -L "$socket" ] \
      && [ "$(stat -Lc '%u:%g:%a' "$socket")" = '0:10050:660' ]; then
      return 0
    fi
    [ "$attempt" -lt 40 ] || break
    sleep 0.25
  done
  return 1
}

restore_runtime_controller_or_quiesce() {
  if restore_constructor_model_control; then return 0; fi
  # Ready nu este adevărat fără controller active + UDS exact. Retragem imediat
  # toate capabilitățile, înainte ca `die`/trap să raporteze eșecul.
  force_quiesce_constructor_units 1 || true
  clear_runtime_ready_stamp || true
  return 1
}

restore_constructor_timers() {
  local index timer marker state unit_count=0 unit failed=0
  [ "$units_quiesced" = 1 ] || return 0
  systemctl daemon-reload || failed=1
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then unit_count=$((unit_count + 1)); fi
  done
  case "$unit_count" in
    0) units_quiesced=0; return "$failed" ;;
    6) ;;
    *) failed=1 ;;
  esac
  for index in "${!constructor_timers[@]}"; do
    timer=${constructor_timers[$index]}
    marker=${constructor_markers[$index]}
    if [ -f "$marker" ]; then
      systemctl enable "$timer" >/dev/null || failed=1
      start_constructor_unit "$timer" || failed=1
      systemctl is-enabled --quiet "$timer" || failed=1
      if [ "$boot_recovery" = 0 ]; then systemctl is-active --quiet "$timer" || failed=1; fi
    else
      systemctl disable --now "$timer" >/dev/null || failed=1
      if systemctl is-enabled --quiet "$timer" || systemctl is-active --quiet "$timer"; then failed=1; fi
    fi
  done
  if [ "$boot_recovery" = 0 ]; then
    for unit in "${constructor_services[@]}"; do
      stop_and_disable_constructor_service "$unit" || failed=1
      validate_constructor_unit_file_state "$unit" || failed=1
      state=$(systemctl show "$unit" --property=ActiveState --value) || { failed=1; continue; }
      case "$state" in inactive|failed) ;; *) failed=1 ;; esac
    done
  fi
  if [ "$failed" != 0 ]; then
    force_quiesce_constructor_units || true
    return 1
  fi
  units_quiesced=0
}

roll_forward_unit_transaction() {
  local root=$1 forward manifest logical digest extra source temporary index unit failed=0 count=0
  local mapped_target mapped_owner mapped_group mapped_mode
  local -a forward_logicals=() forward_sources=() forward_targets=() forward_owners=() forward_groups=() forward_modes=()
  local -A allowed=(
    [systemd-timer.kelion-codex-worker.timer]=1
    [systemd-timer.kelion-constructor-publisher.timer]=1
    [systemd-timer.kelion-constructor-release.timer]=1
    [systemd-service.kelion-codex-worker.service]=1
    [systemd-service.kelion-constructor-publisher.service]=1
    [systemd-service.kelion-constructor-release.service]=1
  )
  local -A seen=()
  [[ "$root" =~ ^/root/kelion/runtime/runtime-config-txn\.[A-Za-z0-9]+$ ]] \
    && [ -d "$root" ] && [ ! -L "$root" ] \
    && [ "$(realpath -e -- "$root")" = "$root" ] \
    && [ "$(stat -c '%u:%g:%a' "$root")" = '0:0:700' ] || return 1
  forward=$root/forward
  manifest=$root/forward-manifest
  [ -d "$forward" ] && [ ! -L "$forward" ] && [ "$(stat -c '%u:%g:%a' "$forward")" = '0:0:700' ] || return 1
  [ -f "$manifest" ] && [ ! -L "$manifest" ] && [ "$(stat -c '%u:%g:%a' "$manifest")" = '0:0:600' ] || return 1
  while IFS=$'\t' read -r logical digest extra; do
    [ -n "${allowed[$logical]:-}" ] && [ -z "${seen[$logical]:-}" ] && [ -z "$extra" ] \
      && [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    seen[$logical]=1
    source=$forward/$logical
    [ -f "$source" ] && [ ! -L "$source" ] && [ "$(stat -c '%u:%g:%a' "$source")" = '0:0:600' ] \
      && [ "$(sha256sum "$source" | awk '{print $1}')" = "$digest" ] || return 1
    case "$logical" in
      systemd-timer.*) validate_constructor_timer_unit "$source" "$logical" || return 1 ;;
      systemd-service.*) validate_constructor_service_unit "$source" "$logical" || return 1 ;;
      *) return 1 ;;
    esac
    map_logical "$logical"
    forward_logicals+=("$logical")
    forward_sources+=("$source")
    forward_targets+=("$mapped_target")
    forward_owners+=("$mapped_owner")
    forward_groups+=("$mapped_group")
    forward_modes+=("$mapped_mode")
    count=$((count + 1))
  done < "$manifest"
  [ "$count" -eq 6 ] && [ "${#seen[@]}" -eq 6 ] || return 1
  for logical in "${!allowed[@]}"; do [ -n "${seen[$logical]:-}" ] || return 1; done

  # Setul 1..5 este tolerat exclusiv după autentificarea jurnalului, a
  # directorului root-only, a setului exact și a hashurilor candidaților.
  quiesce_units_for_recovery 1 \
    || { printf 'runtime-cutover: unit-roll-forward:pre-quiesce\n' >&2; return 1; }
  for index in "${!forward_targets[@]}"; do
    temporary=$(mktemp "${forward_targets[$index]}.unit-forward.XXXXXX") || { failed=1; continue; }
    if install -o "${forward_owners[$index]}" -g "${forward_groups[$index]}" -m "${forward_modes[$index]}" \
        "${forward_sources[$index]}" "$temporary" \
      && cmp -s -- "$temporary" "${forward_sources[$index]}" \
      && mv -f -- "$temporary" "${forward_targets[$index]}" \
      && cmp -s -- "${forward_targets[$index]}" "${forward_sources[$index]}" \
      && fsync_path "${forward_targets[$index]}" \
      && fsync_path "$(dirname -- "${forward_targets[$index]}")"; then
      :
    else
      rm -f -- "$temporary"
      printf 'runtime-cutover: unit-roll-forward:publish:%s\n' "${forward_logicals[$index]}" >&2
      failed=1
    fi
  done
  [ "$failed" = 0 ] || return 1
  systemctl daemon-reload \
    || { printf 'runtime-cutover: unit-roll-forward:daemon-reload\n' >&2; return 1; }
  force_quiesce_constructor_units \
    || { printf 'runtime-cutover: unit-roll-forward:post-quiesce\n' >&2; return 1; }
  wait_for_live_constructor_units_quiesced \
    || { printf 'runtime-cutover: unit-roll-forward:strict-live-unit-contract\n' >&2; return 1; }
  # Un forward unit-only nu publică niciodată capabilitatea de execuție. Markerul
  # pending obligă următoarea etapă mixtă să treacă schema runtime strictă.
  clear_runtime_ready_stamp \
    || { printf 'runtime-cutover: unit-roll-forward:ready-clear\n' >&2; return 1; }
  units_quiesced=0
}

resolve_validated_candidate() {
  local output_name=$1 wanted=$2 candidate previous_restart_required=$restart_required
  if grep -Fxq -- "$wanted" "$stage_root/manifest"; then
    candidate=$stage_root/files/$wanted
    [ -f "$candidate" ] && [ ! -L "$candidate" ] \
      || die "candidatul validat a dispărut după manifest: $wanted"
    validate_secret_file "$candidate" \
      || die "candidatul din manifest nu mai este valid: $wanted"
  else
    map_logical "$wanted"
    # Rezolvarea unei valori live este read-only. map_logical setează și
    # restart_required pentru mutațiile app/runtime; verificarea distinctness
    # nu are voie să transforme un cutover parțial într-un restart backend.
    restart_required=$previous_restart_required
    candidate=$mapped_target
    [ -f "$candidate" ] && [ ! -L "$candidate" ] \
      || die "candidatul nu este în manifest și lipsește live: $wanted"
    [ "$(stat -c '%u:%g:%a' "$candidate")" = "$mapped_owner:$mapped_group:$mapped_mode" ] \
      || die "candidatul live are ACL invalid: $wanted"
    validate_secret_file "$candidate" || die "candidatul live este invalid: $wanted"
  fi
  printf -v "$output_name" '%s' "$candidate"
}

assert_pairwise_distinct() {
  local label=$1; shift
  local -a values=()
  local logical file value existing
  for logical in "$@"; do
    resolve_validated_candidate file "$logical"
    value=$(sed -n '1p' "$file")
    [ "${#value}" -ge 32 ] || die "$label conține o valoare prea scurtă"
    for existing in "${values[@]:-}"; do [ "$value" != "$existing" ] || die "$label trebuie să fie distincte"; done
    values+=("$value")
  done
}

validate_candidate_secret_separation() {
  if [ "$unit_only_transaction" = 1 ] && [ "$defer_secret_gates" = 1 ]; then
    # Tranzacția unit-only publică exclusiv cele șase unități, le păstrează
    # quiesced și ridică bariera durabilă care poate fi consumată numai de
    # cutover-ul mixt următor. Opt-in-ul este permis numai apelanților care
    # continuă cu un astfel de cutover. Nu valida aici secretele live legacy: noile
    # credențiale sunt încă în payload-ul apelantului și sunt staged abia după
    # instalarea unităților. Cutover-ul mixt validează candidații efectivi înainte
    # de orice commit și nu poate consuma bariera dacă distinctness eșuează.
    return 0
  fi
  assert_pairwise_distinct 'HMAC-urile Constructor' \
    app-secret.codex-worker-secret app-secret.constructor-model-control-secret \
    app-secret.constructor-publisher-secret app-secret.constructor-release-secret \
    || return 1
  assert_pairwise_distinct 'credentialele OAuth Admin și GHCR' \
    app-secret.github-release-oauth-token gate-secret.github-ghcr-read-token \
    || return 1
  if [ "$constructor_configured" -eq 3 ]; then
    assert_pairwise_distinct 'tokenurile GitHub Constructor și OAuth Admin' \
      worker-secret.github-worker-token publisher-secret.github-publisher-token release-secret.github-release-token gate-secret.github-ghcr-read-token app-secret.github-release-oauth-token \
      || return 1
  fi
}

recreate_active_release() {
  local selected_compose=${1:-$compose_file}
  local marker slot bind_port subnet worker_ip proxy_ip role id image readiness
  local -A images=()
  [ -x "$COMPOSE_BIN" ] || return 1
  if [ ! -e "$RUNTIME_ROOT/release-state/active" ] && [ ! -L "$RUNTIME_ROOT/release-state/active" ]; then return 0; fi
  [ -f "$RUNTIME_ROOT/release-state/active" ] && [ ! -L "$RUNTIME_ROOT/release-state/active" ] \
    && [ "$(stat -c '%u:%g:%a' "$RUNTIME_ROOT/release-state/active")" = '0:10050:640' ] \
    && [ "$(wc -l < "$RUNTIME_ROOT/release-state/active")" -eq 1 ] || return 1
  marker=$(sed -n '1p' "$RUNTIME_ROOT/release-state/active")
  if [ "$marker" = legacy ]; then
    return 1
  fi
  [[ "$marker" =~ ^[0-9a-f]{40}$ ]] || return 1
  if grep -q 'app-blue:8080' "$ROOT/proxy/upstream/kelion-upstream.caddy"; then
    slot=blue; bind_port=18080; subnet=172.29.10.0/24; worker_ip=172.29.10.2; proxy_ip=172.29.10.3
  elif grep -q 'app-green:8080' "$ROOT/proxy/upstream/kelion-upstream.caddy"; then
    slot=green; bind_port=18081; subnet=172.29.11.0/24; worker_ip=172.29.11.2; proxy_ip=172.29.11.3
  else
    return 1
  fi
  for role in app browser-worker browser-egress converter-gateway converter-parser; do
    mapfile -t role_ids < <(docker ps -aq --filter 'label=com.kelion.managed=true' --filter "label=com.kelion.slot=$slot" --filter "label=com.kelion.role=$role")
    [ "${#role_ids[@]}" -eq 1 ] || return 1
    id=${role_ids[0]}
    [ "$(docker inspect -f '{{index .Config.Labels "com.kelion.commit"}}' "$id")" = "$marker" ] || return 1
    image=$(docker inspect -f '{{.Config.Image}}' "$id") || return 1
    [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] || return 1
    images[$role]=$image
  done
  export KELION_SLOT=$slot KELION_COMMIT_SHA=$marker KELION_BIND_PORT=$bind_port
  export KELION_BROWSER_SUBNET=$subnet KELION_BROWSER_WORKER_IP=$worker_ip KELION_BROWSER_PROXY_IP=$proxy_ip
  export KELION_RUNTIME_ROOT=$RUNTIME_ROOT/slots/$slot KELION_RELEASE_STATE_ROOT=$RUNTIME_ROOT/release-state
  export KELION_CONFIG_FILE=$CONFIG_ROOT/runtime.env KELION_SECRET_ROOT=$SECRET_ROOT
  export KELION_SECCOMP_PROFILE=$RUNTIME_ROOT/playwright-seccomp-v1.62.1.json
  export KELION_APP_IMAGE=${images[app]} KELION_BROWSER_IMAGE=${images[browser-worker]}
  export KELION_BROWSER_EGRESS_IMAGE=${images[browser-egress]}
  export KELION_CONVERTER_GATEWAY_IMAGE=${images[converter-gateway]}
  export KELION_CONVERTER_PARSER_IMAGE=${images[converter-parser]}
  "$COMPOSE_BIN" -p "kelion-$slot" -f "$selected_compose" config --quiet || return 1
  "$COMPOSE_BIN" -p "kelion-$slot" -f "$selected_compose" up -d --no-build --remove-orphans --force-recreate --wait --wait-timeout 180 || return 1
  readiness=$(curl --fail --silent --show-error --max-time 12 "http://127.0.0.1:$bind_port/readyz") || return 1
  jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$readiness" >/dev/null || return 1
  [ "$(curl --fail --silent --show-error --max-time 12 "http://127.0.0.1:$bind_port/api/version" | jq -er '.v')" = "${marker:0:7}" ]
}

guard_active_release_restart() {
  local marker slot role id
  local -a role_ids=()
  [ "$restart_required" = 1 ] || return 0
  if [ ! -e "$RUNTIME_ROOT/release-state/active" ] && [ ! -L "$RUNTIME_ROOT/release-state/active" ]; then return 0; fi
  [ -f "$RUNTIME_ROOT/release-state/active" ] && [ ! -L "$RUNTIME_ROOT/release-state/active" ] \
    && [ "$(stat -c '%u:%g:%a' "$RUNTIME_ROOT/release-state/active")" = '0:10050:640' ] \
    && [ "$(wc -l < "$RUNTIME_ROOT/release-state/active")" -eq 1 ] || return 1
  marker=$(sed -n '1p' "$RUNTIME_ROOT/release-state/active")
  [[ "$marker" =~ ^[0-9a-f]{40}$ ]] || return 1
  if grep -q 'app-blue:8080' "$ROOT/proxy/upstream/kelion-upstream.caddy"; then slot=blue
  elif grep -q 'app-green:8080' "$ROOT/proxy/upstream/kelion-upstream.caddy"; then slot=green
  else return 1
  fi
  restart_guarded=1
  for role in app browser-worker browser-egress converter-gateway converter-parser; do
    mapfile -t role_ids < <(docker ps -aq --filter 'label=com.kelion.managed=true' --filter "label=com.kelion.slot=$slot" --filter "label=com.kelion.role=$role")
    [ "${#role_ids[@]}" -eq 1 ] || return 1
    id=${role_ids[0]}
    [ "$(docker inspect -f '{{index .Config.Labels "com.kelion.commit"}}' "$id")" = "$marker" ] || return 1
    docker update --restart=no "$id" >/dev/null || return 1
    [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$id")" = no ] || return 1
  done
}

restore_files() {
  local index target temporary failed=0
  for index in "${!targets[@]}"; do
    target=${targets[$index]}
    if [ "${backup_present[$index]:-0}" = 1 ]; then
      temporary=$(mktemp "$target.rollback.XXXXXX") || { failed=1; continue; }
      if install -o "${owner_ids[$index]}" -g "${group_ids[$index]}" -m "${modes[$index]}" "${backups[$index]}" "$temporary" \
        && mv -f -- "$temporary" "$target" \
        && cmp -s -- "$target" "${backups[$index]}"; then
        :
      else
        rm -f -- "$temporary"
        failed=1
      fi
    else
      rm -f -- "$target" || failed=1
    fi
    if [ "$failed" = 0 ]; then
      if [ -e "$target" ]; then fsync_path "$target" || failed=1; fi
      fsync_path "$(dirname -- "$target")" || failed=1
    fi
  done
  if [ "$failed" = 0 ]; then systemctl daemon-reload || failed=1; fi
  [ "$failed" = 0 ]
}

validate_live_markers_for_recovery() {
  local config_count=0 index path
  for path in "${constructor_configs[@]}"; do
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:640' ] || return 1
      config_count=$((config_count + 1))
    fi
  done
  case "$config_count" in 0|3) ;; *) return 1 ;; esac
  for index in "${!constructor_markers[@]}"; do
    path=${constructor_markers[$index]}
    if [ -e "$path" ] || [ -L "$path" ]; then
      [ -f "$path" ] && [ ! -L "$path" ] && [ "$(stat -c '%u:%g:%a' "$path")" = '0:0:444' ] || return 1
      [ "$config_count" = 3 ] || return 1
      [ -f "$CONFIG_ROOT/runtime.env" ] && [ ! -L "$CONFIG_ROOT/runtime.env" ] || return 1
      grep -qx "${constructor_flags[$index]}=1" "$CONFIG_ROOT/runtime.env" || return 1
      grep -qx "${constructor_exec_flags[$index]}=1" "${constructor_configs[$index]}" || return 1
    fi
  done
  if [ -f "${constructor_markers[2]}" ]; then
    [ -f "${constructor_markers[0]}" ] && [ -f "${constructor_markers[1]}" ] || return 1
  fi
  if [ -f "${constructor_markers[1]}" ]; then [ -f "${constructor_markers[0]}" ] || return 1; fi
  validate_live_runtime_contract
}

wait_for_activation_backend_ready() {
  local origin=$1 readiness deadline max_time
  if [ "$boot_recovery" = 1 ]; then
    # Recovery.service are TimeoutStartSec=10min. Păstrăm 120s rezervă pentru
    # restul dovezilor și pentru oprirea fail-closed la timeout.
    deadline=$((SECONDS + 480))
    max_time=8
  else
    deadline=$SECONDS
    max_time=12
  fi
  while true; do
    if readiness=$(curl --fail --silent --show-error --max-time "$max_time" "$origin/readyz") \
      && jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$readiness" >/dev/null; then
      return 0
    fi
    [ "$boot_recovery" = 1 ] || return 1
    [ "$SECONDS" -lt "$deadline" ] || return 1
    sleep 5
  done
}

quiesce_units_for_recovery() {
  local allow_partial=${1:-0} count=0 unit
  case "$allow_partial" in 0|1) ;; *) return 1 ;; esac
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then count=$((count + 1)); fi
  done
  case "$count" in
    0) constructor_unit_count=0 ;;
    6) constructor_unit_count=6 ;;
    *) [ "$allow_partial" = 1 ] || return 1; constructor_unit_count=$count ;;
  esac
  force_quiesce_constructor_units "$allow_partial"
}

recover_interrupted_gate_refresh() {
  local gate_root commit helper_sha active_file active_commit index source target logical temporary failed=0
  local -a gate_names=(codex-worker.env constructor-publisher.env constructor-release.env)
  local -a gate_logicals=(constructor-config.codex-worker.env constructor-config.constructor-publisher.env constructor-config.constructor-release.env)
  if [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ]; then return 0; fi
  recovery_in_progress=1
  [ -f "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] && [ "$(stat -c '%u:%g:%a' "$GATE_JOURNAL")" = '0:0:600' ] \
    || die 'jurnalul refresh-ului gate este nesigur'
  jq -e '.schema == 1 and (.commit | strings | test("^[0-9a-f]{40}$")) and (.helperSha256 | strings | test("^[0-9a-f]{64}$")) and (.transactionRoot | type == "string")' "$GATE_JOURNAL" >/dev/null \
    || die 'jurnalul refresh-ului gate este invalid'
  commit=$(jq -er '.commit' "$GATE_JOURNAL")
  helper_sha=$(jq -er '.helperSha256' "$GATE_JOURNAL")
  [ "$(sha256sum "$0" | awk '{print $1}')" = "$helper_sha" ] \
    || die 'helperul de recovery nu corespunde hashului jurnalizat'
  gate_root=$(jq -er '.transactionRoot' "$GATE_JOURNAL")
  [[ "$gate_root" =~ ^/root/kelion/runtime/constructor-gate-txn\.[A-Za-z0-9]+$ ]] \
    && [ -d "$gate_root" ] && [ ! -L "$gate_root" ] \
    && [ "$(realpath -e -- "$gate_root")" = "$gate_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$gate_root")" = '0:0:700' ] \
    || die 'directorul tranzacției gate este nesigur'
  active_file=$RUNTIME_ROOT/release-state/active
  [ -f "$active_file" ] && [ ! -L "$active_file" ] && [ "$(stat -c '%u:%g:%a' "$active_file")" = '0:10050:640' ] \
    && [ "$(wc -l < "$active_file")" -eq 1 ] || die 'markerul activ este invalid în recovery gate'
  active_commit=$(sed -n '1p' "$active_file")
  [ "$active_commit" = "$commit" ] || die 'jurnalul gate nu corespunde release-ului activ'
  for index in "${!gate_names[@]}"; do
    source=$gate_root/new/${gate_names[$index]}
    [ -f "$source" ] && [ ! -L "$source" ] && [ "$(stat -c '%u:%g:%a' "$source")" = '0:0:600' ] \
      || die "config nou gate nesigur: ${gate_names[$index]}"
    validate_env_file "$source" "${gate_logicals[$index]}" || die "config nou gate invalid: ${gate_names[$index]}"
  done
  quiesce_units_for_recovery || die 'unitățile Constructor nu pot fi oprite pentru recovery gate'
  for index in "${!gate_names[@]}"; do
    source=$gate_root/new/${gate_names[$index]}
    target=$CONFIG_ROOT/${gate_names[$index]}
    temporary=$(mktemp "$target.gate-recovery.XXXXXX") || { failed=1; continue; }
    if install -o root -g root -m 0640 "$source" "$temporary" \
      && mv -f -- "$temporary" "$target" \
      && cmp -s -- "$target" "$source" \
      && fsync_path "$target" \
      && fsync_path "$CONFIG_ROOT"; then
      :
    else
      rm -f -- "$temporary"; failed=1
    fi
  done
  [ "$failed" = 0 ] || die 'roll-forward-ul durabil al gate-ului a eșuat'
  validate_live_markers_for_recovery || die 'marker-ele nu corespund configului gate recuperat'
  systemctl daemon-reload || die 'systemd nu a putut reîncărca gate-ul recuperat'
  if [ "$leave_constructor_quiesced" = 1 ]; then
    # Unitățile sunt fizic inactive/disabled. Resetăm numai flagul cleanup-ului,
    # astfel încât apelantul să le poată reactiva după propria dovadă de commit.
    units_quiesced=0
  else
    publish_runtime_ready_stamp || die 'stamp-ul runtime nu a putut fi publicat după recovery gate'
    restore_constructor_timers || die 'timer-ele nu au putut fi restaurate după recovery gate'
  fi
  rm -f -- "$GATE_JOURNAL" || die 'jurnalul gate nu a putut fi eliminat'
  fsync_path "$RUNTIME_ROOT" || die 'ștergerea jurnalului gate nu a putut fi sincronizată'
  gate_journal_clear_durable=1
  recovery_in_progress=0
  if [ "$gate_journal_clear_durable" != 1 ] || [ -e "$GATE_JOURNAL" ] || [ -L "$GATE_JOURNAL" ] \
    || ! remove_gate_transaction_dir "$gate_root"; then
    printf 'runtime-cutover: avertisment: tranzacția gate a rămas root-only\n' >&2
  fi
}

validate_unmutated_gate_transaction() {
  local gate_root=$1 expected_helper_sha=${2:-} helper_sha observed expected index source actual
  local -a gate_names=(codex-worker.env constructor-publisher.env constructor-release.env)
  local -a gate_logicals=(constructor-config.codex-worker.env constructor-config.constructor-publisher.env constructor-config.constructor-release.env)
  local -a gate_keys=(worker publisher release)
  [[ "$gate_root" =~ ^/root/kelion/runtime/(constructor-gate-txn\.[A-Za-z0-9]+|constructor-gate-discarded\.[0-9a-f]{40}\.[0-9a-f]{64})$ ]] \
    && [ -d "$gate_root" ] && [ ! -L "$gate_root" ] \
    && [ "$(realpath -e -- "$gate_root")" = "$gate_root" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$gate_root")" = '0:0:700' ] \
    || return 1
  observed=$(find "$gate_root" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort) \
    || return 1
  expected=$'new:d\nrecovery-compose.yml:f\nrecovery-helper.sh:f'
  [ "$observed" = "$expected" ] || return 1
  [ -d "$gate_root/new" ] && [ ! -L "$gate_root/new" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$gate_root/new")" = '0:0:700' ] \
    && [ -f "$gate_root/recovery-helper.sh" ] && [ ! -L "$gate_root/recovery-helper.sh" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$gate_root/recovery-helper.sh")" = '0:0:500:1' ] \
    && [ -f "$gate_root/recovery-compose.yml" ] && [ ! -L "$gate_root/recovery-compose.yml" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$gate_root/recovery-compose.yml")" = '0:0:444:1' ] \
    && cmp -s -- "$gate_root/recovery-compose.yml" "$compose_file" \
    || return 1
  helper_sha=$(sha256sum "$gate_root/recovery-helper.sh" | awk '{print $1}') || return 1
  [[ "$helper_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  [ -z "$expected_helper_sha" ] || [ "$helper_sha" = "$expected_helper_sha" ] || return 1
  observed=$(find "$gate_root/new" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort) \
    || return 1
  expected=$'codex-worker.env:f\nconstructor-publisher.env:f\nconstructor-release.env:f'
  [ "$observed" = "$expected" ] || return 1
  for index in "${!gate_names[@]}"; do
    source=$gate_root/new/${gate_names[$index]}
    [ -f "$source" ] && [ ! -L "$source" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$source")" = '0:0:600:1' ] \
      && validate_env_file "$source" "${gate_logicals[$index]}" \
      || return 1
    expected=$(jq -er --arg key "${gate_keys[$index]}" '.targetGateSha256[$key]' \
      "$DEPLOY_QUIESCE_JOURNAL") || return 1
    actual=$(sha256sum "$source" | awk '{print $1}') || return 1
    [ "$actual" = "$expected" ] || return 1
  done
}

validate_discarded_gate_tombstone() {
  local candidate=$1 failed_commit=$2 canonical expected_helper_sha
  [[ "$candidate" =~ ^/root/kelion/runtime/constructor-gate-discarded\.([0-9a-f]{40})\.([0-9a-f]{64})$ ]] \
    || return 1
  [ "${BASH_REMATCH[1]}" = "$failed_commit" ] || return 1
  expected_helper_sha=${BASH_REMATCH[2]}
  [ -d "$candidate" ] && [ ! -L "$candidate" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$candidate")" = '0:0:700' ] \
    || return 1
  canonical=$(realpath -e -- "$candidate") || return 1
  [ "$canonical" = "$candidate" ] \
    && validate_unmutated_gate_transaction "$candidate" "$expected_helper_sha"
}

remove_discarded_gate_tombstone() {
  local candidate=$1 failed_commit=$2 helper_sha gc_root foreign
  validate_discarded_gate_tombstone "$candidate" "$failed_commit" || return 1
  helper_sha=$(sha256sum "$candidate/recovery-helper.sh" | awk '{print $1}') || return 1
  [[ "$helper_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  gc_root=$RUNTIME_ROOT/constructor-gate-gc.$failed_commit.$helper_sha
  for foreign in "$RUNTIME_ROOT"/constructor-gate-gc.*; do
    [ ! -e "$foreign" ] && [ ! -L "$foreign" ] || return 1
  done
  [ ! -e "$gc_root" ] && [ ! -L "$gc_root" ] || return 1
  # Tombstone-ul este încă integral și autentificat înainte de rename. După
  # rename+fsync, numele GC din directorul runtime root-only devine autoritatea
  # durabilă pentru cleanup și nu mai este interpretat ca recovery data. Un
  # SIGKILL în rm poate lăsa conținut parțial; retry-ul autentifică din nou
  # operandul GC și îi fixează identitatea device:inode înainte de ștergere.
  mv -T -- "$candidate" "$gc_root" || return 1
  fsync_path "$RUNTIME_ROOT" || return 1
  remove_discarded_gate_gc "$gc_root" "$failed_commit"
}

validate_discarded_gate_gc() {
  local candidate=$1 failed_commit=$2 canonical candidate_device runtime_device mount_rc mount_target
  local mount_targets
  [[ "$candidate" =~ ^/root/kelion/runtime/constructor-gate-gc\.([0-9a-f]{40})\.[0-9a-f]{64}$ ]] \
    || return 1
  [ "${BASH_REMATCH[1]}" = "$failed_commit" ] || return 1
  [ -d "$candidate" ] && [ ! -L "$candidate" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$candidate")" = '0:0:700' ] \
    || return 1
  canonical=$(realpath -e -- "$candidate") || return 1
  [ "$canonical" = "$candidate" ] || return 1
  candidate_device=$(stat -Lc '%d' -- "$candidate") || return 1
  runtime_device=$(stat -Lc '%d' -- "$RUNTIME_ROOT") || return 1
  [ "$candidate_device" = "$runtime_device" ] || return 1
  command -v mountpoint >/dev/null 2>&1 || return 1
  if mountpoint -q -- "$candidate"; then
    return 1
  else
    mount_rc=$?
    [ "$mount_rc" -eq 32 ] || return 1
  fi
  # `--one-file-system` oprește filesystem-uri străine, dar nu un bind mount pe
  # același st_dev. Inventarul raw al mount namespace-ului trebuie să fie
  # disponibil și nu poate conține operandul sau vreun descendent al lui.
  mount_targets=$(findmnt -n -r -o TARGET) || return 1
  while IFS= read -r mount_target; do
    case "$mount_target" in
      "$candidate"|"$candidate"/*) return 1 ;;
    esac
  done <<< "$mount_targets"
}

remove_discarded_gate_gc() {
  local candidate=$1 failed_commit=$2 identity_before identity_after
  identity_before=$(stat -Lc '%d:%i' -- "$candidate") || return 1
  validate_discarded_gate_gc "$candidate" "$failed_commit" || return 1
  identity_after=$(stat -Lc '%d:%i' -- "$candidate") || return 1
  [ "$identity_after" = "$identity_before" ] || return 1
  rm -rf --one-file-system -- "$candidate" || return 1
  fsync_path "$RUNTIME_ROOT"
}

withdraw_gate_transaction_durably() {
  local gate_root=$1 failed_commit=$2 helper_sha tombstone
  helper_sha=$(sha256sum "$gate_root/recovery-helper.sh" | awk '{print $1}') || return 1
  [[ "$helper_sha" =~ ^[0-9a-f]{64}$ ]] || return 1
  tombstone=$RUNTIME_ROOT/constructor-gate-discarded.$failed_commit.$helper_sha
  [ ! -e "$tombstone" ] && [ ! -L "$tombstone" ] || return 1
  validate_unmutated_gate_transaction "$gate_root" "$helper_sha" || return 1
  mv -T -- "$gate_root" "$tombstone" || return 1
  fsync_path "$RUNTIME_ROOT" || return 1
  remove_discarded_gate_tombstone "$tombstone" "$failed_commit"
}

# Recovery-ul incidentului gate-prepared este deliberat mai îngust decât
# recovery-ul generic. Dovedește că refresh-ul nu a mutat niciun byte live,
# retrage durabil numai intenția gate și tranzacția ei, apoi lasă fluxul
# recover-only standard să consume pending-ul, să publice ready/timerele și să
# șteargă outer journal numai după încă o dovadă a generației vechi.
discard_unmutated_gate_prepared_refresh() {
  local expected_request=$1 failed_commit=$2 expected_active=$3 selected_compose=$4
  local gate_root='' helper_sha='' gate_journal_sha='' candidate pending_present=0 count=0
  local -a candidates=() tombstones=() gc_roots=()
  recovery_in_progress=1
  [ "$discard_unmutated_gate_prepared" = 1 ] && [ "$recover_only" = 1 ] \
    && [ "$leave_constructor_quiesced" = 0 ] && [ "$boot_recovery" = 0 ] \
    && [ "$deploy_quiesce_proof" = 1 ] \
    || die 'discardul gate-prepared cere recovery strict cu dovadă și fără boot'
  [ "$expected_request" = "$discard_gate_request_id" ] \
    && [ "$failed_commit" = "$discard_gate_commit" ] \
    && [ "$expected_active" = "$discard_gate_active_commit" ] \
    && [ "$selected_compose" = "$compose_file" ] \
    && [ "$selected_compose" = "$CONFIG_ROOT/compose.production.yml" ] \
    || die 'tupla invocației discard gate nu este exactă'
  [ "$deploy_owner_request_id" = "$expected_request" ] \
    && [ "$deploy_owner_commit" = "$failed_commit" ] \
    && deploy_quiesce_owned_by_caller \
    || die 'ownerul discardului gate nu corespunde jurnalului deploy'
  jq -e --arg requestId "$expected_request" --arg commit "$failed_commit" \
    --arg active "$expected_active" '
      (keys | sort) == (["activeBefore","activeVersionBefore","commit","gateSha256",
        "legacyContainers","legacyRestartPolicies","phase","proxyIntent","requestId","schema",
        "targetGateSha256"] | sort) and
      .schema == 2 and .phase == "gate-prepared" and
      .requestId == $requestId and .commit == $commit and .activeBefore == $active and
      .activeBefore != .commit and
      (.activeBefore as $old | .activeVersionBefore as $version | $old | startswith($version)) and
      .legacyContainers == [] and .legacyRestartPolicies == {} and
      (.gateSha256 | keys | sort) == ["publisher","release","worker"] and
      (.targetGateSha256 | keys | sort) == ["publisher","release","worker"]
    ' "$DEPLOY_QUIESCE_JOURNAL" >/dev/null \
    || die 'outer journal nu este incidentul gate-prepared exact'
  deploy_quiesce_generation_proof old \
    || die 'markerul activ sau hashurile gate live nu sunt generația veche exactă'
  validate_unit_migration_pending || die 'pending-ul unit-only este nesigur'
  if [ -f "$UNIT_MIGRATION_PENDING" ]; then pending_present=1; fi
  validate_live_constructor_units_quiesced \
    || die 'pending-ul și bariera fizică Constructor nu sunt exacte'
  for candidate in "$JOURNAL" "$ACTIVATION_JOURNAL" "$ACTIVATION_PENDING" "$READY_STAMP" \
    "$DESTRUCTIVE_RECOVERY_JOURNAL"; do
    [ ! -e "$candidate" ] && [ ! -L "$candidate" ] \
      || die 'discardul gate refuză un jurnal/stamp concurent'
  done

  if [ -e "$GATE_JOURNAL" ] || [ -L "$GATE_JOURNAL" ]; then
    [ "$pending_present" = 1 ] \
      || die 'jurnalul gate nu poate fi retras după consumarea pending-ului'
    for candidate in "$RUNTIME_ROOT"/constructor-gate-discarded.*; do
      [ ! -e "$candidate" ] && [ ! -L "$candidate" ] \
        || die 'jurnalul gate și tombstone-ul nu pot coexista'
    done
    for candidate in "$RUNTIME_ROOT"/constructor-gate-gc.*; do
      [ ! -e "$candidate" ] && [ ! -L "$candidate" ] \
        || die 'jurnalul gate și cleanup-ul GC nu pot coexista'
    done
    [ -f "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$GATE_JOURNAL")" = '0:0:600:1' ] \
      && jq -e --arg commit "$failed_commit" '
        (keys | sort) == ["commit","helperSha256","schema","transactionRoot"] and
        .schema == 1 and .commit == $commit and
        (.helperSha256 | strings | test("^[0-9a-f]{64}$")) and
        (.transactionRoot | strings | test("^/root/kelion/runtime/constructor-gate-txn\\.[A-Za-z0-9]+$"))
      ' "$GATE_JOURNAL" >/dev/null \
      || die 'jurnalul gate al incidentului este nesigur'
    gate_root=$(jq -er '.transactionRoot' "$GATE_JOURNAL")
    helper_sha=$(jq -er '.helperSha256' "$GATE_JOURNAL")
    gate_journal_sha=$(sha256sum "$GATE_JOURNAL" | awk '{print $1}')
    validate_unmutated_gate_transaction "$gate_root" "$helper_sha" \
      || die 'tranzacția gate nu dovedește candidatul jurnalizat intact'
    for candidate in "$RUNTIME_ROOT"/constructor-gate-txn.*; do
      [ -e "$candidate" ] || { [ ! -L "$candidate" ] || die 'tranzacție gate dangling'; continue; }
      [ "$candidate" = "$gate_root" ] \
        || die 'un director gate străin blochează discardul incidentului'
      count=$((count + 1))
    done
    [ "$count" -eq 1 ] || die 'inventarul tranzacțiilor gate nu este exact'

    # Ultima probă înaintea primei mutații. Ordinea unlink+fsync înainte de
    # ștergerea txn face orice crash fail-closed, dar reluabil.
    [ "$(sha256sum "$GATE_JOURNAL" | awk '{print $1}')" = "$gate_journal_sha" ] \
      && validate_unmutated_gate_transaction "$gate_root" "$helper_sha" \
      && deploy_quiesce_owned_by_caller && deploy_quiesce_generation_proof old \
      && validate_live_constructor_units_quiesced \
      || die 'starea incidentului s-a schimbat înainte de commitul discard gate'
    rm -f -- "$GATE_JOURNAL" || die 'jurnalul gate nu a putut fi retras'
    fsync_path "$RUNTIME_ROOT" || die 'retragerea jurnalului gate nu este durabilă'
    withdraw_gate_transaction_durably "$gate_root" "$failed_commit" \
      || die 'tranzacția gate nu a putut fi retrasă durabil după jurnal'
  else
    # Reluare după un crash între unlink, rename-ul durabil și ștergerea txn.
    for candidate in "$RUNTIME_ROOT"/constructor-gate-discarded.*; do
      [ -e "$candidate" ] || { [ ! -L "$candidate" ] || die 'tombstone gate dangling'; continue; }
      validate_discarded_gate_tombstone "$candidate" "$failed_commit" \
        || die 'tombstone-ul tranzacției gate este nesigur sau corupt'
      tombstones+=("$candidate")
    done
    [ "${#tombstones[@]}" -le 1 ] \
      || die 'mai multe tombstone-uri gate fac reluarea ambiguă'
    for candidate in "$RUNTIME_ROOT"/constructor-gate-gc.*; do
      [ -e "$candidate" ] || { [ ! -L "$candidate" ] || die 'cleanup gate GC dangling'; continue; }
      validate_discarded_gate_gc "$candidate" "$failed_commit" \
        || die 'cleanup-ul gate GC este străin sau are inode nesigur'
      gc_roots+=("$candidate")
    done
    [ "${#gc_roots[@]}" -le 1 ] \
      || die 'mai multe directoare gate GC fac reluarea ambiguă'
    for candidate in "$RUNTIME_ROOT"/constructor-gate-txn.*; do
      [ -e "$candidate" ] || { [ ! -L "$candidate" ] || die 'tranzacție gate dangling'; continue; }
      validate_unmutated_gate_transaction "$candidate" '' \
        || die 'un director gate orfan nu corespunde exact incidentului'
      candidates+=("$candidate")
    done
    [ "${#candidates[@]}" -le 1 ] \
      || die 'mai multe tranzacții gate candidate fac reluarea ambiguă'
    [ "$(( ${#tombstones[@]} + ${#candidates[@]} + ${#gc_roots[@]} ))" -le 1 ] \
      || die 'inventarele txn/tombstone/GC gate fac reluarea ambiguă'
    if [ "${#candidates[@]}" -eq 1 ]; then
      [ "$pending_present" = 1 ] \
        || die 'o tranzacție gate orfană nu poate coexista cu pending consumat'
      withdraw_gate_transaction_durably "${candidates[0]}" "$failed_commit" \
        || die 'tranzacția gate orfană nu a putut fi retrasă durabil'
    elif [ "${#tombstones[@]}" -eq 1 ]; then
      [ "$pending_present" = 1 ] \
        || die 'un tombstone gate nu poate coexista cu pending consumat'
      remove_discarded_gate_tombstone "${tombstones[0]}" "$failed_commit" \
        || die 'tombstone-ul gate nu a putut fi șters durabil'
    elif [ "${#gc_roots[@]}" -eq 1 ]; then
      [ "$pending_present" = 1 ] \
        || die 'un cleanup gate GC nu poate coexista cu pending consumat'
      remove_discarded_gate_gc "${gc_roots[0]}" "$failed_commit" \
        || die 'cleanup-ul gate GC nu a putut fi reluat durabil'
    fi
  fi

  # Inclusiv reluarea care observă deja journal/txn absente persistă explicit
  # absența lor înainte să permită consumarea pending-ului.
  for candidate in \
    "$RUNTIME_ROOT"/constructor-gate-txn.* \
    "$RUNTIME_ROOT"/constructor-gate-discarded.* \
    "$RUNTIME_ROOT"/constructor-gate-gc.*; do
    [ ! -e "$candidate" ] && [ ! -L "$candidate" ] \
      || die 'un artefact gate a reapărut înainte de finalizarea discardului'
  done
  fsync_path "$RUNTIME_ROOT" \
    || die 'absența artefactelor gate nu a putut fi persistată la reluare'
  # Fsync-ul este ultima operație care poate ceda/reporni între dovada absenței
  # și consumarea pending-ului. Repetăm inventarul după el, astfel încât niciun
  # artefact resurrectat/concurent să nu primească implicit autoritate.
  for candidate in \
    "$RUNTIME_ROOT"/constructor-gate-txn.* \
    "$RUNTIME_ROOT"/constructor-gate-discarded.* \
    "$RUNTIME_ROOT"/constructor-gate-gc.*; do
    [ ! -e "$candidate" ] && [ ! -L "$candidate" ] \
      || die 'un artefact gate a reapărut după fsync-ul final al discardului'
  done
  [ ! -e "$GATE_JOURNAL" ] && [ ! -L "$GATE_JOURNAL" ] \
    && deploy_quiesce_owned_by_caller && deploy_quiesce_generation_proof old \
    && validate_unit_migration_pending \
    && validate_live_constructor_units_quiesced \
    || die 'postcondiția discardului gate nu păstrează generația veche quiesced'
  if [ "$pending_present" = 1 ]; then
    [ -f "$UNIT_MIGRATION_PENDING" ] \
      || die 'discardul gate a consumat prematur pending-ul'
  else
    [ ! -e "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] \
      && validate_live_runtime_contract \
      || die 'reluarea post-discard fără pending nu are contractul live exact'
  fi
}

recover_interrupted_activation() {
  local activation_root operation phase state_file type name first second extra index marker timer service restored state failed=0 count=0
  local wants_dir=/etc/systemd/system/timers.target.wants wants_link origin
  local -A snapshot=() allowed=()
  local -a marker_present=() timer_enabled=() timer_active=() service_active=()
  if [ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ]; then return 0; fi
  recovery_in_progress=1
  [ -f "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ] \
    && [ "$(stat -c '%u:%g:%a' "$ACTIVATION_JOURNAL")" = '0:0:600' ] \
    || die 'jurnalul activării Constructor este nesigur'
  jq -e '((.schema == 1 and .phase == null) or (.schema == 2 and (.phase == "prepared" or .phase == "quiesced" or .phase == "applied"))) and
    (.activationRoot | type == "string") and (.operation == "activate-worker-publisher" or .operation == "activate-release")' "$ACTIVATION_JOURNAL" >/dev/null \
    || die 'jurnalul activării Constructor este invalid'
  activation_root=$(jq -er '.activationRoot' "$ACTIVATION_JOURNAL")
  operation=$(jq -er '.operation' "$ACTIVATION_JOURNAL")
  phase=$(jq -er 'if .schema == 1 then "prepared" else .phase end' "$ACTIVATION_JOURNAL")
  [[ "$activation_root" =~ ^/root/kelion/runtime/constructor-activation\.[A-Za-z0-9]+$ ]] \
    && [ -d "$activation_root" ] && [ ! -L "$activation_root" ] \
    && [ "$(realpath -e -- "$activation_root")" = "$activation_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$activation_root")" = '0:0:700' ] \
    || die 'directorul activării întrerupte este nesigur'
  state_file=$activation_root/state
  [ -f "$state_file" ] && [ ! -L "$state_file" ] && [ "$(stat -c '%u:%g:%a' "$state_file")" = '0:0:600' ] \
    || die 'snapshotul activării întrerupte este nesigur'
  for name in "${constructor_markers[@]}"; do allowed["marker:$name"]=1; done
  for name in "${constructor_timers[@]}"; do allowed["timer:$name"]=1; done
  for name in "${constructor_services[@]}"; do allowed["service:$name"]=1; done
  while IFS=$'\t' read -r type name first second extra; do
    [ -z "$extra" ] && [ -n "${allowed[$type:$name]:-}" ] && [ -z "${snapshot[$type:$name]:-}" ] \
      || die 'intrare invalidă sau duplicată în snapshotul activării'
    case "$type" in
      marker) [[ "$first" =~ ^[01]$ ]] && [[ "$second" =~ ^marker\.[0-2]$ ]] || die 'snapshot marker invalid' ;;
      timer) [[ "$first" =~ ^[01]$ ]] && [[ "$second" =~ ^[01]$ ]] || die 'snapshot timer invalid' ;;
      service) [[ "$first" =~ ^[01]$ ]] && [ "$second" = - ] || die 'snapshot service invalid' ;;
      *) die 'tip necunoscut în snapshotul activării' ;;
    esac
    snapshot["$type:$name"]="$first:$second"
    count=$((count + 1))
  done < "$state_file"
  [ "$count" -eq 9 ] || die 'snapshotul activării nu conține toate cele nouă stări'
  for index in "${!constructor_markers[@]}"; do
    IFS=: read -r first second <<<"${snapshot[marker:${constructor_markers[$index]}]}"
    [ "$second" = "marker.$index" ] || die 'snapshoturile markerelor nu au ordinea canonică'
    marker_present+=("$first")
    [ -f "$activation_root/$second" ] && [ ! -L "$activation_root/$second" ] || die 'copia unui marker lipsește'
    if [ "$first" = 1 ]; then [ "$(stat -c '%u:%g:%a' "$activation_root/$second")" = '0:0:444' ] || die 'ACL invalid pentru copia markerului'; fi
  done
  for timer in "${constructor_timers[@]}"; do
    IFS=: read -r first second <<<"${snapshot[timer:$timer]}"; timer_enabled+=("$first"); timer_active+=("$second")
  done
  for service in "${constructor_services[@]}"; do
    IFS=: read -r first second <<<"${snapshot[service:$service]}"; service_active+=("$first")
  done

  ensure_constructor_marker_root_durable \
    || die 'ACL-ul părinte al markerelor nu a putut fi reparat durabil în recovery'
  validate_live_runtime_contract \
    || die 'contractul runtime live este invalid pentru roll-forward-ul activării'
  case "$operation" in
    activate-worker-publisher)
      [ "${marker_present[2]}" = 0 ] || die 'activarea worker/publisher nu poate modifica un release deja marcat'
      grep -qx 'CODEX_WORKER_ENABLED=1' "$CONFIG_ROOT/runtime.env" \
        && grep -qx 'CONSTRUCTOR_PUBLISHER_ENABLED=1' "$CONFIG_ROOT/runtime.env" \
        && grep -qx 'CODEX_WORKER_EXEC_ENABLED=1' "${constructor_configs[0]}" \
        && grep -qx 'CONSTRUCTOR_PUBLISHER_EXEC_ENABLED=1' "${constructor_configs[1]}" \
        || die 'flagurile worker/publisher nu permit roll-forward'
      marker_present[0]=1; marker_present[1]=1
      timer_enabled[0]=1; timer_active[0]=1
      timer_enabled[1]=1; timer_active[1]=1
      ;;
    activate-release)
      [ "${marker_present[0]}" = 1 ] && [ "${marker_present[1]}" = 1 ] \
        && [ "${timer_enabled[0]}" = 1 ] && [ "${timer_active[0]}" = 1 ] \
        && [ "${timer_enabled[1]}" = 1 ] && [ "${timer_active[1]}" = 1 ] \
        || die 'workerul și publisherul nu erau active la commitul release'
      grep -qx 'CODEX_WORKER_ENABLED=1' "$CONFIG_ROOT/runtime.env" \
        && grep -qx 'CONSTRUCTOR_PUBLISHER_ENABLED=1' "$CONFIG_ROOT/runtime.env" \
        && grep -qx 'CONSTRUCTOR_RELEASE_ENABLED=1' "$CONFIG_ROOT/runtime.env" \
        && grep -qx 'CODEX_WORKER_EXEC_ENABLED=1' "${constructor_configs[0]}" \
        && grep -qx 'CONSTRUCTOR_PUBLISHER_EXEC_ENABLED=1' "${constructor_configs[1]}" \
        && grep -qx 'CONSTRUCTOR_RELEASE_EXEC_ENABLED=1' "${constructor_configs[2]}" \
        || die 'flagurile runtime nu permit roll-forward-ul release'
      marker_present[2]=1; timer_enabled[2]=1; timer_active[2]=1
      ;;
  esac

  quiesce_units_for_recovery || die 'cele șase unități nu pot fi oprite pentru rollbackul activării'
  publish_activation_pending \
    || die 'gate-ul pending al activării nu a putut fi publicat după quiesce'
  for index in "${!constructor_markers[@]}"; do
    marker=${constructor_markers[$index]}
    if [ "${marker_present[$index]}" = 1 ]; then
      restored=$(mktemp "$marker.recovery.XXXXXX") || { failed=1; continue; }
      if install -o root -g root -m 0444 "$activation_root/marker.$index" "$restored"; then
        mv -f -- "$restored" "$marker" || failed=1
      else
        rm -f -- "$restored"; failed=1
      fi
    else
      rm -f -- "$marker" || failed=1
    fi
    if [ -e "$marker" ]; then fsync_path "$marker" || failed=1; fi
  done
  fsync_path /etc/kelion || failed=1
  systemctl daemon-reload || failed=1
  if [ "$activation_resume_operation" != "$operation" ]; then
    write_activation_journal_phase quiesced || failed=1
    validate_activation_pending || failed=1
    [ -f "$ACTIVATION_PENDING" ] || failed=1
    validate_constructor_quiesce_barrier || failed=1
    if [ "$failed" != 0 ]; then
      force_quiesce_constructor_units || true
      die 'bariera durabilă a activării nu a putut fi publicată; unitățile rămân oprite'
    fi
    activation_barrier_pending=1
    units_quiesced=0
    recovery_in_progress=0
    return 0
  fi

  # Numai resume-ul explicit poate deschide gate-ul. Commitul applied este
  # sincronizat înainte ca pending să dispară și înainte de ready/start.
  write_activation_journal_phase applied || {
    force_quiesce_constructor_units || true
    die 'faza applied a activării nu a putut fi publicată durabil înainte de start'
  }
  if [ "$leave_constructor_quiesced" = 1 ]; then
    # Jurnalul activării urmează să fie consumat de deploy. Publicăm mai întâi
    # blockerul persistent folosit deja de migrarea strictă a unităților;
    # astfel niciun crash după retragerea pendingului activării nu poate lăsa
    # boot recovery să pornească marker-ele abia comise.
    publish_unit_migration_pending || {
      force_quiesce_constructor_units || true
      die 'blockerul durabil al activării applied nu a putut fi publicat'
    }
  fi
  clear_activation_pending || {
    force_quiesce_constructor_units || true
    die 'gate-ul pending nu a putut fi retras după commitul applied'
  }
  if [ "$leave_constructor_quiesced" = 1 ]; then
    # Deploy-ul one-shot poate consuma o activare deja comisă fără să execute
    # workerul ori publisherul în preflight. `applied` este pragul durabil;
    # pending dispare numai după el, iar ready rămâne retras. Apelantul pin-uit
    # verifică apoi exact jurnalul și curăță jurnalul înaintea snapshotului.
    if [ "$failed" != 0 ] \
      || ! validate_unit_migration_pending \
      || [ ! -f "$UNIT_MIGRATION_PENDING" ] \
      || [ -e "$ACTIVATION_PENDING" ] || [ -L "$ACTIVATION_PENDING" ] \
      || [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ] \
      || ! validate_constructor_quiesce_barrier; then
      force_quiesce_constructor_units || true
      die 'commitul applied nu a putut rămâne quiesced; unitățile rămân oprite'
    fi
    units_quiesced=0
    recovery_in_progress=0
    return 0
  fi
  # Jurnalul exterior al operației este Condition= fail-closed pentru
  # controller, iar markerul reactivării blochează serviciile cu side effects.
  # Nu putem pretinde un start cât niciuna dintre condiții nu este satisfăcută.
  # Returnăm ownerului faza `applied` quiesced; el șterge durabil jurnalul său,
  # apoi cheamă recover-only generic, care adoptă markerul și îl retrage ultimul
  # după dovada controller+UDS+timere.
  validate_reactivation_journal || failed=1
  [ -f "$REACTIVATION_JOURNAL" ] && [ ! -L "$REACTIVATION_JOURNAL" ] || failed=1
  validate_constructor_quiesce_barrier || failed=1
  if [ "$failed" != 0 ]; then
    force_quiesce_constructor_units || true
    die 'handoff-ul durabil al activării nu a rămas quiesced sub intentul persistent'
  fi
  activation_outer_commit_pending=1
  units_quiesced=0
  recovery_in_progress=0
  return 0
}

recover_interrupted_cutover() {
  local recovery_root phase rollback_manifest recovery_compose logical present extra backup temporary index
  local recovery_restart_required=0 failed=0
  local -a recovery_targets=() recovery_owners=() recovery_groups=() recovery_modes=() recovery_backups=() recovery_present=()
  local -A recovery_seen=()
  if [ ! -e "$JOURNAL" ] && [ ! -L "$JOURNAL" ]; then return 0; fi
  recovery_in_progress=1
  [ -f "$JOURNAL" ] && [ ! -L "$JOURNAL" ] && [ "$(stat -c '%u:%g:%a' "$JOURNAL")" = '0:0:600' ] \
    || die 'jurnalul cutover-ului este nesigur'
  jq -e '.schema == 1 and (.phase == "prepared" or .phase == "files-committed" or .phase == "backend-recreated" or .phase == "committed" or .phase == "timers-restored") and (.transactionRoot | type == "string")' "$JOURNAL" >/dev/null \
    || die 'jurnalul cutover-ului este invalid'
  phase=$(jq -er '.phase' "$JOURNAL")
  recovery_root=$(jq -er '.transactionRoot' "$JOURNAL")
  [[ "$recovery_root" =~ ^/root/kelion/runtime/runtime-config-txn\.[A-Za-z0-9]+$ ]] \
    || die 'jurnalul indică un director de tranzacție nepermis'
  [ -d "$recovery_root" ] && [ ! -L "$recovery_root" ] \
    && [ "$(realpath -e -- "$recovery_root")" = "$recovery_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$recovery_root")" = '0:0:700' ] \
    || die 'directorul tranzacției întrerupte este nesigur'
  rollback_manifest=$recovery_root/rollback-manifest
  recovery_compose=$recovery_root/recovery-compose.yml
  [ -f "$rollback_manifest" ] && [ ! -L "$rollback_manifest" ] \
    && [ "$(stat -c '%u:%g:%a' "$rollback_manifest")" = '0:0:600' ] \
    || die 'manifestul de rollback lipsește sau este nesigur'
  [ -f "$recovery_compose" ] && [ ! -L "$recovery_compose" ] \
    && [ "$(stat -c '%u:%g:%a' "$recovery_compose")" = '0:0:600' ] \
    || die 'compose-ul durabil de recovery lipsește sau este nesigur'
  while IFS=$'\t' read -r logical present extra; do
    [ -n "$logical" ] && [ -z "$extra" ] && [[ "$logical" =~ ^[a-z0-9.-]+$ ]] && [[ "$present" =~ ^[01]$ ]] \
      || die 'intrare invalidă în manifestul de rollback'
    [ -z "${recovery_seen[$logical]:-}" ] || die 'intrare duplicată în manifestul de rollback'
    recovery_seen[$logical]=1
    map_logical "$logical"
    backup=$recovery_root/backups/$logical
    [ -f "$backup" ] && [ ! -L "$backup" ] || die "backup de rollback lipsă: $logical"
    if [ "$present" = 1 ]; then
      [ "$(stat -c '%u:%g:%a' "$backup")" = "$mapped_owner:$mapped_group:$mapped_mode" ] \
        || die "ACL invalid pentru backupul $logical"
    else
      [ ! -s "$backup" ] || die "sentinel de absență invalid pentru $logical"
    fi
    case "$logical" in runtime.env|app-secret.*) recovery_restart_required=1 ;; esac
    recovery_targets+=("$mapped_target")
    recovery_owners+=("$mapped_owner")
    recovery_groups+=("$mapped_group")
    recovery_modes+=("$mapped_mode")
    recovery_backups+=("$backup")
    recovery_present+=("$present")
  done < "$rollback_manifest"
  [ "${#recovery_targets[@]}" -gt 0 ] || die 'manifestul de rollback este gol'

  # Jurnalul și manifestul de rollback au fost autentificate mai sus. Numai
  # această recuperare are voie să atingă un set 1..5 rezultat dintr-un SIGKILL
  # între două rename-uri ale aceleiași tranzacții.
  quiesce_units_for_recovery 1 || die 'unitățile Constructor nu pot fi oprite pentru recovery'
  if [ -e "$recovery_root/forward-manifest" ] || [ -L "$recovery_root/forward-manifest" ] \
    || [ -e "$recovery_root/forward" ] || [ -L "$recovery_root/forward" ]; then
    roll_forward_unit_transaction "$recovery_root" \
      || die 'roll-forward-ul celor șase unități Constructor a eșuat'
    clear_journal || die 'jurnalul unit-only nu a putut fi șters după roll-forward'
    recovery_in_progress=0
    remove_transaction_after_durable_journal_clear "$recovery_root" \
      || printf 'runtime-cutover: avertisment: tranzacția unit-only recuperată a rămas root-only\n' >&2
    return 0
  fi
  if [ "$phase" = committed ] || [ "$phase" = timers-restored ]; then
    # Din faza committed înainte, noile fișiere și backendul sunt fsync/probate.
    # Un oneshot poate să fi pornit deja, deci restaurarea backupurilor vechi ar
    # încălca atomismul. Recovery-ul este exclusiv roll-forward pe generația nouă.
    validate_live_markers_for_recovery \
      || die 'generația nouă comisă nu mai trece contractul runtime la recovery'
    if [ "$recovery_restart_required" = 1 ]; then
      recreate_active_release "$recovery_compose" \
        || die "backendul nou nu a putut fi reconciliat din jurnalul fazei $phase"
    fi
    validate_live_runtime_contract \
      || die 'generația mixtă recuperată nu trece contractul runtime strict'
    clear_unit_migration_pending \
      || die 'bariera unit-only nu a putut fi consumată de generația mixtă recuperată'
    if [ "$leave_constructor_quiesced" = 1 ]; then
      clear_runtime_ready_stamp || die 'stamp-ul runtime nu a putut fi eliminat după roll-forward quiesced'
      units_quiesced=0
    else
      publish_runtime_ready_stamp || die 'stamp-ul runtime nu a putut fi publicat după commitul recuperat'
      restore_constructor_timers || die 'timer-ele nu au putut fi reconciliate pe generația nouă'
    fi
    clear_journal || die 'jurnalul comis nu a putut fi șters după roll-forward'
    recovery_in_progress=0
    remove_transaction_after_durable_journal_clear "$recovery_root" || printf 'runtime-cutover: avertisment: tranzacția recuperată a rămas root-only\n' >&2
    return 0
  fi
  for index in "${!recovery_targets[@]}"; do
    if [ "${recovery_present[$index]}" = 1 ]; then
      temporary=$(mktemp "${recovery_targets[$index]}.recovery.XXXXXX") || { failed=1; continue; }
      if install -o "${recovery_owners[$index]}" -g "${recovery_groups[$index]}" -m "${recovery_modes[$index]}" "${recovery_backups[$index]}" "$temporary" \
        && mv -f -- "$temporary" "${recovery_targets[$index]}" \
        && cmp -s -- "${recovery_targets[$index]}" "${recovery_backups[$index]}"; then
        :
      else
        rm -f -- "$temporary"
        failed=1
      fi
    elif [ -e "${recovery_targets[$index]}" ] || [ -L "${recovery_targets[$index]}" ]; then
      if [ -f "${recovery_targets[$index]}" ] || [ -L "${recovery_targets[$index]}" ]; then
        rm -f -- "${recovery_targets[$index]}" || failed=1
      else
        failed=1
      fi
    fi
    if [ "$failed" = 0 ]; then
      if [ -e "${recovery_targets[$index]}" ]; then fsync_path "${recovery_targets[$index]}" || failed=1; fi
      fsync_path "$(dirname -- "${recovery_targets[$index]}")" || failed=1
    fi
  done
  [ "$failed" = 0 ] || die 'rollback-ul durabil al fișierelor a eșuat'
  systemctl daemon-reload || die 'systemd nu a putut reîncărca fișierele restaurate'
  if [ "$recovery_restart_required" = 1 ]; then
    recreate_active_release "$recovery_compose" || die "backendul nu a putut fi restaurat din jurnalul fazei $phase"
  fi
  validate_unit_migration_pending || die 'bariera unit-only restaurată este nesigură'
  if [ -f "$UNIT_MIGRATION_PENDING" ]; then
    # Primul cutover mixt poate avea drept backup runtime.env din schema veche.
    # Rollbackul pre-commit este terminal numai în starea tranzitorie sigură:
    # unitățile noi exacte rămân oprite, stamp-ul absent și pending păstrat.
    wait_for_live_constructor_units_quiesced \
      || die 'rollbackul mixt pre-commit nu a păstrat unitățile exact quiesced'
    clear_journal || die 'jurnalul mixt rollback nu a putut fi șters pentru retry'
    recovery_in_progress=0
    units_quiesced=0
    remove_transaction_after_durable_journal_clear "$recovery_root" \
      || printf 'runtime-cutover: avertisment: tranzacția mixtă restaurată a rămas root-only\n' >&2
    return 0
  fi
  validate_live_markers_for_recovery || die 'starea markerelor nu corespunde generației restaurate'
  if [ "$leave_constructor_quiesced" = 1 ]; then
    clear_runtime_ready_stamp || die 'stamp-ul runtime nu a putut fi eliminat după recovery quiesced'
    units_quiesced=0
  else
    publish_runtime_ready_stamp || die 'stamp-ul runtime nu a putut fi publicat după recovery'
    restore_constructor_timers || die 'timer-ele nu au putut fi restaurate după recovery'
  fi
  clear_journal || die 'jurnalul recuperat nu a putut fi șters durabil'
  recovery_in_progress=0
  remove_transaction_after_durable_journal_clear "$recovery_root" || printf 'runtime-cutover: avertisment: tranzacția recuperată a rămas root-only\n' >&2
}

# Închiderea de urgență este deliberat mai îngustă decât recovery-ul generic:
# acceptă numai tranzacția `prepared` cunoscută, ale cărei douăsprezece ținte nu
# au fost mutate deloc. Release-ul candidat trebuie să fie deja complet și
# izolat în slotul țintă, în timp ce markerul activ și toate bytes-urile config
# rămân generația veche. Funcția nu restaurează și nu publică nimic; după toate
# dovezile șterge durabil doar jurnalul runtime și directorul lui de tranzacție.
discard_unmutated_prepared_cutover() {
  local target_commit=$1 selected_compose=$2 recovery_root rollback_manifest recovery_compose backups_root
  local logical present extra backup active_before active_version active_slot target_slot path expected actual
  local caddy_snapshot upstream_snapshot expected_old_upstream_sha expected_target_upstream_sha
  local observed_top_level observed_backups observed_manifest proxy_health proxy_policy role id image
  local target_output role_output rollback_manifest_sha recovery_compose_sha
  local manifest_count=0
  local -a manifest_logicals=() target_ids=() role_ids=()
  local -A seen=()
  local -A allowed=(
    [app-secret.codex-worker-secret]=1
    [app-secret.constructor-model-control-secret]=1
    [app-secret.constructor-publisher-secret]=1
    [app-secret.constructor-release-secret]=1
    [worker-secret.github-worker-token]=1
    [publisher-secret.github-publisher-token]=1
    [release-secret.github-release-token]=1
    [gate-secret.github-ghcr-read-token]=1
    [constructor-config.codex-worker.env]=1
    [constructor-config.constructor-publisher.env]=1
    [constructor-config.constructor-release.env]=1
    [runtime.env]=1
  )

  # Din acest punct, orice refuz trebuie să lase jurnalul și tranzacția pentru
  # investigație/retry. Cleanup-ul nu are voie să deducă o generație restaurabilă.
  recovery_in_progress=1
  [ "$discard_unmutated_prepared" = 1 ] && [ "$recover_only" = 1 ] \
    && [ "$leave_constructor_quiesced" = 1 ] \
    || die 'modul discard cere recovery-only cu Constructor quiesced'
  [[ "$target_commit" =~ ^[0-9a-f]{40}$ ]] && [ "$target_commit" = "$discard_target_commit" ] \
    || die 'commitul discard nu corespunde invocației autentificate'
  [ "$selected_compose" = "$compose_file" ] \
    && [ "$selected_compose" = "$CONFIG_ROOT/compose.production.yml" ] \
    || die 'compose-ul discard nu este calea live fixă a invocației autentificate'

  validate_deploy_quiesce_journal \
    || die 'jurnalul deploy nu este autentic pentru discard'
  [ -f "$DEPLOY_QUIESCE_JOURNAL" ] && [ ! -L "$DEPLOY_QUIESCE_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$DEPLOY_QUIESCE_JOURNAL")" = '0:0:600:1' ] \
    || die 'jurnalul deploy lipsește sau are inode/ACL nesigur'
  deploy_quiesce_owned_by_caller \
    || die 'ownerul recovery nu corespunde jurnalului deploy'
  [ "$deploy_owner_commit" = "$target_commit" ] \
    || die 'ownerul recovery nu corespunde commitului țintă'
  jq -e --arg commit "$target_commit" '
    (keys | sort) == (["activeBefore","activeVersionBefore","commit","gateSha256",
      "legacyContainers","legacyRestartPolicies","phase","proxyIntent","requestId","schema"] | sort) and
    .schema == 2 and .phase == "active-prepared" and .commit == $commit and
    (.activeBefore | strings | test("^[0-9a-f]{40}$")) and .activeBefore != $commit and
    (.activeVersionBefore | strings | test("^[0-9a-f]{7,40}$")) and
    (.activeBefore as $old | .activeVersionBefore as $version | $old | startswith($version)) and
    .legacyContainers == [] and .legacyRestartPolicies == {} and
    (.gateSha256 | keys | sort) == ["publisher","release","worker"] and
    (.proxyIntent | keys | sort) == (["activeSlotBefore","caddyfilePresent","caddyfileSha256",
      "caddyfileSnapshot","legacyProxyRestartPolicy","legacyProxyWasRunning","managedProxyWasRunning",
      "oldUpstreamPresent","oldUpstreamSha256","oldUpstreamSnapshot","targetCaddyfileSha256",
      "targetSlot","targetUpstreamSha256"] | sort) and
    (.proxyIntent.activeSlotBefore == "blue" or .proxyIntent.activeSlotBefore == "green") and
    (.proxyIntent.targetSlot == "blue" or .proxyIntent.targetSlot == "green") and
    .proxyIntent.activeSlotBefore != .proxyIntent.targetSlot and
    .proxyIntent.managedProxyWasRunning == true and .proxyIntent.legacyProxyWasRunning == false and
    .proxyIntent.legacyProxyRestartPolicy == null and
    .proxyIntent.caddyfilePresent == true and .proxyIntent.oldUpstreamPresent == true
  ' "$DEPLOY_QUIESCE_JOURNAL" >/dev/null \
    || die 'jurnalul deploy nu descrie exact generația active-prepared recuperabilă'
  deploy_quiesce_generation_proof \
    || die 'markerul vechi și gate-urile nu corespund generației active-prepared'

  validate_unit_migration_pending \
    || die 'bariera unit-only este nesigură în recovery'
  [ -f "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$UNIT_MIGRATION_PENDING")" = '0:0:600:1' ] \
    && [ "$(wc -l < "$UNIT_MIGRATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$UNIT_MIGRATION_PENDING" \
    || die 'bariera unit-only exactă lipsește în recovery'
  for path in "$READY_STAMP" "$ACTIVATION_PENDING" "$ACTIVATION_JOURNAL" "$GATE_JOURNAL"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] \
      || die "capabilitate Constructor neașteptată în recovery: $path"
  done
  for path in "${constructor_markers[@]}"; do
    [ ! -e "$path" ] && [ ! -L "$path" ] \
      || die "marker Constructor neașteptat în recovery: $path"
  done
  wait_for_live_constructor_units_quiesced \
    || die 'Constructor nu este exact instalat, inactiv și dezactivat în recovery'

  [ -f "$JOURNAL" ] && [ ! -L "$JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$JOURNAL")" = '0:0:600:1' ] \
    || die 'jurnalul runtime prepared lipsește sau este nesigur'
  jq -e '
    (keys | sort) == ["phase","schema","transactionRoot"] and
    .schema == 1 and .phase == "prepared" and
    (.transactionRoot | strings | test("^/root/kelion/runtime/runtime-config-txn\\.[A-Za-z0-9]+$"))
  ' "$JOURNAL" >/dev/null || die 'jurnalul runtime nu este exact schema 1 prepared'
  recovery_root=$(jq -er '.transactionRoot' "$JOURNAL") \
    || die 'directorul tranzacției nu poate fi citit'
  transaction_root=$recovery_root
  [ -d "$recovery_root" ] && [ ! -L "$recovery_root" ] \
    && [ "$(realpath -e -- "$recovery_root")" = "$recovery_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$recovery_root")" = '0:0:700' ] \
    || die 'directorul tranzacției prepared este nesigur'
  rollback_manifest=$recovery_root/rollback-manifest
  recovery_compose=$recovery_root/recovery-compose.yml
  backups_root=$recovery_root/backups
  observed_top_level=$(find "$recovery_root" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort) \
    || die 'inventarul tranzacției prepared nu poate fi citit'
  [ "$observed_top_level" = $'backups:d\nrecovery-compose.yml:f\nrollback-manifest:f' ] \
    || die 'tranzacția prepared conține noduri top-level neașteptate'
  [ -d "$backups_root" ] && [ ! -L "$backups_root" ] \
    && [ "$(realpath -e -- "$backups_root")" = "$backups_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$backups_root")" = '0:0:700' ] \
    || die 'directorul backupurilor prepared este nesigur'
  [ -f "$rollback_manifest" ] && [ ! -L "$rollback_manifest" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$rollback_manifest")" = '0:0:600:1' ] \
    || die 'manifestul prepared este nesigur'
  [ -f "$recovery_compose" ] && [ ! -L "$recovery_compose" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$recovery_compose")" = '0:0:600:1' ] \
    || die 'compose-ul prepared este nesigur'
  [ -f "$selected_compose" ] && [ ! -L "$selected_compose" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$selected_compose")" = '0:0:444:1' ] \
    && cmp -s -- "$recovery_compose" "$selected_compose" \
    || die 'compose-ul live nu este byte-identic cu snapshotul prepared'
  rollback_manifest_sha=$(sha256sum "$rollback_manifest" | awk '{print $1}') \
    || die 'hashul manifestului prepared nu poate fi citit'
  recovery_compose_sha=$(sha256sum "$recovery_compose" | awk '{print $1}') \
    || die 'hashul compose-ului prepared nu poate fi citit'

  while IFS=$'\t' read -r logical present extra; do
    [ -n "$logical" ] && [ -z "$extra" ] && [ "$present" = 1 ] \
      || die 'manifestul prepared conține o intrare invalidă sau absentă'
    [ -n "${allowed[$logical]:-}" ] && [ -z "${seen[$logical]:-}" ] \
      || die 'manifestul prepared conține o intrare extra sau duplicată'
    seen[$logical]=1
    manifest_logicals+=("$logical")
    manifest_count=$((manifest_count + 1))
    map_logical "$logical"
    backup=$backups_root/$logical
    [ -f "$backup" ] && [ ! -L "$backup" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$backup")" = "$mapped_owner:$mapped_group:$mapped_mode:1" ] \
      || die "backupul prepared are inode/ACL invalid: $logical"
    [ -f "$mapped_target" ] && [ ! -L "$mapped_target" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$mapped_target")" = "$mapped_owner:$mapped_group:$mapped_mode:1" ] \
      && cmp -s -- "$mapped_target" "$backup" \
      || die "ținta live nu este byte-identică cu backupul prepared: $logical"
  done < "$rollback_manifest"
  [ "$manifest_count" -eq 12 ] \
    || die 'manifestul prepared nu conține exact cele douăsprezece intrări'
  observed_manifest=$(printf '%s\n' "${manifest_logicals[@]}" | LC_ALL=C sort) \
    || die 'manifestul prepared nu poate fi ordonat'
  expected=$(printf '%s\n' "${!allowed[@]}" | LC_ALL=C sort) \
    || die 'allowlistul prepared nu poate fi ordonat'
  [ "$observed_manifest" = "$expected" ] \
    || die 'manifestul prepared nu corespunde allowlistului exact'
  observed_backups=$(find "$backups_root" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort) \
    || die 'inventarul backupurilor prepared nu poate fi citit'
  expected=$(printf '%s:f\n' "${!allowed[@]}" | LC_ALL=C sort) \
    || die 'inventarul așteptat al backupurilor nu poate fi construit'
  [ "$observed_backups" = "$expected" ] \
    || die 'directorul backupurilor prepared conține noduri extra sau lipsă'

  active_before=$(jq -er '.activeBefore' "$DEPLOY_QUIESCE_JOURNAL") \
    || die 'markerul vechi nu poate fi citit'
  active_version=$(jq -er '.activeVersionBefore' "$DEPLOY_QUIESCE_JOURNAL") \
    || die 'versiunea veche nu poate fi citită'
  active_slot=$(jq -er '.proxyIntent.activeSlotBefore' "$DEPLOY_QUIESCE_JOURNAL") \
    || die 'slotul vechi nu poate fi citit'
  target_slot=$(jq -er '.proxyIntent.targetSlot' "$DEPLOY_QUIESCE_JOURNAL") \
    || die 'slotul țintă nu poate fi citit'
  [ -f "$RUNTIME_ROOT/release-state/active" ] && [ ! -L "$RUNTIME_ROOT/release-state/active" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RUNTIME_ROOT/release-state/active")" = '0:10050:640:1' ] \
    && [ "$(wc -l < "$RUNTIME_ROOT/release-state/active")" -eq 1 ] \
    && grep -qx "$active_before" "$RUNTIME_ROOT/release-state/active" \
    && [ "${active_before:0:${#active_version}}" = "$active_version" ] \
    || die 'markerul activ nu este exact generația veche jurnalizată'

  caddy_snapshot=$(jq -er '.proxyIntent.caddyfileSnapshot' "$DEPLOY_QUIESCE_JOURNAL") \
    || die 'snapshotul Caddyfile nu poate fi citit'
  upstream_snapshot=$(jq -er '.proxyIntent.oldUpstreamSnapshot' "$DEPLOY_QUIESCE_JOURNAL") \
    || die 'snapshotul upstream vechi nu poate fi citit'
  [ -f "$caddy_snapshot" ] && [ ! -L "$caddy_snapshot" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$caddy_snapshot")" = '0:0:600:1' ] \
    && [ "$(sha256sum "$caddy_snapshot" | awk '{print $1}')" = "$(jq -er '.proxyIntent.caddyfileSha256' "$DEPLOY_QUIESCE_JOURNAL")" ] \
    || die 'snapshotul Caddyfile vechi nu corespunde jurnalului'
  [ -f "$upstream_snapshot" ] && [ ! -L "$upstream_snapshot" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$upstream_snapshot")" = '0:0:600:1' ] \
    || die 'snapshotul upstream vechi este nesigur'
  expected_old_upstream_sha=$(printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' "$active_slot" \
    | sha256sum | awk '{print $1}') || die 'hashul upstream vechi nu poate fi construit'
  [ "$(sha256sum "$upstream_snapshot" | awk '{print $1}')" = "$expected_old_upstream_sha" ] \
    && [ "$expected_old_upstream_sha" = "$(jq -er '.proxyIntent.oldUpstreamSha256' "$DEPLOY_QUIESCE_JOURNAL")" ] \
    && [ "$(tail -c 1 -- "$upstream_snapshot" | od -An -t u1 | tr -d '[:space:]')" = 10 ] \
    || die 'snapshotul upstream vechi nu are bytes/newline canonice'

  [ -f "$ROOT/proxy/Caddyfile" ] && [ ! -L "$ROOT/proxy/Caddyfile" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ROOT/proxy/Caddyfile")" = '0:0:644:1' ] \
    && [ "$(sha256sum "$ROOT/proxy/Caddyfile" | awk '{print $1}')" = "$(jq -er '.proxyIntent.targetCaddyfileSha256' "$DEPLOY_QUIESCE_JOURNAL")" ] \
    || die 'Caddyfile-ul live nu corespunde bytes-urilor țintă jurnalizate'
  path=$ROOT/proxy/upstream/kelion-upstream.caddy
  [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$path")" = '0:0:644:1' ] \
    || die 'upstream-ul live este nesigur'
  expected_target_upstream_sha=$(printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' "$target_slot" \
    | sha256sum | awk '{print $1}') || die 'hashul upstream țintă nu poate fi construit'
  actual=$(sha256sum "$path" | awk '{print $1}') || die 'hashul upstream live nu poate fi citit'
  [ "$actual" = "$expected_target_upstream_sha" ] \
    && [ "$actual" = "$(jq -er '.proxyIntent.targetUpstreamSha256' "$DEPLOY_QUIESCE_JOURNAL")" ] \
    && [ "$(tail -c 1 -- "$path" | od -An -t u1 | tr -d '[:space:]')" = 10 ] \
    || die 'upstream-ul live nu are bytes/hash/newline canonice pentru slotul țintă'

  [ "$(docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null)" = true ] \
    || die 'proxy-ul managed nu rulează'
  proxy_health=$(docker inspect -f '{{.State.Health.Status}}' kelion-proxy 2>/dev/null) \
    || die 'health-ul proxy-ului managed nu poate fi citit'
  proxy_policy=$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' kelion-proxy 2>/dev/null) \
    || die 'restart policy-ul proxy-ului managed nu poate fi citit'
  [ "$proxy_health" = healthy ] && [ "$proxy_policy" = unless-stopped ] \
    || die 'proxy-ul managed nu este healthy cu restart policy canonic'
  if docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true; then
    die 'proxy-ul legacy rulează simultan cu proxy-ul managed'
  fi

  target_output=$(docker ps -aq --filter 'label=com.kelion.managed=true' \
    --filter "label=com.kelion.slot=$target_slot") \
    || die 'inventarul Docker al slotului țintă nu poate fi citit integral'
  [ -z "$target_output" ] || mapfile -t target_ids <<<"$target_output"
  [ "${#target_ids[@]}" -eq 5 ] \
    || die 'slotul țintă nu conține exact cinci containere managed'
  for role in app browser-worker browser-egress converter-gateway converter-parser; do
    role_ids=()
    role_output=$(docker ps -aq --filter 'label=com.kelion.managed=true' \
      --filter "label=com.kelion.slot=$target_slot" --filter "label=com.kelion.role=$role") \
      || die "inventarul Docker al rolului țintă nu poate fi citit integral: $role"
    [ -z "$role_output" ] || mapfile -t role_ids <<<"$role_output"
    [ "${#role_ids[@]}" -eq 1 ] || die "rolul țintă nu este unic: $role"
    id=${role_ids[0]}
    [ "$(docker inspect -f '{{.State.Running}}' "$id")" = true ] \
      && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] \
      && [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$id")" = unless-stopped ] \
      && [ "$(docker inspect -f '{{index .Config.Labels "com.kelion.commit"}}' "$id")" = "$target_commit" ] \
      || die "containerul țintă nu este healthy/running/canonic: $role"
    image=$(docker inspect -f '{{.Config.Image}}' "$id") \
      || die "imaginea containerului țintă nu poate fi citită: $role"
    [[ "$image" =~ @sha256:[0-9a-f]{64}$ ]] \
      || die "containerul țintă nu folosește o imagine immutable: $role"
  done

  # Ultima verificare înainte de prima și singura mutație confirmă că ownerul,
  # markerul, bytes-urile și topologia nu s-au schimbat sub publication lock.
  jq -e --arg commit "$target_commit" \
    '.schema == 2 and .phase == "active-prepared" and .commit == $commit' \
    "$DEPLOY_QUIESCE_JOURNAL" >/dev/null \
    || die 'faza jurnalului deploy s-a schimbat înainte de commitul discard'
  deploy_quiesce_owned_by_caller && deploy_quiesce_generation_proof \
    || die 'generația active-prepared s-a schimbat înainte de commitul discard'
  observed_top_level=$(find "$recovery_root" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort) \
    || die 'inventarul tranzacției nu poate fi recitit înainte de discard'
  [ "$observed_top_level" = $'backups:d\nrecovery-compose.yml:f\nrollback-manifest:f' ] \
    && [ "$(sha256sum "$rollback_manifest" | awk '{print $1}')" = "$rollback_manifest_sha" ] \
    && [ "$(sha256sum "$recovery_compose" | awk '{print $1}')" = "$recovery_compose_sha" ] \
    && cmp -s -- "$recovery_compose" "$selected_compose" \
    || die 'tranzacția/compose-ul s-a schimbat înainte de commitul discard'
  expected=$(printf '%s:f\n' "${!allowed[@]}" | LC_ALL=C sort) \
    || die 'inventarul backupurilor nu poate fi reconstruit înainte de discard'
  observed_backups=$(find "$backups_root" -mindepth 1 -maxdepth 1 -printf '%f:%y\n' | LC_ALL=C sort) \
    || die 'inventarul backupurilor nu poate fi recitit înainte de discard'
  [ "$observed_backups" = "$expected" ] \
    || die 'inventarul backupurilor s-a schimbat înainte de commitul discard'
  for logical in "${manifest_logicals[@]}"; do
    map_logical "$logical"
    backup=$backups_root/$logical
    [ -f "$backup" ] && [ ! -L "$backup" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$backup")" = "$mapped_owner:$mapped_group:$mapped_mode:1" ] \
      && [ -f "$mapped_target" ] && [ ! -L "$mapped_target" ] \
      && [ "$(stat -Lc '%u:%g:%a:%h' "$mapped_target")" = "$mapped_owner:$mapped_group:$mapped_mode:1" ] \
      && cmp -s -- "$mapped_target" "$backup" \
      || die "backupul sau ținta live s-a schimbat înainte de discard: $logical"
  done
  [ -f "$caddy_snapshot" ] && [ ! -L "$caddy_snapshot" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$caddy_snapshot")" = '0:0:600:1' ] \
    && [ "$(sha256sum "$caddy_snapshot" | awk '{print $1}')" = "$(jq -er '.proxyIntent.caddyfileSha256' "$DEPLOY_QUIESCE_JOURNAL")" ] \
    && [ -f "$upstream_snapshot" ] && [ ! -L "$upstream_snapshot" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$upstream_snapshot")" = '0:0:600:1' ] \
    && [ "$(sha256sum "$upstream_snapshot" | awk '{print $1}')" = "$expected_old_upstream_sha" ] \
    || die 'snapshoturile proxy s-au schimbat înainte de commitul discard'
  [ -f "$ROOT/proxy/Caddyfile" ] && [ ! -L "$ROOT/proxy/Caddyfile" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ROOT/proxy/Caddyfile")" = '0:0:644:1' ] \
    && [ "$(sha256sum "$ROOT/proxy/Caddyfile" | awk '{print $1}')" = "$(jq -er '.proxyIntent.targetCaddyfileSha256' "$DEPLOY_QUIESCE_JOURNAL")" ] \
    && [ -f "$path" ] && [ ! -L "$path" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$path")" = '0:0:644:1' ] \
    && [ "$(sha256sum "$path" | awk '{print $1}')" = "$expected_target_upstream_sha" ] \
    || die 'bytes-urile proxy live s-au schimbat înainte de commitul discard'
  [ "$(docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null)" = true ] \
    && [ "$(docker inspect -f '{{.State.Health.Status}}' kelion-proxy 2>/dev/null)" = healthy ] \
    && [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' kelion-proxy 2>/dev/null)" = unless-stopped ] \
    || die 'proxy-ul managed s-a schimbat înainte de commitul discard'
  target_ids=()
  target_output=$(docker ps -aq --filter 'label=com.kelion.managed=true' \
    --filter "label=com.kelion.slot=$target_slot") \
    || die 'inventarul final Docker al slotului țintă nu poate fi citit integral'
  [ -z "$target_output" ] || mapfile -t target_ids <<<"$target_output"
  [ "${#target_ids[@]}" -eq 5 ] \
    || die 'slotul țintă s-a schimbat înainte de commitul discard'
  for role in app browser-worker browser-egress converter-gateway converter-parser; do
    role_ids=()
    role_output=$(docker ps -aq --filter 'label=com.kelion.managed=true' \
      --filter "label=com.kelion.slot=$target_slot" --filter "label=com.kelion.role=$role") \
      || die "inventarul final Docker al rolului nu poate fi citit integral: $role"
    [ -z "$role_output" ] || mapfile -t role_ids <<<"$role_output"
    [ "${#role_ids[@]}" -eq 1 ] || die "rolul s-a schimbat înainte de discard: $role"
    id=${role_ids[0]}
    [ "$(docker inspect -f '{{.State.Running}}' "$id")" = true ] \
      && [ "$(docker inspect -f '{{.State.Health.Status}}' "$id")" = healthy ] \
      && [ "$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$id")" = unless-stopped ] \
      && [ "$(docker inspect -f '{{index .Config.Labels "com.kelion.commit"}}' "$id")" = "$target_commit" ] \
      || die "containerul s-a schimbat înainte de discard: $role"
  done
  [ -f "$JOURNAL" ] && [ ! -L "$JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$JOURNAL")" = '0:0:600:1' ] \
    && jq -e --arg root "$recovery_root" \
      '.schema == 1 and .phase == "prepared" and .transactionRoot == $root' "$JOURNAL" >/dev/null \
    || die 'jurnalul runtime s-a schimbat înainte de commitul discard'
  [ -f "$UNIT_MIGRATION_PENDING" ] && [ ! -L "$UNIT_MIGRATION_PENDING" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$UNIT_MIGRATION_PENDING")" = '0:0:600:1' ] \
    && [ "$(wc -l < "$UNIT_MIGRATION_PENDING")" -eq 1 ] \
    && grep -qx 'schema=1' "$UNIT_MIGRATION_PENDING" \
    || die 'bariera unit-only s-a schimbat înainte de commitul discard'
  wait_for_live_constructor_units_quiesced \
    || die 'Constructor nu a rămas quiesced înainte de commitul discard'
  clear_journal || die 'jurnalul runtime prepared nu a putut fi șters durabil'
  remove_transaction_after_durable_journal_clear "$recovery_root" \
    || die 'tranzacția runtime prepared nu a putut fi eliminată după unlink durabil'
  transaction_root=''
  recovery_in_progress=0
  units_quiesced=0
  config_consistent=1
  backend_consistent=1
  operation_succeeded=1
}

garbage_collect_transactions() {
  local candidate canonical
  for candidate in "$RUNTIME_ROOT"/runtime-config-txn.*; do
    [ -e "$candidate" ] || continue
    # Un director fără journal poate proveni fie dintr-un crash pre-intent, fie
    # dintr-un unlink al journalului al cărui fsync a eșuat. Fără un tombstone
    # durabil cele două cazuri sunt indistincte, deci păstrăm dovada root-only;
    # nu riscăm ca un power-loss ulterior să readucă journalul fără candidați.
    [[ "$candidate" =~ ^/root/kelion/runtime/runtime-config-txn\.[A-Za-z0-9]+$ ]] \
      && [ -d "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:700' ] || return 1
    canonical=$(realpath -e -- "$candidate") || return 1
    [ "$canonical" = "$candidate" ] || return 1
  done
}

garbage_collect_activations() {
  local candidate canonical
  for candidate in "$RUNTIME_ROOT"/constructor-activation.*; do
    [ -e "$candidate" ] || continue
    # Recovery-ul quiesced păstrează intenționat jurnalul canonic. Globul
    # directorului îl include, dar el nu este un snapshot orfan.
    [ "$candidate" = "$ACTIVATION_JOURNAL" ] && continue
    [[ "$candidate" =~ ^/root/kelion/runtime/constructor-activation\.[A-Za-z0-9._-]+$ ]] \
      && [ -d "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:700' ] || return 1
    canonical=$(realpath -e -- "$candidate") || return 1
    [ "$canonical" = "$candidate" ] || return 1
    if [ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ]; then
      # Persistăm mai întâi absența jurnalului. Altfel un power-loss după
      # ștergerea snapshotului ar putea readuce unlink-ul nedurabil și ar lăsa
      # un jurnal fără rollback root, stare pe care recovery-ul trebuie s-o refuze.
      fsync_path "$RUNTIME_ROOT" || return 1
      remove_activation_dir "$canonical" || return 1
      fsync_path "$RUNTIME_ROOT" || return 1
    fi
  done
}

garbage_collect_gate_transactions() {
  local candidate canonical
  for candidate in "$RUNTIME_ROOT"/constructor-gate-txn.*; do
    [ -e "$candidate" ] || continue
    [[ "$candidate" =~ ^/root/kelion/runtime/constructor-gate-txn\.[A-Za-z0-9]+$ ]] \
      && [ -d "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:700' ] || return 1
    canonical=$(realpath -e -- "$candidate") || return 1
    [ "$canonical" = "$candidate" ] || return 1
  done
}

cleanup_cutover() {
  local status=$? cleanup_failed=0 item transaction_cleanup_allowed=0 durable_phase=''
  trap - EXIT
  set +e
  if [ "$recovery_in_progress" = 1 ]; then
    # Orice eroare după publicarea stamp-ului poate lăsa unități pornite peste
    # un jurnal încă durabil. Fail-closed: jurnalul rămâne pentru următorul boot.
    force_quiesce_constructor_units || true
    clear_runtime_ready_stamp || true
    config_consistent=0
    backend_consistent=0
    cleanup_failed=1
  elif [ "$mutation_started" = 1 ] && [ "$operation_succeeded" != 1 ]; then
    if [ -f "$JOURNAL" ] && [ ! -L "$JOURNAL" ]; then
      durable_phase=$(jq -er '.phase | select(type == "string")' "$JOURNAL" 2>/dev/null || true)
    fi
    config_consistent=0
    backend_consistent=0
    if [ "$unit_only_transaction" = 1 ]; then
      if roll_forward_unit_transaction "$transaction_root"; then
        config_consistent=1
        backend_consistent=1
      else
        force_quiesce_constructor_units 1 || true
        clear_runtime_ready_stamp || true
        cleanup_failed=1
      fi
    else
      case "$durable_phase" in
      committed|timers-restored)
        # Pragul roll-forward este durabil înainte de primul start. Nu restaurăm
        # niciodată backupurile după el; următorul recovery reia generația nouă.
        force_quiesce_constructor_units || true
        clear_runtime_ready_stamp || true
        cleanup_failed=1
        ;;
      prepared|files-committed|backend-recreated)
        # Nicio unitate nu a putut porni înainte de committed. Rollbackul vechi
        # este încă sigur, dar numai după oprirea/verificarea tuturor celor șase.
        if ! force_quiesce_constructor_units 1; then
          cleanup_failed=1
        elif restore_files; then
          config_consistent=1
          if [ "$restart_required" != 1 ] || recreate_active_release; then backend_consistent=1; else cleanup_failed=1; fi
          if [ "$backend_consistent" = 1 ]; then
            if ! validate_unit_migration_pending; then
              cleanup_failed=1
            elif [ -f "$UNIT_MIGRATION_PENDING" ]; then
              # Backupul runtime pre-migrare poate aparține allowlistului vechi.
              # Nu îl declarăm strict și nu republicăm stamp-ul; închidem
              # rollbackul quiesced ca următorul retry mixt să poată progresa.
              if wait_for_live_constructor_units_quiesced; then
                units_quiesced=0
              else
                cleanup_failed=1
              fi
            fi
          fi
        else
          cleanup_failed=1
        fi
        ;;
      *)
        # Un jurnal absent/invalid nu dovedește că pragul nu a fost depășit.
        # Păstrăm fail-closed și nu alegem generația veche prin presupunere.
        force_quiesce_constructor_units || true
        clear_runtime_ready_stamp || true
        cleanup_failed=1
        ;;
      esac
    fi
  elif [ "$restart_guarded" = 1 ] && [ "$operation_succeeded" != 1 ]; then
    backend_consistent=0
    if recreate_active_release; then backend_consistent=1; else cleanup_failed=1; fi
  fi
  if [ "$units_quiesced" = 1 ]; then
    if [ "$leave_constructor_quiesced" = 1 ]; then
      force_quiesce_constructor_units || cleanup_failed=1
      clear_runtime_ready_stamp || cleanup_failed=1
      units_quiesced=0
    elif [ "$config_consistent" = 1 ] && [ "$backend_consistent" = 1 ]; then
      if validate_live_runtime_contract && publish_runtime_ready_stamp; then
        restore_constructor_timers || cleanup_failed=1
      else
        force_quiesce_constructor_units || true
        cleanup_failed=1
      fi
    else
      cleanup_failed=1
    fi
  fi
  if [ "$recovery_in_progress" != 1 ] && [ "$config_consistent" = 1 ] && [ "$backend_consistent" = 1 ] \
    && [ "$units_quiesced" = 0 ]; then
    transaction_cleanup_allowed=1
  fi
  if [ "$transaction_cleanup_allowed" = 1 ] && { [ "$journal_owned" = 1 ] || [ -e "$JOURNAL" ] || [ -L "$JOURNAL" ]; }; then
    clear_journal || cleanup_failed=1
  fi
  if [ "$transaction_cleanup_allowed" = 1 ] && [ -n "$transaction_root" ] \
    && [ ! -e "$JOURNAL" ] && [ ! -L "$JOURNAL" ]; then
    if remove_transaction_after_durable_journal_clear "$transaction_root"; then
      transaction_root=''
    else
      cleanup_failed=1
    fi
  fi
  for item in "${prepared[@]:-}"; do [ -z "$item" ] || rm -f -- "$item" || cleanup_failed=1; done
  if [ "$recover_only" = 0 ]; then
    if [[ "$stage_root" =~ ^/root/kelion/runtime/runtime-cutover\.[A-Za-z0-9]+$ ]] \
      && [ "$stage_root" = "$stage_canonical" ] \
      && [ -d "$stage_root" ] && [ ! -L "$stage_root" ]; then
      rm -rf -- "$stage_root" || cleanup_failed=1
    else
      cleanup_failed=1
    fi
  fi
  if [ "$cleanup_failed" != 0 ]; then
    printf 'runtime-cutover: rollback incomplet; unitățile Constructor rămân oprite\n' >&2
    status=1
  fi
  exit "$status"
}
trap cleanup_cutover EXIT

# Modul special armează cleanup-ul fail-closed înaintea oricărui validator.
# Un owner/jurnal invalid nu poate ajunge la cleanup-ul tranzacțional generic.
if [ "$discard_unmutated_prepared" = 1 ] || [ "$discard_unmutated_gate_prepared" = 1 ]; then
  recovery_in_progress=1
fi

# Recover-only este și bariera de boot. Oprește mai întâi orice generație
# detectabilă, inclusiv unități legacy ori un set 1..5 fără proveniență. Acest
# pas nu repară fișiere fără jurnal; doar elimină side-effect-urile înaintea
# validatorului strict și păstrează fail-closed dacă validarea eșuează.
if [ "$recover_only" = 1 ]; then
  if ! retract_runtime_ready_stamp_for_recovery; then
    force_quiesce_constructor_units 1 || true
    die 'stamp-ul runtime nesigur nu a putut fi retras înainte de recovery'
  fi
  quiesce_units_for_recovery 1 \
    || die 'unitățile Constructor nu au putut fi oprite înainte de recovery'
  systemctl is-active --quiet docker.service \
    || die 'Docker este indisponibil; Constructor rămâne oprit fără stamp runtime'
else
  validate_runtime_ready_stamp || die 'stamp-ul runtime existent este nesigur'
fi
validate_deploy_quiesce_journal || die 'jurnalul quiesce al deploy-ului este nesigur'

if [ -e "$DEPLOY_QUIESCE_JOURNAL" ] || [ -L "$DEPLOY_QUIESCE_JOURNAL" ]; then
  deploy_quiesce_authorized=0
  if [ "$recover_only" = 1 ] && [ "$leave_constructor_quiesced" = 1 ]; then
    # Orice recovery poate repara fișiere durabile cât timp păstrează toate
    # unitățile oprite și nu șterge jurnalul deținut de deploy.
    deploy_quiesce_authorized=1
  elif [ "$recover_only" = 1 ] && [ "$leave_constructor_quiesced" = 0 ] \
    && [ "$deploy_quiesce_proof" = 1 ] && deploy_quiesce_owned_by_caller \
    && { { [ "$discard_unmutated_gate_prepared" = 1 ] \
          && deploy_quiesce_generation_proof old; } \
      || { [ "$discard_unmutated_gate_prepared" = 0 ] \
          && { deploy_quiesce_generation_proof committed \
            || deploy_quiesce_pre_ponr_rollback_proof; }; }; }; then
    # Numai ownerul tuplei poate publica stamp-ul și șterge jurnalul, după ce
    # active+gate corespund exact snapshotului vechi (rollback pre-PONR sau
    # discard gate) ori commitului gate nou.
    deploy_quiesce_authorized=1
  elif [ "$recover_only" = 0 ] && [ "$leave_constructor_quiesced" = 1 ] \
    && deploy_quiesce_owned_by_caller; then
    # Deploy-ul proprietar poate actualiza artefacte tranzacționale sub quiesce,
    # dar helperul nu are voie să reactiveze ori să consume jurnalul.
    deploy_quiesce_authorized=1
  fi
  if [ "$deploy_quiesce_authorized" != 1 ]; then
    recovery_in_progress=1
    quiesce_units_for_recovery || die 'jurnal deploy activ: unitățile Constructor nu pot fi oprite fail-closed'
    units_quiesced=0
    die 'jurnal deploy activ: recovery/reactivare refuzată fără owner și dovadă de generație exactă'
  fi
fi

if [ "$discard_unmutated_prepared" = 1 ]; then
  discard_unmutated_prepared_cutover "$discard_target_commit" "$compose_file"
  exit 0
fi
if ! ensure_constructor_marker_root_durable; then
  force_quiesce_constructor_units 1 || true
  clear_runtime_ready_stamp || true
  die 'directorul markerelor Constructor nu poate fi autentificat și persistat root:root 0755'
fi
if [ -n "$activation_resume_operation" ] \
  && [ ! -e "$ACTIVATION_JOURNAL" ] && [ ! -L "$ACTIVATION_JOURNAL" ]; then
  die 'resume-ul activării cere jurnalul durabil existent'
fi
if [ "$discard_unmutated_gate_prepared" = 1 ]; then
  discard_unmutated_gate_prepared_refresh \
    "$discard_gate_request_id" "$discard_gate_commit" "$discard_gate_active_commit" "$compose_file"
fi
if [ "$leave_constructor_quiesced" = 0 ]; then
  # Intentul persistent precede orice recovery/mutație care ar putea publica
  # ready ori porni un timer. Serviciile cu side effects îl folosesc drept
  # Condition fail-closed, iar controllerul îl acceptă numai la startup și
  # refuză toate endpointurile până la clear-ul final.
  recovery_in_progress=1
  publish_reactivation_journal \
    || die 'intentul persistent al reactivării nu a putut fi armat înainte de recovery/cutover'
fi
recover_interrupted_gate_refresh
recover_interrupted_activation
if [ "$activation_outer_commit_pending" = 1 ]; then
  [ "$recover_only" = 1 ] && [ -n "$activation_resume_operation" ] \
    || die 'handoff-ul activării applied nu are owner explicit'
  validate_reactivation_journal \
    && [ -f "$REACTIVATION_JOURNAL" ] \
    && jq -e --arg operation "$activation_resume_operation" \
      '.schema == 2 and .phase == "applied" and .operation == $operation' \
      "$ACTIVATION_JOURNAL" >/dev/null \
    && validate_constructor_quiesce_barrier \
    || die 'handoff-ul activării applied nu are marker/jurnal/barieră exactă'
  operation_succeeded=1
  units_quiesced=0
  recovery_in_progress=0
  exit 0
fi
recover_interrupted_cutover
garbage_collect_transactions || die 'tranzacțiile orfane nu au putut fi curățate sigur'
garbage_collect_activations || die 'snapshoturile de activare orfane nu au putut fi curățate sigur'
garbage_collect_gate_transactions || die 'tranzacțiile gate orfane nu au putut fi curățate sigur'
if [ "$activation_barrier_pending" = 1 ]; then
  [ "$recover_only" = 1 ] || die 'o activare quiesced trebuie reluată explicit înainte de alt cutover'
  validate_constructor_quiesce_barrier || die 'bariera activării quiesced nu mai este exactă'
  operation_succeeded=1
  units_quiesced=0
  exit 0
fi
if [ "$recover_only" = 1 ]; then
  validate_unit_migration_pending || die 'bariera unit-only este nesigură'
  if { [ -e "$DEPLOY_QUIESCE_JOURNAL" ] || [ -L "$DEPLOY_QUIESCE_JOURNAL" ]; } \
    && [ "$leave_constructor_quiesced" = 1 ] \
    && deploy_quiesce_owned_by_caller \
    && jq -e '.phase == "armed" or .phase == "quiesced"' "$DEPLOY_QUIESCE_JOURNAL" >/dev/null; then
    # Ownerul jurnalului extern va continua instalarea/migrarea. Contractul live
    # poate fi deliberat legacy (de exemplu sync încă absent), dar bariera
    # fizică trebuie să fie exactă: fără stamp, fără joburi și 0/6 unități.
    validate_constructor_quiesce_barrier \
      || die 'bariera quiesced deținută de deploy nu este exactă'
    operation_succeeded=1
    units_quiesced=0
    exit 0
  fi
  if [ -f "$UNIT_MIGRATION_PENDING" ]; then
    validate_constructor_quiesce_barrier \
      || die 'unitățile nu sunt sigur quiesced sub bariera pending'
    if [ -e "$DEPLOY_QUIESCE_JOURNAL" ] || [ -L "$DEPLOY_QUIESCE_JOURNAL" ]; then
      if [ "$deploy_quiesce_proof" = 1 ] && deploy_quiesce_owned_by_caller \
        && { { [ "$discard_unmutated_gate_prepared" = 1 ] \
              && deploy_quiesce_generation_proof old; } \
          || { [ "$discard_unmutated_gate_prepared" = 0 ] \
              && { deploy_quiesce_generation_proof committed \
                || deploy_quiesce_pre_ponr_rollback_proof; }; }; } \
        && validate_live_runtime_contract; then
        clear_unit_migration_pending \
          || die 'bariera unit-only nu a putut fi consumată după dovada strictă a deploy-ului'
      else
        [ "$leave_constructor_quiesced" = 1 ] \
          || die 'bariera unit-only blochează boot-ul generic până la cutover-ul strict'
        operation_succeeded=1
        exit 0
      fi
    else
      [ "$leave_constructor_quiesced" = 1 ] \
        || die 'bariera unit-only blochează boot-ul generic până la cutover-ul strict'
      operation_succeeded=1
      exit 0
    fi
  fi
  validate_live_runtime_contract || die 'contractul runtime live este invalid după recovery'
  if [ "$leave_constructor_quiesced" = 1 ]; then
    quiesce_units_for_recovery || die 'unitățile Constructor nu pot rămâne quiesced după validare'
    units_quiesced=0
  else
    # Chiar fără jurnal, boot recovery reconciliază unitățile din marker-ele
    # durabile. Astfel o cădere după commitul gate, dar înainte de enable/start,
    # nu lasă Constructor oprit permanent.
    quiesce_units_for_recovery || die 'unitățile Constructor nu pot fi reconciliate după recovery'
    recovery_in_progress=1
    publish_reactivation_journal \
      || die 'intentul persistent al reactivării nu a putut fi publicat după recovery'
    publish_runtime_ready_stamp || die 'stamp-ul runtime nu a putut fi publicat după validare'
    if [ -e "$DEPLOY_QUIESCE_JOURNAL" ] || [ -L "$DEPLOY_QUIESCE_JOURNAL" ]; then
      clear_deploy_quiesce_journal || die 'jurnalul quiesce nu a putut fi șters după reactivare'
    fi
    restore_runtime_controller_or_quiesce \
      || die 'controllerul manual nu este active+socket după recovery'
    restore_constructor_timers || die 'timer-ele Constructor nu au putut fi reconciliate după marker-e'
    clear_reactivation_journal_or_defer \
      || die 'intentul persistent al reactivării nu a putut fi retras după probe'
    recovery_in_progress=0
  fi
  operation_succeeded=1
  exit 0
fi
mapfile -t manifest_entries < "$stage_root/manifest"
[ "${#manifest_entries[@]}" -gt 0 ] || die 'manifestul de staging este gol'
for logical in "${manifest_entries[@]}"; do
  [[ "$logical" =~ ^[a-z0-9.-]+$ ]] || die 'nume invalid în manifestul de staging'
  [ -z "${seen_logical[$logical]:-}" ] || die "intrare duplicată în manifest: $logical"
  seen_logical[$logical]=1
  source_file=$stage_root/files/$logical
  [ -f "$source_file" ] && [ ! -L "$source_file" ] || die "fișier de staging lipsă: $logical"
  case "$logical" in
    runtime.env|constructor-config.*) validate_env_file "$source_file" "$logical" || die "env invalid în staging: $logical" ;;
    systemd-timer.*) validate_constructor_timer_unit "$source_file" "$logical" || die "timer systemd invalid în staging: $logical" ;;
    systemd-service.*) validate_constructor_service_unit "$source_file" "$logical" || die "service systemd invalid în staging: $logical" ;;
    *) validate_secret_file "$source_file" || die "secret invalid în staging: $logical" ;;
  esac
  map_logical "$logical"
  logical_names+=("$logical")
  targets+=("$mapped_target")
  owner_ids+=("$mapped_owner")
  group_ids+=("$mapped_group")
  modes+=("$mapped_mode")
done
validate_constructor_state
if [ "$unit_only_transaction" = 1 ]; then
  publish_unit_migration_pending \
    || die 'bariera durabilă unit-only nu a putut fi publicată înainte de quiesce'
fi
quiesce_constructor_units || die 'cele șase unități Constructor nu s-au oprit complet'

install -d -o root -g 10050 -m 0750 "$CONFIG_ROOT" "$SECRET_ROOT"
install -d -o root -g root -m 0750 "$ROOT/gate-secrets" "$ROOT/worker-secrets" "$ROOT/publisher-secrets" "$ROOT/release-secrets"
transaction_root=$(mktemp -d "$RUNTIME_ROOT/runtime-config-txn.XXXXXX")
chown root:root "$transaction_root"
chmod 0700 "$transaction_root"
install -d -o root -g root -m 0700 "$transaction_root/backups"
install -o root -g root -m 0600 "$compose_file" "$transaction_root/recovery-compose.yml"
: > "$transaction_root/rollback-manifest"
chown root:root "$transaction_root/rollback-manifest"
chmod 0600 "$transaction_root/rollback-manifest"
if [ "$unit_only_transaction" = 1 ]; then
  install -d -o root -g root -m 0700 "$transaction_root/forward"
  : > "$transaction_root/forward-manifest"
  chown root:root "$transaction_root/forward-manifest"
  chmod 0600 "$transaction_root/forward-manifest"
fi

for index in "${!logical_names[@]}"; do
  target=${targets[$index]}
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || die "țintă live nesigură: $target"
    [ "$(stat -c '%u:%g:%a' "$target")" = "${owner_ids[$index]}:${group_ids[$index]}:${modes[$index]}" ] \
      || die "ACL live necanonic pentru $target"
  fi
  temporary=$(mktemp "$target.cutover.XXXXXX")
  install -o "${owner_ids[$index]}" -g "${group_ids[$index]}" -m "${modes[$index]}" "$stage_root/files/${logical_names[$index]}" "$temporary"
  cmp -s -- "$temporary" "$stage_root/files/${logical_names[$index]}" || die 'copia pregătită diferă de staging'
  prepared+=("$temporary")
  if [ "$unit_only_transaction" = 1 ]; then
    install -o root -g root -m 0600 "$stage_root/files/${logical_names[$index]}" \
      "$transaction_root/forward/${logical_names[$index]}"
    cmp -s -- "$transaction_root/forward/${logical_names[$index]}" "$stage_root/files/${logical_names[$index]}" \
      || die 'candidatul durabil unit-only diferă de staging'
    printf '%s\t%s\n' "${logical_names[$index]}" \
      "$(sha256sum "$transaction_root/forward/${logical_names[$index]}" | awk '{print $1}')" \
      >> "$transaction_root/forward-manifest"
  fi
  backup=$transaction_root/backups/${logical_names[$index]}
  if [ -f "$target" ]; then
    cp --preserve=mode,ownership,timestamps -- "$target" "$backup"
    backups+=("$backup")
    backup_present+=(1)
    printf '%s\t1\n' "${logical_names[$index]}" >> "$transaction_root/rollback-manifest"
  else
    : > "$backup"
    chown root:root "$backup"
    chmod 0600 "$backup"
    backups+=("$backup")
    backup_present+=(0)
    printf '%s\t0\n' "${logical_names[$index]}" >> "$transaction_root/rollback-manifest"
  fi
done

validate_candidate_secret_separation

if [ "$restart_required" = 1 ] && { [ -e "$RUNTIME_ROOT/release-state/active" ] || [ -L "$RUNTIME_ROOT/release-state/active" ]; }; then
  [ -f "$RUNTIME_ROOT/release-state/active" ] && [ ! -L "$RUNTIME_ROOT/release-state/active" ] \
    && [ "$(stat -c '%u:%g:%a' "$RUNTIME_ROOT/release-state/active")" = '0:10050:640' ] \
    && [ "$(wc -l < "$RUNTIME_ROOT/release-state/active")" -eq 1 ] \
    && [[ "$(sed -n '1p' "$RUNTIME_ROOT/release-state/active")" =~ ^[0-9a-f]{40}$ ]] \
    || die 'markerul release-ului activ este gol, legacy sau necanonic'
fi
for backup in "${backups[@]}"; do fsync_path "$backup" || die 'backupul nu a putut fi sincronizat durabil'; done
if [ "$unit_only_transaction" = 1 ]; then
  for logical in "${logical_names[@]}"; do
    fsync_path "$transaction_root/forward/$logical" || die 'candidatul unit-only nu a putut fi sincronizat durabil'
  done
  fsync_path "$transaction_root/forward-manifest" || die 'manifestul forward unit-only nu a putut fi sincronizat durabil'
  fsync_path "$transaction_root/forward" || die 'directorul forward unit-only nu a putut fi sincronizat durabil'
fi
fsync_path "$transaction_root/recovery-compose.yml" || die 'compose-ul de recovery nu a putut fi sincronizat durabil'
fsync_path "$transaction_root/rollback-manifest" || die 'manifestul de rollback nu a putut fi sincronizat durabil'
fsync_path "$transaction_root/backups" || die 'directorul backupurilor nu a putut fi sincronizat durabil'
fsync_path "$transaction_root" || die 'directorul tranzacției nu a putut fi sincronizat durabil'
write_journal_phase prepared || die 'jurnalul durabil nu a putut fi creat înainte de commit'
guard_active_release_restart || die 'containerele active nu au putut fi puse sub restart gate durabil'

mutation_started=1
config_consistent=0
for index in "${!targets[@]}"; do
  mv -f -- "${prepared[$index]}" "${targets[$index]}"
  prepared[$index]=''
done
for index in "${!targets[@]}"; do
  [ "$(stat -c '%u:%g:%a' "${targets[$index]}")" = "${owner_ids[$index]}:${group_ids[$index]}:${modes[$index]}" ] \
    || die "ACL invalid după commit pentru ${targets[$index]}"
  cmp -s -- "${targets[$index]}" "$stage_root/files/${logical_names[$index]}" \
    || die "conținut invalid după commit pentru ${targets[$index]}"
  fsync_path "${targets[$index]}" || die "fișierul comis nu a putut fi sincronizat: ${targets[$index]}"
  fsync_path "$(dirname -- "${targets[$index]}")" || die "directorul țintei nu a putut fi sincronizat: ${targets[$index]}"
done
if [ "$constructor_staged_unit_count" -eq 6 ]; then
  systemctl daemon-reload || die 'systemd nu a putut reîncărca cele șase unități comise'
  constructor_unit_count=6
  force_quiesce_constructor_units \
    || die 'cele șase unități comise nu au putut fi dovedite inactive și dezactivate'
fi
if [ "$unit_only_transaction" = 1 ]; then
  wait_for_live_constructor_units_quiesced \
    || die 'setul unit-only comis nu este exact, inactiv și dezactivat'
else
  validate_live_runtime_contract \
    || die 'contractul runtime live este invalid după publicarea fișierelor'
fi
config_consistent=1
write_journal_phase files-committed || die 'faza files-committed nu a putut fi jurnalizată'

restore_constructor_model_control \
  || die 'controllerul manual de model nu a rămas protejat după publicarea configurației'
if [ "$restart_required" = 1 ]; then
  backend_consistent=0
  recreate_active_release || die 'slotul backend activ nu a putut fi recreat cu noua generație'
  backend_consistent=1
fi
write_journal_phase backend-recreated || die 'faza backend-recreated nu a putut fi jurnalizată'
if [ "$unit_only_transaction" = 1 ]; then
  validate_live_constructor_units_quiesced \
    || die 'setul unit-only nu mai este quiesced înainte de pragul committed'
else
  validate_live_runtime_contract \
    || die 'contractul runtime live este invalid înainte de pragul committed'
fi
write_journal_phase committed || die 'pragul roll-forward nu a putut fi jurnalizat înainte de activare'
if [ "$leave_constructor_quiesced" = 1 ]; then
  if [ "$unit_only_transaction" = 1 ]; then
    validate_live_constructor_units_quiesced \
      || die 'setul unit-only nu mai este quiesced înainte de finalizare'
  else
    validate_live_runtime_contract \
      || die 'contractul runtime live este invalid înainte de finalizarea quiesced'
    clear_unit_migration_pending \
      || die 'bariera unit-only nu a putut fi consumată după cutover-ul strict'
  fi
  clear_journal || die 'jurnalul cutover-ului config-only nu a putut fi șters durabil'
  units_quiesced=0
  operation_succeeded=1
else
  clear_unit_migration_pending \
    || die 'bariera unit-only nu a putut fi consumată după cutover-ul strict'
  recovery_in_progress=1
  publish_reactivation_journal \
    || die 'intentul persistent al reactivării nu a putut fi publicat înainte de clear-ul runtime'
  publish_runtime_ready_stamp || die 'stamp-ul runtime nu a putut fi publicat după commit'
  clear_journal || die 'jurnalul cutover-ului finalizat nu a putut fi șters durabil'
  restore_runtime_controller_or_quiesce \
    || die 'controllerul manual de model nu a revenit după clear-ul durabil al jurnalului runtime'
  restore_constructor_timers || die 'timer-ele Constructor nu au putut fi reactivate coerent'
  clear_reactivation_journal_or_defer \
    || die 'intentul persistent al reactivării nu a putut fi retras după probe'
  recovery_in_progress=0
  operation_succeeded=1
fi
if ! remove_transaction_after_durable_journal_clear "$transaction_root"; then
  printf 'runtime-cutover: avertisment: tranzacția finalizată a rămas root-only\n' >&2
fi
transaction_root=''
