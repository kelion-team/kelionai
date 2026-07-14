#!/bin/bash
# BACKUP + REPORNIRE SINCRONIZATĂ + VERIFICARE STARE — workerii Kelion pe VPS.
#
# Problema rezolvată (Adrian, 12 iul: „ce te blochează să pornești real?"):
# înainte de orice restart în producție nu exista backup, nu exista verificare
# că TOȚI workerii au pornit pe același cod proaspăt, iar divergența „cod în
# master / proces viu vechi" era greu de observat. Aici totul e determinist:
#   1. backup al executabilelor și configurațiilor înainte;
#   2. sincronizare forțată la origin/master;
#   3. copierea codului proaspăt pe CĂILE REALE rulate de systemd;
#   4. restart simultan al serviciilor;
#   5. verificare: is-active, md5 cod-rulat == repo, health bridge, dev/status.
#
# Rulare pe VPS (root):
#   bridge/restart-sincronizat.sh [serviciu1,serviciu2,...]
# Dacă nu se dau servicii, restartează pe toți: kelion-bridge, kelion-builder,
# kelion-paznic, kelion-deployer. Plus voice-agent și repairer-pool dacă există.
#
# Folosit de workflow-urile GitHub Actions (vps-restart.yml, vps-auto-restart.yml)
# prin SSH. Nu editează nimic în afara căilor Kelion.
set -euo pipefail

say() { echo "[$(date -Is)] $*"; }
warn() { echo "[$(date -Is)] ⚠️  $*" >&2; }

# ── CONFIG ───────────────────────────────────────────────────────────────────
REPO="${KELION_REPO:-/root/kelion/repo}"
# Găsește repo-ul real dacă variabila nu e setată.
if [ ! -d "$REPO/.git" ]; then
  for d in /root/kelion/repo /root/kelion /root/Kelionai; do
    if [ -d "$d/.git" ] && [ -d "$d/backend" ]; then REPO="$d"; break; fi
  done
fi
if [ ! -d "$REPO/.git" ]; then
  warn "NU găsesc repo-ul Kelion"; exit 1
fi

BACKUP_BASE="${KELION_BACKUP_DIR:-/root/kelion/backups}"
BACKUP_DIR="$BACKUP_BASE/$(date +%Y%m%d_%H%M%S)"
BASE_URL="${KELION_BASE:-https://kelionai.app}"
CLAUDE_ENV="${CLAUDE_ENV:-/root/kelion/claude.env}"
SECRET_FILE="${BRIDGE_SECRET_FILE:-/root/kelion/bridge-secret.txt}"

# Serviciile implicate (în ordinea de restart; paznicul e repornit după bridge).
DEFAULT_SERVICES="kelion-bridge kelion-paznic kelion-builder kelion-deployer"

# Mapare serviciu -> sursă în repo. Paznicul/deployerul pot avea sursă proprie
# sau pot reveni la builder; scriptul e tolerant: dacă nu găsește mapare, doar
# repornește serviciul existent fără să suprascrie ceva.
declare -A SRC_MAP=(
  [kelion-bridge]=bridge/kelion-bridge-linux.mjs
  [kelion-builder]=bridge/kelion-builder-server.mjs
  [kelion-deployer]=bridge/kelion-builder-server.mjs
)

# ── ARGUMENTE ────────────────────────────────────────────────────────────────
SERVICES="${1:-$DEFAULT_SERVICES}"
# Acceptă și listă virgulă.
SERVICES="${SERVICES//,/ }"

# ── 1. BACKUP ────────────────────────────────────────────────────────────────
say "backup în $BACKUP_DIR …"
mkdir -p "$BACKUP_DIR"/{exec,systemd,env}
for svc in $SERVICES; do
  exec_path=$(systemctl show "$svc" -p ExecStart --value 2>/dev/null | grep -oE '/[^ ]+\.mjs' | head -1 || true)
  if [ -n "$exec_path" ] && [ -f "$exec_path" ]; then
    cp -a "$exec_path" "$BACKUP_DIR/exec/$svc-$(basename "$exec_path")"
    say "  backup exec $svc: $exec_path"
  fi
  if [ -f "/etc/systemd/system/$svc.service" ]; then
    cp -a "/etc/systemd/system/$svc.service" "$BACKUP_DIR/systemd/"
  fi
  if [ -d "/etc/systemd/system/$svc.service.d" ]; then
    cp -a "/etc/systemd/system/$svc.service.d" "$BACKUP_DIR/systemd/"
  fi
done
# Backup config sensibile (fără valori în log).
cp -a "$CLAUDE_ENV" "$BACKUP_DIR/env/" 2>/dev/null || true
if [ -f "$SECRET_FILE" ]; then
  cp -a "$SECRET_FILE" "$BACKUP_DIR/env/" 2>/dev/null || true
fi
# Snapshot scurt al versiunii curente.
git -C "$REPO" log --oneline -1 > "$BACKUP_DIR/repo-version-before.txt" 2>/dev/null || true
say "backup terminat: $(find "$BACKUP_DIR" -type f | wc -l) fișiere"

