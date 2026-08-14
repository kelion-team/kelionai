import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── POARTA MONITORULUI (owner, 14 aug 2026) ──────────────────────────────────
//
// Cerința, verbatim: „trebuie sa verifici ca fara comanda clara sa nu faca
// nimic pe monitor". Vectorul real: `click_monitor` apasă ELEMENTE VII din
// aplicație (ChatPanel: elementFromPoint + .click()) — un creier care
// halucinează un click ar putea apăsa orice buton, inclusiv din admin.
// Poarta e deterministă, în chat.ts: acțiunile pe monitor (click/zoom) rulează
// DOAR când tura curentă a omului conține o comandă clară; altfel refuz
// cinstit și frame-ul de control NU pleacă. Cititul rămâne liber.
//
// Handler-ele stau adânc într-o închidere de rută — ca la poartaExecutiei,
// citim sursa (același model de test, același motiv).
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const chat = sursa('./routes/chat.ts')

describe('POARTA MONITORULUI: fără comandă clară, nimic nu se mișcă pe ecran', () => {
  it('poarta există și judecă tura CURENTĂ a omului (lastUserText), nu istoria', () => {
    expect(chat).toMatch(/POARTA MONITORULUI/)
    expect(chat).toMatch(/comandaClaraMonitor = \(\): boolean =>\s*\n\s*hasActionIntent\(lastUserText\) \|\| COMANDA_MONITOR_RE\.test\(lastUserText\)/)
  })

  it('click_monitor trece prin poartă ÎNAINTE să scrie frame-ul de control', () => {
    const bloc = /if \(name === 'click_monitor'\) \{[\s\S]*?\n {8}\}/.exec(chat)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(100)
    // Refuzul vine primul; scrierea clickMonitor există DOAR după el.
    const refuz = bloc.indexOf('comandaClaraMonitor()')
    const scriere = bloc.indexOf('clickMonitor')
    expect(refuz).toBeGreaterThan(-1)
    expect(scriere).toBeGreaterThan(refuz)
    expect(bloc).toMatch(/succes: false/)
  })

  it('zoom_monitor are aceeași poartă', () => {
    const bloc = /if \(name === 'zoom_monitor'\) \{[\s\S]*?\n {8}\}/.exec(chat)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(100)
    const refuz = bloc.indexOf('comandaClaraMonitor()')
    const scriere = bloc.indexOf('zoomMonitor')
    expect(refuz).toBeGreaterThan(-1)
    expect(scriere).toBeGreaterThan(refuz)
    expect(bloc).toMatch(/succes: false/)
  })

  it('verbele specifice de monitor sunt în poartă (click/apasă/zoom/mărește)', () => {
    expect(chat).toMatch(/COMANDA_MONITOR_RE/)
    expect(chat).toMatch(/clic\|click\|apas/)
    expect(chat).toMatch(/zoom\|m\[ăa\]re\[șs\]te/)
  })

  it('cititul rămâne liber: get_monitor și get_mouse_position NU trec prin poartă', () => {
    const gm = /if \(name === 'get_mouse_position'\) \{[\s\S]*?\n {8}\}/.exec(chat)?.[0] ?? ''
    expect(gm.length).toBeGreaterThan(50)
    expect(gm).not.toMatch(/comandaClaraMonitor/)
  })
})
