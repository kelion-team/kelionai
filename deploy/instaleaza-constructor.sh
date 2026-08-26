#!/usr/bin/env bash
set -euo pipefail
umask 077

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
for tool in awk cmp flock getent grep jq mktemp python3 readlink realpath sha256sum stat sync systemctl systemd-analyze usermod; do
  command -v "$tool" >/dev/null 2>&1 || { echo "lipsește utilitarul $tool" >&2; exit 1; }
done
usermod --help 2>&1 | grep -q -- '--add-subuids FIRST-LAST' \
  && usermod --help 2>&1 | grep -q -- '--del-subuids FIRST-LAST' \
  && usermod --help 2>&1 | grep -q -- '--add-subgids FIRST-LAST' \
  && usermod --help 2>&1 | grep -q -- '--del-subgids FIRST-LAST' \
  || { echo 'usermod nu oferă tranzacțiile native subuid/subgid necesare' >&2; exit 1; }

ROOT=/root/kelion
RUNTIME_ROOT=$ROOT/runtime
PUBLICATION_LOCK=$ROOT/publicare.lock
INSTALL_JOURNAL=$RUNTIME_ROOT/constructor-deploy-quiesce.journal
READY_ROOT=/run/kelion
READY_STAMP=$READY_ROOT/runtime-config-recovery.ready
install -d -o root -g root -m 0755 "$ROOT"

