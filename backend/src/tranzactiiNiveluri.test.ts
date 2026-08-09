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
  it('„0.123" e ÎNTOTDEAUNA zecimal — nu 123 (auditul de noapte: linii de ~1000× pe DOGE)', () => {
    expect(normalizeazaNumar('0.123')).toBe(0.123)
    expect(normalizeazaNumar('0,118')).toBe(0.118)
  })
  it('„X.YYY" cu o cifră întreagă, fără context = preț zecimal de altcoin', () => {
    expect(normalizeazaNumar('1.085')).toBe(1.085)
  })
  it('prețul REAL dezambiguizează: aceeași sfoară, interpretări diferite', () => {
    expect(normalizeazaNumar('66.800', 66500)).toBe(66800) // BTC la 66.5k → mii
    expect(normalizeazaNumar('1.085', 1.1)).toBe(1.085) // altcoin la ~1.1 → zecimal
    expect(normalizeazaNumar('1.085', 1100)).toBe(1085) // instrument la ~1100 → mii
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
  it('virgula ȘI de mii ȘI de pereche: nimic nu dispare tăcut (auditul de noapte)', () => {
    // Înainte: captura înghițea „65,100, " → NaN → doar ținta supraviețuia.
    const n = extrageNiveluri('NIVELURI: intrare=65,100, stop=64,300, tinta=66,800')
    expect(n.map((x) => x.valoare)).toEqual([65100, 64300, 66800])
  })
  it('prețul curent curge până în perechi (DOGE întreg, nu ×1000)', () => {
    const n = extrageNiveluri('NIVELURI: intrare=0.123; stop=0.118; tinta=0.135', 0.123)
    expect(n.map((x) => x.valoare)).toEqual([0.123, 0.118, 0.135])
  })
})
