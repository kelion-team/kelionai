#!/usr/bin/env bash
# SENTINELA LOCALĂ (Adrian, 26 iul: „verificare automată dar să nu coste sau să
# mănânce resurse"). Rulează din cron la 3 minute, pe VPS-ul deja plătit — zero
# tokeni AI, zero minute GitHub. Două treburi:
#   1. /health mort de 2 ori LA RÂND (≥6 min, ca un deploy normal să nu declanșeze
#      fals) → repornește containerul și raportează prin /api/ops/pulse (email
#      admin, cu prag anti-spam în aplicație).
#   2. /health viu → bate pulsul: aplicația își face verificările interne
#      (DB, disc, val de erori client) și alertează DOAR la anomalie.
# NUMELE nu se schimbă: deploy.sh curăță din crontab vechile watchdog.sh /
# paznic-chat.sh (zombii proiectului vechi) — ăsta trebuie să NU se potrivească.
set -u
STATE=/root/kelion/sentinela.state
ENVFILE=/root/kelion/kelionai.env
SECRET=$(grep '^BRIDGE_SECRET=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)

code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:8080/health || echo 000)

if [ "$code" = "200" ]; then
  echo 0 > "$STATE"
  # Pulsul intern (determinist; aplicația decide singură dacă alertează).
  [ -n "$SECRET" ] && curl -s -m 15 -X POST -H "x-bridge-secret: $SECRET" \
    -H 'content-type: application/json' -d '{}' \
    http://127.0.0.1:8080/api/ops/pulse >/dev/null || true
  exit 0
fi

fails=$(cat "$STATE" 2>/dev/null || echo 0)
fails=$((fails + 1))
echo "$fails" > "$STATE"
[ "$fails" -lt 2 ] && exit 0   # prima ratare poate fi un deploy în curs — răbdare

# A doua ratare la rând → reanimare.
echo 0 > "$STATE"
docker restart kelionai-app >/dev/null 2>&1 || docker start kelionai-app >/dev/null 2>&1 || true
# Așteptăm revenirea (max ~60s), apoi raportăm PRIN aplicația reînviată.
for _ in $(seq 1 12); do
  sleep 5
  code=$(curl -s -o /dev/null -w '%{http_code}' -m 8 http://127.0.0.1:8080/health || echo 000)
  [ "$code" = "200" ] && break
done
if [ "$code" = "200" ] && [ -n "$SECRET" ]; then
  curl -s -m 15 -X POST -H "x-bridge-secret: $SECRET" \
    -H 'content-type: application/json' \
    -d "{\"event\":\"restart\",\"detail\":\"sentinela-locala $(date -u +%H:%M)UTC\"}" \
    http://127.0.0.1:8080/api/ops/pulse >/dev/null || true
fi