# ── 2. SINCRONIZARE FORȚATĂ LA MASTER ────────────────────────────────────────
say "sincronizez repo-ul $REPO la origin/master …"
cd "$REPO"
git fetch origin master -q || { warn "git fetch a eșuat"; exit 1; }
git reset --hard origin/master -q || { warn "git reset a eșuat"; exit 1; }
say "cod la zi: $(git log --oneline -1)"

# ── 3. COPIERE COD PROASPĂT PE CĂILE REALE + RESTART ─────────────────────────
# Repornirea se face serviciu cu serviciu, cu mic delay, ca systemd să nu iasă
# din resurse. Ordinea: bridge mai întâi, apoi ceilalți.
refresh_one() {
  local svc="$1"
  local src="${SRC_MAP[$svc]:-}"
  local exec_path
  exec_path=$(systemctl show "$svc" -p ExecStart --value 2>/dev/null | grep -oE '/[^ ]+\.mjs' | head -1 || true)
  if [ -n "$src" ] && [ -f "$REPO/$src" ] && [ -n "$exec_path" ]; then
    cp -a "$REPO/$src" "$exec_path"
    say "$svc: copiat $src → $exec_path"
  elif [ -n "$src" ] && [ ! -f "$REPO/$src" ]; then
    warn "$svc: sursa $src nu există în repo"
  fi
  systemctl restart "$svc" || warn "$svc: restartul a dat eroare"
}

say "repornesc serviciile: $SERVICES"
for svc in $SERVICES; do
  refresh_one "$svc"
  sleep 1
done

# Așteptăm ca procesele să-și deschidă socket-urile / benzi.
sleep 4

# ── 4. VERIFICARE STARE ──────────────────────────────────────────────────────
say "=== VERIFICARE STARE ==="
all_active=true
for svc in $SERVICES; do
  st=$(systemctl is-active "$svc" 2>/dev/null || true)
  if [ "$st" = "active" ]; then
    say "  $svc: $st"
  else
    warn "  $svc: $st"
    all_active=false
  fi
done

# md5 cod-rulat vs repo (dovedește că procesele chiar rulează codul nou).
say "=== COD RULAT vs REPO (md5) ==="
code_ok=true
for pair in "kelion-builder:bridge/kelion-builder-server.mjs" "kelion-bridge:bridge/kelion-bridge-linux.mjs"; do
  svc="${pair%%:*}"; src="${pair##*:}"
  exec_path=$(systemctl show "$svc" -p ExecStart --value 2>/dev/null | grep -oE '/[^ ]+\.mjs' | head -1 || true)
  if [ -n "$exec_path" ] && [ -f "$exec_path" ] && [ -f "$REPO/$src" ]; then
    a=$(md5sum "$exec_path" | awk '{print $1}')
    b=$(md5sum "$REPO/$src" | awk '{print $1}')
    if [ "$a" = "$b" ]; then
      say "  $svc: COD LA ZI"
    else
      warn "  $svc: COD VECHI (rulat != repo)"
      code_ok=false
    fi
  else
    warn "  $svc: nu pot compara ($exec_path)"
  fi
done

# Health bridge (dovedește că workerul nou trage joburi).
say "=== HEALTH BRIDGE ==="
BRIDGE_SECRET=""
if [ -f "$SECRET_FILE" ]; then
  BRIDGE_SECRET=$(cat "$SECRET_FILE" | tr -d '[:space:]')
fi
if [ -z "$BRIDGE_SECRET" ] && [ -f "$CLAUDE_ENV" ]; then
  # Eliminăm whitespace și ghilimelele duble din jurul valorii.
  BRIDGE_SECRET=$(awk -F= '/^BRIDGE_SECRET=/{gsub(/[[:space:]\"]/,"",$2); print $2; exit}' "$CLAUDE_ENV" || true)
fi
health_ok=false
if [ -n "$BRIDGE_SECRET" ]; then
  for i in 1 2 3 4 5; do
    resp=$(curl -sS -m 8 -H "x-bridge-secret: $BRIDGE_SECRET" "$BASE_URL/api/bridge/health" 2>/dev/null || true)
    if echo "$resp" | grep -q '"online":true'; then
      say "  /api/bridge/health: $resp"
      health_ok=true
      break
    fi
    sleep 2
  done
fi
if [ "$health_ok" = false ]; then
  warn "  /api/bridge/health nu raportează online=true"
fi

# Dev/status (serverul e sus și puntea e văzută).
say "=== DEV/STATUS ==="
dev_status=$(curl -sS -m 8 "$BASE_URL/api/dev/status" 2>/dev/null || true)
if echo "$dev_status" | grep -q '"bridge":true'; then
  say "  /api/dev/status: bridge=true"
else
  warn "  /api/dev/status nu arată bridge=true"
fi

# ── REZULTAT ─────────────────────────────────────────────────────────────────
if [ "$all_active" = true ] && [ "$code_ok" = true ] && [ "$health_ok" = true ]; then
  say "✅ RESTART SINCRONIZAT REUȘIT — toți workerii activi pe cod proaspăt, health OK."
  exit 0
else
  warn "RESTART ÎNCHEIAT CU PROBLEME — vezi detaliile de mai sus."
  warn "Pentru rollback: $BACKUP_DIR"
  exit 1
fi
