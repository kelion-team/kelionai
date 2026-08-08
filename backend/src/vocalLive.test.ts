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

// ── MEMORIA SESIUNII LIVE (8 aug, „execută cu Gemini") ──────────────────────
// Sesiunea Live pornește de la zero la fiecare deschidere — fără instrucțiunea
// care cară istoricul, Kelion ar fi un străin politicos la fiecare apăsare de
// microfon. Funcția e pură, deci se probează aici, nu se ia pe încredere.
import { construiesteInstructiune } from './services/vocalLive.js'

describe('vocalLive — instrucțiunea cară memoria omului', () => {
  const persona = 'Ești Kelion.'

  it('fără istoric: persona + numele, fără bloc de context inventat', () => {
    const i = construiesteInstructiune(persona, 'Adrian', [])
    expect(i).toContain('Ești Kelion.')
    expect(i).toContain('Adrian')
    expect(i, 'fără istoric nu există „ultimele schimburi" — nu se inventează').not.toContain('ULTIMELE')
  })

  it('cu istoric: ultimele schimburi intră, cu numele omului pe replicile lui', () => {
    const i = construiesteInstructiune(persona, 'Adrian', [
      { role: 'user', content: 'cât e ceasul?' },
      { role: 'assistant', content: 'E ora trei.' },
    ])
    expect(i).toContain('ULTIMELE VOASTRE SCHIMBURI')
    expect(i).toContain('Adrian: cât e ceasul?')
    expect(i).toContain('Kelion: E ora trei.')
  })

  it('istoricul lung se taie: ultimele 12 schimburi, replici de max 200, bloc de max 2400', () => {
    const lung = Array.from({ length: 40 }, (_, k) => ({ role: 'user', content: `mesajul ${k} ${'x'.repeat(500)}` }))
    const i = construiesteInstructiune(persona, 'Adrian', lung)
    expect(i, 'mesajul 27 e al 13-lea de la coadă — nu are ce căuta').not.toContain('mesajul 27 ')
    expect(i).toContain('mesajul 39 ')
    expect(i.length, 'un istoric nelimitat ar umfla setup-ul sesiunii ca vechiul prompt de 15.000 de tokeni').toBeLessThan(
      persona.length + 2600,
    )
  })
})

// ── SESIUNEA SUPRAVIEȚUIEȘTE LIMITEI GOOGLE (8 aug: „a funcționat 5 minute
// impecabil, după care a amuțit") ───────────────────────────────────────────
describe('vocalLive — reluarea sesiunii la limita de durată', () => {
  it('setup-ul CERE reluarea; la reconectare poartă handle-ul primit', () => {
    const proaspat = construiesteSetup('m', 'Charon', 'p', []) as { setup: Record<string, unknown> }
    expect(proaspat.setup.sessionResumption, 'fără cerere, Google nu dă handle și sesiunea moare sec la limită').toEqual({})
    const reluat = construiesteSetup('m', 'Charon', 'p', [], 'handle-123') as { setup: Record<string, unknown> }
    expect(reluat.setup.sessionResumption).toEqual({ handle: 'handle-123' })
  })

  it('„no limit": fereastra glisantă e cerută — contextul plin nu mai omoară sesiunea', () => {
    const st = construiesteSetup('m', 'Charon', 'p', []) as { setup: Record<string, unknown> }
    expect(st.setup.contextWindowCompression, 'fără compresie, sesiunea moare când conversația se lungește').toEqual({
      slidingWindow: {},
    })
  })

  it('handle-ul de reluare se citește din cadru (doar când e resumable)', () => {
    const ev = interpreteazaCadru({ sessionResumptionUpdate: { resumable: true, newHandle: 'h9' } })
    expect(ev).toContainEqual({ fel: 'handleReluare', handle: 'h9' })
    // ne-resumabil = nu avem cu ce relua — nu inventăm un handle
    expect(interpreteazaCadru({ sessionResumptionUpdate: { resumable: false, newHandle: 'h9' } })).toEqual([])
  })

  it('preavizul de închidere (goAway) se citește, cu timpul rămas în ms', () => {
    const ev = interpreteazaCadru({ goAway: { timeLeft: '12.5s' } })
    expect(ev).toContainEqual({ fel: 'preavizInchidere', msRamase: 12500 })
    // goAway fără timp rămâne preaviz — redeschidem oricum
    expect(interpreteazaCadru({ goAway: {} })).toContainEqual({ fel: 'preavizInchidere', msRamase: undefined })
  })
})
