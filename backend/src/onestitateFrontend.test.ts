import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// ── AUDITUL DE HARDCODĂRI PE FRONTEND (2 aug) — plasele care țin reparațiile ─
// Cele două audituri „roșii” din ziua asta au găsit: valori afirmate fără
// măsurătoare, dubluri client-server fără contract, și eșecuri mascate.
// Testele de aici citesc SURSA (ca urechiChirp.test.ts) și pică dacă cineva
// reintroduce vreuna din minciunile reparate.

const cale = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const voce = readFileSync(cale('../../frontend/src/lib/realtimeVoice.ts'), 'utf8')
const panou = readFileSync(cale('../../frontend/src/components/ChatPanel.tsx'), 'utf8')
const audio = readFileSync(cale('../../frontend/src/lib/audioIO.ts'), 'utf8')
const rutaRealtime = readFileSync(cale('./routes/realtime.ts'), 'utf8')
const rutaTts = readFileSync(cale('./routes/tts.ts'), 'utf8')
const serviciuRealtime = readFileSync(cale('./services/realtime.ts'), 'utf8')

describe('modelul de transcriere: serverul e singura sursă', () => {
  it('ruta trimite modelul configurat în header, lângă răspunsul SDP', () => {
    expect(rutaRealtime).toMatch(/\.header\('x-transcribe-model', config\.openai\.realtimeTranscribeModel\)/)
  })
  it('clientul citește header-ul și NU mai are literalul drept unică sursă', () => {
    expect(voce).toMatch(/res\.headers\.get\('x-transcribe-model'\)/)
    // ancora de limbă folosește variabila, nu literalul
    expect(voce).toMatch(/transcription: \{ model: transcribeModel, language: lang \}/)
  })
})

describe('plafonul TTS: publicat de server, nu dublat în client', () => {
  it('tăierea și statusul folosesc ACEEAȘI constantă', () => {
    expect(rutaTts).toMatch(/export const TTS_MAX_CHARS = 5000/)
    expect(rutaTts).toMatch(/\.slice\(0, TTS_MAX_CHARS\)/)
    expect(rutaTts).toMatch(/maxChars: TTS_MAX_CHARS/)
  })
  it('naratorul promo își ia plafonul de la /api/tts/status', () => {
    expect(panou).toMatch(/maxChars\?: number/)
    // fallback-ul conservator rămâne doar plasă pentru proba picată
    expect(panou).toMatch(/let cap = 3500/)
  })
  it('narațiunea nu mai moare mut: bucata pierdută se numără și se anunță', () => {
    expect(panou).toMatch(/if \(!spoken\) lost\+\+/)
    expect(panou).toMatch(/if \(lost > 0\) ack\(t\.promoVoiceLost\)/)
  })
  it('limba narațiunii nu mai cade pe un locale hardcodat', () => {
    expect(panou).not.toMatch(/lang: p\.lang \?\? 'ro-RO'/)
    expect(panou).toMatch(/lang: p\.lang \?\? speechLangRef\.current/)
  })
})

describe('protocolul gurii: prefixul rostirii există în ambele capete', () => {
  it('clientul și persona serverului folosesc același prefix', () => {
    // O schimbare doar într-o parte = gura citește prefixul cu voce tare sau
    // ignoră replica. Token-ul comun e „ROSTEȘTE:" — clientul îl trimite (cu
    // un spațiu după), persona îl recunoaște la începutul itemului.
    expect(voce).toMatch(/const SPEAK_PREFIX = 'ROSTEȘTE: '/)
    expect(serviciuRealtime).toContain('ROSTEȘTE:')
  })
})

describe('vocea picată spune motivul REAL (401/402 ≠ „temporar")', () => {
  it('clientul atașează codul mașină și retryable=false pe 401/402', () => {
    expect(voce).toMatch(/err\.code = res\.status === 401 \? 'need_login' : res\.status === 402 \? 'need_credit'/)
    expect(voce).toMatch(/err\.retryable = res\.status === 401 \|\| res\.status === 402 \? false/)
  })
  it('panoul arată mesajul specific, nu promisiunea falsă de reîncercare', () => {
    expect(panou).toMatch(/err\.code === 'need_credit' \? t\.voiceNeedCredit : t\.voiceNeedLogin/)
  })
  it('mesajul generic vine din i18n, nu dintr-un literal englez dublat', () => {
    expect(panou).not.toContain('My live voice is temporarily unavailable')
    expect(panou).toMatch(/ack\(t\.voiceDownTemp\)/)
  })
})

