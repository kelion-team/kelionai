import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { googleTools } from './services/google.js'

// ── LACĂTUL ARSENALULUI AGENȚILOR (Adrian, 5 aug) ────────────────────────────
// „nu are uneltele pentru tot ce are nevoie... instalează-i tot". Paznicul
// ține blindajul pe loc: agenții pleacă cu căutare + pagini + TOATE skill-urile
// Google (publice pentru oricine; personale doar pe căile ownerului), prin
// ACEEAȘI sursă unică pe care merge chat-ul (runGoogleTool). Cine subțiază
// arsenalul sau ocolește sursa unică pică AICI, în porți, la orice PR.
const SRC = readFileSync(
  fileURLToPath(new URL('./services/agentiKelion.ts', import.meta.url)),
  'utf8',
)

describe('agenți — lacătul arsenalului complet', () => {
  it('agenții primesc TOATE skill-urile Google prin sursa unică (googleTools + runGoogleTool)', () => {
    expect(SRC).toContain('googleTools')
    expect(SRC).toContain('runGoogleTool')
    expect(SRC).toContain('GOOGLE_TOOLS_PUBLICE')
    expect(SRC).toContain('GOOGLE_TOOLS_PERSONALE')
  })

  it('uneltele publice acoperă faptele de zi cu zi (vreme, hărți, ora, valute...)', () => {
    for (const nume of [
      'get_weather', 'maps_search', 'maps_directions', 'lookup_address', 'youtube_search',
      'translate_text', 'wikipedia_lookup', 'convert_currency', 'get_time',
    ]) {
      expect(SRC, `unealta publică „${nume}" a dispărut din arsenalul agenților`).toContain(`'${nume}'`)
      expect(googleTools.some((t) => t.name === nume), `„${nume}" nu mai există în googleTools`).toBe(true)
    }
  })

  it('datele personale NU ies pe endpointul public: personalele cer caAdmin', () => {
    // Garda din bucla de unelte: o unealtă personală fără caAdmin întoarce
    // refuz, nu date. Cine o scoate pică aici.
    expect(SRC).toContain('unealta_personala_doar_pentru_owner')
    expect(SRC).toContain('tokenGoogleOwner')
  })

  it('ancora de timp există: agenții primesc data REALĂ, nu din memoria modelului', () => {
    // Bugul prins de proba vie din 5 aug („azi e 4 august" pe 5 august).
    expect(SRC).toContain('formatNowContext')
    expect(SRC).toContain('ACUM este:')
  })

  it('creierul NU are voie să-și nege inventarul („kelion îmi zice că nu are unelte")', () => {
    // Regula anti-negare din inventarulMeu — cine o scoate pică poarta.
    const cap = readFileSync(
      fileURLToPath(new URL('./services/brainCapabilities.ts', import.meta.url)),
      'utf8',
    )
    expect(cap).toContain('INTERZIS')
    expect(cap).toContain('nu am unelte')
    expect(cap).toContain('negarea lor e o MINCIUNĂ')
  })
})
