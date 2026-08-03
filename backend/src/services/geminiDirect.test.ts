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
    const text = parts.find((p) => 'text' in p) as { text: string }
    expect(text.text).toBe('ce am spus?')
  })
})
