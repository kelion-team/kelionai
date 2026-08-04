import { describe, it, expect, vi } from 'vitest'

// Env priming ca importul config să nu arunce (ca în celelalte teste).
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'test-uri')
vi.stubEnv('SESSION_SECRET', 'test-session-secret')

import { construiesteSetup, interpreteazaCadru } from './services/vocalLive.js'

// ── VOCEA UNIFICATĂ (Gemini Live) — părțile PURE, probate fără rețea ──────────
// construiesteSetup e contractul cu Google (model/voce/modalitate/unelte);
// interpreteazaCadru traduce cadrele serverului. Ambele decid dacă vocea merge,
// deci le țin sub test.

describe('vocalLive — construiesteSetup', () => {
  it('cere AUDIO + voce masculină + transcriere pe ambele sensuri', () => {
    const s = construiesteSetup('model-x', 'Charon', 'Ești Kelion.', []) as {
      setup: {
        model: string
        generationConfig: { responseModalities: string[]; speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } }
        inputAudioTranscription: unknown
        outputAudioTranscription: unknown
        systemInstruction: { parts: { text: string }[] }
      }
    }
    expect(s.setup.model).toBe('models/model-x')
    expect(s.setup.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(s.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Charon')
    expect(s.setup.inputAudioTranscription).toBeDefined()
    expect(s.setup.outputAudioTranscription).toBeDefined()
    expect(s.setup.systemInstruction.parts[0].text).toBe('Ești Kelion.')
  })

  it('fără unelte NU trimite câmpul tools; cu unelte îl trimite', () => {
    const gol = construiesteSetup('m', 'Puck', 'x', []) as { setup: Record<string, unknown> }
    expect(gol.setup.tools).toBeUndefined()
    const cu = construiesteSetup('m', 'Puck', 'x', [
      { name: 'cauta', description: 'caută', parameters: { type: 'object', properties: {} } },
    ]) as { setup: { tools: { functionDeclarations: { name: string }[] }[] } }
    expect(cu.setup.tools[0].functionDeclarations[0].name).toBe('cauta')
  })
})

describe('vocalLive — interpreteazaCadru', () => {
  it('setupComplete → eveniment gata', () => {
    expect(interpreteazaCadru({ setupComplete: {} })).toEqual([{ fel: 'gata' }])
  })

  it('audio de ieșire din modelTurn', () => {
    const ev = interpreteazaCadru({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAA', mimeType: 'audio/pcm' } }] } },
    })
    expect(ev).toContainEqual({ fel: 'audio', data: 'AAA' })
  })

  it('transcrierea userului și a lui Kelion, cu final pe turnComplete', () => {
    const ev = interpreteazaCadru({
      serverContent: { inputTranscription: { text: 'salut' }, outputTranscription: { text: 'bună' }, turnComplete: true },
    })
    expect(ev).toContainEqual({ fel: 'user', text: 'salut', final: true })
    expect(ev).toContainEqual({ fel: 'kelion', text: 'bună', final: true })
    expect(ev).toContainEqual({ fel: 'turaGata' })
  })

  it('barge-in (interrupted) → eveniment intrerupt', () => {
    const ev = interpreteazaCadru({ serverContent: { interrupted: true } })
    expect(ev).toContainEqual({ fel: 'intrerupt' })
  })

  it('apel de unealtă din toolCall', () => {
    const ev = interpreteazaCadru({ toolCall: { functionCalls: [{ id: '7', name: 'cauta', args: { q: 'x' } }] } })
    expect(ev).toContainEqual({ fel: 'unealta', id: '7', name: 'cauta', args: { q: 'x' } })
  })

  it('cadru necunoscut → nicio eroare, listă goală', () => {
    expect(interpreteazaCadru({ ceva: 'altceva' })).toEqual([])
  })
})
