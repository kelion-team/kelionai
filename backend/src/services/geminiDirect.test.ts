import { describe, it, expect } from 'vitest'
import { toGeminiPayload, GEMINI_DIRECT_PREFIX, isGeminiQuotaError } from './geminiDirect.js'
import type { OrMessage } from './openrouter.js'

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
    // System separat, nu în contents.
    expect(body.systemInstruction?.parts[0].text).toBe('Ești Kelion.')
    expect(body.contents).toHaveLength(3)
    // Apelul de unealtă al asistentului → functionCall cu argumente PARSATE.
    const call = body.contents[1].parts[0] as { functionCall: { name: string; args: { url: string } } }
    expect(call.functionCall.name).toBe('show_on_screen')
    expect(call.functionCall.args.url).toBe('https://google.com')
    // Rezultatul uneltei → functionResponse cu NUMELE reconstruit din id.
    const resp = body.contents[2].parts[0] as { functionResponse: { name: string } }
    expect(resp.functionResponse.name).toBe('show_on_screen')
    // Schema curățată ($schema aruncat), forțarea uneltei → mode ANY.
    expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty('$schema')
    expect(body.toolConfig.functionCallingConfig.mode).toBe('ANY')
  })

  it('recunoaște erorile de cotă (căderea pe secundar) și prefixul de rutare', () => {
    expect(isGeminiQuotaError(new Error('gemini 429: RESOURCE_EXHAUSTED'))).toBe(true)
    expect(isGeminiQuotaError(new Error('gemini 400: bad request'))).toBe(false)
    expect(`${GEMINI_DIRECT_PREFIX}gemini-2.5-flash`.startsWith('google-direct/')).toBe(true)
  })
})
