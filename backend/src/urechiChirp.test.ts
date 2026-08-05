import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── VOCE GOOGLE-ONLY (Adrian, 3 aug: „OpenAI scos din toată aplicația") ──────
// Urechile live sunt Google Chirp 3 streaming; vocea BRUTĂ a frazei ajunge
// nativ la creierul Gemini (câmpul `audio` din onPhrase → onAddressed →
// /api/chat). Gura o sintetizează serverul (Chirp 3 HD, cadre {audio}). NU mai
// există sesiune WebRTC OpenAI, nici proxy SDP, nici transcriere OpenAI.
// Testele astea prind pe oricine ar recabla OpenAI înapoi în calea vocală.

const voce = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8')
const mic = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/micStream.ts', import.meta.url)), 'utf8')
const serviciu = readFileSync(fileURLToPath(new URL('./services/realtime.ts', import.meta.url)), 'utf8')
const ruta = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')

describe('client: urechile live sunt Chirp 3 (Google), fără OpenAI', () => {
  it('sesiunea pornește urechea Chirp (startMicStream), NU o sesiune WebRTC', () => {
    expect(voce).toMatch(/await startMicStream\(\{/)
    expect(voce).not.toMatch(/RTCPeerConnection|addTransceiver|addTrack/)
  })
  it('vocea BRUTĂ a frazei ajunge NATIV la creierul Gemini (audio în onPhrase → onAddressed)', () => {
    expect(voce).toMatch(/onPhrase: \(t, vf, audio\) => \{[\s\S]{0,120}poartaDupaTranscript\(t, vf, audio\)/)
    expect(voce).toMatch(/onAddressed\?\.\(t, vf, speaker, audio\)/)
  })
  it('finalurile Chirp trec prin ACEEAȘI poartă (timbru → stop → nume)', () => {
    expect(voce).toMatch(/poartaDupaTranscript[\s\S]{0,600}transcriptVerdict\(t, vf\)/)
  })
  it('fără ureche Chirp NU se deschide OpenAI — se aruncă, panoul cade pe dictarea nativă', () => {
    expect(voce).toMatch(/marcheazaUrechiChirpMoarte\(\)/)
    expect(voce).toMatch(/throw new Error\('chirp_ear_unavailable'\)/)
    expect(mic).toMatch(/streamingAsrAvailable = false/)
  })
  it('mute-ul ajunge la urechea Chirp (nu există sender de mic WebRTC)', () => {
    expect(voce).toMatch(/chirpEar\?\.setMuted\(muted\)/)
  })
})

describe('micStream: urechea Chirp dă tot ce poarta cere', () => {
  it('onPhrase duce și amprenta frazei (poarta de timbru are nevoie direct)', () => {
    expect(mic).toMatch(/onPhrase: \(text: string, features: VoiceFeatures \| null, audio\?: string\) => void/)
    expect(mic).toMatch(/opts\.onPhrase\(text, features, audio\)/)
  })
  it('full-duplex NU murdărește depozitul partajat de features', () => {
    expect(mic).toMatch(/storePendingFeatures/)
    expect(mic).toMatch(/opts\.storePendingFeatures !== false/)
  })
  it('speech_begin ajunge la client (barge-in în full-duplex)', () => {
    expect(mic).toMatch(/opts\.onSpeechBegin\?\.\(\)/)
  })
  it('barge-in STT streaming permite stream-ul de audio chiar și pe muted la detectarea de voce', () => {
    expect(mic).toMatch(/rmsMut <= VOICE_RMS/)
  })
})

describe('server: fără proxy OpenAI, doar Google + Gemini', () => {
  it('ruta /api/realtime/session NU mai apelează OpenAI (openaiRealtimeAnswer a dispărut)', () => {
    expect(ruta).not.toContain('openaiRealtimeAnswer')
    expect(ruta).toMatch(/'\/api\/realtime\/session'[\s\S]{0,300}reply\.code\(410\)/)
  })
  it('rutele de facturare + transcript rămân intacte (nu le-a atins scoaterea OpenAI)', () => {
    expect(ruta).toContain('/api/realtime/tick')
    expect(ruta).toContain('/api/realtime/transcript')
  })
  it('serviciul realtime.ts nu mai are proxy SDP OpenAI, doar helperii puri', () => {
    expect(serviciu).not.toContain('openaiRealtimeAnswer')
    expect(serviciu).not.toMatch(/api\.openai\.com/)
    expect(serviciu).toMatch(/export function realtimeInstructions/)
    expect(serviciu).toMatch(/export function resolveVoice/)
  })
})
