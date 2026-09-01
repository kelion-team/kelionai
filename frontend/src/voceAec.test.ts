import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pareBluetooth } from './lib/rutaAudio'

// LACĂT AEC — forma ADAPTIVĂ (owner, 22 aug: „identifica toate optiunile de
// device… 0 greseli de auz"): procesarea WebRTC se decide după RUTA AUDIO
// (rutaAudio.ts) — desktop ON; mobil ON doar când e CERT că nu e Bluetooth
// (regula 11 aug rămâne legea de siguranță: BT + procesare = A2DP rupt).
// Half-duplex rămâne plasa DOAR pe drumul fără AEC.
const aici = dirname(fileURLToPath(import.meta.url))
const vocal = readFileSync(join(aici, 'lib/vocalLive.ts'), 'utf8')
const mic = readFileSync(join(aici, 'lib/micStream.ts'), 'utf8')

describe('voce: AEC adaptiv pe ruta audio + half-duplex doar fără AEC', () => {
  it('getUserMedia pe calea live: procesarea decisă de rută (desktop ON, mobil doar fără BT cert)', () => {
    expect(vocal).toMatch(/const procesare = !eMobil \|\| \(await faraBluetoothSigur\(\)\)/)
    expect(vocal).toMatch(/echoCancellation:\s*procesare/)
    expect(vocal).toMatch(/autoGainControl:\s*procesare/)
    expect(vocal).toMatch(/Android\|iPhone\|iPad\|Mobile/)
  })

  it('half-duplex: poarta taie microfonul DOAR fără procesare vie', () => {
    expect(vocal).toMatch(/const kelionAudibil/)
    expect(vocal).toMatch(/COADA_ECOU_S\s*=\s*0\.6/)
    expect(vocal).toMatch(/const poarta = !procesareActiva && kelionAudibil\(\)/)
  })

  it('serverul primește starea REALĂ a AEC-ului (nu activ:false pentru toți)', () => {
    expect(vocal).toMatch(/\{ type: 'aec', activ: procesareActiva \}/)
    expect(vocal).not.toMatch(/\{ type: 'aec', activ: false \}/)
  })

  it('schimbarea rutei în zbor (BT conectat/deconectat) închide sesiunea cu motiv onest', () => {
    expect(vocal).toMatch(/addEventListener\('devicechange', laSchimbareDispozitive\)/)
    expect(vocal).toMatch(/ruta audio s-a schimbat/)
  })

  it('pre-roll-ul de barge-in recuperează 500 ms (ordinul din 22 aug, punctul 2)', () => {
    expect(vocal).toMatch(/const PREROLL_MS = 500/)
  })

  it('barge-in pe micStream există (întrerupere pe voce susținută cât e muted)', () => {
    expect(mic).toMatch(/onBargeIn/)
    expect(mic).toMatch(/BARGE_/)
    expect(mic).toMatch(/pushPreRoll\(inp\)[\s\S]*?opts\.onBargeIn\?\.\(\)/)
  })
})

describe('rutaAudio.pareBluetooth — executabil, pe etichete reale', () => {
  it('recunoaște dispozitivele Bluetooth după nume', () => {
    expect(pareBluetooth('Boxa mașinii (Bluetooth)')).toBe(true)
    expect(pareBluetooth('AirPods Pro')).toBe(true)
    expect(pareBluetooth('Galaxy Buds2')).toBe(true)
    expect(pareBluetooth('MDR-Car Hands-Free')).toBe(true)
    expect(pareBluetooth('Headset (A2DP)')).toBe(true)
  })

  it('NU se sperie de microfoane obișnuite', () => {
    expect(pareBluetooth('Default - Internal Microphone')).toBe(false)
    expect(pareBluetooth('Microfon USB')).toBe(false)
    expect(pareBluetooth('Căști cu fir (3.5mm)')).toBe(false)
    expect(pareBluetooth('')).toBe(false)
  })
})
