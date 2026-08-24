import test from 'node:test'
import assert from 'node:assert/strict'
import { analizeazaMigrari, ddlDinSursa } from './verifica-migrari.mjs'

test('prinde DDL din șiruri executabile, nu din comentarii sau regexuri', () => {
  const gasite = ddlDinSursa(`
    // CREATE TABLE fals (id int)
    const verificare = /CREATE TABLE IF NOT EXISTS fals/
    await db.query(\`CREATE TABLE real (id bigint)\`)
  `)
  assert.equal(gasite.length, 1)
  assert.equal(gasite[0].fragment, 'CREATE TABLE')
})

test('validează numele, tranzacția, registrul, duplicatele și distructivele', () => {
  const rezultat = analizeazaMigrari([
    { nume: '20260824_schema.sql', sql: 'BEGIN;\nCREATE TABLE schema_migrations (version text);\nDROP TABLE vechi;\nCOMMIT;' },
    { nume: 'gresit.sql', sql: 'CREATE TABLE schema_migrations (version text);' },
  ])
  assert.deepEqual(rezultat.numeInvalide, ['gresit.sql'])
  assert.deepEqual(rezultat.faraTranzactie, ['gresit.sql'])
  assert.equal(rezultat.areRegistru, true)
  assert.equal(rezultat.creatiiDuplicate.length, 1)
  assert.equal(rezultat.distructive.length, 1)
})
