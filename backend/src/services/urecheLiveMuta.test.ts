import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── CÂINELE DE PAZĂ AL MUȚENIEI — dovada că e DETERMINIST, nu „probabil" ──────
//
// Muțenia măsurată (5 aug): urechea Live se conecta, primea 180+ cadre (16s) și
// întorcea ZERO transcriere, FĂRĂ nicio eroare — deci nimeni n-o declara moartă
// și clientul murea „silent". Aici demonstrăm cele două comportamente ale
// câinelui de pază, cu un WebSocket fals și timp fals:
//   1) audio curge, zero transcriere pe fereastră → onEroare cu „mut" (cade pe rafale);
//   2) a venit măcar o transcriere → urechea e VIE și câinele NU latră niciodată.

const H = vi.hoisted(() => {
  type Handler = (...a: unknown[]) => void
  class FakeWS {
    handlers: Record<string, Handler[]> = {}
    sent: string[] = []
    on(ev: string, cb: Handler): this {
      ;(this.handlers[ev] ||= []).push(cb)
      return this
    }
    send(s: string): void {
      this.sent.push(s)
    }
    close(): void {
      this.emit('close', 1000, Buffer.from(''))
    }
    emit(ev: string, ...a: unknown[]): void {
      ;(this.handlers[ev] || []).forEach((f) => f(...a))
    }
  }
  return { FakeWS, state: { last: null as FakeWS | null } }
})

vi.mock('ws', () => ({
  default: class {
    constructor() {
      H.state.last = new H.FakeWS()
      return H.state.last as unknown as object
    }
  },
}))
vi.mock('../config.js', () => ({ config: { geminiKey: 'test-key' } }))

import { deschideUrecheaLive } from './urecheLiveGemini.js'

function evenimenteSpion() {
  return {
    onPartial: vi.fn(),
    onFinal: vi.fn(),
    onVorbireIncepe: vi.fn(),
    onVorbireSeTermina: vi.fn(),
    onEroare: vi.fn(),
  }
}

function porneste(ev: ReturnType<typeof evenimenteSpion>) {
  const ureche = deschideUrecheaLive('ro-RO', ev)
  expect(ureche).not.toBeNull()
  const ws = H.state.last!
  ws.emit('open')
  ws.emit('message', Buffer.from(JSON.stringify({ setupComplete: {} })))
  return { ureche: ureche!, ws }
}

describe('urechea Live — câinele de pază al muțeniei', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('MUT: audio curge, zero transcriere → onEroare „mut" după fereastră', () => {
    const ev = evenimenteSpion()
    const { ureche } = porneste(ev)
    // peste MUT_CADRE (40) de cadre de audio real, dar nicio transcriere
    for (let i = 0; i < 50; i++) ureche.scrieAudio(Buffer.from([0, 0]))
    expect(ev.onEroare).not.toHaveBeenCalled() // încă în fereastra MUT_MS
    vi.advanceTimersByTime(9000) // peste MUT_MS (8000)
    expect(ev.onEroare).toHaveBeenCalledTimes(1)
    expect(String(ev.onEroare.mock.calls[0][0])).toContain('mut')
  })

  it('VIE: a venit o transcriere → câinele NU latră, oricât ar trece', () => {
    const ev = evenimenteSpion()
    const { ureche, ws } = porneste(ev)
    for (let i = 0; i < 50; i++) ureche.scrieAudio(Buffer.from([0, 0]))
    // urechea produce text → e vie
    ws.emit('message', Buffer.from(JSON.stringify({ serverContent: { inputTranscription: { text: 'salut' } } })))
    vi.advanceTimersByTime(20000)
    expect(ev.onEroare).not.toHaveBeenCalled()
    expect(ev.onPartial).toHaveBeenCalled()
  })

  it('LINIȘTE: fără audio real → câinele NU latră (nu confundă tăcerea cu muțenia)', () => {
    const ev = evenimenteSpion()
    porneste(ev)
    // niciun cadru de audio trimis — omul tace
    vi.advanceTimersByTime(20000)
    expect(ev.onEroare).not.toHaveBeenCalled()
  })
})
