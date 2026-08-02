// ── ONE POCKET, ONE CURRENCY ─────────────────────────────────────────────────
//
// Adrian, with live evidence: the header said "OpenRouter $9.99" and the Money
// tab said "Punga: £7.99" — the SAME wallet run through the hand-written
// USD_TO_CURRENCY rate. Two figures for one truth is a fabrication. From here
// on the pocket is USD only, exactly the provider's reading.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { calcPunga } = await import('./services/punga.js')

describe('punga — cifra furnizorului, neconvertită', () => {
  it('$9.99 rămân $9.99 — fără cursul scris de mână care făcea £7.99', () => {
    const p = calcPunga(9.99)
    expect(p.total).toBe(9.99)
    expect(p.parti.openrouter).toBe(9.99)
    expect(p.currency).toBe('usd')
    expect(p.complete).toBe(true)
  })

  it('sursa care NU răspunde face punga INCOMPLETĂ, nu „zero"', () => {
    const p = calcPunga(null)
    expect(p.complete).toBe(false)
    expect(p.parti.openrouter).toBeNull()
    // The total exists only so older code doesn't crash; `complete: false` is
    // what the UI reads (it writes „incomplet, o sursă nu răspunde").
  })

  it('rotunjirea nu inventează bani', () => {
    expect(calcPunga(7.994999).total).toBe(7.99)
    expect(calcPunga(0).total).toBe(0)
    expect(calcPunga(0).complete).toBe(true) // a measured zero IS a measurement
  })
})

// The route guard: /api/admin/finance must BUILD the pocket through calcPunga
// (USD) and must never multiply the OpenRouter balance by the hand-written
// rate again — that's where £7.99 was born from $9.99.
describe('punga — ruta nu mai poate reintroduce conversia', () => {
  const ruta = readFileSync(fileURLToPath(new URL('./routes/admin.ts', import.meta.url)), 'utf8')

  it('punga se construiește prin calcPunga, în USD', () => {
    expect(ruta).toContain('calcPunga(orBalance.ok ? orBalance.balance : null)')
  })

  it('soldul OpenRouter NU mai trece prin usdToCurrency în rută', () => {
    expect(ruta).not.toMatch(/orBalance\.balance\s*\*\s*usdInMoneda/)
  })
})
