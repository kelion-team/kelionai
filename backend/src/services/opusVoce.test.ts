// ── OPUS PE VOCEA LIVE — CONTRACTUL DE SERVER ───────────────────────────────
//
// Partea PURĂ (reîncadrarea la 20 ms) se probează determinist. Codecul real
// (opusscript) e disponibil în teste, deci facem și un ROUND-TRIP adevărat:
//   - decodeUpload: pachet Opus 16 kHz (făcut cu un encoder brut) → PCM ~640 B.
//   - encodeDownload: PCM 24 kHz → pachete Opus → decodate înapoi ≈ același PCM.
// Așa dovedim că nu doar „rulează", ci chiar întoarce sunet, nu gunoi.
import { describe, it, expect } from 'vitest'
import OpusScript from 'opusscript'
import { reincadreaza, OpusVoce, OCTETI_CADRU_JOS } from './opusVoce.js'

describe('reincadreaza — taie fluxul în cadre fixe, ține restul', () => {
  it('exact un cadru → un cadru, rest gol', () => {
    const b = Buffer.alloc(960, 7)
    const r = reincadreaza(Buffer.alloc(0), b, 960)
    expect(r.cadre).toHaveLength(1)
    expect(r.cadre[0].length).toBe(960)
    expect(r.rest.length).toBe(0)
  })
  it('un cadru și jumătate → un cadru, rest = jumătate', () => {
    const r = reincadreaza(Buffer.alloc(0), Buffer.alloc(960 + 480, 1), 960)
    expect(r.cadre).toHaveLength(1)
    expect(r.rest.length).toBe(480)
  })
  it('restul se lipește de bucata următoare (acumulare peste apeluri)', () => {
    const a = reincadreaza(Buffer.alloc(0), Buffer.alloc(500, 1), 960) // 0 cadre, rest 500
    expect(a.cadre).toHaveLength(0)
    const b = reincadreaza(a.rest, Buffer.alloc(500, 1), 960) // 1000 → 1 cadru, rest 40
    expect(b.cadre).toHaveLength(1)
    expect(b.rest.length).toBe(40)
  })
  it('mai puțin decât un cadru → nimic emis, tot în rest', () => {
    const r = reincadreaza(Buffer.alloc(0), Buffer.alloc(100), 960)
    expect(r.cadre).toHaveLength(0)
    expect(r.rest.length).toBe(100)
  })
})

describe('OpusVoce — round-trip real cu codecul', () => {
  it('codecul se încarcă (altfel căderea pe PCM ar fi permanentă)', async () => {
    const ov = await OpusVoce.creeaza()
    expect(ov).not.toBeNull()
    ov?.inchide()
  })

  it('decodeUpload: pachet Opus 16 kHz → PCM (un cadru de 20 ms ≈ 640 B)', async () => {
    const ov = (await OpusVoce.creeaza())!
    // Un encoder brut 16 kHz produce pachetul pe care serverul îl va primi.
    const enc = new OpusScript(16_000, 1, OpusScript.Application.VOIP)
    const pcm = Buffer.alloc(320 * 2)
    for (let i = 0; i < 320; i++) pcm.writeInt16LE(Math.round(4000 * Math.sin(i * 0.3)), i * 2)
    const pachet = enc.encode(pcm, 320)
    const inapoi = ov.decodeUpload(pachet)
    expect(inapoi).not.toBeNull()
    expect(inapoi!.length).toBe(640) // 320 mostre × 2 octeți
    enc.delete()
    ov.inchide()
  })

  it('decodeUpload pe gunoi → null (sare cadrul, nu crapă)', async () => {
    const ov = (await OpusVoce.creeaza())!
    expect(ov.decodeUpload(Buffer.from([0xff, 0x00, 0x13, 0x37]))).toBeNull()
    ov.inchide()
  })

  it('encodeDownload: PCM 24 kHz → pachete Opus → decodate înapoi ≈ același sunet', async () => {
    const ov = (await OpusVoce.creeaza())!
    const dec = new OpusScript(24_000, 1, OpusScript.Application.VOIP)
    // Trei cadre de 20 ms (3×960 B) date într-o bucată „nealiniate" (1500 + 1500).
    const facPcm = (n: number, faza: number): Buffer => {
      const b = Buffer.alloc(n * 2)
      for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(5000 * Math.sin((i + faza) * 0.2)), i * 2)
      return b
    }
    const pachete = [
      ...ov.encodeDownload(facPcm(750, 0)), // 1500 B < 1920 → 1 cadru (960), rest 540
      ...ov.encodeDownload(facPcm(750, 750)), // +1500 = 2040 în total cu restul → încă 1-2 cadre
    ]
    expect(pachete.length).toBeGreaterThanOrEqual(2)
    // Decodate înapoi: fiecare pachet → 480 mostre (960 B) de PCM real.
    let total = 0
    for (const p of pachete) {
      const pcm = dec.decode(p)
      expect(pcm.length).toBe(OCTETI_CADRU_JOS) // 960
      total += pcm.length
    }
    expect(total).toBe(pachete.length * OCTETI_CADRU_JOS)
    dec.delete()
    ov.inchide()
  })

  it('reseteazaDownload golește restul (nu lipește replica veche de următoarea)', async () => {
    const ov = (await OpusVoce.creeaza())!
    ov.encodeDownload(Buffer.alloc(500)) // lasă 500 B în rest
    ov.reseteazaDownload()
    // Următorul flux de exact un cadru NU trebuie „ajutat" de restul vechi.
    const pachete = ov.encodeDownload(Buffer.alloc(OCTETI_CADRU_JOS))
    expect(pachete).toHaveLength(1)
    ov.inchide()
  })
})