acquire_publication_lock() {
  local inherited=${KELION_CUTOVER_LOCK_HELD:-0} fd_path fd_identity
  case "$inherited" in 0|1) ;; *) return 1 ;; esac
  if [ "$inherited" = 1 ]; then
    [ -e /proc/$$/fd/9 ] || return 1
    fd_path=$(readlink "/proc/$$/fd/9") || return 1
    [ "$fd_path" = "$PUBLICATION_LOCK" ] || return 1
    [ -f /proc/$$/fd/9 ] && [ ! -L "$PUBLICATION_LOCK" ] || return 1
    [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] || return 1
    fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9) || return 1
    [ "$fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] || return 1
    flock -n 9 || return 1
    return 0
  fi
  if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
    [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] || return 1
  fi
  exec 9<>"$PUBLICATION_LOCK"
  fd_path=$(readlink "/proc/$$/fd/9") || return 1
  [ "$fd_path" = "$PUBLICATION_LOCK" ] && [ -f /proc/$$/fd/9 ] || return 1
  [ "$(stat -Lc '%h' /proc/$$/fd/9)" = 1 ] || return 1
  fd_identity=$(stat -Lc '%d:%i' /proc/$$/fd/9) || return 1
  [ "$fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] || return 1
  chown root:root /proc/$$/fd/9
  chmod 0600 /proc/$$/fd/9
  [ "$(stat -Lc '%u:%g:%a:%h' /proc/$$/fd/9)" = '0:0:600:1' ] || return 1
  [ ! -L "$PUBLICATION_LOCK" ] \
    && [ "$fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] || return 1
  flock -n 9 || return 1
  export KELION_CUTOVER_LOCK_HELD=1
}
acquire_publication_lock || { echo 'lock-ul de publicare nu poate fi dobândit și dovedit pe FD9' >&2; exit 1; }

install_atomic() {
  local source=$1 target=$2 owner=$3 group=$4 mode=$5 temporary
  temporary=$(mktemp "$target.install.XXXXXX")
  install -o "$owner" -g "$group" -m "$mode" "$source" "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$target"
  sync -f "$(dirname -- "$target")"
}

ensure_group() {
  local group_name=$1
  getent group "$group_name" >/dev/null || groupadd --system "$group_name"
}

ensure_user() {
  local user_name=$1 home_dir=$2
  if ! getent passwd "$user_name" >/dev/null; then
    useradd --system --add-subids-for-system --home-dir "$home_dir" --create-home --shell /usr/sbin/nologin "$user_name"
  fi
}

validate_subid_map() {
  local file=$1 user_name=$2 policy=${3:-require-existing}
  case "$policy" in require-existing|allow-missing) ;; *) return 1 ;; esac
  [[ "$user_name" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || return 1
  python3 - "$file" "$user_name" "$policy" <<'PY'
import pathlib
import re
import sys

path, wanted, policy = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
raw = path.read_bytes()
if len(raw) > 1024 * 1024 or (raw and not raw.endswith(b"\n")):
    raise SystemExit("fișier subid supradimensionat sau trunchiat")
try:
    lines = raw.decode("ascii").splitlines()
except UnicodeDecodeError:
    raise SystemExit("fișier subid non-ASCII")

ranges = []
owners = []
for line_number, line in enumerate(lines, 1):
    fields = line.split(":")
    if len(fields) != 3:
        raise SystemExit(f"intrare subid invalidă la linia {line_number}")
    owner, start_text, count_text = fields
    if (
        not owner
        or len(owner) > 256
        or any(ord(character) < 33 or ord(character) == 127 for character in owner)
        or ":" in owner
        or not re.fullmatch(r"0|[1-9][0-9]*", start_text)
        or not re.fullmatch(r"[1-9][0-9]*", count_text)
    ):
        raise SystemExit(f"intrare subid necanonică la linia {line_number}")
    start, count = int(start_text), int(count_text)
    end = start + count - 1
    if start < 1 or end > 0xFFFFFFFF:
        raise SystemExit(f"interval subid în afara limitelor la linia {line_number}")
    ranges.append((start, end, owner, line_number))
    if owner == wanted:
        owners.append((start, count))

previous = None
for current in sorted(ranges):
    if previous is not None and current[0] <= previous[1]:
        raise SystemExit(
            f"intervale subid suprapuse la liniile {previous[3]} și {current[3]}"
        )
    previous = current

if len(owners) == 1:
    start, count = owners[0]
    if count < 65536:
        raise SystemExit("maparea subid existentă este insuficientă")
    print("valid")
    raise SystemExit(0)
if owners:
    raise SystemExit("utilizatorul are mapări subid duplicate")
if policy != "allow-missing":
    raise SystemExit("maparea subid lipsește")

candidate = 100000
for start, end, _owner, _line_number in sorted(ranges):
    if end < candidate:
        continue
    if candidate + 65536 - 1 < start:
        break
    candidate = end + 1
if candidate + 65536 - 1 > 0xFFFFFFFF:
    raise SystemExit("nu mai există un interval subid suficient")
print(f"missing:{candidate}")
PY
}

fsync_subid_path() {
  python3 - "$1" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
before = os.stat(path, follow_symlinks=False)
if stat.S_ISLNK(before.st_mode):
    raise SystemExit(1)
flags = os.O_RDONLY | (os.O_DIRECTORY if stat.S_ISDIR(before.st_mode) else 0)
flags |= getattr(os, "O_NOFOLLOW", 0)
descriptor = os.open(path, flags)
try:
    opened = os.fstat(descriptor)
    if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
        raise SystemExit(1)
    os.fsync(descriptor)
finally:
    os.close(descriptor)
PY
}

validate_subid_path() {
  local file=$1
  [ -f "$file" ] && [ ! -L "$file" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$file")" = '0:0:644:1' ]
}

ensure_subids() {
  local user_name=$1 prefix=${2:-} etc_root=/etc uid_file gid_file attempt
  local uid_result gid_result uid_final gid_final start end range durability_ok
  local uid_requested=0 gid_requested=0
  local -a update_command cleanup_command
  [[ "$user_name" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || return 1
  if [ -n "$prefix" ]; then
    [ -d "$prefix" ] && [ ! -L "$prefix" ] \
      && [ "$(realpath -e -- "$prefix")" = "$prefix" ] || return 1
    etc_root=$prefix/etc
  fi
  [ -d "$etc_root" ] && [ ! -L "$etc_root" ] || return 1
  uid_file=$etc_root/subuid
  gid_file=$etc_root/subgid
  validate_subid_path "$uid_file" && validate_subid_path "$gid_file" || return 1

  # usermod deschide și recitește bazele subid numai după sub_uid_lock /
  # sub_gid_lock. Opțiunile uid+gid sunt trimise într-un singur proces, astfel
  # încât niciun writer shadow concurent nu poate fi suprascris de un RMW local.
  # Calculul anterior lockului este tratat optimist: dacă alt writer ocupă
  # intervalul, validarea globală eșuează, eliminăm numai intervalul cerut prin
  # același API shadow și recalculăm bounded.
  for attempt in 1 2 3 4; do
    uid_result=$(validate_subid_map "$uid_file" "$user_name" allow-missing) || return 1
    gid_result=$(validate_subid_map "$gid_file" "$user_name" allow-missing) || return 1
    if [ "$uid_result" = valid ] && [ "$gid_result" = valid ]; then
      fsync_subid_path "$uid_file" && fsync_subid_path "$gid_file" \
        && fsync_subid_path "$etc_root" || return 1
      return 0
    fi

    update_command=(usermod)
    cleanup_command=(usermod)
    if [ -n "$prefix" ]; then
      update_command+=(--prefix "$prefix")
      cleanup_command+=(--prefix "$prefix")
    fi
    uid_requested=0
    gid_requested=0
    case "$uid_result" in
      valid) ;;
      missing:[1-9][0-9]*)
        start=${uid_result#missing:}; end=$((start + 65535))
        [ "$end" -le 4294967295 ] || return 1
        range=$start-$end
        update_command+=(--add-subuids "$range")
        cleanup_command+=(--del-subuids "$range")
        uid_requested=1
        ;;
      *) return 1 ;;
    esac
    case "$gid_result" in
      valid) ;;
      missing:[1-9][0-9]*)
        start=${gid_result#missing:}; end=$((start + 65535))
        [ "$end" -le 4294967295 ] || return 1
        range=$start-$end
        update_command+=(--add-subgids "$range")
        cleanup_command+=(--del-subgids "$range")
        gid_requested=1
        ;;
      *) return 1 ;;
    esac
    [ "$uid_requested" = 1 ] || [ "$gid_requested" = 1 ] || return 1

    # Codul de ieșire nu este autoritatea pentru succes: un writer shadow
    # concurent poate publica exact aceeași mapare între precheck și lock, iar
    # usermod poate raporta duplicate deși invariantul final este deja valid.
    "${update_command[@]}" "$user_name" || :
    durability_ok=1
    validate_subid_path "$uid_file" && validate_subid_path "$gid_file" \
      && fsync_subid_path "$uid_file" && fsync_subid_path "$gid_file" \
      && fsync_subid_path "$etc_root" || durability_ok=0
    uid_final=$(validate_subid_map "$uid_file" "$user_name" require-existing 2>/dev/null) || uid_final=invalid
    gid_final=$(validate_subid_map "$gid_file" "$user_name" require-existing 2>/dev/null) || gid_final=invalid
    if [ "$uid_final" = valid ] && [ "$gid_final" = valid ]; then
      [ "$durability_ok" = 1 ] && return 0
      return 1
    fi

    # usermod poate raporta eroare după ce unul dintre cele două fișiere a fost
    # deja publicat. Ștergerea idempotentă a intervalelor cerute repară inclusiv
    # această fereastră numai dacă invariantul final nu este valid; o mapare
    # validă publicată concurent nu ne aparține și nu trebuie ștearsă.
    "${cleanup_command[@]}" "$user_name" || return 1
    validate_subid_path "$uid_file" && validate_subid_path "$gid_file" \
      && fsync_subid_path "$uid_file" && fsync_subid_path "$gid_file" \
      && fsync_subid_path "$etc_root" || return 1
    uid_final=$(validate_subid_map "$uid_file" "$user_name" allow-missing) || return 1
    gid_final=$(validate_subid_map "$gid_file" "$user_name" allow-missing) || return 1
    case "$uid_final" in valid|missing:[1-9][0-9]*) ;; *) return 1 ;; esac
    case "$gid_final" in valid|missing:[1-9][0-9]*) ;; *) return 1 ;; esac
  done
  return 1
}

