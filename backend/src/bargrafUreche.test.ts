// ── Voice / ear locks aligned to CURRENT product (17 aug 2026) ──────────────
// Keep only what the live app still does. Dropped: dual TTS-while-LIVE rules
// (14 aug) that fought single-mouth LIVE priority.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const fe = (...p: string[]) => readFileSync(join(aici, '../../frontend', ...p), 'utf8')
const clientVL = fe('src/lib/vocalLive.ts')
const panou = fe('src/components/ChatPanel.tsx')
const bargraf = fe('src/components/MicBargraf.tsx')
const clientChat = fe('src/lib/chat.ts')
const audioFocus = fe('src/lib/audioFocus.ts')

describe('bargraful urechii live — nivel de intrare măsurat', () => {
  it('vocalLive măsoară RMS+vârf pe cadrul trimis și emite onNivelIntrare', () => {
    expect(clientVL).toContain('onNivelIntrare')
    expect(clientVL).toMatch(/Math\.sqrt\(sum \/ ds\.length\)/)
    expect(clientVL).toMatch(/onNivelIntrare\(\{ nivel: rms, pic, poarta, clip:/)
  })

  it('poarta half-duplex e aceeași decizie care taie trimiterea', () => {
    expect(clientVL).toMatch(/const poarta = kelionAudibil\(\)/)
    expect(clientVL).toMatch(/const la16k = poarta \? new Float32Array\(ds\.length\) : ds/)
  })

  it('MicBargraf arată nivel, poartă și clip (fără className partajat)', () => {
    expect(bargraf).toContain('export interface NivelIntrare')
    expect(bargraf).toMatch(/poarta/)
    expect(bargraf).toMatch(/clip/)
    expect(bargraf).toContain('requestAnimationFrame')
    expect(bargraf).not.toMatch(/className=/)
  })

  it('ChatPanel leagă nivelul și randează bargraful cât ascultă', () => {
    expect(panou).toContain("import MicBargraf, { type NivelIntrare } from './MicBargraf'")
    expect(panou).toMatch(/micNivelRef\.current = nv/)
    expect(panou).toContain('<MicBargraf nivelRef={micNivelRef} activ={listening} />')
  })
})

describe('preamp microfon (surd / prea tare)', () => {
  it('vocalLive: setPreamp + clamp pe cadru', () => {
    expect(clientVL).toContain('setPreamp(gain: number): void')
    expect(clientVL).toContain('function clampPreamp')
    expect(clientVL).toMatch(/let preampGain = clampPreamp\(opts\.preampInitial\)/)
    expect(clientVL).toMatch(/if \(preampGain !== 1\)/)
    expect(clientVL).toContain('setPreamp: (g: number) =>')
  })

  it('AGC pe desktop, stins pe mobil (A2DP)', () => {
    expect(clientVL).toContain('autoGainControl: !eMobil')
    expect(clientVL).toContain('echoCancellation: !eMobil')
  })

  it('ChatPanel: slider preamp persistat, legat de handle', () => {
    expect(panou).toMatch(/preampInitial: preampNivel/)
    expect(panou).toMatch(/vlRef\.current\?\.setPreamp\(g\)/)
    expect(panou).toContain("localStorage.setItem('kelion_preamp'")
    expect(panou).toMatch(/type="range"/)
  })
})

describe('audio focus — LIVE first, one mouth, interrupt', () => {
  it('manager central: registerLiveFocus / requestTtsFocus / interruptAll', () => {
    expect(audioFocus).toContain('export function interruptAll')
    expect(audioFocus).toContain('export function registerLiveFocus')
    expect(audioFocus).toContain('export function requestTtsFocus')
    expect(audioFocus).toMatch(/active === 'live'|requestTtsFocus/)
  })

  it('o singură gură PE TURĂ: Chirp redă răspunsul serverului ȘI pe scris ȘI pe voce (LIVE nu-l rostește)', () => {
    // CORECȚIE MĂSURATĂ (owner 20 aug „nu ajunge audio unde trebuie" pe VOCE + agent):
    // Gemini Live (vlRef) NU rostește răspunsul serverului nici pe voce — n-are speak(text),
    // rostește doar audio-ul PROPRIULUI model. Deci Chirp (c.audio) e SINGURA gură pentru
    // răspunsul serverului, ȘI pe scris ȘI pe voce. Vechea gardă `voiceTurnRef && vlRef return`
    // îl tăcea pe voce → TĂCERE (bugul). O singură voce = Chirp + întreruperea Live la redare.
    expect(panou).not.toContain('if (voiceTurnRef.current && vlRef.current) return')
    // Chirp cere focus întrerupând Live MEREU (turaScrisa:true) → o singură voce, fără dublare.
    expect(panou).toContain('requestTtsFocus({ turaScrisa: true })')
    // Sesiunea Realtime OpenAI (isRealtime) chiar rostește textul → acolo Chirp e refuzat.
    expect(panou).toMatch(/isRealtime === true\) return/)
    // ANTI-ECOU: cât redă Chirp-ul, urechea LIVE e mutată (setRedareExterna).
    expect(panou).toMatch(/if \(c\.audio\)[\s\S]{0,1500}?setRedareExterna\(true\)/)
  })

  it('serverVoiceOff NU mai e legat de „LIVE instalat" — Chirp iese ȘI pe voce (o voce prin întreruperea Live)', () => {
    expect(panou).toContain('interruptAll')
    // serverVoiceOff NU mai cheie pe voiceTurnRef && vlRef (aia tăcea vocea); doar Realtime OpenAI.
    expect(panou).not.toMatch(/Boolean\(voiceTurnRef\.current\) && Boolean\(vlRef\.current\)/)
    expect(clientChat).toContain('serverVoiceOff')
    expect(clientVL).toContain('intrerupeRedarea(): void')
    expect(clientVL).toContain("ws.send(JSON.stringify({ type: 'intrerupe' }))")
    expect(panou).toContain('vl.intrerupeRedarea()')
    expect(panou).toContain('const vlGeneratieRef = useRef(0)')
    expect(panou).toContain('const VL_MAX_RELUARI = 3')
  })

  it('setRedareExterna rămâne pe handle-ul LIVE (alte căi), nu e motorul TTS pe scris', () => {
    expect(clientVL).toContain('setRedareExterna(activ: boolean): void')
    expect(clientVL).toMatch(/let redareExterna = false/)
  })
})
