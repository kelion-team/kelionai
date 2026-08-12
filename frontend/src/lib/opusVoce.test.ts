// ── OPUS PE VOCEA LIVE — PARTEA DIN BROWSER (ce se poate proba fără browser) ──
//
// WebCodecs (AudioEncoder/AudioDecoder) NU există în Node/vitest, deci codecul
// real se probează LIVE de owner pe telefon. Aici probăm PĂRȚILE PURE:
//   - reîncadrarea Float32 la 320 de mostre (20 ms @16 kHz), inclusiv acumularea
//     restului peste apeluri — dacă asta greșește, encoderul primește cadre
//     strâmbe și sunetul iese sacadat;
//   - `esteSuportat()` întoarce false când WebCodecs lipsește → sesiunea rămâne
//     pe PCM (dovada că plasa de cădere e acolo, nu doar promisă).
import { describe, it, expect } from 'vitest'
import { reincadreazaF32, esteSuportat } from './opusVoce'

describe('reincadreazaF32 — cadre fixe de 320, restul se ține', () => {
  it('exact 320 → un cadru, rest gol', () => {
    const r = reincadreazaF32(new Float32Array(0), new Float32Array(320), 320)
    expect(r.cadre).toHaveLength(1)
    expect(r.cadre[0].length).toBe(320)
    expect(r.rest.length).toBe(0)
  })
  it('800 mostre → 2 cadre (640), rest 160', () => {
    const r = reincadreazaF32(new Float32Array(0), new Float32Array(800), 320)
    expect(r.cadre).toHaveLength(2)
    expect(r.rest.length).toBe(160)
  })
  it('restul se lipește de bucata următoare', () => {
    const a = reincadreazaF32(new Float32Array(0), new Float32Array(200), 320) // 0 cadre, rest 200
    expect(a.cadre).toHaveLength(0)
    const b = reincadreazaF32(a.rest, new Float32Array(200), 320) // 400 → 1 cadru, rest 80
    expect(b.cadre).toHaveLength(1)
    expect(b.rest.length).toBe(80)
  })
  it('valorile se păstrează exact la granița de cadru (nu se amestecă)', () => {
    const nou = Float32Array.from({ length: 400 }, (_, i) => i / 1000)
    const r = reincadreazaF32(new Float32Array(0), nou, 320)
    expect(r.cadre[0][0]).toBeCloseTo(0, 6)
    expect(r.cadre[0][319]).toBeCloseTo(319 / 1000, 6)
    expect(r.rest[0]).toBeCloseTo(320 / 1000, 6) // primul din rest = a 321-a mostră
  })
})

describe('esteSuportat — fără WebCodecs, cădem pe PCM', () => {
  it('în Node (fără AudioEncoder) întoarce false', () => {
    expect(esteSuportat()).toBe(false)
  })
})
