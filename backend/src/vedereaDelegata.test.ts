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

describe('vederea trece PRIN creier, nu în locul lui', () => {
  // Adrian, 31 iul: „și vocea și vederea rutează-le prin creier".
  //
  // Prima variantă muta TOATĂ tura cu poză pe modelul care vede. Adică la
  // fiecare poză, creierul de 550B era OCOLIT, iar tura o ducea unul de 26B —
  // ochii ajungeau să și decidă. Acum ochii DESCRIU, creierul DECIDE.
  it('se declanșează la imagine lipită sau cadru de cameră', () => {
    expect(chat).toMatch(/if \(image \|\| camFrames\.length > 0\) \{/)
  })

  it('nu face nimic dacă modelul ales vede deja', () => {
    expect(chat).toMatch(/const vedeAcum = cat\?\.chat\.some\(\(m\) => m\.id === orchestratorModel\)/)
    expect(chat).toMatch(/if \(!vedeAcum\)/)
  })

  // MIEZUL: creierul nu se schimbă NICIODATĂ pentru o poză. Dacă cineva pune
  // înapoi o atribuire de model în blocul ăsta, turele cu imagine încep iar să
  // ocolească creierul ales — regresia pe care o repară testul.
  it('creierul rămâne același — nicio atribuire de model în blocul de vedere', () => {
    const bloc = /if \(image \|\| camFrames\.length > 0\) \{[\s\S]*?\n      \}\n/.exec(chat)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(200)
    expect(bloc).not.toMatch(/orchestratorModel\s*=[^=]/)
  })

  it('ochii descriu, iar descrierea intră în conversație ca text', () => {
    expect(chat).toMatch(/await describeScene\(poza/)
    expect(chat).toMatch(/VEDEREA TA — te-ai uitat chiar acum/)
  })

  it('imaginile se scot din ce ajunge la creierul orb', () => {
    // Un model fără vedere ori le ignoră, ori pică pe ele. Descrierea le ia locul.
    expect(chat).toMatch(/\.filter\(\(p\) => p\.type === 'text'\)/)
  })

  // Regula 1: o citire eșuată nu se ascunde. Dacă descrierea pică, creierul
  // trebuie să ȘTIE că există o imagine pe care n-a văzut-o — altfel ar putea
  // răspunde despre ea din imaginație.
  it('descrierea eșuată se declară creierului, nu se trece sub tăcere', () => {
    expect(chat).toMatch(/VEDEREA TA a eșuat/)
    expect(chat).toMatch(/nu inventa ce e în ea/)
  })

  it('costul descrierii intră în socoteala turei', () => {
    expect(chat).toMatch(/describeScene\([\s\S]{0,60}usage\.usd \+= usd/)
  })
})

describe('vocea folosește ACELAȘI creier ca scrisul', () => {
  // Adrian: „și vocea... rutează-le prin creier". Vocea chema
  // `bestPaidWorkModel()` pentru owner — deci scrisul mergea pe creierul ales
  // de el, iar vocea pe un model plătit. Două creiere pe același om, adică fix
  // ce rezolvase §6 „creier unic", stricat din altă parte.
  const voce = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')

  it('vocea nu mai alege singură un model plătit pentru owner', () => {
    expect(voce).not.toContain('bestPaidWorkModel')
    expect(voce).toMatch(/const ownerModel = isAdmin \? await resolveModel\('work'\) : null/)
  })

  it('nici scrisul nu mai rutează ownerul pe plătit fără să ceară el', () => {
    expect(chat).not.toContain('bestPaidWorkModel')
    expect(chat).toMatch(/ownerModel = await resolveModel\('work', null\)/)
  })
})
