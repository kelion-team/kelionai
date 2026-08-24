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

for file in "$PRODUCT_FILE" "$COMPOSE_FILE" "$PROXY_COMPOSE_FILE" "$BUNDLE_DIR/Caddyfile" "$BUNDLE_DIR/backup.sh"; do
  [ -f "$file" ] || die "bundle incomplet: $(basename "$file")"
done

exec 8>"$ROOT/publicare.lock"
flock 8

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
for name in NODE_ENV PORT PUBLIC_APP_ORIGIN FRONTEND_ORIGIN ADMIN_EMAIL OPENAI_API_KEY_FILE OPENAI_LUNA_MODEL OPENAI_MEDIUM_MODEL OPENAI_HEAVY_MODEL OPENAI_MAX_MODEL OPENAI_REALTIME_MODEL OPENAI_REALTIME_TRANSCRIPTION_MODEL OPENAI_CALL_TRANSCRIPTION_MODEL OPENAI_TTS_MODEL OPENAI_IMAGE_MODEL OPENAI_VIDEO_MODEL OPENAI_VIDEO_PRICE_USD_MICROS_PER_SECOND OPENAI_VIDEO_SHUTDOWN_AT DATABASE_URL_FILE SESSION_SECRET_FILE GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_FILE GOOGLE_TOKEN_ENCRYPTION_KEY_ID GOOGLE_REDIRECT_URI CODEX_WORKER_ENABLED CODEX_WORKER_SECRET_FILE CONSTRUCTOR_PUBLISHER_ENABLED CONSTRUCTOR_PUBLISHER_SECRET_FILE CONSTRUCTOR_RELEASE_ENABLED CONSTRUCTOR_RELEASE_SECRET_FILE BROWSER_WORKER_SOCKET BROWSER_WORKER_SECRET_FILE CONVERTER_WORKER_SOCKET CONVERTER_WORKER_SECRET_FILE REVOLUT_MERCHANT_SECRET_KEY_FILE REVOLUT_WEBHOOK_SIGNING_SECRET_FILE VAPID_PRIVATE_KEY_FILE VISITOR_CHAT_TTL_SECONDS VISITOR_ANALYTICS_RETENTION_DAYS SESSION_ABSOLUTE_TTL_SECONDS SESSION_IDLE_TTL_SECONDS SESSION_TOUCH_INTERVAL_SECONDS SESSION_MAX_ACTIVE_PER_ACCOUNT SESSION_RECENT_REAUTH_SECONDS NATIVE_AUTH_REQUEST_TTL_SECONDS NATIVE_AUTH_EXCHANGE_TTL_SECONDS NATIVE_CHANNEL_TICKET_TTL_SECONDS OFFLINE_SYNC_MAX_TURNS OFFLINE_SYNC_MAX_TEXT_CHARS OFFLINE_SYNC_MAX_AGE_DAYS OFFLINE_SYNC_FUTURE_SKEW_SECONDS VOCAL_LIVE_IDLE_TIMEOUT_SECONDS PRIVACY_POLICY_UPDATED DATA_CONTROLLER_NAME PRIVACY_BACKUP_RETENTION_DAYS FINANCIAL_RETENTION_YEARS JOURNAL_RETENTION_DAYS MEDIA_RETENTION_DAYS CREDIT_PRICE_MINOR CHAT_TURN_PRICE_MINOR VOICE_LIVE_MINUTE_PRICE_MINOR CALL_UTTERANCE_PRICE_MINOR BILLING_FIRST_TOPUP_MIN_MINOR BILLING_TOPUP_STEP_MINOR BILLING_TOPUP_MIN_MINOR BILLING_TOPUP_MAX_MINOR LOW_CREDIT_THRESHOLD_MINOR LOW_CREDIT_TOPUP_MINOR PAYMENT_MODE PAYMENT_CONTRACT_VERIFIED REVOLUT_MERCHANT_API_VERSION REVOLUT_ORDER_EXPIRY PUSH_ENABLED VAPID_PUBLIC_KEY PUSH_ENDPOINT_HOSTS PUSH_MAX_SUBSCRIPTIONS GOOGLE_TTS_ENABLED GOOGLE_TTS_VOICE SEARCH_ENABLED MAIL_ENABLED RELEASE_CANDIDATE_MODE; do
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
for name in OPENAI_LUNA_MODEL OPENAI_MEDIUM_MODEL OPENAI_HEAVY_MODEL OPENAI_MAX_MODEL OPENAI_REALTIME_MODEL OPENAI_REALTIME_TRANSCRIPTION_MODEL OPENAI_CALL_TRANSCRIPTION_MODEL OPENAI_TTS_MODEL OPENAI_IMAGE_MODEL OPENAI_VIDEO_MODEL; do
  [[ "$(config_value "$name")" =~ ^gpt-[a-z0-9][a-z0-9._-]*$ ]] || die "$name lipsește sau este invalid"
done
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

