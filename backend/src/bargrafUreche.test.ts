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
    expect(clientVL).toMatch(/const poarta = !procesareActiva && kelionAudibil\(\)/) // 22 aug: half-duplex DOAR fără AEC viu
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
    expect(panou).toMatch(/onNivelIntrare: \(nivel\) => \{[\s\S]{0,140}micNivelRef\.current = nivel/)
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

  it('AEC/AGC adaptive pe ruta audio (22 aug) — nu mai sunt legate orbește de eMobil', () => {
    expect(clientVL).toContain('autoGainControl: procesare')
    expect(clientVL).toContain('echoCancellation: procesare')
    expect(clientVL).not.toContain('echoCancellation: !eMobil')
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

  it('scrisul folosește chatul complet și o singură voce prin întreruperea Live', () => {
    expect(panou).not.toContain('vlRef.current.trimiteText(')
    expect(clientVL).not.toContain('trimiteText(text: string): boolean')
    expect(panou).not.toMatch(/if \(c\.audio\)[\s\S]{0,2000}?if \(vlRef\.current\) \{\s*\n\s*aSunatTuraRef\.current = true\s*\n\s*return/)
    expect(panou).toContain('requestTtsFocus({ turaScrisa: true })')
    expect(panou).toMatch(/const _focusOk = requestTtsFocus\(\{ turaScrisa: true \}\)[\s\S]{0,180}if \(!_focusOk\) return/)
    expect(panou).toMatch(/if \(c\.audio\)[\s\S]{0,2500}?setRedareExterna\(true\)/)
  })

  it('TTS nu mai are un comutator client duplicat și întrerupe sesiunea Live curentă', () => {
    expect(panou).toContain('interruptAll')
    expect(panou).not.toMatch(/Boolean\(voiceTurnRef\.current\) && Boolean\(vlRef\.current\)/)
    expect(clientChat).not.toContain('serverVoiceOff')
    expect(clientVL).toContain('intrerupeRedarea(): void')
    expect(clientVL).toContain("ws.send(JSON.stringify({ type: 'intrerupe' }))")
    expect(panou).toMatch(/registerLiveFocus\(\{[\s\S]{0,180}stopVoice\(\)[\s\S]{0,80}vl\.intrerupeRedarea\(\)/)
    expect(panou).toContain('const vlGeneratieRef = useRef(0)')
    expect(panou).not.toContain('VL_MAX_RELUARI')
  })

  it('setRedareExterna rămâne pe handle-ul LIVE (alte căi), nu e motorul TTS pe scris', () => {
    expect(clientVL).toContain('setRedareExterna(activ: boolean): void')
    expect(clientVL).toMatch(/let redareExterna = false/)
  })
})
