import { describe, it, expect, vi, beforeEach } from 'vitest'

// PAZNICUL CARDULUI (Adrian, 31 iul: „să opereze pentru mine când îi cer doar
// eu, folosind sistemul de recunoaștere vocală" · „plățile automate").
//
// Testul ăsta apără trei lucruri pe care nu am voie să le stric niciodată:
//   1. fără voce recunoscută, cardul NU se atinge — nici măcar dacă cel care
//      cere e admin, cu sesiune validă;
//   2. valoarea cardului nu apare în NICIUN rezultat întors — nici în text,
//      nici în pagină, nici în detaliu;
//   3. „gata" înseamnă ce a MĂSURAT codul pe pagină, nu ce a spus modelul.

const browserType = vi.hoisted(() => vi.fn(async () => ({ url: 'u', title: 't', text: 'PAGINA', elements: [], shotUrl: '' })))
const browserRead = vi.hoisted(() => vi.fn(async () => ({ url: 'u', title: 't', text: 'PAGINA', elements: [], shotUrl: '' })))
const setModDiscret = vi.hoisted(() => vi.fn())
const kv = vi.hoisted(() => new Map<string, string>())

vi.mock('./services/browser.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./services/browser.js')>()),
  browserType, browserRead, setModDiscret,
}))
vi.mock('./db.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./db.js')>()),
  saveKv: async (k: string, v: string) => { kv.set(k, v) },
  loadKv: async (k: string) => kv.get(k) ?? null,
}))

import { completeazaCard, terminaCard, stareFurnizori, platiAutomatePornite, cardConfigurat } from './services/cardFurnizor.js'
import { marcheazaVoce } from './services/adminLock.js'
import { mascheazaCifre } from './services/browser.js'

const CARD = '4242424242424242'
const EU = 'owner@test.ro'

beforeEach(() => {
  kv.clear()
  browserType.mockClear()
  process.env.CARD_NUMAR = CARD
  process.env.CARD_EXPIRARE = '12/29'
  process.env.CARD_CVC = '123'
  process.env.CARD_NUME = 'A N'
})

describe('cardFurnizor — poarta e vocea, nu sesiunea', () => {
  it('FĂRĂ voce recunoscută: refuză, și nu atinge pagina deloc', async () => {
    const r = await completeazaCard('nimeni@test.ro', 'https://kelionai.app', 'numar', 3)
    expect(r.ok).toBe(false)
    expect(r.detaliu).toContain('voce')
    expect(browserType).not.toHaveBeenCalled()
  })

  it('CU voce recunoscută: scrie valoarea în pagină, dar n-o întoarce nicăieri', async () => {
    marcheazaVoce(EU)
    const r = await completeazaCard(EU, 'https://kelionai.app', 'numar', 3)
    expect(r.ok).toBe(true)
    // Serverul a scris valoarea…
    expect(browserType).toHaveBeenCalledWith(EU, 'https://kelionai.app', 3, CARD, false)
    // …dar ea NU apare în nimic din ce pleacă spre model/jurnal.
    expect(JSON.stringify(r)).not.toContain(CARD)
    // Și modul discret e pornit ÎNAINTE de scriere, nu lăsat în seama nimănui.
    expect(setModDiscret).toHaveBeenCalledWith(EU, true)
  })

  it('valoare neconfigurată → spune CE lipsește, nu completează la nimereală', async () => {
    marcheazaVoce(EU)
    delete process.env.CARD_CVC
    const r = await completeazaCard(EU, 'https://kelionai.app', 'cvc', 4)
    expect(r.ok).toBe(false)
    expect(r.detaliu).toContain('CARD_CVC')
    expect(browserType).not.toHaveBeenCalled()
    expect(cardConfigurat().lipsesc).toContain('cvc')
  })

  it('cifrele lungi se maschează — un PAN nu poate ieși prin textul paginii', () => {
    expect(mascheazaCifre(`plătit cu ${CARD} azi`)).not.toContain(CARD)
  })
})

describe('cardFurnizor — „gata" e o măsurătoare, nu o declarație', () => {
  it('pagina arată card + reîncărcare automată → notat, plăți automate DOVEDITE', async () => {
    browserRead.mockResolvedValueOnce({ url: 'u', title: 't', text: 'Visa •••• 4242 · Auto-recharge is on', elements: [], shotUrl: '' })
    const r = await terminaCard(EU, 'https://kelionai.app', 'OpenRouter')
    expect(r.card).toBe(true)
    expect(r.automat).toBe(true)
    expect((await stareFurnizori())[0]?.furnizor).toBe('openrouter')
    expect(await platiAutomatePornite()).toBe(true)
  })

  it('card pus, dar FĂRĂ plată automată → nu se declară gata; îi spune ce mai are de făcut', async () => {
    browserRead.mockResolvedValueOnce({ url: 'u', title: 't', text: 'Card ending in 4242', elements: [], shotUrl: '' })
    const r = await terminaCard(EU, 'https://kelionai.app', 'anthropic')
    expect(r.card).toBe(true)
    expect(r.automat).toBe(false)
    expect(r.detaliu).toContain('Pornește')
    expect(await platiAutomatePornite()).toBe(false)
  })

  it('pagină fără nicio urmă → nu notează NIMIC (regula #1: nu declar ce n-am măsurat)', async () => {
    browserRead.mockResolvedValueOnce({ url: 'u', title: 't', text: 'Bine ai venit', elements: [], shotUrl: '' })
    const r = await terminaCard(EU, 'https://kelionai.app', 'openai')
    expect(r.card).toBe(false)
    expect(r.automat).toBe(false)
    expect(await stareFurnizori()).toEqual([])
  })

  it('citește pagina CÂT timp modul discret e pornit, și abia apoi îl stinge', async () => {
    const ordine: string[] = []
    browserRead.mockImplementationOnce(async () => { ordine.push('citire'); return { url: 'u', title: 't', text: '', elements: [], shotUrl: '' } })
    setModDiscret.mockImplementation(() => { ordine.push('discret-off') })
    await terminaCard(EU, 'https://kelionai.app', '')
    expect(ordine).toEqual(['citire', 'discret-off'])
  })
})