secure_service_parent() {
  local path=$1 parent
  case "$path" in
    /var/lib/kelion-codex|/var/lib/kelion-publisher|/var/lib/kelion-release) ;;
    *) return 1 ;;
  esac
  parent=$(dirname -- "$path")
  [ -d "$parent" ] && [ ! -L "$parent" ] \
    && [ "$(realpath -e -- "$parent")" = "$parent" ] || return 1
  if [ -e "$path" ] || [ -L "$path" ]; then
    [ -d "$path" ] && [ ! -L "$path" ] \
      && [ "$(realpath -e -- "$path")" = "$path" ] || return 1
  else
    install -d -o root -g root -m 0711 "$path" || return 1
  fi
  chown root:root "$path" && chmod 0711 "$path" || return 1
  [ "$(stat -Lc '%u:%g:%a' "$path")" = '0:0:711' ] || return 1
  sync -f "$path" && sync -f "$parent"
}

ensure_service_writable_dir() {
  local path=$1 owner=$2 group=$3 parent
  parent=$(dirname -- "$path")
  [ -d "$parent" ] && [ ! -L "$parent" ] \
    && [ "$(realpath -e -- "$parent")" = "$parent" ] || return 1
  if [ -e "$path" ] || [ -L "$path" ]; then
    # Părintele direct este deja root-owned înaintea acestui test. Un symlink
    # legacy este refuzat, nu urmat de chown/chmod ca root.
    [ -d "$path" ] && [ ! -L "$path" ] \
      && [ "$(realpath -e -- "$path")" = "$path" ] || return 1
  else
    install -d -o "$owner" -g "$group" -m 0700 "$path" || return 1
  fi
  chown "$owner:$group" "$path" && chmod 0700 "$path" || return 1
  [ "$(stat -Lc '%U:%G:%a' "$path")" = "$owner:$group:700" ] || return 1
  sync -f "$path" && sync -f "$parent"
}

secure_handoff_spool() {
  local prefix=${1:-} var_lib=/var/lib spool child
  if [ -n "$prefix" ]; then
    [ -d "$prefix" ] && [ ! -L "$prefix" ] \
      && [ "$(realpath -e -- "$prefix")" = "$prefix" ] || return 1
    var_lib=$prefix/var/lib
  fi
  [ -d "$var_lib" ] && [ ! -L "$var_lib" ] \
    && [ "$(realpath -e -- "$var_lib")" = "$var_lib" ] \
    && [ "$(stat -Lc '%u:%g:%a' "$var_lib")" = '0:0:755' ] || return 1
  spool=$var_lib/kelion-constructor-handoff
  if [ -e "$spool" ] || [ -L "$spool" ]; then
    [ -d "$spool" ] && [ ! -L "$spool" ] \
      && [ "$(realpath -e -- "$spool")" = "$spool" ] \
      && [ "$(stat -Lc '%u' "$spool")" = 0 ] || return 1
  else
    install -d -o root -g kelion-handoff -m 0750 "$spool" || return 1
  fi

  # Retragem întâi dreptul de rename/create din părinte. Proprietarul root
  # verificat mai sus nu poate schimba modul concurent, iar descriptorii deja
  # deschiși ai membrilor grupului sunt supuși noului mod la fiecare operație.
  chmod 0750 "$spool" && chown root:kelion-handoff "$spool" || return 1
  [ "$(stat -Lc '%U:%G:%a' "$spool")" = 'root:kelion-handoff:750' ] || return 1
  sync -f "$spool" && sync -f "$var_lib" || return 1

  for child in ready ack retired; do
    child=$spool/$child
    if [ -e "$child" ] || [ -L "$child" ]; then
      # Numele este acum stabil sub părintele root-owned, non-group-writable.
      [ -d "$child" ] && [ ! -L "$child" ] \
        && [ "$(realpath -e -- "$child")" = "$child" ] || return 1
    else
      install -d -o root -g kelion-handoff -m 2770 "$child" || return 1
    fi
    chown root:kelion-handoff "$child" && chmod 2770 "$child" || return 1
    [ "$(stat -Lc '%U:%G:%a' "$child")" = 'root:kelion-handoff:2770' ] || return 1
    sync -f "$child" || return 1
  done
  sync -f "$spool"
}

