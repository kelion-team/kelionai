import { describe, it, expect, vi, beforeEach } from 'vitest'

// We mock the orchestrator: we test the voice turn CONTRACT (which messages
// it hands to the brain + what it returns), not the brain itself.
const runOrchestrator = vi.hoisted(() => vi.fn())
vi.mock('./services/orchestrator.js', () => ({ runOrchestrator }))

import { voiceBrainTurn } from './services/voiceBrainTurn.js'
import type { AnthropicTool, OrMessage } from './services/openrouter.js'

const TOOLS: AnthropicTool[] = [{ name: 'read_email', description: 'x', input_schema: { type: 'object' } }]
const exec = vi.fn(async () => '{}')

describe('voiceBrainTurn — vocea = același creier (§6)', () => {
  beforeEach(() => {
    runOrchestrator.mockReset()
    exec.mockReset()
  })

  it('predă creierului system + istoric + transcriptul, în ordine, și întoarce textul de rostit', async () => {
    runOrchestrator.mockResolvedValue({ text: 'Am șters evenimentul.', costUsd: 0, model: 'm', rounds: 2 })
    const history: OrMessage[] = [{ role: 'user', content: 'salut' }, { role: 'assistant', content: 'bună' }]
    const spoken = await voiceBrainTurn('șterge întâlnirea de la 3', {
      model: 'test-model',
      tools: TOOLS,
      execTool: exec,
      systemPrompt: 'Ești Kelion.',
      history,
    })
    expect(spoken).toBe('Am șters evenimentul.')
    expect(runOrchestrator).toHaveBeenCalledTimes(1)
    const [model, messages, tools, passedExec] = runOrchestrator.mock.calls[0]
    expect(model).toBe('test-model')
    expect(tools).toBe(TOOLS) // ALL injected tools reach the brain
    expect(passedExec).toBe(exec) // the executor is the injected one (decoupled from HTTP)
    expect(messages[0]).toEqual({ role: 'system', content: 'Ești Kelion.' })
    expect(messages[1]).toEqual({ role: 'user', content: 'salut' })
    expect(messages[2]).toEqual({ role: 'assistant', content: 'bună' })
    expect(messages[3]).toEqual({ role: 'user', content: 'șterge întâlnirea de la 3' })
  })

  it('merge și fără istoric (prima replică)', async () => {
    runOrchestrator.mockResolvedValue({ text: 'Bună dimineața!', costUsd: 0, model: 'm', rounds: 1 })
    const spoken = await voiceBrainTurn('bună', { model: 'm', tools: TOOLS, execTool: exec, systemPrompt: 'S' })
    expect(spoken).toBe('Bună dimineața!')
    const messages = runOrchestrator.mock.calls[0][1]
    expect(messages).toHaveLength(2) // system + transcript
  })

  it('folosește poarta faptei (deedGate) — nu declară acțiuni fără unealtă', async () => {
    runOrchestrator.mockResolvedValue({ text: 'ok', costUsd: 0, model: 'm', rounds: 1 })
    await voiceBrainTurn('fă X', { model: 'm', tools: TOOLS, execTool: exec, systemPrompt: 'S' })
    const opts = runOrchestrator.mock.calls[0][4]
    expect(opts.deedGate).toBe(true)
  })

  it('facturează costul REAL al escaladării prin onCost (§6 — costul nu se pierde)', async () => {
    runOrchestrator.mockResolvedValue({ text: 'ok', costUsd: 0.0123, model: 'm', rounds: 2 })
    const costs: number[] = []
    await voiceBrainTurn('x', { model: 'm', tools: TOOLS, execTool: exec, systemPrompt: 'S', onCost: (u) => costs.push(u) })
    expect(costs).toEqual([0.0123])
  })

  it('cost 0 → NU cheamă onCost (nu debităm zero)', async () => {
    runOrchestrator.mockResolvedValue({ text: 'ok', costUsd: 0, model: 'm', rounds: 1 })
    const cb = vi.fn()
    await voiceBrainTurn('x', { model: 'm', tools: TOOLS, execTool: exec, systemPrompt: 'S', onCost: cb })
    expect(cb).not.toHaveBeenCalled()
  })
})
