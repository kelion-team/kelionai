#!/usr/bin/env bash
set -euo pipefail
umask 077

DATABASE_SECRET=/root/kelion/secrets/database-url
KEY_FILE=/root/kelion/backup.key
MIGRATION_PROOF_KEY=/root/kelion/secrets/migration-backup-proof-key
OUT_DIR=/root/kelion/backups
RUNTIME_DIR=/root/kelion/runtime
PROOF_FILE=$RUNTIME_DIR/last-verified-backup.json
LOCK_FILE=/root/kelion/backup.lock
POSTGRES_IMAGE=postgres:16@sha256:56f243d2355bad7d2016b1e78b80da8ac9e7967b766be2bfbff84fe85ffa30bc
KEEP_DAYS=${BACKUP_KEEP_DAYS:-60}

exec 9>"$LOCK_FILE"
flock -n 9 || { printf '%s\n' 'backup: altă rulare este activă'; exit 75; }

[ -s "$DATABASE_SECRET" ] || { printf '%s\n' 'backup: secretul database-url lipsește'; exit 1; }
[ -s "$MIGRATION_PROOF_KEY" ] || { printf '%s\n' 'backup: cheia separată pentru dovada migrării lipsește'; exit 1; }
case "$KEEP_DAYS" in *[!0-9]*|'') printf '%s\n' 'backup: retenție invalidă'; exit 1 ;; esac

install -d -o root -g root -m 0700 "$OUT_DIR"
install -d -o root -g root -m 0700 "$RUNTIME_DIR"
# Backupurile create de implementări anterioare pot avea permisiuni mai largi.
# Orice fișier din directorul dedicat este material de recovery și devine
# root-only înainte de a crea sau roti un backup nou.
find "$OUT_DIR" -maxdepth 1 -type f -exec chown root:root {} + -exec chmod 0600 {} +
if [ ! -s "$KEY_FILE" ]; then
  temporary_key=$(mktemp /root/kelion/backup-key.XXXXXX)
  openssl rand -hex 48 > "$temporary_key"
  install -o root -g root -m 0600 "$temporary_key" "$KEY_FILE"
  rm -f -- "$temporary_key"
fi

stamp=$(date -u +'%Y-%m-%d_%H%M%S')
output="$OUT_DIR/kelion-$stamp.dump.enc"
temporary_url=$(mktemp /root/kelion/database-url.XXXXXX)
temporary_dump=$(mktemp "$OUT_DIR/kelion-$stamp.XXXXXX.dump")
temporary_restore=$(mktemp "$OUT_DIR/kelion-$stamp.XXXXXX.restore.dump")
temporary_proof=$(mktemp "$RUNTIME_DIR/backup-proof.XXXXXX")
temporary_encryption_key=$(mktemp /root/kelion/backup-encryption-key.XXXXXX)
temporary_manifest=$(mktemp "$OUT_DIR/kelion-$stamp.XXXXXX.mac")
cleanup() { rm -f -- "$temporary_url" "$temporary_dump" "$temporary_restore" "$temporary_proof" "$temporary_encryption_key" "$temporary_manifest"; }
trap cleanup EXIT
install -o root -g 10050 -m 0440 "$DATABASE_SECRET" "$temporary_url"
chown 1000:10050 "$temporary_dump"

# Domenii de cheie separate: parola de criptare nu este reutilizată ca HMAC.
python3 - "$KEY_FILE" "$temporary_encryption_key" <<'PY'
import hashlib, hmac, pathlib, sys
master = pathlib.Path(sys.argv[1]).read_bytes().strip()
if len(master) < 48:
    raise SystemExit('backup master key invalid')
derived = hmac.new(master, b'kelion-backup-encryption-v1', hashlib.sha256).hexdigest()
pathlib.Path(sys.argv[2]).write_text(derived + '\n', encoding='ascii')
PY
chmod 0400 "$temporary_encryption_key"

docker run --rm --network none --user 1000:10050 \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 512m --cpus 1 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m,uid=999,gid=999 \
  -v /var/run/postgresql:/var/run/postgresql:ro \
  -v "$temporary_url:/run/secrets/database-url:ro" \
  -v "$temporary_dump:/backup.dump" \
  "$POSTGRES_IMAGE" sh -eu -c 'exec pg_dump --format=custom --no-owner --no-privileges --file=/backup.dump "$(cat /run/secrets/database-url)"'

[ -s "$temporary_dump" ] || { printf '%s\n' 'backup: dump gol'; exit 1; }
openssl enc -aes-256-cbc -salt -pbkdf2 -in "$temporary_dump" -pass file:"$temporary_encryption_key" -out "$output"
chmod 0600 "$output"

python3 - "$KEY_FILE" "$output" "$temporary_manifest" <<'PY'
import hashlib, hmac, json, pathlib, sys
master = pathlib.Path(sys.argv[1]).read_bytes().strip()
ciphertext = pathlib.Path(sys.argv[2]).read_bytes()
mac_key = hmac.new(master, b'kelion-backup-authentication-v1', hashlib.sha256).digest()
manifest = {
    'format': 'kelion-backup-v1',
    'ciphertextSha256': hashlib.sha256(ciphertext).hexdigest(),
    'hmacSha256': hmac.new(mac_key, ciphertext, hashlib.sha256).hexdigest(),
}
pathlib.Path(sys.argv[3]).write_text(json.dumps(manifest, separators=(',', ':')) + '\n', encoding='ascii')
PY
chmod 0600 "$temporary_manifest"
mv "$temporary_manifest" "$output.mac"

