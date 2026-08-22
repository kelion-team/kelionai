import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── LACĂTELE LOTULUI C (registrul de erori frontend, 21 aug) ─────────────────
// Verificatorul de porți al lotului C a măsurat că 7 din 8 reparații puteau
// regresa MUT (niciun test nu le pinuia) și a cerut paznici minimi pe cele mai
// periculoase: C1 (codecul Opus mort → difuzor permanent mut — lanț în 3
// fișiere, ruperea oricărei verigi compilează curat), C8 (pre-roll-ul de
// barge-in — primul cuvânt tăiat, invizibil pentru orice poartă) și C2+C4
// (rândurile oneste — regresia recreează exact minciuna reclamată de owner).
// Testele citesc sursele REALE (modelul bargrafUreche/urechiChirp).

const opus = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/opusVoce.ts', import.meta.url)), 'utf8')
const vl = readFileSync(fileURLToPath(new URL('../../frontend/src/lib/vocalLive.ts', import.meta.url)), 'utf8')
const ruta = readFileSync(fileURLToPath(new URL('./routes/vocalLive.ts', import.meta.url)), 'utf8')
const panou = readFileSync(fileURLToPath(new URL('../../frontend/src/components/ChatPanel.tsx', import.meta.url)), 'utf8')

describe('C1 — codecul Opus mort în zbor NU mai lasă difuzorul mut (toate cele 3 verigi)', () => {
  it('veriga 1: opusVoce anunță moartea (encoder ȘI decoder), o singură dată', () => {
    expect(opus).toMatch(/error: \(\) => anuntaMoartea\('encoder'\)/)
    expect(opus).toMatch(/error: \(\) => anuntaMoartea\('decoder'\)/)
    expect(opus).toMatch(/if \(moarteAnuntata\) return/)
  })
  it('veriga 2: clientul cade TOTAL pe PCM și spune serverului (opus_cazut)', () => {
    expect(vl).toMatch(/opusClient = null\s*\n\s*opusTx = false\s*\n\s*try \{ ws\.send\(JSON\.stringify\(\{ type: 'opus_cazut' \}\)\) \}/)
  })
  it('veriga 3: serverul primește opus_cazut → hop înapoi pe PCM (opusActiv=false)', () => {
    expect(ruta).toMatch(/m\.type === 'opus_cazut'/)
    expect(ruta).toMatch(/opus_cazut'\) \{[\s\S]{0,600}opusActiv = false/)
  })
})

describe('C8 — pre-roll-ul de barge-in: primul cuvânt al întreruperii ajunge ÎNTREG', () => {
  it('cât poarta e sus (Kelion audibil), cadrele REALE intră în inelul mărginit', () => {
    expect(vl).toMatch(/if \(poarta\) \{\s*\n\s*preRoll\.push\(ds\)/)
  })
  it('pe calea fără VAD, ridicarea porții golește inelul (tranziția eraPoarta)', () => {
    expect(vl).toMatch(/else if \(eraPoarta && !vadPornit\) \{/)
    expect(vl).toMatch(/eraPoarta = poarta/)
  })
  it('pe calea cu VAD, deschiderea golește inelul întâi — cu gardul RMS anti-ecou (F10 al marii verificări: mobilul fără AEC nu trimite coada de ecou)', () => {
    expect(vl).toMatch(/if \(rez\.deschis && !eraDeschis\) \{[\s\S]{0,700}if \(preRoll\.some\(\(b\) => rmsDin\(b\) >= PRAG_RMS_PREROLL_VAD\)\) \{\s*\n\s*for \(const b of preRoll\) trimiteCadru\(b\)/)
  })
})

describe('C2 + C4 — rândurile oneste nu pot regresa la minciună', () => {
  it('C2: tura online complet goală (fără cadre, fără sunet) primește rândul onest turnEmpty', () => {
    expect(panou).toMatch(/turaAvutSemneRef\.current = true/)
    expect(panou).toMatch(/!eTuraOffline && !turaAvutSemneRef\.current && !aSunatTuraRef\.current/)
    expect(panou).toMatch(/strings\(lang\)\.turnEmpty/)
  })
  it('C4: cele 3 verdicte HTTP au fiecare vorba LOR (nu minciunile vechi)', () => {
    expect(panou).toMatch(/\? spoken\.sessionExpired/)
    expect(panou).toMatch(/\? spoken\.paywallRow/)
    expect(panou).toMatch(/\? spoken\.rateLimited/)
    // formele vechi mincinoase nu mai au voie pe aceste coduri:
    expect(panou).not.toMatch(/'unauthorized'[\s\S]{0,120}spoken\.offline/)
    expect(panou).not.toMatch(/'rate_limited'[\s\S]{0,80}spoken\.requestLost/)
  })
})
