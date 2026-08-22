import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── MONITORUL PE VOCE (JARVIS pasul 5 — PROIECT-CHAT-VOCE §8) ────────────────
// Cercetașul a măsurat: ecranul și gura erau complet independente — ACELAȘI
// șir de caractere pleca simultan pe monitor (cadrul doc din autoPreview) și
// în poziția „rezultat de spus" a modelului Live, iar singura frână a
// recitării era o instrucțiune („NEVER read aloud" = instrucție, nu mecanism —
// declarat chiar în RAMAS la pasul 4). Lacătele pinuiează legătura CAUZALĂ
// nouă: cadru de ecran ieșit în tura ușii → textul lung mutat din „rezultat"
// în câmpul al cărui nume spune singur regula. COD VIU (anti-M6, ordinea
// corectă: întâi liniile „//", apoi blocurile „/* */").

const dezbraca = (sursa: string): string =>
  sursa
    .split('\n')
    .filter((l) => !l.trimStart().startsWith('//'))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
const vocal = dezbraca(readFileSync(fileURLToPath(new URL('./routes/vocalLive.ts', import.meta.url)), 'utf8'))
const toolDefs = dezbraca(readFileSync(fileURLToPath(new URL('./services/brainToolDefs.ts', import.meta.url)), 'utf8'))

describe('monitorul nu se citește cu voce — mecanic, nu doar instrucție', () => {
  it('steagul se ridică DOAR pe cadrul purtător de TEXT ({doc}) — pe suprafețele-URL textul răspunsului NU e afișat, deci un steag pe orice cadru ar pune formula să mintă (verificatorii pasului 5)', () => {
    expect(vocal).toMatch(/^\s*let docPeEcranInUsa = false/m)
    expect(vocal).toMatch(/if \('doc' in frame\) \{\s*\n\s*if \(!docPeEcranInUsa\) pulsVoce\.usiCuDoc\+\+\s*\n\s*docPeEcranInUsa = true/)
  })
  it('cu doc trimis și text peste prag, textul NU mai stă în poziția „rezultat de spus" — și pleacă ÎNTREG (nicio trunchiere: tăierea poate inversa sensul, Legea #1); formula afirmă DOAR ce s-a măsurat', () => {
    expect(vocal).toMatch(/^\s*if \(docPeEcranInUsa && !contineDemascare && r\.text\.length > PRAG_PREDARE_ECRAN\) \{/m)
    // câmpul de ecran primește r.text NEATINS (fără slice/substring):
    expect(vocal).toMatch(/pe_ecran_nu_se_recita: r\.text,/)
    expect(vocal).not.toMatch(/pe_ecran_nu_se_recita: r\.text\.(slice|substring)/)
    // formula măsurată („un document a fost trimis"), nu pretenția falsă („e DEJA afișat"):
    expect(vocal).toMatch(/de_rostit: 'Un document a fost trimis pe monitor în tura asta/)
    expect(vocal).not.toMatch(/DEJA afișat pe monitor/)
    // sub prag sau fără doc, drumul vechi rămâne neatins:
    expect(vocal).toMatch(/live\?\.raspundeUnealta\(apel\.id, apel\.name, \{ rezultat: r\.text \|\| 'creierul n-a întors niciun text' \}\)/)
  })
  it('demascarea porții faptelor (marcajul ⚠) NU moare în câmpul nerostit: cu demascare în text, splitul se sare — adevărul rostit bate evitarea recitării', () => {
    expect(vocal).toMatch(/const contineDemascare = r\.text\.includes\('\\n\\n⚠ '\)/)
  })
  it('pragul e declarat pe linie (LEGEA ANTI-HARDCODARE); măsurătoarea există în pulsVoce și contorul numără doar predări chiar TRIMISE (live există)', () => {
    const brut = readFileSync(fileURLToPath(new URL('./routes/vocalLive.ts', import.meta.url)), 'utf8')
    expect(brut).toMatch(/PRAG_PREDARE_ECRAN = 300 \/\/ hardcod-permis: /)
    expect(vocal).toMatch(/^\s*usiCuDoc: 0,/m)
    expect(vocal).toMatch(/^\s*predariEcran: 0,/m)
    expect(vocal).toMatch(/if \(live\) \{\s*\n\s*pulsVoce\.predariEcran\+\+\s*\n\s*live\.raspundeUnealta/)
  })
  it('fișa ușii poartă regula predării (stratul de instrucție rămâne, peste mecanism), iar stare_masurata nu mai e fără frână pe voce', () => {
    expect(vocal).toMatch(/Când rezultatul are câmpul „pe_ecran_nu_se_recita", un document a fost trimis pe monitor/)
    expect(toolDefs).toMatch(/On voice, NEVER read the raw JSON aloud/)
  })
})
