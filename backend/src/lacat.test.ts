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
  // (3 aug — extirparea totală OpenRouter: treptele s-au mutat în config.brain;
  // searchModel a dispărut odată cu pluginul de căutare OpenRouter — căutarea
  // e Serper-only.)
  it('workDefault (creierul de LUCRU) e gratuit și e Gemini — regula lui Adrian', () => {
    const m = config.brain.workDefault
    expect(eGratuit(m)).toBe(true)
    expect(SEMNE_PLATIT.test(m)).toBe(false)
    // Regula EXPLICITĂ de Gemini pe care Adrian a dat-o și a explicat-o.
    expect(/gemini/i.test(m) || m.startsWith('google-direct/')).toBe(true)
  })

  it('chatDefault și topDefault rămân Gemini (nicio treaptă pe alt furnizor)', () => {
    expect(eGratuit(config.brain.chatDefault)).toBe(true)
    expect(SEMNE_PLATIT.test(config.brain.chatDefault)).toBe(false)
    expect(eGratuit(config.brain.topDefault)).toBe(true)
    expect(SEMNE_PLATIT.test(config.brain.topDefault)).toBe(false)
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

describe('LACĂT — constructor (Gemini-only, fără scară OpenRouter)', () => {
  // (Vechiul zid „REFUZ dacă nu e :free și nu e ALLOW_PAID" păzea scara de
  // modele OpenRouter — extirpată pe 3 aug cu tot cu furnizorul. Noul zid:
  // constructorul are UN singur creier, Gemini pe cheia ownerului, și nu mai
  // există nicio cale de rețea spre OpenRouter/OpenAI în agent.)
  it('agentul e Gemini-only: fără apeluri OpenRouter, fără scara plătită', () => {
    const s = sursa('../../deploy/constructor-agent.mjs')
    expect(/openrouter\.ai/.test(s)).toBe(false)
    expect(/OPENROUTER_API_KEY/.test(s)).toBe(false)
    expect(/anthropic\/claude-fable-5/.test(s)).toBe(false)
    expect(/function llmGemini/.test(s)).toBe(true)
    // Iar default-ul de model e Gemini.
    const def = /CONSTRUCTOR_GEMINI_MODEL\s*\|\|\s*'([^']+)'/.exec(s)
    expect(def, 'nu am găsit default-ul CONSTRUCTOR_GEMINI_MODEL').toBeTruthy()
    expect(/gemini/.test(def![1])).toBe(true)
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

describe('LACĂT — auz batch (chirp_3, regiunea eu) — streamingul STT a fost SCOS', () => {
  it('modelul STT batch rămâne cel mai avansat — chirp_3, în regiunea eu', () => {
    expect(GOOGLE_STT_MODEL).toBe('chirp_3')
    expect(GOOGLE_STT_REGION).toBe('eu')
  })

  it('dictarea batch /api/asr folosește CHIAR constanta, dintr-o sursă unică', () => {
    // VOCE UNIFICATĂ (5 aug): STT-ul STREAMING (asr-stream) a fost eliminat total
    // — vocea live merge la creierul unic ca AUDIO, nu prin transcript. Rămâne
    // DOAR dictarea batch /api/asr, care trimite CHIAR constanta chirp_3, nu un
    // model hardcodat — o singură sursă, nu poate drifta.
    const asr = sursa('./services/asr.ts')
    expect(/model:\s*GOOGLE_STT_MODEL/.test(asr)).toBe(true)
  })
})

describe('LACĂT — recepție → creier (vocea proprietarului ajunge la creier, DOAR a lui)', () => {
  const voce = sursa('../../frontend/src/lib/realtimeVoice.ts')
  const server = sursa('./routes/realtime.ts')

  it('CREIERUL UNIC decide adresarea din AUDIO — poarta de nume (regex) a fost scoasă de pe client', () => {
    // Adrian, 5 aug: „urechea o scoți total ca modelul are tot; tot decis de
    // creierul unic; dacă nu aude «Kelion»/«Kei», să nu vorbească neîntrebat."
    // Poarta de nume NU mai stă pe client, pe un transcript stâlcit — creierul
    // aude fraza brută (audio) și decide singur. Sigilat: dacă revine TREZIRE_RE
    // pe client, sau dispare poarta creierului, testul cade.
    expect(/TREZIRE_RE/.test(voce)).toBe(false)
    expect(/poartaDupaFraza/.test(voce)).toBe(true)
    const chat = sursa('./routes/chat.ts')
    expect(/voceAmbianta/.test(chat)).toBe(true)
    expect(chat.includes('<TAC/>')).toBe(true)
    expect(chat.includes('AMBIENT VOICE MODE')).toBe(true)
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

describe('LACĂT — Gemini-only: la eșec, mesaj ONEST, nu alt furnizor (3 aug)', () => {
  // (Vechiul lacăt „Gemini pică → rezerva nemotron :free" a MURIT odată cu
  // extirparea totală OpenRouter — ordinul repetat al ownerului: „openrouter
  // și open ai scos din toată aplicația". Noul zid: NU mai există NICIUN
  // fallback pe alt furnizor; tura reîncearcă pe Gemini și apoi se încheie
  // cinstit cu mesajul neutru.)
  const chat = sursa('./routes/chat.ts')

  it('la eșec de Gemini se reîncearcă pe ACELAȘI creier, apoi eroare onestă', () => {
    expect(chat.includes('MAX_INCERCARI_GEMINI')).toBe(true)
    expect(chat.includes('brain_gemini_exhausted')).toBe(true)
    expect(chat.includes('Încearcă din nou în câteva secunde.')).toBe(true)
  })

  it('marcaj [CHAT-IN]: se vede că tura a ajuns la /api/chat (recepția a mers)', () => {
    expect(chat.includes('[CHAT-IN]')).toBe(true)
  })

  it('nu mai există nicio cale spre OpenRouter în creierul chatului (3 aug seara, bate ordinul de dimineață)', () => {
    // Dimineața: „rezerva rapidă nemotron". Seara, cu mailurile „sold scăzut
    // $-0.20" în mână: „openrouter scos din toată aplicația" + „verifică cu
    // toți agenții că folosește doar gemini". Extirparea totală a dus fix-urile
    // intermediare (cursa doar-Gemini, rezervaDeschisa → false) până la capăt:
    // cursa, rotația și punga de rezervă NU MAI EXISTĂ în cod deloc.
    // (simboluri FUNCȚIONALE, nu mențiuni istorice din comentarii)
    expect(/openrouterChat|getCatalog|listaCandidati|rezervaRapida|rezervaDeschisa|primulCastigator/.test(chat)).toBe(false)
  })
})

describe('LACĂT — voce unificată: fraza pleacă DIRECT la creierul unic ca audio (5 aug)', () => {
  const panel = sursa('../../frontend/src/components/ChatPanel.tsx')
  const mic = sursa('../../frontend/src/lib/micStream.ts')

  it('onAddressed trimite fraza (audio) la aceeași send(), marcată voce ambientală', () => {
    // Fără unire de fraze (transcriptul a dispărut): fiecare frază pleacă direct
    // la creier ca audio; creierul decide adresarea. voceMergeRef a dispărut.
    expect(panel.includes('voceMergeRef')).toBe(false)
    expect(/onAddressed: \(_text, vf, speaker, audio\)[\s\S]{0,600}sendRef\.current\('', true\)/.test(panel)).toBe(true)
    // Tura vocală e marcată (isVoiceTurn) și dusă la creier ca voce ambientală.
    expect(/isVoiceTurn/.test(panel)).toBe(true)
    // Flagul voceAmbianta trece prin transportul unic de chat (lib/chat.ts).
    const feChat = sursa('../../frontend/src/lib/chat.ts')
    expect(/voceAmbianta/.test(feChat)).toBe(true)
  })

  it('microfonul e VAD LOCAL — fără WebSocket la STT, fără transcript de server', () => {
    // Sigilat: dacă cineva recablează asr-stream / un WebSocket STT în micStream,
    // sau readuce transcriptul în onPhrase, testul cade.
    expect(/asr-stream/.test(mic)).toBe(false)
    expect(/new WebSocket/.test(mic)).toBe(false)
    expect(/PAUZA_FRAZA_MS/.test(mic)).toBe(true)
    expect(/const closePhrase = \(\): void =>/.test(mic)).toBe(true)
    expect(/opts\.onPhrase\('', features, audio\)/.test(mic)).toBe(true)
  })

  it('nu mai există cale STT streaming pe backend (asr-stream a fost șters)', () => {
    // Sigilat: ruta streaming STT nu mai există; dacă reapare, testul cade.
    let existaStream = true
    try {
      sursa('./routes/asr-stream.ts')
    } catch {
      existaStream = false
    }
    expect(existaStream).toBe(false)
  })
})

describe('LACĂT — creier Pro + Extended Thinking (Adrian, 5 aug: „la creier adaugi Gemini Pro + Extended Thinking")', () => {
  it('creierul de bază e Gemini 3 Pro (modelul avansat), din config', () => {
    const s = sursa('./config.ts')
    expect(/gemini-3\.1-pro-preview/.test(s)).toBe(true)
    // Pe toate treptele creierului (chat/work/top), nu doar una.
    expect(config.brain.chatDefault).toContain('gemini-3.1-pro-preview')
    expect(config.brain.workDefault).toContain('gemini-3.1-pro-preview')
    expect(config.brain.topDefault).toContain('gemini-3.1-pro-preview')
  })

  it('Extended Thinking pe turele grele: reasoning «high» pe creierul direct → thinkingLevel «high»', () => {
    const chat = sursa('./routes/chat.ts')
    expect(/reasoning: heavyTurn \?[\s\S]{0,90}'high'/.test(chat)).toBe(true)
    const gd = sursa('./services/geminiDirect.ts')
    expect(/thinkingLevel:\s*opts\.reasoning === 'high' \? 'high'/.test(gd)).toBe(true)
    // Podeaua de output urcă pe gândirea extinsă, altfel răspunsul iese tăiat.
    expect(/podea3x = opts\.reasoning === 'high' \? 8192/.test(gd)).toBe(true)
  })
})
