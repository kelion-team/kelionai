#!/bin/bash
# Autonomous repair with safety nets. Called by the bridge worker for a repair
# request. Fully autonomous, but the app CANNOT stay broken:
#   Gate 1 — must compile (else revert working tree, nothing pushed).
#   (22 iul 2026) Railway a fost SCOS: scriptul NU mai publică nimic — împinge
#   fixul în master, iar publicarea o face pipeline-ul gazdei (VPS), cu dovadă.
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

# 4. (Railway scos, 22 iul 2026) NU se mai publică de aici. Fixul compilat se
#    împinge în master (pasul de mai jos); publicarea efectivă e treaba
#    pipeline-ului gazdei, cu verificare reală — nu a scriptului de reparație.

# 5. Reușit → ÎMPINGE fixul în master. Așa Kelion PUBLICĂ cod NOU corect care
#    DEVINE adevărul (master avansează curat cu +1 commit), nu un commit local
#    care diverge și readuce stale la următoarea sincronizare de pe VPS.
if git push origin HEAD:master; then
  echo "[$(date -Is)] FIXED_AND_LIVE + PUSHED_TO_MASTER ($(git rev-parse --short HEAD))"
else
  echo "[$(date -Is)] FIXED_AND_LIVE dar PUSH_LA_MASTER_A_EȘUAT — sincronizează manual (altfel VPS-ul diverge iar)"
fi
