// ── VOCEA PER USER: preferința nu are voie să omoare vocea ───────────────────
//
// Adrian, 30 iul: „își poate seta aplicația cu ce voce dorește… se ține minte
// per user. A nu se încurca cu alt user sau să afecteze alt cont."
//
// Riscul real al funcției ăsteia nu e estetic, e de disponibilitate: dacă un
// nume de voce necunoscut ajunge în sesiunea OpenAI, aceasta întoarce 400 și
// omul rămâne FĂRĂ VOCE — fără să aibă de unde bănui că vinovată e o preferință
// salvată cândva în contul lui. De-aia rezolvarea e o funcție pură, probată.
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
