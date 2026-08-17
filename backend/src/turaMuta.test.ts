// THE MUTE TURN — "answer = nothing" (Adrian, Jul 30)
//
// His symptom, word for word: you write in the chat and NOTHING comes. No
// answer, no error. The cause wasn't on his side: the brain can return 200
// with EMPTY text (a model pulled by the provider, an empty completion) —
// then no exception is thrown, the error net doesn't engage, and the turn
// closed without having written a word. The client deletes empty turns, so on
// screen there remained… nothing.
//
// This test guards exactly the distinction that matters: what is "something
// visible" for the person and what is just protocol. Without it, the net
// would either never start (believing it had spoken), or speak over a
// successful turn.
import { describe, expect, it } from 'vitest'
import { areCevaDeVazut } from './routes/chat.js'

const CTRL = String.fromCharCode(31)
const cadru = (o: unknown): string => `${CTRL}${JSON.stringify(o)}${CTRL}`

describe('areCevaDeVazut — a văzut omul ceva pe ecran?', () => {
  it('textul creierului = vizibil', () => {
    expect(areCevaDeVazut('Salut, Adrian.')).toBe(true)
  })

  it('cadrele PUR-protocol NU sunt vizibile (pleacă la fiecare tură, chiar și mută)', () => {
    expect(areCevaDeVazut(cadru({ turn: 'abc-123' }))).toBe(false)
    expect(areCevaDeVazut(cadru({ heard: 'ce am zis eu' }))).toBe(false)
    expect(areCevaDeVazut(cadru({ lang: 'ro-RO' }))).toBe(false)
    expect(areCevaDeVazut(cadru({ receipt: true }))).toBe(false)
    expect(areCevaDeVazut(cadru({ ping: 1 }))).toBe(false)
  })

  it('o tură care doar deschide monitorul (fără text) E vizibilă', () => {
    expect(areCevaDeVazut(cadru({ monitor: { url: 'https://x', title: 'Hartă' } }))).toBe(true)
  })

  it('suprafețele și acțiunile fără text sunt vizibile', () => {
    expect(areCevaDeVazut(cadru({ card: { type: 'mail', title: 'Inbox', items: [] } }))).toBe(true)
    expect(areCevaDeVazut(cadru({ doc: { title: 'T', text: 'x' } }))).toBe(true)
    expect(areCevaDeVazut(cadru({ image: { url: 'data:image/png;base64,AA' } }))).toBe(true)
    expect(areCevaDeVazut(cadru({ audio: 'BASE64' }))).toBe(true)
    expect(areCevaDeVazut(cadru({ device: { camera: 'on' } }))).toBe(true)
    expect(areCevaDeVazut(cadru({ paywall: true }))).toBe(true)
  })

  it('protocol + text în același bloc = vizibil (textul contează)', () => {
    expect(areCevaDeVazut(`${cadru({ turn: 'x' })}Bună`)).toBe(true)
  })

  it('doar spații albe lângă protocol NU trec drept răspuns', () => {
    expect(areCevaDeVazut(`${cadru({ turn: 'x' })}   \n `)).toBe(false)
  })

  it('CAZUL LUI: tura care trimite doar {turn}+{heard}+{lang} rămâne MUTĂ → plasa trebuie să pornească', () => {
    const tura = cadru({ turn: 't' }) + cadru({ lang: 'ro-RO' }) + cadru({ heard: 'salut' })
    expect(areCevaDeVazut(tura)).toBe(false)
  })
})
