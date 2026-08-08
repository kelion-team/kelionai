import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── VOCE GOOGLE-ONLY: OPENAI SCOS COMPLET (Adrian, 3 aug) ────────────────────
// Ordin direct, 3 aug: „OpenAI scos din toată aplicația". Sesiunea vocală
// rulează integral pe Google + Gemini: urechi Chirp 3 streaming, creier Gemini
// (/api/chat), gura = Google TTS Chirp 3 HD sintetizată de server și trimisă ca
// {audio}. NU se mai deschide NICIO sesiune WebRTC OpenAI, nici rezervă.
// Frontend-ul n-are test runner; îl citim de aici, ca urechiChirp.test.ts.
const voce = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8')
const panou = readFileSync(fileURLToPath(new URL('../../frontend/src/components/ChatPanel.tsx', import.meta.url)), 'utf8')
const ruta = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')

describe('clientul de voce: ZERO OpenAI, niciun WebRTC', () => {
  it('nu se construiește NICIUN RTCPeerConnection', () => {
    expect(voce).not.toMatch(/RTCPeerConnection/)
  })
  it('nu se apelează NICIODATĂ /api/realtime/session (SDP-ul OpenAI a dispărut)', () => {
    expect(voce).not.toContain('/api/realtime/session')
  })
  it('nu mai există coada de rostire OpenAI (ROSTEȘTE / SPEAK_PREFIX / response.create)', () => {
    expect(voce).not.toContain('SPEAK_PREFIX')
    expect(voce).not.toContain('ROSTEȘTE')
    expect(voce).not.toMatch(/response\.create/)
    expect(voce).not.toMatch(/dataChannel|createDataChannel|oai-events/)
  })
  it('niciun apel direct către API-ul OpenAI (nici SDP, nici altceva)', () => {
    expect(voce).not.toMatch(/api\.openai\.com/)
  })
})

describe('sesiunea vocală rulează pe Google/Gemini și e marcată guraChirp', () => {
  it('handle-ul întoarce guraChirp: true (panoul redă {audio} serverului)', () => {
    expect(voce).toMatch(/guraChirp: true/)
  })
  it('log-ul live anunță modul Google-only (Chirp + Gemini, fără OpenAI)', () => {
    expect(voce).toContain('fără OpenAI')
  })
  it('interrupt/stopSpeaking = stopVoice (audioIO), nu trimit nimic nicăieri', () => {
    expect(voce).toMatch(/interrupt: \(\) => stopVoice\(\)/)
    expect(voce).toMatch(/stopSpeaking: \(\) => stopVoice\(\)/)
  })
  it('barge-in: vocea ta taie redarea Chirp a serverului (stopVoice) și trezește UI-ul', () => {
    // Atât speech_begin (server) cât și detecția locală (onBargeIn) taie prin stopVoice.
    expect(voce).toMatch(/onSpeechBegin: \(\) => \{[\s\S]{0,120}stopVoice\(\)[\s\S]{0,60}onSpeechStart/)
    expect(voce).toMatch(/onBargeIn: \(\) => \{[\s\S]{0,120}stopVoice\(\)[\s\S]{0,60}onSpeechStart/)
  })
  // (STOP-ul vorbit pe transcript a DISPĂRUT — fără STT nu mai există transcript
  // pe client; „stop" rostit peste Kelion îl taie oricum prin barge-in-ul local.)
  it('mute-ul ajunge la urechea locală (nu există senderi WebRTC de mutat)', () => {
    expect(voce).toMatch(/chirpEar\?\.setMuted\(muted\)/)
  })
  it('fraza pleacă DIRECT la creier (fără transcript, fără verdict de timbru)', () => {
    expect(voce).toMatch(/onPhrase: \(_t, vf, audio\) => \{[\s\S]{0,300}poartaDupaFraza\(vf, audio\)/)
    expect(voce).toMatch(/poartaDupaFraza[\s\S]{0,500}onAddressed\?\.\('', vf, undefined, audio\)/)
  })
  it('urechea moartă marchează și închide (fără OpenAI, fără buclă)', () => {
    expect(voce).toMatch(/marcheazaUrechiChirpMoarte\(\)/)
    // Fără ureche Chirp NU se deschide OpenAI — se aruncă și panoul cade pe dictarea nativă.
    expect(voce).toMatch(/throw new Error\('chirp_ear_unavailable'\)/)
  })
})

describe('ruta /api/realtime/session: DEZACTIVATĂ, fără upstream OpenAI', () => {
  it('nu mai relayează nimic la OpenAI (openaiRealtimeAnswer a dispărut)', () => {
    expect(ruta).not.toContain('openaiRealtimeAnswer')
  })
  it('răspunde 410 „disabled" ca un client vechi să afle clar', () => {
    expect(ruta).toMatch(/'\/api\/realtime\/session'[\s\S]{0,300}reply\.code\(410\)/)
  })
})

describe('panoul: sesiunea vocală rămâne activă, dar NU e isRealtime', () => {
  it('handle-ul guraChirp NU primește isRealtime — {audio} nu mai e suprimat, serverVoiceOff iese false', () => {
    expect(panou).toMatch(/isRealtime = rv\.guraChirp !== true/)
  })
  it('rotația proactivă de 55 min rămâne DOAR pentru sesiunea non-guraChirp (mereu null acum)', () => {
    expect(panou).toMatch(/rv\.guraChirp === true \? null : window\.setTimeout/)
  })
})
