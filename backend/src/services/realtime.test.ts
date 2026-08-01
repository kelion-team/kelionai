import { describe, it, expect } from 'vitest'
import { realtimeInstructions, resolveVoice } from './realtime.js'

// Aug 1 — THE ONE-BRAIN ARCHITECTURE: the voice session is ears+mouth only.
// These tests pin the mouth's manners; the thinking is tested in chat.ts's
// tests (the ONE brain both channels share).
describe('realtimeInstructions — gura creierului unic', () => {
  it('limbă CUNOSCUTĂ (persistată): o menționează explicit', () => {
    const ro = realtimeInstructions('ro')
    expect(ro).toContain('Romanian')
    // NOTE (Jul 25): "Romanian" LEGITIMATELY appears for English users too —
    // in the language guard's LIST of allowed languages. What matters is the
    // user's ESTABLISHED language line.
    const en = realtimeInstructions('en')
    expect(en).toContain('established language is English')
    expect(en).not.toContain('established language is Romanian')
  })

  it('limbă NEcunoscută (user nou): implicit engleză, ROSTEȘTE dictează limba reală', () => {
    const t = realtimeInstructions('')
    expect(t.toLowerCase()).toContain('english by default')
    expect(t).toContain('ROSTEȘTE')
  })

  it('LACĂTUL adminului (hardLock): limba e fixă, orice s-ar auzi în cameră', () => {
    const locked = realtimeInstructions('ro', true)
    expect(locked).toContain('never switch')
    const unlocked = realtimeInstructions('ro', false)
    expect(unlocked).not.toContain('never switch')
  })

  it('gura nu are unelte ale ei: instrucțiunile nu menționează nicio unealtă apelabilă', () => {
    const t = realtimeInstructions('en')
    expect(t).not.toMatch(/ask_brain|get_weather|show_on_screen|youtube_search/)
  })
})

describe('resolveVoice — vocea aleasă, cu plasa de siguranță', () => {
  it('o voce necunoscută cade pe implicit (nu omoară sesiunea cu 400)', () => {
    expect(resolveVoice('nu-exista')).not.toBe('nu-exista')
    expect(resolveVoice('')).not.toBe('')
    expect(resolveVoice(null)).toBe(resolveVoice(undefined))
  })
})
