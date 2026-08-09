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

  // PINUL DE LIMBĂ (9 aug, „Dime, ¿qué"): determinist în speechConfig, nu în
  // instrucțiuni (alea s-au dovedit că nu țin). Fără pin, forma veche rămâne
  // neatinsă (compatibilitate cu plasa faraExtensii).
  it('pinul de limbă intră în speechConfig.languageCode doar când e dat', () => {
    const cu = construiesteSetup('m', 'Charon', 'p', [], undefined, 'ro-RO') as {
      setup: { generationConfig: { speechConfig: { languageCode?: string } } }
    }
    expect(cu.setup.generationConfig.speechConfig.languageCode).toBe('ro-RO')
    const fara = construiesteSetup('m', 'Charon', 'p', []) as {
      setup: { generationConfig: { speechConfig: { languageCode?: string } } }
    }
    expect(fara.setup.generationConfig.speechConfig.languageCode).toBeUndefined()
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
import { construiesteInstructiune, oraLocalaText } from './services/vocalLive.js'

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

  // 9 aug, captura ownerului: banda scria „Dime, con…" — o singură frază
  // stâlcită comuta răspunsul pe spaniolă. Pragul comutării a urcat: cerere
  // explicită SAU mai multe fraze întregi la rând; în dubiu, româna.
  it('ancora limbii ÎNTĂRITĂ: în dubiu româna; comutarea cere cerere explicită sau fraze susținute', () => {
    const i = construiesteInstructiune(persona, 'Adrian', [])
    expect(i).toContain('ÎN CAZ DE DUBIU: ROMÂNA')
    expect(i).toContain('NICIODATĂ un răspuns în altă limbă doar fiindcă ULTIMA')
    expect(i).toContain('CERE explicit')
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
    // REALITĂȚII + ANCORA LIMBII + REGULA SALUTULUI (8 aug seara/noaptea,
    // antet FIX — reguli ordonate de owner una câte una, scrise o dată, nu
    // cresc cu istoricul) + antetul blocului de istoric + blocul plafonat la
    // 2400. Plafonul pe ISTORIC rămâne neatins — bugetul total urcă conștient
    // cu fiecare regulă nouă (4200 → 4800 la REGULA SALUTULUI; → 5500 la
    // REGULA TREZIRII PE NUME + ancora limbii ÎNTĂRITĂ, 9 aug — amândouă
    // ordonate de owner: „răspunde doar când e strigat" + banda „Dime, con").
    expect(i.length, 'un istoric nelimitat ar umfla setup-ul sesiunii ca vechiul prompt de 15.000 de tokeni').toBeLessThan(
      persona.length + 5500,
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
import { estimareCostAudioUsd, octetiDinBase64, CALIBRARE_LIVE } from './services/vocalLive.js'

describe('vocalLive — costul sesiunii, din octeții retransmiși', () => {
  // CALIBRAREA MĂSURATĂ (9 aug): Google a facturat ~£21.32 în ~11h în care
  // registrul nostru estimase ~$8 — tarifele pe octeți subnumărau ~×3.
  // Formulele rămân, înmulțite cu factorul real (declarat, re-calibrabil).
  it('calibrarea pe factura reală din 9 aug e aplicată (×3)', () => {
    expect(CALIBRARE_LIVE).toBe(3)
  })

  it('un minut de microfon (PCM16 16kHz) costă tariful de intrare × calibrare', () => {
    // 60s × 16000 mostre/s × 2 octeți = 1.920.000 octeți → $0.005 × 3
    expect(estimareCostAudioUsd(60 * 16_000 * 2, 0)).toBeCloseTo(0.005 * CALIBRARE_LIVE, 10)
  })

  it('un minut de glas (PCM16 24kHz) costă tariful de ieșire × calibrare', () => {
    // 60s × 24000 mostre/s × 2 octeți = 2.880.000 octeți → $0.018 × 3
    expect(estimareCostAudioUsd(0, 60 * 24_000 * 2)).toBeCloseTo(0.018 * CALIBRARE_LIVE, 10)
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

  // 9 aug, ownerul: „el trebuie să răspundă DOAR când îl strigi Kelion, și asta
  // e implementată dar nu funcționează". MĂSURAT: calea LIVE nu avea NICIO
  // regulă de trezire — o aducem aici, cu contractul de pe calea ambientală.
  it('instrucțiunea poartă REGULA TREZIRII PE NUME (răspunde DOAR când e strigat)', () => {
    const i = construiesteInstructiune('persona', 'Adrian', [])
    expect(i).toContain('REGULA TREZIRII PE NUME')
    // trezirea e pe NUME (Kelion/Kei), nu pe orice vorbire
    expect(i).toContain('Kelion')
    expect(i).toContain('Kei')
    // când NU e strigat, tace complet — asta e miezul cererii
    expect(i).toContain('TACI complet')
    // un răspuns la propria întrebare tot îl trezește (nu pierde firul)
    expect(i).toContain('răspunsul la ea')
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

// ── SALUTUL PE ORA REALĂ (8 aug: „când primește «bună seara» sau «bună
// dimineața» verifică ora dată de GPS real al utilizatorului"). Măsurat: ora
// era coaptă DOAR la nașterea sesiunii, iar reluările o cărau ore întregi —
// salutul cădea pe ora veche. Acum ora curge: cadrele de coordonate împing
// [ANCORĂ DE SISTEM] tăcut (turnComplete:false), iar instrucțiunea cere
// verificarea salutului pe cea mai RECENTĂ oră. ─────────────────────────────
describe('vocalLive — salutul se verifică pe ora REALĂ, împrospătată', () => {
  it('oraLocalaText dă ora pe fusul device-ului (nu UTC, nu inventată)', () => {
    // 21:00 UTC vara = 22:00 la Londra (BST) — exact cazul ownerului.
    expect(oraLocalaText('2026-08-08T21:00:00.000Z', 'Europe/London')).toContain('22:00')
    // fus necunoscut → rămâne ISO (ancoră reală, nu ghicită)
    expect(oraLocalaText('2026-08-08T21:00:00.000Z', 'Fus/Inexistent')).toBe('2026-08-08T21:00:00.000Z')
  })

  it('instrucțiunea poartă REGULA SALUTULUI și spune că ora recentă bate ancora veche', () => {
    const i = construiesteInstructiune('p', 'Adrian', [], { nowIso: '2026-08-08T18:30:00.000Z', tz: 'Europe/London' })
    expect(i).toContain('REGULA SALUTULUI')
    expect(i).toContain('saluți conform orei REALE')
    expect(i).toContain('cea mai RECENTĂ oră primită e ora adevărată')
  })

  it('motorul are ancoreaza() TĂCUT — context fără răspuns (turnComplete: false)', () => {
    const motor = readFileSync(new URL('./services/vocalLive.ts', import.meta.url), 'utf8')
    // După dedup (jscpd, 9 aug) corpul comun e în trimiteRand(text, turnComplete):
    // ancoreaza trimite cu FALSE (context tăcut), anunta cu TRUE (răspunde).
    expect(motor).toMatch(/ancoreaza\(text: string\): void \{[\s\S]{0,200}trimiteRand\(text, false\)/)
    expect(motor).toMatch(/anunta\(text: string\): void \{[\s\S]{0,200}trimiteRand\(text, true\)/)
    expect(motor).toMatch(/const trimiteRand[\s\S]{0,300}turnComplete/)
  })

  it('ruta împinge ora la FIECARE cadru de coordonate, ca [ANCORĂ DE SISTEM]', () => {
    const ruta = readFileSync(new URL('./routes/vocalLive.ts', import.meta.url), 'utf8')
    expect(ruta).toContain('live.ancoreaza(')
    expect(ruta).toContain('[ANCORĂ DE SISTEM — context, nu răspunde la rândul ăsta]')
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

// ── VEDEREA CONTINUĂ (8 aug: „trebuie să poată folosi camera") ───────────────
import { estimareCostCadreUsd, TOKENI_PE_CADRU_EST } from './services/vocalLive.js'

describe('vocalLive — camera intră în sesiune, cu costul estimat pe față', () => {
  it('costul cadrelor: N cadre × ~516 tokeni × tariful de intrare × calibrarea din 9 aug', () => {
    expect(estimareCostCadreUsd(24)).toBeCloseTo(((24 * TOKENI_PE_CADRU_EST * 0.75) / 1e6) * CALIBRARE_LIVE, 10)
    expect(estimareCostCadreUsd(0)).toBe(0)
  })

  it('motorul are scrieCadru — cadrele intră ca video pe realtimeInput', () => {
    const sursa = readFileSync(new URL('./services/vocalLive.ts', import.meta.url), 'utf8')
    expect(sursa).toContain('scrieCadru(jpegBase64: string): void')
    expect(sursa).toMatch(/realtimeInput: \{ video: \{ data: jpegBase64, mimeType: 'image\/jpeg' \} \}/)
  })

  it('persona spune modelului că VEDE cadrele — și că lipsa lor se declară', () => {
    const ruta = readFileSync(new URL('./routes/vocalLive.ts', import.meta.url), 'utf8')
    expect(ruta).toContain('primești CADRELE ei în timp real')
    expect(ruta).toContain('camera e oprită — o spui, nu inventezi o vedere')
  })
})

// ── FĂRĂ LOC INVENTAT (8 aug: „fără date hardcodate gps, doar real") ─────────
// Harta de traseu cădea tăcut pe București [44.43,26.10] când nu avea
// coordonate. Sigiliul ține hardcodul afară pentru totdeauna.
describe('mapview — niciun oraș bătut în cod', () => {
  const sursa = readFileSync(new URL('./routes/mapview.ts', import.meta.url), 'utf8')

  it('fără traseu: lumea + centrare pe fixul GPS real, nu pe un oraș', () => {
    expect(sursa).not.toMatch(/setView\(\[44\.4/)
    expect(sursa).toContain('map.setView([20,0],2)')
    expect(sursa).toContain('primulFix&&!dest')
  })
})

// ── HARTA PE DOMENIUL NOSTRU (8 aug: iframe-ul openstreetmap.org apărea
// „întotdeauna" ca pagină prăbușită în Chrome-ul ownerului, iar traseul cerut
// de 15 ori n-a fost desenat niciodată — creierul alegea maps_search pentru că
// doar descrierea ei pomenea harta). Sigiliile țin hărțile same-origin și
// descrierea traseului pe unealta care chiar îl desenează. ─────────────────
describe('hărțile — same-origin, nu cadre străine care mor în browser', () => {
  const mapview = readFileSync(new URL('./routes/mapview.ts', import.meta.url), 'utf8')
  const google = readFileSync(new URL('./services/google.ts', import.meta.url), 'utf8')
  const preview = readFileSync(new URL('./services/monitorAutoPreview.ts', import.meta.url), 'utf8')

  it('pagina hărții își ia Leaflet de la noi, nu de pe unpkg', () => {
    expect(mapview).toContain('/leaflet/leaflet.js')
    expect(mapview).toContain('/leaflet/leaflet.css')
    expect(mapview).not.toContain('unpkg.com')
  })

  it('pagina hărții are modul punct (maps_search) cu numele ca TEXT, nu HTML', () => {
    expect(mapview).toContain('punct=')
    expect(mapview).toContain('el.textContent=nume')
  })

  it('maps_search și scena promo trimit pe ecran harta noastră, nu openstreetmap.org', () => {
    expect(google).toContain('/api/route?punct=')
    expect(google).not.toContain('export/embed.html')
  })

  it('descrierea maps_directions spune că EA desenează traseul pe monitor', () => {
    expect(google).toMatch(/maps_directions[\s\S]{0,600}ROUTE between two places ON the monitor map/)
  })

  it('auto-preview-ul din coordonate folosește tot harta noastră', () => {
    expect(preview).toContain('/api/route?punct=')
    expect(preview).not.toContain('openstreetmap.org/?mlat')
  })
})

// ── UNELTELE PRIN UȘĂ + ANUNȚUL LA TERMINARE (8 aug: „a oferit soluții dar nu
// poate să implementeze... dă-i uneltele să poată, și să anunțe când e gata") ─
describe('vocalLive — ușa dă faza de ACȚIUNE și anunță ordinele terminate', () => {
  const ruta = readFileSync(new URL('./routes/vocalLive.ts', import.meta.url), 'utf8')
  const chat = readFileSync(new URL('./routes/chat.ts', import.meta.url), 'utf8')

  it('ușa marchează tura (usaCreierului) și chatul o tratează ca ACȚIUNE', () => {
    expect(ruta).toContain('usaCreierului: true')
    expect(chat).toContain("req.body?.usaCreierului === true")
  })

  it('ordinul din „Am preluat cerința (ordin #N)" intră sub urmărire', () => {
    expect(ruta).toMatch(/ordin\\s\*#\(\\d\+\)/)
    expect(ruta).toContain('ordineUrmarite.add(Number(ordin[1]))')
  })

  it('la done/failed, sesiunea primește anunțul — Kelion îl spune cu vocea lui', () => {
    expect(ruta).toContain("j.status === 'done' || j.status === 'failed'")
    expect(ruta).toContain('ANUNȚ DE SISTEM')
    const motor = readFileSync(new URL('./services/vocalLive.ts', import.meta.url), 'utf8')
    expect(motor).toContain('anunta(text: string): void')
    expect(motor).toContain('clientContent')
  })
})
