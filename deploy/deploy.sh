#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf 'release: %s\n' "$1" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "lipsește utilitarul $1"; }

[ "$(id -u)" -eq 0 ] || die 'rulează numai ca root pe gazda de release'
[ "${KELION_RELEASE_APPROVED:-0}" = 1 ] || die 'lipsește aprobarea explicită de release'
[[ "${KELION_CI_RUN_ID:-}" =~ ^[0-9]+$ ]] || die 'dovada CI este invalidă'
[[ "${KELION_BUILD_RUN_ID:-}" =~ ^[0-9]+$ ]] || die 'dovada build-ului este invalidă'

COMMIT_SHA=${1:-}
MANIFEST_FILE=${2:-}
RELEASE_MODE=${3:-release}
[[ "$COMMIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die 'commitul trebuie să fie SHA integral'
[[ "$RELEASE_MODE" = release || "$RELEASE_MODE" = rollback ]] || die 'modul release este invalid'
[ -f "$MANIFEST_FILE" ] || die 'manifestul OCI lipsește'

need docker
need curl
need jq
need flock
need openssl
need python3
need crontab
need systemctl
need systemd-analyze
need readlink
need stat

ROOT=/root/kelion
BUNDLE_DIR=$(cd -- "$(dirname -- "$0")" && pwd -P)
PRODUCT_FILE=$BUNDLE_DIR/../config/product.json
COMPOSE_FILE=$BUNDLE_DIR/compose.production.yml
PROXY_COMPOSE_FILE=$BUNDLE_DIR/compose.proxy.yml
CONFIG_FILE=$ROOT/config/runtime.env
SECRET_ROOT=$ROOT/secrets
RUNTIME_ROOT=$ROOT/runtime
RELEASE_STATE_ROOT=$RUNTIME_ROOT/release-state
PROXY_CONFIG_ROOT=$ROOT/proxy
PROXY_STATE_ROOT=$ROOT/proxy-state
COMPOSE_BIN=$ROOT/bin/docker-compose
SECCOMP_PROFILE=$RUNTIME_ROOT/playwright-seccomp-v1.62.1.json
PROOF_FILE=$RUNTIME_ROOT/last-verified-backup.json
PROOF_KEY=$SECRET_ROOT/migration-backup-proof-key
migration_proof_copy=''
PUBLICATION_LOCK=$ROOT/publicare.lock
RECOVERY_JOURNAL=$RUNTIME_ROOT/destructive-cutover-recovery.json
BACKUP_INSTALL_ROOT=/opt/kelion-backup
BACKUP_RELEASE_ROOT=$BACKUP_INSTALL_ROOT/releases
PERSISTENT_BACKUP_SCRIPT=$BACKUP_RELEASE_ROOT/$COMMIT_SHA/backup.sh
BACKUP_CURRENT_LINK=$BACKUP_INSTALL_ROOT/current
BACKUP_SERVICE=kelion-backup.service
BACKUP_TIMER=kelion-backup.timer
SYSTEMD_UNIT_ROOT=/etc/systemd/system
LEGACY_BACKUP_CRON='0 3 * * 0 /root/kelion/backup.sh >> /root/kelion/backup.log 2>&1'
LEGACY_BACKUP_CRON_MARKER=$RUNTIME_ROOT/legacy-backup-cron-retired

# Starea schedulerului este capturată chiar înainte de cutover. Orice eroare
# ulterioară smoke-ului public trebuie să poată restaura atomic selectorul,
# unitățile, starea timerului și crontabul, nu doar traficul aplicației.
backup_schedule_snapshot_dir=''
backup_schedule_mutating=0
backup_schedule_timer_touched=0
backup_previous_current_present=0
backup_previous_service_present=0
backup_previous_timer_present=0
backup_previous_marker_present=0
backup_previous_timer_enabled=0
backup_previous_timer_active=0

for file in "$PRODUCT_FILE" "$COMPOSE_FILE" "$PROXY_COMPOSE_FILE" "$BUNDLE_DIR/Caddyfile" \
  "$BUNDLE_DIR/backup.sh" "$BUNDLE_DIR/restore-verified-backup.sh" \
  "$BUNDLE_DIR/vps-curatenie.sh" \
  "$BUNDLE_DIR/lib/restore-verified-backup.mjs" \
  "$BUNDLE_DIR/systemd/$BACKUP_SERVICE" "$BUNDLE_DIR/systemd/$BACKUP_TIMER"; do
  [ -f "$file" ] || die "bundle incomplet: $(basename "$file")"
done

install_cleanup_script() {
  local candidate
  candidate=$(mktemp "$ROOT/vps-curatenie.XXXXXX")
  if ! install -o root -g root -m 0700 "$BUNDLE_DIR/vps-curatenie.sh" "$candidate" \
    || ! cmp -s -- "$BUNDLE_DIR/vps-curatenie.sh" "$candidate" \
    || [ "$(stat -Lc '%u:%g:%a:%h' "$candidate")" != '0:0:700:1' ]; then
    rm -f -- "$candidate"
    die 'scriptul de curățenie nu poate fi pregătit exact'
  fi
  mv -f -- "$candidate" "$ROOT/vps-curatenie.sh"
  [ -f "$ROOT/vps-curatenie.sh" ] && [ ! -L "$ROOT/vps-curatenie.sh" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$ROOT/vps-curatenie.sh")" = '0:0:700:1' ] \
    && cmp -s -- "$BUNDLE_DIR/vps-curatenie.sh" "$ROOT/vps-curatenie.sh" \
    || die 'scriptul de curățenie instalat diferă de bundle'
}

install_persistent_backup_script() {
  local candidate
  install -d -o root -g root -m 0755 \
    "$BACKUP_INSTALL_ROOT" "$BACKUP_RELEASE_ROOT" "$BACKUP_RELEASE_ROOT/$COMMIT_SHA"
  candidate=$(mktemp "$BACKUP_RELEASE_ROOT/$COMMIT_SHA/backup.XXXXXX")
  install -o root -g root -m 0700 "$BUNDLE_DIR/backup.sh" "$candidate"
  mv -f -- "$candidate" "$PERSISTENT_BACKUP_SCRIPT"
  [ "$(stat -c '%u:%g:%a' "$PERSISTENT_BACKUP_SCRIPT")" = '0:0:700' ] \
    || die 'scriptul persistent de backup are ACL invalid'
  cmp -s "$BUNDLE_DIR/backup.sh" "$PERSISTENT_BACKUP_SCRIPT" \
    || die 'scriptul persistent de backup diferă de bundle'
}

activate_persistent_backup_script() {
  local candidate_link
  [ -x "$PERSISTENT_BACKUP_SCRIPT" ] \
    || die 'candidatul persistent de backup nu este executabil'
  candidate_link=$(mktemp "$BACKUP_INSTALL_ROOT/current.XXXXXX")
  rm -f -- "$candidate_link"
  ln -s "releases/$COMMIT_SHA" "$candidate_link"
  mv -Tf -- "$candidate_link" "$BACKUP_CURRENT_LINK"
  [ "$(readlink "$BACKUP_CURRENT_LINK")" = "releases/$COMMIT_SHA" ] \
    || die 'selectorul current al backupului nu confirmă commitul candidat'
}

install_backup_schedule() {
  local unit candidate next_run
  systemd-analyze verify \
    "$BUNDLE_DIR/systemd/$BACKUP_SERVICE" \
    "$BUNDLE_DIR/systemd/$BACKUP_TIMER" >/dev/null
  for unit in "$BACKUP_SERVICE" "$BACKUP_TIMER"; do
    candidate=$(mktemp "$SYSTEMD_UNIT_ROOT/$unit.XXXXXX")
    install -o root -g root -m 0444 "$BUNDLE_DIR/systemd/$unit" "$candidate"
    mv -f -- "$candidate" "$SYSTEMD_UNIT_ROOT/$unit"
    cmp -s "$BUNDLE_DIR/systemd/$unit" "$SYSTEMD_UNIT_ROOT/$unit" \
      || die "unitatea persistentă $unit diferă de bundle"
  done
  systemctl daemon-reload
  backup_schedule_timer_touched=1
  systemctl enable --now "$BACKUP_TIMER" >/dev/null
  systemctl is-enabled --quiet "$BACKUP_TIMER" \
    || die 'timerul persistent de backup nu este enabled'
  systemctl is-active --quiet "$BACKUP_TIMER" \
    || die 'timerul persistent de backup nu este activ'
  next_run=$(systemctl show "$BACKUP_TIMER" --property=NextElapseUSecRealtime --value)
  [ -n "$next_run" ] && [ "$next_run" != n/a ] \
    || die 'timerul persistent de backup nu are următoarea rulare programată'
}

retire_legacy_backup_cron() (
  set -euo pipefail
  local work before after observed count marker_candidate backup_copy
  work=$(mktemp -d "$RUNTIME_ROOT/backup-cron-cutover.XXXXXX")
  trap 'rm -rf -- "$work"' EXIT
  before=$work/before
  after=$work/after
  observed=$work/observed
  crontab -u root -l > "$before" 2>/dev/null \
    || die 'crontabul root legacy nu poate fi citit'
  count=$(awk -v target="$LEGACY_BACKUP_CRON" '$0 == target { count += 1 } END { print count + 0 }' "$before")
  if [ "$count" -eq 0 ]; then
    [ -s "$LEGACY_BACKUP_CRON_MARKER" ] \
      || die 'cronul legacy lipsește fără dovada retragerii anterioare'
    return 0
  fi
  [ "$count" -eq 1 ] || die 'cronul legacy de backup nu apare exact o dată'

  awk -v target="$LEGACY_BACKUP_CRON" '$0 != target' "$before" > "$after"
  ! grep -Fqx -- "$LEGACY_BACKUP_CRON" "$after" \
    || die 'filtrarea cronului legacy nu a eliminat ținta exactă'
  backup_copy=$RUNTIME_ROOT/root-crontab.before-backup-timer.$COMMIT_SHA
  install -o root -g root -m 0600 "$before" "$backup_copy"
  crontab -u root "$after"
  crontab -u root -l > "$observed" 2>/dev/null \
    || { crontab -u root "$before"; die 'crontabul root nu poate fi verificat după instalare'; }
  if ! cmp -s "$after" "$observed"; then
    crontab -u root "$before"
    die 'alte linii cron s-au schimbat; crontabul original a fost restaurat'
  fi

  marker_candidate=$(mktemp "$RUNTIME_ROOT/legacy-backup-cron-retired.XXXXXX")
  printf 'schema=1 commit=%s backup=%s\n' "$COMMIT_SHA" "$(basename "$backup_copy")" > "$marker_candidate"
  chown root:root "$marker_candidate"
  chmod 0600 "$marker_candidate"
  mv -f -- "$marker_candidate" "$LEGACY_BACKUP_CRON_MARKER"
)

snapshot_backup_schedule() {
  local state
  [ -z "$backup_schedule_snapshot_dir" ] \
    || die 'snapshotul schedulerului de backup a fost deja creat'
  backup_schedule_snapshot_dir=$(mktemp -d "$RUNTIME_ROOT/backup-schedule-rollback.XXXXXX")
  chmod 0700 "$backup_schedule_snapshot_dir"

  if [ -e "$BACKUP_CURRENT_LINK" ] || [ -L "$BACKUP_CURRENT_LINK" ]; then
    [ -L "$BACKUP_CURRENT_LINK" ] \
      || die 'selectorul current existent nu este symlink'
    readlink "$BACKUP_CURRENT_LINK" > "$backup_schedule_snapshot_dir/current-target"
    [ -s "$backup_schedule_snapshot_dir/current-target" ] \
      || die 'selectorul current existent are țintă invalidă'
    backup_previous_current_present=1
  fi

  if [ -e "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] || [ -L "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ]; then
    [ -f "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] && [ ! -L "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" ] \
      || die 'unitatea service existentă nu este fișier regulat'
    cp --preserve=mode,ownership,timestamps -- \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" "$backup_schedule_snapshot_dir/$BACKUP_SERVICE"
    backup_previous_service_present=1
  fi
  if [ -e "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] || [ -L "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ]; then
    [ -f "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] && [ ! -L "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" ] \
      || die 'unitatea timer existentă nu este fișier regulat'
    cp --preserve=mode,ownership,timestamps -- \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" "$backup_schedule_snapshot_dir/$BACKUP_TIMER"
    backup_previous_timer_present=1
  fi

  if systemctl is-enabled --quiet "$BACKUP_TIMER"; then
    backup_previous_timer_enabled=1
  else
    if state=$(systemctl is-enabled "$BACKUP_TIMER" 2>/dev/null); then
      die 'starea enabled a timerului s-a schimbat în timpul snapshotului'
    fi
    case "$state" in
      disabled | static | not-found) ;;
      *) die "starea enabled a timerului existent nu poate fi capturată: $state" ;;
    esac
  fi
  if systemctl is-active --quiet "$BACKUP_TIMER"; then
    backup_previous_timer_active=1
  else
    if state=$(systemctl is-active "$BACKUP_TIMER" 2>/dev/null); then
      die 'starea active a timerului s-a schimbat în timpul snapshotului'
    fi
    case "$state" in
      inactive | failed | unknown) ;;
      *) die "starea active a timerului existent nu poate fi capturată: $state" ;;
    esac
  fi
  if [ "$backup_previous_timer_enabled" = 1 ] || [ "$backup_previous_timer_active" = 1 ]; then
    [ "$backup_previous_service_present" = 1 ] \
      && [ "$backup_previous_timer_present" = 1 ] \
      && [ "$backup_previous_current_present" = 1 ] \
      || die 'timerul existent rulează fără artefactele rollback capturabile'
  fi

  crontab -u root -l > "$backup_schedule_snapshot_dir/root-crontab" 2>/dev/null \
    || die 'crontabul root nu poate fi capturat pentru rollback'
  chmod 0600 "$backup_schedule_snapshot_dir/root-crontab"

  if [ -e "$LEGACY_BACKUP_CRON_MARKER" ] || [ -L "$LEGACY_BACKUP_CRON_MARKER" ]; then
    [ -f "$LEGACY_BACKUP_CRON_MARKER" ] && [ ! -L "$LEGACY_BACKUP_CRON_MARKER" ] \
      || die 'markerul retragerii cronului nu este fișier regulat'
    cp --preserve=mode,ownership,timestamps -- \
      "$LEGACY_BACKUP_CRON_MARKER" "$backup_schedule_snapshot_dir/legacy-cron-marker"
    backup_previous_marker_present=1
  fi
}

