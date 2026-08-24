import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const here = dirname(fileURLToPath(import.meta.url))
const migrationsDir = resolve(here, '..', 'migrations')
const migrationName = /^\d{8}_[a-z0-9]+(?:_[a-z0-9]+)*\.sql$/
const destructiveSql = /\b(?:DROP\s+(?:TABLE|COLUMN|TYPE|FUNCTION|TRIGGER|INDEX|VIEW|SCHEMA|SEQUENCE|EXTENSION)|TRUNCATE(?:\s+TABLE)?|DELETE\s+FROM)\b/i

export type MigrationSpec = {
  version: string
  sql: string
  digest: string
  destructive: boolean
}

export type MigrationClient = {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }>
}

function secret(name: string): string {
  const direct = process.env[name]?.trim()
  if (direct) return direct
  const file = process.env[`${name}_FILE`]?.trim()
  if (!file) return ''
  if (statSync(file).size > 65_536) throw new Error(`${name}_FILE_invalid`)
  return readFileSync(file, 'utf8').trim()
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex')
}

function loadMigrations(): MigrationSpec[] {
  const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql')).sort()
  if (!files.length || files.some((name) => !migrationName.test(name))) throw new Error('migration_filename_invalid')
  if (files[0] !== '20260823_schema_migrations.sql') throw new Error('schema_migrations_must_be_first')
  return files.map((version) => {
    const sql = readFileSync(join(migrationsDir, version), 'utf8')
    return { version, sql, digest: checksum(sql), destructive: destructiveSql.test(sql) }
  })
}

function transactionStart(sql: string): number {
  let offset = 0

  while (offset < sql.length) {
    const whitespace = /^\s+/.exec(sql.slice(offset))
    if (whitespace) {
      offset += whitespace[0].length
      continue
    }

    if (sql.startsWith('--', offset)) {
      const lineEnd = sql.indexOf('\n', offset + 2)
      offset = lineEnd === -1 ? sql.length : lineEnd + 1
      continue
    }

    if (sql.startsWith('/*', offset)) {
      let depth = 1
      let cursor = offset + 2
      while (cursor < sql.length && depth > 0) {
        if (sql.startsWith('/*', cursor)) {
          depth += 1
          cursor += 2
        } else if (sql.startsWith('*/', cursor)) {
          depth -= 1
          cursor += 2
        } else {
          cursor += 1
        }
      }
      if (depth > 0) throw new Error('migration_transaction_contract_invalid')
      offset = cursor
      continue
    }

    break
  }

  return offset
}

export function transactionBody(sql: string): string {
  const start = transactionStart(sql)
  const withoutBegin = sql.slice(start).replace(/^BEGIN\s*;/i, '')
  const withoutCommit = withoutBegin.replace(/COMMIT\s*;\s*$/i, '')
  if (withoutBegin === sql.slice(start) || withoutCommit === withoutBegin) throw new Error('migration_transaction_contract_invalid')
  return withoutCommit.trim()
}

function databaseFingerprint(databaseUrl: string, proofKey: string): string {
  let url: URL
  try { url = new URL(databaseUrl) } catch { throw new Error('database_identity_invalid') }
  const host = url.hostname.toLowerCase()
  const port = url.port || '5432'
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  if (!host || !database || !/^\d{1,5}$/.test(port)) throw new Error('database_identity_invalid')
  const canonical = `kelion:database-fingerprint:v1\n${host}\n${port}\n${database}`
  return createHmac('sha256', proofKey).update(canonical, 'utf8').digest('hex')
}

function requireBackupProof(databaseUrl: string): void {
  const file = process.env.MIGRATION_BACKUP_PROOF_FILE?.trim()
  if (!file || !existsSync(file) || statSync(file).size > 16_384) {
    throw new Error('destructive_migration_requires_backup_proof')
  }
  const proofKey = secret('MIGRATION_BACKUP_PROOF_KEY')
  if (proofKey.length < 32) throw new Error('destructive_migration_backup_proof_key_required')
  const proof = JSON.parse(readFileSync(file, 'utf8')) as {
    backupId?: unknown
    backupSha256?: unknown
    databaseFingerprint?: unknown
    completedAt?: unknown
    signatureHmacSha256?: unknown
  }
  const completedAt = typeof proof.completedAt === 'string' ? Date.parse(proof.completedAt) : Number.NaN
  const recent = Number.isFinite(completedAt) && completedAt <= Date.now() && completedAt >= Date.now() - 24 * 60 * 60 * 1000
  if (
    typeof proof.backupId !== 'string' || !/^[A-Za-z0-9._:-]{6,160}$/.test(proof.backupId)
    || typeof proof.backupSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(proof.backupSha256)
    || typeof proof.databaseFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(proof.databaseFingerprint)
    || typeof proof.completedAt !== 'string'
    || typeof proof.signatureHmacSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(proof.signatureHmacSha256)
    || !recent
  ) {
    throw new Error('destructive_migration_backup_proof_invalid_or_stale')
  }
  const expectedFingerprint = databaseFingerprint(databaseUrl, proofKey)
  const canonical = `kelion:migration-backup-proof:v1\n${proof.backupId}\n${proof.backupSha256}\n${proof.databaseFingerprint}\n${proof.completedAt}`
  const expectedSignature = createHmac('sha256', proofKey).update(canonical, 'utf8').digest('hex')
  const fingerprintOk = timingSafeEqual(Buffer.from(proof.databaseFingerprint), Buffer.from(expectedFingerprint))
  const signatureOk = timingSafeEqual(Buffer.from(proof.signatureHmacSha256), Buffer.from(expectedSignature))
  if (!fingerprintOk || !signatureOk) throw new Error('destructive_migration_backup_proof_invalid_or_stale')
}

