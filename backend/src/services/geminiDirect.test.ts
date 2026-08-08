import { describe, it, expect } from 'vitest'
import { toGeminiPayload, GEMINI_DIRECT_PREFIX, isGeminiQuotaError } from './geminiDirect.js'
import type { OrMessage } from './brainContract.js'

describe('gemini direct (creierul principal gratuit)', () => {
  it('convertește conversația casei în formatul Gemini (system + tool-uri + funcții)', () => {
    const messages: OrMessage[] = [
      { role: 'system', content: 'Ești Kelion.' },
      { role: 'user', content: 'deschide google' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'g_0_abc', type: 'function', function: { name: 'show_on_screen', arguments: '{"url":"https://google.com"}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'g_0_abc', content: '{"shown":true}' },
    ]
    const body = toGeminiPayload(
      messages,
      [{ name: 'show_on_screen', description: 'arată', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], $schema: 'x' } }],
      { toolChoice: 'required' },
    ) as {
      systemInstruction?: { parts: { text: string }[] }
      contents: { role: string; parts: Record<string, unknown>[] }[]
      tools: { functionDeclarations: { name: string; parameters: Record<string, unknown> }[] }[]
      toolConfig: { functionCallingConfig: { mode: string } }
    }
    // System separate, not in contents.
    expect(body.systemInstruction?.parts[0].text).toBe('Ești Kelion.')
    expect(body.contents).toHaveLength(3)
    // The assistant's tool call → functionCall with PARSED arguments.
    const call = body.contents[1].parts[0] as { functionCall: { name: string; args: { url: string } } }
    expect(call.functionCall.name).toBe('show_on_screen')
    expect(call.functionCall.args.url).toBe('https://google.com')
    // The tool result → functionResponse with the NAME rebuilt from the id.
    const resp = body.contents[2].parts[0] as { functionResponse: { name: string } }
    expect(resp.functionResponse.name).toBe('show_on_screen')
    // Cleaned schema ($schema dropped), tool forcing → mode ANY.
    expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty('$schema')
    expect(body.toolConfig.functionCallingConfig.mode).toBe('ANY')
  })

  it('recunoaște erorile de cotă (căderea pe secundar) și prefixul de rutare', () => {
    expect(isGeminiQuotaError(new Error('gemini 429: RESOURCE_EXHAUSTED'))).toBe(true)
    expect(isGeminiQuotaError(new Error('gemini 400: bad request'))).toBe(false)
    expect(`${GEMINI_DIRECT_PREFIX}gemini-2.5-flash`.startsWith('google-direct/')).toBe(true)
  })

  // AUDIO NATIV → CREIER DIRECT (Adrian, 3 aug: „deep learning legat de creier
  // direct"). Un mesaj cu `audio_url` (data-URI) devine `inline_data` audio pentru
  // Gemini — brainul primește vocea BRUTĂ, nu un text stâlcit de STT.
  it('audio_url (data-URI) → inline_data audio pentru Gemini, lângă textul turei', () => {
    const messages: OrMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,QUJDRA==' } },
          { type: 'text', text: 'ce am spus?' },
        ],
      } as unknown as OrMessage,
    ]
    const body = toGeminiPayload(messages, [], {}) as {
      contents: { role: string; parts: Record<string, unknown>[] }[]
    }
    const parts = body.contents[0].parts
    const audio = parts.find((p) => 'inline_data' in p) as {
      inline_data: { mime_type: string; data: string }
    }
    expect(audio.inline_data.mime_type).toBe('audio/wav')
    expect(audio.inline_data.data).toBe('QUJDRA==')
    const text = parts.find((p) => 'text' in p) as { type?: string; text: string }
    expect(text.text).toBe('ce am spus?')
  })

  // SEMNĂTURA DE GÂNDIRE LA REPLAY (7 aug) — regresia care a existat cu adevărat:
  // semnătura era CAPTATĂ din răspuns (partsToResult) și ARUNCATĂ la reconstrucția
  // cererii, deci Gemini 3.x refuza pasul 2 al oricărei ture cu unelte cu HTTP 400
  // („Function call is missing a thought_signature in functionCall parts").
  // Măsurat A/B de owner pe VPS: CU semnătură trece, FĂRĂ pică — pe 3.1-pro-preview
  // și pro-latest; pe 2.5-pro trece oricum (familia 2.5 n-are semnături).
  // Testul ăsta e plasa: dacă cineva scoate iar linia, aici se face roșu.
  it('retrimite thoughtSignature pe apelul de unealtă (Gemini 3.x o cere înapoi)', () => {
    const messages: OrMessage[] = [
      { role: 'user', content: 'caută vremea, apoi trimite-mi-o pe mail' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: 'g_0_abc',
            type: 'function',
            function: { name: 'web_search', arguments: '{"q":"vremea"}' },
            thoughtSignature: 'SEMNATURA-DE-PROBA',
          },
        ],
      },
      { role: 'tool', tool_call_id: 'g_0_abc', content: 'e soare' },
    ]
    const body = toGeminiPayload(messages, [], {}, 'gemini-3.5-flash') as {
      contents: { role: string; parts: Record<string, unknown>[] }[]
    }
    const apel = body.contents
      .flatMap((c) => c.parts)
      .find((p) => 'functionCall' in p) as { functionCall: { name: string }; thoughtSignature?: string }
    expect(apel.functionCall.name).toBe('web_search')
    expect(apel.thoughtSignature).toBe('SEMNATURA-DE-PROBA')
  })

  // Reversul: pe familia 2.5 nu există semnătură, iar partea NU trebuie să capete
  // un câmp gol/undefined — se trimite exact ce a venit, nimic inventat.
  it('fără semnătură (familia 2.5) nu adaugă câmpul deloc', () => {
    const messages: OrMessage[] = [
      { role: 'user', content: 'caută vremea' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'g_0_xyz', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        ],
      },
    ]
    const body = toGeminiPayload(messages, [], {}, 'gemini-2.5-flash') as {
      contents: { role: string; parts: Record<string, unknown>[] }[]
    }
    const apel = body.contents.flatMap((c) => c.parts).find((p) => 'functionCall' in p) as Record<string, unknown>
    expect('thoughtSignature' in apel).toBe(false)
  })
})
