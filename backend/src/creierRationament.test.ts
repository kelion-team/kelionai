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
    expect(s).toContain('export async function planificaPasiMici')
    expect(s).toContain('[CREIER-UNITAR]')
  })

  it('planificarea constructorului produce protocol JSON Schema validat, nu FILES/STEPS parsate cu regex', () => {
    const s = citeste('./services/creierRationament.ts')
    expect(s).toContain('CONSTRUCTOR_PROTOCOL_SCHEMA')
    expect(s).toContain('parseazaConstructorProtocol')
    expect(s).toContain('Return ONE raw JSON object only')
    expect(s).toContain('REPOSITORY_FILE_CATALOG')
    expect(s).not.toContain('plan.matchAll(')
  })

  it('constructor /ajutor folose?te planificaPasiMici', () => {
    const c = citeste('./routes/constructor.ts')
    const idx = c.indexOf("/api/constructor/ajutor")
    expect(idx).toBeGreaterThan(0)
    const chunk = c.slice(idx, idx + 900)
    expect(chunk).toContain('planificaPasiMici')
    expect(chunk).toContain('creierRationament')
    expect(chunk).not.toContain('brainComplete')
  })

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
