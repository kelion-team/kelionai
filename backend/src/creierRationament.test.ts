import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (rel: string) => fs.readFileSync(join(aici, rel), 'utf8')

describe('creierRationament este ușa unică pentru apelurile OpenAI de produs', () => {
  it('exportă API-ul unitar', () => {
    const s = citeste('./services/creierRationament.ts')
    expect(s).toContain('export async function rationeaza')
    expect(s).toContain('export async function rationeazaCuUnelte')
    expect(s).toContain('export async function rationeazaMesaje')
    expect(s).toContain('export async function rationeazaMesajeStream')
    expect(s).toContain('[CREIER-UNITAR]')
  })

  it('validează prin catalog atât apelurile normale, cât și streamul', () => {
    const s = citeste('./services/creierRationament.ts')
    expect(s.match(/const modelFull = await modelSolicitat/g)).toHaveLength(2)
    expect(s).toContain('await modelOpenAI(rol)')
    expect(s).toContain('await modelOpenAIExista(model)')
    expect(s).not.toMatch(/`openai\/\$\{config\.openai\.(?:luna|medium|heavy)\}`/)
  })

  it('serviciile produs folosesc adaptorul comun, nu un client paralel', () => {
    for (const f of ['mailbox.ts', 'manualLang.ts', 'apelTraducere.ts', 'vedeVideo.ts']) {
      const s = citeste(`./services/${f}`)
      expect(s, f).toContain('creierRationament')
      expect(s, f).not.toMatch(/import \{ brainComplete \} from '\.\/brain\.js'/)
    }
  })

  it('orchestrator chat pe creierRationament', () => {
    const o = citeste('./services/orchestrator.ts')
    expect(o).toContain('creierRationament')
    expect(o).toContain('rationeazaMesaje')
  })

  it('agenții folosesc aceeași ușă, iar jobs deleagă agentului fără client duplicat', () => {
    expect(citeste('./services/agentiKelion.ts')).toContain('rationeazaMesaje')
    const jobs = citeste('./routes/jobs.ts')
    expect(jobs).toContain('cheamaAgent')
    expect(jobs).not.toContain('openaiResponses')
  })
})
