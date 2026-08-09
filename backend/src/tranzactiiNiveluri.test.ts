import { describe, it, expect, vi } from 'vitest'

vi.stubEnv('GOOGLE_CLIENT_ID', 'x')
vi.stubEnv('GOOGLE_CLIENT_SECRET', 'y')
vi.stubEnv('GOOGLE_REDIRECT_URI', 'z')
vi.stubEnv('SESSION_SECRET', 's')

const { extrageNiveluri, normalizeazaNumar } = await import('./routes/tranzactii.js')

// ── NIVELURILE DE PE GRAFIC (9 aug, revizia: separatori de mii = linii GREȘITE
// desenate; prima apariție în proză îngropa rândul real) ─────────────────────
describe('normalizeazaNumar — formatele reale de agent nu strâmbă liniile', () => {
  it('separatorii de mii se scot corect', () => {
    expect(normalizeazaNumar('65,100')).toBe(65100)
    expect(normalizeazaNumar('65.100,50')).toBe(65100.5)
    expect(normalizeazaNumar('1,234,567')).toBe(1234567)
  })
  it('zecimalele simple rămân zecimale', () => {
    expect(normalizeazaNumar('76.42')).toBe(76.42)
    expect(normalizeazaNumar('76,42')).toBe(76.42)
  })
  it('gunoiul → null, nu un număr inventat', () => {
    expect(normalizeazaNumar('')).toBeNull()
    expect(normalizeazaNumar('abc')).toBeNull()
  })
})

describe('extrageNiveluri — rândul REAL câștigă', () => {
  it('ULTIMA apariție validă bate mențiunea din proză', () => {
    // „66.800" lângă „65,100" e stil european de MII (66800), nu 66.8 — o
    // țintă de 66.8 pe un BTC de 65k ar fi fost o linie absurdă pe grafic.
    const text = 'Despre NIVELURI: vorbim mai jos.\nAnaliza...\nNIVELURI: intrare=65,100; stop=64300; tinta=66.800'
    const n = extrageNiveluri(text)
    expect(n.map((x) => x.valoare)).toEqual([65100, 64300, 66800])
    expect(n[0].nume).toBe('intrare')
  })
  it('bold markdown + moneda nu strică potrivirea', () => {
    const n = extrageNiveluri('**NIVELURI:** intrare=$65100; stop=~64300')
    expect(n.length).toBe(2)
    expect(n[0].valoare).toBe(65100)
  })
  it('„NIVELURI: -" → nimic desenat', () => {
    expect(extrageNiveluri('Analiza...\nNIVELURI: -')).toEqual([])
  })
})