# Dovada înseamnă restaurare completă într-un cluster temporar fără rețea, nu
# doar faptul că pg_restore poate lista arhiva.
python3 - "$KEY_FILE" "$output" "$output.mac" <<'PY'
import hashlib, hmac, json, pathlib, sys
master = pathlib.Path(sys.argv[1]).read_bytes().strip()
ciphertext = pathlib.Path(sys.argv[2]).read_bytes()
manifest = json.loads(pathlib.Path(sys.argv[3]).read_text(encoding='ascii'))
mac_key = hmac.new(master, b'kelion-backup-authentication-v1', hashlib.sha256).digest()
expected_hash = hashlib.sha256(ciphertext).hexdigest()
expected_mac = hmac.new(mac_key, ciphertext, hashlib.sha256).hexdigest()
if manifest.get('format') != 'kelion-backup-v1' or not hmac.compare_digest(str(manifest.get('ciphertextSha256', '')), expected_hash) or not hmac.compare_digest(str(manifest.get('hmacSha256', '')), expected_mac):
    raise SystemExit('backup integrity verification failed')
PY
openssl enc -d -aes-256-cbc -pbkdf2 -in "$output" -pass file:"$temporary_encryption_key" -out "$temporary_restore"
chown 999:999 "$temporary_restore"
chmod 0400 "$temporary_restore"
docker run --rm --network none --user 999:999 \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 1536m --cpus 2 \
  --tmpfs /tmp:rw,nosuid,nodev,noexec,size=64m,uid=999,gid=999 \
  --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,size=2g,uid=999,gid=999 \
  --tmpfs /var/run/postgresql:rw,nosuid,nodev,size=16m,uid=999,gid=999 \
  -v "$temporary_restore:/backup.dump:ro" \
  "$POSTGRES_IMAGE" sh -eu -c '
    initdb --pgdata=/var/lib/postgresql/data --auth=trust --no-locale >/dev/null
    pg_ctl --pgdata=/var/lib/postgresql/data --options="-c listen_addresses= -k /var/run/postgresql" --wait start >/dev/null
    trap "pg_ctl --pgdata=/var/lib/postgresql/data --mode=fast --wait stop >/dev/null" EXIT
    createdb --host=/var/run/postgresql kelion_restore_probe
    pg_restore --exit-on-error --no-owner --no-privileges --host=/var/run/postgresql --dbname=kelion_restore_probe /backup.dump
  '

# Un director off-host este acceptat numai dacă administratorul l-a montat
# explicit; scriptul nu conține credentiale sau destinații de rețea.
if [ -n "${BACKUP_OFFSITE_DIR:-}" ]; then
  case "$BACKUP_OFFSITE_DIR" in /*) ;; *) printf '%s\n' 'backup: BACKUP_OFFSITE_DIR trebuie să fie absolut'; exit 1 ;; esac
  mountpoint -q "$BACKUP_OFFSITE_DIR" || { printf '%s\n' 'backup: destinația off-host nu este mountpoint'; exit 1; }
  install -m 0600 "$output" "$output.mac" "$BACKUP_OFFSITE_DIR/"
fi

backup_hash=$(sha256sum "$output" | awk '{print $1}')
completed_at=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
python3 - "$DATABASE_SECRET" "$MIGRATION_PROOF_KEY" "$backup_hash" "$completed_at" "$temporary_proof" <<'PY'
import hashlib, hmac, json, pathlib, sys
from urllib.parse import unquote, urlsplit

database_url = pathlib.Path(sys.argv[1]).read_text(encoding='utf8').strip()
key = pathlib.Path(sys.argv[2]).read_bytes().strip()
backup_sha256, completed_at, destination = sys.argv[3:]
if len(key) < 32:
    raise SystemExit('migration proof key invalid')
url = urlsplit(database_url)
database = unquote(url.path.lstrip('/'))
if not url.hostname or not database:
    raise SystemExit('database identity invalid')
canonical_database = f'kelion:database-fingerprint:v1\n{url.hostname.lower()}\n{url.port or 5432}\n{database}'
database_fingerprint = hmac.new(key, canonical_database.encode(), hashlib.sha256).hexdigest()
backup_id = f'sha256:{backup_sha256}'
canonical_proof = f'kelion:migration-backup-proof:v1\n{backup_id}\n{backup_sha256}\n{database_fingerprint}\n{completed_at}'
proof = {
    'backupId': backup_id,
    'backupSha256': backup_sha256,
    'databaseFingerprint': database_fingerprint,
    'completedAt': completed_at,
    'signatureHmacSha256': hmac.new(key, canonical_proof.encode(), hashlib.sha256).hexdigest(),
}
pathlib.Path(destination).write_text(json.dumps(proof, separators=(',', ':')) + '\n', encoding='ascii')
PY
chmod 0600 "$temporary_proof"
mv "$temporary_proof" "$PROOF_FILE"

find "$OUT_DIR" -maxdepth 1 -type f \( -name 'kelion-*.dump.enc' -o -name 'kelion-*.dump.enc.mac' \) -mtime +"$KEEP_DAYS" -delete
printf 'backup: restaurat și verificat %s\n' "$(basename "$output")"
