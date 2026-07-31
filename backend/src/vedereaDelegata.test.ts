import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { groupCatalog } from './services/openrouter.js'

// ── CINE FACE VEDEREA, CÂND CREIERUL E ORB ──────────────────────────────────
//
// Adrian, 31 iul, după ce a ales creierul: „rămâne Nemotron 3 Ultra 550B, cine
// face vedere?"
//
// Întrebarea era exactă. Ultra e cel mai capabil creier gratuit măsurat — 550
// de miliarde de parametri, un milion de context, unelte, gândire — și e ORB.
// Iar `groupCatalog` filtra AMBELE liste pe `m.vision`, deci un singur model
// trebuia să facă și gândirea, și vederea. Ultra nu putea apărea NICIODATĂ în
// listă. De-asta îl tot căuta și nu-l găsea.
//
// Reparația nu e „scoatem filtrul". E că **vederea se deleagă**: tura CU POZĂ
// merge la un model care vede, restul rămân la creierul ales. Două meserii,
// doi specialiști — aceeași idee ca la Aider (unul gândește, altul scrie).
//
// Regula lui din 29 iul („se afișează doar AI care respectă TOATE
// funcționalitățile aplicației") rămâne întreagă, la nivelul la care conta:
// funcționalitatea e a APLICAȚIEI, nu a unui model singur.
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const orouter = readFileSync(fileURLToPath(new URL('./services/openrouter.ts', import.meta.url)), 'utf8')

// Catalog de probă, cu forma reală a celor măsurate pe 31 iul.
const MODELE = [
  { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', name: 'Ultra', provider: 'nvidia', vision: false, free: true },
  { id: 'google/gemma-4-31b-it:free', name: 'Gemma 31B', provider: 'google', vision: true, free: true },
  { id: 'google/gemma-4-26b-a4b-it:free', name: 'Gemma 26B', provider: 'google', vision: true, free: true },
] as unknown as Parameters<typeof groupCatalog>[0]

describe('creierul orb are voie în listă, ochii sunt separat', () => {
  it('treapta de MUNCĂ acceptă și un model fără vedere — altfel Ultra e invizibil', () => {
    const { work } = groupCatalog(MODELE)
    expect(work.map((m) => m.id)).toContain('nvidia/nemotron-3-ultra-550b-a55b:free')
  })

  it('treapta de CHAT rămâne doar cu modele care VĂD', () => {
    // Acolo nu există escaladare pe vedere, deci un model orb chiar ar rupe
    // o tură cu poză. Filtrul rămâne exact unde e încă necesar.
    const { chat: ieftin } = groupCatalog(MODELE)
    expect(ieftin.every((m) => m.vision)).toBe(true)
    expect(ieftin.map((m) => m.id)).not.toContain('nvidia/nemotron-3-ultra-550b-a55b:free')
  })
})

describe('ochii se aleg din catalogul live, nu dintr-o listă scrisă de mână', () => {
  it('`bestVisionModel` citește catalogul, nu un id fix în cod', () => {
    expect(orouter).toMatch(/export async function bestVisionModel/)
    expect(orouter).toMatch(/const cat = await getCatalog\(\)/)
  })

  it('preferă gratuit, dar nu rămâne fără vedere dacă nu există gratuit', () => {
    expect(orouter).toMatch(/const gratuite = vazatori\.filter\(\(m\) => m\.id\.endsWith\(':free'\)\)/)
    expect(orouter).toMatch(/const lista = gratuite\.length \? gratuite : vazatori/)
  })

  it('are o preferință explicabilă, cu plasă dacă modelul dispare', () => {
    expect(orouter).toMatch(/google\/gemma-4-31b[\s\S]{0,60}\?\?\s*lista\[0\]\?\.id \?\? null/)
  })
})

describe('comutarea se face DOAR pe tura cu imagine', () => {
  it('se declanșează la imagine lipită sau cadru de cameră', () => {
    expect(chat).toMatch(/if \(image \|\| camFrames\.length > 0\) \{/)
  })

  it('nu comută dacă modelul ales vede deja', () => {
    expect(chat).toMatch(/const vedeAcum = cat\?\.chat\.some\(\(m\) => m\.id === orchestratorModel\)/)
    expect(chat).toMatch(/if \(!vedeAcum\)/)
  })

  // Miezul: o tură FĂRĂ poză nu are voie să coboare pe un model mai mic.
  // Altfel am fi ciuntit tăcut creierul ownerului la fiecare mesaj — exact
  // ce interzice regula de fier §14 din AI-HANDOFF.
  it('turele fără imagine rămân pe creierul ales, fără excepție', () => {
    const bloc = /if \(image \|\| camFrames\.length > 0\) \{[\s\S]*?\n      \}/.exec(chat)?.[0] ?? ''
    expect(bloc).toContain('orchestratorModel = ochi')
    // Singura atribuire de model din bloc e cea de vedere.
    expect((bloc.match(/orchestratorModel = /g) ?? []).length).toBe(1)
  })

  it('înlocuirea se SPUNE în jurnal, nu se face pe ascuns', () => {
    expect(chat).toMatch(/nu vede → tura cu imagine merge pe/)
    expect(chat).toMatch(/n-am găsit niciun model cu vedere în catalog/)
  })
})