async function inspectApplied(client: MigrationClient, migrations: MigrationSpec[]): Promise<Map<string, string>> {
  const registry = await client.query<{ name: string | null }>("SELECT to_regclass('public.schema_migrations')::text AS name")
  if (!registry.rows[0]?.name) return new Map()
  const applied = await client.query<{ version: string; checksum_sha256: string }>(
    'SELECT version, checksum_sha256 FROM schema_migrations ORDER BY version',
  )
  const knownFiles = new Set(migrations.map(({ version }) => version))
  for (const row of applied.rows) {
    if (!knownFiles.has(row.version)) throw new Error(`unknown_applied_migration:${row.version}`)
  }
  const byVersion = new Map(applied.rows.map((row) => [row.version, row.checksum_sha256]))
  for (const migration of migrations) {
    const existing = byVersion.get(migration.version)
    if (existing && existing !== migration.digest) throw new Error(`migration_checksum_changed:${migration.version}`)
  }
  return byVersion
}

export async function applyMigrationsAtomically(
  client: MigrationClient,
  migrations: MigrationSpec[],
  databaseUrl: string,
): Promise<void> {
  await client.query('BEGIN')
  try {
    const applied = await inspectApplied(client, migrations)
    const pending = migrations.filter(({ version }) => !applied.has(version))

    // One signed, recent proof covers this exact database snapshot. Validate it
    // for every destructive file before the bootstrap or any other migration can
    // mutate the database. A missing proof therefore rolls back an empty batch.
    for (const migration of pending) {
      if (destructiveSql.test(migration.sql)) requireBackupProof(databaseUrl)
    }

    for (const migration of pending) {
      await client.query(transactionBody(migration.sql))
      await client.query(
        'INSERT INTO schema_migrations (version, checksum_sha256) VALUES ($1, $2)',
        [migration.version, migration.digest],
      )
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

export async function migrationPlan(): Promise<{
  kind: 'migrations_plan'
  risk: 'safe' | 'destructive'
  pending: Array<{ version: string; checksumSha256: string; destructive: boolean }>
}> {
  const databaseUrl = secret('DATABASE_URL')
  if (!databaseUrl) throw new Error('DATABASE_URL_or_FILE_required')
  const migrations = loadMigrations()
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
  const client = await pool.connect()
  try {
    const applied = await inspectApplied(client, migrations)
    const pending = migrations.filter(({ version }) => !applied.has(version)).map((migration) => ({
      version: migration.version,
      checksumSha256: migration.digest,
      destructive: migration.destructive,
    }))
    return {
      kind: 'migrations_plan',
      risk: pending.some(({ destructive }) => destructive) ? 'destructive' : 'safe',
      pending,
    }
  } finally {
    client.release()
    await pool.end()
  }
}

export async function runMigrations(): Promise<void> {
  const databaseUrl = secret('DATABASE_URL')
  if (!databaseUrl) throw new Error('DATABASE_URL_or_FILE_required')
  const migrations = loadMigrations()

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 })
  const client = await pool.connect()
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('kelion-schema-migrations'))")
    await applyMigrationsAtomically(client, migrations, databaseUrl)
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('kelion-schema-migrations'))").catch(() => undefined)
    client.release()
    await pool.end()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const planOnly = process.argv.slice(2).includes('--plan')
  const action = planOnly ? migrationPlan() : runMigrations()
  action.then(
    (result) => {
      process.stdout.write(planOnly ? `${JSON.stringify(result)}\n` : 'migrations_ok\n')
    },
    (error: unknown) => {
      const raw = error instanceof Error ? error.message : ''
      const message = /^(?:DATABASE_URL_or_FILE_required|migration_[a-z_]+(?::[a-zA-Z0-9_.-]+)?|schema_migrations_must_be_first|unknown_applied_migration:[a-zA-Z0-9_.-]+|destructive_migration_[a-z_]+)$/.test(raw)
        ? raw
        : 'migration_failed'
      process.stderr.write(`${message}\n`)
      process.exitCode = 1
    },
  )
}
