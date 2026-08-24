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
// modelul configurat răspund. `asiguraPurtatorAudio` garantează purtătorul turei.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { asiguraPurtatorAudio, sanitizeHistory } from './services/chatInput.js'

type M = { role: 'user' | 'assistant'; content: string }



describe('sanitizeHistory — istoricul trimis creierului rămâne valid', () => {
  it('elimină mesajele goale și începutul assistant', () => {
    expect(sanitizeHistory([
      { role: 'assistant', content: 'fără întrebare' },
      { role: 'user', content: '   ' },
      { role: 'user', content: 'Salut' },
    ])).toEqual([{ role: 'user', content: 'Salut' }])
  })

  it('unește rolurile consecutive fără să piardă text', () => {
    expect(sanitizeHistory([
      { role: 'user', content: 'prima' },
      { role: 'user', content: 'a doua' },
      { role: 'assistant', content: 'răspuns' },
    ])).toEqual([
      { role: 'user', content: 'prima\na doua' },
      { role: 'assistant', content: 'răspuns' },
    ])
  })
})
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

// ── PURTĂTORUL NU MAI E ARUNCAT LA CONSTRUIREA PAYLOAD-ULUI (Adrian, 6 aug) ───
// `asiguraPurtatorAudio` adaugă purtătorul {user, ''}, DAR bucla care construia
// `orMsgs` arunca tăcut mesajele cu text gol (`if (p.content)`), deci purtătorul
// dispărea și audio-ul se lipea de o tură VECHE — creierul nu auzea fraza →
// `<TAC/>` → tăcere. Reparația: audio-ul se leagă GARANTAT de o tură user
// PROASPĂTĂ la coada payload-ului (ori pe ultima dacă e user, ori una nouă).
// Testul păzește exact invariantul, ca regresia să cadă în CI, nu live.
describe('audio-ul se leagă de o tură user PROASPĂTĂ la coadă (nu de una veche)', () => {
  const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')

  it('când ultima tură NU e user, împinge o tură user nouă doar cu audio', () => {
    expect(chat).toMatch(/const ultim = orMsgs\[orMsgs\.length - 1\]/)
    expect(chat).toMatch(/orMsgs\.push\(\{ role: 'user', content: \[audioBloc\]/)
  })

  it('NU mai caută înapoi un tur user oarecare (bucla care lega audio-ul de un tur vechi a dispărut)', () => {
    expect(chat).not.toMatch(/for \(let i = orMsgs\.length - 1; i >= 0; i--\)[\s\S]{0,120}audioBloc/)
  })
})
