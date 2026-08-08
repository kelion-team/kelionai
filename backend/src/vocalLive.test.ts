import { describe, it, expect, vi } from 'vitest'

// Env priming ca importul config să nu arunce (ca în celelalte teste).
vi.stubEnv('GOOGLE_CLIENT_ID', 'test-id')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'test-secret')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'test-uri')
vi.stubEnv('SESSION_SECRET', 'test-session-secret')

import { construiesteSetup, interpreteazaCadru } from './services/vocalLive.js'

// ── VOCEA UNIFICATĂ (Gemini Live) — părțile PURE, probate fără rețea ──────────
// construiesteSetup e contractul cu Google (model/voce/modalitate/unelte);
// interpreteazaCadru traduce cadrele serverului. Ambele decid dacă vocea merge,
// deci le țin sub test.

describe('vocalLive — construiesteSetup', () => {
  it('cere AUDIO + voce masculină + transcriere pe ambele sensuri', () => {
    const s = construiesteSetup('model-x', 'Charon', 'Ești Kelion.', []) as {
      setup: {
        model: string
        generationConfig: { responseModalities: string[]; speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: string } } } }
        inputAudioTranscription: unknown
        outputAudioTranscription: unknown
        systemInstruction: { parts: { text: string }[] }
      }
    }
    expect(s.setup.model).toBe('models/model-x')
    expect(s.setup.generationConfig.responseModalities).toEqual(['AUDIO'])
    expect(s.setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName).toBe('Charon')
    expect(s.setup.inputAudioTranscription).toBeDefined()
    expect(s.setup.outputAudioTranscription).toBeDefined()
    expect(s.setup.systemInstruction.parts[0].text).toBe('Ești Kelion.')
  })

  it('fără unelte NU trimite câmpul tools; cu unelte îl trimite', () => {
    const gol = construiesteSetup('m', 'Puck', 'x', []) as { setup: Record<string, unknown> }
    expect(gol.setup.tools).toBeUndefined()
    const cu = construiesteSetup('m', 'Puck', 'x', [
      { name: 'cauta', description: 'caută', parameters: { type: 'object', properties: {} } },
    ]) as { setup: { tools: { functionDeclarations: { name: string }[] }[] } }
    expect(cu.setup.tools[0].functionDeclarations[0].name).toBe('cauta')
  })
})

describe('vocalLive — interpreteazaCadru', () => {
  it('setupComplete → eveniment gata', () => {
    expect(interpreteazaCadru({ setupComplete: {} })).toEqual([{ fel: 'gata' }])
  })

  it('audio de ieșire din modelTurn', () => {
    const ev = interpreteazaCadru({
      serverContent: { modelTurn: { parts: [{ inlineData: { data: 'AAA', mimeType: 'audio/pcm' } }] } },
    })
    expect(ev).toContainEqual({ fel: 'audio', data: 'AAA' })
  })

  it('transcrierea userului și a lui Kelion, cu final pe turnComplete', () => {
    const ev = interpreteazaCadru({
      serverContent: { inputTranscription: { text: 'salut' }, outputTranscription: { text: 'bună' }, turnComplete: true },
    })
    expect(ev).toContainEqual({ fel: 'user', text: 'salut', final: true })
    expect(ev).toContainEqual({ fel: 'kelion', text: 'bună', final: true })
    expect(ev).toContainEqual({ fel: 'turaGata' })
  })

  it('barge-in (interrupted) → eveniment intrerupt', () => {
    const ev = interpreteazaCadru({ serverContent: { interrupted: true } })
    expect(ev).toContainEqual({ fel: 'intrerupt' })
  })

  it('apel de unealtă din toolCall', () => {
    const ev = interpreteazaCadru({ toolCall: { functionCalls: [{ id: '7', name: 'cauta', args: { q: 'x' } }] } })
    expect(ev).toContainEqual({ fel: 'unealta', id: '7', name: 'cauta', args: { q: 'x' } })
  })

  it('cadru necunoscut → nicio eroare, listă goală', () => {
    expect(interpreteazaCadru({ ceva: 'altceva' })).toEqual([])
  })
})

