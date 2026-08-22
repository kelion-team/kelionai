import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// ── LACĂTUL „OFFLINE = DOAR CE MERGE DOVEDIT" (owner, 22 aug) ────────────────
// Ordinele verbatim: „cind este in mod ofline, funtiile dedicate de internet nu
// trebuiesc sa se reafiseze, ele sunt afisate doar cind aplicatia e live" +
// „vreau sa ramina ce merge dovedit". Regula mecanizată aici: fiecare intrare
// de UI care cere serverul stă în spatele lui `online` (pingul real /health,
// useConectat) — nu a lui navigator.onLine, care minte.
//
// Pinurile se fac pe COD VIU: comentariile se aruncă ÎNTÂI (lecția M6 — un
// text din comentariu poate înghiți pinul), în ordinea // apoi /* */.
const aici = dirname(fileURLToPath(import.meta.url))
function codViu(rel: string): string {
  return readFileSync(join(aici, rel), 'utf8')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
}
const chat = codViu('components/ChatPanel.tsx')
const stage = codViu('pages/Stage.tsx')

describe('offline: funcțiile de internet nu se afișează (ChatPanel)', () => {
  it('microfonul (o singură definiție, compozitor + mașină) e null offline', () => {
    expect(chat).toMatch(/const micButton = \(cls: string\) =>\s*!online \? null : \(/)
  })

  it('microfonul din modul mașină stă și el după `online`', () => {
    expect(chat).toMatch(/\{online && \(\s*<div className="car-mic-wrap">/)
  })

  it('meniul „+" (📎 fișiere, 📷 cameră, 🎬 scenariu) dispare întreg offline', () => {
    expect(chat).toMatch(/\{online && \(\s*<div className="fn-wrap"/)
  })

  it('ușa din dos a fișierelor e închisă: paste/drop ies devreme offline', () => {
    expect(chat).toMatch(/function onPasteFiles\(e: ReactClipboardEvent\): void \{\s*if \(!esteConectat\(\)\) return/)
    expect(chat).toMatch(/function onDropFiles\(e: ReactDragEvent\): void \{\s*if \(!esteConectat\(\)\) return/)
  })
})

describe('offline: funcțiile de internet nu se afișează (Stage)', () => {
  it('starea vine din pingul real (useConectat), nu din navigator.onLine', () => {
    expect(stage).toMatch(/const online = useConectat\(\)/)
    expect(chat).toMatch(/const online = useConectat\(\)/)
  })

  it('meniul „Aplicații" (toate = comenzi către server) dispare offline', () => {
    expect(stage).toMatch(/\{online && \(\s*<div className="apps-wrap">/)
  })

  it('portofelul și „Add credits" (sold/pachete/cod de pe server) dispar offline', () => {
    expect(stage).toMatch(/user\.role !== 'admin' && online && \(\s*<WalletButton/)
    expect(stage).toMatch(/user\.role !== 'admin' && online && \(\s*<button[\s\S]{0,600}kelion:wallet-open/)
  })
})
