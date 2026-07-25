import { describe, it, expect } from 'vitest'
import { toModel, resolveModel, toolsToOpenAI, hasActionIntent } from './openrouter.js'
import { runOrchestrator } from './orchestrator.js'

describe('openrouter catalog', () => {
  it('acceptă doar modele GPT/Gemini/Claude cu tools', () => {
    expect(
      toModel({ id: 'openai/gpt-4.1-mini', supported_parameters: ['tools'] }),
    )?.toMatchObject({ provider: 'openai' })
    expect(
      toModel({ id: 'anthropic/claude-sonnet-5', supported_parameters: ['tools'], architecture: { input_modalities: ['text', 'image'] } }),
    )?.toMatchObject({ provider: 'anthropic', vision: true })
    // fără tools → respins
    expect(toModel({ id: 'openai/gpt-4o', supported_parameters: [] })).toBeNull()
    // provider necunoscut → respins
    expect(toModel({ id: 'mistral/large', supported_parameters: ['tools'] })).toBeNull()
    // variantă veche exclusă
    expect(toModel({ id: 'openai/gpt-3.5-turbo', supported_parameters: ['tools'] })).toBeNull()
  })

  it('convertește uneltele Anthropic → OpenAI (input_schema → parameters)', () => {
    const out = toolsToOpenAI([
      { name: 'get_x', description: 'ia x', input_schema: { type: 'object', properties: {} } },
    ]) as { type: string; function: { name: string; parameters: unknown } }[]
    expect(out[0].type).toBe('function')
    expect(out[0].function.name).toBe('get_x')
    expect(out[0].function.parameters).toEqual({ type: 'object', properties: {} })
  })

  it('orchestratorul se oprește curat fără cheie (nu blochează)', async () => {
    const r = await runOrchestrator('openai/gpt-4.1-mini', [{ role: 'user', content: 'salut' }], [], async () => '')
    expect(r.text).toBe('')
    expect(r.costUsd).toBe(0)
  })

  it('resolveModel cade pe implicit când modelul cerut nu e în tier', async () => {
    // Fără cheie OpenRouter (mediul de test) catalogul e gol → orice cerere cade
    // pe implicitul tier-ului, niciodată pe un model neverificat.
    // Implicitul chat = un model REAL gratuit, testat live (tool-call curat +
    // vedere reală) — vezi config.ts pentru dovada testului.
    expect(await resolveModel('chat', 'ceva/inexistent')).toBe('google/gemma-4-26b-a4b-it:free')
    // Implicitul work = Fable 5 (Adrian, 25 iul: „Kelion trebuie să folosească
    // Fable 5") — cel mai capabil model, cu raționament intern.
    expect(await resolveModel('work', null)).toBe('anthropic/claude-fable-5')
  })

  it('hasActionIntent (25 iul — escaladare economică: ieftin implicit, greu doar pe cereri de acțiune reală)', () => {
    expect(hasActionIntent('repară animația gurii')).toBe(true)
    expect(hasActionIntent('rulează diagnostic te rog')).toBe(true)
    expect(hasActionIntent('publică fixul în producție')).toBe(true)
    expect(hasActionIntent('bună, ce mai faci?')).toBe(false)
    expect(hasActionIntent('mulțumesc pentru ajutor')).toBe(false)
  })
})