restore_snapshot_file() {
  local snapshot=$1 destination=$2 candidate
  [ -f "$snapshot" ] && [ ! -L "$snapshot" ] || return 1
  candidate=$(mktemp "$destination.rollback.XXXXXX") || return 1
  cp --preserve=mode,ownership,timestamps -- "$snapshot" "$candidate" \
    || { rm -f -- "$candidate"; return 1; }
  mv -f -- "$candidate" "$destination"
}

remove_new_schedule_file() {
  local target=$1
  if [ -e "$target" ] || [ -L "$target" ]; then
    [ -f "$target" ] && [ ! -L "$target" ] || return 1
    rm -f -- "$target"
  fi
}

rollback_backup_schedule() {
  local observed candidate_link previous_target
  [ "$backup_schedule_mutating" = 1 ] || return 0
  [ -n "$backup_schedule_snapshot_dir" ] && [ -d "$backup_schedule_snapshot_dir" ] \
    || return 1

  if [ "$backup_schedule_timer_touched" = 1 ]; then
    systemctl disable --now "$BACKUP_TIMER" >/dev/null || return 1
  fi

  if [ "$backup_previous_current_present" = 1 ]; then
    previous_target=$(sed -n '1p' "$backup_schedule_snapshot_dir/current-target")
    [ -n "$previous_target" ] || return 1
    candidate_link=$(mktemp "$BACKUP_INSTALL_ROOT/current.rollback.XXXXXX") || return 1
    rm -f -- "$candidate_link"
    ln -s "$previous_target" "$candidate_link" || return 1
    mv -Tf -- "$candidate_link" "$BACKUP_CURRENT_LINK" || return 1
    [ "$(readlink "$BACKUP_CURRENT_LINK")" = "$previous_target" ] || return 1
  elif [ -e "$BACKUP_CURRENT_LINK" ] || [ -L "$BACKUP_CURRENT_LINK" ]; then
    [ -L "$BACKUP_CURRENT_LINK" ] || return 1
    rm -f -- "$BACKUP_CURRENT_LINK" || return 1
  fi

  if [ "$backup_previous_service_present" = 1 ]; then
    restore_snapshot_file "$backup_schedule_snapshot_dir/$BACKUP_SERVICE" \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" || return 1
  else
    remove_new_schedule_file "$SYSTEMD_UNIT_ROOT/$BACKUP_SERVICE" || return 1
  fi
  if [ "$backup_previous_timer_present" = 1 ]; then
    restore_snapshot_file "$backup_schedule_snapshot_dir/$BACKUP_TIMER" \
      "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" || return 1
  else
    remove_new_schedule_file "$SYSTEMD_UNIT_ROOT/$BACKUP_TIMER" || return 1
  fi
  systemctl daemon-reload || return 1
  if [ "$backup_previous_timer_enabled" = 1 ]; then
    systemctl enable "$BACKUP_TIMER" >/dev/null || return 1
  fi
  if [ "$backup_previous_timer_active" = 1 ]; then
    systemctl start "$BACKUP_TIMER" || return 1
  fi

  crontab -u root "$backup_schedule_snapshot_dir/root-crontab" || return 1
  observed=$backup_schedule_snapshot_dir/root-crontab.observed
  crontab -u root -l > "$observed" 2>/dev/null || return 1
  cmp -s "$backup_schedule_snapshot_dir/root-crontab" "$observed" || return 1

  if [ "$backup_previous_marker_present" = 1 ]; then
    restore_snapshot_file "$backup_schedule_snapshot_dir/legacy-cron-marker" \
      "$LEGACY_BACKUP_CRON_MARKER" || return 1
  else
    remove_new_schedule_file "$LEGACY_BACKUP_CRON_MARKER" || return 1
  fi
  backup_schedule_mutating=0
}

cleanup_backup_schedule_snapshot() {
  [ -n "$backup_schedule_snapshot_dir" ] || return 0
  case "$backup_schedule_snapshot_dir" in
    "$RUNTIME_ROOT"/backup-schedule-rollback.*) ;;
    *) return 1 ;;
  esac
  rm -f -- \
    "$backup_schedule_snapshot_dir/current-target" \
    "$backup_schedule_snapshot_dir/$BACKUP_SERVICE" \
    "$backup_schedule_snapshot_dir/$BACKUP_TIMER" \
    "$backup_schedule_snapshot_dir/root-crontab" \
    "$backup_schedule_snapshot_dir/root-crontab.observed" \
    "$backup_schedule_snapshot_dir/legacy-cron-marker"
  rmdir "$backup_schedule_snapshot_dir"
  backup_schedule_snapshot_dir=''
}

if [ -e "$PUBLICATION_LOCK" ] || [ -L "$PUBLICATION_LOCK" ]; then
  [ -f "$PUBLICATION_LOCK" ] && [ ! -L "$PUBLICATION_LOCK" ] \
    || die 'lock-ul de publicare nu este fișier regulat'
fi
# `<>` nu trunchiază un eventual target schimbat într-o cursă. După open,
# validăm obiectul ținut de FD 8, link count și identitatea path↔FD înainte de
# orice chown/chmod; astfel nu urmăm și nu normalizăm un symlink arbitrar.
exec 8<>"$PUBLICATION_LOCK"
publication_fd_path=$(readlink "/proc/$$/fd/8") \
  || die 'FD 8 pentru lock-ul de publicare nu poate fi citit'
[ "$publication_fd_path" = "$PUBLICATION_LOCK" ] \
  || die 'FD 8 nu indică pathul canonic al lock-ului de publicare'
[ -f "/proc/$$/fd/8" ] || die 'FD 8 nu indică un fișier regulat'
[ "$(stat -Lc '%h' "/proc/$$/fd/8")" = 1 ] \
  || die 'lock-ul de publicare are hardlinkuri neașteptate'
