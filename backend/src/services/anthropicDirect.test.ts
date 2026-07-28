import { describe, it, expect } from 'vitest'
import {
  toAnthropicPayload,
  ANTHROPIC_DIRECT_PREFIX,
  claudeModelHasVision,
  CLAUDE_MODELS,
  DEFAULT_CLAUDE_MODEL,
} from './anthropicDirect.js'
import type { OrMessage } from './openrouter.js'

describe('anthropic direct (creierul de abonament pe Claude)', () => {
  it('extrage system, păstrează tool_use și contopește rezultatele de unelte într-un singur mesaj user', () => {
    const messages: OrMessage[] = [
      { role: 'system', content: 'Ești Kelion.' },
      { role: 'user', content: 'deschide google și caută vremea' },
      {
        role: 'assistant',
        content: 'imediat',
        tool_calls: [
          { id: 'toolu_1', type: 'function', function: { name: 'show_on_screen', arguments: '{"url":"https://google.com"}' } },
          { id: 'toolu_2', type: 'function', function: { name: 'get_weather', arguments: '{}' } },
        ],
      },
      // Orchestratorul emite un mesaj role:'tool' PER unealtă — Anthropic cere ca
      // ambele tool_result să stea în ACELAȘI mesaj user următor.
      { role: 'tool', tool_call_id: 'toolu_1', content: '{"shown":true}' },
      { role: 'tool', tool_call_id: 'toolu_2', content: '{"temp":21}' },
    ]
    const body = toAnthropicPayload(
      messages,
      [{ name: 'show_on_screen', description: 'arată', input_schema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } }],
      { toolChoice: 'required' },
    ) as {
      system?: string
      messages: { role: string; content: { type: string; tool_use_id?: string; id?: string }[] }[]
      tool_choice?: { type: string }
    }

    expect(body.system).toBe('Ești Kelion.')
    // user, assistant(text+2×tool_use), user(2×tool_result contopite)
    expect(body.messages).toHaveLength(3)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[1].role).toBe('assistant')
    expect(body.messages[1].content.filter((b) => b.type === 'tool_use')).toHaveLength(2)
    expect(body.messages[2].role).toBe('user')
    const results = body.messages[2].content.filter((b) => b.type === 'tool_result')
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.tool_use_id)).toEqual(['toolu_1', 'toolu_2'])
    expect(body.tool_choice).toEqual({ type: 'any' })
  })

  it('convertește imaginile din format OpenAI (data-URI) în blocuri Anthropic base64', () => {
    const messages: OrMessage[] = [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'ce vezi?' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,ABC123' } },
        ],
      },
    ]
    const body = toAnthropicPayload(messages, []) as {
      messages: { role: string; content: { type: string; source?: { type: string; media_type: string; data: string } }[] }[]
    }
    const img = body.messages[0].content.find((b) => b.type === 'image')
    expect(img?.source).toEqual({ type: 'base64', media_type: 'image/png', data: 'ABC123' })
  })

  it('lista de modele Claude e neredundantă, are vedere și include implicitul', () => {
    expect(CLAUDE_MODELS.length).toBeGreaterThan(0)
    expect(CLAUDE_MODELS.every((m) => m.vision)).toBe(true)
    expect(CLAUDE_MODELS.some((m) => m.id === DEFAULT_CLAUDE_MODEL)).toBe(true)
    expect(claudeModelHasVision(DEFAULT_CLAUDE_MODEL)).toBe(true)
    // Model necunoscut → presupunem că vede (nu blocăm ruta degeaba).
    expect(claudeModelHasVision('model-inexistent')).toBe(true)
    expect(ANTHROPIC_DIRECT_PREFIX).toBe('anthropic-direct/')
  })
})