ensure_group kelion-handoff
ensure_user kelion-codex /var/lib/kelion-codex
ensure_user kelion-publisher /var/lib/kelion-publisher
ensure_user kelion-release /var/lib/kelion-release
usermod -a -G kelion-handoff kelion-codex
usermod -a -G kelion-handoff kelion-publisher

install -d -o root -g root -m 0755 /opt/kelion-codex /opt/kelion-constructor /opt/kelion-constructor/lib
install -d -o root -g root -m 0755 /opt/kelion-codex/profile-home
secure_service_parent /var/lib/kelion-codex
secure_service_parent /var/lib/kelion-publisher
secure_service_parent /var/lib/kelion-release
ensure_service_writable_dir /var/lib/kelion-codex-auth kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-codex/jobs kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-codex/.cache kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-codex/.config kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-codex/.local kelion-codex kelion-codex
ensure_service_writable_dir /var/lib/kelion-publisher/state kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-publisher/.cache kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-publisher/.config kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-publisher/.local kelion-publisher kelion-publisher
ensure_service_writable_dir /var/lib/kelion-release/state kelion-release kelion-release
secure_handoff_spool
install -d -o root -g root -m 0755 /etc/kelion
[ -d /etc/kelion ] && [ ! -L /etc/kelion ] \
  && [ "$(stat -c '%u:%g:%a' /etc/kelion)" = '0:0:755' ]
sync -f /etc/kelion
sync -f /etc
install -d -o root -g root -m 0755 "$ROOT/bin"
install -d -o root -g 10050 -m 0750 "$ROOT/config" "$RUNTIME_ROOT"

constructor_timers=(kelion-codex-worker.timer kelion-constructor-publisher.timer kelion-constructor-release.timer)
constructor_services=(kelion-codex-worker.service kelion-constructor-publisher.service kelion-constructor-release.service)
constructor_markers=(/etc/kelion/codex-worker.enabled /etc/kelion/constructor-publisher.enabled /etc/kelion/constructor-release.enabled)
install_logicals=(
  artifact.codex-worker
  artifact.codex-sandbox-probe
  artifact.codex-worker-profile
  artifact.constructor-publisher
  artifact.constructor-release
  artifact.github-askpass
  artifact.constructor-sync-worker
  artifact.constructor-service-client
  artifact.github-fixed-client
  runtime-helper
  compose-production
  systemd-recovery.kelion-runtime-config-recovery.service
  systemd-sync.kelion-constructor-sync.service
  systemd-timer.kelion-codex-worker.timer
  systemd-timer.kelion-constructor-publisher.timer
  systemd-timer.kelion-constructor-release.timer
  systemd-service.kelion-codex-worker.service
  systemd-service.kelion-constructor-publisher.service
  systemd-service.kelion-constructor-release.service
)
install_sources=(
  "$repo_root/deploy/codex-worker.mjs"
  "$repo_root/deploy/codex-sandbox-probe.mjs"
  "$repo_root/deploy/codex-worker.profile.toml"
  "$repo_root/deploy/constructor-publisher.mjs"
  "$repo_root/deploy/constructor-release.mjs"
  "$repo_root/deploy/github-askpass.sh"
  "$repo_root/deploy/constructor-sync-worker.sh"
  "$repo_root/deploy/lib/constructor-service-client.mjs"
  "$repo_root/deploy/lib/github-fixed-client.mjs"
  "$repo_root/deploy/lib/runtime-config-cutover.sh"
  "$repo_root/deploy/compose.production.yml"
  "$repo_root/deploy/systemd/kelion-runtime-config-recovery.service"
  "$repo_root/deploy/systemd/kelion-constructor-sync.service"
  "$repo_root/deploy/systemd/kelion-codex-worker.timer"
  "$repo_root/deploy/systemd/kelion-constructor-publisher.timer"
  "$repo_root/deploy/systemd/kelion-constructor-release.timer"
  "$repo_root/deploy/systemd/kelion-codex-worker.service"
  "$repo_root/deploy/systemd/kelion-constructor-publisher.service"
  "$repo_root/deploy/systemd/kelion-constructor-release.service"
)

