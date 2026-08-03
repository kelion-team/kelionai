import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── "$0.00" IS NOT ALLOWED TO MEAN "I COULDN'T READ IT" ────────────────────
//
// Adrian, Jul 31: his OpenRouter page showed $10.00. The app's bar showed
// "OpenRouter $0.00", blinking red, i.e. "deposit money!".
//
// The bad part is not the figure. It's that, a few hours earlier, I had
// looked at the FRONTEND (which really is correct: it shows "⚠ OpenRouter"
// when the reading fails) and told him the pill does NOT lie, so the zero is
// a successful measurement. I didn't also look at who produces `live`. I
// certified as healthy exactly the pattern I was fixing elsewhere on the same
// day.
//
// The cause, in getOpenRouterBalance: `ok: true` was set as soon as the HTTP
// was 200. But the body goes through `.catch(() => ({}))`, and the fields
// through `?? 0`. Unparsable body, missing `data` or fields renamed at the
// provider → 0 − 0 = 0, with `ok: true`. A failed reading became "you have
// zero dollars", alarm included.
//
// The test guards the rule, not the implementation: if the figures aren't
// where I expect them, the answer is "can't read", not a credible zero.
const sursa = readFileSync(
  fileURLToPath(new URL('./services/openrouter.ts', import.meta.url)),
  'utf8',
)

describe('soldul: lipsa se declară, nu se inventează', () => {
  it('`ok: true` cere ca AMBELE cifre să existe și să fie numere', () => {
    expect(sursa).toMatch(/!d \|\| !Number\.isFinite\(totalCredits\) \|\| !Number\.isFinite\(totalUsage\)/)
    expect(sursa).toContain('unexpected_shape')
  })

  it('nu mai există `?? 0` pe cifrele soldului — acolo se năștea zeroul fals', () => {
    expect(sursa).not.toMatch(/total_credits\s*\?\?\s*0/)
    expect(sursa).not.toMatch(/total_usage\s*\?\?\s*0/)
  })

  it('HTTP nereușit rămâne raportat separat de forma greșită', () => {
    // Two different causes, two different errors: "the server didn't answer"
    // is not the same as "it answered, but not how I expected".
    expect(sursa).toMatch(/if \(!r\.ok\) return \{ \.\.\.base, error: `http_\$\{r\.status\}` \}/)
  })

  it('eroarea spune CE a venit — numele câmpurilor, nicio valoare', () => {
    // So the next person looking sees the real shape at first glance, instead
    // of searching for a day. Keys only, never values: a balance belongs to
    // the owner, not to the log.
    expect(sursa).toMatch(/Object\.keys\(d \?\? j \?\? \{\}\)/)
    expect(sursa).not.toMatch(/JSON\.stringify\(j\)/)
  })

  it('starea de pornire e „nu știu", nu „zero" — dacă se iese devreme, iese onest', () => {
    expect(sursa).toMatch(/ok: false, balance: 0[\s\S]{0,120}low: true/)
  })
})

// PASTILA OPENROUTER SCOASĂ DIN BARĂ (Adrian, 3 aug: „dezafectat de peste tot" —
// migrare completă pe Gemini). Vechiul test care verifica pastila OpenRouter din
// Stage.tsx („OpenRouter $…" / „⚠ OpenRouter") a fost eliminat: pastila nu mai
// există în interfață. Onestitatea CITIRII rămâne pinată mai sus (openrouter.ts)
// + backend-ul de mai jos, fiindcă getOpenRouterBalance încă e folosit intern.
describe('citirea soldului rămâne onestă în backend, chiar dacă pastila e scoasă', () => {
  it('`live` vine din `ok`-ul măsurătorii, nu din altceva', () => {
    const ruta = readFileSync(fileURLToPath(new URL('./routes/admin.ts', import.meta.url)), 'utf8')
    expect(ruta).toMatch(/live: orBalance\.ok/)
  })
})
