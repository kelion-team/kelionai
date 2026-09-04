#!/usr/bin/env bash
# Auto-setup pentru sesiunile web ale agentului de dezvoltare.
# Pregătește proiectul ca agentul să poată face build / typecheck / lint fără
# configurare manuală. NU atinge producția și NU cere secrete reale.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

log() { printf '\033[36m[setup-web]\033[0m %s\n' "$*"; }

# 1. Dependențe backend
if [ -f backend/package.json ]; then
  log "instalez dependențe backend…"
  # fail-closed: `npm ci` iese cu eroare dacă lockfile-ul nu coincide; NU cădem
  # pe `npm install` (ar rescrie lockfile-ul și ar murdări worktree-ul).
  (cd backend && npm ci --no-audit --no-fund)
fi

# 2. Dependențe frontend
if [ -f frontend/package.json ]; then
  log "instalez dependențe frontend…"
  (cd frontend && npm ci --no-audit --no-fund)
fi

# 3. Verificare rapidă că proiectul compilează (nefatal — doar semnalează)
log "typecheck backend…"
(cd backend && npm run typecheck) || log "⚠ typecheck backend a raportat erori (vezi mai sus)"

log "gata. Comenzi utile: (backend) npm run build | npm run lint ; (frontend) npm run build"
