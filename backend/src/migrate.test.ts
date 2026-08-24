import { createHash, createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { describe, expect, it } from 'vitest'
import {
  applyMigrationsAtomically,
  transactionBody,
  type MigrationClient,
  type MigrationSpec,
} from './migrate.js'

const databaseUrl = 'postgresql://migration-test@localhost/atomic_migrations'

function migration(version: string, body: string): MigrationSpec {
  const sql = `BEGIN;\n${body.trim()}\nCOMMIT;`
  return {
    version,
    sql,
    digest: createHash('sha256').update(sql, 'utf8').digest('hex'),
    destructive: /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(sql),
  }
}

const bootstrap = migration('20260101_schema_migrations.sql', `
  CREATE TABLE schema_migrations (
    version TEXT PRIMARY KEY,
    checksum_sha256 TEXT NOT NULL
  );
`)

function clientFor(database: PGlite, statements: string[] = []): MigrationClient {
  return {
    query: (async (text: string, values?: unknown[]) => {
      statements.push(text)
      if (values !== undefined) {
        const result = await database.query<Record<string, unknown>>(text, values)
        return { rows: result.rows }
      }
      const results = await database.exec(text)
      return { rows: results.at(-1)?.rows ?? [] }
    }) as MigrationClient['query'],
  }
}

async function relation(database: PGlite, name: string): Promise<string | null> {
  const result = await database.query<{ name: string | null }>(
    'SELECT to_regclass($1)::text AS name',
    [name],
  )
  return result.rows[0]?.name ?? null
}

function versionedMigrations(): MigrationSpec[] {
  const directory = new URL('../migrations/', import.meta.url)
  return readdirSync(directory)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((version) => {
      const sql = readFileSync(new URL(version, directory), 'utf8')
      return {
        version,
        sql,
        digest: createHash('sha256').update(sql, 'utf8').digest('hex'),
        destructive: /\b(?:DROP|TRUNCATE|DELETE\s+FROM)\b/i.test(sql),
      }
    })
}

async function withValidBackupProof(action: () => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'kelion-migration-proof-'))
  const proofFile = join(directory, 'proof.json')
  const key = 'atomic-migration-proof-key-with-more-than-32-bytes'
  const backupSha256 = 'a'.repeat(64)
  const backupId = `sha256:${backupSha256}`
  const completedAt = new Date().toISOString()
  const url = new URL(databaseUrl)
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ''))
  const databaseCanonical = `kelion:database-fingerprint:v1\n${url.hostname}\n${url.port || 5432}\n${database}`
  const databaseFingerprint = createHmac('sha256', key).update(databaseCanonical, 'utf8').digest('hex')
  const proofCanonical = `kelion:migration-backup-proof:v1\n${backupId}\n${backupSha256}\n${databaseFingerprint}\n${completedAt}`
  writeFileSync(proofFile, JSON.stringify({
    backupId,
    backupSha256,
    databaseFingerprint,
    completedAt,
    signatureHmacSha256: createHmac('sha256', key).update(proofCanonical, 'utf8').digest('hex'),
  }))

  const previousFile = process.env.MIGRATION_BACKUP_PROOF_FILE
  const previousKey = process.env.MIGRATION_BACKUP_PROOF_KEY
  process.env.MIGRATION_BACKUP_PROOF_FILE = proofFile
  process.env.MIGRATION_BACKUP_PROOF_KEY = key
  try {
    await action()
  } finally {
    if (previousFile === undefined) delete process.env.MIGRATION_BACKUP_PROOF_FILE
    else process.env.MIGRATION_BACKUP_PROOF_FILE = previousFile
    if (previousKey === undefined) delete process.env.MIGRATION_BACKUP_PROOF_KEY
    else process.env.MIGRATION_BACKUP_PROOF_KEY = previousKey
    rmSync(directory, { recursive: true, force: true })
  }
}

