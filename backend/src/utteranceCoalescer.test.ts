import { describe, it, expect, vi } from 'vitest'
import {
  shouldAcceptFragment,
  coalesceBuffer,
  createUtteranceCoalescer,
  DEFAULT_MIN_CONFIDENCE,
  DEFAULT_CONFIRMATION_THRESHOLD,
} from './services/utteranceCoalescer.js'

// REGRASIE — fragmente ciuntite din chat-ul vocal: coalescență inteligentă,
// prag de confidență, filtru pentru fragmente scurte/fără sens, fallback de
// confirmare la ambiguitate.
describe('coalescer inteligent de frază', () => {
  it('coalescează fragmentele consecutive într-un singur gând', () => {
    const result = coalesceBuffer([
      { text: 'Eu sunt', confidence: 0.9 },
      { text: 'în setare', confidence: 0.88 },
    ])
    expect(result).not.toBeNull()
    expect(result!.text).toBe('Eu sunt în setare')
    expect(result!.confidence).toBeGreaterThan(0)
  })

  it('respinge fragmentele care sunt doar umplutură', () => {
    expect(shouldAcceptFragment({ text: 'um' })).toBe(false)
    expect(shouldAcceptFragment({ text: 'ah' })).toBe(false)
    expect(shouldAcceptFragment({ text: 'um uh' })).toBe(false)
  })

  it('respinge fragmentele prea scurte și fără sens', () => {
    expect(shouldAcceptFragment({ text: 'u' })).toBe(false)
    expect(shouldAcceptFragment({ text: 'un' })).toBe(false)
  })

  it('respinge fragmentele cu confidență sub prag', () => {
    expect(
      shouldAcceptFragment({ text: 'salut', confidence: DEFAULT_MIN_CONFIDENCE - 0.1 }),
    ).toBe(false)
    expect(
      shouldAcceptFragment({ text: 'salut', confidence: DEFAULT_MIN_CONFIDENCE + 0.1 }),
    ).toBe(true)
  })

  it('acceptă comenzile scurte de stop chiar dacă sunt scurte', () => {
    expect(shouldAcceptFragment({ text: 'stop' })).toBe(true)
    expect(shouldAcceptFragment({ text: 'Stai' })).toBe(true)
    expect(shouldAcceptFragment({ text: 'anulează' })).toBe(true)
  })

  it('comenzile de stop nu cer confirmare și execută imediat', () => {
    const result = coalesceBuffer([{ text: 'stop', confidence: 0.9 }])
    expect(result).not.toBeNull()
    expect(result!.needsConfirmation).toBe(false)
    expect(result!.text).toBe('stop')
  })

  it('curăță umpluturile de la margini și coalescează restul', () => {
    const result = coalesceBuffer([
      { text: 'um', confidence: 0.9 },
      { text: 'salut', confidence: 0.9 },
      { text: 'ah', confidence: 0.9 },
      { text: 'Kelion', confidence: 0.9 },
    ])
    expect(result).not.toBeNull()
    expect(result!.text).toBe('salut Kelion')
  })

  it('marchează mesajele ambigue ca necesitând confirmare', () => {
    const result = coalesceBuffer([{ text: 'programare', confidence: 0.9 }])
    expect(result).not.toBeNull()
    expect(result!.needsConfirmation).toBe(true)
  })

  it('marchează mesajele cu confidență scăzută ca necesitând confirmare', () => {
    const result = coalesceBuffer([
      { text: 'programează întâlnirea mâine', confidence: DEFAULT_CONFIRMATION_THRESHOLD - 0.1 },
    ])
    expect(result).not.toBeNull()
    expect(result!.needsConfirmation).toBe(true)
  })

  it('nu cere confirmare pentru mesaje clare și încrezătoare', () => {
    const result = coalesceBuffer([
      { text: 'Cât e ceasul la Paris?', confidence: 0.95 },
    ])
    expect(result).not.toBeNull()
    expect(result!.needsConfirmation).toBe(false)
  })

  it('returnează null când toate fragmentele sunt respinse', () => {
    const result = coalesceBuffer([
      { text: 'um', confidence: 0.2 },
      { text: 'ah', confidence: 0.2 },
    ])
    expect(result).toBeNull()
  })

  it('coalescerul cu timer emite doar după fereastra de tăcere', () => {
    vi.useFakeTimers()
    const flushed: { text: string; needsConfirmation: boolean }[] = []
    const coalescer = createUtteranceCoalescer(
      (r) => flushed.push({ text: r.text, needsConfirmation: r.needsConfirmation }),
      { windowMs: 1100 },
    )

    coalescer.push({ text: 'salutare', confidence: 0.9 })
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(1200)
    expect(flushed).toHaveLength(1)
    expect(flushed[0].text).toBe('salutare')
    expect(flushed[0].needsConfirmation).toBe(true)

    vi.useRealTimers()
  })

  it('coalescerul resetează timerul la fiecare fragment nou', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const coalescer = createUtteranceCoalescer((r) => flushed.push(r.text), { windowMs: 1100 })

    coalescer.push({ text: 'salutare', confidence: 0.9 })
    vi.advanceTimersByTime(800)
    coalescer.push({ text: 'Kelion', confidence: 0.9 })
    vi.advanceTimersByTime(800)
    expect(flushed).toHaveLength(0)

    vi.advanceTimersByTime(400)
    expect(flushed).toHaveLength(1)
    expect(flushed[0]).toBe('salutare Kelion')

    vi.useRealTimers()
  })

  it('coalescerul cu cancel golește bufferul fără emit', () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const coalescer = createUtteranceCoalescer((r) => flushed.push(r.text), { windowMs: 1100 })

    coalescer.push({ text: 'test', confidence: 0.9 })
    coalescer.cancel()
    vi.advanceTimersByTime(1200)
    expect(flushed).toHaveLength(0)

    vi.useRealTimers()
  })
})
