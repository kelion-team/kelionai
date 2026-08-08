// ── VOCEA UNICĂ CHIRP: nicio preferință veche nu poate ucide vocea ──────────
//
// (3 aug — extirparea totală OpenAI: lista de voci realtime alloy/ash/… a
// MURIT împreună cu furnizorul. Vocea aplicației e UNA singură — stilul Chirp
// din config.ttsVoiceStyle, implicit Charon, masculin.)
//
// Riscul real rămâne disponibilitatea: o preferință veche salvată în cont
// (un nume de voce OpenAI) nu are voie să ajungă nicăieri și nici să lase
// omul fără voce. resolveVoice e pură și cade MEREU pe stilul Chirp unic.
import { describe, it, expect, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {
    ttsVoiceStyle: 'Charon',
    adminEmail: 'adrianenc11@gmail.com',
  },
}))

const { resolveVoice } = await import('./services/realtime.js')

describe('vocea unică Chirp', () => {
  it('orice cerere — inclusiv un nume vechi de voce OpenAI — cade pe stilul Chirp unic', () => {
    for (const cerut of ['coral', 'verse', 'ash', 'nu-exista', '../etc', 'alloy;drop']) {
      expect(resolveVoice(cerut)).toBe('Charon')
    }
  })

  it('preferința lipsă cade tot pe stilul Chirp unic', () => {
    expect(resolveVoice(null)).toBe('Charon')
    expect(resolveVoice(undefined)).toBe('Charon')
    expect(resolveVoice('')).toBe('Charon')
  })
})
