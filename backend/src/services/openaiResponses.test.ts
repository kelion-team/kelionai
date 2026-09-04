import { describe, expect, it } from 'vitest'
import { toResponsesBody, toResponsesInput } from './openaiResponses.js'
import type { OrMessage } from './brainContract.js'

describe('OpenAI Responses adapter', () => {
  it('convertește system, imagini, function calls și rezultate fără să piardă legătura call_id', () => {
    const messages: OrMessage[] = [
      { role: 'system', content: 'Ești Kelion.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Ce vezi?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
        ],
      },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'inspect', arguments: '{"x":1}' } }],
      },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ]
    const converted = toResponsesInput(messages)
    expect(converted.instructions).toBe('Ești Kelion.')
    expect(converted.input).toContainEqual({
      type: 'function_call',
      call_id: 'call_1',
      name: 'inspect',
      arguments: '{"x":1}',
    })
    expect(converted.input).toContainEqual({
      type: 'function_call_output',
      call_id: 'call_1',
      output: '{"ok":true}',
    })
    const user = converted.input.find((item) => item.role === 'user') as { content: Record<string, unknown>[] }
    expect(user.content).toContainEqual({ type: 'input_image', image_url: 'data:image/png;base64,QUJD' })
  })

  it('folosește schema Responses și restrânge uneltele pe runda forțată', () => {
    const body = toResponsesBody(
      'gpt-5.6-terra',
      [{ role: 'user', content: 'execută' }],
      [
        { name: 'read', description: 'citește', input_schema: { type: 'object', properties: {} } },
        { name: 'write', description: 'scrie', input_schema: { type: 'object', properties: {} } },
      ],
      { toolChoice: 'required', allowedFunctionNames: ['write'], reasoning: 'medium', temperature: 0.2 },
      false,
    ) as { tools: Array<{ name: string; strict: boolean }>; reasoning: { effort: string }; temperature?: number }
    expect(body.tools).toEqual([expect.objectContaining({ type: 'function', name: 'write', strict: false })])
    expect(body.reasoning.effort).toBe('medium')
    expect(body).not.toHaveProperty('messages')
    expect(body).not.toHaveProperty('temperature')
  })

  it('trimite reasoning pentru GPT-6 Astra și nu trimite temperature', () => {
    const body = toResponsesBody(
      'gpt-6-astra',
      [{ role: 'user', content: 'analizează și execută' }],
      [],
      { reasoning: 'high', temperature: 0.2 },
      false,
    ) as { reasoning?: { effort?: string }; temperature?: number }
    expect(body.reasoning).toEqual({ effort: 'high' })
    expect(body).not.toHaveProperty('temperature')
  })

  it('omite effort=none pentru GPT-6 Astra', () => {
    const body = toResponsesBody(
      'gpt-6-astra',
      [{ role: 'user', content: 'ok' }],
      [],
      { reasoning: 'none' },
      false,
    )
    expect(body).not.toHaveProperty('reasoning')
  })

  it('refuză o rundă required a cărei allowlist nu conține nicio unealtă oferită', () => {
    expect(() => toResponsesBody(
      'model-configurat',
      [{ role: 'user', content: 'execută' }],
      [{ name: 'read', description: 'citește', input_schema: { type: 'object', properties: {} } }],
      { toolChoice: 'required', allowedFunctionNames: ['write'] },
      false,
    )).toThrow('openai_required_tool_allowlist_empty')
  })

  it('elimină audio brut din Responses, păstrând transcriptul text', () => {
    const converted = toResponsesInput([{
      role: 'user',
      content: [
        { type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,QUJD' } },
        { type: 'text', text: 'transcript verificat' },
      ],
    }])
    expect(JSON.stringify(converted)).not.toContain('audio_url')
    expect(JSON.stringify(converted)).toContain('transcript verificat')
  })

  it('refuză audio brut fără transcript în loc să inventeze un mesaj vocal', () => {
    expect(() => toResponsesInput([{
      role: 'user',
      content: [{ type: 'audio_url', audio_url: { url: 'data:audio/wav;base64,QUJD' } }],
    }])).toThrow('openai_audio_transcript_required')
  })

  it('trimite store:false și cere reasoning criptat pentru fluxul stateless', () => {
    const body = toResponsesBody('model-configurat', [{ role: 'user', content: 'salut' }], [], {}, false)
    expect(body.store).toBe(false)
    expect(body.include).toEqual(['reasoning.encrypted_content'])
  })

  it('nu trimite reasoning pentru un model non-reasoning folosit la probă', () => {
    const body = toResponsesBody(
      'gpt-4.1-mini',
      [{ role: 'user', content: 'ok' }],
      [],
      { maxTokens: 8, reasoning: 'none' },
      false,
      false,
    )
    expect(body.max_output_tokens).toBe(8)
    expect(body).not.toHaveProperty('reasoning')
  })

  it('retrimite exact output items opace înaintea rezultatului uneltei', () => {
    const reasoning = {
      type: 'reasoning',
      id: 'rs_1',
      encrypted_content: 'opaque-ciphertext',
      summary: [],
    }
    const call = {
      type: 'function_call',
      id: 'fc_1',
      call_id: 'call_1',
      name: 'inspect',
      arguments: '{"x":1}',
    }
    const converted = toResponsesInput([
      { role: 'assistant', content: '', response_items: [reasoning, call] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
    ])
    expect(converted.input).toEqual([
      reasoning,
      call,
      { type: 'function_call_output', call_id: 'call_1', output: '{"ok":true}' },
    ])
    expect(converted.input[0]).not.toBe(reasoning)
  })

  it('folosește un safety_identifier pseudonim stabil, fără email în payload', () => {
    const body = toResponsesBody(
      'model-configurat',
      [{ role: 'user', content: 'salut' }],
      [],
      { usageContext: { userEmail: 'User@Example.test', surface: 'test' } },
      false,
    )
    expect(body.safety_identifier).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(body)).not.toContain('User@Example.test')
  })
})