migration_plan=$(run_migrator "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate -- --plan)
jq -e '.kind == "migrations_plan" and (.risk == "safe" or .risk == "destructive") and (.pending | type == "array")' <<<"$migration_plan" >/dev/null \
  || die 'planul migrărilor este invalid'

bash "$BUNDLE_DIR/backup.sh"
[ -s "$PROOF_FILE" ] || die 'backup-ul nu a produs dovada verificată'

pending_count=$(jq -er '.pending | length' <<<"$migration_plan")
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
  if [ "$(jq -er '.risk' <<<"$migration_plan")" = destructive ]; then
    migration_args+=(
      -e MIGRATION_BACKUP_PROOF_FILE=/run/proof/backup.json
      -e MIGRATION_BACKUP_PROOF_KEY_FILE=/run/secrets/migration-backup-proof-key
      -v "$PROOF_FILE:/run/proof/backup.json:ro"
      -v "$PROOF_KEY:/run/secrets/migration-backup-proof-key:ro"
    )
  fi
  migration_output=$(docker run "${migration_args[@]}" "$KELION_APP_IMAGE" npm --prefix /app/backend run --silent migrate)
  [ "$migration_output" = migrations_ok ] || die 'migrările nu au confirmat succesul'
fi

UPSTREAM_FILE=$PROXY_CONFIG_ROOT/upstream/kelion-upstream.caddy
old_upstream=''
[ ! -f "$UPSTREAM_FILE" ] || old_upstream=$(cat "$UPSTREAM_FILE")
case "$old_upstream" in
  *app-blue:8080*) active_slot=blue; inactive_slot=green ;;
  *app-green:8080*) active_slot=green; inactive_slot=blue ;;
  *) active_slot=legacy; inactive_slot=blue ;;
esac

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
docker run --rm --network kelion-proxy --user 1000:1000 \
  -e PUBLIC_APP_DOMAIN="$PUBLIC_APP_DOMAIN" \
  -v "$temporary_proxy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  -v "$temporary_proxy:/etc/caddy/upstream:ro" \
  caddy:2@sha256:98eb57b87c9be83995ff0dd16c75d3b78740046933347f939312823736326a5e \
  caddy validate --config /etc/caddy/Caddyfile
rm -f -- "$temporary_proxy/Caddyfile" "$temporary_proxy/kelion-upstream.caddy"
rmdir "$temporary_proxy"

old_marker=$(sed -n '1p' "$RELEASE_STATE_ROOT/active")
legacy_proxy_running=0
docker inspect -f '{{.State.Running}}' kelion-caddy 2>/dev/null | grep -qx true && legacy_proxy_running=1 || true
switched=0
rollback_switch() {
  [ "$switched" = 1 ] || return 0
  if [ -n "$old_upstream" ]; then
    temporary=$(mktemp "$PROXY_CONFIG_ROOT/upstream/rollback.XXXXXX")
    printf '%s\n' "$old_upstream" > "$temporary"
    chmod 0644 "$temporary"
    mv "$temporary" "$UPSTREAM_FILE"
    docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null 2>&1 || true
  fi
  temporary=$(mktemp "$RELEASE_STATE_ROOT/rollback.XXXXXX")
  printf '%s\n' "$old_marker" > "$temporary"
  chown root:10050 "$temporary"
  chmod 0640 "$temporary"
  mv "$temporary" "$RELEASE_STATE_ROOT/active"
  if [ "$legacy_proxy_running" = 1 ]; then
    "$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" down >/dev/null 2>&1 || true
    docker start kelion-caddy >/dev/null 2>&1 || true
  fi
}
trap 'rc=$?; if [ "$rc" -ne 0 ]; then rollback_switch; fi' EXIT

install -m 0644 "$BUNDLE_DIR/Caddyfile" "$PROXY_CONFIG_ROOT/Caddyfile"
temporary_upstream=$(mktemp "$PROXY_CONFIG_ROOT/upstream/candidate.XXXXXX")
printf 'reverse_proxy app-%s:8080 {\n\theader_up X-Kelion-Client-IP {client_ip}\n}\n' "$inactive_slot" > "$temporary_upstream"
chmod 0644 "$temporary_upstream"
mv "$temporary_upstream" "$UPSTREAM_FILE"
switched=1

export PUBLIC_APP_DOMAIN KELION_PROXY_CONFIG_ROOT=$PROXY_CONFIG_ROOT KELION_PROXY_STATE_ROOT=$PROXY_STATE_ROOT
"$COMPOSE_BIN" -p kelion-proxy -f "$PROXY_COMPOSE_FILE" config --quiet
if docker inspect -f '{{.State.Running}}' kelion-proxy 2>/dev/null | grep -qx true; then
  docker exec kelion-proxy caddy validate --config /etc/caddy/Caddyfile >/dev/null
  docker exec kelion-proxy caddy reload --config /etc/caddy/Caddyfile >/dev/null
else
  [ "$legacy_proxy_running" = 0 ] || docker stop --time 30 kelion-caddy >/dev/null
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
  live_ready=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 12 "$PRODUCT_ORIGIN/readyz" || true)
  if [ "$live_version" = "${COMMIT_SHA:0:7}" ] && [ "$live_ready" = 200 ]; then public_ok=1; break; fi
  sleep 5
done
[ "$public_ok" = 1 ] || die 'smoke-ul public nu confirmă commitul și readiness'

if [ "$active_slot" = blue || "$active_slot" = green ]; then
  "$COMPOSE_BIN" -p "kelion-$active_slot" -f "$COMPOSE_FILE" stop --timeout 30 >/dev/null 2>&1 || true
else
  for legacy in kelionai-app omniroute; do
    docker inspect "$legacy" >/dev/null 2>&1 && docker stop --time 30 "$legacy" >/dev/null || true
  done
fi

rm -f -- "$PROOF_FILE"
record=$(mktemp "$RUNTIME_ROOT/release.XXXXXX")
jq -n --arg commit "$COMMIT_SHA" --arg slot "$inactive_slot" --arg mode "$RELEASE_MODE" \
  --argjson ciRunId "$KELION_CI_RUN_ID" --argjson buildRunId "$KELION_BUILD_RUN_ID" \
  '{schema:1,commit:$commit,slot:$slot,mode:$mode,ciRunId:$ciRunId,buildRunId:$buildRunId,completedAt:(now|todateiso8601)}' > "$record"
chmod 0600 "$record"
mv "$record" "$RUNTIME_ROOT/last-release.json"
switched=0
trap - EXIT
printf 'release_ok commit=%s slot=%s\n' "$COMMIT_SHA" "$inactive_slot"
