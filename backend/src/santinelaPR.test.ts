// ── SANTINELA PR — dovada AUTO-APROBĂRII pe fiecare combinație ────────────────
// Owner, 19 aug: „autoaprobare merged, da DACĂ e fără err; dacă are erori, se
// rezolvă întâi și după, da". Decizia per-PR e o funcție PURĂ (decideActiuneSantinela),
// probată aici pe fiecare combinație — nu doar prin citirea codului. Garda cerută
// de owner e chiar poarta: nimic roșu/neverificat nu ajunge la merge.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { decideActiuneSantinela } from './services/santinelaPR.js'

const aici = dirname(fileURLToPath(import.meta.url))
const s = (rel: string): string => readFileSync(join(aici, rel), 'utf8')

// Bază „totul verde, ramură proprie, nimic îmbinat încă" — pe care o variem.
const baza = {
  portiSucces: true,
  mergeable: true,
  inUrma: false,
  esteRamuraProprie: true,
  ajaImbinatUnul: false,
}

describe('decideActiuneSantinela — auto-aprobare DOAR pe verde, pe fiecare combinație', () => {
  it('porți NE-verzi (roșu / pe drum / nu pot verifica) → skip (garda: nimic roșu nu se atinge)', () => {
    expect(decideActiuneSantinela({ ...baza, portiSucces: false })).toBe('skip')
    // chiar dacă e îmbinabil și ramură proprie, roșul NU se îmbinând
    expect(decideActiuneSantinela({ ...baza, portiSucces: false, mergeable: true })).toBe('skip')
  })

  it('rămas în urmă de master → trage (update-branch), are prioritate peste orice', () => {
    expect(decideActiuneSantinela({ ...baza, inUrma: true })).toBe('trage')
    // behind se decide ÎNAINTE de mergeable/ramură (se re-măsoară pe sha nou)
    expect(decideActiuneSantinela({ ...baza, inUrma: true, mergeable: false })).toBe('trage')
    expect(decideActiuneSantinela({ ...baza, inUrma: true, esteRamuraProprie: false })).toBe('trage')
  })

  it('verde dar NE-îmbinabil → skip', () => {
    expect(decideActiuneSantinela({ ...baza, mergeable: false })).toBe('skip')
  })

  it('ramură STRĂINĂ verde+îmbinabilă → anunță (NU se îmbină orb)', () => {
    expect(decideActiuneSantinela({ ...baza, esteRamuraProprie: false })).toBe('anunta')
  })

  it('ramură PROPRIE verde+îmbinabilă, nimic îmbinat încă → ÎMBINĂ (auto-aprobare)', () => {
    expect(decideActiuneSantinela({ ...baza })).toBe('imbina')
  })

  it('deja s-a îmbinat unul în ciclu → skip (master serial, 1/ciclu)', () => {
    expect(decideActiuneSantinela({ ...baza, ajaImbinatUnul: true })).toBe('skip')
  })

  it('online/offline NU mai contează pentru decizia de merge (autonomie permanentă)', () => {
    // Decizia nu primește deloc ownerOnline — ramura proprie verde se îmbină oricum.
    // (ownerOnline rămâne folosit DOAR pentru textul anunțului de după merge.)
    expect(decideActiuneSantinela({ ...baza })).toBe('imbina')
  })
})

describe('cablajul santinelei — bucla folosește decizia pură + auto-merge pe verde', () => {
  const src = s('./services/santinelaPR.ts')
  it('bucla deleagă la decideActiuneSantinela și acționează pe ea', () => {
    expect(src).toContain('decideActiuneSantinela({')
    expect(src).toContain("actiune === 'trage'")
    expect(src).toContain("actiune === 'anunta'")
    expect(src).toContain("actiune === 'imbina'")
  })
  it('auto-merge-ul NU mai e gardat de „ownerOnline" (se îmbină și online, pe verde)', () => {
    // Regresia pe care o păzim: vechiul `if (ownerOnline) { anunță; continue }`
    // oprea merge-ul propriu cât timp ownerul era logat. Nu mai există.
    expect(src).not.toContain('if (ownerOnline) {')
    // repoMergePR rămâne calea de îmbinare (checkpoint + pauza de ops înăuntru)
    expect(src).toContain('repoMergePR(pr.number)')
    // doar ramurile propriei automatizări se îmbină singur
    expect(src).toContain("const PREFIXE_PROPRII = ['kelion/', 'panou/', 'claude/']")
  })
})