publication_fd_identity=$(stat -Lc '%d:%i' "/proc/$$/fd/8")
[ "$publication_fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] \
  || die 'identitatea lock-ului diferă între path și FD 8'
chown root:root "/proc/$$/fd/8"
chmod 0600 "/proc/$$/fd/8"
[ "$(stat -Lc '%u:%g:%a:%h' "/proc/$$/fd/8")" = '0:0:600:1' ] \
  || die 'ACL-ul lock-ului de publicare nu poate fi normalizat'
[ ! -L "$PUBLICATION_LOCK" ] \
  && [ "$publication_fd_identity" = "$(stat -Lc '%d:%i' "$PUBLICATION_LOCK")" ] \
  || die 'pathul lock-ului a fost schimbat în timpul normalizării'
flock 8

# O întrerupere dură nu execută trap-ul. Jurnalul root-only este autoritatea
# persistentă care împiedică o nouă publicare să ghicească dacă DB-ul poate fi
# restaurat sau dacă point-of-no-return a fost deja depășit.
if [ -e "$RECOVERY_JOURNAL" ] || [ -L "$RECOVERY_JOURNAL" ]; then
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    || die 'jurnalul recovery existent nu este fișier regulat'
  [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] \
    || die 'jurnalul recovery existent are ACL invalid'
  recovery_journal_phase=$(jq -er \
    'select(.schema == 1 and (.phase | type == "string") and
      (.pointOfNoReturn | type == "boolean")) | input_filename' \
    "$RECOVERY_JOURNAL" 2>/dev/null || true)
  # Citim separat câmpurile după validarea structurii, fără a include conținut
  # controlabil din jurnal în comenzi shell.
  if [ -n "$recovery_journal_phase" ]; then
    recovery_journal_phase=$(jq -er '.phase | select(test("^[a-z-]{3,40}$"))' "$RECOVERY_JOURNAL") \
      || die 'jurnalul recovery existent are fază invalidă'
    recovery_journal_ponr=$(jq -r '.pointOfNoReturn | if . then "true" else "false" end' \
      "$RECOVERY_JOURNAL") \
      || die 'jurnalul recovery existent are PONR invalid'
    die "există recovery neterminat: phase=$recovery_journal_phase pointOfNoReturn=$recovery_journal_ponr"
  fi
  die 'jurnalul recovery existent este invalid'
fi

PRODUCT_ORIGIN=$(jq -er '.publicAppOrigin | select(type == "string")' "$PRODUCT_FILE")
PRODUCT_REPOSITORY=$(jq -er '.githubRepository | select(type == "string")' "$PRODUCT_FILE")
PUBLIC_APP_DOMAIN=$(python3 - "$PRODUCT_ORIGIN" <<'PY'
import sys
from urllib.parse import urlsplit
u = urlsplit(sys.argv[1])
if u.scheme != 'https' or not u.hostname or u.username or u.password or u.path not in ('', '/') or u.query or u.fragment:
    raise SystemExit(1)
print(u.hostname.lower())
PY
) || die 'originul public din config este invalid'
[[ "$PRODUCT_REPOSITORY" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || die 'repository invalid în config'

jq -e --arg sha "$COMMIT_SHA" '.schema == 1 and .commit == $sha and (.images | type == "object") and (.images | length == 5)' "$MANIFEST_FILE" >/dev/null \
  || die 'manifestul OCI nu corespunde commitului'

registry_repo=${PRODUCT_REPOSITORY,,}
image_ref() {
  local component=$1 ref
  ref=$(jq -er --arg component "$component" '.images[$component] | select(type == "string")' "$MANIFEST_FILE")
  case "$ref" in
    "ghcr.io/$registry_repo/$component@sha256:"????????????????????????????????????????????????????????????????) ;;
    *) die "referință OCI nepermisă pentru $component" ;;
  esac
  [[ "$ref" =~ @sha256:[0-9a-f]{64}$ ]] || die "digest OCI invalid pentru $component"
  printf '%s' "$ref"
}

KELION_APP_IMAGE=$(image_ref app)
KELION_BROWSER_IMAGE=$(image_ref browser)
KELION_BROWSER_EGRESS_IMAGE=$(image_ref browser-egress)
KELION_CONVERTER_GATEWAY_IMAGE=$(image_ref converter-gateway)
KELION_CONVERTER_PARSER_IMAGE=$(image_ref converter-parser)
export KELION_APP_IMAGE KELION_BROWSER_IMAGE KELION_BROWSER_EGRESS_IMAGE
export KELION_CONVERTER_GATEWAY_IMAGE KELION_CONVERTER_PARSER_IMAGE

[ -f "$CONFIG_FILE" ] || die 'configul runtime dedicat lipsește'
[ "$(stat -c '%u:%g:%a' "$CONFIG_FILE")" = '0:10050:640' ] || die 'configul runtime trebuie root:10050 mode 0640'

declare -A allowed_config=()
for name in NODE_ENV PORT PUBLIC_APP_ORIGIN FRONTEND_ORIGIN ADMIN_EMAIL OPENAI_API_KEY_FILE OPENAI_LUNA_MODEL OPENAI_MEDIUM_MODEL OPENAI_HEAVY_MODEL OPENAI_REALTIME_MODEL OPENAI_REALTIME_TRANSCRIPTION_MODEL OPENAI_CALL_TRANSCRIPTION_MODEL OPENAI_TTS_MODEL OPENAI_IMAGE_MODEL OPENAI_VIDEO_MODEL OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND OPENAI_VIDEO_SHUTDOWN_AT DATABASE_URL_FILE SESSION_SECRET_FILE GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_ID GOOGLE_REDIRECT_URI CODEX_WORKER_ENABLED CODEX_WORKER_SECRET_FILE CONSTRUCTOR_PUBLISHER_ENABLED CONSTRUCTOR_PUBLISHER_SECRET_FILE CONSTRUCTOR_RELEASE_ENABLED CONSTRUCTOR_RELEASE_SECRET_FILE BROWSER_WORKER_SOCKET BROWSER_WORKER_SECRET_FILE CONVERTER_WORKER_SOCKET CONVERTER_WORKER_SECRET_FILE REVOLUT_MERCHANT_SECRET_KEY_FILE REVOLUT_WEBHOOK_SIGNING_SECRET_FILE VAPID_PRIVATE_KEY_FILE VISITOR_CHAT_TTL_SECONDS VISITOR_ANALYTICS_RETENTION_DAYS SESSION_ABSOLUTE_TTL_SECONDS SESSION_IDLE_TTL_SECONDS SESSION_TOUCH_INTERVAL_SECONDS SESSION_MAX_ACTIVE_PER_ACCOUNT SESSION_RECENT_REAUTH_SECONDS NATIVE_AUTH_REQUEST_TTL_SECONDS NATIVE_AUTH_EXCHANGE_TTL_SECONDS NATIVE_CHANNEL_TICKET_TTL_SECONDS OFFLINE_SYNC_MAX_TURNS OFFLINE_SYNC_MAX_TEXT_CHARS OFFLINE_SYNC_MAX_AGE_DAYS OFFLINE_SYNC_FUTURE_SKEW_SECONDS VOCAL_LIVE_IDLE_TIMEOUT_SECONDS PRIVACY_POLICY_UPDATED DATA_CONTROLLER_NAME PRIVACY_BACKUP_RETENTION_DAYS FINANCIAL_RETENTION_YEARS JOURNAL_RETENTION_DAYS MEDIA_RETENTION_DAYS CREDIT_PRICE_MINOR CHAT_TURN_PRICE_MINOR VOICE_LIVE_MINUTE_PRICE_MINOR CALL_UTTERANCE_PRICE_MINOR BILLING_FIRST_TOPUP_MIN_MINOR BILLING_TOPUP_STEP_MINOR BILLING_TOPUP_MIN_MINOR BILLING_TOPUP_MAX_MINOR LOW_CREDIT_THRESHOLD_MINOR LOW_CREDIT_TOPUP_MINOR PAYMENT_MODE PAYMENT_CONTRACT_VERIFIED REVOLUT_MERCHANT_API_VERSION REVOLUT_ORDER_EXPIRY PUSH_ENABLED VAPID_PUBLIC_KEY PUSH_ENDPOINT_HOSTS PUSH_MAX_SUBSCRIPTIONS GOOGLE_TTS_ENABLED GOOGLE_TTS_VOICE SEARCH_ENABLED MAIL_ENABLED RELEASE_CANDIDATE_MODE; do
  allowed_config[$name]=1
done
while IFS='=' read -r name _value; do
  [ -z "$name" ] && continue
  [[ "$name" = \#* ]] && continue
  [[ "$name" =~ ^[A-Z][A-Z0-9_]*$ ]] || die 'nume invalid în configul runtime'
  [ "${allowed_config[$name]:-0}" = 1 ] || die "variabilă nepermisă în configul runtime: $name"
done < "$CONFIG_FILE"

config_value() { sed -n "s/^$1=//p" "$CONFIG_FILE" | sed -n '1p'; }
[ "$(config_value NODE_ENV)" = production ] || die 'NODE_ENV trebuie production'
[ "$(config_value PUBLIC_APP_ORIGIN)" = "$PRODUCT_ORIGIN" ] || die 'PUBLIC_APP_ORIGIN diferă de configul release-ului'
[ "$(config_value FRONTEND_ORIGIN)" = "$PRODUCT_ORIGIN" ] || die 'FRONTEND_ORIGIN diferă de configul release-ului'
[ "$(config_value GOOGLE_REDIRECT_URI)" = "$PRODUCT_ORIGIN/auth/google/callback" ] || die 'redirectul Google nu este first-party exact'
admin_email=$(config_value ADMIN_EMAIL)
[[ "$admin_email" =~ ^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || die 'ADMIN_EMAIL obligatoriu și normalizat'
for name in OPENAI_LUNA_MODEL OPENAI_MEDIUM_MODEL OPENAI_HEAVY_MODEL OPENAI_REALTIME_MODEL OPENAI_REALTIME_TRANSCRIPTION_MODEL OPENAI_CALL_TRANSCRIPTION_MODEL OPENAI_TTS_MODEL OPENAI_IMAGE_MODEL; do
  [[ "$(config_value "$name")" =~ ^gpt-[a-z0-9][a-z0-9._-]*$ ]] || die "$name lipsește sau este invalid"
done
[[ "$(config_value OPENAI_VIDEO_MODEL)" =~ ^sora-[a-z0-9][a-z0-9._-]*$ ]] \
  || die 'OPENAI_VIDEO_MODEL lipsește sau nu este un model video Sora valid'
for name in PRIVACY_POLICY_UPDATED DATA_CONTROLLER_NAME GOOGLE_TOKEN_ENCRYPTION_KEY_ID OPENAI_VIDEO_SHUTDOWN_AT; do
  [ -n "$(config_value "$name")" ] || die "$name lipsește"
done
[[ "$(config_value GOOGLE_TOKEN_ENCRYPTION_KEY_ID)" =~ ^[A-Za-z0-9_-]{1,32}$ ]] || die 'GOOGLE_TOKEN_ENCRYPTION_KEY_ID invalid'
python3 - "$(config_value OPENAI_VIDEO_SHUTDOWN_AT)" <<'PY' || die 'OPENAI_VIDEO_SHUTDOWN_AT trebuie să fie ISO-8601 cu fus orar'
import datetime, sys
value = sys.argv[1]
parsed = datetime.datetime.fromisoformat(value.replace('Z', '+00:00'))
raise SystemExit(0 if parsed.tzinfo is not None else 1)
PY
for name in VISITOR_CHAT_TTL_SECONDS VISITOR_ANALYTICS_RETENTION_DAYS SESSION_ABSOLUTE_TTL_SECONDS SESSION_IDLE_TTL_SECONDS SESSION_TOUCH_INTERVAL_SECONDS SESSION_MAX_ACTIVE_PER_ACCOUNT SESSION_RECENT_REAUTH_SECONDS NATIVE_AUTH_REQUEST_TTL_SECONDS NATIVE_AUTH_EXCHANGE_TTL_SECONDS NATIVE_CHANNEL_TICKET_TTL_SECONDS OFFLINE_SYNC_MAX_TURNS OFFLINE_SYNC_MAX_TEXT_CHARS OFFLINE_SYNC_MAX_AGE_DAYS OFFLINE_SYNC_FUTURE_SKEW_SECONDS VOCAL_LIVE_IDLE_TIMEOUT_SECONDS PRIVACY_BACKUP_RETENTION_DAYS FINANCIAL_RETENTION_YEARS JOURNAL_RETENTION_DAYS MEDIA_RETENTION_DAYS OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND CREDIT_PRICE_MINOR CHAT_TURN_PRICE_MINOR VOICE_LIVE_MINUTE_PRICE_MINOR CALL_UTTERANCE_PRICE_MINOR BILLING_FIRST_TOPUP_MIN_MINOR BILLING_TOPUP_STEP_MINOR BILLING_TOPUP_MIN_MINOR BILLING_TOPUP_MAX_MINOR LOW_CREDIT_THRESHOLD_MINOR LOW_CREDIT_TOPUP_MINOR PUSH_MAX_SUBSCRIPTIONS; do
  [[ "$(config_value "$name")" =~ ^[1-9][0-9]*$ ]] || die "$name trebuie să fie un întreg pozitiv"
done
[ "$(config_value NATIVE_CHANNEL_TICKET_TTL_SECONDS)" -le 30 ] || die 'NATIVE_CHANNEL_TICKET_TTL_SECONDS trebuie să fie cel mult 30'
payment_mode=$(config_value PAYMENT_MODE)
payment_contract_verified=$(config_value PAYMENT_CONTRACT_VERIFIED)
case "$payment_mode" in
  disabled) [ "$payment_contract_verified" = false ] || die 'modul disabled cere PAYMENT_CONTRACT_VERIFIED=false' ;;
  sandbox|production) [ "$payment_contract_verified" = true ] || die 'plățile nu pot fi active fără contract verificat' ;;
  *) die 'PAYMENT_MODE trebuie disabled, sandbox sau production' ;;
esac
[[ "$(config_value REVOLUT_MERCHANT_API_VERSION)" =~ ^20[0-9]{2}-[0-9]{2}-[0-9]{2}$ ]] \
  || die 'REVOLUT_MERCHANT_API_VERSION trebuie să fie o dată versionată'
[[ "$(config_value REVOLUT_ORDER_EXPIRY)" =~ ^PT([1-9][0-9]{0,2}M|[1-9][0-9]?H)$ ]] \
  || die 'REVOLUT_ORDER_EXPIRY trebuie să fie o durată ISO-8601 în minute sau ore'

secret_files=(openai-project-key database-url session-secret google-client-secret google-token-encryption-key codex-worker-secret constructor-publisher-secret constructor-release-secret browser-worker-secret converter-worker-secret revolut-merchant-secret-key revolut-webhook-signing-secret vapid-private-key migration-backup-proof-key)
[ "$(stat -c '%u:%g:%a' "$SECRET_ROOT")" = '0:10050:750' ] || die 'directorul de secrete trebuie root:10050 mode 0750'
for name in "${secret_files[@]}"; do
  path=$SECRET_ROOT/$name
  [ -f "$path" ] && [ ! -L "$path" ] && [ -s "$path" ] || die "secret-file lipsă: $name"
  [ "$(stat -c '%u:%g:%a' "$path")" = '0:10050:440' ] || die "ACL invalid pentru secret-file $name"
done
case "$(sed -n '1p' "$SECRET_ROOT/openai-project-key")" in sk-proj-*) ;; *) die 'cheia OpenAI runtime nu este project-scoped' ;; esac
[ ! -e "$SECRET_ROOT/openai-admin-key" ] || die 'cheia OpenAI admin nu poate exista în secret root-ul aplicației'
for name in revolut-merchant-secret-key revolut-webhook-signing-secret; do
  path=$SECRET_ROOT/$name
  [ "$(wc -l < "$path")" -eq 1 ] || die "$name trebuie să conțină exact o linie"
  [ "$(awk 'NR == 1 { print length; exit }' "$path")" -ge 32 ] || die "$name este prea scurt"
  if [ "$payment_mode" = disabled ]; then
    grep -q '^disabled-placeholder-' "$path" || die "$name trebuie înlocuit cu placeholder când plățile sunt dezactivate"
  else
    ! grep -q '^disabled-placeholder-' "$path" || die "$name este placeholder; plățile rămân blocate"
  fi
