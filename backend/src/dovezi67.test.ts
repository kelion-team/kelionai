// ── LACĂT PE LANȚUL DOVEZILOR 6 ȘI 7 ALE AUTONOMIEI ─────────────────────────
// (owner, 15 aug: „fast - track, finalizeeaza si restul de 2 care nu sunt bifate")
//
// Dovada 7 („o cerință născută din el, nu din owner") are UN SINGUR izvor în
// tot codul: imbunatatireContinua() → adaugaCerinta(..., 'kelion', ...).
// Măsurat pe 15 aug: funcția exista, dar o chema doar finalul buclei autonome
// — DOAR când nu era absolut nimic de dus — deci cu cerințe curgând mereu,
// izvorul era practic secat și dovada 7 nu se putea aprinde. Acum reanaliza
// are cadența ei zilnică în index.ts, lângă triajul golurilor.
//
// Dovada 6 („vede ce îi lipsește și construiește") cerea un gol triat „DE
// IMPLEMENTAT" construit până la capăt — dar golurile stăteau ostatice unei
// misiuni fără niciun pas rulabil (testul de comportament e în
// services/autonomie.test.ts; aici doar lacătul pe formulare).
//
// Lacăte de SURSĂ (stil scutulDatelor): dacă cineva rupe una din verigi,
// testul pică cu textul de aici în față — nu descoperă ownerul, pe viu, că
// dovezile au încremenit iar.
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const citeste = (cale: string): string => readFileSync(join(aici, cale), 'utf8')

describe('dovada 7: izvorul cerințelor cu sursa lui', () => {
  it("imbunatatireContinua scrie cerințe cu sursa 'kelion' — singurul izvor al dovezii", () => {
    const cerinte = citeste('services/cerinte.ts')
    expect(cerinte).toMatch(/adaugaCerinta\(\s*`ÎMBUNĂTĂȚIRE la cerința #[\s\S]{0,120}?'kelion'/)
  })

  it('dovezi.ts chiar caută sursa lui — nu un alt câmp', () => {
    const dovezi = citeste('services/dovezi.ts')
    expect(dovezi).toMatch(/c\.sursa === 'kelion'/)
  })

  it('reanaliza are cadență ZILNICĂ în index.ts, lângă triaj, gardată de comutatorul autonom', () => {
    const index = citeste('index.ts')
    expect(index).toMatch(/import \{ imbunatatireContinua \} from '\.\/services\/cerinte\.js'/)
    // În interiorul lui `triaj` (după poarta autonomActiv și după triageGaps),
    // nu într-o buclă separată care ar putea rula cu comutatorul OPRIT.
    expect(index).toMatch(
      /const triaj[\s\S]{0,400}?autonomActiv[\s\S]{0,400}?triageGaps[\s\S]{0,900}?imbunatatireContinua/,
    )
  })
})

describe('dovada 6: golurile nu stau ostatice unei misiuni fără pași rulabili', () => {
  it('bucla măsoară dacă misiunea are vreun pas rulabil (nici gata, nici parcat)', () => {
    const autonomie = citeste('services/autonomie.ts')
    expect(autonomie).toMatch(/misiuneRulabila = pasii\.some\(\(e\) => e\.poate && !e\.st\.gata && !e\.st\.blocat\)/)
    // Lista generală (goluri + rânduri) intră când misiunea e gata SAU nu are
    // niciun pas rulabil — nu doar când e gata.
    expect(autonomie).toMatch(/misiuneGata \|\| !misiuneRulabila\s*\?\s*\[\.\.\.\(await golurileLui\(\)\)/)
  })
})
