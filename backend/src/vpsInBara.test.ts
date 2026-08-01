import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── VPS-UL, PERMANENT ÎN BARA DE SUS ────────────────────────────────────────
//
// Adrian, 31 iul: „afișează permanent VPS pe interfață în bara de sus".
//
// Miza reală nu e afișajul, e ONESTITATEA lui. În aceeași zi, panoul a arătat
// de trei ori o stare pe care n-o măsurase niciodată — „£0.00" fiind cazul
// clasic: câmpul pornea de la 0 și rămânea 0 când cererea eșua, deci un eșec de
// citire arăta identic cu „n-ai bani". Pilula asta e nouă și are aceeași formă
// de risc: „VPS 0.0GB · 0%" ar arăta exact ca un server care tocmai a murit.
//
// De asta se măsoară aici DOUĂ lucruri:
//   1. lipsa se afișează ca lipsă („⚠ VPS"), nu ca zero;
//   2. pragurile din bară sunt ACELEAȘI cu cele din alarma pe email — altfel
//      bara ar putea fi verde în timp ce sentinela trimite alertă roșie, iar
//      atunci nu mai știi pe care s-o crezi.
//
// Frontendul n-are runner de teste; îl citim de aici, ca la poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const bara = sursa('../../frontend/src/pages/Stage.tsx')
const ruta = sursa('./routes/admin.ts')
const resurse = sursa('./services/resurse.ts')

describe('pilula de VPS există și e alimentată', () => {
  it('ruta care hrănește bara chiar măsoară resursele', () => {
    expect(ruta).toContain('resurseGazda()')
    expect(ruta).toMatch(/vps,/)
  })

  it('bara afișează și memoria, și încărcarea — două întrebări diferite', () => {
    // RAM = mai ÎNCAPE ceva pe mașină. CPU = mai DUCE. Una fără cealaltă
    // răspunde la jumătate din întrebarea pentru care a fost cerută pilula.
    expect(bara).toMatch(/VPS \$\{brainCredit\.vps\.liberGb\.toFixed\(1\)\}GB/)
    expect(bara).toContain('brainCredit.vps.incarcarePct}%')
  })

  it('nu adaugă un poller nou — merge pe cererea care exista deja', () => {
    // O cerere în plus la fiecare 15s, pentru două numere care se citesc din
    // /proc în microsecunde, ar fi cost fără câștig.
    const pollere = bara.match(/usePolledJson</g) ?? []
    expect(pollere.length).toBeLessThanOrEqual(2)
    expect(bara).toContain("usePolledJson<BrainCredit>('/api/admin/brain-credit'")
  })
})

describe('lipsa se arată ca lipsă, nu ca zero', () => {
  it('citirea eșuată dă „⚠ VPS", nu cifre', () => {
    expect(bara).toContain("'⚠ VPS'")
    expect(bara).toMatch(/Nu pot măsura resursele VPS-ului/)
  })

  it('nicăieri un `?? 0` care să transforme lipsa într-un zero credibil', () => {
    // Exact tiparul „£0.00": un câmp care pornește de la 0 și rămâne 0 când
    // cererea pică. Aici cifrele se citesc DOAR din ramura în care `vps` există.
    expect(bara).not.toMatch(/vps[?.]*\.liberGb\s*\?\?\s*0/)
    expect(bara).not.toMatch(/vps[?.]*\.incarcarePct\s*\?\?\s*0/)
  })

  it('sursa măsurătorii întoarce null la eșec, nu un obiect cu zerouri', () => {
    expect(resurse).toMatch(/return null \/\/ no \/proc/)
    expect(resurse).toMatch(/if \(!mem \|\| !load\) return null/)
  })
})

describe('bara și mailul spun același lucru', () => {
  // Dacă pragurile diferă, poți avea bara verde și un email roșu pentru aceeași
  // stare — și atunci n-ai cum să știi pe care s-o crezi. Le ținem legate.
  it('pragurile din bară sunt cele din services/resurse.ts', () => {
    expect(resurse).toMatch(/PRAG_MEMORIE_PCT = 10/)
    expect(resurse).toMatch(/PRAG_INCARCARE_PCT = 200/)
    expect(bara).toMatch(/liberPct <= 10/)
    expect(bara).toMatch(/incarcarePct >= 200/)
  })

  it('sentinela folosește aceleași constante, nu numere copiate', () => {
    const sentinela = sursa('./routes/ops.ts')
    expect(sentinela).toContain('PRAG_MEMORIE_PCT')
    expect(sentinela).toContain('PRAG_INCARCARE_PCT')
  })
})
