import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
const agent = readFileSync(fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url)), 'utf8')

describe('Aider ? Kelion: colaborare 100% informa?ional? (restric?ia scoas?)', () => {
  it('app-ul expune contextul lui Kelion pentru motor (memorie + agen?i + istoric), bridge-gated', () => {
    expect(ruta).toContain("app.post<{ Body: { ordin?: string } }>('/api/constructor/context'")
    expect(ruta).toContain('getMemories(config.adminEmail')
    expect(ruta).toContain('rosterViu()')
    expect(ruta).toContain('cautaIstoric(config.adminEmail')
    expect(ruta).toMatch(/\/api\/constructor\/context'[\s\S]{0,200}x-bridge-secret'\] !== config\.bridgeSecret/)
  })

  it('app-ul expune plan unitar /ajutor (creierRationament) pentru Aider free ?i pl?tit', () => {
    expect(ruta).toContain("/api/constructor/ajutor")
    expect(ruta).toContain('planificaPasiMici')
    expect(ruta).toContain('creierRationament')
  })

  it('motorul Aider cere plan/context Kelion ?i lucreaz? pe pa?i mici (nu izolat)', () => {
    expect(agent).toContain("/api/constructor/ajutor")
    // unitary small-steps path (current) OR legacy context inject
    const hasPlan = /cereAjutorCreier|construiestePromptPasiMici|plan pa/.test(agent)
    const hasCtx = /\/api\/constructor\/context/.test(agent) || /contextKelion/.test(agent)
    expect(hasPlan || hasCtx).toBe(true)
    // still Aider engine
    expect(agent).toContain('construiesteCuAider')
    expect(agent).toMatch(/ollama_chat\//)
  })
})
