import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// ── ISCOADELE (4 aug): legăturile care NU au voie să se rupă ────────────────
// Serviciul e o patrulă cu efecte (Serper + creier + memorie), deci aici
// verificăm CONTRACTUL din sursă — exact cum păzim și bara (serperInBara):
// pornirea din index.ts, contractul onest fără chei, cernerea „NIMIC",
// salvarea pe agentul 'iscoada' și frâna de ritm (minim 60 de minute).

const sursa = readFileSync(new URL('./services/iscoada.ts', import.meta.url), 'utf8')
const index = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('iscoadele lui Kelion', () => {
  it('patrula pornește din index.ts (altfel e cod mort cu nume frumos)', () => {
    expect(index).toContain('pornesteIscoadele()')
  })

  it('fără chei patrula stă acasă — nu inventează ocoluri', () => {
    expect(sursa).toContain('if (!config.serperKey || !config.geminiKey) return { teme: 0, salvate: 0 }')
  })

  it('o căutare picată sare tema, nu fabrică fapte', () => {
    expect(sursa).toContain("brut.includes('search_unavailable')")
  })

  it('creierul poate răspunde NIMIC și atunci NU se scrie în memorie', () => {
    expect(sursa).toContain('/^NIMIC\\b/i.test(text)')
  })

  it('ce se salvează merge în memoria pe care creierul o citește (agent kelion) și poartă eticheta iscoadei în conținut', () => {
    // Scris pe 'kelion' (10 aug), nu 'iscoada': recallMemories citește doar
    // agent='kelion' — altfel patrula era scriere-oarbă (nimeni n-o citea).
    expect(sursa).toContain("`[iscoada ${zi}] ${tema}: ${text}`.slice(0, 2000), 'kelion')")
    expect(sursa).toContain('[iscoada ${zi}]')
  })

  it('frâna de ritm: niciodată sub 60 de minute între ocoluri', () => {
    expect(sursa).toContain('Math.max(60, Number(process.env.ISCOADA_MIN) || 360)')
  })
})
