// ── PAZNICUL CARE NU LASĂ O CHEIE SĂ IASĂ DIN CASĂ ──────────────────────────
//
// Ruta `/api/admin/env-check` există ca să răspundă la „le-am scris de zeci de
// ori" cu fapte din procesul care rulează. Riscul ei nu e că raportează greșit,
// ci că raportează PREA MULT: o singură scăpare și cheile ajung în răspunsul
// HTTP, în logurile browserului, în capturi de ecran.
//
// De-aia testul principal de aici nu verifică prezența, ci ABSENȚA: niciun câmp
// întors nu are voie să conțină vreo bucată din valoarea reală.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('./config.js', () => ({
  config: { stripe: { secretKey: 'sk_live_SECRET_NU_TREBUIE_SA_IASA' } },
  ENV_ALIASES: {
    openaiKey: ['OPENAI_API_KEY', 'OPENAI_KEY'],
    openrouterKey: ['OPENROUTER_API_KEY', 'OPENROUTER_KEY'],
    databaseUrl: ['DATABASE_URL', 'POSTGRES_URL'],
    sessionSecret: ['SESSION_SECRET'],
    stripeSecretKey: ['STRIPE_SECRET_KEY', 'STRIPE_SK'],
    stripeWebhookSecret: ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WH_SECRET'],
    stripePublishableKey: ['STRIPE_PUBLISHABLE_KEY', 'STRIPE_PUBLIC_KEY', 'STRIPE_PK'],
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

const { envCheck, envSummary, envOrphans, stripeMode } = await import('./services/envCheck.js')

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
    // Nici prefixe: „primele caractere" e tot o scurgere.
    expect(text).not.toContain(SECRET.slice(0, 8))
  })

  it('deosebește cele trei stări care contează', () => {
    const byName = Object.fromEntries(envCheck().map((v) => [v.name, v]))
    // Prezentă cu valoare: știm doar CÂT e, nu CE e.
    expect(byName.SERPER_API_KEY.present).toBe(true)
    expect(byName.SERPER_API_KEY.length).toBe(SECRET.length)
    // Prezentă dar GOALĂ — altceva decât „lipsă", și se repară altfel.
    expect(byName.GOOGLE_MAPS_KEY.present).toBe(true)
    expect(byName.GOOGLE_MAPS_KEY.length).toBe(0)
    // Lipsă de tot.
    expect(byName.GOOGLE_TTS_API_KEY.present).toBe(false)
  })

  it('rezumatul numără goalele separat de lipsuri și dă numele de pus', () => {
    const s = envSummary()
    expect(s.nume).toContain('GOOGLE_MAPS_KEY') // goală
    expect(s.nume).toContain('GOOGLE_TTS_API_KEY') // lipsă
    expect(s.nume).not.toContain('SERPER_API_KEY') // pusă
    expect(s.total).toBeGreaterThan(s.lipsa + s.goale)
  })

  it('spune modul cheii Stripe fără să arate cheia', () => {
    expect(stripeMode()).toBe('live')
    expect(JSON.stringify(stripeMode())).not.toContain('SECRET_NU_TREBUIE')
  })

  // ── MIEZUL PROBLEMEI LUI ADRIAN, 30 iul ────────────────────────────────────
  // „toate cheile au fost scrise de zeci de ori" — și erau. Doar că el scrisese
  // GOOGLE_MAPS_API_KEY (numele normal), iar codul citea DOAR GOOGLE_MAPS_KEY.
  // Testele astea există ca să nu se mai repete niciodată tăcerea aia.
  it('găsește cheia scrisă cu un nume rezonabil, nu doar cu cel canonic', () => {
    process.env.GOOGLE_MAPS_API_KEY = 'cheia-de-harti'
    delete process.env.GOOGLE_MAPS_KEY
    const maps = envCheck().find((v) => v.name === 'GOOGLE_MAPS_KEY')
    expect(maps?.present).toBe(true)
    // Și spune SUB CE nume a găsit-o — altfel omul tot nu știe de ce merge acum.
    expect(maps?.foundAs).toBe('GOOGLE_MAPS_API_KEY')
    delete process.env.GOOGLE_MAPS_API_KEY
  })

  it('arată cheile pe care le ai sub un nume pe care codul NU-l citește', () => {
    process.env.GOOGLE_SEARCH_API_KEY = 'ceva'
    expect(envOrphans()).toContain('GOOGLE_SEARCH_API_KEY')
    // Un nume pe care ÎL citim nu e orfan.
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