// ── MEMORIA SESIUNII LIVE (8 aug, „execută cu Gemini") ──────────────────────
// Sesiunea Live pornește de la zero la fiecare deschidere — fără instrucțiunea
// care cară istoricul, Kelion ar fi un străin politicos la fiecare apăsare de
// microfon. Funcția e pură, deci se probează aici, nu se ia pe încredere.
import { construiesteInstructiune } from './services/vocalLive.js'

describe('vocalLive — instrucțiunea cară memoria omului', () => {
  const persona = 'Ești Kelion.'

  it('fără istoric: persona + numele, fără bloc de context inventat', () => {
    const i = construiesteInstructiune(persona, 'Adrian', [])
    expect(i).toContain('Ești Kelion.')
    expect(i).toContain('Adrian')
    expect(i, 'fără istoric nu există „ultimele schimburi" — nu se inventează').not.toContain('ULTIMELE')
  })

  it('regula limbii e în instrucțiune: orice limbă, oglindirea vorbitorului (Adrian, 8 aug)', () => {
    // Măsurat înainte de regulă: instrucțiunea nu spunea NIMIC despre limbă și
    // configul nu trimite languageCode — modelul rămânea pe limba ghicită.
    const i = construiesteInstructiune(persona, 'Adrian', [])
    expect(i).toContain('REGULA LIMBII')
    expect(i).toContain('limba ULTIMEI fraze')
    expect(i, 'nu se pinuiește niciun cod de limbă — aia ar fi cușca inversă').not.toMatch(/languageCode/)
  })

  it('cu istoric: ultimele schimburi intră, cu numele omului pe replicile lui', () => {
    const i = construiesteInstructiune(persona, 'Adrian', [
      { role: 'user', content: 'cât e ceasul?' },
      { role: 'assistant', content: 'E ora trei.' },
    ])
    expect(i).toContain('ULTIMELE VOASTRE SCHIMBURI')
    expect(i).toContain('Adrian: cât e ceasul?')
    expect(i).toContain('Kelion: E ora trei.')
  })

  it('istoricul lung se taie: ultimele 12 schimburi, replici de max 200, bloc de max 2400', () => {
    const lung = Array.from({ length: 40 }, (_, k) => ({ role: 'user', content: `mesajul ${k} ${'x'.repeat(500)}` }))
    const i = construiesteInstructiune(persona, 'Adrian', lung)
    expect(i, 'mesajul 27 e al 13-lea de la coadă — nu are ce căuta').not.toContain('mesajul 27 ')
    expect(i).toContain('mesajul 39 ')
    // Bugetul fix: numele + REGULA LIMBII (~390) + REGULA TĂCERII + ANCORA
    // REALITĂȚII (8 aug seara, ~450 împreună — antet FIX, scris o dată, nu
    // crește cu istoricul) + antetul blocului de istoric + blocul plafonat la
    // 2400. Plafonul pe ISTORIC rămâne neatins — bugetul total s-a ridicat
    // conștient doar cât să încapă cele două reguli noi ordonate de owner.
    expect(i.length, 'un istoric nelimitat ar umfla setup-ul sesiunii ca vechiul prompt de 15.000 de tokeni').toBeLessThan(
      persona.length + 3700,
    )
  })
})