map_install_logical() {
  local logical=$1
  install_owner=root
  install_group=root
  case "$logical" in
    artifact.codex-worker) install_target=/opt/kelion-codex/codex-worker.mjs; install_mode=555 ;;
    artifact.codex-sandbox-probe) install_target=/opt/kelion-codex/codex-sandbox-probe.mjs; install_mode=444 ;;
    artifact.codex-worker-profile) install_target=/opt/kelion-codex/profile-home/kelion-worker.config.toml; install_mode=444 ;;
    artifact.constructor-publisher) install_target=/opt/kelion-constructor/constructor-publisher.mjs; install_mode=555 ;;
    artifact.constructor-release) install_target=/opt/kelion-constructor/constructor-release.mjs; install_mode=555 ;;
    artifact.github-askpass) install_target=/opt/kelion-constructor/github-askpass.sh; install_mode=555 ;;
    artifact.constructor-sync-worker) install_target=/opt/kelion-constructor/constructor-sync-worker.sh; install_mode=555 ;;
    artifact.constructor-service-client) install_target=/opt/kelion-constructor/lib/constructor-service-client.mjs; install_mode=444 ;;
    artifact.github-fixed-client) install_target=/opt/kelion-constructor/lib/github-fixed-client.mjs; install_mode=444 ;;
    runtime-helper) install_target=$ROOT/bin/runtime-config-cutover.sh; install_mode=500 ;;
    compose-production) install_target=$ROOT/config/compose.production.yml; install_mode=444 ;;
    systemd-recovery.kelion-runtime-config-recovery.service) install_target=/etc/systemd/system/kelion-runtime-config-recovery.service; install_mode=444 ;;
    systemd-sync.kelion-constructor-sync.service) install_target=/etc/systemd/system/kelion-constructor-sync.service; install_mode=444 ;;
    systemd-timer.*) install_target=/etc/systemd/system/${logical#systemd-timer.}; install_mode=444 ;;
    systemd-service.*) install_target=/etc/systemd/system/${logical#systemd-service.}; install_mode=444 ;;
    *) return 1 ;;
  esac
}

current_source_sha256() {
  local index
  {
    for index in "${!install_logicals[@]}"; do
      [ -f "${install_sources[$index]}" ] && [ ! -L "${install_sources[$index]}" ] || return 1
      printf '%s\t%s\n' "${install_logicals[$index]}" \
        "$(sha256sum "${install_sources[$index]}" | awk '{print $1}')"
    done
  } | sha256sum | awk '{print $1}'
}

write_install_journal() {
  local phase=$1 temporary
  temporary=$(mktemp "$RUNTIME_ROOT/.constructor-install-journal.XXXXXX")
  jq -cn \
    --arg phase "$phase" \
    --arg requestId "$install_request_id" \
    --arg commit "$install_commit" \
    --arg transactionRoot "$install_root" \
    --arg manifestSha256 "$install_manifest_sha256" \
    --arg sourceSha256 "$install_source_sha256" \
    '{schema:1,kind:"constructor-install",phase:$phase,requestId:$requestId,commit:$commit,
      transactionRoot:$transactionRoot,manifestSha256:$manifestSha256,sourceSha256:$sourceSha256}' > "$temporary"
  chown root:root "$temporary"
  chmod 0600 "$temporary"
  sync -f "$temporary"
  mv -f -- "$temporary" "$INSTALL_JOURNAL"
  sync -f "$RUNTIME_ROOT"
}

stage_install_transaction() {
  local index logical digest
  install_source_sha256=$(current_source_sha256)
  [[ "$install_source_sha256" =~ ^[0-9a-f]{64}$ ]]
  install_commit=${install_source_sha256:0:40}
  install_request_id=$(tr 'A-F' 'a-f' < /proc/sys/kernel/random/uuid)
  [[ "$install_request_id" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$ ]]
  install_root=$(mktemp -d "$RUNTIME_ROOT/constructor-install.XXXXXX")
  chown root:root "$install_root"
  chmod 0700 "$install_root"
  install -d -o root -g root -m 0700 "$install_root/files"
  : > "$install_root/manifest"
  chown root:root "$install_root/manifest"
  chmod 0600 "$install_root/manifest"
  for index in "${!install_logicals[@]}"; do
    logical=${install_logicals[$index]}
    install -o root -g root -m 0600 "${install_sources[$index]}" "$install_root/files/$logical"
    digest=$(sha256sum "$install_root/files/$logical" | awk '{print $1}')
    printf '%s\t%s\n' "$logical" "$digest" >> "$install_root/manifest"
    sync -f "$install_root/files/$logical"
  done
  sync -f "$install_root/manifest"
  sync -f "$install_root/files"
  sync -f "$install_root"
  install_manifest_sha256=$(sha256sum "$install_root/manifest" | awk '{print $1}')
  write_install_journal armed
}

