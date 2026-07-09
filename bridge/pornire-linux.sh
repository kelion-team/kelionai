#!/bin/bash
# PORNIRE + SĂNĂTATE PUNTE KELION — rulat pe VPS-ul Linux.
# Aduce producția la codul VERIFICAT (master) și repornește serviciile care
# trebuie — în special PAZNICUL (de-aia apare ● Linux stins în admin).
#
# NU comută workerul punții: cele 10 benzi WS sunt sockets inactivi (zero
# tokeni), iar becul ● Bridge se colorează după numărul lor — un worker fără
# benzi l-ar face roșu degeaba.
#
# Non-distructiv: `git pull --ff-only` NU șterge nimic; dacă VPS-ul are commituri
# locale care nu se pot avansa curat, se OPREȘTE și îți spune, fără să strice.
# Fără `set -e`: fiecare pas merge până la capăt chiar dacă unul dă o eroare.
set -uo pipefail

BASE="https://kelionai.app"
say() { echo "[$(date -Is)] $*"; }

# 0. Găsește repo-ul (calea diferă între mașini).
REPO=""
for d in /root/kelion/repo /root/Kelionai /root/kelion; do
  if [ -d "$d/.git" ] && [ -d "$d/backend" ]; then REPO="$d"; break; fi
done
[ -z "$REPO" ] && { say "NU găsesc repo-ul (căutat /root/kelion/repo, /root/Kelionai, /root/kelion)"; exit 1; }
cd "$REPO" || exit 1
say "repo: $REPO"

# 1. Cod la zi, NON-DISTRUCTIV. Fără --ff-only forțat: dacă nu se poate avansa
#    curat, oprește-te și raportează (nu călca peste munca locală / worker off-repo).
say "aduc master…"
git fetch origin master || { say "⚠️ git fetch a eșuat — verifică rețeaua/credentialele git"; exit 1; }
if ! git pull --ff-only origin master; then
  say "⚠️ NU pot avansa curat (commituri locale pe VPS). Rezolvă manual: 'git status',"
  say "   apoi 'git stash' + 'git pull --ff-only origin master' dacă vrei să păstrezi munca locală."
  exit 1
fi
say "cod la zi: $(git rev-parse --short HEAD)"

# 2. Deploy pe producție (Railway, serviciul web).
say "deploy Railway (poate dura câteva minute)…"
if ! railway up --service web --detach; then
  say "⚠️ railway up a eșuat — verifică login-ul railway pe VPS (railway whoami)"
fi

# 3. Repornește DOAR serviciile Kelion care există pe mașina asta.
for svc in kelion-bridge kelion-paznic kelion-builder kelion-deployer; do
  if systemctl list-unit-files "$svc.service" >/dev/null 2>&1 && \
     systemctl list-unit-files "$svc.service" 2>/dev/null | grep -q "^$svc.service"; then
    systemctl restart "$svc" && say "restart $svc → $(systemctl is-active "$svc")"
  else
    say "($svc nu există aici — sar peste)"
  fi
done

# 4. Verificare live (până la ~40s): puntea online + paznicul raportează.
say "verific live pe $BASE …"
bridge=0; srv=0
for _ in $(seq 1 8); do
  sleep 5
  st=$(curl -s -m 10 "$BASE/api/dev/status" 2>/dev/null || echo '{}')
  echo "$st" | grep -q '"bridge":true' && bridge=1 || bridge=0
  echo "$st" | grep -q '"srv":""' && srv=0 || srv=1
  [ "$bridge" = 1 ] && [ "$srv" = 1 ] && break
done
say "punte online: $([ "$bridge" = 1 ] && echo DA || echo NU) | paznic (● Linux) raportează: $([ "$srv" = 1 ] && echo DA || echo NU)"
if [ "$bridge" = 1 ] && [ "$srv" = 1 ]; then
  say "✅ GATA — cod verificat live + toate serviciile sus."
else
  say "⚠️ Ceva încă nu raportează. Vezi cauza cu:"
  say "   journalctl -u kelion-bridge -u kelion-paznic -n 30 --no-pager"
fi
