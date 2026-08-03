import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import jwt from 'jsonwebtoken'

// ── GOOGLE CHIRP 3 HD = SINGURA VOCE, OPENAI SCOS COMPLET (Adrian, 3 aug) ────
//
// Adrian, 3 aug: „OpenAI scos din toată aplicația". Rezerva OpenAI TTS a murit
// (contul OpenAI a ars $65 în 2 săptămâni); Chirp 3 HD are 1M caractere/lună
// gratis și serviciul e dovedit live.
//
// Aceste teste garantează comportamental noul ordin (cu fetch mock-uit, în
// stilul casei): sinteza e DOAR pe Google; un eșec Google întoarce eroare
// (NU se mai cade pe OpenAI); fără Google → 503, fără niciun apel; un stil
// feminin NU ajunge NICIODATĂ la API (rescris la Charon); /api/tts/status
// întoarce booleeni, niciodată chei.

import { config } from './config.js'
import { synthesize, googleTtsAvailable, ttsConfigured } from './services/tts.js'

interface CapturedCall {
  url: string
  body: Record<string, unknown>
}

let calls: CapturedCall[] = []

// REAL Response objects — the service checks `r instanceof Response`, so a
// plain mock object would be mistaken for an error result.
function googleOk(): Response {
  return new Response(JSON.stringify({ audioContent: Buffer.from('google-audio').toString('base64') }))
}
function openaiOk(): Response {
  return new Response(Buffer.from('openai-audio'))
}
function googleDown(): Response {
  return new Response('boom', { status: 500 })
}
const GOOGLE_URL = 'texttospeech.googleapis.com'
const OPENAI_URL = 'api.openai.com/v1/audio/speech'

// The config object is read at import time from env — we pin the fields we
// care about per test and restore them after, so the developer's real .env
// can never flip a test.
const saved: Record<string, unknown> = {}
beforeEach(() => {
  calls = []
  saved.serviceAccount = config.googleServiceAccountJson
  saved.googleKey = config.googleTtsKey
  saved.openaiKey = config.openai.key
  saved.style = config.ttsVoiceStyle
  // Never touch the service-account path here (it would JSON.parse + OAuth):
  // the API-key path exercises the same Google branch.
  config.googleServiceAccountJson = ''
  config.googleTtsKey = 'test-google-key'
  config.openai.key = 'test-openai-key'
  config.ttsVoiceStyle = 'Charon'
})
afterEach(() => {
  config.googleServiceAccountJson = saved.serviceAccount as string
  config.googleTtsKey = saved.googleKey as string
  config.openai.key = saved.openaiKey as string
  config.ttsVoiceStyle = saved.style as string
  vi.unstubAllGlobals()
})

function mockFetch(handler: (url: string) => Response): void {
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: RequestInit) => {
    const u = String(url)
    calls.push({ url: u, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} })
    return handler(u)
  }))
}

describe('GOOGLE-ONLY: Chirp 3 HD e singura voce, OpenAI SCOS complet (Adrian, 3 aug)', () => {
  it('cu Google configurat, sintetizează pe Google și OpenAI NU e atins NICIODATĂ', async () => {
    // Cheia OpenAI e prezentă în config, dar sinteza nu trebuie s-o atingă:
    // OpenAI e scos din toată aplicația.
    mockFetch((u) => (u.includes(GOOGLE_URL) ? googleOk() : openaiOk()))
    const r = await synthesize('Bună ziua', 'ro')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.engine).toBe('google')
    expect(calls.map((c) => c.url).join()).toContain(GOOGLE_URL)
    expect(calls.map((c) => c.url).join()).not.toContain(OPENAI_URL)
  })

  it('la eșec Google → EROARE onestă, FĂRĂ rezervă OpenAI (OpenAI nu se mai atinge)', async () => {
    mockFetch((u) => (u.includes(GOOGLE_URL) ? googleDown() : openaiOk()))
    const r = await synthesize('Bună ziua', 'ro')
    expect(r.ok).toBe(false)
    // Doar apelul Google a fost făcut; OpenAI nu e chemat deloc.
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toContain(GOOGLE_URL)
    expect(calls.map((c) => c.url).join()).not.toContain(OPENAI_URL)
  })

  it('fără Google configurat → 503 tts_not_configured, NICIUN apel (nici la OpenAI)', async () => {
    config.googleTtsKey = ''
    config.googleServiceAccountJson = ''
    // Cheia OpenAI rămâne setată — dar nu mai e o cale de sinteză.
    expect(googleTtsAvailable()).toBe(false)
    expect(ttsConfigured()).toBe(false)
    mockFetch((u) => (u.includes(GOOGLE_URL) ? googleOk() : openaiOk()))
    const r = await synthesize('Bună ziua', 'ro')
    expect(r).toEqual({ ok: false, status: 503, error: 'tts_not_configured' })
    expect(calls).toHaveLength(0)
  })

  it('fără niciun motor → 503 tts_not_configured', async () => {
    config.googleTtsKey = ''
    config.openai.key = ''
    expect(ttsConfigured()).toBe(false)
    const r = await synthesize('Bună ziua', 'ro')
    expect(r).toEqual({ ok: false, status: 503, error: 'tts_not_configured' })
  })
})

