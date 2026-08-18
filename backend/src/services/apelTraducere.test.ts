import { describe, it, expect, vi, beforeEach } from 'vitest'

// Directorul fals + limbile. Mock-uim db, creierul UNITAR (rationeazaMesaje) ?i TTS.
// Restul (apelul real + releul) ruleaz? adev?rat.
const DIR = [
  { email: 'a@x.com', name: 'Ana' },
  { email: 'b@x.com', name: 'Bogdan' },
]
vi.mock('../db.js', () => ({
  cautaUtilizatorApel: vi.fn(async (t: string) => {
    const q = t.toLowerCase()
    return { citit: true, valoare: DIR.filter((u) => u.email.includes(q) || u.name.toLowerCase().includes(q)) }
  }),
  getSpeechLang: vi.fn(async () => 'ro'),
  recordCost: vi.fn(async () => {}),
}))

const { rationeazaMesaje } = vi.hoisted(() => ({
  rationeazaMesaje: vi.fn(async () => ({
    text: 'Bun? (tradus ?n ro)',
    toolCalls: [],
    costUsd: 0.001,
    model: 'x',
    stop: 'end',
    inputTokens: 1,
    outputTokens: 1,
  })),
}))
vi.mock('./creierRationament.js', () => ({ rationeazaMesaje }))

const synthesize = vi.fn(async () => ({ ok: true, audio: Buffer.from('MP3DATA'), engine: 'google' }))
vi.mock('./tts.js', () => ({ synthesize }))
vi.mock('./cost.js', () => ({ ttsCost: () => 0.0001 }))
vi.mock('../config.js', () => ({ config: { geminiModel: 'gemini-test' } }))

const apel = await import('./apel.js')
const { traduVorbire, intentApel } = await import('./apelTraducere.js')

function con(): { trimite: (m: unknown) => void; mesaje: any[] } {
  const mesaje: any[] = []
  return { trimite: (m) => mesaje.push(m), mesaje }
}

