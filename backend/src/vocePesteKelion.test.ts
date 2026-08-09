import { describe, expect, it } from 'vitest'
import {
  creeazaDetectorVocePeste,
  rmsPcm16,
  PRAG_MIN_RMS,
  SUSTINERE_MS,
} from './services/vocePesteKelion.js'

// Un cadru PCM16 mono la 16 kHz cu amplitudine constantă (0..1) și durată dată.
// Amplitudinea constantă are RMS = amplitudinea — simplu de judecat în teste.
function cadru(amplitudine: number, ms: number): Buffer {
  const mostre = Math.round((ms / 1000) * 16_000)
  const buf = Buffer.alloc(mostre * 2)
  const v = Math.round(amplitudine * 32767)
  for (let i = 0; i < mostre; i++) buf.writeInt16LE(v, i * 2)
  return buf
}

describe('rmsPcm16', () => {
  it('liniștea are RMS 0, amplitudinea constantă are RMS-ul ei', () => {
    expect(rmsPcm16(cadru(0, 256))).toBe(0)
    expect(rmsPcm16(cadru(0.2, 256))).toBeCloseTo(0.2, 2)
    expect(rmsPcm16(Buffer.alloc(0))).toBe(0)
  })
})

describe('creeazaDetectorVocePeste — „vorbește peste mine"', () => {
  it('voce susținută peste replica lui Kelion → taie (o singură dată per izbucnire)', () => {
    const d = creeazaDetectorVocePeste()
    // 256 ms nu ajung (sub SUSTINERE_MS)…
    expect(d.proceseazaCadru(cadru(0.2, 256), true)).toBe(false)
    // …al doilea cadru trece pragul de susținere → verdict.
    expect(d.proceseazaCadru(cadru(0.2, 256), true)).toBe(true)
  })

  it('aceeași voce cât Kelion TACE nu taie nimic (nu e nimeni de tăiat)', () => {
    const d = creeazaDetectorVocePeste()
    for (let i = 0; i < 10; i++) {
      expect(d.proceseazaCadru(cadru(0.2, 256), false)).toBe(false)
    }
  })

  it('rezidualul slab de ecou (sub pragul absolut) nu taie', () => {
    const d = creeazaDetectorVocePeste()
    const slab = PRAG_MIN_RMS * 0.6
    for (let i = 0; i < 10; i++) {
      expect(d.proceseazaCadru(cadru(slab, 256), true)).toBe(false)
    }
  })

  it('o izbucnire scurtă urmată de liniște nu taie (susținerea se resetează)', () => {
    const d = creeazaDetectorVocePeste()
    expect(d.proceseazaCadru(cadru(0.2, 256), true)).toBe(false) // sub SUSTINERE_MS
    expect(d.proceseazaCadru(cadru(0, 256), true)).toBe(false) // liniște → reset
    expect(d.proceseazaCadru(cadru(0.2, 256), true)).toBe(false) // ia de la zero
  })

  it('zgomotul CONSTANT (ventilator) intră în podea cât Kelion tace și nu mai taie', () => {
    const d = creeazaDetectorVocePeste()
    // Podeaua învață ventilatorul (0.08) în liniștea dinaintea replicii…
    for (let i = 0; i < 60; i++) d.proceseazaCadru(cadru(0.08, 256), false)
    // …apoi Kelion vorbește peste același ventilator: fără dominanță → nu taie.
    for (let i = 0; i < 10; i++) {
      expect(d.proceseazaCadru(cadru(0.08, 256), true)).toBe(false)
    }
    // Dar vocea REALĂ, mult peste podea, taie și acum.
    expect(d.proceseazaCadru(cadru(0.5, 256), true)).toBe(false)
    expect(d.proceseazaCadru(cadru(0.5, 256), true)).toBe(true)
  })

  it('pragul de susținere cere cel puțin două cadre de 256 ms', () => {
    // Garda testului: dacă cineva coboară SUSTINERE_MS sub un cadru, verdictul
    // ar veni din clinchete singulare — exact ce nu vrem.
    expect(SUSTINERE_MS).toBeGreaterThan(256)
  })
})
