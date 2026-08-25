import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  assertSecureFileStat,
  databaseFingerprint,
  deriveBackupKeys,
  parseCanonicalJson,
  parseLocalSocketDatabaseUrl,
  requireUniqueBackup,
  verifyBackupManifest,
  verifyRestoreProof,
} from './restore-verified-backup.mjs'

const bashExecutable = process.platform === 'win32'
  ? `${process.env.ProgramFiles ?? 'C:\\Program Files'}\\Git\\bin\\bash.exe`
  : 'bash'
const jqAvailable = spawnSync(bashExecutable, ['-lc', 'command -v jq'], { encoding: 'utf8' }).status === 0

function secureStat(overrides = {}) {
  return {
    gid: 0,
    isFile: () => true,
    isSymbolicLink: () => false,
    mode: 0o100600,
    nlink: 1,
    size: 128,
    uid: 0,
    ...overrides,
  }
}

function signedProof(identity, proofKey, backupSha256 = 'a'.repeat(64)) {
  const completedAt = '2026-08-24T20:00:00Z'
  const backupId = `sha256:${backupSha256}`
  const fingerprint = databaseFingerprint(identity, proofKey)
  const canonical = `kelion:migration-backup-proof:v1\n${backupId}\n${backupSha256}\n${fingerprint}\n${completedAt}`
  return {
    backupId,
    backupSha256,
    completedAt,
    databaseFingerprint: fingerprint,
    signatureHmacSha256: createHmac('sha256', proofKey).update(canonical).digest('hex'),
  }
}

test('identitatea bazei vine numai din URL-ul strict pe socket local', () => {
  const localUrl = new URL('postgresql://localhost/kelion?host=%2Fvar%2Frun%2Fpostgresql')
  localUrl.username = 'postgres'
  localUrl.password = 'p@ss'
  const identity = parseLocalSocketDatabaseUrl(localUrl.toString())
  assert.deepEqual(identity, {
    database: 'kelion',
    host: '/var/run/postgresql',
    password: 'p@ss',
    port: '5432',
    user: 'postgres',
  })
  for (const invalid of [
    'postgresql://postgres@database.internal/kelion?host=%2Fvar%2Frun%2Fpostgresql',
    'postgresql://postgres@localhost/kelion',
    'postgresql://postgres@localhost/kelion?host=%2Ftmp',
    'postgresql://postgres@localhost/kelion?host=%2Fvar%2Frun%2Fpostgresql&host=%2Fvar%2Frun%2Fpostgresql',
    'postgresql://postgres@localhost/kelion?host=%2Fvar%2Frun%2Fpostgresql&sslmode=disable',
    'postgresql://postgres@localhost:5433/kelion?host=%2Fvar%2Frun%2Fpostgresql&port=5432',
    'postgresql://postgres@localhost/postgres?host=%2Fvar%2Frun%2Fpostgresql',
    'postgresql://bad-user@localhost/kelion?host=%2Fvar%2Frun%2Fpostgresql',
  ]) assert.throws(() => parseLocalSocketDatabaseUrl(invalid))
})

test('dovada semnată leagă exact hashul de baza locală', () => {
  const identity = parseLocalSocketDatabaseUrl(
    'postgresql://postgres@localhost/kelion?host=%2Fvar%2Frun%2Fpostgresql',
  )
  const key = 'proof-key-'.padEnd(48, 'k')
  const proof = signedProof(identity, key)
  const now = Date.parse('2026-08-24T20:30:00Z')
  assert.equal(verifyRestoreProof(proof, identity, key, now), 'a'.repeat(64))
  const otherIdentity = parseLocalSocketDatabaseUrl(
    'postgresql://postgres@localhost/kelion_other?host=%2Fvar%2Frun%2Fpostgresql',
  )
  assert.throws(
    () => verifyRestoreProof(proof, otherIdentity, key, now),
    /restore_proof_authentication_failed/,
  )

  assert.throws(
    () => verifyRestoreProof({ ...proof, backupSha256: 'b'.repeat(64), backupId: `sha256:${'b'.repeat(64)}` }, identity, key, now),
    /restore_proof_authentication_failed/,
  )
  assert.throws(
    () => verifyRestoreProof({ ...proof, signatureHmacSha256: '0'.repeat(64) }, identity, key, now),
    /restore_proof_authentication_failed/,
  )
  assert.throws(() => verifyRestoreProof({ ...proof, untrusted: true }, identity, key, now), /restore_proof_shape_invalid/)
})

