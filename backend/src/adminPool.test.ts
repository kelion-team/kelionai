// ── THE DEAD admin_pool TABLE — dropped, never created again ──────────────
//
// What it was: "the owner's provider-credit pool (REAL money): the admin
// loads it" — a figure TYPED by hand into the panel ("+ Add money / − Take
// out money") and displayed as the pocket. Adrian killed that on Jul 30
// ("one single pocket... only real remains, no hardcode"): the readers and
// writers (loadAdminPool/withdrawAdminPool) were deleted.
//
// What was left behind: the CREATE TABLE and a hand-written seed row —
// `INSERT INTO admin_pool (id, loaded) VALUES (1, 0)` — i.e. a seed with a
// made-up balance, created in every fresh database forever. The live DB
// proves the table is dead: one row, (1, 0.000000), untouched since Jul 23,
// read by nothing.
//
// A table that only holds a hand-seeded figure is itself a hardcoding. Verified
// payment and provider-expense ledgers are the only accounting sources.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8')
const toolDefs = readFileSync(fileURLToPath(new URL('./services/brainToolDefs.ts', import.meta.url)), 'utf8')

describe('admin_pool: tabel mort, fără seed', () => {
  it('initDb NU mai creează tabelul', () => {
    expect(db).not.toMatch(/CREATE TABLE IF NOT EXISTS admin_pool/)
  })

  it('initDb NU mai seed-uiește soldul 0 scris de mână', () => {
    expect(db).not.toMatch(/INSERT INTO admin_pool/)
  })

  it('niciun cod nu mai citește sau scrie admin_pool', () => {
    expect(db).not.toMatch(/FROM admin_pool/)
    expect(db).not.toMatch(/INTO admin_pool\s*\(/)
    expect(db).not.toMatch(/UPDATE admin_pool/)
  })

  it('regula casei pentru db_query nu mai trimite spre un tabel inexistent', () => {
    expect(toolDefs).not.toContain('admin_pool')
  })
})