describe('services/apelTraducere.ts ? traducerea live ?n apel (Faza 2)', () => {
  beforeEach(() => {
    apel._reset()
    rationeazaMesaje.mockClear()
    synthesize.mockClear()
    rationeazaMesaje.mockResolvedValue({
      text: 'Bun? (tradus ?n ro)',
      toolCalls: [],
      costUsd: 0.001,
      model: 'x',
      stop: 'end',
      inputTokens: 1,
      outputTokens: 1,
    })
  })

  it('o fraz? de la A ajunge la B TRADUS? (text + voce)', async () => {
    const cA = con()
    const cB = con()
    apel.inregistreazaPrezenta('a@x.com', cA)
    apel.inregistreazaPrezenta('b@x.com', cB)
    const r = await apel.sunaUtilizator('a@x.com', 'Bogdan')
    expect(r.ok).toBe(true)
    apel.gestioneazaMesaj('b@x.com', { type: 'accept', callId: r.callId })

    await traduVorbire('a@x.com', { callId: r.callId, audio: 'BASE64AUDIO', mime: 'audio/webm' })

    const tradus = cB.mesaje.find((m) => m.type === 'tradus')
    expect(tradus).toBeTruthy()
    expect(tradus.text).toBe('Bun? (tradus ?n ro)')
    expect(tradus.audio).toBe(Buffer.from('MP3DATA').toString('base64'))
    expect(tradus.de_la).toBe('Ana')
    expect(rationeazaMesaje).toHaveBeenCalledTimes(1)
    expect(synthesize).toHaveBeenCalledWith('Bun? (tradus ?n ro)', 'ro', expect.anything())
  })

  it('dac? Gemini nu scoate text (t?cere/zgomot) ? nu se trimite nimic', async () => {
    rationeazaMesaje.mockResolvedValueOnce({
      text: '',
      toolCalls: [],
      costUsd: 0,
      model: 'x',
      stop: 'end',
      inputTokens: 0,
      outputTokens: 0,
    })
    const cA = con()
    const cB = con()
    apel.inregistreazaPrezenta('a@x.com', cA)
    apel.inregistreazaPrezenta('b@x.com', cB)
    const r = await apel.sunaUtilizator('a@x.com', 'Bogdan')
    apel.gestioneazaMesaj('b@x.com', { type: 'accept', callId: r.callId })
    await traduVorbire('a@x.com', { callId: r.callId, audio: 'X', mime: 'audio/webm' })
    expect(cB.mesaje.some((m) => m.type === 'tradus')).toBe(false)
  })

  it('cineva din AFARA apelului nu poate injecta traduceri', async () => {
    const cA = con()
    const cB = con()
    apel.inregistreazaPrezenta('a@x.com', cA)
    apel.inregistreazaPrezenta('b@x.com', cB)
    const r = await apel.sunaUtilizator('a@x.com', 'Bogdan')
    await traduVorbire('strain@x.com', { callId: r.callId, audio: 'X', mime: 'audio/webm' })
    expect(rationeazaMesaje).not.toHaveBeenCalled()
    expect(cB.mesaje.some((m) => m.type === 'tradus')).toBe(false)
  })

  it('dac? TTS pic?, tot trimite subtitrarea (f?r? voce)', async () => {
    synthesize.mockResolvedValueOnce({ ok: false, status: 500, error: 'tts down' } as never)
    const cA = con()
    const cB = con()
    apel.inregistreazaPrezenta('a@x.com', cA)
    apel.inregistreazaPrezenta('b@x.com', cB)
    const r = await apel.sunaUtilizator('a@x.com', 'Bogdan')
    apel.gestioneazaMesaj('b@x.com', { type: 'accept', callId: r.callId })
    await traduVorbire('a@x.com', { callId: r.callId, audio: 'X', mime: 'audio/webm' })
    const tradus = cB.mesaje.find((m) => m.type === 'tradus')
    expect(tradus).toBeTruthy()
    expect(tradus.text).toBe('Bun? (tradus ?n ro)')
    expect(tradus.audio).toBe('')
  })
})

describe('services/apelTraducere.ts ? hands-free ?spui r?spunde ?i se face leg?tura"', () => {
  beforeEach(() => {
    rationeazaMesaje.mockClear()
    rationeazaMesaje.mockResolvedValue({
      text: 'NONE',
      toolCalls: [],
      costUsd: 0.0001,
      model: 'x',
      stop: 'end',
      inputTokens: 1,
      outputTokens: 1,
    })
  })

  it('ANSWER din voce ? inten?ia ?answer"', async () => {
    rationeazaMesaje.mockResolvedValueOnce({ text: 'ANSWER', toolCalls: [], costUsd: 0.0001, model: 'x', stop: 'end', inputTokens: 1, outputTokens: 1 })
    expect(await intentApel('a@x.com', 'BASE64', 'audio/webm')).toBe('answer')
  })

  it('DECLINE din voce ? inten?ia ?decline"', async () => {
    rationeazaMesaje.mockResolvedValueOnce({ text: 'DECLINE', toolCalls: [], costUsd: 0.0001, model: 'x', stop: 'end', inputTokens: 1, outputTokens: 1 })
    expect(await intentApel('a@x.com', 'BASE64', 'audio/webm')).toBe('decline')
  })

  it('zgomot/neclar ? ?none" (nu accept?/refuz? din gre?eal?)', async () => {
    rationeazaMesaje.mockResolvedValueOnce({ text: 'NONE', toolCalls: [], costUsd: 0.0001, model: 'x', stop: 'end', inputTokens: 1, outputTokens: 1 })
    expect(await intentApel('a@x.com', 'BASE64', 'audio/webm')).toBe('none')
  })

  it('f?r? audio ? ?none" f?r? s? cheme creierul', async () => {
    expect(await intentApel('a@x.com', '', 'audio/webm')).toBe('none')
    expect(rationeazaMesaje).not.toHaveBeenCalled()
  })
})