test('dovada semnată expiră după 24 de ore și refuză timpul viitor', () => {
  const identity = parseLocalSocketDatabaseUrl(
    'postgresql://postgres@localhost/kelion?host=%2Fvar%2Frun%2Fpostgresql',
  )
  const key = 'proof-key-'.padEnd(48, 'k')
  const proof = signedProof(identity, key)
  assert.equal(
    verifyRestoreProof(proof, identity, key, Date.parse('2026-08-25T20:00:00Z')),
    'a'.repeat(64),
  )
  assert.throws(
    () => verifyRestoreProof(proof, identity, key, Date.parse('2026-08-25T20:00:00.001Z')),
    /restore_proof_invalid_or_stale/,
  )
  assert.throws(
    () => verifyRestoreProof(proof, identity, key, Date.parse('2026-08-24T19:59:59Z')),
    /restore_proof_invalid_or_stale/,
  )
})

test('JSON-ul autentificat are o singură reprezentare, fără chei duplicate', () => {
  assert.deepEqual(parseCanonicalJson('{"a":1,"b":2}\n'), { a: 1, b: 2 })
  for (const ambiguous of [
    '{"a":1,"a":2}',
    '{ "a":1,"b":2 }',
    '{"a":1,"b":2}\n\n',
  ]) assert.throws(() => parseCanonicalJson(ambiguous), /authenticated_json_invalid/)
})

test('manifestul refuză orice schimbare a cifrului sau a HMAC-ului', () => {
  const master = Buffer.from('master-key-'.padEnd(64, 'm'))
  const ciphertext = Buffer.from('ciphertext authenticated before decrypt')
  const keys = deriveBackupKeys(master)
  const backupSha256 = createHmac('sha256', 'fixture-hash').update(ciphertext).digest('hex')
  const ciphertextHmacSha256 = createHmac('sha256', keys.authentication).update(ciphertext).digest('hex')
  const manifest = { format: 'kelion-backup-v1', ciphertextSha256: backupSha256, hmacSha256: ciphertextHmacSha256 }
  verifyBackupManifest({ manifest, backupSha256, ciphertextHmacSha256 })

  assert.notEqual(keys.authentication.toString('hex'), keys.encryption)
  assert.throws(
    () => verifyBackupManifest({ manifest, backupSha256: 'f'.repeat(64), ciphertextHmacSha256 }),
    /backup_manifest_authentication_failed/,
  )
  assert.throws(
    () => verifyBackupManifest({ manifest, backupSha256, ciphertextHmacSha256: 'e'.repeat(64) }),
    /backup_manifest_authentication_failed/,
  )
  assert.throws(
    () => verifyBackupManifest({ manifest: { ...manifest, extra: true }, backupSha256, ciphertextHmacSha256 }),
    /backup_manifest_shape_invalid/,
  )
})

test('selecția și metadatele backupului sunt fail-closed', () => {
  assert.equal(requireUniqueBackup(['/root/kelion/backups/one.dump.enc']), '/root/kelion/backups/one.dump.enc')
  assert.throws(() => requireUniqueBackup([]), /backup_hash_not_found/)
  assert.throws(() => requireUniqueBackup(['one', 'two']), /backup_hash_ambiguous/)

  assert.doesNotThrow(() => assertSecureFileStat(secureStat(), { label: 'backup' }))
  for (const stat of [
    secureStat({ uid: 1000 }),
    secureStat({ gid: 1000 }),
    secureStat({ mode: 0o100640 }),
    secureStat({ nlink: 2 }),
    secureStat({ isSymbolicLink: () => true }),
    secureStat({ size: 0 }),
  ]) assert.throws(() => assertSecureFileStat(stat, { label: 'backup' }), /backup_file_security_invalid/)
})

