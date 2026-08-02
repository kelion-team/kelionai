import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE SERPER CREDIT, IN THE TOP BAR ───────────────────────────────────────
//
// The same honesty stake as the VPS pill (vpsInBara.test.ts): the Serper
// balance is a REAL figure read from the provider's /account endpoint, and a
// failed read must NEVER look like an empty account. Two things are pinned
// here:
//   1. absence is shown as absence ("Serper ⚠"), not as "Serper 0";
//   2. the bar rides on the /api/admin/brain-credit poll that already exists —
//      no extra poller for a figure that moves only when a search runs.
//
// The frontend has no test runner; we read it from here, like poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const bara = sursa('../../frontend/src/pages/Stage.tsx')
const ruta = sursa('./routes/admin.ts')

describe('pilula de Serper există și e alimentată', () => {
  it('ruta care hrănește bara chiar citește creditul Serper', () => {
    expect(ruta).toContain('getSerperBalance()')
    expect(ruta).toMatch(/serper: \{/)
    expect(ruta).toMatch(/live: serperBalance\.ok/)
  })

  it('bara afișează creditul real, în format k peste mii', () => {
    expect(bara).toContain('formatSerperK(brainCredit.serper.balance ?? 0)')
    expect(bara).toMatch(/credits >= 1000 \? `\$\{\(credits \/ 1000\)\.toFixed\(1\)\}k`/)
  })

  it('click-ul duce la dashboard-ul furnizorului', () => {
    expect(bara).toContain('https://serper.dev/dashboard')
  })

  it('nu adaugă un poller nou — merge pe cererea care exista deja', () => {
    const pollere = bara.match(/usePolledJson</g) ?? []
    expect(pollere.length).toBeLessThanOrEqual(2)
    expect(bara).toContain("usePolledJson<BrainCredit>('/api/admin/brain-credit'")
  })
})

describe('lipsa se arată ca lipsă, nu ca zero', () => {
  it('citirea eșuată dă „Serper ⚠", nu cifre', () => {
    expect(bara).toContain("'Serper ⚠'")
    expect(bara).toMatch(/Nu pot citi creditul Serper/)
  })

  it('tooltip-ul poartă cifra EXACTĂ, cu separator de mii', () => {
    expect(bara).toMatch(/credite reale · click pentru dashboard/)
    expect(bara).toContain("toLocaleString('ro-RO')")
  })
})
