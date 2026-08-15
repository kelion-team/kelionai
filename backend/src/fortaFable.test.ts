// ── P18: COMUTATORUL MANUAL DE CREIER AL CONSTRUCTORULUI ────────────────────
// (owner, 15 aug, verbatim: „vreau un buton in admin, aici sa pot schimba
// manual cind comut modelul de constructor si cind decuplez sa foloseasca
// logica de acum... buton apesi se trece pe fable 5 obligatoriu, dezapesi
// trece normal")
//
// Lacăte de sursă pe cele trei verigi — „obligatoriu" care ar aluneca tăcut
// pe Gemini ar minți butonul, deci exact aluneca e interzisă aici:
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const aici = dirname(fileURLToPath(import.meta.url))
const ctor = readFileSync(join(aici, 'routes/constructor.ts'), 'utf8')
const panou = readFileSync(join(aici, '../../frontend/src/components/AdminPanel.tsx'), 'utf8')

describe('butonul „Forțează Fable 5" — apăsat = obligatoriu, dezapăsat = logica de azi', () => {
  it('apăsat: TOATE turele merg pe Fable 5, iar eșecul lui NU cade tăcut pe Gemini', () => {
    expect(ctor).toMatch(/const fortaFable = \(await loadKv\('constructor:forta_fable'\)/)
    expect(ctor).toMatch(/Fable 5 FORȚAT de tine a picat[\s\S]{0,80}?nu cad pe Gemini cât butonul e apăsat/)
    // și fără cheie, butonul apăsat SPUNE, nu alunecă pe Gemini
    expect(ctor).toMatch(/Fable 5 FORȚAT de tine, dar cheia/)
  })

  it('starea se schimbă doar prin ruta de admin, gardată de cerAdmin', () => {
    expect(ctor).toMatch(/app\.post[\s\S]{0,120}?'\/api\/admin\/constructor\/forta-fable'[\s\S]{0,200}?cerAdmin\(req, reply\)/)
    // GET-ul cozii cară starea butonului, ca panoul să nu ghicească
    expect(ctor).toMatch(/fortaFable: \(await loadKv\('constructor:forta_fable'\)/)
  })

  it('panoul are butonul, cu ambele stări pe față', () => {
    expect(panou).toMatch(/\/api\/admin\/constructor\/forta-fable/)
    expect(panou).toMatch(/Fable 5 FORȚAT — apasă pt\. normal/)
    expect(panou).toMatch(/Forțează Fable 5/)
  })

  it('dezapăsat: logica de azi rămâne neatinsă (Gemini principal, Fable la reluări)', () => {
    expect(ctor).toMatch(/incercareOrdin > 1 && fable5Disponibil\(\)/)
    expect(ctor).toMatch(/incercareOrdin === 1 && fable5Disponibil\(\)/)
  })
})
