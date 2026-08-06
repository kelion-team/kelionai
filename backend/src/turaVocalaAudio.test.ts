// TURA VOCALĂ MUTĂ — „Eroare la creier" pe voce ȘI pe scris (Adrian, 6 aug)
//
// Simptomul lui, măsurat live (F12): /api/chat → HTTP 400, iar în chat apărea
// „⚠️ Eroare la creier. Încearcă din nou." — și pe voce, și pe text.
//
// Cauza (voce unificată, 5 aug): fraza vocală pleacă la creier ca AUDIO în câmpul
// `audio`, iar mesajul user are text GOL. `sanitizeHistory` scoate turele cu text
// gol → pe istoric gol rămânea 0 mesaje → 400 „no usable messages"; cu istoric,
// audio-ul se lipea de o tură user VECHE și conversația se termina cu assistant,
// deci creierul eșua. Clientul arată ORICE răspuns non-ok de la /api/chat ca
// „Eroare la creier" (lib/chat.ts) — de-aia părea „creierul", deși cheia și
// modelul (gemini-3.1-pro-preview) răspund (pastila „Gemini ✓" probează chiar
// generateContent pe model). `asiguraPurtatorAudio` garantează purtătorul turei.
import { describe, expect, it } from 'vitest'
import { asiguraPurtatorAudio } from './routes/chat.js'

type M = { role: 'user' | 'assistant'; content: string }

describe('asiguraPurtatorAudio — tura vocală (audio + text gol) nu mai rămâne fără purtător', () => {
  it('CAZUL LUI: prima frază vocală, istoric GOL → primește o tură user (nu mai dă 400)', () => {
    const out = asiguraPurtatorAudio([] as M[], true)
    expect(out.length).toBe(1)
    expect(out.at(-1)?.role).toBe('user')
  })

  it('audio după o tură care se termină cu ASSISTANT → adaugă purtător user (nu se lipește de turul vechi)', () => {
    const istoric: M[] = [
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'Bună!' },
    ]
    const out = asiguraPurtatorAudio(istoric, true)
    expect(out.length).toBe(3)
    expect(out.at(-1)).toEqual({ role: 'user', content: '' })
  })

  it('dacă ultima tură e deja user, NU dublăm purtătorul (audio se atașează pe ea)', () => {
    const istoric: M[] = [{ role: 'user', content: 'ceva scris' }]
    const out = asiguraPurtatorAudio(istoric, true)
    expect(out.length).toBe(1)
    expect(out.at(-1)?.content).toBe('ceva scris')
  })

  it('fără audio (tură SCRISĂ) nu schimbă nimic — nu inventează ture goale', () => {
    const istoric: M[] = [
      { role: 'user', content: 'salut' },
      { role: 'assistant', content: 'Bună!' },
    ]
    expect(asiguraPurtatorAudio(istoric, false)).toBe(istoric)
  })
})
