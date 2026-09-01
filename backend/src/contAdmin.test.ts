// ── THE OWNER'S ACCOUNTING: MEASURED USD, NO HAND-WRITTEN FX RATE ─────────
//
// getAdminAccount used to convert the REAL provider costs (USD, from
// cost_events) into £ with the hand-written USD_TO_CURRENCY rate (default
// 0.8) before handing them to the admin panel. A converted figure is not a
// measured one; the product wallet and provider expense are distinct ledgers.
//
// ACTUALIZAT (auditul admin, 3 aug): `getAdminAccount` a fost ȘTEARSĂ de tot —
// `spent` era EXACT suma pe care tabul Bani o citește deja din getCostSummary
// (același SELECT SUM(cost_usd)), `profit` nu era desenat nicăieri, iar la
// eșec funcția inventa {spent:0, profit:0} — fix tiparul „£0.00" din 30 iul.
// Testul de comportament al funcției a murit cu ea; rămân pinurile pe SURSĂ:
// (1) funcția și consumatorii ei (ruta /api/admin/pool, câmpul `pool` din
// brain-credit, spent/profit din finance) nu mai există, și (2) cursul de
// mână USD_TO_CURRENCY nu s-a întors.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const db = readFileSync(fileURLToPath(new URL('./db.ts', import.meta.url)), 'utf8')
const config = readFileSync(fileURLToPath(new URL('./config.ts', import.meta.url)), 'utf8')
const rutaAdmin = readFileSync(fileURLToPath(new URL('./routes/admin.ts', import.meta.url)), 'utf8')

describe('contabilitatea ownerului: fără cifre fabricate', () => {
  it('getAdminAccount a dispărut din db.ts (la eșec inventa {spent:0, profit:0})', () => {
    expect(db).not.toMatch(/export async function getAdminAccount/)
  })

  it('consumatorii ei au dispărut: ruta /api/admin/pool și câmpul pool din brain-credit', () => {
    expect(rutaAdmin).not.toContain("app.get('/api/admin/pool'")
    // Niciun APEL — numele mai apare doar în comentariile care explică ștergerea.
    expect(rutaAdmin).not.toMatch(/getAdminAccount\(/)
  })

  it('cursul USD_TO_CURRENCY a dispărut din codul de bani și din config', () => {
    expect(db).not.toContain('usdToCurrency')
    expect(config).not.toContain('usdToCurrency')
    expect(config).not.toContain('USD_TO_CURRENCY')
  })
})
