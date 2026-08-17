import { describe, it, expect, afterEach } from 'vitest'
import { tabelExport, facturareGoogle, _resetFacturare } from './services/facturareGoogle.js'

// ── SOLDUL GEMINI PE CALEA OFICIALĂ (owner, 14 aug: „dacă e soluție oficială,
// de ce nu o facem?") — Cloud Billing export → BigQuery, cu contul de serviciu.
// Testele țin promisiunile regulii #1: fără cont de serviciu → motiv cinstit,
// nu cifră; numele tabelului = forma STANDARD documentată de Google.

describe('facturareGoogle — calea oficială, cinstită', () => {
  // Cache-ul citirii e de 60s — un test nu are voie să moștenească lumea altuia.
  afterEach(() => _resetFacturare())

  it('numele tabelului de export e forma standard Google (cont cu underscore)', () => {
    expect(tabelExport('011729-7DA3DA-87ED94')).toBe('gcp_billing_export_v1_011729_7DA3DA_87ED94')
  })

  it('fără cont de serviciu → ok:false cu motivul exact, nu o cifră inventată', async () => {
    // În mediul de test GOOGLE_SERVICE_ACCOUNT_JSON nu e setat → prima treaptă
    // a lanțului spune CE lipsește (nu aruncă, nu inventează 0).
    const r = await facturareGoogle()
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motiv).toContain('cont')
  })
})