done
push_enabled=$(config_value PUSH_ENABLED)
case "$push_enabled" in
  0)
    grep -q '^disabled-placeholder-' "$SECRET_ROOT/vapid-private-key" \
      || die 'vapid-private-key trebuie să fie placeholder când push este dezactivat'
    ;;
  1)
    [[ "$(config_value VAPID_PUBLIC_KEY)" =~ ^[A-Za-z0-9_-]{87}$ ]] || die 'VAPID_PUBLIC_KEY invalidă'
    [[ "$(sed -n '1p' "$SECRET_ROOT/vapid-private-key")" =~ ^[A-Za-z0-9_-]{43}$ ]] \
      || die 'VAPID_PRIVATE_KEY invalidă sau placeholder'
    push_endpoint_hosts=$(config_value PUSH_ENDPOINT_HOSTS)
    [ -n "$push_endpoint_hosts" ] || die 'PUSH_ENDPOINT_HOSTS obligatoriu când push este activ'
    IFS=',' read -r -a push_hosts <<< "$push_endpoint_hosts"
    for host in "${push_hosts[@]}"; do
      [[ "$host" =~ ^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$ ]] \
        || die 'PUSH_ENDPOINT_HOSTS conține un domeniu invalid'
    done
    ;;
  *) die 'PUSH_ENABLED trebuie 0 sau 1' ;;
esac

install -d -o root -g 10050 -m 0750 "$RUNTIME_ROOT" "$RELEASE_STATE_ROOT"
install -d -o root -g root -m 0755 "$PROXY_CONFIG_ROOT" "$PROXY_CONFIG_ROOT/upstream" "$PROXY_STATE_ROOT"
install -d -o 1000 -g 1000 -m 0750 "$PROXY_STATE_ROOT/data" "$PROXY_STATE_ROOT/config"
if [ ! -s "$RELEASE_STATE_ROOT/active" ]; then
  printf '%s\n' legacy > "$RELEASE_STATE_ROOT/active"
  chown root:10050 "$RELEASE_STATE_ROOT/active"
  chmod 0640 "$RELEASE_STATE_ROOT/active"
fi

KELION_SECCOMP_DESTINATION=$SECCOMP_PROFILE bash "$BUNDLE_DIR/pregateste-seccomp.sh"
[ -x "$COMPOSE_BIN" ] || bash "$BUNDLE_DIR/pregateste-compose.sh"
"$COMPOSE_BIN" version >/dev/null
docker network inspect kelion-proxy >/dev/null 2>&1 || docker network create --driver bridge --label com.kelion.managed=true kelion-proxy >/dev/null

for ref in "$KELION_APP_IMAGE" "$KELION_BROWSER_IMAGE" "$KELION_BROWSER_EGRESS_IMAGE" "$KELION_CONVERTER_GATEWAY_IMAGE" "$KELION_CONVERTER_PARSER_IMAGE"; do
  docker pull "$ref" >/dev/null
  [ "$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$ref")" = "$COMMIT_SHA" ] \
    || die 'o imagine OCI nu poartă commitul aprobat'
done

run_migrator() {
  docker run --rm --network none --user 1000:1000 --group-add 10050 \
    --read-only --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 96 --memory 768m --cpus 1 \
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000 \
    -e HOME=/tmp -e npm_config_cache=/tmp/npm \
    -e DATABASE_URL_FILE=/run/secrets/database-url \
    -v /var/run/postgresql:/var/run/postgresql:ro \
    -v "$SECRET_ROOT/database-url:/run/secrets/database-url:ro" \
    "$@"
}

cleanup_migration_proof_copy() {
  local candidate=${migration_proof_copy:-}
  [ -n "$candidate" ] || return 0
  case "$candidate" in
    "$RUNTIME_ROOT"/migration-backup-proof.*) ;;
    *) return 1 ;;
  esac
  rm -f -- "$candidate" || return 1
  [ ! -e "$candidate" ] && [ ! -L "$candidate" ] || return 1
  migration_proof_copy=''
}

