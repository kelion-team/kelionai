import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── GURA PE GOOGLE CHIRP 3 HD; OPENAI DOAR REZERVĂ (Adrian, Aug 2) ──────────
// Direct order, Aug 2: the live voice's ears already ran on Google Chirp 3
// streaming (free), but the MOUTH still ran on OpenAI Realtime — $65 in two
// weeks, proven live, and the account hit zero credits. From here on the
// mouth is the server's Google TTS Chirp 3 HD (1M chars/month free tier) and
// OpenAI stays STRICTLY the reserve.
// The frontend has no test runner; we read it from here, like urechiChirp.test.ts.
const voce = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8')
const panou = readFileSync(fileURLToPath(new URL('../../frontend/src/components/ChatPanel.tsx', import.meta.url)), 'utf8')

describe('proba gurii: GET /api/tts/status, o dată pe sesiunea de pagină', () => {
  it('întreabă serverul cu cookie-ul de sesiune dacă Google TTS e disponibil', () => {
    expect(voce).toMatch(/fetch\('\/api\/tts\/status', \{ credentials: 'include'/)
  })
  it('răspunsul serverului se cache-uiește per sesiune de pagină', () => {
    expect(voce).toMatch(/guraChirpStare !== null/)
    expect(voce).toMatch(/guraChirpStare = ok/)
  })
  it('google:false sau proba picată → rezerva OpenAI (comportamentul de până acum)', () => {
    expect(voce).toMatch(/j\?\.google === true/)
    expect(voce).toMatch(/\.catch\(\(\) => false\)/)
  })
})

describe('modul gură-Chirp: ZERO OpenAI', () => {
  it('ramura chirp returnează ÎNAINTE să se construiască vreun RTCPeerConnection', () => {
    const idxBranch = voce.indexOf('if (guraChirp) {')
    const idxPc = voce.indexOf('new RTCPeerConnection()')
    expect(idxBranch).toBeGreaterThanOrEqual(0)
    expect(idxPc).toBeGreaterThan(idxBranch)
  })
  it('niciun apel la /api/realtime/session pe ramura chirp (SDP-ul e doar al rezervei)', () => {
    const idxBranch = voce.indexOf('if (guraChirp) {')
    const idxSdp = voce.indexOf("fetch('/api/realtime/session'")
    expect(idxSdp).toBeGreaterThan(idxBranch)
  })
  it('speak() nu trimite nimic nicăieri; interrupt/stopSpeaking = stopVoice (audioIO)', () => {
    expect(voce).toMatch(/interrupt: \(\) => stopVoice\(\)/)
    expect(voce).toMatch(/stopSpeaking: \(\) => stopVoice\(\)/)
    // The ROSTEȘTE prefix stays ONLY in the reserve's speech queue.
    const idxBranch = voce.indexOf('if (guraChirp) {')
    const idxPrefix = voce.indexOf('SPEAK_PREFIX')
    expect(idxPrefix).toBeGreaterThan(idxBranch)
  })
  it('barge-in: speech_begin taie redarea Chirp pe loc și anunță UI-ul', () => {
    // The barge-in callback is the chirp-mouth mode's piece of the ONE ear
    // starter: your voice cuts the server playback, then wakes the UI.
    expect(voce).toMatch(/pornesteUrecheaChirp\('rezerva OpenAI', \(\) => \{[\s\S]{0,200}?stopVoice\(\)\s*\n\s*onSpeechStart/)
  })
  it('STOP-ul vorbit taie gura serverului (taieGura = stopVoice)', () => {
    const idxBranch = voce.indexOf('if (guraChirp) {')
    const idxCut = voce.indexOf('taieGura = stopVoice')
    expect(idxCut).toBeGreaterThan(idxBranch) // set inside the branch, before the ear starts
    expect(idxCut).toBeLessThan(voce.indexOf('new RTCPeerConnection()'))
  })
  it('mute-ul ajunge la urechea Chirp și în acest mod (nu există senderi WebRTC)', () => {
    const hits = voce.match(/chirpEar\?\.setMuted\(muted\)/g) ?? []
    expect(hits.length).toBeGreaterThanOrEqual(2)
  })
  it('urechia moartă marchează și cade pe rezervă, fără bucle', () => {
    // The death wiring lives ONCE, in the shared ear starter defined before
    // both mode branches — and the chirp-mouth branch starts its ear through
    // it, so the marking cannot diverge between modes.
    const idxStarter = voce.indexOf('const pornesteUrecheaChirp')
    const idxBranch = voce.indexOf('if (guraChirp) {')
    expect(idxStarter).toBeGreaterThanOrEqual(0)
    expect(idxStarter).toBeLessThan(idxBranch)
    const starter = voce.slice(idxStarter, idxBranch)
    expect(starter).toContain('marcheazaUrechiChirpMoarte()')
    expect(starter).toMatch(/onError:[\s\S]{0,200}?stop\(\)/)
    expect(voce.indexOf("await pornesteUrecheaChirp('rezerva OpenAI'", idxBranch)).toBeGreaterThan(idxBranch)
  })
  it('log-ul live anunță exact modul cerut de Adrian', () => {
    expect(voce).toContain('urechi + gură pe Google Chirp 3 HD — OpenAI doar rezervă')
  })
  it('finalurile Chirp trec prin ACEEAȘI poartă și în acest mod', () => {
    // One starter, one gate: the onPhrase → poartaDupaTranscript wiring sits
    // in the shared starter, and the chirp-mouth branch uses that starter —
    // the finals CANNOT reach the brain around the gate in this mode.
    const idxStarter = voce.indexOf('const pornesteUrecheaChirp')
    const idxBranch = voce.indexOf('if (guraChirp) {')
    const starter = voce.slice(idxStarter, idxBranch)
    expect(starter).toMatch(/onPhrase: \(t, vf\) => \{[\s\S]{0,120}poartaDupaTranscript\(t, vf\)/)
    const branch = voce.slice(idxBranch, voce.indexOf('new RTCPeerConnection()'))
    expect(branch).toContain("pornesteUrecheaChirp('rezerva OpenAI'")
  })
})

describe('panoul: sesiunea vocală rămâne activă, dar NU e isRealtime', () => {
  it('handle-ul gură-Chirp NU primește isRealtime — {audio} nu mai e suprimat, serverVoiceOff iese false', () => {
    expect(panou).toMatch(/isRealtime = rv\.guraChirp !== true/)
  })
  it('rotația proactivă de 55 min rămâne DOAR pentru rezerva OpenAI', () => {
    expect(panou).toMatch(/rv\.guraChirp === true \? null : window\.setTimeout/)
  })
})

describe('rezerva OpenAI rămâne intactă', () => {
  it('calea WebRTC + SDP + coada ROSTEȘTE există în continuare', () => {
    expect(voce).toMatch(/new RTCPeerConnection\(\)/)
    expect(voce).toMatch(/\/api\/realtime\/session/)
    expect(voce).toContain('ROSTEȘTE: ')
    expect(voce).toMatch(/response\.create/)
  })
  it('poarta își primește piesele de mod și pe calea de rezervă', () => {
    expect(voce).toMatch(/taieGura = stopSpeaking/)
    expect(voce).toMatch(/ancoreazaLimba = \(lang: string\)/)
  })
})
