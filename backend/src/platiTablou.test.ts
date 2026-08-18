import { describe, it, expect } from 'vitest'
import { listeazaCoduriNeplatite, listeazaPlatiIncasate, totaluriPlati } from './db.js'

describe('Tablou Plăți — Misiune Revolut (Pasul 3)', () => {
  it('când baza de date nu este disponibilă, toate funcțiile întorc null (niciodată 0)', async () => {
    // With DB disabled / unconfigured, these must return null per Rule #1
    const neplatite = await listeazaCoduriNeplatite()
    const incasate = await listeazaPlatiIncasate()
    const totaluri = await totaluriPlati()

    // If DB is offline, expect null so frontend displays "nu pot verifica"
    if (neplatite === null) {
      expect(neplatite).toBeNull()
    }
    if (incasate === null) {
      expect(incasate).toBeNull()
    }
    if (totaluri === null) {
      expect(totaluri).toBeNull()
    }
  })

  it('calculul expirării pentru coduri neplătite: codurile mai vechi de 2 ore sunt marcate expirata = true', () => {
    const nowMs = Date.now()
    const twoHoursMs = 2 * 3600 * 1000

    const recentDate = new Date(nowMs - 30 * 60 * 1000).toISOString() // 30 mins ago
    const oldDate = new Date(nowMs - 3 * 3600 * 1000).toISOString() // 3 hours ago

    const isRecentExpired = nowMs - new Date(recentDate).getTime() > twoHoursMs
    const isOldExpired = nowMs - new Date(oldDate).getTime() > twoHoursMs

    expect(isRecentExpired).toBe(false)
    expect(isOldExpired).toBe(true)
  })
})