prepare_migration_proof_copy() {
  [ -z "$migration_proof_copy" ] || return 1
  [ -f "$PROOF_FILE" ] && [ ! -L "$PROOF_FILE" ] || return 1
  [ "$(stat -Lc '%u:%g:%a:%h' "$PROOF_FILE")" = '0:0:600:1' ] || return 1

  migration_proof_copy=$(mktemp "$RUNTIME_ROOT/migration-backup-proof.XXXXXX") || return 1
  if ! install -o root -g 10050 -m 0440 "$PROOF_FILE" "$migration_proof_copy" \
    || [ ! -f "$migration_proof_copy" ] || [ -L "$migration_proof_copy" ] \
    || [ "$(stat -Lc '%u:%g:%a:%h' "$migration_proof_copy")" != '0:10050:440:1' ] \
    || ! cmp -s -- "$PROOF_FILE" "$migration_proof_copy" \
    || [ ! -f "$PROOF_FILE" ] || [ -L "$PROOF_FILE" ] \
    || [ "$(stat -Lc '%u:%g:%a:%h' "$PROOF_FILE")" != '0:0:600:1' ]; then
    cleanup_migration_proof_copy || true
    return 1
  fi
}

migration_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan)
jq -e '.kind == "migrations_plan" and (.risk == "safe" or .risk == "destructive") and (.pending | type == "array")' <<<"$migration_plan" >/dev/null \
  || die 'planul migrărilor este invalid'
pending_count=$(jq -er '.pending | length' <<<"$migration_plan")
migration_risk=$(jq -er '.risk' <<<"$migration_plan")
migration_contract_before=$(jq -cS '{kind,risk,pending}' <<<"$migration_plan")
destructive_cutover=0
if [ "$pending_count" -gt 0 ] && [ "$migration_risk" = destructive ]; then
  destructive_cutover=1
fi

if [ "$destructive_cutover" = 1 ]; then
  for tool in node psql pg_restore df stat readlink; do need "$tool"; done
  [[ "$(psql --version)" =~ \(PostgreSQL\)[[:space:]]16\. ]] \
    || die 'restore-ul verificat cere clientul psql 16'
  [[ "$(pg_restore --version)" =~ \(PostgreSQL\)[[:space:]]16\. ]] \
    || die 'restore-ul verificat cere clientul pg_restore 16'
  publication_lock_target=$(readlink -f "/proc/$$/fd/8") \
    || die 'FD 8 pentru lock-ul de publicare nu poate fi verificat'
  [ "$publication_lock_target" = "$(readlink -f "$ROOT/publicare.lock")" ] \
    || die 'FD 8 nu deține lock-ul de publicare așteptat'
  flock -n 8 || die 'lock-ul de publicare nu poate fi reutilizat de recovery'
fi

# Capturăm TOT ce trebuie refăcut înainte de prima mutație DB. Primul cutover
# nu are încă proxy-ul managed pe calea publică: `kelion-caddy` rămâne proxy-ul
# real, iar oprirea writerului său produce intenționat 502 fail-closed.
UPSTREAM_FILE=$PROXY_CONFIG_ROOT/upstream/kelion-upstream.caddy
LIVE_CADDYFILE=$PROXY_CONFIG_ROOT/Caddyfile
old_upstream=''
old_upstream_present=0
if [ -e "$UPSTREAM_FILE" ] || [ -L "$UPSTREAM_FILE" ]; then
  [ -f "$UPSTREAM_FILE" ] && [ ! -L "$UPSTREAM_FILE" ] \
    || die 'upstreamul activ nu este fișier regulat'
  [ "$(stat -c '%u:%g:%a' "$UPSTREAM_FILE")" = '0:0:644' ] \
    || die 'upstreamul activ are ACL neașteptat'
  old_upstream=$(cat "$UPSTREAM_FILE")
  old_upstream_present=1
fi

managed_proxy_running=0
legacy_proxy_running=0
docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true && managed_proxy_running=1 || true
docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true && legacy_proxy_running=1 || true
case "$managed_proxy_running:$legacy_proxy_running" in
  1:0)
    case "$old_upstream" in
      *app-blue:8080*) active_slot=blue; active_bind_port=18080; inactive_slot=green ;;
      *app-green:8080*) active_slot=green; active_bind_port=18081; inactive_slot=blue ;;
      *) die 'proxy-ul managed rulează fără un upstream activ valid' ;;
    esac
    ;;
  0:1)
    # Fișierul managed poate fi stale după un prim cutover eșuat; proxy-ul care
    # deține efectiv 80/443 este autoritatea pentru starea legacy.
    active_slot=legacy
    active_bind_port=''
    inactive_slot=blue
    ;;
  *) die 'starea proxy-urilor publice este ambiguă: trebuie să ruleze exact unul' ;;
esac

old_marker=$(sed -n '1p' "$RELEASE_STATE_ROOT/active")
[ -n "$old_marker" ] || die 'markerul release activ este gol'
case "$active_slot" in
  blue|green) [[ "$old_marker" =~ ^[0-9a-f]{40}$ ]] || die 'markerul slotului activ nu este SHA integral' ;;
  legacy) [ "$old_marker" = legacy ] || die 'markerul legacy nu corespunde proxy-ului public capturat' ;;
  *) die "slot activ necunoscut: $active_slot" ;;
esac

LEGACY_RUNTIME_CONTAINERS=(kelionai-app omniroute kelionai-coqui)
legacy_runtime_running=()
active_runtime_containers=()
active_runtime_output=''
legacy_version_before=''
previous_version_before=''
case "$active_slot" in
  blue|green)
    [ "$managed_proxy_running" = 1 ] || die 'slotul managed este activ fără proxy-ul managed'
    active_runtime_output=$(docker ps -q \
      --filter 'label=com.kelion.managed=true' --filter "label=com.kelion.slot=$active_slot") \
      || die 'containerele slotului activ nu pot fi enumerate'
    [ -z "$active_runtime_output" ] || mapfile -t active_runtime_containers <<<"$active_runtime_output"
    [ "${#active_runtime_containers[@]}" -gt 0 ] || die 'slotul activ nu are containere capturabile'
    managed_version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' \
      "http://127.0.0.1:$active_bind_port/api/version")
    previous_version_before=$(jq -er \
      '.v | select(type == "string" and test("^[0-9a-f]{7,40}$"))' \
      <<<"$managed_version_payload") || die 'versiunea slotului activ nu este JSON valid'
    [ "${old_marker:0:${#previous_version_before}}" = "$previous_version_before" ] \
      || die 'versiunea slotului activ nu corespunde markerului capturat'
    ;;
  legacy)
    [ "$legacy_proxy_running" = 1 ] || die 'runtime-ul legacy este activ fără kelion-caddy'
    for legacy in "${LEGACY_RUNTIME_CONTAINERS[@]}"; do
      legacy_running=$(docker inspect -f '{{.State.Running}}' "$legacy" 2>/dev/null) \
        || die "containerul legacy $legacy nu poate fi capturat"
      case "$legacy_running" in
        true) legacy_runtime_running+=("$legacy") ;;
        false) ;;
        *) die "containerul legacy $legacy are stare ambiguă" ;;
      esac
    done
    [[ " ${legacy_runtime_running[*]} " == *' kelionai-app '* ]] \
      || die 'writerul legacy kelionai-app nu este capturabil'
    legacy_version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' \
      http://127.0.0.1:8080/api/version)
    legacy_version_before=$(jq -er '.v | select(type == "string" and test("^[0-9a-f]{7,40}$"))' \
      <<<"$legacy_version_payload") || die 'versiunea legacy nu este JSON valid'
    previous_version_before=$legacy_version_before
    ;;
esac

sync_recovery_path() {
  local path=$1 mode=$2
  python3 - "$path" "$mode" <<'PY'
import os
import sys

path, mode = sys.argv[1:]
if mode == 'file':
    with open(path, 'rb') as handle:
        os.fsync(handle.fileno())
elif mode != 'directory':
    raise SystemExit(2)
directory = os.path.dirname(path)
flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0)
fd = os.open(directory, flags)
try:
    os.fsync(fd)
finally:
    os.close(fd)
PY
}

# Acest snapshot este ultima operație de capture și nu este urmat de nicio
# validare care ar putea ieși înainte de armarea trap-ului de recovery.
previous_caddyfile_present=0
previous_caddyfile_snapshot=''
if [ -e "$LIVE_CADDYFILE" ] || [ -L "$LIVE_CADDYFILE" ]; then
  [ -f "$LIVE_CADDYFILE" ] && [ ! -L "$LIVE_CADDYFILE" ] \
    || die 'Caddyfile-ul live nu este fișier regulat'
  [ "$(stat -c '%u:%g:%a' "$LIVE_CADDYFILE")" = '0:0:644' ] \
    || die 'Caddyfile-ul live are ACL neașteptat'
  previous_caddyfile_snapshot=$(mktemp "$RUNTIME_ROOT/caddyfile-rollback.XXXXXX") \
    || die 'snapshotul Caddyfile nu poate fi creat'
  if ! install -o root -g root -m 0600 "$LIVE_CADDYFILE" "$previous_caddyfile_snapshot" \
    || ! cmp -s "$LIVE_CADDYFILE" "$previous_caddyfile_snapshot" \
    || ! sync_recovery_path "$previous_caddyfile_snapshot" file; then
    rm -f -- "$previous_caddyfile_snapshot"
    die 'Caddyfile-ul live nu poate fi capturat exact'
  fi
  previous_caddyfile_present=1
fi
if [ "$active_slot" != legacy ] && [ "$previous_caddyfile_present" != 1 ]; then
  die 'proxy-ul managed nu are Caddyfile recuperabil'
fi

active_runtime_stopped=0
db_restore_required=0
database_restore_verified=0
destructive_migration_attempted=0
point_of_no_return=0
recovery_armed=0