describe('migration transaction parser', () => {
  it('accepts line comments before BEGIN without returning the prologue', () => {
    expect(transactionBody('-- reviewed migration\r\n-- backup required\nBEGIN;\nSELECT 1;\nCOMMIT;'))
      .toBe('SELECT 1;')
  })

  it('accepts block comments, including nested PostgreSQL comments, before BEGIN', () => {
    expect(transactionBody(' /* outer /* nested */ review */ \nBEGIN;\nSELECT 2;\nCOMMIT;\n'))
      .toBe('SELECT 2;')
  })

  it('rejects executable SQL before BEGIN', () => {
    expect(() => transactionBody('-- prologue\nSELECT 0;\nBEGIN;\nSELECT 3;\nCOMMIT;'))
      .toThrowError('migration_transaction_contract_invalid')
  })

  it('rejects an unterminated block-comment prologue', () => {
    expect(() => transactionBody('/* incomplete\nBEGIN;\nSELECT 4;\nCOMMIT;'))
      .toThrowError('migration_transaction_contract_invalid')
  })

  it('accepts every versioned migration exactly as checksummed', () => {
    const directory = new URL('../migrations/', import.meta.url)
    const migrations = readdirSync(directory).filter((name) => name.endsWith('.sql')).sort()
    expect(migrations.length).toBeGreaterThan(0)
    for (const name of migrations) {
      const sql = readFileSync(new URL(name, directory), 'utf8')
      expect(() => transactionBody(sql), name).not.toThrow()
    }
  })
})

