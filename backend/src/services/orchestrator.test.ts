import { describe, expect, it, vi } from 'vitest'

// Mochez creierul (apelul modelului) ca să pot verifica DOAR ce model pleacă pe
// fiecare rundă — pentru escaladarea ușor→greu la mijloc.
const modeleFolosite: string[] = []
vi.mock('./creierRationament.js', () => ({
  rationeazaMesaje: async (_convo: unknown, optR: { model: string; reasoning?: string }) => {
    modeleFolosite.push(optR.model)
    // Runda 1: cheamă ask_brain (declanșează escaladarea). Runda 2: fără unelte → gata.
    if (modeleFolosite.length === 1)
      return { text: '', costUsd: 0, model: optR.model, toolCalls: [{ id: '1', function: { name: 'ask_brain', arguments: '{}' } }] }
    return { text: 'gata', costUsd: 0, model: optR.model, toolCalls: [] }
  },
  rationeazaMesajeStream: async () => ({ text: 'x', costUsd: 0, model: 'x', toolCalls: [] }),
}))

import { executaApeluriCoordonate, iesireEsteEroare, pasProgres, stareProgresInitiala, runOrchestrator } from './orchestrator.js'

describe('garda de progres (fail-fast pe erori, nu 65s de măcinat)', () => {
  it('recunoaște ieșirile de eroare, nu confundă succesul cu eroarea', () => {
    expect(iesireEsteEroare('tool_error: boom')).toBe(true)
    expect(iesireEsteEroare('{"ok":false,"why":"x"}')).toBe(true)
    expect(iesireEsteEroare('{"error":"bad sql"}')).toBe(true)
    expect(iesireEsteEroare('Error: nope')).toBe(true)
    expect(iesireEsteEroare('{"ok":true,"rows":3}')).toBe(false)
    expect(iesireEsteEroare('rezultat normal')).toBe(false)
  })

  it('oprește după 2 runde consecutive numai cu erori', () => {
    let st = stareProgresInitiala()
    let r = pasProgres(st, ['db_query'], ['tool_error: bad sql'])
    expect(r.stop).toBeNull() // prima rundă cu erori: încă nu oprim
    st = r.st
    r = pasProgres(st, ['constructor_command'], ['tool_error: exit 1'])
    expect(r.stop).toMatch(/runde consecutive/) // a doua la rând → stop
  })

  it('o rundă cu progres real resetează contorul de runde-eroare', () => {
    let st = stareProgresInitiala()
    st = pasProgres(st, ['db_query'], ['tool_error: x']).st // 1 rundă eroare
    st = pasProgres(st, ['db_query'], ['{"ok":true}']).st // progres → reset
    const r = pasProgres(st, ['db_query'], ['tool_error: y']) // iar 1 eroare
    expect(r.stop).toBeNull() // nu 2 la rând (a fost reset) → nu oprim
  })

  it('oprește dacă ACEEAȘI unealtă eșuează de 3× în tură (chiar cu narațiune între)', () => {
    let st = stareProgresInitiala()
    // Între erorile pe db_query intervin runde cu succes pe altă unealtă (nu resetează
    // contorul PER-UNEALTĂ, doar pe cel de runde-numai-erori).
    st = pasProgres(st, ['db_query', 'system_health'], ['tool_error: a', '{"ok":true}']).st
    st = pasProgres(st, ['db_query', 'system_health'], ['tool_error: b', '{"ok":true}']).st
    const r = pasProgres(st, ['db_query'], ['tool_error: c'])
    expect(r.stop).toMatch(/db_query.*3×/)
  })
})

describe('executaApeluriCoordonate', () => {
  it('păstrează ordinea efectelor din același grup', async () => {
    const ordine: string[] = []
    const rezultat = await executaApeluriCoordonate(
      ['scriere-1', 'scriere-2'],
      () => 'efect',
      async (apel) => {
        ordine.push(`start:${apel}`)
        await new Promise((resolve) => setTimeout(resolve, 5))
        ordine.push(`end:${apel}`)
        return apel
      },
    )
    expect(rezultat).toEqual(['scriere-1', 'scriere-2'])
    expect(ordine).toEqual(['start:scriere-1', 'end:scriere-1', 'start:scriere-2', 'end:scriere-2'])
  })

  it('nu introduce latență artificială între citirile independente', async () => {
    let active = 0
    let maxim = 0
    await executaApeluriCoordonate(
      ['citire-1', 'citire-2'],
      () => undefined,
      async () => {
        active += 1
        maxim = Math.max(maxim, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return 'ok'
      },
    )
    expect(maxim).toBe(2)
  })
})

describe('runOrchestrator — escaladarea ușor→greu la mijloc (owner 20 aug)', () => {
  it('când execTool (ask_brain) setează escaladare.model, runda următoare URCĂ pe modelul greu', async () => {
    modeleFolosite.length = 0
    const escaladare: { model?: string; reasoning?: 'low' | 'medium' | 'high' } = {}
    const execTool = async (name: string): Promise<string> => {
      if (name === 'ask_brain') {
        escaladare.model = 'google-direct/gemini-greu'
        escaladare.reasoning = 'high'
      }
      return 'ok'
    }
    const res = await runOrchestrator(
      'google-direct/gemini-usor',
      [{ role: 'user', content: 'x' }] as never,
      [{ name: 'ask_brain', description: 'd', input_schema: { type: 'object' } }] as never,
      execTool,
      { escaladare, maxRounds: 3 },
    )
    expect(modeleFolosite[0]).toBe('google-direct/gemini-usor') // runda 1 pe treapta ușoară
    expect(modeleFolosite[1]).toBe('google-direct/gemini-greu') // runda 2 a URCAT pe creierul greu
    expect(res.text).toContain('gata')
  })

  it('fără escaladare, rămâne pe modelul de bază pe toate rundele', async () => {
    modeleFolosite.length = 0
    const execTool = async (): Promise<string> => 'ok'
    await runOrchestrator(
      'google-direct/gemini-usor',
      [{ role: 'user', content: 'x' }] as never,
      [{ name: 'ask_brain', description: 'd', input_schema: { type: 'object' } }] as never,
      execTool,
      { maxRounds: 3 },
    )
    expect(modeleFolosite.every((m) => m === 'google-direct/gemini-usor')).toBe(true)
  })
})