write_recovery_journal() {
  local phase=$1 ponr=$2 restore_required=$3 temporary
  local ponr_json=false restore_json=false active_runtime_json='[]' legacy_runtime_json='[]'
  case "$phase" in
    maintenance|before-migrator|database-migrated|restore-in-progress|database-restored|point-of-no-return|rolled-back|completed) ;;
    *) return 1 ;;
  esac
  case "$ponr:$restore_required" in
    0:0|0:1|1:0|1:1) ;;
    *) return 1 ;;
  esac
  [ "$ponr" = 0 ] || ponr_json=true
  [ "$restore_required" = 0 ] || restore_json=true
  if [ "${#active_runtime_containers[@]}" -gt 0 ]; then
    active_runtime_json=$(printf '%s\n' "${active_runtime_containers[@]}" | jq -Rsc 'split("\n")[:-1]') \
      || return 1
  fi
  if [ "${#legacy_runtime_running[@]}" -gt 0 ]; then
    legacy_runtime_json=$(printf '%s\n' "${legacy_runtime_running[@]}" | jq -Rsc 'split("\n")[:-1]') \
      || return 1
  fi
  temporary=$(mktemp "$RUNTIME_ROOT/destructive-cutover-recovery.XXXXXX") || return 1
  if ! jq -n \
    --arg commit "$COMMIT_SHA" \
    --arg phase "$phase" \
    --arg activeSlot "$active_slot" \
    --arg inactiveSlot "$inactive_slot" \
    --arg oldMarker "$old_marker" \
    --arg previousVersion "$previous_version_before" \
    --arg caddyfileSnapshot "$previous_caddyfile_snapshot" \
    --arg oldUpstream "$old_upstream" \
    --argjson pointOfNoReturn "$ponr_json" \
    --argjson dbRestoreRequired "$restore_json" \
    --argjson oldUpstreamPresent "$old_upstream_present" \
    --argjson activeRuntimeContainers "$active_runtime_json" \
    --argjson legacyRuntimeContainers "$legacy_runtime_json" \
    '{schema:1,commit:$commit,phase:$phase,pointOfNoReturn:$pointOfNoReturn,
      dbRestoreRequired:$dbRestoreRequired,activeSlot:$activeSlot,inactiveSlot:$inactiveSlot,
      oldMarker:$oldMarker,previousVersion:$previousVersion,
      activeRuntimeContainers:$activeRuntimeContainers,
      legacyRuntimeContainers:$legacyRuntimeContainers,
      oldUpstreamPresent:($oldUpstreamPresent == 1),oldUpstream:$oldUpstream,
      caddyfileSnapshot:$caddyfileSnapshot,updatedAt:(now|todateiso8601)}' > "$temporary" \
    || ! chown root:root "$temporary" \
    || ! chmod 0600 "$temporary" \
    || ! mv -f -- "$temporary" "$RECOVERY_JOURNAL" \
    || ! sync_recovery_path "$RECOVERY_JOURNAL" file; then
    rm -f -- "$temporary"
    return 1
  fi
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] \
    || return 1
}

clear_recovery_journal() {
  [ -e "$RECOVERY_JOURNAL" ] || [ -L "$RECOVERY_JOURNAL" ] || return 0
  [ -f "$RECOVERY_JOURNAL" ] && [ ! -L "$RECOVERY_JOURNAL" ] \
    && [ "$(stat -Lc '%u:%g:%a:%h' "$RECOVERY_JOURNAL")" = '0:0:600:1' ] \
    || return 1
  rm -f -- "$RECOVERY_JOURNAL" || return 1
  sync_recovery_path "$RECOVERY_JOURNAL" directory
}

mark_point_of_no_return() {
  [ "$destructive_cutover" = 1 ] || return 0
  # RAM-ul devine conservator înainte de operația întreruptibilă de persistare:
  # un semnal între assignment și fsync nu poate porni rollback-ul vechi. Jurnalul
  # este apoi durabil înainte ca proxy-ul să poată accepta trafic.
  point_of_no_return=1
  write_recovery_journal point-of-no-return 1 "$db_restore_required" || return 1
}

restore_release_marker() {
  local temporary
  temporary=$(mktemp "$RELEASE_STATE_ROOT/rollback.XXXXXX") || return 1
  printf '%s\n' "$old_marker" > "$temporary"
  chown root:10050 "$temporary" || return 1
  chmod 0640 "$temporary" || return 1
  mv "$temporary" "$RELEASE_STATE_ROOT/active"
}

cleanup_caddyfile_snapshot() {
  [ -n "$previous_caddyfile_snapshot" ] || return 0
  case "$previous_caddyfile_snapshot" in
    "$RUNTIME_ROOT"/caddyfile-rollback.[A-Za-z0-9]*) ;;
    *) return 1 ;;
  esac
  rm -f -- "$previous_caddyfile_snapshot" || return 1
  previous_caddyfile_snapshot=''
}

restore_caddyfile_snapshot() {
  local temporary=''
  if [ "$previous_caddyfile_present" = 1 ]; then
    [ -f "$previous_caddyfile_snapshot" ] && [ ! -L "$previous_caddyfile_snapshot" ] \
      || return 1
    [ "$(stat -c '%u:%g:%a' "$previous_caddyfile_snapshot")" = '0:0:600' ] \
      || return 1
    temporary=$(mktemp "$PROXY_CONFIG_ROOT/Caddyfile.rollback.XXXXXX") || return 1
    if ! install -o root -g root -m 0644 "$previous_caddyfile_snapshot" "$temporary"; then
      rm -f -- "$temporary"
      return 1
    fi
    mv -f -- "$temporary" "$LIVE_CADDYFILE" || return 1
    [ "$(stat -c '%u:%g:%a' "$LIVE_CADDYFILE")" = '0:0:644' ] || return 1
    cmp -s "$previous_caddyfile_snapshot" "$LIVE_CADDYFILE" || return 1
  else
    [ ! -L "$LIVE_CADDYFILE" ] || return 1
    rm -f -- "$LIVE_CADDYFILE" || return 1
    [ ! -e "$LIVE_CADDYFILE" ] && [ ! -L "$LIVE_CADDYFILE" ] || return 1
  fi
}

restore_upstream_snapshot() {
  local temporary=''
  if [ "$old_upstream_present" = 1 ]; then
    temporary=$(mktemp "$PROXY_CONFIG_ROOT/upstream/rollback.XXXXXX") || return 1
    if ! printf '%s\n' "$old_upstream" > "$temporary" \
      || ! chown root:root "$temporary" \
      || ! chmod 0644 "$temporary"; then
      rm -f -- "$temporary"
      return 1
    fi
    if ! mv -f -- "$temporary" "$UPSTREAM_FILE"; then
      rm -f -- "$temporary"
      return 1
    fi
    [ "$(stat -c '%u:%g:%a' "$UPSTREAM_FILE")" = '0:0:644' ] || return 1
  else
    [ ! -L "$UPSTREAM_FILE" ] || return 1
    rm -f -- "$UPSTREAM_FILE" || return 1
    [ ! -e "$UPSTREAM_FILE" ] && [ ! -L "$UPSTREAM_FILE" ] || return 1
  fi
}

verify_database_contract() {
  local restored_plan restored_contract
  restored_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan) \
    || return 1
  jq -e '.kind == "migrations_plan" and (.risk == "safe" or .risk == "destructive") and (.pending | type == "array")' \
    <<<"$restored_plan" >/dev/null || return 1
  restored_contract=$(jq -cS '{kind,risk,pending}' <<<"$restored_plan") || return 1
  [ "$restored_contract" = "$migration_contract_before" ]
}

enter_destructive_maintenance() {
  local temporary maintenance_status
  case "$active_slot" in
    blue|green)
      temporary=$(mktemp "$PROXY_CONFIG_ROOT/upstream/maintenance.XXXXXX") || return 1
      printf 'respond "Service temporarily unavailable" 503\n' > "$temporary"
      chmod 0644 "$temporary" || return 1
      mv "$temporary" "$UPSTREAM_FILE" || return 1
      docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null || return 1
      docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null || return 1
      maintenance_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
        --max-time 10 --noproxy '*' http://127.0.0.1:18079/ || true)
      [ "$maintenance_status" = 503 ] || return 1
      ;;
    legacy)
      # kelion-caddy este încă proxy-ul public și nu importă UPSTREAM_FILE.
      # Oprirea runtime-ului imediat după această funcție este maintenance-ul
      # fail-closed real (502), fără a porni prematur kelion-proxy.
      [ "$legacy_proxy_running" = 1 ] || return 1
      ;;
    *) return 1 ;;
  esac
}

ensure_containers_stopped() {
  local container running
  for container in "$@"; do
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
    case "$running" in
      true)
        if ! docker stop --time 30 "$container" >/dev/null; then
          running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
          [ "$running" = false ] || return 1
        fi
        ;;
      false) ;;
      *) return 1 ;;
    esac
  done
  for container in "$@"; do
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
    [ "$running" = false ] || return 1
  done
}

ensure_containers_running() {
  local container running
  for container in "$@"; do
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
    case "$running" in
      true) ;;
      false)
        if ! docker start "$container" >/dev/null; then
          running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
          [ "$running" = true ] || return 1
        fi
        ;;
      *) return 1 ;;
    esac
  done
  for container in "$@"; do
    running=$(docker inspect -f '{{.State.Running}}' "$container" 2>/dev/null) || return 1
    [ "$running" = true ] || return 1
  done
}

stop_active_runtime() {
  [ "$active_runtime_stopped" = 0 ] || return 0
  active_runtime_stopped=1
  case "$active_slot" in
    blue|green)
      ensure_containers_stopped "${active_runtime_containers[@]}" || return 1
      ;;
    legacy)
      ensure_containers_stopped "${legacy_runtime_running[@]}" || return 1
      ;;
    *) return 1 ;;
  esac
}

verify_destructive_maintenance() {
  local maintenance_status
  case "$active_slot" in
    blue|green)
      # enter_destructive_maintenance a verificat deja 503 pe control-plane.
      return 0
      ;;
    legacy)
      # kelion-caddy rămâne proxy-ul public. Cu writerul legacy oprit trebuie să
      # răspundă 502 real, nu un 200 din fallback-ul SPA.
      maintenance_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
        --max-time 10 --noproxy '*' --resolve "$PUBLIC_APP_DOMAIN:443:127.0.0.1" \
        "https://$PUBLIC_APP_DOMAIN/api/version" || true)
      [ "$maintenance_status" = 502 ]
      ;;
    *) return 1 ;;
  esac
}

stop_candidate_runtime() {
  local output=''
  local -a containers=()
  output=$(docker ps -aq \
    --filter 'label=com.kelion.managed=true' --filter "label=com.kelion.slot=$inactive_slot") \
    || return 1
  [ -z "$output" ] || mapfile -t containers <<<"$output"
  if [ "${#containers[@]}" -gt 0 ]; then
    ensure_containers_stopped "${containers[@]}" || return 1
  fi
}

restore_database_if_required() {
  [ "$db_restore_required" = 1 ] || return 0
  [ "$point_of_no_return" = 0 ] || {
    printf 'release: point-of-no-return depășit; restore-ul automat ar putea pierde scrieri\n' >&2
    return 1
  }
  write_recovery_journal restore-in-progress 0 1 || return 1
  KELION_RESTORE_APPROVED=1 KELION_PUBLICATION_LOCK_HELD=1 \
    bash "$BUNDLE_DIR/restore-verified-backup.sh" "$PROOF_FILE" \
    || return 1
  verify_database_contract || return 1
  database_restore_verified=1
  db_restore_required=0
  write_recovery_journal database-restored 0 0 || return 1
}

