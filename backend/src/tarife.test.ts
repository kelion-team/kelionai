import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── MENIUL DE PREȚURI AL EXTRA-SERVICIILOR (owner, 14 aug) ───────────────────
// Promisiunile ținute aici: (1) prețul afișat = prețul taxat (o singură sursă);
// (2) reglabil din env fără deploy; (3) taxarea vine ÎNAINTE de consum, refuză
// pe sold insuficient CU cifra lipsă, și nu taxează pe portofel necitit;
// (4) rambursul întoarce exact ce s-a scăzut; (5) ownerul nu plătește la el acasă.

const portofel = { citit: true as const, sold: 10 }
const scazute: { email: string; suma: number; meta: string }[] = []
const acordate: { email: string; suma: number }[] = []

vi.mock('./db.js', () => ({
  citesteSold: async () => ({ ...portofel }),
  debitWallet: async (email: string, suma: number, meta: string) => {
    scazute.push({ email, suma, meta })
  },
  grantCredit: async (email: string, suma: number) => {
    acordate.push({ email, suma })
  },
}))

import { meniulDeTarife, creditePentru, lirePentru, cheiaTarifVideo, taxeazaServiciu } from './services/tarife.js'
import { config } from './config.js'

beforeEach(() => {
  portofel.sold = 10
  scazute.length = 0
  acordate.length = 0
  for (const t of meniulDeTarife()) delete process.env[t.env]
})

describe('meniul de prețuri — o singură sursă, cu profitul copt înăuntru', () => {
  it('acoperă serviciile plătite: video (3 trepte), imagine, CV', () => {
    const chei = meniulDeTarife().map((t) => t.cheie)
    for (const c of ['video_lite', 'video_fast', 'video_preview', 'imagine', 'cv'])
      expect(chei, `lipsește tariful ${c}`).toContain(c)
  })
  it('prețul în lire = credite × valoarea creditului (aceeași aritmetică peste tot)', () => {
    expect(lirePentru('imagine')).toBeCloseTo((creditePentru('imagine') ?? 0) * config.billing.creditValue)
  })
  it('reglabil din env, fără deploy', () => {
    process.env.TARIF_IMAGINE = '3'
    expect(creditePentru('imagine')).toBe(3)
  })
  it('modelul Veo activ se mapează pe treapta lui de tarif', () => {
    expect(cheiaTarifVideo('veo-3.1-lite-generate-preview')).toBe('video_lite')
    expect(cheiaTarifVideo('veo-3.1-fast-generate-preview')).toBe('video_fast')
    expect(cheiaTarifVideo('veo-3.1-generate-preview')).toBe('video_preview')
  })
})

describe('taxarea — înainte de consum, cinstită la refuz și la ramburs', () => {
  it('taxează exact prețul din meniu, cu numele serviciului în registru', async () => {
    const t = await taxeazaServiciu('client@example.com', 'imagine', false)
    expect(t.ok).toBe(true)
    expect(scazute).toHaveLength(1)
    expect(scazute[0].suma).toBeCloseTo(lirePentru('imagine') ?? -1)
    expect(scazute[0].meta).toBe('tarif:imagine')
  })
  it('sold insuficient → refuz CU cifra lipsă, fără nicio scădere', async () => {
    portofel.sold = 0.05
    const t = await taxeazaServiciu('client@example.com', 'cv', false)
    expect(t.ok).toBe(false)
    if (!t.ok) expect(t.motiv).toMatch(/reîncarcă măcar £/)
    expect(scazute).toHaveLength(0)
  })
  it('serviciu fără tarif → refuz („nu taxez pe ghicite"), fără scădere', async () => {
    const t = await taxeazaServiciu('client@example.com', 'nu-exista', false)
    expect(t.ok).toBe(false)
    expect(scazute).toHaveLength(0)
  })
  it('rambursul întoarce EXACT ce s-a scăzut', async () => {
    const t = await taxeazaServiciu('client@example.com', 'video_fast', false)
    expect(t.ok).toBe(true)
    if (t.ok) await t.ramburseaza()
    expect(acordate).toHaveLength(1)
    expect(acordate[0].suma).toBeCloseTo(scazute[0].suma)
  })
  it('ownerul nu se taxează la el acasă', async () => {
    const t = await taxeazaServiciu(config.adminEmail, 'video_preview', true)
    expect(t.ok).toBe(true)
    expect(scazute).toHaveLength(0)
  })
})
