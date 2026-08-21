import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── CĂȚELUL PE VOCE (JARVIS pasul 2 — PROIECT-CHAT-VOCE §5) ─────────────────
// Gap-ul măsurat din spec: „poartaFaptelor rulează pe scris, NU pe voce".
// Lacătele pinuiează regula NOUĂ: pe tura vocală PUR-UȘOARĂ, pretențiile de
// faptă din ce a rostit Kelion se judecă pe uneltele chiar reușite ale turei;
// turele cu temei ÎN AFARA lor (creierul greu / anunț de sistem) NU se judecă
// (fals-pozitivul e interzis prin design). Demascarea: istoric + monitor (doc,
// niciodată citit cu voce — §8) + jurnal.

const ruta = readFileSync(fileURLToPath(new URL('./routes/vocalLive.ts', import.meta.url)), 'utf8')

describe('cățelul anti-minciună pe calea vocală ușoară', () => {
  it('poartaFaptelor e importată și chemată pe tura vorbită', () => {
    expect(ruta).toMatch(/import \{ pretentiiFaraFapta, textulDemascarii, clasificaRezultatUnealta, type DovadaUnealta \} from '\.\.\/services\/poartaFaptelor\.js'/)
    expect(ruta).toMatch(/const nedovedite = pretentiiFaraFapta\(k, doveziVoceTura\)/)
  })
  it('judecă DOAR turele pur-ușoare — temeiul din afară (creier greu / anunț de sistem) sare judecata', () => {
    expect(ruta).toMatch(/if \(k && !turaCuTemeiDinAfara\) \{/)
    // ambele armări ale steagului există:
    const armari = ruta.match(/turaCuTemeiDinAfara = true/g) ?? []
    expect(armari.length).toBeGreaterThanOrEqual(2)
    // …și steagul se RESETEAZĂ la fiecare tură salvată (altfel o singură ușă
    // ar orbi cățelul pe veci):
    expect(ruta).toMatch(/doveziVoceTura = \[\]\s*\n\s*turaCuTemeiDinAfara = false/)
  })
  it('dovezile turei = rezultatele REALE clasificate ale uneltelor sesiunii Live (succes ȘI eșec)', () => {
    const clasificari = ruta.match(/doveziVoceTura\.push\(clasificaRezultatUnealta\(/g) ?? []
    expect(clasificari.length).toBeGreaterThanOrEqual(3)
    // tentativa picată e dovadă de EȘEC, nu acoperire:
    expect(ruta).toMatch(/clasificaRezultatUnealta\(apel\.name, `tool_error: /)
  })
  it('demascarea intră în istoric, pe monitor ca DOC (nu voce) și în jurnal', () => {
    expect(ruta).toMatch(/k \+= demascare/)
    expect(ruta).toMatch(/frame: \{ doc: \{ title: 'Poarta faptelor \(voce\)'/)
    expect(ruta).toMatch(/\[POARTA FAPTELOR\]\[VOCE\]/)
  })
})
