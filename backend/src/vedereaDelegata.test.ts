import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { groupCatalog } from './services/openrouter.js'

// ── WHO DOES THE SEEING, WHEN THE BRAIN IS BLIND ────────────────────────────
//
// Adrian, Jul 31, after choosing the brain: "Nemotron 3 Ultra 550B stays, who
// does the seeing?"
//
// The question was exact. Ultra is the most capable free brain measured — 550
// billion parameters, a million of context, tools, thinking — and it is BLIND.
// And `groupCatalog` filtered BOTH lists on `m.vision`, so a single model had
// to do both the thinking and the seeing. Ultra could NEVER appear in the
// list. That's why he kept looking for it and couldn't find it.
//
// The fix is not "remove the filter". It's that **vision gets delegated**: the
// turn WITH A PICTURE goes to a model that sees, the rest stay with the chosen
// brain. Two trades, two specialists — the same idea as Aider (one thinks, the
// other writes).
//
// His rule from Jul 29 ("only AI that respects ALL the app's features is
// shown") stays whole, at the level where it mattered: the feature belongs to
// the APP, not to a single model.
const chat = readFileSync(fileURLToPath(new URL('./routes/chat.ts', import.meta.url)), 'utf8')
const orouter = readFileSync(fileURLToPath(new URL('./services/openrouter.ts', import.meta.url)), 'utf8')

// A sample catalog, with the real shape of those measured on Jul 31.
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
    // There is no vision escalation there, so a blind model really would break
    // a turn with a picture. The filter stays exactly where it is still needed.
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
  // Adrian, Jul 31: "both voice and vision — route them through the brain".
  //
  // The first variant moved the WHOLE picture turn to the model that sees.
  // Meaning at every picture, the 550B brain was BYPASSED, and a 26B carried
  // the turn — the eyes ended up also deciding. Now the eyes DESCRIBE, the
  // brain DECIDES.
  it('se declanșează DOAR când chiar e o imagine atașată (turnHasImage), nu pe orice cadru de cameră', () => {
    // Adrian, 3 aug (latența „ULTRA enorm"): înainte poarta era
    // `image || camFrames.length > 0` → rula ~11s degeaba pe FIECARE tură cu
    // camera pornită. Acum e `turnHasImage` — adevărat doar la poză atașată sau
    // cameră + intenție vizuală.
    expect(chat).toMatch(/if \(turnHasImage\) \{/)
    expect(chat).not.toMatch(/if \(image \|\| camFrames\.length > 0\) \{/)
  })

  it('nu face nimic dacă modelul ales vede deja — iar Gemini direct VEDE NATIV', () => {
    // Agenții de debug, 3 aug (2 independent): `google-direct/…` nu e în
    // catalogul OpenRouter, deci vechiul test de catalog îl declara ORB pe
    // fiecare tură → poza era descrisă de un model străin în loc să ajungă
    // nativ la creier (toGeminiPayload: image_url data-URI → inline_data).
    // Regula pinată: creierul Gemini e văzător ca un șoim, fără ocol.
    expect(chat).toMatch(/orchestratorModel\.startsWith\(GEMINI_DIRECT_PREFIX\) \|\|/)
    expect(chat).toMatch(/cat\?\.chat\.some\(\(m\) => m\.id === orchestratorModel && m\.vision !== false\)/)
    expect(chat).toMatch(/if \(!vedeAcum\)/)
  })

  // THE CORE: the brain NEVER changes for a picture. If someone puts a model
  // assignment back into this block, image turns start bypassing the chosen
  // brain again — the regression this test repairs.
  it('creierul rămâne același — nicio atribuire de model în blocul de vedere', () => {
    const bloc = /if \(turnHasImage\) \{[\s\S]*?\r?\n      \}\r?\n/.exec(chat)?.[0] ?? ''
    expect(bloc.length).toBeGreaterThan(200)
    expect(bloc).not.toMatch(/orchestratorModel\s*=[^=]/)
  })

  it('ochii descriu, iar descrierea intră în conversație ca text', () => {
    expect(chat).toMatch(/await describeScene\(poza/)
    expect(chat).toMatch(/VEDEREA TA — te-ai uitat chiar acum/)
  })

  it('imaginile se scot din ce ajunge la creierul orb', () => {
    // A model without vision either ignores them or chokes on them. The description takes their place.
    expect(chat).toMatch(/\.filter\(\(p\) => p\.type === 'text'\)/)
  })

  // Rule 1: a failed reading is not hidden. If the description fails, the
  // brain must KNOW there is an image it didn't see — otherwise it could
  // answer about it from imagination.
  it('descrierea eșuată se declară creierului, nu se trece sub tăcere', () => {
    expect(chat).toMatch(/VEDEREA TA a eșuat/)
    expect(chat).toMatch(/nu inventa ce e în ea/)
  })

  it('costul descrierii intră în socoteala turei', () => {
    expect(chat).toMatch(/describeScene\([\s\S]{0,60}usage\.usd \+= usd/)
  })
})

describe('vocea: ACELAȘI creier ca scrisul, prin aceeași poartă (Aug 1)', () => {
  // Adrian, Aug 1: "rewrite the whole chat procedure... let the BRAIN use the
  // model's voice and functions; there must not be two separate entities".
  //
  // THE OLD BOUNDARY IS GONE: voice no longer picks ANY model (no fast brain,
  // no heavy brain, no ask_brain). The voice session is ears+mouth; the spoken
  // turn enters POST /api/chat with `spoken:true` and climbs the SAME ladder
  // as writing — which STARTS on the fast chat tier, so the sub-second voice
  // budget is protected by the same economy that protects the wallet.
  const voce = readFileSync(fileURLToPath(new URL('./routes/realtime.ts', import.meta.url)), 'utf8')

  it('vocea NU mai alege niciun model — nici rapid, nici greu, nici plătit', () => {
    expect(voce).not.toContain('bestPaidWorkModel')
    expect(voce).not.toContain('resolveModel')
    expect(voce).not.toContain('geminiDirect')
    expect(voce).not.toContain('runOrchestrator')
  })

  it('turnul vorbit intră pe poarta scrisului: flag `spoken` + aceeași scară', () => {
    expect(chat).toMatch(/spoken\?: boolean/)
    expect(chat).toMatch(/req\.body\?\.spoken === true/)
    // The ladder stays where it always was — the voice inherits it, unchanged.
    expect(chat).toMatch(/ownerModel = await resolveModel\('work', null\)/)
  })

  it('nici scrisul nu mai rutează ownerul pe plătit fără să ceară el', () => {
    expect(chat).not.toContain('bestPaidWorkModel')
  })
})
