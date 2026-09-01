import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
}

describe('data lifecycle is migration-owned and erasable', () => {
  it('defines the audit ledger in the schema migration, not at runtime', () => {
    const schema = source('../migrations/20260824_base_schema.sql')
    const runtime = source('./db.ts')
    expect(schema).toMatch(/CREATE TABLE IF NOT EXISTS audit_log[\s\S]*?actor TEXT[\s\S]*?actiune TEXT[\s\S]*?vechi TEXT[\s\S]*?nou TEXT/)
    expect(runtime).not.toMatch(/CREATE TABLE|ALTER TABLE|CREATE TRIGGER/)
    expect(runtime).toContain('export function noteazaAudit')
    expect(runtime).toContain('function etichetaAudit')
    expect(runtime).toContain('function valoareAudit')
    expect(runtime).toContain('curataTextJurnal(value, max)')
  })

  it('removes the historical delete shield so authenticated erasure can run', () => {
    const migration = source('../migrations/20260824_remove_delete_shield.sql')
    expect(migration).toContain('DROP TRIGGER IF EXISTS')
    expect(migration).toContain('DROP FUNCTION IF EXISTS refuza_stergerea()')
  })

  it('deletes consent data and pseudonymises only retained legal ledgers', () => {
    const runtime = source('./db.ts')
    for (const statement of [
      'DELETE FROM messages WHERE lower(user_email) = $1',
      'DELETE FROM voiceprints WHERE lower(user_email) = $1',
      'DELETE FROM user_presence_daily WHERE lower(user_email) = $1',
      'DELETE FROM google_accounts WHERE lower(email) = $1',
      'DELETE FROM auth_sessions WHERE lower(email)=$1',
    ]) expect(runtime).toContain(statement)
    expect(runtime).toMatch(/UPDATE wallets SET user_email=\$2, legal_basis=\$3, retention_until=\$4/)
    expect(runtime).toMatch(/UPDATE audit_log[\s\S]*?legal_basis=\$3,[\s\S]*?retention_until=\$4/)
  })

  it('purges pseudonymised legal records only after their retention deadline', () => {
    const runtime = source('./db.ts')
    expect(runtime).toContain('WHERE retention_until <= now()')
    expect(runtime).toContain('DELETE FROM erasure_requests WHERE retention_until <= now()')
  })
})