// ── SESIUNEA SUPRAVIEȚUIEȘTE LIMITEI GOOGLE (8 aug: „a funcționat 5 minute
// impecabil, după care a amuțit") ───────────────────────────────────────────
describe('vocalLive — reluarea sesiunii la limita de durată', () => {
  it('setup-ul CERE reluarea; la reconectare poartă handle-ul primit', () => {
    const proaspat = construiesteSetup('m', 'Charon', 'p', []) as { setup: Record<string, unknown> }
    expect(proaspat.setup.sessionResumption, 'fără cerere, Google nu dă handle și sesiunea moare sec la limită').toEqual({})
    const reluat = construiesteSetup('m', 'Charon', 'p', [], 'handle-123') as { setup: Record<string, unknown> }
    expect(reluat.setup.sessionResumption).toEqual({ handle: 'handle-123' })
  })

  it('„no limit": fereastra glisantă e cerută — contextul plin nu mai omoară sesiunea', () => {
    const st = construiesteSetup('m', 'Charon', 'p', []) as { setup: Record<string, unknown> }
    expect(st.setup.contextWindowCompression, 'fără compresie, sesiunea moare când conversația se lungește').toEqual({
      slidingWindow: {},
    })
  })

  it('handle-ul de reluare se citește din cadru (doar când e resumable)', () => {
    const ev = interpreteazaCadru({ sessionResumptionUpdate: { resumable: true, newHandle: 'h9' } })
    expect(ev).toContainEqual({ fel: 'handleReluare', handle: 'h9' })
    // ne-resumabil = nu avem cu ce relua — nu inventăm un handle
    expect(interpreteazaCadru({ sessionResumptionUpdate: { resumable: false, newHandle: 'h9' } })).toEqual([])
  })

  it('preavizul de închidere (goAway) se citește, cu timpul rămas în ms', () => {
    const ev = interpreteazaCadru({ goAway: { timeLeft: '12.5s' } })
    expect(ev).toContainEqual({ fel: 'preavizInchidere', msRamase: 12500 })
    // goAway fără timp rămâne preaviz — redeschidem oricum
    expect(interpreteazaCadru({ goAway: {} })).toContainEqual({ fel: 'preavizInchidere', msRamase: undefined })
  })
})

// ── COSTUL SESIUNII LIVE (8 aug: „creditul se consumă cu viteza luminii") ────
// Ruta vocii live nu scria NIMIC în cost_events — pastila scădea orbește pe
// lângă voce. Estimarea e pură și se probează aici pe cifre de mână.
import { estimareCostAudioUsd, octetiDinBase64 } from './services/vocalLive.js'

describe('vocalLive — costul sesiunii, din octeții retransmiși', () => {
  it('un minut de microfon (PCM16 16kHz) costă exact tariful de intrare', () => {
    // 60s × 16000 mostre/s × 2 octeți = 1.920.000 octeți → $0.005
    expect(estimareCostAudioUsd(60 * 16_000 * 2, 0)).toBeCloseTo(0.005, 10)
  })

  it('un minut de glas (PCM16 24kHz) costă exact tariful de ieșire', () => {
    // 60s × 24000 mostre/s × 2 octeți = 2.880.000 octeți → $0.018
    expect(estimareCostAudioUsd(0, 60 * 24_000 * 2)).toBeCloseTo(0.018, 10)
  })

  it('zero octeți = zero dolari — nu se inventează un cost pe sesiune goală', () => {
    expect(estimareCostAudioUsd(0, 0)).toBe(0)
  })

  it('octeții din base64 se socotesc fără decodare, cu umplutura scăzută', () => {
    // 'abc' → 'YWJj' (4 caractere, fără =) → 3 octeți
    expect(octetiDinBase64(Buffer.from('abc').toString('base64'))).toBe(3)
    // 'ab' → 'YWI=' → 2 octeți; 'a' → 'YQ==' → 1 octet; gol → 0
    expect(octetiDinBase64(Buffer.from('ab').toString('base64'))).toBe(2)
    expect(octetiDinBase64(Buffer.from('a').toString('base64'))).toBe(1)
    expect(octetiDinBase64('')).toBe(0)
  })
})

// ── UȘA SPRE CREIERUL ÎNTREG (8 aug: „kelion nu are acces la unelte, vocea
// merge, și atât") — sigiliul care ține ușa deschisă pe toate drumurile. ─────
import { unelteleSesiuniiLive, unelteleDovedite } from './routes/vocalLive.js'

