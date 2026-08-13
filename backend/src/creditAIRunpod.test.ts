import { describe, it, expect, vi } from 'vitest'

// ── DOVADA: RunPod/DeepInfra fără SOLD FABRICAT (owner, 13 aug) ──────────────
// Owner, pe becul LIVE: „0 USD" roșu la „RunPod" deși constructorul e pe DeepInfra
// (care are credit, doar că nu-l expune prin API). Bugul: `balanceUsd ?? 0` punea
// un 0 fabricat → bec roșu fals (exact „£0.00"). Aici probăm cele trei cazuri pe
// măsurători: DeepInfra servește → VERDE (nu roșu-0), RunPod sold 0 → ROȘU (real),
// RunPod sold > 0 → VERDE. Mock DOAR pe getRunpodBalance; restul rândurilor n-au
// chei în test → pică cinstit în „nu pot verifica".

const getRunpodBalance = vi.hoisted(() => vi.fn())
vi.mock('./services/runpodBalance.js', () => ({ getRunpodBalance }))

import { crediteAI, beculCredit } from './services/creditAI.js'

const randConstructor = async () => {
  const rows = await crediteAI()
  const c = rows.find((r) => r.furnizor.includes('creierul constructorului'))
  expect(c, 'rândul creierului constructorului lipsește din raport').toBeTruthy()
  return c!
}

describe('creditAI — creierul constructorului: fără sold fabricat', () => {
  it('DeepInfra SERVEȘTE dar nu expune sold → NU „0 USD" fabricat, bec VERDE', async () => {
    getRunpodBalance.mockResolvedValue({ ok: true, provider: 'DeepInfra', live: true })
    const c = await randConstructor()
    // Cheia dovezii: ramas NU e o cifră măsurată (asta era bugul: un 0 fals).
    expect(c.ramas.masurat).toBe(false)
    expect(c.soldReal).toBeFalsy()
    expect(c.furnizor).toContain('DeepInfra')
    // Servește = are credit = VERDE, nu roșu-0.
    expect(beculCredit(c)).toBe('verde')
  })

  it('RunPod cu sold real 0 → ROȘU (aici 0 chiar înseamnă fără credit / 402)', async () => {
    getRunpodBalance.mockResolvedValue({ ok: true, provider: 'RunPod', live: true, balanceUsd: 0 })
    const c = await randConstructor()
    expect(c.soldReal).toBe(true)
    expect(beculCredit(c)).toBe('rosu')
  })

  it('RunPod cu sold real 5.84 → VERDE (are credit)', async () => {
    getRunpodBalance.mockResolvedValue({ ok: true, provider: 'RunPod', live: true, balanceUsd: 5.84 })
    const c = await randConstructor()
    expect(c.ramas.masurat).toBe(true)
    expect(c.soldReal).toBe(true)
    expect(beculCredit(c)).toBe('verde')
  })
})