describe('punctul roșu al microfonului = măsurătoare, nu speranță', () => {
  it('pe calea realtime, listening se aprinde DOAR pe starea live', () => {
    // În handler-ul 'live' există setListening(true); la instalare nu mai există.
    expect(panou).toMatch(/if \(s === 'live'\) \{[\s\S]{0,700}setListening\(true\)/)
  })
  it('fraza pierdută la transcriere se spune, nu se înghite', () => {
    expect(audio).toMatch(/onError\('asr-failed'\)/)
    expect(panou).toMatch(/reason === 'asr-failed'/)
    expect(panou).toMatch(/ack\(t\.asrLost\)/)
  })
  it('microfonul blocat / lipsă nu mai e tăcere', () => {
    expect(panou).toMatch(/ack\(reason === 'unsupported' \? t\.micUnsupported : t\.micBlocked\)/)
    expect(panou).toMatch(/ack\(t\.micNoDevice\)/)
  })
})

describe('atașamentele nu mai mint', () => {
  it('ramura admin-raw (cip fără transmisie) a dispărut', () => {
    expect(panou).not.toContain('MAX_RAW_FILE')
    // limita reală e a serverului (bodyLimit 25MB → ~24MB base64)
    expect(panou).toMatch(/MAX_INGEST_B64 = 24_000_000/)
  })
  it('conversia picată se spune omului, cu numele fișierului', () => {
    expect(panou).toMatch(/ack\(t\.docAttachFailed\.replace\('\{name\}', name\)\)/)
    expect(panou).toMatch(/ack\(t\.docTooLarge\.replace\('\{name\}', name\)\)/)
  })
  it('cipul documentului nu mai e o imagine ruptă', () => {
    expect(panou).toMatch(/a\.url \? <img src=\{a\.url\} alt=\{a\.name\} \/> : <span className="att-doc-name">/)
  })
})

describe('gestul necunoscut lasă urmă', () => {
  it('numele care lipsește din hartă ajunge în jurnal (F12 → server)', () => {
    expect(panou).toMatch(/gest necunoscut de la server/)
  })
})

describe('„am pierdut netul" e o MĂSURĂTOARE, nu o presupunere (Adrian, 2 aug: „raportează fals")', () => {
  const chatLib = readFileSync(cale('../../frontend/src/lib/chat.ts'), 'utf8')
  it('niciun throw orb pe offline — ambele locuri trec prin diagnoză', () => {
    expect(chatLib).not.toMatch(/throw new Error\('offline'\)/)
    const diagnoze = chatLib.match(/throw new Error\(await diagnozaConexiune\(\)\)/g) ?? []
    expect(diagnoze.length).toBe(2)
  })
  it('diagnoza deosebește cele 3 adevăruri și le scrie în jurnal (monitorizare reală)', () => {
    expect(chatLib).toMatch(/navigator\.onLine === false/)
    expect(chatLib).toMatch(/'offline' \| 'server_down' \| 'transient'/)
    expect(chatLib).toMatch(/\[CONEXIUNE\] verdict măsurat/)
  })
  it('serverul căzut se reia pe pulsul de sănătate, nu pe evenimentul online care nu vine', () => {
    expect(panou).toMatch(/code === 'server_down'/)
    expect(panou).toMatch(/healthPollRef/)
  })
  it('accidentul pasager fără text scurs se reîncearcă TĂCUT o dată', () => {
    expect(panou).toMatch(/code === 'transient' && !acc\.trim\(\) && !transientRetryRef\.current/)
  })
})

describe('panoul banilor nu mai moare cu un câmp dispărut (Adrian, 2 aug: „mai jos nu mai e nimic")', () => {
  const adminPanel = readFileSync(cale('../../frontend/src/components/AdminPanel.tsx'), 'utf8')
  const rutaAdmin = readFileSync(cale('./routes/admin.ts'), 'utf8')
  it('serverul trimite din nou expenses (murise tăcut cu stripe.ts, #624)', () => {
    expect(rutaAdmin).toMatch(/expenses: await cheltuieliAplicatiei\(\)\.catch\(\(\) => \[\]\)/)
  })
  it('blocul de stare se afișează pe circuit, NU pe expenses', () => {
    // Garda veche ascundea citirea plăților, autonomia, dovezile și pauza —
    // TOT — când un câmp secundar lipsea. Nu are voie să revină.
    expect(adminPanel).not.toMatch(/\{\(circuit\?\.expenses\?\.length \?\? 0\) > 0 && \(\s*<div className="or-wallet">/)
    expect(adminPanel).toMatch(/\{circuit && \(\s*<div className="or-wallet">/)
  })
  it('rândul furnizorilor e gardat LOCAL, fără aserțiuni non-null', () => {
    expect(adminPanel).not.toContain('circuit!.expenses!')
  })
})
