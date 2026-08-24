import { describe, expect, it, vi } from 'vitest'

// Mochez creierul (apelul modelului) ca să pot verifica DOAR ce model pleacă pe
// fiecare rundă — pentru escaladarea ușor→greu la mijloc.
// `apeluriPeRunda` (când e pus) dictează ce cheamă modelul pe fiecare rundă —
// așa se poate verifica garda de „învârtit în loc" pe comportament, nu pe sursă.
const modeleFolosite: string[] = []
const apeluriPeRunda: { name: string; arguments: string }[][] = []
const conversatii: unknown[][] = []
let raspunsTextNestructurat: string | null = null
vi.mock('./creierRationament.js', () => ({
  rationeazaMesaje: async (convo: unknown[], optR: { model: string; reasoning?: string }) => {
    modeleFolosite.push(optR.model)
    conversatii.push(structuredClone(convo))
    if (raspunsTextNestructurat !== null) {
      return {
        text: raspunsTextNestructurat, model: optR.model, stop: 'completed', responseId: 'resp_text', serviceTier: null,
        inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0,
        toolCalls: [], responseItems: [{ type: 'message', id: 'msg_text', content: [] }],
      }
    }
    if (apeluriPeRunda.length) {
      const runda = apeluriPeRunda[modeleFolosite.length - 1]
      if (runda?.length) {
        const toolCalls = runda.map((f, i) => ({
          id: `t${modeleFolosite.length}_${i}`,
          type: 'function',
          function: f,
        }))
        return {
          text: '',
          model: optR.model,
          stop: 'completed',
          responseId: `resp_script_${modeleFolosite.length}`,
          serviceTier: null,
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
          toolCalls,
          responseItems: toolCalls.map((call) => ({
            type: 'function_call',
            id: `fc_${call.id}`,
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          })),
        }
      }
      return {
        text: 'gata', model: optR.model, stop: 'completed', responseId: 'resp_script_done', serviceTier: null,
        inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0,
        toolCalls: [], responseItems: [{ type: 'message', id: 'msg_script_done', content: [] }],
      }
    }
    // Runda 1: cheamă ask_brain (declanșează escaladarea). Runda 2: fără unelte → gata.
    if (modeleFolosite.length === 1)
      return {
        text: '', model: optR.model, stop: 'completed', responseId: 'resp_1', serviceTier: null,
        inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 1,
        toolCalls: [{ id: '1', type: 'function', function: { name: 'ask_brain', arguments: '{}' } }],
        responseItems: [
          { type: 'reasoning', id: 'rs_1', encrypted_content: 'opaque' },
          { type: 'function_call', id: 'fc_1', call_id: '1', name: 'ask_brain', arguments: '{}' },
        ],
      }
    return {
      text: 'gata', model: optR.model, stop: 'completed', responseId: 'resp_2', serviceTier: null,
      inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0,
      toolCalls: [], responseItems: [{ type: 'message', id: 'msg_2', content: [] }],
    }
  },
  rationeazaMesajeStream: async () => ({
    text: 'x', model: 'x', stop: 'completed', responseId: 'resp_stream', serviceTier: null,
    inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, reasoningOutputTokens: 0,
    toolCalls: [], responseItems: [],
  }),
}))

import {
  amprentaApeluri,
  amprentaIesiri,
  executaApeluriCoordonate,
  iesireEsteEroare,
  pasProgres,
  pasRepetitie,
  stareProgresInitiala,
  stareRepetitieInitiala,
  runOrchestrator,
} from './orchestrator.js'

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
    conversatii.length = 0
    const escaladare: { model?: string; reasoning?: 'low' | 'medium' | 'high' } = {}
    const execTool = async (name: string): Promise<string> => {
      if (name === 'ask_brain') {
        escaladare.model = 'openai/gpt-5.6-sol'
        escaladare.reasoning = 'high'
      }
      return 'ok'
    }
    const res = await runOrchestrator(
      'openai/gpt-5.6-luna',
      [{ role: 'user', content: 'x' }] as never,
      [{ name: 'ask_brain', description: 'd', input_schema: { type: 'object' } }] as never,
      execTool,
      { escaladare, maxRounds: 3 },
    )
    expect(modeleFolosite[0]).toBe('openai/gpt-5.6-luna') // runda 1 pe treapta ușoară
    expect(modeleFolosite[1]).toBe('openai/gpt-5.6-sol') // runda 2 a URCAT pe creierul greu
    expect(res.text).toContain('gata')
    expect(conversatii[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: 'assistant',
        response_items: [
          expect.objectContaining({ type: 'reasoning', encrypted_content: 'opaque' }),
          expect.objectContaining({ type: 'function_call', call_id: '1' }),
        ],
      }),
      expect.objectContaining({ role: 'tool', tool_call_id: '1', content: 'ok' }),
    ]))
  })

  it('fără escaladare, rămâne pe modelul de bază pe toate rundele', async () => {
    modeleFolosite.length = 0
    const execTool = async (): Promise<string> => 'ok'
    await runOrchestrator(
      'openai/gpt-5.6-luna',
      [{ role: 'user', content: 'x' }] as never,
      [{ name: 'ask_brain', description: 'd', input_schema: { type: 'object' } }] as never,
      execTool,
      { maxRounds: 3 },
    )
    expect(modeleFolosite.every((m) => m === 'openai/gpt-5.6-luna')).toBe(true)
  })
})

