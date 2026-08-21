// ── REMEDIEREA AUTOMATĂ — dovada deciziei pe fiecare clasă de eșec ────────────
// Owner, 19 aug: „la eșec, imediat analiză + decizie + remediere, AUTOMAT;
// recomandări CLARE și FERME". Decizia e pură (decideRemediereEsec) — probată aici
// pe fiecare clasă + pe garda anti-BUCLĂ (MAX → raportează). Constructorul e
// FREE-LOCAL unic (paidul a fost scos, 20 aug): nu mai există escaladare pe plătit.
import { describe, it, expect } from 'vitest'
import { decideRemediereEsec, MAX_AUTO_REMEDIERI } from './services/remediereEsec.js'

describe('decideRemediereEsec — analiză + decizie fermă pe fiecare clasă', () => {
  // ── PERMANENT (config/cheie): OPREȘTE, nu arde ────────────────────────────
  it('pungă goală / credit / 402 / extra usage → OPRIRE (nu reîncerca)', () => {
    for (const log of ['FĂRĂ CREDIT API', 'your credit balance is too low', 'HTTP 402 extra usage']) {
      const d = decideRemediereEsec(log, 0)
      expect(d.actiune).toBe('oprire')
      expect(d.clasa).toBe('permanent')
      expect(d.recomandare).toMatch(/^OPREȘTE/)
    }
  })
  it('cheie respinsă (401 / invalid key) → OPRIRE', () => {
    const d = decideRemediereEsec('authentication_error: invalid api-key', 0)
    expect(d.actiune).toBe('oprire')
    expect(d.clasa).toBe('permanent')
  })

  // ── PLASA ANTI-BUCLĂ: după MAX auto-remedieri → RAPORTEAZĂ (nu bucla) ───────
  it('după MAX_AUTO_REMEDIERI → RAPORTEAZĂ, chiar dacă eșecul ar fi reparabil', () => {
    const d = decideRemediereEsec('build picat: teste roșii', MAX_AUTO_REMEDIERI)
    expect(d.actiune).toBe('raporteaza')
    expect(d.recomandare).toMatch(/^RAPORTEAZĂ/)
  })
  it('permanentul are prioritate peste anti-buclă (rămâne OPRIRE)', () => {
    const d = decideRemediereEsec('credit balance is too low', MAX_AUTO_REMEDIERI + 5)
    expect(d.actiune).toBe('oprire')
  })

  // ── VINA CREIERULUI: REIA pe creierul LOCAL free (fără escaladare paid) ─────
  it('model LOCAL free n-a produs nimic → REIA pe free', () => {
    const d = decideRemediereEsec('aider: fără nicio modificare — creierul local indisponibil', 0)
    expect(d.actiune).toBe('reia')
    expect(d.clasa).toBe('creier')
    expect(d.recomandare).toMatch(/^REIA/)
    expect(d.recomandare).toMatch(/local|free/i)
  })
  it('throttle / 429 / sugrumat = vină creier → REIA pe free', () => {
    const d = decideRemediereEsec('429 rate limit — sugrumat', 0)
    expect(d.actiune).toBe('reia')
    expect(d.clasa).toBe('creier')
  })

  // ── VINA CODULUI: REIA cu instrucțiune de reparare ─────────────────────────
  it('poartă/build/test roșu = vină cod → REIA (reparare în cod, nu creierul)', () => {
    for (const log of ['poarta „cod duplicat (jscpd)" a picat', 'npm build a picat: tsc error', 'teste roșii', 'bootul pe dist a picat']) {
      const d = decideRemediereEsec(log, 0)
      expect(d.actiune).toBe('reia')
      expect(d.clasa).toBe('cod')
      expect(d.recomandare).toMatch(/cod|repar/i)
    }
  })

  // ── NECUNOSCUT: nu reîncerca ORB ──────────────────────────────────────────
  it('cauză neclasificată → RAPORTEAZĂ (nu reîncerca orb)', () => {
    const d = decideRemediereEsec('ceva ciudat fără semnătură clară', 0)
    expect(d.actiune).toBe('raporteaza')
    expect(d.clasa).toBe('necunoscut')
  })

  // ── Recomandările sunt CLARE și FERME (încep cu verbul deciziei) ───────────
  it('fiecare recomandare e fermă — începe cu OPREȘTE/REIA/RAPORTEAZĂ', () => {
    const cazuri: Array<[string, number]> = [
      ['credit balance is too low', 0],
      ['fără nicio modificare', 0],
      ['teste roșii', 0],
      ['ceva necunoscut', 0],
      ['orice', MAX_AUTO_REMEDIERI],
    ]
    for (const [log, nr] of cazuri) {
      const d = decideRemediereEsec(log, nr)
      expect(d.recomandare).toMatch(/^(OPREȘTE|REIA|RAPORTEAZĂ)/)
    }
  })
})

describe('cablajul auto-remedierii — ruta de raport acționează pe decizie', () => {
  it('ruta /report cheamă decideRemediereEsec și repune în coadă pe „reia"', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(fileURLToPath(new URL('./routes/constructor.ts', import.meta.url)), 'utf8')
    expect(src).toContain('decideRemediereEsec(motiv, nrDeja)')
    expect(src).toContain("dec.actiune === 'reia'")
    expect(src).toContain('remediazaAutomatBuildJob(id, nota)')
    // contorul anti-buclă în kv (nu bucla la infinit)
    expect(src).toContain('remediere:count:')
  })
})
