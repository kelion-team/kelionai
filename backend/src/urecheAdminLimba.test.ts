import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── URECHEA NU MAI CADE PE 'auto' — PENTRU NICIUN USER CU LIMBA CUNOSCUTĂ ────
//
// Dovadă live (Adrian, 3 aug): chirp_3 pe 'auto' stâlcea româna („E surt
// hanspuskelion?"). Modelul e corect (chirp_3, cel mai avansat STT); cauza era
// LIMBA. Pe calea de streaming (asr-stream), când clientul nu trimite un hint
// valid, folosim limba CUNOSCUTĂ a userului: adminul → 'ro'; ceilalți → limba
// lor STOCATĂ (getSpeechLang, aceeași sursă ca i18n/realtime). Doar un user NOU,
// fără limbă stabilită, rămâne pe 'auto'. Plus un log al limbii efective, ca
// următoarea încercare reală să fie MĂSURABILĂ.
const src = readFileSync(
  fileURLToPath(new URL('./routes/asr-stream.ts', import.meta.url)),
  'utf8',
)

describe('asr-stream: limba urechii nu mai cade pe „auto" pentru useri cunoscuți', () => {
  it('rezerva de limbă: admin → „ro", ceilalți → limba stocată (getSpeechLang)', () => {
    expect(src).toMatch(/userLangFallback = user\.role === 'admin' \? 'ro' : ''/)
    expect(src).toMatch(/getSpeechLang\(user\.email\)/)
  })

  it('la „start": hint client, altfel rezerva userului; niciun „auto" dacă îi știm limba', () => {
    expect(src).toMatch(
      /langHint = clientLang \|\| \(userLangFallback \? normalizeLang\(userLangFallback\) : ''\)/,
    )
  })

  it('loghează limba efectivă (măsurabil: „auto" vs „ro-RO") + rolul + limba stocată', () => {
    expect(src).toMatch(/asr-stream: limbă = /)
    expect(src).toMatch(/rol=\$\{user\.role\}/)
    expect(src).toMatch(/stocat=/)
  })

  it('modelul rămâne cel avansat (chirp_3), nu se schimbă odată cu limba', () => {
    expect(src).toMatch(/model:\s*ASR_MODEL/)
  })
})