preflight_database_restore() {
  KELION_RESTORE_APPROVED=1 KELION_PUBLICATION_LOCK_HELD=1 \
    bash "$BUNDLE_DIR/restore-verified-backup.sh" --preflight "$PROOF_FILE"
}

restart_previous_slot() {
  local rollback_ready=''
  [ "$db_restore_required" = 0 ] || return 1
  if [ "$destructive_migration_attempted" = 1 ]; then
    [ "$database_restore_verified" = 1 ] || return 1
    verify_database_contract || return 1
  fi
  [ "${#active_runtime_containers[@]}" -gt 0 ] || return 1
  restore_release_marker || return 1
  ensure_containers_running "${active_runtime_containers[@]}" || return 1
  for _attempt in $(seq 1 45); do
    rollback_ready=$(curl --fail --silent --show-error --max-time 10 \
      "http://127.0.0.1:$active_bind_port/readyz" || true)
    if jq -e '.ready == true and .release.sideEffectsActive == true' \
      <<<"$rollback_ready" >/dev/null 2>&1; then
      active_runtime_stopped=0
      return 0
    fi
    sleep 2
  done
  return 1
}

restart_legacy_runtime() {
  local consecutive=0 version_payload=''
  [ "$db_restore_required" = 0 ] || return 1
  if [ "$destructive_migration_attempted" = 1 ]; then
    [ "$database_restore_verified" = 1 ] || return 1
    verify_database_contract || return 1
  fi
  [ "${#legacy_runtime_running[@]}" -gt 0 ] || return 1
  restore_release_marker || return 1
  ensure_containers_running "${legacy_runtime_running[@]}" || return 1

  # Legacy nu are /livez sau /readyz: răspunsurile 200 erau fallback-ul SPA.
  # Cerem JSON-ul /api/version exact și contractul DB verificat mai sus, de trei ori.
  for _attempt in $(seq 1 30); do
    version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' \
      http://127.0.0.1:8080/api/version || true)
    if jq -e --arg expected "$legacy_version_before" \
      '.v == $expected and (.v | type == "string")' <<<"$version_payload" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
      if [ "$consecutive" -ge 3 ]; then
        active_runtime_stopped=0
        return 0
      fi
    else
      consecutive=0
    fi
    sleep 2
  done
  return 1
}

verify_public_previous_version() {
  local consecutive=0 version_payload=''
  [ -n "$previous_version_before" ] || return 1
  for _attempt in $(seq 1 30); do
    version_payload=$(curl --fail --silent --show-error --max-time 10 \
      --noproxy '*' --resolve "$PUBLIC_APP_DOMAIN:443:127.0.0.1" \
      "https://$PUBLIC_APP_DOMAIN/api/version" || true)
    if jq -e --arg expected "$previous_version_before" \
      '.v == $expected and (.v | type == "string")' <<<"$version_payload" >/dev/null 2>&1; then
      consecutive=$((consecutive + 1))
      [ "$consecutive" -lt 3 ] || return 0
    else
      consecutive=0
    fi
    sleep 2
  done
  return 1
}

restore_proxy_after_rollback() {
  restore_caddyfile_snapshot || return 1
  restore_upstream_snapshot || return 1
  case "$active_slot" in
    blue|green)
      [ "$old_upstream_present" = 1 ] && [ -n "$old_upstream" ] || return 1
      docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null || return 1
      docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null || return 1
      ;;
    legacy)
      if docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true; then
        "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" down >/dev/null || return 1
      fi
      [ "$legacy_proxy_running" = 1 ] || return 1
      ensure_containers_running kelion-caddy || return 1
      docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true || return 1
      ;;
    *) return 1 ;;
  esac
  # Starea Docker `Running` și probele directe nu dovedesc TLS/rutarea publică.
  # Dezarmăm recovery-ul numai după trei răspunsuri JSON cu versiunea capturată.
  verify_public_previous_version || return 1
  cleanup_caddyfile_snapshot
}

rollback_switch() {
  local rollback_failed=0 runtime_ready=0
  [ "$recovery_armed" = 1 ] || return 0
  [ "$point_of_no_return" = 0 ] || return 1

  # Ordine de fier: niciun writer candidat în timpul restore-ului; DB întâi;
  # abia apoi runtime-ul vechi și proxy-ul public.
  if ! stop_candidate_runtime; then
    printf 'release: recovery a refuzat restore-ul cât candidatul poate scrie\n' >&2
    return 1
  fi
  if ! restore_database_if_required; then
    printf 'release: backupul verificat nu a putut restaura și schimba baza\n' >&2
    return 1
  fi
  if ! rollback_backup_schedule; then
    printf 'release: rollback-ul nu poate restaura schedulerul de backup\n' >&2
    rollback_failed=1
  elif ! cleanup_backup_schedule_snapshot; then
    printf 'release: snapshotul schedulerului de backup nu poate fi curățat\n' >&2
    rollback_failed=1
  fi

  if [ "$active_slot" = blue ] || [ "$active_slot" = green ]; then
    # Markerul poate dezactiva singur runtime-ul vechi înainte ca shell-ul să-l
    # marcheze oprit. Îl restaurăm și îl verificăm întotdeauna, idempotent.
    if restart_previous_slot; then runtime_ready=1; else rollback_failed=1; fi
  else
    # Și primul cutover trebuie să refacă markerul `legacy` chiar dacă procesele
    # vechi nu au fost încă oprite. Helperul de start acceptă starea running.
    if restart_legacy_runtime; then runtime_ready=1; else rollback_failed=1; fi
  fi
  if [ "$runtime_ready" = 1 ]; then
    restore_proxy_after_rollback || rollback_failed=1
  fi
  [ "$rollback_failed" = 0 ] || return 1
  if [ "$destructive_cutover" = 1 ]; then
    write_recovery_journal rolled-back 0 0 || return 1
    clear_recovery_journal || return 1
  fi
  recovery_armed=0
}

recover_schedule_after_point_of_no_return() {
  # Schedulerul nu poate produce write-uri în aplicație și are propriul snapshot;
  # îl putem repara fără să atingem candidatul, DB-ul, runtime-ul sau proxy-ul.
  if ! rollback_backup_schedule; then
    printf 'release: schedulerul de backup nu a putut fi restaurat după point-of-no-return\n' >&2
    return 1
  fi
  cleanup_backup_schedule_snapshot
}

on_release_exit() {
  local rc=$?
  # Recovery-ul nu poate fi întrerupt la al doilea Ctrl-C/TERM. SIGKILL/reboot
  # este acoperit de jurnalul durabil și va bloca următoarea publicare.
  trap '' HUP INT TERM
  trap - EXIT
  if ! cleanup_migration_proof_copy; then
    printf 'release: copia temporară a dovezii migratorului nu a putut fi eliminată\n' >&2
    [ "$rc" -ne 0 ] || rc=1
  fi
  if [ "$rc" -ne 0 ] && [ "$recovery_armed" = 1 ]; then
    if [ "$point_of_no_return" = 1 ]; then
      recover_schedule_after_point_of_no_return \
        || printf 'release: RECOVERY INCOMPLET pentru schedulerul de backup\n' >&2
      printf 'release: eșec după point-of-no-return; candidatul, DB și proxy-ul rămân nemodificate\n' >&2
    else
      rollback_switch || printf 'release: RECOVERY INCOMPLET; runtime-ul vechi rămâne oprit\n' >&2
    fi
  fi
  exit "$rc"
}

# Trap-ul este armat înainte de maintenance, backup și mai ales înainte de
# migrator. Orice eșec ulterior revine prin aceeași ordine DB → runtime → proxy.
recovery_armed=1
trap on_release_exit EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

# Cronul existent indică acest path. Îl actualizăm sub publication lock înainte
# de maintenance, astfel încât niciun release viitor să nu poată pierde
# containerele de rollback printr-un container prune concurent.
install_cleanup_script
install_persistent_backup_script
if [ "$destructive_cutover" = 1 ]; then
  write_recovery_journal maintenance 0 0
  enter_destructive_maintenance
  stop_active_runtime
  stop_candidate_runtime
  verify_destructive_maintenance
fi
rm -f -- "$PROOF_FILE"
"$PERSISTENT_BACKUP_SCRIPT"
[ -s "$PROOF_FILE" ] || die 'backup-ul nu a produs dovada verificată'
if [ "$destructive_cutover" = 1 ]; then
  # Exercită validatorul, arhiva, rolul DB, spațiul și restore-ul scratch fără
  # swap. Numai după această dovadă permitem migratorului să mute baza live.
  preflight_database_restore
fi

if [ "$pending_count" -gt 0 ]; then
  migration_args=(
    --rm --network none --user 1000:1000 --group-add 10050
    --read-only --cap-drop ALL --security-opt no-new-privileges
    --pids-limit 96 --memory 768m --cpus 1
    --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,uid=1000,gid=1000
    -e HOME=/tmp -e npm_config_cache=/tmp/npm
    -e DATABASE_URL_FILE=/run/secrets/database-url
    -v /var/run/postgresql:/var/run/postgresql:ro
    -v "$SECRET_ROOT/database-url:/run/secrets/database-url:ro"
  )
  if [ "$destructive_cutover" = 1 ]; then
    prepare_migration_proof_copy \
      || die 'dovada backupului nu poate fi expusă migratorului cu ACL minim'
    migration_args+=(
      -e MIGRATION_BACKUP_PROOF_FILE=/run/proof/backup.json
      -e MIGRATION_BACKUP_PROOF_KEY_FILE=/run/secrets/migration-backup-proof-key
      -v "$migration_proof_copy:/run/proof/backup.json:ro"
      -v "$PROOF_KEY:/run/secrets/migration-backup-proof-key:ro"
    )
    # Fail-closed: comanda poate muta DB înainte să întoarcă o eroare, deci
    # recovery-ul devine obligatoriu ÎNAINTE de pornirea migratorului.
    destructive_migration_attempted=1
    db_restore_required=1
    write_recovery_journal before-migrator 0 1
  fi
  migration_output=$(docker run "${migration_args[@]}" "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate)
  if [ "$destructive_cutover" = 1 ]; then
    cleanup_migration_proof_copy \
      || die 'copia temporară a dovezii migratorului nu a putut fi eliminată'
  fi
  [ "$migration_output" = migrations_ok ] || die 'migrările nu au confirmat succesul'
  if [ "$destructive_cutover" = 1 ]; then
    write_recovery_journal database-migrated 0 1
  fi
fi

case "$inactive_slot" in
  blue)
    KELION_BIND_PORT=18080
    KELION_BROWSER_SUBNET=172.29.10.0/24
    KELION_BROWSER_WORKER_IP=172.29.10.2
    KELION_BROWSER_PROXY_IP=172.29.10.3
    ;;
  green)
    KELION_BIND_PORT=18081
    KELION_BROWSER_SUBNET=172.29.11.0/24
    KELION_BROWSER_WORKER_IP=172.29.11.2
    KELION_BROWSER_PROXY_IP=172.29.11.3
    ;;
  *) die 'slot invalid' ;;
