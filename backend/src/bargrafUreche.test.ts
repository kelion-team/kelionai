// ── BARGRAF DE INTRARE AL URECHII LIVE (owner, 16 aug 2026) ─────────────────
// (verbatim: „vreau sa vad un mic bargraf care arata nivelul de la intrarea
// urechi modelului live, trebuie indentificat daca nu se truncheaza nimic")
//
// Lacăt pe sursă: nivelul se MĂSOARĂ în lib/vocalLive.ts (RMS + vârf pe cadrul
// trimis modelului) și se dă UI-ului prin onNivelIntrare; ChatPanel îl leagă și
// randează bargraful cât ascultă. Dacă vreo verigă se rupe, ownerul rămâne fără
// dovada vizuală a truncherii — de-aia o ținem încuiată.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const clientVL = readFileSync(join(aici, '../../frontend/src/lib/vocalLive.ts'), 'utf8')
const clientChat = readFileSync(join(root, 'frontend/src/lib/chat.ts'), 'utf8')
const panou = readFileSync(join(aici, '../../frontend/src/components/ChatPanel.tsx'), 'utf8')
const bargraf = readFileSync(join(aici, '../../frontend/src/components/MicBargraf.tsx'), 'utf8')

describe('bargraful urechii live — nivelul de intrare, măsurat, cu truncherea vizibilă', () => {
  it('lib/vocalLive MĂSOARĂ nivelul cadrului trimis (RMS + vârf) și-l emite prin onNivelIntrare', () => {
    // Măsurătoarea e făcută în laCadru, pe semnalul real, nu inventată.
    expect(clientVL).toContain('onNivelIntrare')
    expect(clientVL).toMatch(/Math\.sqrt\(sum \/ ds\.length\)/) // RMS pe cadru
    // Emite și starea porții half-duplex (poarta) + clip — ca truncherea să se vadă.
    expect(clientVL).toMatch(/onNivelIntrare\(\{ nivel: rms, pic, poarta, clip:/)
  })

  it('poarta half-duplex e raportată din aceeași decizie care taie trimiterea', () => {
    // `poarta` din raport = exact condiția care înlocuiește microfonul cu tăcere.
    expect(clientVL).toMatch(/const poarta = kelionAudibil\(\)/)
    expect(clientVL).toMatch(/const la16k = poarta \? new Float32Array\(ds\.length\) : ds/)
  })

  it('MicBargraf arată cele trei stări: nivel, poartă (mut) și clip', () => {
    expect(bargraf).toContain('export interface NivelIntrare')
    expect(bargraf).toMatch(/poarta/)
    expect(bargraf).toMatch(/clip/)
    // Citește prin requestAnimationFrame (nu re-randează tot chatul).
    expect(bargraf).toContain('requestAnimationFrame')
    // Doar stiluri inline — fără clasă CSS partajată (lecția coliziunii de clase).
    expect(bargraf).not.toMatch(/className=/)
  })

  it('ChatPanel leagă nivelul într-un ref și randează bargraful cât ascultă', () => {
    expect(panou).toContain("import MicBargraf, { type NivelIntrare } from './MicBargraf'")
    expect(panou).toMatch(/micNivelRef\.current = nv/) // handler-ul onNivelIntrare
    expect(panou).toContain('<MicBargraf nivelRef={micNivelRef} activ={listening} />')
  })
})

describe('preamp + amplificare pentru microfon surd (owner, 16 aug: „ce faci daca e surd?")', () => {
  it('lib/vocalLive are preamp reglabil (setPreamp) aplicat pe cadru înainte de trimitere', () => {
    expect(clientVL).toContain('setPreamp(gain: number): void') // în interfața handle-ului
    expect(clientVL).toContain('function clampPreamp')
    expect(clientVL).toMatch(/let preampGain = clampPreamp\(opts\.preampInitial\)/)
    // aplicarea pe cadru: multiplicare cu clamp la ±1 (peste = clip)
    expect(clientVL).toMatch(/if \(preampGain !== 1\)/)
    expect(clientVL).toContain('setPreamp: (g: number) =>')
  })

  it('autoGainControl PORNIT pe desktop (nu mai e surd), stins pe mobil pentru A2DP', () => {
    // Fixul „surdului": AGC pe desktop (amplifică la sursă), gardat de eMobil.
    expect(clientVL).toContain('autoGainControl: !eMobil')
    // Rămâne stins pe mobil (Bluetooth A2DP) — echoCancellation tot pe !eMobil.
    expect(clientVL).toContain('echoCancellation: !eMobil')
  })

  it('ChatPanel are sliderul de preamp (min→max), persistat, legat de handle', () => {
    expect(panou).toMatch(/preampInitial: preampNivel/)
    expect(panou).toMatch(/vlRef\.current\?\.setPreamp\(g\)/)
    expect(panou).toContain("localStorage.setItem('kelion_preamp'")
    expect(panou).toMatch(/type="range"/)
  })
})

describe('LIVE audio priority — one mouth, chat live first (owner, 17 aug)', () => {
  it('cât LIVE (vlRef) e activ, {audio} TTS pe scris e aruncat — o singură gură, full-duplex pe live', () => {
    // Arbiter: LIVE beats Chirp on written turns. playVoice for c.audio only when LIVE is off.
    expect(panou).toMatch(/if \(c\.audio\)[\s\S]{0,500}?if \(vlRef\.current\) return/)
    expect(panou).toContain("contorGata('primul sunet (gura a pornit)')")
    // No longer mutes the live ear just to play a second TTS mouth.
    expect(panou).not.toMatch(/if \(c\.audio\)[\s\S]{0,800}?setRedareExterna\(true\)/)
  })

  it('serverVoiceOff pe send când LIVE e activ — serverul nu mai plătește/sintetizează Chirp degeaba', () => {
    expect(panou).toMatch(/Boolean\(vlRef\.current\)\s*\|\|/)
    expect(clientChat).toContain('serverVoiceOff')
  })

  it('setRedareExterna rămâne în clientul live (util pentru alte căi), nu e obligatoriu pe c.audio', () => {
    expect(clientVL).toContain('setRedareExterna(activ: boolean): void')
    expect(clientVL).toMatch(/let redareExterna = false/)
  })
})

describe('audio focus — LIVE priority + interrupt (owner, 17 aug)', () => {
  it('audioFocus manager exists and exports interruptAll / LIVE vs TTS focus', () => {
    const focus = readFileSync(join(root, 'frontend/src/lib/audioFocus.ts'), 'utf8')
    expect(focus).toContain('export function interruptAll')
    expect(focus).toContain('export function registerLiveFocus')
    expect(focus).toContain('export function requestTtsFocus')
    expect(focus).toMatch(/LIVE has priority|live' \| 'tts'|active === 'live'/)
  })

  it('written {audio} yields to LIVE (vlRef) — one mouth', () => {
    expect(panou).toMatch(/if \(c\.audio\)[\s\S]{0,600}?if \(vlRef\.current\) return/)
    expect(panou).toContain('requestTtsFocus')
    expect(panou).toContain('interruptAll')
  })

  it('serverVoiceOff when LIVE active so Chirp is not synthesized in parallel', () => {
    expect(panou).toMatch(/Boolean\(vlRef\.current\)\s*\|\|/)
  })
})

