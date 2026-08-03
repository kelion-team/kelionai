import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Same env priming as config.test.ts, so importing config never throws here.
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'test-uri')
vi.stubEnv('SESSION_SECRET', 'test-session-secret')

import { config } from './config.js'
import { resolveChirpStyle, MALE_CHIRP_DEFAULT } from './services/tts.js'
import { GOOGLE_STT_MODEL, GOOGLE_STT_REGION } from './services/asr.js'

// ─────────────────────────────────────────────────────────────────────────────
// LACĂTUL — „bătute în cuie" (Adrian, 3 aug: „până astea nu sunt bătute în cuie
// și elimini distrugerea lor următoare, nu mai fac nimic… ești ca în povestea
// lui Manole de 7 luni"). Problema celor 7 luni: ce mergea (creierul Gemini,
// vocea masculină, auzul chirp_3, refuzul plăților la constructor) se DISTRUGEA
// la următorul update și nimic nu prindea regresia. Testul ăsta e cuiul: dacă
// cineva/ceva schimbă vreuna din valorile de mai jos, testul CADE, iar pr-verify
// (care rulează vitest) face PR-ul ROȘU → nu se poate face merge → nu se poate
// distruge. Nu e o recomandare; e un zid.
//
// Fiecare rând de mai jos are lângă el DE CE există regula — exact ca să nu fie
// „relaxată" din neînțelegere de o sesiune viitoare.
// ─────────────────────────────────────────────────────────────────────────────

// Semnătura unui model PLĂTIT care a ars bani în trecut (fable-5, claude, gpt,
// vendorii plătiți). Un default de creier NU are voie să conțină așa ceva.
const SEMNE_PLATIT = /fable|claude|anthropic\/|openai\/|gpt-|(?:^|\/)o[13](?:-|$)/i
// Un creier ACCEPTAT e gratuit: fie se termină în `:free`, fie e pe calea
// directă Gemini (`google-direct/…`), care e gratuită prin cheia Google.
const eGratuit = (m: string) => /:free$/.test(m) || m.startsWith('google-direct/')

function sursa(rel: string): string {
  return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
}

describe('LACĂT — creier (regula Gemini, fără plătit din greșeală)', () => {
  it('workDefault (creierul de LUCRU) e gratuit și e Gemini — regula lui Adrian', () => {
    const m = config.openrouter.workDefault
    expect(eGratuit(m)).toBe(true)
    expect(SEMNE_PLATIT.test(m)).toBe(false)
    // Regula EXPLICITĂ de Gemini pe care Adrian a dat-o și a explicat-o.
    expect(/gemini/i.test(m) || m.startsWith('google-direct/')).toBe(true)
  })

  it('topDefault și searchModel rămân gratuite (nicio treaptă de escaladare plătită)', () => {
    expect(eGratuit(config.openrouter.topDefault)).toBe(true)
    expect(SEMNE_PLATIT.test(config.openrouter.topDefault)).toBe(false)
    expect(eGratuit(config.openrouter.searchModel)).toBe(true)
    expect(SEMNE_PLATIT.test(config.openrouter.searchModel)).toBe(false)
  })

  it('DEFAULT-ul din COD (nu din env) e Gemini free — dacă env se golește, nu revine la plătit', () => {
    // Lacătul adevărat e în cod: chiar dacă un env de pe server ar suprascrie
    // valoarea la runtime, sursa TREBUIE să aibă un default sigur (free/Gemini).
    const s = sursa('./config.ts')
    const m = /workDefault:\s*\(process\.env\.\w+\s*\?\?\s*'([^']+)'/.exec(s)
    expect(m, 'nu am găsit default-ul workDefault în config.ts').toBeTruthy()
    const def = m![1]
    expect(eGratuit(def)).toBe(true)
    expect(SEMNE_PLATIT.test(def)).toBe(false)
  })
})

describe('LACĂT — constructor (refuz structural de model plătit)', () => {
  it('garda „REFUZ dacă nu e :free și nu e ALLOW_PAID" e prezentă în cod', () => {
    const s = sursa('../../deploy/constructor-agent.mjs')
    // Cele trei piese ale gardei — dacă vreuna dispare, arderea de bani redevine
    // posibilă din greșeală, exact incidentul din 27 iul.
    expect(/endsWith\(':free'\)/.test(s)).toBe(true)
    expect(/CONSTRUCTOR_ALLOW_PAID/.test(s)).toBe(true)
    expect(/process\.exit\(0\)/.test(s)).toBe(true)
    // Iar default-ul de pornire e el însuși gratuit.
    const def = /CONSTRUCTOR_MODEL\s*\|\|\s*'([^']+)'/.exec(s)
    expect(def, 'nu am găsit default-ul CONSTRUCTOR_MODEL').toBeTruthy()
    expect(/:free$/.test(def![1])).toBe(true)
  })
})

