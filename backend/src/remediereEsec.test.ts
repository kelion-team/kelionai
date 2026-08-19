// ── REMEDIEREA AUTOMATĂ — dovada deciziei pe fiecare clasă de eșec ────────────
// Owner, 19 aug: „la eșec, imediat analiză + decizie + remediere, AUTOMAT;
// atenție cu evaluarea creierului și cu decizia creierului, cu recomandări CLARE
// și FERME". Decizia e pură (decideRemediereEsec) — probată aici pe fiecare clasă
// + pe gărzile de BANI (permanent → oprire) și anti-BUCLĂ (MAX → raportează).
import { describe, it, expect } from 'vitest'
import { decideRemediereEsec, MAX_AUTO_REMEDIERI } from './services/remediereEsec.js'

describe('decideRemediereEsec — analiză + decizie fermă pe fiecare clasă', () => {
  // ── PERMANENT (bani/cheie): OPREȘTE, nu arde ──────────────────────────────
  it('pungă goală / credit / 402 / extra usage → OPRIRE (nu reîncerca)', () => {
    for (const log of ['FĂRĂ CREDIT API', 'your credit balance is too low', 'HTTP 402 extra usage']) {
      const d = decideRemediereEsec(log, true, 0)
      expect(d.actiune).toBe('oprire')
      expect(d.clasa).toBe('permanent')
      expect(d.escaladeazaCreier).toBe(false)
      expect(d.recomandare).toMatch(/^OPREȘTE/)
    }
  })
  it('cheie respinsă (401 / invalid key) → OPRIRE', () => {
    const d = decideRemediereEsec('authentication_error: invalid api-key', true, 0)
    expect(d.actiune).toBe('oprire')
    expect(d.clasa).toBe('permanent')
  })

  // ── PLASA ANTI-BUCLĂ: după MAX auto-remedieri → RAPORTEAZĂ (nu bucla/arde) ──
  it('după MAX_AUTO_REMEDIERI → RAPORTEAZĂ, chiar dacă eșecul ar fi reparabil', () => {
    const d = decideRemediereEsec('build picat: teste roșii', true, MAX_AUTO_REMEDIERI)
    expect(d.actiune).toBe('raporteaza')
    expect(d.escaladeazaCreier).toBe(false)
    expect(d.recomandare).toMatch(/^RAPORTEAZĂ/)
  })
  it('permanentul are prioritate peste anti-buclă (rămâne OPRIRE)', () => {
    const d = decideRemediereEsec('credit balance is too low', true, MAX_AUTO_REMEDIERI + 5)
    expect(d.actiune).toBe('oprire')
  })

  // ── VINA CREIERULUI: REIA; escaladează pe PLĂTIT doar dacă rezerva e gata ───
  it('model FREE n-a produs nimic + rezervă paid gata → REIA cu escaladare pe PLĂTIT', () => {
    const d = decideRemediereEsec('aider: fără nicio modificare — creierul local indisponibil', true, 0)
    expect(d.actiune).toBe('reia')
    expect(d.clasa).toBe('creier')
    expect(d.escaladeazaCreier).toBe(true)
    expect(d.recomandare).toMatch(/^REIA/)
    expect(d.recomandare).toMatch(/PL[ĂA]TIT/i)
  })
  it('model FREE n-a produs nimic FĂRĂ rezervă paid → REIA pe free + recomandă cheia (NU arde bani)', () => {
    const d = decideRemediereEsec('no change — răspuns gol', false, 0)
    expect(d.actiune).toBe('reia')
    expect(d.clasa).toBe('creier')
    expect(d.escaladeazaCreier).toBe(false) // NU inventează paid inexistent
    expect(d.recomandare).toMatch(/cheia|cloud|rezerv/i)
  })
  it('throttle / 429 / sugrumat = vină creier → REIA (escaladează dacă are rezervă)', () => {
    const d = decideRemediereEsec('429 rate limit — sugrumat', true, 0)
    expect(d.actiune).toBe('reia')
    expect(d.clasa).toBe('creier')
    expect(d.escaladeazaCreier).toBe(true)
  })

  // ── VINA CODULUI: REIA pe ACELAȘI creier, NU escalada (nu-i vina lui) ───────
  it('poartă/build/test roșu = vină cod → REIA același creier, FĂRĂ escaladare', () => {
    for (const log of ['poarta „cod duplicat (jscpd)" a picat', 'npm build a picat: tsc error', 'teste roșii', 'bootul pe dist a picat']) {
      const d = decideRemediereEsec(log, true, 0)
      expect(d.actiune).toBe('reia')
      expect(d.clasa).toBe('cod')
      expect(d.escaladeazaCreier).toBe(false) // deși paid e disponibil, NU escaladăm — nu-i creierul
      expect(d.recomandare).toMatch(/NU escalada/i)
    }
  })

  // ── NECUNOSCUT: nu reîncerca ORB ──────────────────────────────────────────
  it('cauză neclasificată → RAPORTEAZĂ (nu reîncerca orb)', () => {
    const d = decideRemediereEsec('ceva ciudat fără semnătură clară', true, 0)
    expect(d.actiune).toBe('raporteaza')
    expect(d.clasa).toBe('necunoscut')
  })

  // ── Recomandările sunt CLARE și FERME (încep cu verbul deciziei) ───────────
  it('fiecare recomandare e fermă — începe cu OPREȘTE/REIA/RAPORTEAZĂ', () => {
    const cazuri: Array<[string, boolean, number]> = [
      ['credit balance is too low', true, 0],
      ['fără nicio modificare', true, 0],
      ['fără nicio modificare', false, 0],
      ['teste roșii', true, 0],
      ['ceva necunoscut', true, 0],
      ['orice', true, MAX_AUTO_REMEDIERI],
    ]
    for (const [log, paid, nr] of cazuri) {
      const d = decideRemediereEsec(log, paid, nr)
      expect(d.recomandare).toMatch(/^(OPREȘTE|REIA|RAPORTEAZĂ)/)
    }
  })
})

describe('cablajul auto-remedierii — ruta de raport acționează pe decizie', () => {
  it('ruta /report cheamă decideRemediereEsec și repune în coadă pe „reia"', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
    expect(src).toContain('decideRemediereEsec(motiv, paidDisponibil, nrDeja)')
    expect(src).toContain("dec.actiune === 'reia'")
    expect(src).toContain('remediazaAutomatBuildJob(id, nota)')
    // contorul anti-buclă în kv (nu bucla la infinit)
    expect(src).toContain('remediere:count:')
    // escaladarea creierului se decide din rezerva paid MĂSURATĂ, nu presupusă
    expect(src).toContain('paidDisponibil')
  })
})
