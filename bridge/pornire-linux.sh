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

# 1. Cod la zi — SINCRONIZARE FORȚATĂ la origin/master (adevărul unic).
#    REGULA 100% SINCRON (Adrian, 10 iul): producția = master, mereu. Vechiul
#    `git pull --ff-only` se OPREA la divergență și lăsa VPS-ul pe cod VECHI, care
#    apoi era publicat → reverterile „build fantomă". Reparațiile reușite acum se
#    ÎMPING în master (vezi repair.sh), deci orice rămășiță locală divergentă e
#    VECHE și se înlătură fără pierdere. Așa VPS-ul publică DOAR cod nou corect.
say "aduc master (sincronizare forțată la adevărul unic)…"
git fetch origin master || { say "⚠️ git fetch a eșuat — verifică rețeaua/credentialele git"; exit 1; }
git reset --hard origin/master || { say "⚠️ reset la origin/master a eșuat"; exit 1; }
say "cod la zi (master): $(git rev-parse --short HEAD)"

# 2. (22 iul 2026) Pasul de deploy Railway a fost SCOS — publicarea o face gazda (VPS).
say "sincronizare încheiată (publicarea o face pipeline-ul gazdei — Railway a fost scos)"

# 2b. CALEA REALĂ RULATĂ (11 iul: latența nu scădea deloc — dovedit că systemd
#     rulează o COPIE separată, ex. /root/kelion/kelion-bridge.mjs, ÎN AFARA
#     repo-ului, pe care pasul 1 (git reset în $REPO) n-o atinge niciodată).
#     Aflăm calea EXACTĂ din systemd și scriem codul corect EXACT acolo.
EXEC=$(systemctl show kelion-bridge -p ExecStart --value 2>/dev/null | grep -oE '/[^ ]*\.mjs' | head -1)
SRC="$REPO/bridge/kelion-bridge-linux.mjs"
if [ -n "$EXEC" ] && [ "$EXEC" != "$SRC" ]; then
  cp "$SRC" "$EXEC"
  say "cale reală diferită de repo — copiat codul corect peste $EXEC"
fi

# 2c. Pool-ul elastic de reparatori: asigură service file proaspăt și pornit.
#     Adrian, 12 iul: „da drumul la toți reparatori acum" — pool-ul e activ,
#     builder-ul clasic NU mai trage ordine (se oprește pentru a nu se bate pe coadă).
POOL_SERVICE="kelion-repairer-pool"
POOL_SRC="$REPO/bridge/kelion-repairer-pool.service"
POOL_DST="/etc/systemd/system/$POOL_SERVICE.service"
if [ -f "$POOL_SRC" ]; then
  cp "$POOL_SRC" "$POOL_DST"
  chmod 644 "$POOL_DST"
  systemctl daemon-reload >/dev/null 2>&1 || true
  systemctl enable "$POOL_SERVICE" >/dev/null 2>&1 || true
  systemctl start "$POOL_SERVICE" || say "⚠️ nu am putut porni $POOL_SERVICE"
fi

# 3. Repornește DOAR serviciile Kelion care există pe mașina asta.
#    Builder-ul clasic se OPREȘTE când pool-ul e activ (nu mai trage ordine).
for svc in kelion-bridge kelion-paznic kelion-deployer; do
  if systemctl list-unit-files "$svc.service" >/dev/null 2>&1 && \
     systemctl list-unit-files "$svc.service" 2>/dev/null | grep -q "^$svc.service"; then
    systemctl restart "$svc" && say "restart $svc → $(systemctl is-active "$svc")"
  else
    say "($svc nu există aici — sar peste)"
  fi
done

# 3b. Oprește builder-ul clasic dacă pool-ul e activ: ei se bat pe aceeași coadă.
if systemctl list-unit-files kelion-builder.service >/dev/null 2>&1 && \
   systemctl list-unit-files kelion-builder.service 2>/dev/null | grep -q "^kelion-builder.service"; then
  systemctl stop kelion-builder || true
  say "oprit kelion-builder (pool-ul de reparatori preia ordinele)"
fi

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
