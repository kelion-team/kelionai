import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── PASUL MARE (Adrian, Aug 1: „faci acum pasul mare" + „Chirp 3 hd peste
// tot") ─────────────────────────────────────────────────────────────────────
// The LIVE full-duplex ears are Google Chirp 3 streaming; the OpenAI Realtime
// session keeps ONE job: the mouth. Guards against anyone rewiring the ears
// back to the weak transcription, dropping the shared gate, or billing input
// audio to OpenAI again.

const voce = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8')
const mic = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/micStream.ts', import.meta.url)), 'utf8')
const serviciu = readFileSync(fileURLToPath(new URL('./services/realtime.ts', import.meta.url)), 'utf8')
const ruta = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')

describe('client: urechile live sunt Chirp 3', () => {
  it('clientul întreabă ÎNAINTE de sesiune dacă Chirp streaming există', () => {
    expect(voce).toMatch(/urechiChirpDisponibile\(\)/)
  })
  it('cu urechi Chirp, microfonul NU mai ajunge la OpenAI (gura e receive-only)', () => {
    expect(voce).toMatch(/if \(urechiChirp\) \{\s*pc\.addTransceiver\('audio', \{ direction: 'recvonly' \}\)/)
  })
  it('fără Chirp, calea veche (addTrack + transcriere OpenAI) rămâne neatinsă', () => {
    expect(voce).toMatch(/pc\.addTrack\(track, mic\)/)
    expect(voce).toMatch(/input_audio_transcription\.completed/)
  })
  it('sesiunea spune serverului ce urechi are', () => {
    expect(voce).toMatch(/ears: urechiChirp \? 'chirp' : 'openai'/)
  })
  it('finalurile Chirp trec prin ACEEAȘI poartă (timbru → stop → nume)', () => {
    expect(voce).toMatch(/onPhrase: \(t, vf\) => \{[\s\S]{0,120}poartaDupaTranscript\(t, vf\)/)
    expect(voce).toMatch(/poartaDupaTranscript[\s\S]{0,400}transcriptVerdict\(t, vf\)/)
  })
  it('urechia moartă marchează și cade pe urechile OpenAI, fără bucle', () => {
    expect(voce).toMatch(/marcheazaUrechiChirpMoarte\(\)/)
    expect(mic).toMatch(/streamingAsrAvailable = false/)
  })
  it('mute-ul ajunge la urechea Chirp (gura receive-only nu are sender de mic)', () => {
    expect(voce).toMatch(/chirpEar\?\.setMuted\(muted\)/)
  })
})

describe('micStream: urechea Chirp dă tot ce poarta cere', () => {
  it('onPhrase duce și amprenta frazei (poarta de timbru are nevoie direct)', () => {
    expect(mic).toMatch(/onPhrase: \(text: string, features: VoiceFeatures \| null\) => void/)
    expect(mic).toMatch(/opts\.onPhrase\(text, features\)/)
  })
  it('full-duplex NU murdărește depozitul partajat de features', () => {
    expect(mic).toMatch(/storePendingFeatures/)
    expect(mic).toMatch(/opts\.storePendingFeatures !== false/)
  })
  it('speech_begin ajunge la client (barge-in în full-duplex)', () => {
    expect(mic).toMatch(/opts\.onSpeechBegin\?\.\(\)/)
  })
})

describe('server: sesiunea pur-gură la urechi Chirp', () => {
  it('ruta primește ears și îl duce la serviciu', () => {
    expect(ruta).toMatch(/ears\?: string/)
    expect(ruta).toMatch(/=== 'chirp'/)
    expect(ruta).toMatch(/openaiRealtimeAnswer\(offer, lang, isAdmin, vocePref, urechiChirp\)/)
  })
  it('la urechi Chirp sesiunea NU mai are transcriere de input nici VAD', () => {
    expect(serviciu).toMatch(/urechiChirp = false/)
    expect(serviciu).toMatch(/\.\.\.\(urechiChirp\s*\?\s*\{\}\s*:\s*\{/)
  })
  it('calea fallback păstrează transcrierea + semantic_vad', () => {
    expect(serviciu).toMatch(/realtimeTranscribeModel/)
    expect(serviciu).toMatch(/semantic_vad/)
  })
})
