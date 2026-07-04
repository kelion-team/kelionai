#!/bin/bash
# Autonomous repair with safety nets. Called by the bridge worker for a repair
# request. Fully autonomous, but the app CANNOT stay broken:
#   Gate 1 — must compile (else revert working tree, no deploy).
#   Gate 2 — after deploy, must pass health + a home-page smoke check.
#   Safety net — if unhealthy, hard-reset to the last good commit and redeploy.
set -uo pipefail
REPO=/root/Kelionai
cd "$REPO" || exit 1
DESC="${1:-}"
[ -z "$DESC" ] && { echo "NO_DESC"; exit 1; }
GOOD=$(git rev-parse HEAD)
echo "[$(date -Is)] REPAIR START (baseline $GOOD): $DESC"

# Auth for the subscription brain.
set -a; . /root/kelion/claude.env; set +a

# 1. Autonomous fix, isolated to the working tree.
claude -p --permission-mode acceptEdits --model claude-fable-5 \
  "Ești în repo-ul Kelionai (backend Node/Fastify TypeScript în backend/, frontend React/Vite în frontend/). Fă EXACT această reparație/modificare cerută de admin, corect și minimal, fără să strici altceva, apoi oprește-te. Nu face deploy, doar modifică codul. Cerere: $DESC" 2>&1 | tail -15

# 2. Build gate — both must compile or we abort WITHOUT deploying.
echo "[$(date -Is)] BUILD backend..."
if ! ( cd backend && npm ci --silent && npm run build ); then
  echo "BUILD_FAILED_BACKEND"; git checkout -- .; git clean -fdq; exit 2
fi
echo "[$(date -Is)] BUILD frontend..."
if ! ( cd frontend && npm ci --silent && npm run build ); then
  echo "BUILD_FAILED_FRONTEND"; git checkout -- .; git clean -fdq; exit 2
fi

# 3. Commit the fix (clear rollback boundary).
git add -A && git commit -q -m "auto-repair: $DESC" || true

# 4. Deploy to production.
echo "[$(date -Is)] DEPLOY..."
if ! railway up --service web --detach; then echo "DEPLOY_FAILED"; exit 3; fi

# 5. Health + home-page smoke check (up to 3 min).
ok=0
for i in $(seq 1 12); do
  sleep 15
  code=$(curl -s -o /dev/null -w "%{http_code}" https://kelionai.app/health --max-time 10 || echo 0)
  home=$(curl -s https://kelionai.app/ --max-time 10 | grep -c 'index-' || echo 0)
  if [ "$code" = "200" ] && [ "${home:-0}" -ge 1 ]; then ok=1; break; fi
done

# 6. Safety net — unhealthy → revert to the last good version.
if [ "$ok" != "1" ]; then
  echo "[$(date -Is)] UNHEALTHY -> ROLLBACK to $GOOD"
  git reset --hard "$GOOD"
  railway up --service web --detach || true
  echo "ROLLED_BACK"
  exit 4
fi
echo "[$(date -Is)] FIXED_AND_LIVE"
