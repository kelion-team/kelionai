// ── THE PER-USER VOICE: the preference must not kill the voice ─────────────
//
// Adrian, Jul 30: "they can set the app to whatever voice they want… it's
// remembered per user. Not to be mixed up with another user or affect another
// account."
//
// This function's real risk is not aesthetic, it's availability: if an
// unknown voice name reaches the OpenAI session, it returns 400 and the
// person is left WITHOUT VOICE — with no way to suspect the culprit is a
// preference saved once in their account. That's why the resolution is a pure
// function, proven.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    openai: {
      key: '',
      realtimeVoice: 'ash',
      realtimeVoices: ['alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer', 'verse'],
      realtimeModel: 'gpt-realtime',
      realtimeModelFallbacks: [],
      realtimeTranscribeModel: 'gpt-4o-transcribe',
      realtimeVadEagerness: 'auto',
    },
    adminEmail: 'adrianenc11@gmail.com',
  },
}))

const { resolveVoice } = await import('./services/realtime.js')

describe('vocea per user', () => {
  it('trece mai departe o voce din listă', () => {
    expect(resolveVoice('coral')).toBe('coral')
    expect(resolveVoice('verse')).toBe('verse')
  })

  it('cade pe implicită când preferința lipsește', () => {
    expect(resolveVoice(null)).toBe('ash')
    expect(resolveVoice(undefined)).toBe('ash')
    expect(resolveVoice('')).toBe('ash')
  })

  it('NU trimite spre OpenAI un nume necunoscut — ar da 400 și ar tăia vocea', () => {
    for (const rau of ['Coral', 'nu-exista', 'ash ', '../etc', 'alloy;drop']) {
      expect(resolveVoice(rau)).toBe('ash')
    }
  })
})
