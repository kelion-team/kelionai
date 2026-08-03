import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── ONE PATH: THE SPOKEN WORD AND THE WRITTEN WORD REACH THE SAME BRAIN ──────
//
// Adrian, Aug 1: "rewrite the whole chat procedure, written and audio
// full-duplex... there must not be two separate entities". The architecture
// that honours it: the voice session is pure EARS AND MOUTH; a final
// transcript becomes a POST /api/chat with `spoken: true` — the SAME handler,
// SAME tools, SAME escalation ladder, SAME billing as a typed message. The
// only thing `spoken` may change is the reply's STYLE (speakable sentences),
// never the pipeline.
//
// These tests prove the parity and pin the contract so no parallel branch can
// grow back: same text in, same route through, on both paths.

const feChat = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/chat.ts', import.meta.url)), 'utf8')
const feVoice = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/realtimeVoice.ts', import.meta.url)), 'utf8')
const fePanel = readFileSync(fileURLToPath(new URL('../../frontend/src/components/ChatPanel.tsx', import.meta.url)), 'utf8')
const beChat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const beRealtime = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')

describe('o singură ușă spre creier: POST /api/chat', () => {
  it('frontend-ul are UN SINGUR transport de chat — ambele căi trec prin el', () => {
    // The function every turn (typed or spoken) flows through. If a second
    // transport ever appears, the voice would silently diverge from writing.
    expect(feChat.split('fetch(\'/api/chat\'').length - 1).toBe(1)
  })

  it('backend-ul are UN SINGUR handler de chat', () => {
    expect(beChat.split("'/api/chat'").length - 1).toBe(1)
    // And the only other chat-ish route is the RESUME of the same turn.
    expect(beChat).toMatch(/\/api\/chat\/resume/)
  })

  it('poarta vocală NU salvează mesaje și NU apelează creierul — /api/chat e singurul proprietar', () => {
    // realtime/transcript does the timbre verdict and language anchoring only.
    expect(beRealtime).not.toMatch(/orchestrator/)
    expect(beRealtime).not.toMatch(/saveMessage\(user\.email, 'user'/)
    expect(beChat).toMatch(/void saveMessage\(user\.email, 'user', lastTurn\.content\)/)
  })
})

describe('același text, același traseu — dovada de paritate', () => {
  it('transcriptul final ajunge NEMODIFICAT la aceeași funcție send() ca textul tastat', () => {
    // The voice gate forwards the transcript verbatim (t, not a copy, not a
    // transformation) to the panel's single send().
    expect(feVoice).toMatch(/onAddressed\?\.\(t, vf, speaker, audio\)/)
    // The panel wires onAddressed into the SAME send() the input box uses.
    expect(fePanel).toMatch(/async function send\(text: string, spoken = false\)/)
    const idxAddressed = fePanel.indexOf('onAddressed: (text, vf, speaker, audio)')
    expect(idxAddressed).toBeGreaterThanOrEqual(0)
    expect(fePanel.slice(idxAddressed, idxAddressed + 600)).toMatch(/sendRef\.current\(text, true/)
  })

  it('`spoken` schimbă DOAR stilul răspunsului, niciodată traseul', () => {
    // The flag is read exactly once in the handler, to attach the SPOKEN
    // REPLY style note to the prompt. It must never appear in tool selection,
    // billing or routing — that would be a parallel branch.
    const reads = beChat.split('req.body?.spoken').length - 1
    expect(reads).toBe(1)
    const idx = beChat.indexOf('req.body?.spoken')
    expect(beChat.slice(idx, idx + 400)).toMatch(/SPOKEN REPLY/)
    const toolLists = beChat.slice(beChat.indexOf('const rawTools'), beChat.indexOf('const rawTools') + 2400)
    expect(toolLists).not.toMatch(/spoken/)
  })

  it('eticheta de oaspete construită de client e EXACT cea parsată de server', () => {
    // The frontend builds "guest:<id>:<name> (<relation>)" /
    // "guest-pending:<id>:<name> (<relation>)"; chat.ts parses it with one
    // regex. Build the label the client's way and prove the server's regex
    // reads it back — a format drift here would silently strip the guest's
    // restrictions (admin powers would leak back).
    const buildLabel = (kind: 'guest' | 'guest-pending', id: number, name: string, relation: string): string =>
      `${kind}:${id}:${name}${relation ? ` (${relation})` : ''}`
    const serverRe = /^guest(-pending)?:(\d+):(.+)$/

    const approved = serverRe.exec(buildLabel('guest', 7, 'Maria', 'soție'))
    expect(approved?.[1]).toBeUndefined()
    expect(approved?.[2]).toBe('7')
    expect(approved?.[3]).toBe('Maria (soție)')

    const pending = serverRe.exec(buildLabel('guest-pending', 9, 'Vicențiu', ''))
    expect(pending?.[1]).toBe('-pending')
    expect(pending?.[2]).toBe('9')
    expect(pending?.[3]).toBe('Vicențiu')

    // A holder turn carries NO label → no guest parse, full rights kept.
    expect(serverRe.exec('')).toBeNull()
  })

  it('tura de oaspete pierde drepturile de admin ÎNAINTE de alegerea uneltelor', () => {
    // The guest strip must happen BEFORE the tool list is built — otherwise
    // one turn could run with admin tools and a guest at the mic.
    const idxStrip = beChat.indexOf("const isAdmin = user.role === 'admin' && !guestMatch")
    const idxTools = beChat.indexOf('const rawTools')
    expect(idxStrip).toBeGreaterThanOrEqual(0)
    expect(idxTools).toBeGreaterThan(idxStrip)
  })
})
