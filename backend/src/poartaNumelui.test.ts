import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── „KELION" + RESTUL FRAZEI ────────────────────────────────────────────────
//
// Adrian, 31 iul: „vorbește când nu se vorbește cu el; ce aude și nu are
// legătură cu el, reacționează. Regula implementată — Kelion și restul frazei
// — nu o aplică."
//
// Ce era: o fereastră de timp care se REÎNNOIA din propriul ei conținut —
// la fiecare frază pe care o lăsa să treacă, ȘI la fiecare frază spusă de
// Kelion însuși. Se hrănea din ce accepta, deci nu se închidea cât se auzea
// ceva în cameră. Dimineață îi tăiasem durata de la 120s la 45s; n-a ajutat,
// fiindcă problema nu era durata, ci reînnoirea.
//
// Ce e: poarta se judecă PER FRAZĂ. Numele în frază → răspunde. Fără nume →
// tăcere. O singură excepție, consumabilă: replica la propria lui întrebare.
//
// Frontendul n-are runner de teste; îl citim de aici, ca la fluxPlati.test.ts.
// Regresia pe care o păzește e scumpă (vorbește peste oameni) și tăcută.
const voce = readFileSync(
  fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)),
  'utf8',
)

describe('poarta numelui se judecă per frază, nu pe ceas', () => {
  it('fereastra care se reînnoia singură a dispărut complet', () => {
    expect(voce).not.toContain('gateUntil =')
    expect(voce).not.toContain('GATE_WINDOW_MS')
  })

  it('răspunde dacă numele e în FRAZA curentă', () => {
    expect(voce).toMatch(/const named = NAME_RE\.test\(t\)/)
    expect(voce).toMatch(/if \(named \|\| answering\)/)
  })

  it('replica fără nume SE CONSUMĂ — nu poate deschide următoarea', () => {
    expect(voce).toMatch(/if \(named \|\| answering\) \{\s*\n\s*replyUntil = 0/)
  })
})

describe('Kelion nu-și mai ține singur poarta deschisă', () => {
  it('după ce vorbește, poarta se deschide DOAR dacă a pus o întrebare', () => {
    expect(voce).toMatch(/replyUntil = \/\\\?\/\.test\(t\) \? Date\.now\(\) \+ REPLY_WINDOW_MS : 0/)
  })

  it('o afirmație a lui închide poarta pe loc (numele redevine obligatoriu)', () => {
    // Ramura `: 0` din linia de mai sus e chiar asta — o afirmație nu invită.
    expect(voce).toMatch(/REPLY_WINDOW_MS : 0/)
  })

  it('plasa pe transcript lipsă nu mai răspunde din fereastră largă', () => {
    expect(voce).toMatch(/if \(Date\.now\(\) < replyUntil\) \{\s*\n\s*replyUntil = 0/)
  })

  it('STOP taie și replica rămasă', () => {
    expect(voce).toMatch(/replyUntil = 0 \/\/ STOP/)
  })
})
