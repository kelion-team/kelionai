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
  // COD VIU, NU TEXT (mutantul M6 al verificatorului: judecata COMENTATĂ trecea
  // toate lacătele — regexurile neancorate potriveau și comentariile). Ancorele
  // `^\s*` cu flag `m` nu pot traversa `//`; comentariile-bloc se curăță întâi.
  const viu = ruta
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n')
  it('poartaFaptelor e importată și chemată pe tura vorbită (cod viu, nu comentariu)', () => {
    expect(viu).toMatch(/^\s*import \{ pretentiiFaraFapta, textulNuPotVerifica, clasificaRezultatUnealta, type DovadaUnealta \} from '\.\.\/services\/poartaFaptelor\.js'/m)
    expect(viu).toMatch(/^\s*const nedovedite = pretentiiFaraFapta\(k, doveziVoceTura\)/m)
    // TEXTUL e „nu pot verifica", NU un verdict de fals (agentul de consecințe:
    // pe voce pretenția poate fi un recall ADEVĂRAT al unei fapte din altă tură).
    expect(viu).toMatch(/^\s*const demascare = textulNuPotVerifica\(nedovedite\)/m)
  })
  it('judecă DOAR turele pur-ușoare, cu consumul PE ROSTIRE și exempția vie cât ușa grea e în zbor (agentul de logică #2-#4)', () => {
    expect(viu).toMatch(/^\s*if \(k\) \{/m)
    expect(viu).toMatch(/^\s*if \(!turaCuTemeiDinAfara && usiGreleInZbor === 0\) \{/m)
    // armările steagului: cere_creierului + ceasOrdine (ramura directă) + cele
    // 3 site-uri de consum al anunțului de SISTEM amânat:
    const armari = viu.match(/^\s*turaCuTemeiDinAfara = true/gm) ?? []
    expect(armari.length).toBeGreaterThanOrEqual(5)
    // anunțul de SISTEM amânat călătorește pe steagul lui — tura SCRISĂ
    // (același protocol anuntAmanat) rămâne judecată:
    expect(viu).toMatch(/^\s*let anuntSistemAmanat = false/m)
    const perechi = viu.match(/^\s*if \(anuntSistemAmanat\) \{/gm) ?? []
    expect(perechi.length).toBeGreaterThanOrEqual(3)
    // ușa grea în zbor: contor armat la intrare, eliberat în finally:
    expect(viu).toMatch(/^\s*usiGreleInZbor\+\+/m)
    expect(viu).toMatch(/\} finally \{\s*\n\s*usiGreleInZbor--/)
    // consumul: dovezile se golesc pe rostire; steagul DOAR fără uși în zbor:
    expect(viu).toMatch(/^\s*doveziVoceTura = \[\]\s*\n\s*if \(usiGreleInZbor === 0\) turaCuTemeiDinAfara = false/m)
  })
  it('dovezile turei = rezultatele REALE clasificate ale uneltelor sesiunii Live (succes ȘI eșec)', () => {
    const clasificari = viu.match(/^\s*(?:if \(r != null\) )?noteazaDovadaVoce\(clasificaRezultatUnealta\(/gm) ?? []
    expect(clasificari.length).toBeGreaterThanOrEqual(3)
    // noteazaDovadaVoce ține AMBELE registre: dovada turei pentru cățel
    // (doveziVoceTura) + evenimentul DURABIL din jurnal (pasul 4):
    expect(viu).toMatch(/^\s*doveziVoceTura\.push\(dovada\)/m)
    // tentativa picată e dovadă de EȘEC, nu acoperire:
    expect(viu).toMatch(/clasificaRezultatUnealta\(apel\.name, `tool_error: /)
  })
  it('nota intră în istoric, pe monitor ca DOC (nu voce) și în jurnal', () => {
    expect(viu).toMatch(/^\s*k \+= demascare/m)
    expect(viu).toMatch(/^\s*trimite\(\{ type: 'control', frame: \{ doc: \{ title: 'Poarta faptelor \(voce\)'/m)
    expect(viu).toMatch(/\[POARTA FAPTELOR\]\[VOCE\]/)
  })
})
