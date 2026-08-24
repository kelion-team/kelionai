import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── VEDEREA E NATIVĂ — PASUL DE DESCRIERE A MURIT DE TOT (3 aug) ─────────────
//
// Istoric: pasul de „descriere a imaginii pentru creierul ORB" (describeScene
// pe un model străin) rula ~11s degeaba pe fiecare tură cu camera pornită
// (Adrian, 3 aug: latența „ULTRA enorm"); a fost întâi îngrădit pe
// `turnHasImage`, apoi a dispărut complet: OpenAI primește imaginile nativ.
// Testul păzește să nu se întoarcă pasul duplicat.
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('vederea e nativă — fără pas de descriere pe alt model', () => {
  it('nu mai există describeScene pe calea chatului', () => {
    expect(chat).not.toMatch(/describeScene\(/)
  })
  it('nu mai declanșează nimic pe simpla prezență a cadrelor camerei', () => {
    expect(chat).not.toMatch(/if \(image \|\| camFrames\.length > 0\) \{/)
  })
})
