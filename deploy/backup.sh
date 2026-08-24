#!/usr/bin/env bash
set -euo pipefail
umask 077

DATABASE_SECRET=/root/kelion/secrets/database-url
CONFIG_FILE=/root/kelion/config/runtime.env
KEY_FILE=/root/kelion/backup.key
MIGRATION_PROOF_KEY=/root/kelion/secrets/migration-backup-proof-key
OUT_DIR=/root/kelion/backups
RUNTIME_DIR=/root/kelion/runtime
PROOF_FILE=$RUNTIME_DIR/last-verified-backup.json
LOCK_FILE=/root/kelion/backup.lock
POSTGRES_IMAGE=postgres:16@sha256:56f243d2355bad7d2016b1e78b80da8ac9e7967b766be2bfbff84fe85ffa30bc
BACKUP_CONTAINER_UID=15050
BACKUP_CONTAINER_GID=15050

sync_file_and_parent() {
  python3 - "$1" <<'PY'
import os
import sys

path = sys.argv[1]
with open(path, 'rb') as handle:
    os.fsync(handle.fileno())
directory = os.path.dirname(path)
flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0)
fd = os.open(directory, flags)
try:
    os.fsync(fd)
finally:
    os.close(fd)
PY
}

[ -f "$CONFIG_FILE" ] && [ ! -L "$CONFIG_FILE" ] \
  || { printf '%s\n' 'backup: configul runtime lipsește sau este link'; exit 1; }
mapfile -t retention_values < <(sed -n 's/^PRIVACY_BACKUP_RETENTION_DAYS=//p' "$CONFIG_FILE")
[ "${#retention_values[@]}" -eq 1 ] \
  || { printf '%s\n' 'backup: retenția trebuie să apară exact o dată în runtime'; exit 1; }
KEEP_DAYS=${retention_values[0]}

exec 9>"$LOCK_FILE"
flock -n 9 || { printf '%s\n' 'backup: altă rulare este activă'; exit 75; }

[ -s "$DATABASE_SECRET" ] || { printf '%s\n' 'backup: secretul database-url lipsește'; exit 1; }
[ -s "$MIGRATION_PROOF_KEY" ] || { printf '%s\n' 'backup: cheia separată pentru dovada migrării lipsește'; exit 1; }
case "$KEEP_DAYS" in ''|0|*[!0-9]*) printf '%s\n' 'backup: retenție invalidă'; exit 1 ;; esac
command -v getent >/dev/null 2>&1 \
  || { printf '%s\n' 'backup: getent lipsește'; exit 1; }
if getent passwd "$BACKUP_CONTAINER_UID" >/dev/null 2>&1 \
  || getent group "$BACKUP_CONTAINER_GID" >/dev/null 2>&1; then
  printf '%s\n' 'backup: identitatea numerică izolată este ocupată pe host'
  exit 1
fi
[ -S /var/run/postgresql/.s.PGSQL.5432 ] \
  || { printf '%s\n' 'backup: socketul PostgreSQL local lipsește'; exit 1; }
POSTGRES_SOCKET_GID=$(stat -c '%g' /var/run/postgresql/.s.PGSQL.5432)
case "$POSTGRES_SOCKET_GID" in ''|*[!0-9]*) printf '%s\n' 'backup: grup socket invalid'; exit 1 ;; esac

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
  sync_file_and_parent "$KEY_FILE"
  rm -f -- "$temporary_key"
fi

