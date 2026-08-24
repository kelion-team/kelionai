import { readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { transactionBody } from './migrate.js'

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
