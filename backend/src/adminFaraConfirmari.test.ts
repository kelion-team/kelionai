import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE ADMIN SESSION IS ENOUGH IN CHAT ────────────────────────────────────
//
// Adrian, Jul 31: "if I'm logged in as admin, Kelion must not ask for any
// kind of security confirmation in chat".
//
// The Jul 27 padlock required a second factor (voiceprint or typed secret)
// for the admin tools to exist in chat. Today's order removes it FROM THERE —
// and only from there. The test guards exactly the boundary: chat trusts the
// session, voice and the panel do NOT. If someone moves the padlock back onto
// chat, or removes it from voice/panel "to be consistent", it falls here.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const chat = sursa('./routes/chat.ts')
const voce = sursa('./routes/realtime.ts')
const panou = sursa('./index.ts')

describe('în chat, sesiunea de admin e de-ajuns', () => {
  it('chatul decide adminul din rolul sesiunii (singura excepție: tura de OASPETE vocal, Aug 1)', () => {
    expect(chat).toMatch(/const isAdmin = user\.role === 'admin' && !guestMatch\s*$/m)
  })

  it('chatul nu mai cheamă lacătul deloc — nici măcar importat', () => {
    expect(chat).not.toContain('isArmed')
    expect(chat).not.toContain('hasUnlock')
  })
})

describe('lacătul e dezarmat de owner, dintr-un singur loc', () => {
  // Adrian, Jul 31, the second time: "remove the approval completely please,
  // there is nobody next to me to give commands". The first time he had only
  // asked for chat, and I had left voice guarded because anyone next to the
  // microphone can speak. He says there is nobody. The threat the padlock
  // guarded against doesn't exist for him.
  const lacat = sursa('./services/adminLock.ts')

  it('isArmed() răspunde NU, deci toate porțile se deschid deodată', () => {
    expect(lacat).toMatch(/const LACAT_DEZARMAT = true/)
    expect(lacat).toMatch(/if \(LACAT_DEZARMAT\) return false/)
  })

  it('mecanismul rămâne întreg dedesubt — rearmarea e o singură linie', () => {
    expect(lacat).toContain('loadKv(KV_SECRET)')
    expect(lacat).toContain('scrypt')
    expect(lacat).toMatch(/TO RE-ARM/)
  })

  it('the gates keep asking isArmed — we did not break them, it just answers differently', () => {
    expect(voce).toMatch(/isArmed\(\)/)
    expect(panou).toMatch(/isArmed\(\)[\s\S]{0,200}423/)
  })

  it('riscul e scris în cod, nu doar în chat', () => {
    expect(lacat).toMatch(/WHAT IS LOST[\s\S]{0,400}only[\s\S]{0,12}factor/)
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

  // Adrian, Jul 31: "you didn't remove the authorization requirement,
  // why?" — I had put in the owner block, but left three older requests for
  // permission, scattered. One was right in the owner prompt, contradicting
  // what I had just written, and two more in the clip flow (prompt + the
  // tool's description, which is the strongest signal — the model sees it at
  // every call). The test searches for all of them as text, so a forgotten
  // one can no longer sneak through another part of the file.
  it('nicio cerere de autorizare nu a mai rămas nicăieri în fișier', () => {
    expect(chat).not.toMatch(/ask for authorization/i)
    expect(chat).not.toMatch(/explicitly authorizes/i)
    expect(chat).not.toMatch(/explicitly said yes/i)
    expect(chat).not.toMatch(/explicitly approves/i)
    expect(chat).not.toMatch(/ONLY after his explicit yes/i)
  })

  it('clipul promo se scrie ȘI se armează în aceeași tură', () => {
    // The text is cut by the source's concatenation ("...do ' + 'not
    // stop..."), so we search across the break, not the contiguous literal.
    expect(chat).toMatch(/his request is the authorisation, do[\s\S]{0,20}not stop to ask for a yes/)
    expect(chat).toMatch(/IN THE SAME TURN — his request for a clip IS the authorisation/)
  })

  it('problemele găsite la system_health se repară, nu se raportează cu întrebare', () => {
    expect(chat).toMatch(/REPAIR them straight away[\s\S]{0,60}do not ask for permission first/)
  })
})
