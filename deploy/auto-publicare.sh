#!/usr/bin/env bash
# AUTO-PUBLICARE: master -> live, cu retry limitat și reparație automată.
# O singură tentativă imediată, apoi 5/15/30 minute; al patrulea eșec pune
# commitul în carantină. Un commit nou resetează automat carantina.
umask 077

BASE="${AUTO_BASE:-/root/kelion}"
ENVFILE="${AUTO_ENVFILE:-$BASE/kelionai.env}"
REPO="${AUTO_REPO:-$BASE/repo}"
ATELIER="${AUTO_ATELIER:-$BASE/atelier}"
LOCK="${AUTO_LOCK:-$BASE/auto-publicare.lock}"
STATE_FILE="${AUTO_STATE_FILE:-$BASE/auto-publicare.state}"
ATTEMPT_DIR="${AUTO_ATTEMPT_DIR:-$BASE/auto-publicare-attempts}"
DEPLOY_SCRIPT="${AUTO_DEPLOY_SCRIPT:-$REPO/deploy/deploy.sh}"
HEALTH_SCRIPT="${AUTO_HEALTH_SCRIPT:-$REPO/deploy/plasa-sanatate.mjs}"
HEALTH_LOG="${AUTO_HEALTH_LOG:-$BASE/plasa-sanatate.log}"
CONSTRUCTOR_WORKER="${AUTO_CONSTRUCTOR_WORKER:-$BASE/constructor-worker.sh}"
CONSTRUCTOR_LOG="${AUTO_CONSTRUCTOR_LOG:-$BASE/constructor.log}"
VERSION_URL="${AUTO_VERSION_URL:-http://127.0.0.1:8080/api/version}"
TOOL_URL="${AUTO_TOOL_URL:-http://127.0.0.1:8080/api/constructor/tool}"
DOCKER_BIN="${AUTO_DOCKER_BIN:-docker}"
CURL_BIN="${AUTO_CURL_BIN:-curl}"
MAX_FAILURES="${AUTO_MAX_FAILURES:-4}"
BACKOFF_1="${AUTO_BACKOFF_1:-300}"
BACKOFF_2="${AUTO_BACKOFF_2:-900}"
BACKOFF_3="${AUTO_BACKOFF_3:-1800}"
NOW="${AUTO_NOW:-$(date +%s)}"

mkdir -p "$BASE" "$ATTEMPT_DIR"
exec 9>"$LOCK"
flock -n 9 || exit 0