describe('voce masculină în orice limbă: stilul feminin NU ajunge NICIODATĂ la API', () => {
  async function voiceNameSent(style: string, lang: string): Promise<string> {
    config.ttsVoiceStyle = style
    mockFetch((u) => (u.includes(GOOGLE_URL) ? googleOk() : openaiOk()))
    const r = await synthesize('Bună ziua', lang)
    expect(r.ok).toBe(true)
    const voice = (calls[0].body as { voice: { name: string; languageCode: string } }).voice
    return `${voice.languageCode}|${voice.name}`
  }

  it('stil feminin simplu (Kore) → rescris la Charon', async () => {
    expect(await voiceNameSent('Kore', 'ro')).toBe('ro-RO|ro-RO-Chirp3-HD-Charon')
  })

  it('stil feminin din listă (Aoede, Zephyr, Achernar, Autonoe) → toate la Charon', async () => {
    for (const f of ['Aoede', 'Zephyr', 'Achernar', 'Autonoe', 'Pulcherrima']) {
      calls = []
      expect(await voiceNameSent(f, 'en')).toBe('en-US|en-US-Chirp3-HD-Charon')
    }
  })

  it('nume complet de voce FEMININĂ (ro-RO-Chirp3-HD-Despina) → Charon, în limba vorbită', async () => {
    expect(await voiceNameSent('ro-RO-Chirp3-HD-Despina', 'fr')).toBe('fr-FR|fr-FR-Chirp3-HD-Charon')
  })

  it('stil masculin valid (Charon/Fenrir/Orus/Puck) trece neatins, în limba vorbită', async () => {
    expect(await voiceNameSent('Charon', 'ro')).toBe('ro-RO|ro-RO-Chirp3-HD-Charon')
    calls = []
    expect(await voiceNameSent('Fenrir', 'de')).toBe('de-DE|de-DE-Chirp3-HD-Fenrir')
    calls = []
    expect(await voiceNameSent('en-US-Chirp3-HD-Orus', 'ro')).toBe('ro-RO|ro-RO-Chirp3-HD-Orus')
  })

  it('default-ul din config este Charon (masculin), iar gunoiul din env cade tot pe Charon', async () => {
    expect(config.ttsVoiceStyle).toBe('Charon') // pinned in beforeEach = the shipped default
    expect(await voiceNameSent('nu-sunt-o-voce', 'ro')).toBe('ro-RO|ro-RO-Chirp3-HD-Charon')
  })
})

describe('GET /api/tts/status — booleeni, niciodată chei', () => {
  const savedSecret = config.sessionSecret
  beforeEach(() => {
    // A deterministic secret for the session JWT (the dev env may have none).
    config.sessionSecret = 'test-secret'
  })
  afterEach(() => {
    config.sessionSecret = savedSecret
  })

  async function buildApp(): Promise<import('fastify').FastifyInstance> {
    const { default: Fastify } = await import('fastify')
    const { ttsRoutes } = await import('./routes/tts.js')
    const app = Fastify()
    await app.register(ttsRoutes)
    return app
  }

  function sessionCookie(): string {
    // getSessionUser falls back to parsing the raw cookie header — no plugin needed.
    const token = jwt.sign(
      { email: 'test@kelion.ai', name: 'Test', picture: '', role: 'customer', locale: 'ro' },
      config.sessionSecret,
    )
    return `kelionai_session=${token}`
  }

  it('fără sesiune → 401', async () => {
    const app = await buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/tts/status' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('cu sesiune: google/openai reflectă EXACT configurarea, fără chei în răspuns', async () => {
    const app = await buildApp()
    // Both configured.
    // `maxChars` rides along since Aug 2: the promo narrator chunks against
    // THE SERVER'S cap instead of a second hardcoded copy in the client.
    let res = await app.inject({ method: 'GET', url: '/api/tts/status', headers: { cookie: sessionCookie() } })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ google: true, openai: true, maxChars: 5000 })
    // Only Google configured.
    config.openai.key = ''
    res = await app.inject({ method: 'GET', url: '/api/tts/status', headers: { cookie: sessionCookie() } })
    expect(res.json()).toEqual({ google: true, openai: false, maxChars: 5000 })
    // Only OpenAI configured.
    config.openai.key = 'test-openai-key'
    config.googleTtsKey = ''
    res = await app.inject({ method: 'GET', url: '/api/tts/status', headers: { cookie: sessionCookie() } })
    expect(res.json()).toEqual({ google: false, openai: true, maxChars: 5000 })
    // Nothing configured.
    config.openai.key = ''
    res = await app.inject({ method: 'GET', url: '/api/tts/status', headers: { cookie: sessionCookie() } })
    expect(res.json()).toEqual({ google: false, openai: false, maxChars: 5000 })
    // No secret leaks: the body never contains a configured key value.
    expect(res.body).not.toContain('test-google-key')
    expect(res.body).not.toContain('test-openai-key')
    await app.close()
  })
})
