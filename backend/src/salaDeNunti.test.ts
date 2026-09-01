// ── LACĂT: VOCEA LUI KELION INTRĂ PE FILMARE O SINGURĂ DATĂ ─────────────────
// (owner, 15 aug: „inca are efect de ecou sala de nunti")
//
// Istoria, ca să nu se repete: la 8 aug vocea circula prin bucla WebRTC a
// AEC-ului, pe care captura de tab o EXCLUDE — de-aia recorder.ts vărsa vocea
// și DIRECT din registrul vocilor. Reforma anti-ecou din 13-15 aug a scos
// bucla WebRTC (vocea iese prin <audio> media, pe care captura de tab O AUDE)
// — iar registrul, rămas necondiționat, băga aceeași voce a DOUA oară,
// decalată cu latența redării. MĂSURAT în filmarea ownerului: copie la ~40 ms,
// corelație 0.48 — exact „efectul de sală de nunți". A treia copie venea
// acustic: microfonul narațiunii era deschis cu echoCancellation:false, deci
// pe boxe culegea și vocea lui Kelion din cameră.
//
// Lacătele de mai jos țin cele două reguli care sting efectul; cine le
// schimbă decide conștient, cu istoria asta în față. Lanțul AUZULUI
// (vocalLive.ts) are testele sale de protocol separate —
// aici e lanțul FILMĂRII, care nu merge la creier.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const recorder = readFileSync(join(aici, '../../frontend/src/lib/recorder.ts'), 'utf8')

describe('filmarea fără „sala de nunți"', () => {
  it('registrul vocilor se varsă DOAR când captura nu are audio de tab (altfel vocea ar intra de două ori)', () => {
    expect(recorder).toMatch(/if \(displayAudio\.length === 0\) \{[\s\S]{0,600}?vocileLuiKelion\(\)/)
    // Și nu există o a doua vărsare, necondiționată, a registrului.
    const varsari = recorder.match(/vocileLuiKelion\(\)/g) ?? []
    expect(varsari.length).toBe(1)
  })

  it('microfonul narațiunii are AEC pornit — vocea din boxe nu intră acustic pe filmare', () => {
    expect(recorder).toMatch(/getUserMedia\(\{ audio: \{ echoCancellation: true \} \}\)/)
  })
})
