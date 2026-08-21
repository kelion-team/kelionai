import { describe, it, expect } from 'vitest'
import { curataLegenda } from './lib/vazOffline'

// ── VĂZUL OFFLINE (Faza 1 · M5) — partea PURĂ ───────────────────────────────
// Modelul + eșantionarea cer transformers.js + WebGPU/WASM (doar pe device), dar
// curățarea legendei e pură și testabilă: normalizează spațiile + prima literă mare,
// și NU inventează text din gol (regula #1: gol rămâne gol).

describe('curataLegenda — normalizează legenda scenei, gol rămâne gol', () => {
  it('gol / doar spații → gol (nu inventează o scenă)', () => {
    expect(curataLegenda('')).toBe('')
    expect(curataLegenda('   ')).toBe('')
    expect(curataLegenda('\n\t ')).toBe('')
  })
  it('normalizează spațiile multiple și pune prima literă mare', () => {
    expect(curataLegenda('a man   sitting  at a desk')).toBe('A man sitting at a desk')
    expect(curataLegenda('  a dog on the grass \n')).toBe('A dog on the grass')
  })
  it('nu strică un text deja curat', () => {
    expect(curataLegenda('Two people walking on a beach')).toBe('Two people walking on a beach')
  })
})
