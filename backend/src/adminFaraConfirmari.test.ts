import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── SESIUNEA DE ADMIN E DE-AJUNS ÎN CHAT ────────────────────────────────────
//
// Adrian, 31 iul: „dacă m-am logat cu admin, Kelion nu mai trebuie să ceară
// niciun fel de confirmare de securitate în chat".
//
// Lacătul din 27 iul cerea al doilea factor (amprentă vocală sau secret tastat)
// ca uneltele de admin să existe în chat. Ordinul de azi îl scoate DE ACOLO —
// și numai de acolo. Testul păzește exact granița: chatul se încrede în sesiune,
// vocea și panoul NU. Dacă cineva mută lacătul înapoi pe chat, sau îl scoate
// din voce/panou „ca să fie la fel", pică aici.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const chat = sursa('./routes/chat.ts')
const voce = sursa('./routes/realtime.ts')
const panou = sursa('./index.ts')

describe('în chat, sesiunea de admin e de-ajuns', () => {
  it('chatul decide adminul DOAR din rolul sesiunii', () => {
    expect(chat).toMatch(/const isAdmin = user\.role === 'admin'\s*$/m)
  })

  it('chatul nu mai cheamă lacătul deloc — nici măcar importat', () => {
    expect(chat).not.toContain('isArmed')
    expect(chat).not.toContain('hasUnlock')
  })
})

describe('lacătul e dezarmat de owner, dintr-un singur loc', () => {
  // Adrian, 31 iul, a doua oară: „scoți total te rog aprobarea, lângă mine nu
  // e nimeni să dea comenzi". Prima dată ceruse doar chatul, și lăsasem vocea
  // păzită fiindcă oricine e lângă microfon poate vorbi. El spune că nu e
  // nimeni. Amenințarea de care apăra lacătul nu există la el.
  const lacat = sursa('./services/adminLock.ts')

  it('isArmed() răspunde NU, deci toate porțile se deschid deodată', () => {
    expect(lacat).toMatch(/const LACAT_DEZARMAT = true/)
    expect(lacat).toMatch(/if \(LACAT_DEZARMAT\) return false/)
  })

  it('mecanismul rămâne întreg dedesubt — rearmarea e o singură linie', () => {
    expect(lacat).toContain('loadKv(KV_SECRET)')
    expect(lacat).toContain('scrypt')
    expect(lacat).toMatch(/CA SĂ REARMEZI/)
  })

  it('porțile îl întreabă mai departe pe isArmed — nu le-am rupt, doar răspunde altfel', () => {
    expect(voce).toMatch(/isArmed\(\)/)
    expect(panou).toMatch(/isArmed\(\)[\s\S]{0,200}423/)
  })

  it('riscul e scris în cod, nu doar în chat', () => {
    expect(lacat).toMatch(/CE PIERDE[\s\S]{0,400}singurul[\s\S]{0,12}factor/)
  })
})

describe('Kelion nu-i mai cere ownerului voie pentru ce tocmai i-a cerut', () => {
  it('promptul de owner suprascrie regula de confirmare', () => {
    expect(chat).toContain('OWNER — NO CONFIRMATIONS')
    expect(chat).toMatch(/the request IS the authorisation/)
  })

  it('nu-i mai cere nici să se autentifice în chat', () => {
    expect(chat).toMatch(/never ask him to unlock, authenticate, or confirm his identity in chat/)
  })

  it('rămâne întrebat DOAR efectul colateral necerut', () => {
    expect(chat).toMatch(/action he did NOT ask for[\s\S]{0,400}never about the request itself/)
  })
})