esac

KELION_SLOT=$inactive_slot
KELION_COMMIT_SHA=$COMMIT_SHA
KELION_RUNTIME_ROOT=$RUNTIME_ROOT/slots/$inactive_slot
KELION_RELEASE_STATE_ROOT=$RELEASE_STATE_ROOT
KELION_CONFIG_FILE=$CONFIG_FILE
KELION_SECRET_ROOT=$SECRET_ROOT
KELION_SECCOMP_PROFILE=$SECCOMP_PROFILE
export KELION_SLOT KELION_COMMIT_SHA KELION_RUNTIME_ROOT KELION_RELEASE_STATE_ROOT
export KELION_CONFIG_FILE KELION_SECRET_ROOT KELION_SECCOMP_PROFILE
export KELION_BIND_PORT KELION_BROWSER_SUBNET KELION_BROWSER_WORKER_IP KELION_BROWSER_PROXY_IP

project=kelion-$inactive_slot
"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" down --remove-orphans >/dev/null 2>&1 || true
for directory in browser-api browser-egress converter-api converter-private; do
  install -d -o root -g 10050 -m 2770 "$KELION_RUNTIME_ROOT/$directory"
done
"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" config --quiet
"$COMPOSE_BIN" -p "$project" -f "$COMPOSE_FILE" up -d --no-build --remove-orphans --wait --wait-timeout 180

readiness=$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$KELION_BIND_PORT/readyz")
jq -e '.ready == true and .release.candidate == true and .release.sideEffectsActive == false' <<<"$readiness" >/dev/null \
  || die 'candidatul nu este ready și inactiv'
candidate_version=$(curl --fail --silent --show-error --max-time 10 "http://127.0.0.1:$KELION_BIND_PORT/api/version" | jq -er '.v')
[ "$candidate_version" = "${COMMIT_SHA:0:7}" ] || die 'versiunea candidatului nu corespunde commitului'

NODE_PROBE_IMAGE=node:22-bookworm-slim@sha256:a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066
docker run --rm --network none --user 1000:1000 --group-add 10050 \
  --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 128m \
  -v "$BUNDLE_DIR:/probe:ro" \
  -v "$KELION_RUNTIME_ROOT/browser-api:/run/kelion-browser-api:ro" \
  -v "$SECRET_ROOT/browser-worker-secret:/run/secrets/browser-worker-secret:ro" \
  "$NODE_PROBE_IMAGE" node /probe/probe-browser-ssrf.mjs
docker run --rm --network none --user 1000:1000 --group-add 10050 \
  --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 64 --memory 128m \
  -v "$BUNDLE_DIR:/probe:ro" \
  -v "$KELION_RUNTIME_ROOT/converter-api:/run/kelion-converter-api:ro" \
  -v "$SECRET_ROOT/converter-worker-secret:/run/secrets/converter-worker-secret:ro" \
  "$NODE_PROBE_IMAGE" node /probe/probe-converter-sandbox.mjs

temporary_proxy=$(mktemp -d "$RUNTIME_ROOT/proxy-validation.XXXXXX")
install -m 0644 "$BUNDLE_DIR/Caddyfile" "$temporary_proxy/Caddyfile"
printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' "$inactive_slot" > "$temporary_proxy/kelion-upstream.caddy"
chmod 0755 "$temporary_proxy"
chmod 0644 "$temporary_proxy/kelion-upstream.caddy"
docker run --rm --network kelion-proxy --user 1000:1000 --read-only \
  --cap-drop ALL --cap-add NET_BIND_SERVICE --security-opt no-new-privileges \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m,uid=1000,gid=1000,mode=0700 \
  -e PUBLIC_APP_DOMAIN="$PUBLIC_APP_DOMAIN" \
  -v "$temporary_proxy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$temporary_proxy:/etc/caddy/upstream:ro" \
  caddy:2@sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a \
  caddy validate --config /etc/caddy/Caddyfile
rm -f -- "$temporary_proxy/Caddyfile" "$temporary_proxy/kelion-upstream.caddy"
rmdir "$temporary_proxy"

install -m 0644 "$BUNDLE_DIR/Caddyfile" "$PROXY_CONFIG_ROOT/Caddyfile"
temporary_upstream=$(mktemp "$PROXY_CONFIG_ROOT/upstream/candidate.XXXXXX")
printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' "$inactive_slot" > "$temporary_upstream"
chmod 0644 "$temporary_upstream"
# Pentru un slot managed, următorul mv poate deveni public la reload. Din acest
# punct snapshotul nu mai poate fi aplicat fără risc de a pierde scrieri.
if [ "$destructive_cutover" = 1 ] && [ "$active_slot" != legacy ]; then
  mark_point_of_no_return
fi
mv "$temporary_upstream" "$UPSTREAM_FILE"

export PUBLIC_APP_DOMAIN KELION_PROXY_CONFIG_ROOT=$PROXY_CONFIG_ROOT KELION_PROXY_STATE_ROOT=$PROXY_STATE_ROOT
"$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" config --quiet
if docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true; then
  docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null
  docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null
else
  [ "$legacy_proxy_running" = 0 ] || ensure_containers_stopped kelion-caddy
  # La primul cutover UPSTREAM_FILE nu este public cât timp kelion-caddy deține
  # 80/443. Punctul ireversibil este chiar înainte ca noul proxy să poată primi
  # trafic; după el recovery-ul nu oprește candidatul și nu restaurează snapshotul.
  if [ "$destructive_cutover" = 1 ]; then
    mark_point_of_no_return
  fi
  "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" up -d --no-build --wait --wait-timeout 90
fi

temporary_active=$(mktemp "$RELEASE_STATE_ROOT/active.XXXXXX")
printf '%s\n' "$COMMIT_SHA" > "$temporary_active"
chown root:10050 "$temporary_active"
chmod 0640 "$temporary_active"
mv "$temporary_active" "$RELEASE_STATE_ROOT/active"

for _attempt in $(seq 1 18); do
  active_ready=$(curl --silent --show-error --max-time 10 "http://127.0.0.1:$KELION_BIND_PORT/readyz" || true)
  if jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$active_ready" >/dev/null 2>&1; then break; fi
  sleep 2
done
jq -e '.ready == true and .release.sideEffectsActive == true' <<<"${active_ready:-}" >/dev/null \
  || die 'activarea candidatului nu a fost observată'

public_ok=0
for _attempt in $(seq 1 18); do
  live_version=$(curl --fail --silent --show-error --max-time 12 "$PRODUCT_ORIGIN/api/version" | jq -r '.v // empty' || true)
  live_ready=$(curl --fail --silent --show-error --max-time 12 "$PRODUCT_ORIGIN/readyz" || true)
  if [ "$live_version" = "${COMMIT_SHA:0:7}" ] \
    && jq -e '.ready == true and .release.sideEffectsActive == true' <<<"$live_ready" >/dev/null 2>&1; then
    public_ok=1
    break
  fi
  sleep 5
done
[ "$public_ok" = 1 ] || die 'smoke-ul public nu confirmă commitul și readiness'

# Schedulerul persistent este o mutație de producție: îl instalăm, activăm și
# verificăm numai după dovada publică exactă. Cronul vechi dispare abia după ce
# timerul are o următoare rulare. Snapshotul rămâne activ până la ultima dovadă
# de release, astfel încât orice eșec ulterior restaurează întregul scheduler.
snapshot_backup_schedule
backup_schedule_mutating=1
activate_persistent_backup_script
install_backup_schedule
retire_legacy_backup_cron

# Pentru un plan distructiv writerul vechi este deja oprit înainte de backup;
# pentru orice alt plan îl oprim numai după smoke-ul public exact. Funcția este
# idempotentă și păstrează containerele pentru recovery.
stop_active_runtime

record=$(mktemp "$RUNTIME_ROOT/release.XXXXXX")
jq -n --arg commit "$COMMIT_SHA" --arg slot "$inactive_slot" --arg mode "$RELEASE_MODE" \
  --argjson ciRunId "$KELION_CI_RUN_ID" --argjson buildRunId "$KELION_BUILD_RUN_ID" \
  '{schema:1,commit:$commit,slot:$slot,mode:$mode,ciRunId:$ciRunId,buildRunId:$buildRunId,completedAt:(now|todateiso8601)}' > "$record"
chmod 0600 "$record"
mv "$record" "$RUNTIME_ROOT/last-release.json"
backup_schedule_mutating=0
if ! cleanup_backup_schedule_snapshot; then
  printf 'release: avertisment: snapshotul schedulerului a rămas root-only în runtime\n' >&2
fi
if ! cleanup_caddyfile_snapshot; then
  printf 'release: avertisment: snapshotul Caddyfile a rămas root-only în runtime\n' >&2
fi
db_restore_required=0
if [ "$destructive_cutover" = 1 ]; then
  [ "$point_of_no_return" = 1 ] || die 'release-ul distructiv nu a înregistrat point-of-no-return'
  write_recovery_journal completed 1 0
  clear_recovery_journal
fi
recovery_armed=0
trap - HUP INT TERM EXIT
if ! rm -f -- "$PROOF_FILE"; then
  printf 'release: avertisment: dovada backupului a rămas root-only în runtime\n' >&2
fi
printf 'release_ok commit=%s slot=%s\n' "$COMMIT_SHA" "$inactive_slot"