load_install_transaction() {
  local index=0 logical digest extra candidate
  [ -f "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] \
    && [ "$(stat -c '%u:%g:%a' "$INSTALL_JOURNAL")" = '0:0:600' ] || return 1
  jq -e '.schema == 1 and .kind == "constructor-install" and
    (.phase == "armed" or .phase == "quiesced") and
    (.requestId | strings | test("^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")) and
    (.commit | strings | test("^[0-9a-f]{40}$")) and
    (.transactionRoot | strings | test("^/root/kelion/runtime/constructor-install\\.[A-Za-z0-9]+$")) and
    (.manifestSha256 | strings | test("^[0-9a-f]{64}$")) and
    (.sourceSha256 | strings | test("^[0-9a-f]{64}$"))' "$INSTALL_JOURNAL" >/dev/null || return 1
  install_request_id=$(jq -er '.requestId' "$INSTALL_JOURNAL")
  install_commit=$(jq -er '.commit' "$INSTALL_JOURNAL")
  install_root=$(jq -er '.transactionRoot' "$INSTALL_JOURNAL")
  install_manifest_sha256=$(jq -er '.manifestSha256' "$INSTALL_JOURNAL")
  install_source_sha256=$(jq -er '.sourceSha256' "$INSTALL_JOURNAL")
  [ "${install_source_sha256:0:40}" = "$install_commit" ] || return 1
  [ -d "$install_root" ] && [ ! -L "$install_root" ] \
    && [ "$(realpath -e -- "$install_root")" = "$install_root" ] \
    && [ "$(stat -c '%u:%g:%a' "$install_root")" = '0:0:700' ] || return 1
  [ -d "$install_root/files" ] && [ ! -L "$install_root/files" ] \
    && [ "$(stat -c '%u:%g:%a' "$install_root/files")" = '0:0:700' ] || return 1
  [ -f "$install_root/manifest" ] && [ ! -L "$install_root/manifest" ] \
    && [ "$(stat -c '%u:%g:%a' "$install_root/manifest")" = '0:0:600' ] \
    && [ "$(sha256sum "$install_root/manifest" | awk '{print $1}')" = "$install_manifest_sha256" ] || return 1
  while IFS=$'\t' read -r logical digest extra; do
    [ "$index" -lt "${#install_logicals[@]}" ] && [ -z "$extra" ] \
      && [ "$logical" = "${install_logicals[$index]}" ] \
      && [[ "$digest" =~ ^[0-9a-f]{64}$ ]] || return 1
    candidate=$install_root/files/$logical
    [ -f "$candidate" ] && [ ! -L "$candidate" ] \
      && [ "$(stat -c '%u:%g:%a' "$candidate")" = '0:0:600' ] \
      && [ "$(sha256sum "$candidate" | awk '{print $1}')" = "$digest" ] || return 1
    index=$((index + 1))
  done < "$install_root/manifest"
  [ "$index" -eq "${#install_logicals[@]}" ]
}

publish_install_candidate() {
  local logical=$1 candidate=$install_root/files/$1
  map_install_logical "$logical"
  install_atomic "$candidate" "$install_target" "$install_owner" "$install_group" "$install_mode"
  [ "$(stat -c '%u:%g:%a' "$install_target")" = "0:0:$install_mode" ]
  cmp -s -- "$candidate" "$install_target"
}

validate_published_candidate() {
  local logical=$1 candidate=$install_root/files/$1
  map_install_logical "$logical"
  [ -f "$install_target" ] && [ ! -L "$install_target" ] \
    && [ "$(stat -c '%u:%g:%a' "$install_target")" = "0:0:$install_mode" ] \
    && cmp -s -- "$candidate" "$install_target"
}

verify_candidate_units() {
  local verify_root=$install_root/verify index result=0 verify_help
  local -a verify_logicals=(
    systemd-recovery.kelion-runtime-config-recovery.service
    systemd-sync.kelion-constructor-sync.service
    systemd-timer.kelion-codex-worker.timer
    systemd-timer.kelion-constructor-publisher.timer
    systemd-timer.kelion-constructor-release.timer
    systemd-service.kelion-codex-worker.service
    systemd-service.kelion-constructor-publisher.service
    systemd-service.kelion-constructor-release.service
  )
  local -a verify_names=(
    kelion-runtime-config-recovery.service
    kelion-constructor-sync.service
    kelion-codex-worker.timer
    kelion-constructor-publisher.timer
    kelion-constructor-release.timer
    kelion-codex-worker.service
    kelion-constructor-publisher.service
    kelion-constructor-release.service
  )
  local -a verify_paths=()

  verify_help=$(systemd-analyze verify --help 2>&1) || return 1
  grep -q -- '--recursive-errors=' <<<"$verify_help" \
    || { echo 'systemd-analyze nu poate valida recursiv dependențele candidate' >&2; return 1; }
  if [ -e "$verify_root" ] || [ -L "$verify_root" ]; then
    [ -d "$verify_root" ] && [ ! -L "$verify_root" ] \
      && [ "$(stat -c '%u:%g:%a' "$verify_root")" = '0:0:700' ] || return 1
  else
    install -d -o root -g root -m 0700 "$verify_root"
  fi
  for index in "${!verify_logicals[@]}"; do
    verify_paths+=("$verify_root/${verify_names[$index]}")
    install_atomic "$install_root/files/${verify_logicals[$index]}" \
      "${verify_paths[$index]}" root root 0600
    cmp -s -- "${verify_paths[$index]}" "$install_root/files/${verify_logicals[$index]}"
  done
  # Toată tupla este încărcată într-un singur namespace candidat, sub numele
  # systemd reale. Astfel Unit=/Requires=/After nu se pot rezolva accidental
  # la generația live veche și orice dependență lipsă devine eroare.
  if ! systemd-analyze verify --recursive-errors=yes "${verify_paths[@]}"; then result=1; fi
  for index in "${!verify_paths[@]}"; do rm -f -- "${verify_paths[$index]}"; done
  sync -f "$verify_root"
  rmdir -- "$verify_root"
  sync -f "$install_root"
  return "$result"
}

validate_effective_installed_unit() {
  local unit=$1 expected=/etc/systemd/system/$1 fragment dropins load_state need_reload
  fragment=$(systemctl show "$unit" --property=FragmentPath --value) || return 1
  dropins=$(systemctl show "$unit" --property=DropInPaths --value) || return 1
  load_state=$(systemctl show "$unit" --property=LoadState --value) || return 1
  need_reload=$(systemctl show "$unit" --property=NeedDaemonReload --value) || return 1
  [ "$fragment" = "$expected" ] && [ -z "$dropins" ] \
    && [ "$load_state" = loaded ] && [ "$need_reload" = no ]
}

retract_ready_stamp() {
  if [ ! -e "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ]; then return 0; fi
  [ -d "$READY_ROOT" ] && [ ! -L "$READY_ROOT" ] \
    && [ "$(stat -c '%u:%g:%a' "$READY_ROOT")" = '0:0:755' ] || return 1
  if [ -e "$READY_STAMP" ] || [ -L "$READY_STAMP" ]; then
    if [ -d "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ]; then
      rmdir -- "$READY_STAMP" || return 1
    else
      rm -f -- "$READY_STAMP" || return 1
    fi
    sync -f "$READY_ROOT"
  fi
}

quiesce_before_install() {
  local unit state count=0 failed=0
  retract_ready_stamp || failed=1
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    if systemctl cat "$unit" >/dev/null 2>&1; then
      count=$((count + 1))
      systemctl disable --now "$unit" >/dev/null || failed=1
    fi
  done
  for unit in kelion-constructor-sync.service kelion-runtime-config-recovery.service; do
    if systemctl cat "$unit" >/dev/null 2>&1; then systemctl stop "$unit" >/dev/null || failed=1; fi
  done
  case "$count" in 0|6) ;; *) failed=1 ;; esac
  for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    state=$(systemctl show "$unit" --property=ActiveState --value) || { failed=1; continue; }
    case "$state" in inactive|failed) ;; *) failed=1 ;; esac
    if systemctl is-enabled --quiet "$unit"; then failed=1; fi
    [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ] || failed=1
  done
  for unit in kelion-constructor-sync.service kelion-runtime-config-recovery.service; do
    systemctl cat "$unit" >/dev/null 2>&1 || continue
    state=$(systemctl show "$unit" --property=ActiveState --value) || { failed=1; continue; }
    case "$state" in inactive|failed) ;; *) failed=1 ;; esac
    [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ] || failed=1
  done
  [ "$failed" = 0 ]
}

