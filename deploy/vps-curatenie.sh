#!/bin/bash
# ── CURĂȚENIA VPS-ULUI (Adrian, 27 iul: „curăți tot, rămâne doar versiunea
# corectă, scrii o automatizare de a ține cât mai liber VPS-ul") ──────────────
# Rulează zilnic din cron (04:30). Ține discul liber ștergând DOAR ce se poate
# reface oricând; NU atinge: containerele care rulează, baza de date, env-ul,
# backup-urile din /root/kelion/backups (acelea se șterg doar la ordin).
#
# Lacătul de publicare e împărțit cu deploy.sh: curățenia nu rulează NICIODATĂ
# peste o publicare în curs (și invers) — altfel prune ar putea șterge straturi
# de imagine chiar în timpul unui build.
set -u
LOCK=/root/kelion/publicare.lock
LOG=/root/kelion/curatenie.log

{
  echo "── curățenie $(date -u +%F' '%T) UTC ──"
  df -h / | tail -1

  # 1. Imagini Docker nefolosite de containere care RULEAZĂ (aici se adună
  #    gigabytes: fiecare publicare construiește o imagine nouă și vechile
  #    rămâneau pe disc — s-au strâns 134 / ~48G înainte de prima curățenie).
  flock "$LOCK" docker image prune -a -f 2>&1 | tail -1

  # 2. Containere oprite + cache-ul de build.
  docker container prune -f 2>&1 | tail -1
  docker builder prune -a -f 2>&1 | tail -1

  # 3. Jurnalul de sistem — plafonat la 200M (jurnalele aplicației le ține
  #    docker, cu limitele lui; astea sunt doar syslog/journald).
  journalctl --vacuum-size=200M 2>&1 | tail -1

  # 4. Atelierele vechi ale constructorului (clone de lucru, se refac la
  #    fiecare job) — tot ce e mai vechi de o zi.
  find /root/kelion/atelier -maxdepth 1 -mindepth 1 -type d -mtime +1 -exec rm -rf {} + 2>/dev/null

  df -h / | tail -1
} >> "$LOG" 2>&1

# Jurnalul curățeniei să nu crească nici el la nesfârșit.
tail -c 262144 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
