import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── CREDITUL SERPER — MUTAT ÎN ADMIN (10 aug, ownerul: „mută pastilele AI sub
// admin") ───────────────────────────────────────────────────────────────────
//
// Pastila a stat în bara de sus; acum trăiește în cardul „Credite AI" din
// AdminPanel, iar bara ține doar VPS-ul. Miza de onestitate rămâne aceeași:
// balanța Serper e o cifră REALĂ citită din /account al furnizorului, iar o
// citire picată nu are voie să arate ca un cont gol. Pinuim:
//   1. lipsa se arată ca lipsă („⚠"), nu ca „0";
//   2. datele vin tot din pollingul /api/admin/brain-credit care există deja
//      în Stage (niciun poller nou) — AdminPanel le primește ca prop.
//
// Frontendul n-are test runner; îl citim de aici, ca poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const bara = sursa('../../frontend/src/pages/Stage.tsx')
// După refactorizarea AdminPanel, CreditAICard trăiește în admin/shared.tsx.
const admin = sursa('../../frontend/src/components/admin/shared.tsx')
const ruta = sursa('./routes/admin.ts')

describe('creditul Serper există și e alimentat (în admin)', () => {
  it('ruta care hrănește datele chiar citește creditul Serper', () => {
    expect(ruta).toContain('getSerperBalance()')
    expect(ruta).toMatch(/serper: \{/)
    expect(ruta).toMatch(/live: serperBalance\.ok/)
  })

  it('cardul din admin afișează creditul real, în format k peste mii — DOAR cu sold real', () => {
    expect(admin).toContain('CreditAICard')
    // Sold arătat DOAR când e un număr real (owner, 19 aug): `?? 0` scos, ca un
    // `live:true` fără sold să NU mai arate „Serper 0" (fals „fără credit").
    expect(admin).toMatch(/typeof s\.balance === 'number' \? serperK\(s\.balance\)/)
    expect(admin).not.toMatch(/serperK\(s\.balance \?\? 0\)/)
    expect(admin).toMatch(/n >= 1000 \? `\$\{\(n \/ 1000\)\.toFixed\(1\)\}k`/)
  })

  it('nu adaugă un poller nou — merge pe cererea care exista deja în Stage', () => {
    const pollere = bara.match(/usePolledJson</g) ?? []
    expect(pollere.length).toBeLessThanOrEqual(2)
    expect(bara).toMatch(/usePolledJson<BrainCredit>\(\s*['"]\/api\/admin\/brain-credit['"]/)
    // AdminPanel primește datele ca prop — nu-și pornește propriul poll.
    expect(bara).toMatch(/brainCredit=\{brainCredit\}/)
    expect(admin).not.toContain('usePolledJson')
  })
})

describe('lipsa se arată ca lipsă, nu ca zero', () => {
  it('citirea eșuată SAU soldul lipsă dă „⚠", nu cifre', () => {
    // Acum: „⚠" și când citirea a picat (`live:false`) ȘI când `live:true` dar
    // fără `balance` (soldul lipsă ≠ cont gol) — nu mai apare niciun „Serper 0".
    expect(admin).toMatch(/Serper\s*\{s\?\.live && typeof s\.balance === 'number' \? serperK\(s\.balance\) : '⚠'\}/)
    expect(admin).toContain('citirea Serper a eșuat')
  })

  it('bara de sus NU mai desenează pastilele AI (doar VPS-ul)', () => {
    expect(bara).not.toContain('serper.dev/dashboard')
    expect(bara).not.toContain("'Serper ⚠'")
    expect(bara).toContain('VPS')
  })
})
