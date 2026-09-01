import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = (relative: string): string => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

describe('signed-in presence is minimised and account-scoped', () => {
  it('aggregates one row per normalised account and day without device signals', () => {
    const schema = source('../migrations/20260824_base_schema.sql')
    const table = schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS user_presence_daily'), schema.indexOf('CREATE INDEX IF NOT EXISTS idx_user_presence_last'))
    expect(table).toContain('PRIMARY KEY (user_email, day)')
    expect(table).not.toMatch(/\b(?:device|browser|ip|user_agent|fingerprint)\b/i)
  })

  it('normalises account identity and only records bounded page aggregates', () => {
    const db = source('./db.ts')
    expect(db).toMatch(/INSERT INTO user_presence_daily \(user_email, day, actions, pages\)/)
    expect(db).toMatch(/\[email\.trim\(\)\.toLowerCase\(\)\.slice\(0, 254\), path\.slice\(0, 64\)\]/)
    expect(db).not.toMatch(/GROUP BY lower\(user_email\), device, browser/)
  })

  it('includes account presence in self-service erasure', () => {
    expect(source('./db.ts')).toContain('DELETE FROM user_presence_daily WHERE lower(user_email) = $1')
  })
})
