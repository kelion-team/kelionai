import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── 402 IS NOT 429 ──────────────────────────────────────────────────────────
//
// Adrian, Jul 31: "brain credit exhausted […] why did you lie?"
//
// He was right. A free model that hits the per-minute request limit returns
// 429. The code lumped 429 into the same condition as 402 and wrote "top up
// your credit" on screen — money demanded for a model that costs ZERO, without
// the app ever having read a balance. Exactly his rule #1: an asserted,
// unmeasured state.
//
// The test reads the REAL code. If someone puts 429 back next to 402, it fails here.
const sursa = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

describe('mesajul de eroare al creierului nu mai cere bani pentru un plafon de cereri', () => {
  it('429 e tratat ca plafon de cereri, separat de fonduri', () => {
    expect(sursa).toMatch(/const isRateLimit\s*=[\s\S]{0,200}429/)
  })

  it('condiția de bani NU mai conține 429', () => {
    const bani = /const isQuota\s*=([\s\S]{0,200}?)\n/.exec(sursa)?.[1] ?? ''
    expect(bani).not.toContain('429')
    expect(bani).toContain('402')
  })

  it('banii se cer doar când NU e plafon de cereri', () => {
    expect(sursa).toMatch(/const isQuota\s*=\s*!isRateLimit/)
  })

  it('userul primește un mesaj care spune explicit că nu e vorba de bani', () => {
    expect(sursa).toMatch(/plafonul de cereri[\s\S]{0,80}nu e o problemă de bani/)
  })
})
