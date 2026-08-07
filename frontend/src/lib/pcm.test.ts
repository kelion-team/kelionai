import { describe, it, expect } from 'vitest'
import { base64ToBytes, pcm16ToFloat32, downsample, float32ToPcm16 } from './pcm'

// ── CONVERSIILE DE AUDIO ALE VOCII LIVE ──────────────────────────────────────
// Ce se poate proba FĂRĂ browser: conversiile. Dacă una din ele e greșită, vocea
// nu „sună prost" — sună a bruiaj, iar cauza e imposibil de găsit cu urechea.
// De-aia fiecare e probată aici pe valori exacte, inclusiv la capetele scalei.
//
// CE NU PROBEAZĂ fișierul ăsta, ca să nu se citească mai mult decât scrie:
// microfonul real, WebSocket-ul, redarea și cât de natural sună Kelion. Alea se
// văd doar pe live, în testul ownerului.

describe('vocea live — conversiile de audio', () => {
  it('PCM16 → Float32: capetele scalei și zeroul, exact', () => {
    // -32768, -16384, 0, 16384, 32767 în little-endian
    const bytes = new Uint8Array([0x00, 0x80, 0x00, 0xc0, 0x00, 0x00, 0x00, 0x40, 0xff, 0x7f])
    const f = pcm16ToFloat32(bytes)
    expect(f).toHaveLength(5)
    expect(f[0]).toBeCloseTo(-1, 5)
    expect(f[1]).toBeCloseTo(-0.5, 5)
    expect(f[2]).toBe(0)
    expect(f[3]).toBeCloseTo(0.5, 5)
    expect(f[4]).toBeCloseTo(1, 4)
  })

  it('PCM16 → Float32: un octet impar la coadă nu strică nimic (cadru tăiat)', () => {
    // Un cadru poate ajunge tăiat la jumătate de eșantion; se ignoră coada,
    // NU se citește peste marginea bufferului (ar arunca RangeError în redare).
    const f = pcm16ToFloat32(new Uint8Array([0x00, 0x40, 0x7f]))
    expect(f).toHaveLength(1)
    expect(f[0]).toBeCloseTo(0.5, 5)
  })

  it('dus-întors Float32 → PCM16 → Float32 păstrează semnalul', () => {
    const original = new Float32Array([0, 0.25, -0.25, 0.75, -0.75])
    const pcm = float32ToPcm16([original])
    const octeti = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)
    const inapoi = pcm16ToFloat32(octeti)
    expect(inapoi).toHaveLength(original.length)
    for (let i = 0; i < original.length; i++) expect(inapoi[i]).toBeCloseTo(original[i], 3)
  })

  it('Float32 → PCM16 taie valorile din afara scalei în loc să le răsucească', () => {
    // Fără limitare, 1.5 ar depăși int16 și ar ieși NEGATIV — adică un pocnet.
    const pcm = float32ToPcm16([new Float32Array([1.5, -1.5])])
    expect(pcm[0]).toBe(32767)
    expect(pcm[1]).toBe(-32768)
  })

  it('base64 → octeți, exact', () => {
    // „AAEC" = 0x00 0x01 0x02
    expect(Array.from(base64ToBytes('AAEC'))).toEqual([0, 1, 2])
    expect(base64ToBytes('')).toHaveLength(0)
  })

  it('reeșantionarea la 16 kHz: 48 kHz se împarte la trei, 16 kHz rămâne neatins', () => {
    const la48 = new Float32Array(480)
    for (let i = 0; i < la48.length; i++) la48[i] = i / 480
    expect(downsample(la48, 48000)).toHaveLength(160)
    const la16 = new Float32Array(160)
    expect(downsample(la16, 16000)).toBe(la16) // aceeași referință: zero copiere
  })

  it('un cadru de 4096 la 48 kHz produce exact cât trebuie pentru 16 kHz mono', () => {
    // Cadrul ScriptProcessor e 4096. La 48 kHz → 1365 eșantioane la 16 kHz →
    // 2730 de octeți pe cadru. Cifra contează: serverul așteaptă PCM16 mono 16k.
    const cadru = new Float32Array(4096)
    const pcm = float32ToPcm16([downsample(cadru, 48000)])
    expect(pcm.length).toBe(1365)
    expect(pcm.byteLength).toBe(2730)
  })
})