stamp=$(date -u +'%Y-%m-%d_%H%M%S')
output="$OUT_DIR/kelion-$stamp.dump.enc"
temporary_output=$(mktemp "$OUT_DIR/kelion-$stamp.XXXXXX.dump.enc")
temporary_dump=$(mktemp "$OUT_DIR/kelion-$stamp.XXXXXX.dump")
temporary_restore=$(mktemp "$OUT_DIR/kelion-$stamp.XXXXXX.restore.dump")
temporary_proof=$(mktemp "$RUNTIME_DIR/backup-proof.XXXXXX")
temporary_encryption_key=$(mktemp /root/kelion/backup-encryption-key.XXXXXX)
temporary_manifest=$(mktemp "$OUT_DIR/kelion-$stamp.XXXXXX.mac")
temporary_libpq_env=$(mktemp /root/kelion/backup-libpq.XXXXXX)
temporary_passwd=$(mktemp /root/kelion/backup-passwd.XXXXXX)
temporary_group=$(mktemp /root/kelion/backup-group.XXXXXX)
cleanup() { rm -f -- "$temporary_output" "$temporary_dump" "$temporary_restore" "$temporary_proof" "$temporary_encryption_key" "$temporary_manifest" "$temporary_libpq_env" "$temporary_passwd" "$temporary_group"; }
trap cleanup EXIT
printf 'kelion-backup:x:%s:%s:Kelion backup:/tmp:/usr/sbin/nologin\n' \
  "$BACKUP_CONTAINER_UID" "$BACKUP_CONTAINER_GID" > "$temporary_passwd"
printf 'kelion-backup:x:%s:\n' "$BACKUP_CONTAINER_GID" > "$temporary_group"
chown root:root "$temporary_passwd" "$temporary_group"
chmod 0444 "$temporary_passwd" "$temporary_group"

# Credentiala nu intră în argv-ul pg_dump și nici în Config.Env al
# containerului. Un fișier efemer root-only este transformat într-un set libpq
# shell-quoted, montat read-only; wrapperul intern îl exportă fără să imprime.
python3 - "$DATABASE_SECRET" "$temporary_libpq_env" <<'PY'
import pathlib, shlex, sys
from urllib.parse import parse_qs, unquote, urlsplit

source, destination = map(pathlib.Path, sys.argv[1:])
database_url = source.read_text(encoding='utf8').strip()
url = urlsplit(database_url)
query = parse_qs(url.query, keep_blank_values=True, strict_parsing=True)
host_values = query.pop('host', [])
port_values = query.pop('port', [])
if (
    url.scheme not in ('postgres', 'postgresql')
    or url.hostname != 'localhost'
    or url.fragment
    or len(host_values) != 1
    or host_values[0] != '/var/run/postgresql'
    or len(port_values) > 1
    or query
):
    raise SystemExit('database URL is outside the local-socket backup contract')
database = unquote(url.path.lstrip('/'))
user = unquote(url.username or '')
password = unquote(url.password or '')
port = port_values[0] if port_values else str(url.port or 5432)
values = {
    'PGHOST': host_values[0],
    'PGPORT': port,
    'PGDATABASE': database,
    'PGUSER': user,
    'PGPASSWORD': password,
    'PGCONNECT_TIMEOUT': '10',
}
if not database or '/' in database or not user or not port.isdigit():
    raise SystemExit('database identity is invalid')
if any(any(ch in value for ch in ('\x00', '\r', '\n')) for value in values.values()):
    raise SystemExit('database credential contains a forbidden control character')
destination.write_text(
    ''.join(f'export {name}={shlex.quote(value)}\n' for name, value in values.items()),
    encoding='utf8',
)
PY
chown "$BACKUP_CONTAINER_UID:$BACKUP_CONTAINER_GID" "$temporary_libpq_env"
chmod 0400 "$temporary_libpq_env"

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

docker run --rm --network none \
  --user "$BACKUP_CONTAINER_UID:$BACKUP_CONTAINER_GID" \
  --group-add "$POSTGRES_SOCKET_GID" \
  --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 64 --memory 512m --cpus 1 \
  --tmpfs "/tmp:rw,nosuid,nodev,noexec,size=32m,uid=$BACKUP_CONTAINER_UID,gid=$BACKUP_CONTAINER_GID" \
  -v /var/run/postgresql:/var/run/postgresql:ro \
  -v "$temporary_libpq_env:/run/secrets/libpq-env:ro" \
  -v "$temporary_passwd:/etc/passwd:ro" \
  -v "$temporary_group:/etc/group:ro" \
  "$POSTGRES_IMAGE" sh -eu -c '. /run/secrets/libpq-env; exec pg_dump --format=custom --no-owner --no-privileges' \
  > "$temporary_dump"
chown root:root "$temporary_dump" "$temporary_libpq_env"
chmod 0600 "$temporary_dump" "$temporary_libpq_env"

