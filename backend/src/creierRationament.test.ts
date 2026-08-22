import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (rel: string) => fs.readFileSync(join(aici, rel), 'utf8')

describe('creierRationament ? u?? unic? de ra?ionament pentru TOATE rutele', () => {
  it('export? API-ul unitar', () => {
    const s = citeste('./services/creierRationament.ts')
    expect(s).toContain('export async function rationeaza')
    expect(s).toContain('export async function rationeazaCuUnelte')
    expect(s).toContain('export async function rationeazaMesaje')
    expect(s).toContain('export async function rationeazaMesajeStream')
    expect(s).toContain('[CREIER-UNITAR]')
  })

  // (Testele „planificaPasiMici" + „/api/constructor/ajutor" au fost ȘTERSE pe
  // 22 aug: planificatorul de pași pentru Aider a plecat cu toată mașinăria
  // constructorului local — ownerul a ordonat ștergerea integrală; constructorul
  // e DEVIN, care nu are nevoie de un plan JSON produs de app.)

  it('servicii produs pe creierRationament (nu brainComplete direct)', () => {
    for (const f of ['mailbox.ts', 'cerinte.ts', 'gapsTriage.ts', 'panouLucratori.ts']) {
      const s = citeste(`./services/${f}`)
      expect(s, f).toContain('creierRationament')
      expect(s, f).not.toMatch(/import \{ brainComplete \} from '\.\/brain\.js'/)
    }
  })

  it('autonomie pe rationeazaCuUnelte', () => {
    const s = citeste('./services/autonomie.ts')
    expect(s).toContain('rationeazaCuUnelte')
    expect(s).toContain('creierRationament')
    expect(s).not.toContain('brainCompleteWithTools(')
  })

  it('orchestrator chat pe creierRationament', () => {
    const o = citeste('./services/orchestrator.ts')
    expect(o).toContain('creierRationament')
    expect(o).toContain('rationeazaMesaje')
  })

  it('jobs/iscoada/pietar/agenti pe rationeazaMesaje', () => {
    expect(citeste('./routes/jobs.ts')).toContain('rationeazaMesaje')
    expect(citeste('./services/iscoada.ts')).toContain('rationeazaMesaje')
    expect(citeste('./services/pietar.ts')).toContain('rationeazaMesaje')
    expect(citeste('./services/agentiKelion.ts')).toContain('rationeazaMesaje')
  })
})