describe('atomic migration batch', () => {
  it('rolls back the bootstrap and every earlier migration after a mid-sequence failure', { timeout: 30_000 }, async () => {
    const database = new PGlite()
    const statements: string[] = []
    const beforeFailure = migration('20260102_before_failure.sql', `
      CREATE TABLE before_failure (id INTEGER PRIMARY KEY);
      INSERT INTO before_failure (id) VALUES (1);
    `)
    const failure = migration('20260103_failure.sql', `
      CREATE TABLE failure_was_reached (id INTEGER PRIMARY KEY);
      SELECT atomic_migration_function_that_does_not_exist();
    `)

    try {
      await expect(applyMigrationsAtomically(
        clientFor(database, statements),
        [bootstrap, beforeFailure, failure],
        databaseUrl,
      )).rejects.toThrow()

      expect(await relation(database, 'schema_migrations')).toBeNull()
      expect(await relation(database, 'before_failure')).toBeNull()
      expect(await relation(database, 'failure_was_reached')).toBeNull()
      expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1)
      expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(0)
      expect(statements.filter((statement) => statement === 'ROLLBACK')).toHaveLength(1)
    } finally {
      await database.close()
    }
  })

  it('keeps the existing registry unchanged when a later pending migration fails', { timeout: 30_000 }, async () => {
    const database = new PGlite()
    const pendingSuccess = migration('20260102_pending_success.sql', `
      CREATE TABLE pending_success (id INTEGER PRIMARY KEY);
    `)
    const pendingFailure = migration('20260103_pending_failure.sql', `
      CREATE TABLE pending_failure (id INTEGER PRIMARY KEY);
      SELECT another_missing_atomic_migration_function();
    `)

    try {
      await applyMigrationsAtomically(clientFor(database), [bootstrap], databaseUrl)
      await expect(applyMigrationsAtomically(
        clientFor(database),
        [bootstrap, pendingSuccess, pendingFailure],
        databaseUrl,
      )).rejects.toThrow()

      const applied = await database.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      )
      expect(applied.rows.map(({ version }) => version)).toEqual([bootstrap.version])
      expect(await relation(database, 'pending_success')).toBeNull()
      expect(await relation(database, 'pending_failure')).toBeNull()
    } finally {
      await database.close()
    }
  })

  it('commits bootstrap, schema changes, and registry rows only once for the whole batch', { timeout: 30_000 }, async () => {
    const database = new PGlite()
    const statements: string[] = []
    const first = migration('20260102_first.sql', 'CREATE TABLE atomic_first (id INTEGER PRIMARY KEY);')
    const second = migration('20260103_second.sql', 'CREATE TABLE atomic_second (id INTEGER PRIMARY KEY);')

    try {
      await applyMigrationsAtomically(
        clientFor(database, statements),
        [bootstrap, first, second],
        databaseUrl,
      )

      const applied = await database.query<{ version: string }>(
        'SELECT version FROM schema_migrations ORDER BY version',
      )
      expect(applied.rows.map(({ version }) => version)).toEqual([
        bootstrap.version,
        first.version,
        second.version,
      ])
      expect(await relation(database, 'atomic_first')).toBe('atomic_first')
      expect(await relation(database, 'atomic_second')).toBe('atomic_second')
      expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1)
      expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1)
      expect(statements.filter((statement) => statement === 'ROLLBACK')).toHaveLength(0)
    } finally {
      await database.close()
    }
  })

  it('applies the exact versioned migration chain in one outer transaction', { timeout: 30_000 }, async () => {
    const database = new PGlite()
    const statements: string[] = []
    const migrations = versionedMigrations()

    try {
      await withValidBackupProof(async () => {
        await applyMigrationsAtomically(
          clientFor(database, statements),
          migrations,
          databaseUrl,
        )
      })

      const applied = await database.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM schema_migrations',
      )
      expect(applied.rows[0]?.count).toBe(migrations.length)
      expect(statements.filter((statement) => statement === 'BEGIN')).toHaveLength(1)
      expect(statements.filter((statement) => statement === 'COMMIT')).toHaveLength(1)
      expect(statements.filter((statement) => statement === 'ROLLBACK')).toHaveLength(0)
    } finally {
      await database.close()
    }
  })

  it('validates every destructive proof before executing the bootstrap or a safe migration', { timeout: 30_000 }, async () => {
    const database = new PGlite()
    const statements: string[] = []
    const safe = migration('20260102_safe.sql', 'CREATE TABLE proof_prevalidation (id INTEGER PRIMARY KEY);')
    const destructive = migration('20260103_destructive.sql', 'DROP TABLE proof_prevalidation;')
    const proofFile = process.env.MIGRATION_BACKUP_PROOF_FILE
    const proofKey = process.env.MIGRATION_BACKUP_PROOF_KEY
    const proofKeyFile = process.env.MIGRATION_BACKUP_PROOF_KEY_FILE
    delete process.env.MIGRATION_BACKUP_PROOF_FILE
    delete process.env.MIGRATION_BACKUP_PROOF_KEY
    delete process.env.MIGRATION_BACKUP_PROOF_KEY_FILE

    try {
      await expect(applyMigrationsAtomically(
        clientFor(database, statements),
        [bootstrap, safe, destructive],
        databaseUrl,
      )).rejects.toThrow('destructive_migration_requires_backup_proof')

      expect(await relation(database, 'schema_migrations')).toBeNull()
      expect(await relation(database, 'proof_prevalidation')).toBeNull()
      expect(statements.some((statement) => statement.includes('CREATE TABLE proof_prevalidation'))).toBe(false)
      expect(statements.filter((statement) => statement === 'ROLLBACK')).toHaveLength(1)
    } finally {
      if (proofFile === undefined) delete process.env.MIGRATION_BACKUP_PROOF_FILE
      else process.env.MIGRATION_BACKUP_PROOF_FILE = proofFile
      if (proofKey === undefined) delete process.env.MIGRATION_BACKUP_PROOF_KEY
      else process.env.MIGRATION_BACKUP_PROOF_KEY = proofKey
      if (proofKeyFile === undefined) delete process.env.MIGRATION_BACKUP_PROOF_KEY_FILE
      else process.env.MIGRATION_BACKUP_PROOF_KEY_FILE = proofKeyFile
      await database.close()
    }
  })
})