[ -s "$temporary_dump" ] || { printf '%s\n' 'backup: dump gol'; exit 1; }
openssl enc -aes-256-cbc -salt -pbkdf2 -in "$temporary_dump" -pass file:"$temporary_encryption_key" -out "$temporary_output"
chown root:root "$temporary_output"
chmod 0600 "$temporary_output"

python3 - "$KEY_FILE" "$temporary_output" "$temporary_manifest" <<'PY'
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
chown root:root "$temporary_manifest"
chmod 0600 "$temporary_manifest"

# Dovada înseamnă restaurare completă într-un cluster temporar fără rețea, nu
# doar faptul că pg_restore poate lista arhiva.
python3 - "$KEY_FILE" "$temporary_output" "$temporary_manifest" <<'PY'
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
openssl enc -d -aes-256-cbc -pbkdf2 -in "$temporary_output" -pass file:"$temporary_encryption_key" -out "$temporary_restore"
chown root:root "$temporary_restore"
chmod 0400 "$temporary_restore"
docker run --rm --network none --interactive \
  --user "$BACKUP_CONTAINER_UID:$BACKUP_CONTAINER_GID" \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 1536m --cpus 2 \
  --tmpfs "/tmp:rw,nosuid,nodev,noexec,size=64m,uid=$BACKUP_CONTAINER_UID,gid=$BACKUP_CONTAINER_GID" \
  --tmpfs "/var/lib/postgresql/data:rw,nosuid,nodev,size=2g,uid=$BACKUP_CONTAINER_UID,gid=$BACKUP_CONTAINER_GID" \
  --tmpfs "/var/run/postgresql:rw,nosuid,nodev,size=16m,uid=$BACKUP_CONTAINER_UID,gid=$BACKUP_CONTAINER_GID" \
  -v "$temporary_passwd:/etc/passwd:ro" \
  -v "$temporary_group:/etc/group:ro" \
  "$POSTGRES_IMAGE" sh -eu -c '
    initdb --pgdata=/var/lib/postgresql/data --auth=trust --no-locale >/dev/null
    pg_ctl --pgdata=/var/lib/postgresql/data --options="-c listen_addresses= -k /var/run/postgresql" --wait start >/dev/null
    trap "pg_ctl --pgdata=/var/lib/postgresql/data --mode=fast --wait stop >/dev/null" EXIT
    createdb --host=/var/run/postgresql kelion_restore_probe
    pg_restore --exit-on-error --no-owner --no-privileges --host=/var/run/postgresql --dbname=kelion_restore_probe
  ' < "$temporary_restore"

# Publicăm numai perechea deja autentificată și restaurată integral. Fsync-ul
# fișierelor și al directorului precede dovada; astfel un jurnal durabil al
# migratorului nu poate indica un backup rămas doar în page cache.
backup_hash=$(sha256sum "$temporary_output" | awk '{print $1}')
mv "$temporary_output" "$output"
mv "$temporary_manifest" "$output.mac"
sync_file_and_parent "$output"
sync_file_and_parent "$output.mac"

# Un director off-host este acceptat numai dacă administratorul l-a montat
# explicit; scriptul nu conține credentiale sau destinații de rețea.
if [ -n "${BACKUP_OFFSITE_DIR:-}" ]; then
  case "$BACKUP_OFFSITE_DIR" in /*) ;; *) printf '%s\n' 'backup: BACKUP_OFFSITE_DIR trebuie să fie absolut'; exit 1 ;; esac
  mountpoint -q "$BACKUP_OFFSITE_DIR" || { printf '%s\n' 'backup: destinația off-host nu este mountpoint'; exit 1; }
  install -m 0600 "$output" "$output.mac" "$BACKUP_OFFSITE_DIR/"
fi

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
chown root:root "$temporary_proof"
chmod 0600 "$temporary_proof"
mv "$temporary_proof" "$PROOF_FILE"
sync_file_and_parent "$PROOF_FILE"

find "$OUT_DIR" -maxdepth 1 -type f \( -name 'kelion-*.dump.enc' -o -name 'kelion-*.dump.enc.mac' \) -mtime +"$KEEP_DAYS" -delete
printf 'backup: restaurat și verificat %s\n' "$(basename "$output")"