describe('LACĂT — voce (masculină în orice limbă)', () => {
  it('vocea implicită e Charon (masculină)', () => {
    expect(MALE_CHIRP_DEFAULT).toBe('Charon')
  })

  it('orice stil FEMININ este rescris la Charon', () => {
    for (const feminin of ['Zephyr', 'Kore', 'Aoede', 'Leda', 'Autonoe']) {
      expect(resolveChirpStyle(feminin)).toBe('Charon')
    }
  })

  it('stil necunoscut, gol sau invalid → Charon (nu rămâne mut, nu devine feminin)', () => {
    for (const rau of ['', '   ', 'xyz', '123', null, undefined]) {
      expect(resolveChirpStyle(rau)).toBe('Charon')
    }
  })

  it('un nume COMPLET de voce păstrează doar stilul, iar Charon rămâne Charon', () => {
    expect(resolveChirpStyle('ro-RO-Chirp3-HD-Charon')).toBe('Charon')
    expect(resolveChirpStyle('en-US-Chirp3-HD-Charon')).toBe('Charon')
    // Un nume complet cu stil FEMININ tot devine masculin.
    expect(resolveChirpStyle('ro-RO-Chirp3-HD-Kore')).toBe('Charon')
  })
})

describe('LACĂT — auz (chirp_3 peste tot, regiunea eu)', () => {
  it('modelul STT rămâne cel mai avansat — chirp_3, în regiunea eu', () => {
    expect(GOOGLE_STT_MODEL).toBe('chirp_3')
    expect(GOOGLE_STT_REGION).toBe('eu')
  })

  it('calea streaming/full-duplex folosește ACEEAȘI sursă unică — nu poate drifta', () => {
    // Adrian, 3 aug: „sistemul de auzit sper să nu se mai schimbe niciodată".
    // asr-stream.ts (streaming) importă modelul/regiunea din asr.ts — nu are
    // copie locală care să dea alt model pe tăcute.
    const stream = sursa('./routes/asr-stream.ts')
    expect(/GOOGLE_STT_MODEL/.test(stream)).toBe(true)
    expect(/GOOGLE_STT_REGION/.test(stream)).toBe(true)
    expect(/from '\.\.\/services\/asr\.js'/.test(stream)).toBe(true)
    // Iar cererea către Google trimite CHIAR constanta, nu un model hardcodat.
    const asr = sursa('./services/asr.ts')
    expect(/model:\s*GOOGLE_STT_MODEL/.test(asr)).toBe(true)
  })
})

describe('LACĂT — recepție → creier (vocea proprietarului ajunge la creier, DOAR a lui)', () => {
  const voce = sursa('../../frontend/src/lib/realtimeVoice.ts')
  const server = sursa('./routes/realtime.ts')

  it('vocea PROPRIETARULUI verificat ajunge la creier fără „Kelion" de fiecare dată', () => {
    // Adrian, 3 aug: „vocea actuală la creier fără să eșueze". Poarta lasă vocea
    // la creier pe semnalul POZITIV `holder` (proprietar verificat), nu doar pe nume.
    expect(/verdict\?\.holder === true/.test(voce)).toBe(true)
    expect(/if \(named \|\| answering \|\| holder\)/.test(voce)).toBe(true)
  })

  it('serverul dă semnalul POZITIV doar când e chiar proprietarul contului', () => {
    // holder = există referință ȘI se potrivește (isHolder). Admin în admin,
    // fiecare user în contul lui — verdictul se calculează pe user.email al sesiunii.
    expect(/holder = hasRef && isHolder/.test(server)).toBe(true)
  })

  it('SIGURANȚA rămâne: vocea străină (TV/necunoscuți) NU ajunge la creier', () => {
    // Cerința obligatorie: doar vocea user/admin. Poarta de amprentă care aruncă
    // vocea străină trebuie să rămână — dacă dispare, testul cade.
    expect(/if \(verdict\?\.foreignVoice && !guest\)/.test(voce)).toBe(true)
  })
})
