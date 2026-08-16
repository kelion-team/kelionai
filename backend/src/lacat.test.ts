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

  it('modelul unic e SIGILAT în cod, FĂRĂ env — nimic nu-l poate schimba din env', () => {
    // 6 aug (regulă ultra-decisă): sursa unică e MODEL_UNIC_DEFAULT (în cod, nu env);
    // dacă cineva pune GEMINI_MODEL_GREU/BRAIN_*_MODEL pe VPS, NU mai contează.
    const s = sursa('./config.ts')
    const m = /MODEL_UNIC_DEFAULT = '([^']+)'/.exec(s)
    expect(m, 'nu am găsit MODEL_UNIC_DEFAULT în config.ts').toBeTruthy()
    const def = m![1]
    expect(SEMNE_PLATIT.test(def)).toBe(false)
    // 7 aug: slotul greu a plecat de pe Pro pe familia flash, PE MĂSURĂTOARE și cu
    // acordul explicit al ownerului (aceeași calitate — 20/20 amândouă — dar Pro
    // avea ture de 72-75 s față de 6,3 s). `-lite` rămâne INTERZIS aici: e slotul
    // de conversație, iar dacă ar intra și pe treapta grea s-ar prăbuși într-unul.
    expect(/^gemini-\d+(?:\.\d+)?-flash(?:-|$)/.test(def)).toBe(true)
    expect(/-lite(?:-|$)/.test(def)).toBe(false)
    expect(/process\.env\.(GEMINI_MODEL_GREU|BRAIN_CHAT_MODEL|BRAIN_WORK_MODEL|BRAIN_TOP_MODEL)/.test(s)).toBe(false)
  })
})

