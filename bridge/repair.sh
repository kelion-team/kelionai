#!/bin/bash
# Autonomous repair with safety nets. Called by the bridge worker for a repair
# request. Fully autonomous, but the app CANNOT stay broken:
#   Gate 1 — must compile (else revert working tree, no deploy).
#   Gate 2 — after deploy, must pass health + a home-page smoke check.
#   Safety net — if unhealthy, reset to origin/master (the ONE source of truth).
#
# REGULA 100% SINCRON (Adrian, 10 iul): producția = master, NICIODATĂ un commit
# local vechi. Cauza reverterilor „build fantomă": scriptul lua ca „bun" HEAD-ul
# LOCAL al VPS-ului, care divergase din auto-reparări → publica cod VECHI peste
# deploy-ul corect. De-acum baseline-ul e ORIGIN/MASTER, nu HEAD-ul local; iar
# reparația reușită se ÎMPINGE în master, ca să rămână sincron și să nu diveargă.
set -uo pipefail
REPO=/root/Kelionai
cd "$REPO" || exit 1
DESC="${1:-}"
[ -z "$DESC" ] && { echo "NO_DESC"; exit 1; }
# Punct de plecare CURAT = master de pe GitHub (nu starea locală, oricât de veche).
git fetch origin master || { echo "FETCH_FAILED"; exit 1; }
git reset --hard origin/master
GOOD=$(git rev-parse HEAD) # = origin/master, adevărul unic
echo "[$(date -Is)] REPAIR START (baseline master $GOOD): $DESC"

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

# 6. Safety net — unhealthy → înapoi la MASTER (adevărul unic), redeploy. NU la
#    un HEAD local vechi (aia era cauza reverterilor „build fantomă").
if [ "$ok" != "1" ]; then
  echo "[$(date -Is)] UNHEALTHY -> ROLLBACK la master $GOOD"
  git reset --hard "$GOOD"
  railway up --service web --detach || true
  echo "ROLLED_BACK"
  exit 4
fi

# 7. Reușit + sănătos → ÎMPINGE fixul în master. Așa Kelion PUBLICĂ cod NOU
#    corect care DEVINE adevărul (master avansează curat cu +1 commit), nu un
#    commit local care diverge și readuce stale la următorul deploy de pe VPS.
if git push origin HEAD:master; then
  echo "[$(date -Is)] FIXED_AND_LIVE + PUSHED_TO_MASTER ($(git rev-parse --short HEAD))"
else
  echo "[$(date -Is)] FIXED_AND_LIVE dar PUSH_LA_MASTER_A_EȘUAT — sincronizează manual (altfel VPS-ul diverge iar)"
fi
