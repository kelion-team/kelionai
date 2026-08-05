import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ── ANTI-RĂTĂCIREA CONSTRUCTORULUI (5 aug 2026) ──────────────────────────────
// Cauza MĂSURATĂ a joburilor picate: 40 de grep-uri la rând, zero editări, tot
// bugetul MAX_STEPS ars fără să producă (job 96: „40 pași cu unelte, 0 sterili").
// Un grep care „lucrează" numără ca pas util exact ca un edit, deci explorarea
// pură golește bugetul. `pasExplorare` numără explorările CONSECUTIVE fără nicio
// producție și cere ghiontul spre editare la PRAG_EXPLORARE. Testele astea țin
// garda: explorarea crește contorul, producția îl resetează, la prag vine
// ghiontul, iar o tură fără explorare nu-l mișcă.
//
// Ca și testul lui potrivesteEdit: modulul VPS e ESM în afara rădăcinii backend
// — nu se încarcă în-proces (vitest îl rupe la load). Îl exersăm REAL printr-un
// subproces node care-l importă nativ și răspunde cu JSON.

const MJS = fileURLToPath(new URL('../../deploy/constructor-agent.mjs', import.meta.url))

interface Rez {
  contor: number
  ghiont: boolean
}

function proba(numeUnelte: string[], aProdus: boolean, contorVechi: number): Rez {
  const script = `
    const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))});
    const r = m.pasExplorare(${JSON.stringify(numeUnelte)}, ${JSON.stringify(aProdus)}, ${JSON.stringify(contorVechi)});
    console.log(JSON.stringify(r));
  `
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 30000,
  })
  return JSON.parse(stdout.trim()) as Rez
}

function prag(): number {
  const stdout = execFileSync(
    process.execPath,
    ['--input-type=module', '-e', `const m = await import(${JSON.stringify('file:///' + MJS.replace(/\\/g, '/'))}); console.log(m.PRAG_EXPLORARE);`],
    { encoding: 'utf8', timeout: 30000 },
  )
  return Number(stdout.trim())
}

describe('pasExplorare — anti-rătăcirea constructorului', () => {
  it('explorarea (grep/ls/read) crește contorul, fără ghiont sub prag', () => {
    expect(proba(['grep'], false, 0)).toEqual({ contor: 1, ghiont: false })
    expect(proba(['read'], false, 3)).toEqual({ contor: 4, ghiont: false })
    expect(proba(['ls'], false, 1)).toEqual({ contor: 2, ghiont: false })
  })

  it('PRODUCȚIA (edit/write) resetează contorul la 0, fără ghiont', () => {
    expect(proba(['edit'], true, 7)).toEqual({ contor: 0, ghiont: false })
    expect(proba(['edit_lines'], true, 5)).toEqual({ contor: 0, ghiont: false })
    // chiar dacă a explorat ȘI a produs în aceeași tură, producția câștigă
    expect(proba(['grep', 'edit'], true, 6)).toEqual({ contor: 0, ghiont: false })
  })

  it('la PRAG_EXPLORARE explorări fără producție → GHIONT (și reset)', () => {
    const P = prag()
    // ajungem la P-1 fără ghiont
    expect(proba(['grep'], false, P - 2)).toEqual({ contor: P - 1, ghiont: false })
    // pasul care atinge pragul dă ghiontul și resetează contorul
    expect(proba(['grep'], false, P - 1)).toEqual({ contor: 0, ghiont: true })
  })

  it('o tură FĂRĂ explorare și fără producție (ex. run) nu mișcă contorul', () => {
    expect(proba(['run'], false, 3)).toEqual({ contor: 3, ghiont: false })
    expect(proba([], false, 4)).toEqual({ contor: 4, ghiont: false })
  })
})
