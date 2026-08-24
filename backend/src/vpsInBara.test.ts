import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── VPS-ul: MUTAT SUB ADMIN (Sistem VPS), dar tot MĂSURAT și ONEST ──────────
//
// Adrian, 31 iul: „arată VPS-ul permanent pe interfață, în bara de sus". 13 aug:
// „VPS îl pui sub admin, vizibil; în locul liber pui becurile de credit". Deci
// cifrele VPS au plecat din bara de sus în tabul „Sistem (VPS)" din Admin — dar
// miza NU s-a schimbat: rămâne ONESTITATEA. În aceeași zi panoul a arătat de trei
// ori o stare pe care n-o măsurase — „£0.00" e cazul clasic: câmpul pornea de la
// 0 și rămânea 0 când cererea pica, deci o citire eșuată arăta identic cu „n-ai
// bani". Pastila asta are aceeași formă de risc: „VPS 0.0GB · 0%" ar arăta exact
// ca un server tocmai mort.
//
// De-aia se măsoară AICI, oriunde ar sta cifrele:
//   1. lipsa se arată ca lipsă („⚠ VPS necitibil"), nu ca zero;
//   2. pragurile sunt ACELEAȘI cu ale alarmei pe email — altfel panoul ar putea fi
//      verde cât sentinela trimite roșu, și n-ai mai ști pe care să crezi.
//
// Frontendul n-are runner de teste; îl citim de aici, ca la poartaNumelui.
const sursa = (cale: string): string =>
  readFileSync(fileURLToPath(new URL(cale, import.meta.url)), 'utf8')

const bara = sursa('../../frontend/src/pages/Stage.tsx')
// Cifrele VPS trăiesc acum în panoul de administrare (tabul „Sistem (VPS)").
const panou = sursa('../../frontend/src/components/AdminPanel.tsx')
const ruta = sursa('./routes/admin.ts')
const resurse = sursa('./services/resurse.ts')

describe('cifrele de VPS există și sunt alimentate', () => {
  it('ruta care hrănește panoul chiar măsoară resursele', () => {
    expect(ruta).toContain('resurseGazda()')
    expect(ruta).toMatch(/vps,/)
  })

  it('panoul Admin afișează și memoria, și încărcarea — două întrebări diferite', () => {
    // RAM = mai încape ceva pe mașină. CPU = mai duce. Una fără alta răspunde la
    // jumătate din întrebarea pentru care există cifra.
    expect(panou).toMatch(/v\.liberGb\.toFixed\(1\)\}GB/)
    // Încărcarea rămâne din măsurătoarea REALĂ (incarcarePct), dar ca RAPORT peste
    // nuclee (owner, 13 aug: „201%" citit ca CPU părea imposibil). /100 → „2.0×".
    expect(panou).toMatch(/v\.incarcarePct \/ 100\)\.toFixed\(1\)\}×/)
  })

  it('nu adaugă un poller nou — merge pe cererea brain-credit care exista deja', () => {
    // O cerere în plus la 15s, pentru două numere citite din /proc în microsecunde,
    // ar fi cost fără câștig.
    const pollere = bara.match(/usePolledJson</g) ?? []
    expect(pollere.length).toBeLessThanOrEqual(2)
    expect(bara).toMatch(/usePolledJson<BrainCredit>\(\s*['"]\/api\/admin\/brain-credit['"]/)
  })
})

describe('lipsa se arată ca lipsă, nu ca zero', () => {
  it('citirea eșuată spune „VPS necitibil", nu cifre de zero', () => {
    expect(panou).toContain('VPS necitibil')
  })

  it('nicăieri un `?? 0` care să transforme lipsa într-un zero credibil', () => {
    // Exact tiparul „£0.00": un câmp care pornește de la 0 și rămâne 0 când
    // cererea pică. Cifrele se citesc DOAR din ramura unde `vps` există.
    expect(panou).not.toMatch(/vps[?.]*\.liberGb\s*\?\?\s*0/)
    expect(panou).not.toMatch(/vps[?.]*\.incarcarePct\s*\?\?\s*0/)
  })

  it('sursa măsurătorii întoarce null la eșec, nu un obiect cu zerouri', () => {
    expect(resurse).toMatch(/return null \/\/ no \/proc/)
    expect(resurse).toMatch(/if \(!mem \|\| !load\) return null/)
  })
})

describe('panoul folosește pragurile măsurătorii comune', () => {
  // Dacă pragurile diferă, poți avea panou verde și email roșu pentru aceeași
  // stare — și n-ai cum să știi pe care să crezi. Le ținem legate.
  it('pragurile din panou sunt cele din services/resurse.ts', () => {
    expect(resurse).toMatch(/PRAG_MEMORIE_PCT = 10/)
    expect(resurse).toMatch(/PRAG_INCARCARE_PCT = 200/)
    expect(panou).toMatch(/liberPct <= \(v\.pragMemoriePct \?\? 10\)/)
    expect(panou).toMatch(/incarcarePct >= \(v\.pragIncarcarePct \?\? 200\)/)
  })
})
