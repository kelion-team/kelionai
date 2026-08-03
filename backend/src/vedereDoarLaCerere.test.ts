import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── DESCRIEREA IMAGINII RULEAZĂ DOAR CÂND CHIAR E O IMAGINE (Adrian, 3 aug) ──
//
// Latența „ULTRA enorm": pasul de descriere a imaginii se declanșa pe „camera
// pornită" (`image || camFrames.length > 0`), deci rula ~11s DEGEABA pe FIECARE
// tură (măsurat: total 12356ms, creierul real 1077ms). Poarta corectă e
// `turnHasImage` — adevărată doar când chiar s-a atașat o imagine (poză încărcată
// SAU cameră + intenție vizuală VISION_INTENT).
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('descrierea imaginii: doar la cerere reală, nu pe fiecare tură', () => {
  it('poarta pasului de vedere e `if (turnHasImage)`', () => {
    expect(chat).toMatch(/if \(turnHasImage\) \{/)
  })
  it('nu mai declanșează pe simpla prezență a cadrelor camerei', () => {
    expect(chat).not.toMatch(/if \(image \|\| camFrames\.length > 0\) \{/)
  })
})
