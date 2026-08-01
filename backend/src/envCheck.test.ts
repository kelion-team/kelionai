// ── THE GUARD THAT DOESN'T LET A KEY LEAVE THE HOUSE ───────────────────────
//
// The `/api/admin/env-check` route exists to answer "I've written them dozens
// of times" with facts from the running process. Its risk is not that it
// reports wrongly, but that it reports TOO MUCH: a single leak and the keys
// end up in the HTTP response, in browser logs, in screenshots.
//
// That's why the main test here checks not presence, but ABSENCE: no returned
// field may contain any piece of the real value.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: {},
  ENV_ALIASES: {
    openaiKey: ['OPENAI_API_KEY', 'OPENAI_KEY'],
    openrouterKey: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY'],
    databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
    sessionSecret: ['SESSION_SECRET'],
    geminiKey: ['GEMINI_API_KEY', 'GEMINI_KEY', 'GOOGLE_GEMINI_API_KEY'],
    serperKey: ['SERPER_API_KEY', 'SERPER_KEY'],
    googleMapsKey: ['GOOGLE_MAPS_KEY', 'GOOGLE_MAPS_API_KEY', 'MAPS_API_KEY', 'GOOGLE_MAP_KEY'],
    googleTtsKey: ['GOOGLE_TTS_API_KEY', 'GOOGLE_TTS_KEY', 'GOOGLE_API_KEY'],
    googleServiceAccountJson: ['GOOGLE_SERVICE_ACCOUNT_JSON', 'GOOGLE_SERVICE_ACCOUNT', 'GCP_SERVICE_ACCOUNT_JSON'],
    mailPass: ['MAIL_PASS', 'MAIL_PASSWORD'],
    githubToken: ['GITHUB_TOKEN', 'KELION_GITHUB_TOKEN'],
    bridgeSecret: ['BRIDGE_SECRET'],
  },
}))

const { envCheck, envSummary, envOrphans } = await import('./services/envCheck.js')

const SECRET = 'valoare-foarte-secreta-1234567890'

describe('env-check — nicio valoare nu iese', () => {
  beforeEach(() => {
    process.env.SERPER_API_KEY = SECRET
    process.env.GOOGLE_MAPS_KEY = ''
    delete process.env.GOOGLE_TTS_API_KEY
  })
  afterEach(() => {
    delete process.env.SERPER_API_KEY
    delete process.env.GOOGLE_MAPS_KEY
  })

  it('raportul întreg NU conține valoarea, nici măcar o bucată din ea', () => {
    const text = JSON.stringify(envCheck())
    expect(text).not.toContain(SECRET)
    // No prefixes either: "the first characters" is still a leak.
    expect(text).not.toContain(SECRET.slice(0, 8))
  })

  it('deosebește cele trei stări care contează', () => {
    const byName = Object.fromEntries(envCheck().map((v) => [v.name, v]))
    // Present with a value: we only know HOW LONG it is, not WHAT it is.
    expect(byName.SERPER_API_KEY.present).toBe(true)
    expect(byName.SERPER_API_KEY.length).toBe(SECRET.length)
    // Present but EMPTY — different from "missing", and fixed differently.
    expect(byName.GOOGLE_MAPS_KEY.present).toBe(true)
    expect(byName.GOOGLE_MAPS_KEY.length).toBe(0)
    // Missing altogether.
    expect(byName.GOOGLE_TTS_API_KEY.present).toBe(false)
  })

  it('rezumatul numără goalele separat de lipsuri și dă numele de pus', () => {
    const s = envSummary()
    expect(s.nume).toContain('GOOGLE_MAPS_KEY') // empty
    expect(s.nume).toContain('GOOGLE_TTS_API_KEY') // missing
    expect(s.nume).not.toContain('SERPER_API_KEY') // set
    expect(s.total).toBeGreaterThan(s.lipsa + s.goale)
  })

  it('cheile de plată noi apar în raport (Revolut + Enable Banking)', () => {
    const byName = Object.fromEntries(envCheck().map((v) => [v.name, v]))
    expect(byName.REVOLUT_PAY_LINK).toBeDefined()
    expect(byName.ENABLE_BANKING_APP_ID).toBeDefined()
    expect(byName.ENABLE_BANKING_PRIVATE_KEY_B64).toBeDefined()
  })

  // ── THE CORE OF ADRIAN'S PROBLEM, Jul 30 ───────────────────────────────
  // "all the keys have been written dozens of times" — and they were. Only he
  // had written GOOGLE_MAPS_API_KEY (the normal name), while the code read
  // ONLY GOOGLE_MAPS_KEY. These tests exist so that silence never repeats.
  it('găsește cheia scrisă cu un nume rezonabil, nu doar cu cel canonic', () => {
    process.env.GOOGLE_MAPS_API_KEY = 'cheia-de-harti'
    delete process.env.GOOGLE_MAPS_KEY
    const maps = envCheck().find((v) => v.name === 'GOOGLE_MAPS_KEY')
    expect(maps?.present).toBe(true)
    // And it says UNDER WHICH name it found it — otherwise the person still doesn't know why it works now.
    expect(maps?.foundAs).toBe('GOOGLE_MAPS_API_KEY')
    delete process.env.GOOGLE_MAPS_API_KEY
  })

  it('arată cheile pe care le ai sub un nume pe care codul NU-l citește', () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'ceva'
    expect(envOrphans()).toContain('GOOGLE_SEARCH_API_KEY')
    // A name we DO read is not an orphan.
    process.env.SERPER_KEY = 'x'
    expect(envOrphans()).not.toContain('SERPER_KEY')
    delete process.env.GOOGLE_SEARCH_API_KEY
    delete process.env.SERPER_KEY
  })

  it('lista de orfani nu conține valori, doar nume', () => {
    process.env.STRIPE_ALT_KEY = SECRET
    expect(JSON.stringify(envOrphans())).not.toContain(SECRET)
    delete process.env.STRIPE_ALT_KEY
  })
})