WORK=$(mktemp -d "$BASE/.auto-publicare.XXXXXX") || exit 1
cleanup_work() {
  rm -f "$WORK"/* 2>/dev/null || true
  rmdir "$WORK" 2>/dev/null || true
}
trap cleanup_work EXIT

log() {
  printf '[auto-publicare] %s %s\n' "$(date -u +'%Y-%m-%dT%H:%M:%SZ')" "$*"
}

env_value() {
  local key="$1" line value
  line=$(grep -m1 "^${key}=" "$ENVFILE" 2>/dev/null || true)
  value=${line#*=}
  case "$value" in
    \"*\") value=${value#\"}; value=${value%\"} ;;
    \'*\') value=${value#\'}; value=${value%\'} ;;
  esac
  printf '%s' "$value"
}

query_live() {
  local phase="${1:-pre}" raw override=''
  if [ "$phase" = post ] && [ "${AUTO_POST_LIVE_OVERRIDE+x}" = x ]; then
    override=$AUTO_POST_LIVE_OVERRIDE
    printf '%s' "$override"
    return 0
  fi
  if [ "$phase" = pre ] && [ "${AUTO_LIVE_OVERRIDE+x}" = x ]; then
    override=$AUTO_LIVE_OVERRIDE
    printf '%s' "$override"
    return 0
  fi
  raw=$("$CURL_BIN" -fsS -m 8 "$VERSION_URL" 2>/dev/null || true)
  python3 -c 'import json,sys
try:
 print(str(json.load(sys.stdin).get("v", "")))
except Exception:
 print("")' <<<"$raw"
}

wait_for_live() {
  local expected="$1" i got sleep_s="${AUTO_LIVE_RETRY_SLEEP:-2}"
  i=1
  while [ "$i" -le 5 ]; do
    got=$(query_live post)
    [ "$got" = "$expected" ] && return 0
    [ "$i" -lt 5 ] && sleep "$sleep_s"
    i=$((i + 1))
  done
  return 1
}

STATE_SHA=''
FAILURES=0
NEXT_AT=0
QUARANTINED=0
REPAIR_ENQUEUED=0
LAST_RC=0
LAST_LOG=''
load_state() {
  local key value
  [ -f "$STATE_FILE" ] || return 0
  while IFS='=' read -r key value; do
    value=${value%$'\r'}
    case "$key" in
      SHA) [[ "$value" =~ ^[0-9a-f]{40}$ ]] && STATE_SHA=$value ;;
      FAILURES) [[ "$value" =~ ^[0-9]+$ ]] && FAILURES=$value ;;
      NEXT_AT) [[ "$value" =~ ^[0-9]+$ ]] && NEXT_AT=$value ;;
      QUARANTINED) [[ "$value" =~ ^[01]$ ]] && QUARANTINED=$value ;;
      REPAIR_ENQUEUED) [[ "$value" =~ ^[01]$ ]] && REPAIR_ENQUEUED=$value ;;
      LAST_RC) [[ "$value" =~ ^[0-9]+$ ]] && LAST_RC=$value ;;
      LAST_LOG) [[ "$value" =~ ^[-/._a-zA-Z0-9]+$ ]] && LAST_LOG=$value ;;
    esac
  done < "$STATE_FILE"
}

write_state() {
  local tmp="$STATE_FILE.tmp.$$"
  {
    printf 'SHA=%s\n' "$STATE_SHA"
    printf 'FAILURES=%s\n' "$FAILURES"
    printf 'NEXT_AT=%s\n' "$NEXT_AT"
    printf 'QUARANTINED=%s\n' "$QUARANTINED"
    printf 'REPAIR_ENQUEUED=%s\n' "$REPAIR_ENQUEUED"
    printf 'LAST_RC=%s\n' "$LAST_RC"
    printf 'LAST_LOG=%s\n' "$LAST_LOG"
  } > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$STATE_FILE"
}

fetch_master() {
  if [ "${AUTO_MASTER_OVERRIDE+x}" = x ]; then
    printf '%s' "$AUTO_MASTER_OVERRIDE"
    return 0
  fi
  GITHUB_TOKEN="${GITHUB_TOKEN:-$(env_value GITHUB_TOKEN)}"
  export GITHUB_TOKEN
  [ -n "$GITHUB_TOKEN" ] || return 1
  cat > "$WORK/askpass" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *) printf '%s\n' "$GITHUB_TOKEN" ;;
esac
ASKPASS
  chmod 700 "$WORK/askpass"
  GIT_ASKPASS="$WORK/askpass" GIT_TERMINAL_PROMPT=0 \
    git ls-remote https://github.com/kelion-team/kelionai.git refs/heads/master 2>/dev/null \
    | awk 'NR == 1 { print $1 }'
}

snapshot_containers() {
  "$DOCKER_BIN" ps -aq 2>/dev/null | sort -u > "$1" || : > "$1"
}

cleanup_new_stopped_containers() {
  local before="$1" after="$WORK/containers.after" fresh="$WORK/containers.new"
  local id info status name
  snapshot_containers "$after"
  comm -13 "$before" "$after" > "$fresh"
  while IFS= read -r id; do
    [ -n "$id" ] || continue
    info=$("$DOCKER_BIN" inspect -f '{{.State.Status}} {{.Name}}' "$id" 2>/dev/null || true)
    status=${info%% *}
    name=${info#* }
    case "$name" in
      /kelionai-app|/kelion-caddy|/omniroute) continue ;;
    esac
    case "$status" in
      running|restarting|'') continue ;;
    esac
    if "$DOCKER_BIN" rm "$id" >/dev/null 2>&1; then
      log "container intermediar oprit curățat: ${id:0:12}"
    fi
  done < "$fresh"
}

bridge_job_id() {
  local order_file="$1" secret payload response headers http_code
  secret="${BRIDGE_SECRET:-$(env_value BRIDGE_SECRET)}"
  [ -n "$secret" ] || return 2
  payload="$WORK/tool-payload.json"
  response="$WORK/tool-response.json"
  headers="$WORK/tool-headers"
  printf 'x-bridge-secret: %s\n' "$secret" > "$headers"
  python3 - "$order_file" > "$payload" <<'PY'
import json, pathlib, sys
order = pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')
json.dump({'name': 'build_software', 'args': {'order': order}}, sys.stdout, ensure_ascii=False)
PY
  http_code=$("$CURL_BIN" -sS -m 30 -o "$response" -w '%{http_code}' \
    -H @"$headers" -H 'content-type: application/json' --data-binary @"$payload" \
    "$TOOL_URL" 2>/dev/null || true)
  [ "$http_code" = 200 ] || return 3
  python3 - "$response" <<'PY'
import json, pathlib, sys
try:
    outer = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
    inner = outer.get('rezultat', {})
    if isinstance(inner, str):
        inner = json.loads(inner)
    job = inner.get('job') if isinstance(inner, dict) else None
    if inner.get('ok') is True and isinstance(job, int) and job > 0:
        print(job)
        raise SystemExit(0)
    raise SystemExit(4)
except Exception:
    raise SystemExit(4)
PY
}

direct_job_id() {
  local order_file="$1" result="$WORK/direct-job.out"
  [ -f "$ATELIER/backend/dist/db.js" ] || return 2
  KELION_ATELIER="$ATELIER" node --env-file="$ENVFILE" --input-type=module - "$order_file" > "$result" 2>/dev/null <<'NODE'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
const base = process.env.KELION_ATELIER
const order = fs.readFileSync(process.argv[2], 'utf8').trim()
const evaluator = await import(pathToFileURL(`${base}/backend/dist/services/evalOrdinConstructor.js`).href)
const db = await import(pathToFileURL(`${base}/backend/dist/db.js`).href)
const ev = evaluator.evalueazaOrdin(order)
if (!ev.trece) process.exit(3)
const job = await db.createBuildJob('kelion-auto-publicare', order)
if (!Number.isInteger(job) || job <= 0) process.exit(4)
console.log(job)
NODE
  local rc=$?
  [ "$rc" -eq 0 ] || return "$rc"
  tail -n 1 "$result"
}

enqueue_repair() {
  local order_file="$1" job=''
  [ "${AUTO_SKIP_REPAIR:-0}" = 1 ] && return 2
  job=$(bridge_job_id "$order_file" 2>/dev/null || true)
  if [[ "$job" =~ ^[0-9]+$ ]]; then
    log "reparație pusă prin bridge în ordinul #$job"
  else
    job=$(direct_job_id "$order_file" 2>/dev/null || true)
    if ! [[ "$job" =~ ^[0-9]+$ ]]; then
      log 'reparația nu a putut fi pusă în coadă; va fi reîncercată la următoarea tentativă eligibilă'
      return 1
    fi
    log "reparație pusă prin fallback-ul DB canonic în ordinul #$job (live încă are dispatcherul vechi)"
  fi
  if [ -x "$CONSTRUCTOR_WORKER" ]; then
    nohup "$CONSTRUCTOR_WORKER" >> "$CONSTRUCTOR_LOG" 2>&1 </dev/null &
  fi
  return 0
}

make_repair_order() {
  local output="$1" attempt_log="$2" master="$3" live="$4" rc="$5" failures="$6"
  {
    printf 'Repară auto-publicarea pentru commitul master %s, care nu ajunge live.\n' "$master"
    printf 'Dovadă: live=%s, cod ieșire deploy=%s, eșec consecutiv=%s.\n' "${live:-indisponibil}" "$rc" "$failures"
    printf 'Reproduce exact buildul commitului, identifică prima cauză reală, repară codul fără să slăbești testele și deschide PR.\n'
    printf 'Criteriu: frontend și backend build/typecheck/lint/tests au 0 eșecuri și 0 warnings în codul aplicației; deployul ajunge la același SHA și /api/version răspunde 200.\n'
    printf '\nCoada jurnalului deploy (secrete mascate):\n'
    tail -n 120 "$attempt_log" 2>/dev/null | sed -E 's/([A-Z0-9_]*(TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*=)[^[:space:]]+/\1[REDACTED]/g' | tail -c 8000
  } > "$output"
}

MASTER=$(fetch_master || true)
if ! [[ "$MASTER" =~ ^[0-9a-f]{40}$ ]]; then
  log 'master necitibil; nu pornesc niciun deploy'
  exit 0
fi
SHORT=${MASTER:0:7}
LIVE=$(query_live pre)

load_state
if [ "$STATE_SHA" != "$MASTER" ]; then
  STATE_SHA=$MASTER
  FAILURES=0
  NEXT_AT=0
  QUARANTINED=0
  REPAIR_ENQUEUED=0
  LAST_RC=0
  LAST_LOG=''
  write_state
fi

if [ "$LIVE" = "$SHORT" ]; then
  FAILURES=0
  NEXT_AT=0
  QUARANTINED=0
  REPAIR_ENQUEUED=0
  LAST_RC=0
  LAST_LOG=''
  write_state
  exit 0
fi

[ "$QUARANTINED" -eq 1 ] && exit 0
[ "$NOW" -lt "$NEXT_AT" ] && exit 0

STAMP=$(date -u +'%Y%m%d-%H%M%S')
ATTEMPT_LOG="$ATTEMPT_DIR/${SHORT}-${STAMP}-f$((FAILURES + 1)).log"
LAST_LOG=$ATTEMPT_LOG
BEFORE="$WORK/containers.before"
snapshot_containers "$BEFORE"
log "tentativă $((FAILURES + 1)) pentru master=$SHORT live=${LIVE:-indisponibil}; jurnal=$ATTEMPT_LOG"

bash "$DEPLOY_SCRIPT" > "$ATTEMPT_LOG" 2>&1
DEPLOY_RC=$?
if [ "$DEPLOY_RC" -eq 0 ] && ! wait_for_live "$SHORT"; then
  printf '\n[auto-publicare] deploy a ieșit 0, dar live nu este %s\n' "$SHORT" >> "$ATTEMPT_LOG"
  DEPLOY_RC=70
fi

if [ "$DEPLOY_RC" -eq 0 ] && [ "${AUTO_SKIP_HEALTH:-0}" != 1 ] && [ -f "$HEALTH_SCRIPT" ] && [ -n "$LIVE" ]; then
  GITHUB_TOKEN="${GITHUB_TOKEN:-$(env_value GITHUB_TOKEN)}" node "$HEALTH_SCRIPT" "$LIVE" "$SHORT" >> "$HEALTH_LOG" 2>&1
  HEALTH_RC=$?
  if [ "$HEALTH_RC" -ne 0 ]; then
    printf '\n[auto-publicare] plasa de sănătate a ieșit cu %s\n' "$HEALTH_RC" >> "$ATTEMPT_LOG"
    DEPLOY_RC=71
  elif ! wait_for_live "$SHORT"; then
    printf '\n[auto-publicare] plasa de sănătate a retras versiunea %s\n' "$SHORT" >> "$ATTEMPT_LOG"
    DEPLOY_RC=72
  fi
fi

if [ "$DEPLOY_RC" -eq 0 ]; then
  FAILURES=0
  NEXT_AT=0
  QUARANTINED=0
  REPAIR_ENQUEUED=0
  LAST_RC=0
  write_state
  log "succes: live=$SHORT; retry-urile au fost resetate"
  exit 0
fi

LAST_RC=$DEPLOY_RC
cleanup_new_stopped_containers "$BEFORE"
FAILURES=$((FAILURES + 1))

if [ "$REPAIR_ENQUEUED" -eq 0 ]; then
  ORDER_FILE="$WORK/repair-order.txt"
  make_repair_order "$ORDER_FILE" "$ATTEMPT_LOG" "$MASTER" "$LIVE" "$DEPLOY_RC" "$FAILURES"
  if enqueue_repair "$ORDER_FILE"; then
    REPAIR_ENQUEUED=1
  fi
fi

if [ "$FAILURES" -ge "$MAX_FAILURES" ]; then
  QUARANTINED=1
  NEXT_AT=0
  write_state
  log "carantină: commitul $SHORT a eșuat de $FAILURES ori; numai un commit nou îl deblochează"
  exit 0
fi

case "$FAILURES" in
  1) DELAY=$BACKOFF_1 ;;
  2) DELAY=$BACKOFF_2 ;;
  *) DELAY=$BACKOFF_3 ;;
esac
NEXT_AT=$((NOW + DELAY))
write_state
log "eșec rc=$DEPLOY_RC pentru $SHORT; următoarea tentativă eligibilă peste ${DELAY}s"
exit 0