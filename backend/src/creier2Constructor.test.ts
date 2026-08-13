import { describe, it, expect } from 'vitest'
import { uneltePentruCreier2, raspunsCreier2 } from './services/creier2Constructor.js'
import type { OrChatResult } from './services/brainContract.js'

// ── DOVADA că creierul 2 e LEGAT la constructor (owner, 13 aug: „creierul 2 nu
// e legat la constructor… de aia toate ordinele eșuate") ─────────────────────
// Constructorul vorbește OpenAI (chat/completions); creierul aplicației vorbește
// formatul casei. Aici probăm că cele două punți convertesc EXACT — altfel
// fallback-ul ar tăcea pe un format greșit și „creier 2 legat" ar fi vorbă, nu faptă.

describe('uneltePentruCreier2 — unelte OpenAI (function) → AnthropicTool', () => {
  it('convertește name/description/parameters → name/description/input_schema', () => {
    const openai = [
      {
        type: 'function',
        function: {
          name: 'read_source',
          description: 'citește un fișier',
          parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
        },
      },
    ]
    expect(uneltePentruCreier2(openai)).toEqual([
      {
        name: 'read_source',
        description: 'citește un fișier',
        input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
      },
    ])
  })

  it('sare peste intrări fără nume și pune schemă goală când lipsesc parametrii', () => {
    const r = uneltePentruCreier2([
      { type: 'function', function: { description: 'fără nume' } },
      { type: 'function', function: { name: 'ping' } },
      'gunoi',
    ])
    expect(r).toEqual([{ name: 'ping', description: '', input_schema: { type: 'object', properties: {} } }])
  })

  it('intrare ne-listă → listă goală, nu crapă', () => {
    expect(uneltePentruCreier2(undefined as unknown as unknown[])).toEqual([])
  })
})

describe('raspunsCreier2 — OrChatResult → răspuns OpenAI (identic cu DeepInfra)', () => {
  const baza: OrChatResult = {
    text: '',
    toolCalls: [],
    costUsd: 0,
    model: 'gemini-3.5-flash',
    stop: 'end',
    inputTokens: 10,
    outputTokens: 20,
  }

  it('text simplu → choices[0].message.content, fără tool_calls', () => {
    const r = raspunsCreier2({ ...baza, text: 'salut' })
    expect(r.choices[0].message).toEqual({ role: 'assistant', content: 'salut' })
    expect(r.choices[0].message.tool_calls).toBeUndefined()
    expect(r.usage.total_tokens).toBe(30)
    expect(r.modelServit).toBe('gemini/gemini-3.5-flash')
  })

  it('tool_calls (OrToolCall E DEJA format OpenAI) trec direct în message.tool_calls', () => {
    const tc = { id: 'c1', type: 'function' as const, function: { name: 'read_source', arguments: '{"path":"a.ts"}' } }
    const r = raspunsCreier2({ ...baza, text: '', toolCalls: [tc] })
    expect(r.choices[0].message.tool_calls).toEqual([tc])
    expect(r.choices[0].message.content).toBe('')
  })
})
