#!/usr/bin/env bash
# VINDECĂTORUL DE RULĂRI ROȘII (Adrian, 27 iul: „dacă are ceva roșu să
# escaladeze și să repare până ajunge verde").
#
# Determinist, zero AI: la fiecare rulare (cron, 10 min) ia ultimele rulări
# EȘUATE ale workflow-ului deploy de pe GitHub și, DACĂ publicarea reală e
# sănătoasă (live == vârful lui master — adevărul, nu istoricul), le rerulează
# ca să iasă verzi. Cazul tipic: deploy #493 — două publicări în cursă, una a
# reușit, cealaltă a rămas roșie degeaba; după lacătul global de publicare,
# rerularea iese verde prin ieșirea-devreme („deja publicat").
#
# Plafoane: maxim 2 rerulări per rulare (vindecator.state ține evidența);
# după a 2-a rerulare tot roșie → alertă pe email prin /api/ops/alert
# (throttle pe server) — omul decide, mașina nu insistă la nesfârșit.
# Dacă live != master, NU rerulează nimic: întâi se vindecă publicarea reală
# (treaba auto-publicării), abia apoi istoricul.
set -u
ENVFILE=/root/kelion/kelionai.env
STATE=/root/kelion/vindecator.state
LOCK=/root/kelion/vindecator.lock
API=https://api.github.com/repos/kelion-team/kelionai

exec 9>"$LOCK"
flock -n 9 || exit 0

TOKEN=$(grep '^GITHUB_TOKEN=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
BRIDGE=$(grep '^BRIDGE_SECRET=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
[ -n "$TOKEN" ] || exit 0
touch "$STATE"

gh() { curl -s -m 20 -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$@"; }

# Sănătatea REALĂ întâi: live trebuie să fie chiar vârful lui master.
MASTER=$(gh -H 'Accept: application/vnd.github.sha' "$API/commits/master" | head -c 40)
SHORT=$(printf '%s' "$MASTER" | cut -c1-7)
LIVE=$(curl -s -m 8 http://127.0.0.1:8080/api/version | grep -o '"v":"[^"]*"' | cut -d'"' -f4 || true)
[ "$LIVE" = "$SHORT" ] || exit 0   # publicarea reală nu e sincronă — nu atingem istoricul

# Rulările eșuate RECENTE (48h) ale deploy-ului. Parsare cu python3, nu grep:
# JSON-ul conține zeci de câmpuri „id" străine (check_suite, actor...) — la
# prima rulare grep-ul a prins id-uri false și a rerulat/alertat aiurea.
RUNS=$(gh "$API/actions/workflows/deploy.yml/runs?status=failure&per_page=15" | python3 -c '
import sys, json, datetime
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=48)
for r in data.get("workflow_runs", []):
    try:
        at = datetime.datetime.fromisoformat(r["created_at"].replace("Z", "+00:00"))
        if at >= cutoff:
            print(r["id"])
    except Exception:
        pass
' 2>/dev/null | head -15)

for RID in $RUNS; do
  N=$(grep -c "^$RID:" "$STATE" || true)
  if [ "$N" -ge 2 ]; then
    if ! grep -q "^$RID:alerted" "$STATE"; then
      echo "$RID:alerted" >> "$STATE"
      [ -n "$BRIDGE" ] && curl -s -m 10 -X POST -H "x-bridge-secret: $BRIDGE" \
        -H 'content-type: application/json' \
        -d "{\"key\":\"vindecator_$RID\",\"subject\":\"[Kelion] Rulare deploy ROSIE si dupa 2 rerulari: $RID\",\"body\":\"Rularea $RID a ramas rosie dupa 2 rerulari automate, desi live == master ($SHORT). Vezi: https://github.com/kelion-team/kelionai/actions/runs/$RID\"}" \
        http://127.0.0.1:8080/api/ops/alert > /dev/null || true
    fi
    continue
  fi
  echo "$RID:rerun-$(date -u +%H%M)" >> "$STATE"
  echo "[vindecator] $(date -u +%H:%M) rerulez $RID (incercarea $((N + 1)))"
  gh -X POST "$API/actions/runs/$RID/rerun-failed-jobs" > /dev/null || true
done
