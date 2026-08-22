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
  it('microfonul offline există DOAR cu urechea locală (kitul, 22 aug) — altfel null', () => {
    // Evoluția regulii: până la kit, offline = fără microfon (funcție de
    // internet). Cu urechea Whisper locală în cache, microfonul E o funcție
    // offline reală — butonul apare doar când chiar merge (anti-„doar poze").
    expect(chat).toMatch(/const micButton = \(cls: string\) =>\s*!online && !urecheaLocalaGata \? null : \(/)
  })

  it('microfonul din modul mașină stă și el după `online`', () => {
    expect(chat).toMatch(/\{online && \(\s*<div className="car-mic-wrap">/)
  })

  it('meniul „+" (📎 fișiere, 📷 cameră, 🎬 scenariu) dispare întreg offline', () => {
    expect(chat).toMatch(/\{online && \(\s*<div className="fn-wrap"/)
  })

  it('ușa din dos a fișierelor e închisă: paste/drop ies devreme offline', () => {
    expect(chat).toMatch(/function onPasteFiles\(e: ReactClipboardEvent\): void \{\s*if \(!esteConectat\(\)\) return/)
    // La drop, preventDefault vine ÎNAINTE de return: onDragOver previne mereu,
    // deci fără prevenire și aici browserul NAVIGA la fișierul aruncat
    // (aplicația înlocuită, stare pierdută) — verificatorul de logică, 22 aug.
    expect(chat).toMatch(/function onDropFiles\(e: ReactDragEvent\): void \{\s*if \(!esteConectat\(\)\) \{\s*e\.preventDefault\(\)\s*return\s*\}/)
  })

  it('vocea ONLINE se ÎNCHIDE pe offline, iar urechea LOCALĂ îi ia locul (kitul, 22 aug)', () => {
    // Blocantul verificatorului rămâne acoperit: sesiunea de server se stinge
    // la căderea netului (fără micManualOff — omul n-a ales oprit), ensureMic
    // refuză pornirea offline; în plus, urechea Whisper locală pornește ea
    // (din cache, fără rețea), cu buton viu și half-duplex față de gura Piper.
    expect(chat).toMatch(/urecheaLocalaRef\.current\?\.stop\(\)[\s\S]{0,300}if \(!micManualOffRef\.current\) void ensureMicRef\.current\(\)/)
    expect(chat).toMatch(/vlGeneratieRef\.current\+\+[\s\S]{0,400}micRef\.current\?\.stop\(\)/)
    expect(chat).toMatch(/void pornesteUrecheaLocalaRef\.current\(\)/)
    // half-duplex și față de coada Chirp rămasă să sune (verificatorul:
    // stopVoice nu o mai taie la căderea netului — redarea e locală).
    expect(chat).toMatch(/if \(piperVorbeste\(\) \|\| isVoicePlaying\(\)\) return/)
    expect(chat).toMatch(/if \(!esteConectat\(\)\) return\s*\n\s*if \(micRef\.current \|\| micStartingRef\.current \|\| micManualOffRef\.current\) return/)
  })

  it('câmpul de scris pornește GOL garantat (mătura pe nepotrivirea DOM≠stare)', () => {
    // Bug live (captura ownerului, 22 aug): „Cel iarl, ceva ce?" pre-scris la
    // pornire — restaurarea de formulare a browserului scrie DOM-ul fără
    // evenimente. Stare goală + DOM plin = scris din afară → se aruncă.
    expect(chat).toMatch(/if \(el && el\.value && !inputViuRef\.current\) el\.value = ''/)
    expect(chat).toMatch(/autoComplete="off"/)
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
