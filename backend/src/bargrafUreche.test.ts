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

  it('SCRISUL MERGE LA CREIERUL ÎNTREG + o singură voce prin ÎNTRERUPERE (22 aug)', () => {
    // ISTORIC: pasul 1 v1 ruta turele scrise PRIN Live (trimiteText) și SUPRIMA
    // Chirp cât vlRef era viu. MĂSURAT LIVE pe V7.5 (owner, 22 aug, capturi):
    // cererea SCRISĂ nu se executa, nu se afișa, nu se auzea — un Live viu dar
    // mut făcea aplicația să pară moartă. Forma nouă: tot ce e TASTAT trece
    // prin /api/chat (creierul întreg, unelte, monitor), iar Chirp E gura
    // răspunsului scris chiar și cu Live viu — vocea unică se ține prin
    // întreruperea redării Live (requestTtsFocus), nu prin suprimarea gurii.
    expect(panou).toContain('SCRISUL MERGE LA CREIERUL ÎNTREG')
    expect(panou).not.toContain('vlRef.current.trimiteText(')
    // Suprimarea veche („cât Live e viu, c.audio se aruncă") NU mai există:
    expect(panou).not.toMatch(/if \(c\.audio\)[\s\S]{0,2000}?if \(vlRef\.current\) \{\s*\n\s*aSunatTuraRef\.current = true\s*\n\s*return/)
    // Chirp cere focus întrerupând orice rest de playout (turaScrisa:true).
    expect(panou).toContain('requestTtsFocus({ turaScrisa: true })')
    // Sesiunea Realtime OpenAI (isRealtime) chiar rostește textul → acolo Chirp e refuzat.
    // Variabila a fost redenumită `_isRealtime` (linia 755) — testul verifică pattern-ul.
    expect(panou).toMatch(/_isRealtime\)?\s*\) return/)
    // ANTI-ECOU: cât redă Chirp-ul, urechea clasică ȘI urechea Live se mută.
    expect(panou).toMatch(/if \(c\.audio\)[\s\S]{0,2500}?setRedareExterna\(true\)/)
    // Canalul {type:'text'} al serverului rămâne (nefolosit de client azi).
    expect(clientVL).toContain('trimiteText(text: string): boolean')
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
