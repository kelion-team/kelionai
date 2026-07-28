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

# ALARMĂ DE ULTIMĂ INSTANȚĂ (audit 28 iul: dacă aplicația rămâne moartă și DUPĂ
# restart, scriptul reseta tăcut contorul și repeta la nesfârșit — NICIODATĂ
# nu exista o alertă pentru „tot moartă". /api/ops/pulse nu poate ajuta aici —
# e ruta APLICAȚIEI, iar aplicația e exact ce lipsește. Trimitem un email DIRECT
# prin SMTP (curl, fără dependență de aplicație), citind aceleași credențiale
# din kelionai.env pe care le folosește services/mail.ts.
alert_app_still_dead() {
  local user pass host port
  user=$(grep '^MAIL_USER=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
  pass=$(grep '^MAIL_PASS=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-)
  host=$(grep '^MAIL_SMTP_HOST=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-); host="${host:-mail.privateemail.com}"
  port=$(grep '^MAIL_SMTP_PORT=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-); port="${port:-465}"
  local to; to=$(grep '^ADMIN_EMAIL=' "$ENVFILE" 2>/dev/null | head -1 | cut -d= -f2-); to="${to:-adrianenc11@gmail.com}"
  [ -z "$user" ] || [ -z "$pass" ] && return 0
  local now; now=$(date -u +'%a, %d %b %Y %H:%M:%S +0000')
  printf 'From: %s\r\nTo: %s\r\nSubject: [Kelion sentinelă] APLICAȚIA TOT MOARTĂ după restart\r\nDate: %s\r\n\r\nsentinela-locala: 2 rateri consecutive la /health, restart încercat, tot NU raspunde dupa ~60s de asteptare. Verifica manual VPS-ul (164.68.120.87).\r\n' \
    "$user" "$to" "$now" | curl -s -m 20 --url "smtps://${host}:${port}" --mail-from "$user" --mail-rcpt "$to" \
    --user "${user}:${pass}" --upload-file - >/dev/null || true
}

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
elif [ "$code" != "200" ]; then
  # Tot moartă după restart + ~60s de așteptare — asta CHIAR trebuie să ajungă
  # la owner, nu doar să dispară tăcut până la următorul ciclu de 3 minute.
  alert_app_still_dead
fi
