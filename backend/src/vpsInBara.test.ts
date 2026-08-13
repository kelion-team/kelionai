import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── THE VPS, PERMANENTLY IN THE TOP BAR ────────────────────────────────────
//
// Adrian, Jul 31: "show the VPS permanently on the interface in the top bar".
//
// The real stake is not the display, it's its HONESTY. On the same day, the
// panel showed three times a state it had never measured — "£0.00" being the
// classic case: the field started at 0 and stayed 0 when the request failed,
// so a read failure looked identical to "you have no money". This pill is new
// and has the same risk shape: "VPS 0.0GB · 0%" would look exactly like a
// server that just died.
//
// That's why TWO things are measured here:
//   1. absence is shown as absence ("⚠ VPS"), not as zero;
//   2. the bar's thresholds are THE SAME as the email alarm's — otherwise the
//      bar could be green while the sentinel sends a red alert, and then you
//      no longer know which one to believe.
//
// The frontend has no test runner; we read it from here, like poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const bara = sursa('../../frontend/src/pages/Stage.tsx')
// The honest wording moved into adminText.ts (i18n audit, Aug 2).
const texte = sursa('../../frontend/src/lib/adminText.ts')
const ruta = sursa('./routes/admin.ts')
const resurse = sursa('./services/resurse.ts')

describe('pilula de VPS există și e alimentată', () => {
  it('ruta care hrănește bara chiar măsoară resursele', () => {
    expect(ruta).toContain('resurseGazda()')
    expect(ruta).toMatch(/vps,/)
  })

  it('bara afișează și memoria, și încărcarea — două întrebări diferite', () => {
    // RAM = does anything else FIT on the machine. CPU = can it still CARRY.
    // One without the other answers half the question the pill was asked for.
    expect(bara).toMatch(/VPS \$\{brainCredit\.vps\.liberGb\.toFixed\(1\)\}GB/)
    // Încărcarea rămâne afișată din measurătoarea REALĂ (incarcarePct), dar ca
    // RAPORT peste nuclee (owner, 13 aug: „măsurători mincinoase" — „201%" citit
    // ca CPU părea imposibil). /100 → „2.0×"; tot numărul măsurat, altă etichetă.
    expect(bara).toMatch(/brainCredit\.vps\.incarcarePct \/ 100\)\.toFixed\(1\)\}×/)
  })

  it('nu adaugă un poller nou — merge pe cererea care exista deja', () => {
    // An extra request every 15s, for two numbers that read from /proc in
    // microseconds, would be cost with no gain.
    const pollere = bara.match(/usePolledJson</g) ?? []
    expect(pollere.length).toBeLessThanOrEqual(2)
    expect(bara).toContain("usePolledJson<BrainCredit>('/api/admin/brain-credit'")
  })
})

describe('lipsa se arată ca lipsă, nu ca zero', () => {
  it('citirea eșuată dă „⚠ VPS", nu cifre', () => {
    expect(bara).toContain("'⚠ VPS'")
    // Textul onest vine acum din adminText (EN bază + RO), nu dintr-un literal.
    expect(bara).toContain('adminStrings().vpsPillDead')
    expect(texte).toMatch(/Nu pot măsura resursele VPS-ului/)
  })

  it('nicăieri un `?? 0` care să transforme lipsa într-un zero credibil', () => {
    // Exactly the "£0.00" pattern: a field that starts at 0 and stays 0 when
    // the request fails. Here the figures are read ONLY from the branch where
    // `vps` exists.
    expect(bara).not.toMatch(/vps[?.]*\.liberGb\s*\?\?\s*0/)
    expect(bara).not.toMatch(/vps[?.]*\.incarcarePct\s*\?\?\s*0/)
  })

  it('sursa măsurătorii întoarce null la eșec, nu un obiect cu zerouri', () => {
    expect(resurse).toMatch(/return null \/\/ no \/proc/)
    expect(resurse).toMatch(/if \(!mem \|\| !load\) return null/)
  })
})

describe('bara și mailul spun același lucru', () => {
  // If the thresholds differ, you can have a green bar and a red email for the
  // same state — and then you have no way to know which to believe. We keep
  // them tied.
  it('pragurile din bară sunt cele din services/resurse.ts', () => {
    expect(resurse).toMatch(/PRAG_MEMORIE_PCT = 10/)
    expect(resurse).toMatch(/PRAG_INCARCARE_PCT = 200/)
    expect(bara).toMatch(/liberPct <= (\(brainCredit\.vps\.pragMemoriePct \?\? )?10/)
    expect(bara).toMatch(/incarcarePct >= (\(brainCredit\.vps\.pragIncarcarePct \?\? )?200/)
  })
  it('sentinela folosește aceleași constante, nu numere copiate', () => {
    const sentinela = sursa('./routes/ops.ts')
    expect(sentinela).toContain('PRAG_MEMORIE_PCT')
    expect(sentinela).toContain('PRAG_INCARCARE_PCT')
  })
})