clear_install_transaction() {
  local logical
  [ -f "$INSTALL_JOURNAL" ] && [ ! -L "$INSTALL_JOURNAL" ] || return 1
  rm -f -- "$INSTALL_JOURNAL"
  sync -f "$RUNTIME_ROOT"
  for logical in "${install_logicals[@]}"; do rm -f -- "$install_root/files/$logical"; done
  rm -f -- "$install_root/manifest"
  rmdir -- "$install_root/files"
  rmdir -- "$install_root"
}

# Un jurnal runtime existent este consumat de helperul exact care l-a creat,
# sub același lock, înainte ca acel helper să poată fi înlocuit.
if [ -e "$RUNTIME_ROOT/runtime-config-cutover.journal" ] || [ -L "$RUNTIME_ROOT/runtime-config-cutover.journal" ]; then
  [ -f "$ROOT/bin/runtime-config-cutover.sh" ] && [ ! -L "$ROOT/bin/runtime-config-cutover.sh" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/bin/runtime-config-cutover.sh")" = '0:0:500' ]
  [ -f "$ROOT/config/compose.production.yml" ] && [ ! -L "$ROOT/config/compose.production.yml" ] \
    && [ "$(stat -c '%u:%g:%a' "$ROOT/config/compose.production.yml")" = '0:0:444' ]
  KELION_CUTOVER_LOCK_HELD=1 "$ROOT/bin/runtime-config-cutover.sh" \
    --recover-only "$ROOT/config/compose.production.yml" --leave-constructor-quiesced
fi
for journal in "$RUNTIME_ROOT/constructor-activation.journal" "$RUNTIME_ROOT/constructor-gate-refresh.journal"; do
  [ ! -e "$journal" ] && [ ! -L "$journal" ] \
    || { echo "recovery Constructor activ; instalarea este refuzată: $journal" >&2; exit 1; }
done

install_root=''
install_request_id=''
install_commit=''
install_manifest_sha256=''
install_source_sha256=''
resume_different_source=0
if [ -e "$INSTALL_JOURNAL" ] || [ -L "$INSTALL_JOURNAL" ]; then
  load_install_transaction \
    || { echo 'jurnalul de instalare/deploy existent nu este un intent Constructor autentic' >&2; exit 1; }
  current_source=$(current_source_sha256)
  if [ "$current_source" != "$install_source_sha256" ]; then resume_different_source=1; fi
else
  stage_install_transaction
fi

# Intentul root-only și candidații cu hash sunt durabili înainte de prima oprire
# ori mutație live. Boot recovery recunoaște jurnalul schema 1 și nu poate
# republica stamp-ul fără owner; retry-ul rescrie toată generația din candidați.
quiesce_before_install \
  || { echo 'unitățile Constructor nu pot fi dovedite complet quiesced' >&2; exit 1; }
