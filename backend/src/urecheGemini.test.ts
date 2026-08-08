import { describe, expect, it } from 'vitest'
import { pcm16InWav } from './services/urecheGemini.js'

// Urechea Gemini (3 aug): antetul WAV e singura parte pură — dacă e strâmb,
// Gemini refuză audio-ul și auzul de rezervă moare tăcut. Batem în cuie forma.
describe('pcm16InWav', () => {
  it('scrie antetul RIFF/WAVE corect pentru 16kHz mono', () => {
    const pcm = Buffer.alloc(32_000) // 1s la 16kHz, 16-bit, mono
    const wav = pcm16InWav(pcm, 16_000)
    expect(wav.length).toBe(44 + 32_000)
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF')
    expect(wav.readUInt32LE(4)).toBe(36 + 32_000)
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE')
    expect(wav.readUInt16LE(20)).toBe(1) // PCM liniar
    expect(wav.readUInt16LE(22)).toBe(1) // mono
    expect(wav.readUInt32LE(24)).toBe(16_000)
    expect(wav.readUInt32LE(28)).toBe(32_000) // byte rate = rate × canale × 2
    expect(wav.readUInt32LE(40)).toBe(32_000) // mărimea datelor
  })

  it('respectă numărul de canale cerut', () => {
    const wav = pcm16InWav(Buffer.alloc(4), 48_000, 2)
    expect(wav.readUInt16LE(22)).toBe(2)
    expect(wav.readUInt32LE(28)).toBe(48_000 * 2 * 2)
  })
})
