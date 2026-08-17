// Ordinul verbatim (owner, 15 aug): „acest lucru trebuie să fie monitorizat de
// Kelion" — publicarea care STĂ e o stare, nu o eroare: nu scrie nimic în
// loguri, deci senzorii pe erori n-o văd. Contractele senzorului:
// (1) citire GitHub picată → NICIUN verdict (nu inventăm stagnare);
// (2) vârf nou de master → pornește ceasul, fără alarmă;
// (3) același vârf peste prag → alarmă O SINGURĂ dată, cu coada logului lângă;
// (4) live ajunge master după alarmă → „și-a revenit", o dată, și starea moare.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const kv = new Map<string, string>()
vi.mock('./db.js', () => ({
  saveKv: vi.fn(async (k: string, v: string) => void kv.set(k, v)),
  loadKv: vi.fn(async (k: string) => kv.get(k) ?? null),
  deleteKv: vi.fn(async (k: string) => void kv.delete(k)),
}))
const ghMock = vi.fn()
vi.mock('./services/githubApi.js', () => ({ gh: (...a: unknown[]) => ghMock(...a) }))
const notifica = vi.fn(async () => 1)
vi.mock('./services/adminNotification.js', () => ({ notifyAdmin: (...a: unknown[]) => notifica(...a) }))
vi.mock('./services/logGazda.js', () => ({
  coadaLogGazda: vi.fn(async () => ({ ok: true, text: 'linie normală\neroare: build a picat' })),
  semnaturiEroare: vi.fn(() => ['eroare: build a picat']),
}))

import { ruleazaSantinelaPublicarii } from './services/santinelaPublicarii.js'

const cuMaster = (sha: string): void => {
  ghMock.mockResolvedValue({ ok: true, json: async () => ({ sha }) })
}

beforeEach(() => {
  kv.clear()
  ghMock.mockReset()
  notifica.mockClear()
  process.env.GIT_COMMIT_SHA = 'aaaaaaa1234'
  process.env.SANTINELA_PUBLICARE_PRAG_MIN = '20'
})

describe('santinela publicării', () => {
  it('GitHub necitibil → niciun verdict, nicio alarmă (nu inventăm)', async () => {
    ghMock.mockResolvedValue({ ok: false })
    const r = await ruleazaSantinelaPublicarii()
    expect(r.master).toBeNull()
    expect(notifica).not.toHaveBeenCalled()
  })

  it('vârf nou de master → pornește ceasul, fără alarmă', async () => {
    cuMaster('bbbbbbb999')
    const r = await ruleazaSantinelaPublicarii()
    expect(r.alarma).toBe(false)
    expect(JSON.parse(kv.get('santinela:publicare') ?? '{}').masterSha).toBe('bbbbbbb')
    expect(notifica).not.toHaveBeenCalled()
  })

  it('același vârf peste prag → alarmă O SINGURĂ dată, cu semnele logului', async () => {
    cuMaster('bbbbbbb999')
    kv.set('santinela:publicare', JSON.stringify({
      masterSha: 'bbbbbbb',
      vazutLa: new Date(Date.now() - 45 * 60_000).toISOString(),
    }))
    const intai = await ruleazaSantinelaPublicarii()
    expect(intai.alarma).toBe(true)
    expect(notifica).toHaveBeenCalledTimes(1)
    expect(String(notifica.mock.calls[0][1])).toContain('STĂ')
    expect(String(notifica.mock.calls[0][2])).toContain('build a picat')
    const aDoua = await ruleazaSantinelaPublicarii()
    expect(aDoua.alarma).toBe(false)
    expect(notifica).toHaveBeenCalledTimes(1) // nu spamăm la fiecare ciclu
  })

  it('live ajunge master după alarmă → „și-a revenit" o dată și starea moare', async () => {
    cuMaster('aaaaaaa1234')
    kv.set('santinela:publicare', JSON.stringify({
      masterSha: 'ccccccc', vazutLa: new Date().toISOString(), anuntat: true,
    }))
    await ruleazaSantinelaPublicarii()
    expect(notifica).toHaveBeenCalledTimes(1)
    expect(String(notifica.mock.calls[0][0])).toBe('publicare_ok')
    expect(kv.has('santinela:publicare')).toBe(false)
  })
})
