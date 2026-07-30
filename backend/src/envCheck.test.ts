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

vi.mock('./config.js', () => ({ config: { stripe: { secretKey: 'sk_live_SECRET_NU_TREBUIE_SA_IASA' } } }))

const { envCheck, envSummary, stripeMode } = await import('./services/envCheck.js')

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
})
