#!/usr/bin/env bash
# Auto-setup pentru sesiunile Claude Code (web).
# Pregătește proiectul ca agentul să poată face build / typecheck / lint fără
# configurare manuală. NU atinge producția și NU cere secrete reale.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

log() { printf '\033[36m[claude-setup]\033[0m %s\n' "$*"; }

# 1. Dependențe backend
if [ -f backend/package.json ]; then
  log "instalez dependențe backend…"
  (cd backend && npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund)
fi

# 2. Dependențe frontend
if [ -f frontend/package.json ]; then
  log "instalez dependențe frontend…"
  (cd frontend && npm ci --no-audit --no-fund 2>/dev/null || npm install --no-audit --no-fund)
fi

# 3. Verificare rapidă că proiectul compilează (nefatal — doar semnalează)
log "typecheck backend…"
(cd backend && npm run typecheck) || log "⚠ typecheck backend a raportat erori (vezi mai sus)"

log "gata. Comenzi utile: (backend) npm run build | npm run lint ; (frontend) npm run build"
