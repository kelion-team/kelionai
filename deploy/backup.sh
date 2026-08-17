#!/usr/bin/env bash
# ── BACKUP CRIPTAT al bazei de date (Adrian, 24 iul: „la baza de date de plăți
# trebuie securitate maximă, să nu se șteargă sau să fie compromisă, salvări
# periodice în zona criptată cu datele userilor") ────────────────────────────
# Rulează zilnic din cron (instalat de deploy.sh). Face pg_dump pe TOATĂ baza
# (plăți + useri + memorie), o criptează AES-256-CBC (PBKDF2) cu o cheie care
# stă DOAR pe VPS (root, 0600) și păstrează ultimele 14 zile. Restaurare:
#   openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/kelion/backup.key \
#     -in kelion-YYYY-MM-DD.sql.enc | psql "$DATABASE_URL"
set -euo pipefail
# Restore: openssl enc -d -aes-256-cbc -pbkdf2 -pass file:/root/kelion/backup.key -in FILE.sql.enc | gunzip | psql "$DATABASE_URL"
# Prefer throwaway DB first. Cron: Sunday 03:00 Europe/London (CRON_TZ).

ENVFILE=/root/kelion/kelionai.env
KEYFILE=/root/kelion/backup.key
OUTDIR=/root/kelion/backups
KEEP_DAYS=60

DBURL="$(grep -E '^DATABASE_URL=' "$ENVFILE" | head -1 | sed 's/^DATABASE_URL=//')"
[ -n "$DBURL" ] || { echo "DATABASE_URL lipsă în $ENVFILE"; exit 1; }

# Cheia de criptare: generată O DATĂ, doar root o poate citi. Fără ea, backupul
# e ilizibil — exact scopul („zona criptată").
if [ ! -f "$KEYFILE" ]; then
  umask 077
  openssl rand -hex 48 > "$KEYFILE"
  chmod 600 "$KEYFILE"
fi

mkdir -p "$OUTDIR"
chmod 700 "$OUTDIR"

STAMP="$(date -u +%Y-%m-%d_%H%M)"
OUT="$OUTDIR/kelion-$STAMP.sql.enc"

# pg_dump prin containerul postgres (pe host nu e instalat clientul).
docker run --rm --network host postgres:16 pg_dump --no-owner --no-privileges "$DBURL" \
  | gzip \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -pass file:"$KEYFILE" -out "$OUT"
chmod 600 "$OUT"

# Verificare minimă: fișierul există și nu e gol.
[ -s "$OUT" ] || { echo "BACKUP GOL — eșec"; rm -f "$OUT"; exit 1; }

# Retenție: păstrează ultimele $KEEP_DAYS zile.
find "$OUTDIR" -name 'kelion-*.sql.enc' -mtime +"$KEEP_DAYS" -delete

echo "backup criptat OK: $OUT ($(du -h "$OUT" | cut -f1))"