describe('vocalLive — ușa cere_creierului', () => {
  it('adminul are ușa PRIMA + inventarul de administrare după ea', () => {
    const nume = unelteleSesiuniiLive('admin').map((u) => u.name)
    expect(nume[0]).toBe('cere_creierului')
    expect(nume.length, 'inventarul plin, nu doar ușa').toBeGreaterThan(10)
  })

  it('userul obișnuit are ușa PRIMA + setul mic de citit', () => {
    const nume = unelteleSesiuniiLive('user').map((u) => u.name)
    expect(nume[0]).toBe('cere_creierului')
    expect(nume).toContain('get_real_cost')
  })

  it('REZERVA păstrează ușa — degradarea taie administrarea, nu accesul la lume', () => {
    expect(unelteleDovedite().map((u) => u.name)[0]).toBe('cere_creierului')
  })

  it('ușa are schemă reală (cerere obligatorie), nu un obiect gol', () => {
    const usa = unelteleDovedite()[0]
    const p = usa.parameters as { required?: string[]; properties?: Record<string, unknown> }
    expect(p.required).toEqual(['cerere'])
    expect(p.properties?.cerere).toBeTruthy()
  })
})

// ── ANCORA + TĂCEREA LA DESCHIDERE (8 aug: „nu e ancorat în realitate" +
// „trebuie oprită bâlbâiala permanentă a salutului") ─────────────────────────
describe('vocalLive — ancora realității și tăcerea la deschidere', () => {
  it('instrucțiunea poartă REGULA TĂCERII (salutul nu se repetă la reluări)', () => {
    const i = construiesteInstructiune('persona', 'Adrian', [])
    expect(i).toContain('REGULA TĂCERII LA DESCHIDERE')
    expect(i).toContain('Saluți DOAR dacă el te salută primul')
  })

  it('cu oră+fus+GPS, ancora e coaptă în instrucțiune cu valorile reale', () => {
    const i = construiesteInstructiune('p', 'Adrian', [], {
      nowIso: '2026-08-08T18:30:00.000Z',
      tz: 'Europe/London',
      lat: 51.5,
      lon: -0.12,
    })
    expect(i).toContain('ANCORA REALITĂȚII')
    expect(i).toContain('51.5')
    expect(i).toContain('-0.12')
    expect(i).toContain('Europe/London')
  })

  it('fără ancoră, lipsa se DECLARĂ — nu se inventează loc sau oră', () => {
    const i = construiesteInstructiune('p', 'Adrian', [])
    expect(i).toContain('nu ai primit nici ora, nici locul')
    expect(i).toContain('nu inventezi')
  })
})

// ── GENERAȚIA MÂNERULUI DE RELUARE (8 aug: „calea către unelte e ruptă") ─────
// Măsurat în jurnal: reluarea cu handle resuscita sesiunea VECHE de la Google,
// cu uneltele dinaintea ușii — modelul „zicea că are alte unelte" pentru că
// chiar le avea pe cele vechi. Amprenta generației invalidează mânerul când
// inventarul se schimbă. Testul pinuiește PREZENȚA mecanismului în rută.
import { readFileSync } from 'node:fs'

describe('vocalLive — mânerul de reluare poartă generația uneltelor', () => {
  const ruta = readFileSync(new URL('./routes/vocalLive.ts', import.meta.url), 'utf8')

  it('mânerul se salvează cu generația (gen) lângă handle', () => {
    expect(ruta).toMatch(/saveKv\(KV_RELUARE, JSON\.stringify\(\{ h: handle, t: acum, gen: genUnelte \}\)/)
  })

  it('un mâner din altă generație se ARUNCĂ — sesiunea pornește cu uneltele de azi', () => {
    expect(ruta).toContain('j.gen === genUnelte')
    expect(ruta).toContain('handle din ALTĂ generație de unelte')
  })
})

// ── GPS REAL (8 aug: „îi trebuiesc date de la gps real") ─────────────────────
describe('vocalLive — precizia GPS măsurată intră în ancoră', () => {
  it('cu acc, ancora spune fixul real și ±metri', () => {
    const i = construiesteInstructiune('p', 'Adrian', [], { lat: 51.5, lon: -0.12, acc: 8 })
    expect(i).toContain('fix GPS real, precizie ±8 m')
  })

  it('fără acc, coordonatele apar fără o precizie inventată', () => {
    const i = construiesteInstructiune('p', 'Adrian', [], { lat: 51.5, lon: -0.12 })
    expect(i).toContain('51.5')
    expect(i).not.toContain('precizie ±')
  })
})