test('scriptul validează înainte de swap, cotează identificatorii și revine fail-closed', () => {
  const script = readFileSync(new URL('../restore-verified-backup.sh', import.meta.url), 'utf8')
  const approval = script.indexOf('KELION_RESTORE_APPROVED')
  const authenticated = script.indexOf('node "$VALIDATOR"')
  const importScratch = script.indexOf('--dbname="$scratch_database"')
  const legacyContract = script.indexOf('verify_legacy_contract "$scratch_database"', importScratch)
  const swap = script.indexOf('\nswap_started=1\n')
  const swapBody = script.slice(swap)

  assert.ok(approval >= 0 && authenticated > approval && importScratch > authenticated)
  assert.ok(legacyContract > importScratch && swap > legacyContract)
  assert.match(script, /verify_lock_fd_identity[\s\S]*\/proc\/self\/fd\/\$fd/)
  assert.match(script, /readlink -- "\$fd_path"[\s\S]*fd_identity[\s\S]*path_identity/)
  assert.match(script, /verify_publication_lock_fd[\s\S]*verify_lock_fd 8 "\$PUBLICATION_LOCK" publication/)
  assert.match(script, /KELION_PUBLICATION_LOCK_HELD:-0[\s\S]*verify_publication_lock_fd[\s\S]*flock -n 8/)
  assert.match(script, /exec 8<>"\$PUBLICATION_LOCK"[\s\S]*normalize_lock_fd 8 "\$PUBLICATION_LOCK" publication[\s\S]*flock -n 8/)
  assert.match(script, /acquire_publication_lock[\s\S]*exec 7<>"\$BACKUP_LOCK"[\s\S]*flock -n 7[\s\S]*exec 9<>"\$RESTORE_LOCK"[\s\S]*flock -n 9/)
  assert.match(script, /PGPASSFILE=\$pgpass_file/)
  assert.match(script, /DATABASE_CONTROL_HOST=127\.0\.0\.1/)
  assert.match(script, /export PGHOST=\$DATABASE_CONTROL_HOST PGPORT=\$pg_port PGUSER=\$database_user PGPASSFILE=\$pgpass_file/)
  assert.match(script, /serverAddressIsLoopback[\s\S]*inet_server_addr\(\) = inet '127\.0\.0\.1'[\s\S]*and \.serverAddressIsLoopback/)
  assert.doesNotMatch(script, /export\s+PGPASSWORD|--password(?:=|\s)/)
  assert.match(script, /sha256sum -- "\$backup_path"[\s\S]*restore_backup_hash_changed/)
  assert.match(script, /pg_restore[\s\S]*--dbname="\$scratch_database"[\s\S]*--single-transaction --no-owner --no-privileges/)
  assert.doesNotMatch(script, /PGDATABASE="\$scratch_database"\s+pg_restore/)
  assert.match(script, /format\('ALTER DATABASE %I RENAME TO %I'/)
  assert.match(swapBody, /pg_terminate_backend[\s\S]*RENAME TO %I[\s\S]*RENAME TO %I/)
  assert.match(script, /rollback_swap[\s\S]*rename_database "\$quarantine_database" "\$database"/)
  assert.match(script, /preserve_scratch_database[\s\S]*rename_database "\$scratch_database" "\$failed_database"/)
  assert.match(script, /json_boolean\(\)[\s\S]*jq -r[\s\S]*type == "boolean"[\s\S]*true\|false/)
  assert.match(script, /scratch_exists=\$\(json_boolean "\$state" scratch\)[\s\S]*failed_exists=\$\(json_boolean "\$state" failed\)/)
  assert.match(script, /target_exists=\$\(json_boolean "\$state" target\)[\s\S]*quarantine_exists=\$\(json_boolean "\$state" quarantine\)/)
  assert.doesNotMatch(script, /jq -er '\.(?:target|scratch|quarantine|failed)'/)
  assert.match(script, /recovery_error_code=restore_rollback_failed/)
  assert.match(script, /recovery_error_code=restore_failure_quarantine_failed/)
  assert.doesNotMatch(script, /(?:^|\n)\s*error_code=restore_(?:rollback|failure_quarantine)_failed/)
  assert.match(script, /"error":"%s","recoveryError":"%s","preservedDatabase":/)
  assert.doesNotMatch(script, /DROP DATABASE/)
  assert.match(script, /quarantineDatabase:\$quarantineDatabase/)
  assert.match(script, /\{"schema":1,"ok":false,"error":"%s","preservedDatabase":/)
  for (const legacyFragment of [
    "('visits', 'id')",
    "('demo_uses', 'id')",
    "('app_files', 'name')",
    "('app_downloads', 'id')",
    "('client_errors', 'ip')",
    "('voiceprints', 'gender')",
    "('voiceprints', 'is_admin')",
  ]) assert.ok(script.includes(legacyFragment), `lipsește contractul legacy ${legacyFragment}`)
})

test('booleanul JSON false este o valoare validă, nu un exit de recovery', {
  skip: jqAvailable ? false : 'jq nu este disponibil pentru proba comportamentală',
}, () => {
  const script = readFileSync(new URL('../restore-verified-backup.sh', import.meta.url), 'utf8')
  const match = /json_boolean\(\) \{([\s\S]*?)\n\}/m.exec(script)
  assert.ok(match)
  const probe = `
set -euo pipefail
json_boolean() {${match[1]}
}
[ "$(json_boolean '{"value":false}' value)" = false ]
[ "$(json_boolean '{"value":true}' value)" = true ]
if json_boolean '{"value":"false"}' value >/dev/null 2>&1; then exit 1; fi
if json_boolean '{}' value >/dev/null 2>&1; then exit 1; fi
`
  const result = spawnSync(bashExecutable, ['-c', probe], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr || result.stdout)
})

test('preflightul reutilizează autentificarea și se oprește înainte de orice mutație DB', () => {
  const script = readFileSync(new URL('../restore-verified-backup.sh', import.meta.url), 'utf8')
  const mode = script.indexOf('if [ "${1:-}" = --preflight ]')
  const authenticated = script.indexOf('node "$VALIDATOR"')
  const backupHash = script.indexOf('sha256sum -- "$backup_path"')
  const decryptFile = script.indexOf('-out "$plaintext_dump"', authenticated)
  const archiveList = script.indexOf('pg_restore --list < "$plaintext_dump"')
  const databaseProbe = script.indexOf('if ! preflight=$(psql_admin')
  const diskProbe = script.indexOf('required_bytes=$((database_size * 2 + 1073741824))')
  const preflightExit = script.indexOf('if [ "$operation_mode" = preflight ]; then', diskProbe)
  const createScratch = script.indexOf("'CREATE DATABASE %I WITH TEMPLATE template0 OWNER %I'", preflightExit)
  const preflightBody = script.slice(preflightExit, createScratch)

  assert.ok(mode >= 0 && authenticated > mode)
  assert.match(script.slice(mode, authenticated), /--preflight[\s\S]*"\$#" -eq 2[\s\S]*operation_mode=preflight/)
  assert.ok(backupHash > authenticated && decryptFile > backupHash)
  assert.ok(archiveList > decryptFile && databaseProbe > archiveList)
  assert.ok(diskProbe > databaseProbe && preflightExit > diskProbe)
  assert.ok(createScratch > preflightExit)
  assert.match(preflightBody, /restore_preflight_ok/)
  assert.match(preflightBody, /verify_legacy_contract "\$database"/)
  assert.match(preflightBody, /completed=1[\s\S]*exit 0/)
  assert.doesNotMatch(preflightBody, /CREATE DATABASE|ALTER DATABASE|RENAME TO|PGDATABASE="\$scratch_database"/)
  assert.match(script, /operation_mode" = restore[\s\S]*rollback_swap/)
  assert.match(script, /normalize_lock_fd 7 "\$BACKUP_LOCK" backup[\s\S]*normalize_lock_fd 9 "\$RESTORE_LOCK" restore/)
  assert.match(script, /normalize_lock_fd[\s\S]*chown 0:0 -- "\$fd_path"[\s\S]*chmod 0600 -- "\$fd_path"[\s\S]*verify_lock_fd/)
  assert.doesNotMatch(script, /publication_lock_file_missing|backup_lock_file_missing|restore_lock_file_missing/)
  assert.doesNotMatch(script, /\|\s*pg_restore --list|PIPESTATUS/)
  assert.equal(script.match(/-out "\$plaintext_dump"/g)?.length, 1)
  assert.match(script, /-out "\$plaintext_dump"[\s\S]*pg_restore --list < "\$plaintext_dump"[\s\S]*restore_dump_format_invalid/)
  assert.match(script, /database_size" -le 4611686017890516991[\s\S]*database_size \* 2 \+ 1073741824/)
  assert.match(script, /verify_legacy_contract\(\)[\s\S]*SELECT count\(\*\) FROM missing/)
  assert.match(script, /PGDATABASE="\$contract_database"[\s\S]*verify_legacy_contract "\$scratch_database"/)
})