describe('LACĂT — MODEL UNIC BLOCAT (Adrian, 6 aug, regulă ultra-decisă: „modelul decis de mine să nu se poată modifica accidental sau de altcineva fără decizia mea")', () => {
  it('config: o SINGURĂ sursă (MODEL_UNIC_DEFAULT), familia flash, prin getteri, fără env', () => {
    const s = sursa('./config.ts')
    expect(/MODEL_UNIC_DEFAULT = 'gemini-\d/.test(s)).toBe(true)
    expect(/get geminiModel\(\): string/.test(s)).toBe(true)
    expect(/get chatDefault\(\): string/.test(s)).toBe(true)
    expect(/get workDefault\(\): string/.test(s)).toBe(true)
    expect(/get topDefault\(\): string/.test(s)).toBe(true)
    expect(/process\.env\.(GEMINI_MODEL_GREU|BRAIN_CHAT_MODEL|BRAIN_WORK_MODEL|BRAIN_TOP_MODEL)/.test(s)).toBe(false)
  })

  it('brainContract: fallback = modelul unic (niciodată 2.5/flash); resolveModel IGNORĂ „wanted"', () => {
    const s = sursa('./services/brainContract.ts')
    expect(/return modelUnicDirect\(\)/.test(s)).toBe(true)
    // niciun `return …gemini-2.5…` (fallback-ul vechi spre 2.5 a dispărut; comentariile pot menționa)
    expect(/return\b[^\n]*gemini-2\.5/.test(s)).toBe(false)
    // resolveModelChecked NU mai întoarce `wanted` ca model (era escape-ul din KV/UI).
    expect(/\{ model: wanted, fellBack: false \}/.test(s)).toBe(false)
  })

  it('brain.ts: scara de experți = un singur model, fără trepte din env', () => {
    const s = sursa('./services/brain.ts')
    expect(/process\.env\.BRAIN_EXPERT_FALLBACKS/.test(s)).toBe(false)
    expect(/return \[config\.brain\.workDefault\]/.test(s)).toBe(true)
  })

  it('ruta /api/models: PUT selection BLOCAT (423 model_locked) — UI nu poate schimba modelul', () => {
    const s = sursa('./routes/models.ts')
    expect(/model_locked/.test(s)).toBe(true)
    expect(/saveKv\(/.test(s)).toBe(false) // nu mai salvează nicio alegere de model
  })

  // Adrian, 7 aug: „pune condiție la orice auto upgrade să respecte toate aceste
  // condiții, clar cu dovadă" + „dacă nu se respectă tot să nu se facă upgrade,
  // doar când apare modelul corespunzător să treacă tot".
  it('auto-upgrade: DOAR mai nou, DOAR familia flash, DOAR cu TOATE probele trecute, CU dovadă', () => {
    const cfg = sursa('./config.ts')
    expect(/export function setModelUnicValidat/.test(cfg)).toBe(true)
    expect(cfg).toContain('-flash(?:-|$)') // poarta de familie a slotului greu
    expect(cfg).toContain('-lite(?:-|$)') // …și interdicția pe lite
    const up = sursa('./services/modelAutoUpgrade.ts')
    expect(/maiNou/.test(up)).toBe(true) // doar mai nou (nu retrogradează)
    expect(/probeazaModelComplet/.test(up)).toBe(true) // bateria COMPLETĂ, nu un smoke
    expect(/p\.scor !== p\.total/.test(up)).toBe(true) // un punct pierdut = nu se comută
    expect(/KV_DOVADA/.test(up)).toBe(true) // dovada se scrie, nu se declară
  })
})

describe('LACĂT — constructor: motor AIDER (unic), creier DOAR Gemini PRIN APP', () => {
  // Owner, 16 aug: „constructor unic aider… scoti tot din constructor si instalezi
  // doar aider… ramine doar gemini rapid si cu escaladarea spusa pe modelul
  // performant gemini… fable iese total de peste tot… nu se comuta nimic".
  // Zidul care rămâne (legea 13 aug): constructorul NU ține chei de furnizor și
  // NU cheamă DIRECT niciun API extern — Aider cere creierul DOAR pe ruta gardată
  // din app (openai, bridge-secret ca Bearer).
  it('agentul: fără OpenRouter, fără chei de furnizor, fără apel DIRECT (Google/Anthropic)', () => {
    const s = sursa('../../deploy/constructor-agent.mjs')
    expect(/openrouter\.ai/.test(s)).toBe(false)
    expect(/OPENROUTER_API_KEY/.test(s)).toBe(false)
    // Fără apel DIRECT la Google SAU Anthropic — n-are chei de furnizor în constructor.
    expect(/generativelanguage\.googleapis\.com/.test(s)).toBe(false)
    expect(/x-goog-api-key/.test(s)).toBe(false)
    expect(/api\.anthropic\.com/.test(s)).toBe(false)
    expect(/claude-fable-5/.test(s)).toBe(false)
    // Creierul propriu pe RunPod/DeepInfra a fost SCOS — nu mai citește chei din env.
    expect(/CONSTRUCTOR_RUNPOD_KEY|CONSTRUCTOR_DEEPSEEK_KEY/.test(s)).toBe(false)
  })

  it('motorul e AIDER, cu creierul PRIN APP pe ruta gardată (bridge-secret)', () => {
    const s = sursa('../../deploy/constructor-agent.mjs')
    // Aider e motorul unic; creierul lui vine prin app, nu ține el cheia.
    expect(/construiesteCuAider/.test(s)).toBe(true)
    expect(/\/api\/constructor\/openai/.test(s)).toBe(true)
    expect(/OPENAI_API_KEY: BRIDGE/.test(s)).toBe(true)
  })

  it('creierul din APP e DOAR Gemini (rapid → performant) — Fable SCOS total', () => {
    const ruta = sursa('./routes/constructor.ts')
    expect(/geminiDirectChat/.test(ruta)).toBe(true)
    expect(/modelPerformant = config\.geminiModelGreu/.test(ruta)).toBe(true)
    // Fable a ieșit TOTAL: nicio funcție Fable, niciun comutator.
    expect(/fable5Disponibil|fable5Chat/.test(ruta)).toBe(false)
    expect(/forta.?fable/i.test(ruta)).toBe(false)
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

  it('vocea pleacă DIRECT la creier — clientul nu mai etichetează timbrul, nimic n-o blochează', () => {
    // INTERMEDIARI SCOȘI (Adrian, 6 aug: „elimină intermediarii, îl pui direct pe
    // Kelion să primească; scoate orice urmă de limitare a audio, scoate-i și din
    // soft"). Clientul NU mai calculează `nevalidat`/`foreignVoice` pe voce și nu mai
    // face al doilea upload — fraza brută pleacă direct, creierul decide adresarea.
    // Gardul de admin din chat.ts (isAdmin && !nevalidat) rămâne (dormant pe voce);
    // card/bani rămân pe potrivirea reală holder, server-side.
    expect(/nevalidat/.test(voce)).toBe(false)
    expect(/foreignVoice/.test(voce)).toBe(false)
    expect(/ignorată complet/.test(voce)).toBe(false)
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
    // Fereastra de 600 de caractere a fost SCOASĂ (Adrian, 8 aug: „scoate
    // lacătul că e degeaba") — a picat de două ori în aceeași zi pe cod CORECT,
    // fiindcă un comentariu împingea apelul cu 8 caractere peste limită. Un gard
    // care măsoară distanțe de caractere nu păzește comportamentul, păzește
    // formatarea. Rămâne verificarea de comportament: handlerul există și fraza
    // pleacă prin aceeași send().
    expect(/onAddressed: \(_text, vf, speaker, audio\)/.test(panel)).toBe(true)
    expect(/sendRef\.current\('', true\)/.test(panel)).toBe(true)
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

describe('LACĂT — AEC half-duplex: microfonul tace cât Kelion vorbește (owner, 13 aug)', () => {
  // „aec e problema" — microfonul e deschis FĂRĂ echoCancellation (ca ieșirea să
  // prindă A2DP pe Bluetooth), deci propria voce a lui Kelion intra în microfon
  // și strica recunoașterea („varză"). Plasa: cât Kelion e audibil, se trimite
  // TĂCERE la creier. Dacă cineva scoate poarta asta (sau readuce echoCancellation
  // care rupe Bluetooth-ul), testul cade.
  const vl = sursa('../../frontend/src/lib/vocalLive.ts')

  it('există poarta half-duplex (kelionAudibil) legată de coada de redare', () => {
    expect(/kelionAudibil/.test(vl)).toBe(true)
    // predicatul se sprijină pe cursorRedare (ora până la care e programat sunetul)
    expect(/ctxOut\.currentTime < cursorRedare \+ COADA_ECOU_S/.test(vl)).toBe(true)
  })

  it('cadrul de microfon devine TĂCERE cât Kelion e audibil (array nou, nu mută captura)', () => {
    expect(/kelionAudibil\(\) \? new Float32Array\(ds\.length\) : ds/.test(vl)).toBe(true)
  })

  it('AEC pornit pe desktop, stins DOAR pe mobil (echoCancellation: !eMobil)', () => {
    // ISTORIA CONTRACTULUI: pe 11 aug s-a pinuit `false` peste tot (procesarea
    // WebRTC rupea A2DP pe Android, iar barge-in-ul serverului era OFF — prețul
    // ecoului părea zero). Pe 15 aug prețul a devenit real: VAD-ul sesiunii live
    // auzea ecoul și îi TĂIA vorba lui Kelion pe desktop (măsurat în consola
    // ownerului, ×3), iar ordinul lui verbatim: „am nevoie de un sistem care
    // anulează echo". Adevărul nou, ținut și de lacătul din verifica-gemini:
    // AEC pe desktop (modul-apel nu există acolo), brut pe mobil (A2DP trăiește),
    // și poarta half-duplex rămâne peste amândouă.
    expect(/echoCancellation:\s*!eMobil/.test(vl)).toBe(true)
    expect(/eMobil = \/Android\|iPhone\|iPad\|Mobile\/i\.test\(navigator\.userAgent\)/.test(vl)).toBe(true)
  })
})

describe('LACĂT — creier Pro + Extended Thinking (Adrian, 5 aug: „la creier adaugi Gemini Pro + Extended Thinking")', () => {
  // SCHIMBAT 7 AUG — DOUĂ SLOTURI, pe dovadă măsurată de owner pe cheia lui, de pe
  // VPS: chatul rula pe Pro și făcea 3.622 ms … 45.026 ms (a și EXPIRAT) la o
  // întrebare banală, în timp ce `gemini-3.5-flash-lite` face 508–713 ms cu unelte
  // + vedere + auz intacte. Întrebarea ownerului („18 secunde să-mi spună cât e
  // ceasul?") a pornit studiul; măsurătoarea i-a dat dreptate.
  // Lacătul NU s-a slăbit: gândirea GREA (work/top) rămâne bătută în cuie pe Pro,
  // iar conversația e bătută în cuie pe familia flash. Ce se păzește acum e
  // împerecherea corectă — nu se poate strecura Pro pe chat (lent), nici flash pe
  // work/top (prost la gândire grea).
  // 7 aug — DOUĂ SLOTURI, AMÂNDOUĂ DIN FAMILIA FLASH, dar DISJUNCTE:
  // conversația pe `flash-lite`, gândirea grea pe `flash` fără lite. Pro a ieșit
  // de pe treapta grea pe măsurătoare (proba de 10 sarcini cu verificare automată:
  // flash 20/20 la fel ca Pro, dar Pro cu ture de 72-75 s față de 6,3 s).
  it('două sloturi sigilate și DISJUNCTE: conversația pe flash-lite, gândirea grea pe flash', () => {
    const s = sursa('./config.ts')
    expect(/MODEL_UNIC_DEFAULT = 'gemini-[\d.]+-flash'/.test(s)).toBe(true)
    expect(/MODEL_RAPID_DEFAULT = 'gemini-[\d.]+-flash-lite'/.test(s)).toBe(true)
    // CHAT = lite. NICIODATĂ Pro (de-acolo venea lentoarea).
    expect(config.brain.chatDefault).toMatch(/flash-lite/)
    expect(config.brain.chatDefault).not.toMatch(/pro/i)
    // GREUL = flash, dar NU lite — altfel cele două trepte ar fi una singură.
    expect(config.brain.workDefault).toMatch(/flash/)
    expect(config.brain.workDefault).not.toMatch(/-lite/)
    expect(config.brain.topDefault).toMatch(/flash/)
    expect(config.brain.topDefault).not.toMatch(/-lite/)
    // Și, explicit: cele două trepte NU pot ajunge pe același model.
    expect(config.brain.chatDefault).not.toBe(config.brain.workDefault)
  })

  it('poarta fiecărui slot acceptă DOAR familia lui (un upgrade nu poate încrucișa sloturile)', () => {
    const cfg = sursa('./config.ts')
    // Slotul greu: flash, dar refuză lite. Slotul rapid: DOAR lite (strâns 7 aug —
    // de când greul e flash, o poartă largă aici ar fi lăsat ambele sloturi pe
    // același model, adică o singură treaptă deghizată în două).
    expect(cfg).toContain('-flash(?:-|$)')
    expect(cfg).toContain('-lite(?:-|$)')
    expect(/setModelRapidValidat/.test(cfg)).toBe(true)
    expect(cfg).toContain('-flash-lite(?:-|$)')
  })

  it('escaladarea rămâne cablată (ask_brain pe faza de vorbire, cu deschiderea inventarului)', () => {
    // Supapa, RESCRISĂ pe ordinul ownerului din 8 aug („nu știe să escaladeze
    // să ceară acces la unelte… dacă nu are acces intră în blocaj"): cu modelul
    // unic, „spre Pro" nu mai însemna nimic — escaladarea reală e ACCESUL LA
    // UNELTE. Ușa se oferă pe faza de vorbire (inclusiv turele vocale) și
    // comută lista turei pe inventarul plin. Fără ea, faza ușoară ar fi o cușcă.
    const chat = sursa('./routes/chat.ts')
    expect(/escalationTools = incarcatura\.faza === 'vorbire' \? \[ASK_BRAIN_TOOL\] : \[\]/.test(chat)).toBe(true)
    expect(chat.includes('tools.push(...uneltePline)')).toBe(true)
    const brain = sursa('./services/brain.ts')
    expect(/return \[config\.brain\.workDefault\]/.test(brain)).toBe(true)
  })

  it('Extended Thinking pe turele grele: reasoning «high» pe creierul direct → thinkingLevel «high»', () => {
    const chat = sursa('./routes/chat.ts')
    expect(/reasoning: heavyTurn \?[\s\S]{0,400}'high'/.test(chat) || /reasoning:[\s\S]{0,400}'high'/.test(chat)).toBe(true)
    const gd = sursa('./services/geminiDirect.ts')
    expect(/thinkingLevel:\s*opts\.reasoning === 'high' \? 'high'/.test(gd)).toBe(true)
    // Podeaua de output urcă pe gândirea extinsă, altfel răspunsul iese tăiat.
    expect(/podea3x = opts\.reasoning === 'high' \? 8192/.test(gd)).toBe(true)
  })
})
