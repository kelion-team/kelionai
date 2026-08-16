// ── ELIBERAREA lui Kelion: Aider primește creierul lui Kelion, nu doar ordinul
// (owner, 16 aug: „aider trebuie să fie permanent de creiere ȘI kelion,
// colaborează 100% informațional… scoate toate restricțiile… dă drumul la
// aplicație să funcționeze independent de tine"). Lanțul pe care i-l pusesem —
// Aider izolat, cu doar textul ordinului — e SCOS: motorul primește memoria +
// specialiștii + istoricul relevant al lui Kelion. Lacăt pe sursă.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ruta = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
const agent = readFileSync(fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url)), 'utf8')

describe('Aider ↔ Kelion: colaborare 100% informațională (restricția scoasă)', () => {
  it('app-ul expune contextul lui Kelion pentru motor (memorie + agenți + istoric), bridge-gated', () => {
    expect(ruta).toContain("app.post<{ Body: { ordin?: string } }>('/api/constructor/context'")
    expect(ruta).toContain('getMemories(config.adminEmail')
    expect(ruta).toContain('rosterViu()')
    expect(ruta).toContain('cautaIstoric(config.adminEmail')
    // gardat cu bridge-secret ca restul căilor constructorului
    expect(ruta).toMatch(/\/api\/constructor\/context'[\s\S]{0,200}x-bridge-secret'\] !== config\.bridgeSecret/)
  })

  it('motorul Aider CHIAR aduce și injectează contextul lui Kelion în prompt (nu mai e izolat)', () => {
    expect(agent).toContain("api('/api/constructor/context'")
    expect(agent).toContain('CREIERUL LUI KELION')
    expect(agent).toContain('const prompt = baza + contextKelion')
    // memoria + specialiștii ajung în prompt
    expect(agent).toContain('MEMORIA lui Kelion')
    expect(agent).toContain('SPECIALIȘTII lui Kelion')
  })
})