describe('runOrchestrator — efecte numai din function_call structurat', () => {
  it('nu execută markup sau JSON de unealtă scris ca text de model', async () => {
    modeleFolosite.length = 0
    raspunsTextNestructurat = '<|tool_call|>call:system_health{}<|tool_call|>'
    const execTool = vi.fn(async (): Promise<string> => 'nu trebuie apelat')
    try {
      const res = await runOrchestrator(
        'openai/gpt-5.6-luna',
        [{ role: 'user', content: 'x' }] as never,
        [{ name: 'system_health', description: 'd', input_schema: { type: 'object' } }] as never,
        execTool,
        { maxRounds: 1 },
      )
      expect(execTool).not.toHaveBeenCalled()
      expect(res.toolsCalled).toEqual([])
      expect(res.text.trim()).toBe('')
    } finally {
      raspunsTextNestructurat = null
    }
  })
})

// ── „RUNDA 7: NIMIC NOU + ACELEAȘI UNELTE" (owner, log recurent) ────────────
//
// Garda veche compara DOAR primele 300 de caractere din argumente și cerea ca
// runda să fie „goală" după filtrul de TEXT. Două scrieri diferite de fișier
// întreg au același prefix de 300 (`{"path":"...","content":"..."`), iar o rundă
// de unelte n-are text nou aproape niciodată — deci munca legitimă era tăiată la
// jumătate. Acum comparăm argumentele ÎNTREGI *și* rezultatele.
describe('garda de învârtit în loc (pasRepetitie)', () => {
  const APEL = [{ name: 'repo_write', argsJson: '{"path":"a.ts","content":"x"}' }]

  it('prima rundă nu oprește nimic — nu există trecut cu ce compara', () => {
    const r = pasRepetitie(stareRepetitieInitiala(), APEL, ['ok'])
    expect(r.stop).toBeNull()
  })

  it('aceleași apeluri cu aceleași rezultate a doua oară → stop', () => {
    const r1 = pasRepetitie(stareRepetitieInitiala(), APEL, ['ok'])
    const r2 = pasRepetitie(r1.st, APEL, ['ok'])
    expect(r2.stop).toMatch(/aceleași apeluri/)
  })

  it('același apel cu rezultat SCHIMBAT = progres, nu oprire', () => {
    const r1 = pasRepetitie(stareRepetitieInitiala(), APEL, ['build 40%'])
    const r2 = pasRepetitie(r1.st, APEL, ['build 80%'])
    expect(r2.stop).toBeNull()
  })

  it('argumentele lungi se compară ÎNTREGI, nu pe primele 300 de caractere', () => {
    const cap = '{"path":"fisier.ts","content":"'
    const umplutura = 'a'.repeat(400)
    const unu = [{ name: 'repo_write', argsJson: `${cap}${umplutura}UNU"}` }]
    const doi = [{ name: 'repo_write', argsJson: `${cap}${umplutura}DOI"}` }]
    expect(amprentaApeluri(unu)).not.toBe(amprentaApeluri(doi))
    const r1 = pasRepetitie(stareRepetitieInitiala(), unu, ['ok'])
    expect(pasRepetitie(r1.st, doi, ['ok']).stop).toBeNull()
  })

  it('ordinea cheilor din JSON nu inventează o diferență', () => {
    const a = [{ name: 'repo_write', argsJson: '{"path":"a.ts","content":"x"}' }]
    const b = [{ name: 'repo_write', argsJson: '{"content":"x","path":"a.ts"}' }]
    expect(amprentaApeluri(a)).toBe(amprentaApeluri(b))
  })

  it('delimitează rezultatele fără coliziuni între elemente', () => {
    expect(amprentaIesiri(['a\u0000b'])).not.toBe(amprentaIesiri(['a', 'b']))
  })

  it('în buclă reală: două runde identice se opresc, dar munca de dinainte s-a executat', async () => {
    modeleFolosite.length = 0
    apeluriPeRunda.length = 0
    const scrie = { name: 'repo_write', arguments: '{"path":"a.ts","content":"x"}' }
    // Rundele 1-2: scrieri DIFERITE cu același prefix lung (garda veche le-ar fi
    // confundat). Rundele 3-4: identice, cu același rezultat → stop pe 4.
    const lung = 'a'.repeat(400)
    apeluriPeRunda.push(
      [{ name: 'repo_write', arguments: `{"path":"f.ts","content":"${lung}UNU"}` }],
      [{ name: 'repo_write', arguments: `{"path":"f.ts","content":"${lung}DOI"}` }],
      [scrie],
      [scrie],
      [scrie],
    )
    let executii = 0
    try {
      await runOrchestrator(
        'openai/gpt-5.6-luna',
        [{ role: 'user', content: 'x' }] as never,
        [{ name: 'repo_write', description: 'd', input_schema: { type: 'object' } }] as never,
        async () => {
          executii++
          return 'ok'
        },
        { maxRounds: 8 },
      )
      expect(executii).toBe(4) // rundele 1-3 au lucrat; runda 4 s-a repetat → oprit
    } finally {
      apeluriPeRunda.length = 0
    }
  })
})
