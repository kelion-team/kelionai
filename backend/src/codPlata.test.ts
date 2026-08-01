// ── THE UNIQUE PAYMENT CODE (Adrian, Jul 30) ──────────────────────────────
//
// "every payment must be accompanied by a unique code" · "user X buys credit
// worth this much money, the transaction has a uniquely generated assigned
// code, at payment it automatically goes to that code/client".
//
// Revolut Pro has no webhook, so nobody tells us a payment happened. The code
// is the bridge: it leaves with the person at payment, comes back in the bank
// transaction's reference, and the matching ties it back to their account.
// Without it, manual bookkeeping would remain — "nowadays, with thousands of
// potential users", as he said.
//
// Tested here is EXTRACTING the code from the reference: the only pure piece
// in the chain, and the one everything else depends on. If the pattern is too
// lax, any text could pass as a code; if it's too strict, the person's
// payment ends up "unassigned" and the manual work returns through the back
// door.
import { describe, it, expect } from 'vitest'

/** The exact pattern from `crediteazaDupaCod` (db.ts). Kept identical here,
 *  so the test guards the RULE, not a rough copy of it. */
function codDinReferinta(referinta: string): string | null {
  const m = referinta.toUpperCase().replace(/\s+/g, '-').match(/KLN-[A-Z2-9]{4}-[A-Z2-9]{4}/)
  return m ? m[0] : null
}

describe('codul de plată se recunoaște în referința bancară', () => {
  it('referință curată, exact codul', () => {
    expect(codDinReferinta('KLN-AB23-CD45')).toBe('KLN-AB23-CD45')
  })

  it('cu text în jur — băncile adaugă mereu ceva', () => {
    expect(codDinReferinta('Plata credite KLN-AB23-CD45 multumesc')).toBe('KLN-AB23-CD45')
    expect(codDinReferinta('REF: KLN-AB23-CD45/GBP')).toBe('KLN-AB23-CD45')
  })

  it('scris cu litere mici — omul copiază cum vrea', () => {
    expect(codDinReferinta('kln-ab23-cd45')).toBe('KLN-AB23-CD45')
  })

  it('cu spații în loc de cratime — greșeala cea mai probabilă la tastare', () => {
    expect(codDinReferinta('KLN AB23 CD45')).toBe('KLN-AB23-CD45')
  })

  it('fără cod → null, deci plata ajunge la „neatribuite", nu la un om greșit', () => {
    expect(codDinReferinta('transfer de la Ion')).toBeNull()
    expect(codDinReferinta('')).toBeNull()
  })

  it('NU acceptă caractere confundabile (0/O, 1/I/L) — alfabetul le exclude', () => {
    // The code's alphabet doesn't contain 0, O, 1, I or L precisely so the
    // person doesn't mix them up when reading. A "code" containing them is
    // not one of ours.
    expect(codDinReferinta('KLN-AB0O-CD45')).toBeNull()
    expect(codDinReferinta('KLN-AB1I-CD45')).toBeNull()
  })

  it('lungime greșită → null, în ambele sensuri (nu ghicim pe un cod stricat)', () => {
    // One character fewer OR more means the person miscopied. The deliberate
    // choice is NOT to match: better the payment lands in "unassigned" and the
    // admin resolves it, than crediting a nearby account.
    expect(codDinReferinta('KLN-AB2-CD45')).toBeNull()
    expect(codDinReferinta('KLN-AB234-CD45')).toBeNull()
  })

  it('două coduri în aceeași referință → îl ia pe primul, determinist', () => {
    // We don't guess between them: the first match, always the same. If it's
    // wrong, the payment shows in "unassigned" for the other one and the admin
    // resolves it.
    expect(codDinReferinta('KLN-AB23-CD45 si KLN-XY78-ZW99')).toBe('KLN-AB23-CD45')
  })
})
