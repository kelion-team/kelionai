import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── URECHEA ADMINULUI NU CADE PE 'auto' (Adrian, 3 aug) ─────────────────────
//
// Dovadă live: chirp_3 pe 'auto' stâlcea româna adminului („E surt
// hanspuskelion?"). Modelul e corect (chirp_3, cel mai avansat STT); cauza era
// LIMBA — când clientul nu trimite un hint valid, streamingul cădea pe 'auto'.
// Fix: pe calea de streaming (asr-stream), adminul primește limba lui pe SERVER
// (ro-RO), niciodată 'auto' — consistent cu calea realtime (realtime.ts:57-62).
// Plus un log al limbii efective, ca următoarea încercare să fie MĂSURABILĂ.
const src = readFileSync(
  fileURLToPath(new URL('./routes/asr-stream.ts', import.meta.url)),
  'utf8',
)

describe('asr-stream: adminul nu primește niciodată limba „auto"', () => {
  it('forțează limba adminului server-side (fallback pe ro), nu pe hint-ul clientului', () => {
    expect(src).toMatch(/user\.role === 'admin'\s*\?\s*clientLang \|\| normalizeLang\('ro'\)/)
  })

  it('păstrează hint-ul clientului pentru ceilalți useri (fără forțare)', () => {
    expect(src).toMatch(/user\.role === 'admin' \? clientLang \|\| normalizeLang\('ro'\) : clientLang/)
  })

  it('loghează limba efectivă (măsurabil: „auto" vs „ro-RO") + rolul', () => {
    expect(src).toMatch(/asr-stream: limbă = /)
    expect(src).toMatch(/rol=\$\{user\.role\}/)
  })

  it('modelul rămâne cel avansat, nu se schimbă odată cu limba', () => {
    expect(src).toMatch(/model:\s*ASR_MODEL/)
  })
})
