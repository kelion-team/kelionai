import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── "KELION" + THE REST OF THE SENTENCE ────────────────────────────────────
//
// Adrian, Jul 31: "it speaks when nobody is talking to it; what it hears that
// has nothing to do with it, it reacts to. The implemented rule — Kelion and
// the rest of the sentence — it doesn't apply it."
//
// What it was: a time window that RENEWED itself from its own content — at
// every sentence it let through, AND at every sentence spoken by Kelion
// itself. It fed on what it accepted, so it never closed while something was
// heard in the room. In the morning I had cut its duration from 120s to 45s;
// it didn't help, because the problem wasn't the duration, but the renewal.
//
// What it is: the gate is judged PER SENTENCE. The name in the sentence →
// answer. No name → silence. A single, consumable exception: the reply to its
// own question.
//
// The frontend has no test runner; we read it from here, like fluxPlati.test.ts.
// The regression it guards is expensive (it talks over people) and silent.
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
    // The `: 0` branch in the line above is exactly this — a statement doesn't invite.
    expect(voce).toMatch(/REPLY_WINDOW_MS : 0/)
  })

  it('fără transcript NU există răspuns deloc — sesiunea nu mai răspunde singură', () => {
    // The old net replied on speech_stopped even WITHOUT any text (so Kelion
    // "wouldn't seem deaf"). With ONE BRAIN (Aug 1) the session never answers
    // on its own — a lost transcript means silence and the user just repeats;
    // only a REAL transcript that passes the name gate reaches the brain.
    expect(voce).not.toMatch(/speech_stopped/)
    expect(voce).not.toContain('speechStopTimer')
  })

  it('STOP taie și replica rămasă', () => {
    expect(voce).toMatch(/replyUntil = 0 \/\/ STOP/)
  })
})
