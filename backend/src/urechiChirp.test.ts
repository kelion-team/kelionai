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
    expect(voce).toMatch(/onPhrase: \(_t, vf, audio\) => \{[\s\S]{0,300}poartaDupaFraza\(vf, audio\)/)
    expect(voce).toMatch(/onAddressed\?\.\('', vf, speaker, audio\)/)
  })
  it('fraza trece prin poarta de TIMBRU → creier (verdict din voiceFeatures, fără text)', () => {
    expect(voce).toMatch(/poartaDupaFraza[\s\S]{0,600}transcriptVerdict\('', vf, audio\)/)
  })
  it('fără microfon NU se deschide OpenAI, NU există STT de rezervă — se aruncă', () => {
    expect(voce).toMatch(/throw new Error\('chirp_ear_unavailable'\)/)
    // Nu mai există sondă de capabilitate STT / WebSocket la asr-stream în micStream.
    expect(mic).not.toMatch(/asr-stream/)
    expect(mic).not.toMatch(/new WebSocket/)
  })
  it('mute-ul ajunge la urechea Chirp (nu există sender de mic WebRTC)', () => {
    expect(voce).toMatch(/chirpEar\?\.setMuted\(muted\)/)
  })
})

describe('micStream: urechea Chirp dă tot ce poarta cere', () => {
  it('onPhrase duce și amprenta frazei (poarta de timbru are nevoie direct), fără text', () => {
    expect(mic).toMatch(/onPhrase: \(text: string, features: VoiceFeatures \| null, audio\?: string\) => void/)
    expect(mic).toMatch(/opts\.onPhrase\('', features, audio\)/)
  })
  it('full-duplex NU murdărește depozitul partajat de features', () => {
    expect(mic).toMatch(/storePendingFeatures/)
    expect(mic).toMatch(/opts\.storePendingFeatures !== false/)
  })
  it('speech_begin ajunge la client (barge-in în full-duplex)', () => {
    expect(mic).toMatch(/opts\.onSpeechBegin\?\.\(\)/)
  })
  it('fraza se închide pe VAD LOCAL (pauză), nu pe transcript de server — fără STT', () => {
    expect(mic).toMatch(/PAUZA_FRAZA_MS/)
    expect(mic).toMatch(/const closePhrase = \(\): void =>/)
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
