import { describe, it, expect, vi } from 'vitest'

// Env priming ca importul config să nu arunce (ca în celelalte teste).
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'test-uri')
vi.stubEnv('SESSION_SECRET', 'test-session-secret')

import { readFileSync } from 'node:fs'
import { OCHI_MARCAJ, type OrMessage } from './services/brainContract.js'
import { impingeRezultat } from './services/orchestrator.js'

// ── OCHII PE REZULTAT (9 aug, ownerul: „sistemul nu dă lui Kelion poza reală
// pentru analiză"). Măsurat înainte: browserResult trimitea captura DOAR pe
// monitor (pentru om), iar modelul primea un URL pe care nu-l poate privi —
// „citește captura" din descrierea uneltei era o minciună structurală.
// Sigiliile țin mecanismul întreg: marcaj → imagine reală în conversație. ────
describe('ochii pe rezultat — captura browserului ajunge la OCHII modelului', () => {
  it('fără marcaj: rezultatul intră ca un singur rând de unealtă', () => {
    const convo: OrMessage[] = []
    impingeRezultat(convo, 'c1', '{"title":"Pagina"}')
    expect(convo).toHaveLength(1)
    expect(convo[0]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"title":"Pagina"}' })
  })

  it('cu marcaj: textul curat + un rând user cu IMAGINEA (data-URL jpeg)', () => {
    const convo: OrMessage[] = []
    impingeRezultat(convo, 'c2', `{"title":"Pagina"}${OCHI_MARCAJ}AAAABBBB`)
    expect(convo).toHaveLength(2)
    expect(convo[0]).toEqual({ role: 'tool', tool_call_id: 'c2', content: '{"title":"Pagina"}' })
    const user = convo[1] as { role: string; content: { type: string; image_url?: { url: string } }[] }
    expect(user.role).toBe('user')
    expect(user.content[0].type).toBe('image_url')
    expect(user.content[0].image_url?.url).toBe('data:image/jpeg;base64,AAAABBBB')
  })

  it('marcajul e NEINJECTABIL din text: începe cu octetul de control \\u001F, pe care JSON.stringify îl scrie mereu ca secvență \\uXXXX', () => {
    expect(OCHI_MARCAJ.charCodeAt(0)).toBe(0x1f)
    // O pagină al cărei text conține chiar „[OCHI]" NU declanșează tăietura:
    // în rezultatul JSON octetul brut nu poate apărea decât din lipirea noastră.
    const rezultat = JSON.stringify({ text: 'pagina zice [OCHI] în text' })
    expect(rezultat.indexOf(OCHI_MARCAJ)).toBe(-1)
  })

  it('browserul dă captura și ca base64 (ochii), nu doar ca URL (monitorul)', () => {
    const browser = readFileSync(new URL('./services/browser.ts', import.meta.url), 'utf8')
    expect(browser).toContain("shotB64: buf ? buf.toString('base64') : ''")
    // Workerul izolat primește modul discret explicit și nu este ocolit local.
    expect(browser).toContain('discreet: discreetSessions.has(id)')
  })

  it('browserResult scoate base64-ul din textul rezultatului și îl trimite pe marcaj', () => {
    const chat = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')
    expect(chat).toContain('const { shotB64, ...faraOchi } = result')
    expect(chat).toMatch(/JSON\.stringify\(faraOchi\)\}\$\{OCHI_MARCAJ\}/)
  })
})
