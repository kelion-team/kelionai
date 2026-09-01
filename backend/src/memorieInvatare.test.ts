import { describe, it, expect } from 'vitest'
import { parseFacts } from './services/agents.js'

// ── ÎNVĂȚAREA MEMORIEI SMART (owner, 19 aug) ─────────────────────────────────
// learnFromTurn cere modelului fapte TIPIZATE {fact,type,importance}. Parserul
// trebuie să fie tolerant: acceptă forma nouă (obiecte) DAR și vechiul șir simplu
// (dacă modelul mai întoarce string-uri, faptul nu se pierde — devine generic).
describe('parseFacts — fapte tipizate, tolerant la forma veche', () => {
  it('obiecte {fact,type,importance} → tip + importanță păstrate', () => {
    const out = parseFacts(
      'Sigur: [{"fact":"Locuiește în Witney","type":"identity","importance":0.95},' +
        '{"fact":"Preferă răspunsuri scurte","type":"preference","importance":0.85}]',
    )
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ fact: 'Locuiește în Witney', tip: 'identity', importanta: 0.95 })
    expect(out[1].tip).toBe('preference')
  })

  it('șiruri simple (forma veche) → fapte generice (tip null, importanță null)', () => {
    const out = parseFacts('["Adrian conduce un BMW","Bea cafea dimineața"]')
    expect(out).toHaveLength(2)
    expect(out[0]).toEqual({ fact: 'Adrian conduce un BMW', tip: null, importanta: null })
  })

  it('formă mixtă + gunoi → păstrează ce e valid, aruncă restul (inclusiv fapte prea scurte)', () => {
    const out = parseFacts('[{"fact":"abc","type":"fact","importance":0.6}, 42, "ok text", {"nope":1}, {"fact":"X"}]')
    // „X" (1 caracter) e sub pragul minim → aruncat, ca la varianta veche.
    expect(out.map((f) => f.fact)).toEqual(['abc', 'ok text'])
  })

  it('fără JSON → listă goală (nu inventează)', () => {
    expect(parseFacts('n-am nimic de reținut')).toEqual([])
    expect(parseFacts('')).toEqual([])
  })
})
