import { describe, it, expect } from 'vitest'
import { stripToolMarkup, makeToolMarkupStripper } from './services/toolMarkup.js'

// ── MARKUP-UL FALS DE UNEALTĂ NU AJUNGE NICIODATĂ LA OM ─────────────────────
//
// Adrian, Aug 1 (screenshot): „<|tool_call|>call:system_health()<|tool_call|>”
// afișat crud în bula de chat. Dacă cineva rupe stripper-ul, cade aici —
// nu în fața userului.

describe('stripToolMarkup (one-shot)', () => {
  it('șterge secțiunea completă și păstrează textul real din jur', () => {
    expect(stripToolMarkup('Salut! <|tool_call|>call:system_health()<|tool_call|> Cu ce te ajut?')).toBe(
      'Salut!  Cu ce te ajut?',
    )
  })

  it('un răspuns doar din markup devine GOL (contează ca mut → rotație)', () => {
    expect(stripToolMarkup('<|tool_call|>call:x()<|tool_call|>').trim()).toBe('')
  })

  it('un opener neînchis la final dispare cu totul', () => {
    expect(stripToolMarkup('text real<|tool_call|>call:hide_me()')).toBe('text real')
  })

  it('forma XML și markerii im_start/im_end dispar', () => {
    expect(stripToolMarkup('a<tool_call>{"x":1}</tool_call>b')).toBe('ab')
    expect(stripToolMarkup('<|im_start|>assistant\nrăspuns curat')).toBe('răspuns curat')
  })

  it('textul curat rămâne neatins', () => {
    expect(stripToolMarkup('2 < 3 și aici e totul în regulă.')).toBe('2 < 3 și aici e totul în regulă.')
  })
})

describe('makeToolMarkupStripper (streaming)', () => {
  it('markup rupt pe bucăți nu scapă niciun caracter', () => {
    const s = makeToolMarkupStripper(() => {})
    const parts = ['Bună', ' ziua<|tool', '_call|>call:sys', 'tem_health()<|tool', '_call|> Ce faci?']
    let visible = ''
    for (const p of parts) visible += s.push(p)
    visible += s.flush()
    expect(visible).toBe('Bună ziua Ce faci?')
  })

  it('un „<" inofensiv la final de bucată nu e mâncat', () => {
    const s = makeToolMarkupStripper(() => {})
    let visible = s.push('compară a <')
    visible += s.push(' b și gata')
    visible += s.flush()
    expect(visible).toBe('compară a < b și gata')
  })

  it('secțiunea înghițită ajunge ÎNTREAGĂ la log', () => {
    const logs: string[] = []
    const s = makeToolMarkupStripper((m) => logs.push(m))
    s.push('x<|tool_call|>call:system_health()<|tool_call|>y')
    s.flush()
    expect(logs.join('')).toContain('call:system_health()')
  })
})
