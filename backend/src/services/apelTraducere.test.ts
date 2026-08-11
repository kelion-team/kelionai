import { describe, it, expect, vi, beforeEach } from 'vitest'

// Directorul fals + limbile. Mock-uim db (căutare user + limbă + cost), creierul
// (geminiDirectChat = STT+traducere) și TTS-ul (synthesize). Restul (apelul real +
// releul) rulează adevărat, ca să probăm lanțul cap-coadă: audio → tradus la celălalt.
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
const geminiDirectChat = vi.fn(async () => ({
  text: 'Bună (tradus în ro)',
  toolCalls: [],
  costUsd: 0.001,
  model: 'x',
  stop: 'end',
  inputTokens: 1,
  outputTokens: 1,
}))
vi.mock('./geminiDirect.js', () => ({ geminiDirectChat }))
const synthesize = vi.fn(async () => ({ ok: true, audio: Buffer.from('MP3DATA'), engine: 'google' }))
vi.mock('./tts.js', () => ({ synthesize }))
vi.mock('./cost.js', () => ({ ttsCost: () => 0.0001 }))
vi.mock('../config.js', () => ({ config: { geminiModel: 'gemini-test' } }))

const apel = await import('./apel.js')
const { traduVorbire } = await import('./apelTraducere.js')

function con(): { trimite: (m: unknown) => void; mesaje: any[] } {
  const mesaje: any[] = []
  return { trimite: (m) => mesaje.push(m), mesaje }
}

describe('services/apelTraducere.ts — traducerea live în apel (Faza 2)', () => {
  beforeEach(() => {
    apel._reset()
    geminiDirectChat.mockClear()
    synthesize.mockClear()
  })

  it('o frază de la A ajunge la B TRADUSĂ (text + voce)', async () => {
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
    expect(tradus.text).toBe('Bună (tradus în ro)')
    expect(tradus.audio).toBe(Buffer.from('MP3DATA').toString('base64'))
    expect(tradus.de_la).toBe('Ana') // numele celui care a vorbit
    expect(geminiDirectChat).toHaveBeenCalledTimes(1)
    // TTS în limba DESTINATARULUI (ro), nu a vorbitorului.
    expect(synthesize).toHaveBeenCalledWith('Bună (tradus în ro)', 'ro', expect.anything())
  })

  it('dacă Gemini nu scoate text (tăcere/zgomot) → nu se trimite nimic', async () => {
    geminiDirectChat.mockResolvedValueOnce({
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
    expect(geminiDirectChat).not.toHaveBeenCalled()
    expect(cB.mesaje.some((m) => m.type === 'tradus')).toBe(false)
  })

  it('dacă TTS pică, tot trimite subtitrarea (fără voce)', async () => {
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
    expect(tradus.text).toBe('Bună (tradus în ro)')
    expect(tradus.audio).toBe('') // fără voce, dar subtitrarea ajunge
  })
})