write_install_journal quiesced
# /etc/subuid și /etc/subgid nu pot fi comise printr-un singur rename. Le
# publicăm numai după intentul durabil și quiesce: un crash între fișiere lasă
# jurnalul prezent, ready retras și toate unitățile oprite până la retry.
ensure_subids kelion-codex
ensure_subids kelion-publisher
rm -f -- "${constructor_markers[@]}"
sync -f /etc/kelion
for marker in "${constructor_markers[@]}"; do
  [ ! -e "$marker" ] && [ ! -L "$marker" ] || { echo "markerul nu a putut fi retras: $marker" >&2; exit 1; }
done

for logical in \
  artifact.codex-worker artifact.codex-sandbox-probe artifact.codex-worker-profile \
  artifact.constructor-publisher artifact.constructor-release artifact.github-askpass \
  artifact.constructor-sync-worker artifact.constructor-service-client artifact.github-fixed-client \
  runtime-helper compose-production; do
  publish_install_candidate "$logical"
done

verify_candidate_units \
  || { echo 'tupla systemd Constructor candidată este invalidă' >&2; exit 1; }

# Cele șase unități-capabilitate sunt publicate exclusiv prin tranzacția
# unit-only jurnalizată. Bariera pending rămâne după succes și poate fi
# consumată numai de cutover-ul mixt care validează noul runtime.env.
unit_stage=$(mktemp -d "$RUNTIME_ROOT/runtime-cutover.XXXXXX")
chown root:root "$unit_stage"
chmod 0700 "$unit_stage"
install -d -o root -g root -m 0700 "$unit_stage/files"
: > "$unit_stage/manifest"
chown root:root "$unit_stage/manifest"
chmod 0600 "$unit_stage/manifest"
for unit in "${constructor_timers[@]}"; do
  install -o root -g root -m 0600 "$install_root/files/systemd-timer.$unit" "$unit_stage/files/systemd-timer.$unit"
  printf '%s\n' "systemd-timer.$unit" >> "$unit_stage/manifest"
done
for unit in "${constructor_services[@]}"; do
  install -o root -g root -m 0600 "$install_root/files/systemd-service.$unit" "$unit_stage/files/systemd-service.$unit"
  printf '%s\n' "systemd-service.$unit" >> "$unit_stage/manifest"
done
KELION_CUTOVER_LOCK_HELD=1 \
KELION_DEPLOY_QUIESCE_OWNER_REQUEST_ID="$install_request_id" \
KELION_DEPLOY_QUIESCE_OWNER_COMMIT="$install_commit" \
  "$ROOT/bin/runtime-config-cutover.sh" \
    "$unit_stage" "$ROOT/config/compose.production.yml" --leave-constructor-quiesced

publish_install_candidate systemd-recovery.kelion-runtime-config-recovery.service
publish_install_candidate systemd-sync.kelion-constructor-sync.service
systemctl daemon-reload
for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
  systemctl disable --now "$unit" >/dev/null
done
systemctl enable kelion-runtime-config-recovery.service >/dev/null
recovery_wants_dir=/etc/systemd/system/multi-user.target.wants
recovery_wants_link=$recovery_wants_dir/kelion-runtime-config-recovery.service
[ -d "$recovery_wants_dir" ] && [ ! -L "$recovery_wants_dir" ]
[ -L "$recovery_wants_link" ] \
  && [ "$(readlink "$recovery_wants_link")" = /etc/systemd/system/kelion-runtime-config-recovery.service ] \
  && [ "$(realpath -e -- "$recovery_wants_link")" = /etc/systemd/system/kelion-runtime-config-recovery.service ]
sync -f "$recovery_wants_dir"
sync -f /etc/systemd/system

for logical in "${install_logicals[@]}"; do validate_published_candidate "$logical"; done
for unit in \
  kelion-runtime-config-recovery.service kelion-constructor-sync.service \
  "${constructor_timers[@]}" "${constructor_services[@]}"; do
  validate_effective_installed_unit "$unit"
done
systemctl is-enabled --quiet kelion-runtime-config-recovery.service
for marker in "${constructor_markers[@]}"; do [ ! -e "$marker" ] && [ ! -L "$marker" ]; done
[ ! -e "$READY_STAMP" ] && [ ! -L "$READY_STAMP" ]
[ -f "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
  && [ ! -L "$RUNTIME_ROOT/constructor-unit-migration.pending" ] \
  && [ "$(stat -c '%u:%g:%a' "$RUNTIME_ROOT/constructor-unit-migration.pending")" = '0:0:600' ] \
  && grep -qx 'schema=1' "$RUNTIME_ROOT/constructor-unit-migration.pending"
for unit in "${constructor_timers[@]}" "${constructor_services[@]}"; do
  state=$(systemctl show "$unit" --property=ActiveState --value)
  case "$state" in inactive|failed) ;; *) exit 1 ;; esac
  if systemctl is-enabled --quiet "$unit"; then exit 1; fi
  [ -z "$(systemctl list-jobs --no-legend --plain "$unit" 2>/dev/null)" ]
done

clear_install_transaction
if [ "$resume_different_source" = 1 ]; then
  echo 'Intentul întrerupt a fost finalizat fail-closed; se aplică acum checkoutul curent.'
  exec env KELION_CONSTRUCTOR_INSTALL=1 KELION_CUTOVER_LOCK_HELD=1 bash "$repo_root/deploy/instaleaza-constructor.sh"
fi
echo 'Constructor instalat dezactivat; configurarea și activarea sunt etape separate.'
