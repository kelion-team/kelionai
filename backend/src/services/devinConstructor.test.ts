import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mochez clientul Devin (HTTP) — testăm DOAR logica dispecerului.
const creeaza = vi.fn()
const stare = vi.fn()
const asigura = vi.fn(() => Promise.resolve({ ok: true }))
vi.mock('./devin.js', () => ({
  creeazaSesiuneDevin: (...a: unknown[]) => creeaza(...a),
  stareSesiuneDevin: (...a: unknown[]) => stare(...a),
  asiguraTokenRepoLaDevin: () => asigura(),
}))

import { construiestePromptDevin, descrieProgresDevin, porneisteJobDevin, verificaJobDevin } from './devinConstructor.js'

describe('devinConstructor — dispecerul', () => {
  beforeEach(() => {
    creeaza.mockReset()
    stare.mockReset()
    asigura.mockReset()
    asigura.mockResolvedValue({ ok: true })
  })

  it('promptul îi spune lui Devin: repo, master, PR pe master, verde, NU merge, secret de clonare', () => {
    const p = construiestePromptDevin('repară chatul vocal')
    expect(p).toMatch(/kelion-team\/kelionai/)
    expect(p).toMatch(/master/)
    expect(p).toMatch(/repară chatul vocal/)
    expect(p).toMatch(/Pull Request TO master/i)
    expect(p).toMatch(/Do NOT merge/i)
    expect(p).toMatch(/GREEN|tsc|vitest|verifica-/)
    expect(p).toMatch(/KELION_GH_TOKEN/) // îi dăm secretul de acces la repo
  })

  it('bara e REALĂ (stare · minute · ACU), fără procent inventat', () => {
    const pr = descrieProgresDevin({ status: 'working', gata: false, prUrl: null, acu: 3.2, brut: {} }, 12 * 60000)
    expect(pr.bara).toContain('Devin: working')
    expect(pr.bara).toContain('12 min')
    expect(pr.bara).toContain('3.2 ACU')
    expect(pr.procent).toBeNull() // NU inventăm procent — bară indeterminată
    expect(pr.gata).toBe(false)
  })

  it('bara pe „gata" duce mai departe linkul PR', () => {
    const pr = descrieProgresDevin(
      { status: 'finished', gata: true, prUrl: 'https://github.com/kelion-team/kelionai/pull/1300', acu: null, brut: {} },
      0,
    )
    expect(pr.gata).toBe(true)
    expect(pr.prUrl).toBe('https://github.com/kelion-team/kelionai/pull/1300')
    expect(pr.bara).toContain('Devin: finished') // fără minute/ACU dacă lipsesc — nimic inventat
  })

  it('porneisteJobDevin asigură accesul la repo ÎNAINTE, apoi creează sesiunea', async () => {
    creeaza.mockResolvedValue({ sessionId: 'sess-9', url: 'https://app.devin.ai/sessions/sess-9' })
    const r = await porneisteJobDevin('repară X', 'Ordin #7')
    expect(asigura).toHaveBeenCalled() // accesul la repo e asigurat mai întâi
    expect(r.sessionId).toBe('sess-9')
    const [prompt, opts] = creeaza.mock.calls[0]
    expect(String(prompt)).toMatch(/repară X/)
    expect((opts as { title?: string }).title).toBe('Ordin #7')
  })

  it('porneisteJobDevin NU pornește sesiunea dacă lipsește accesul la repo (numit)', async () => {
    asigura.mockResolvedValueOnce({ ok: false, motiv: 'lipsă token' })
    await expect(porneisteJobDevin('repară X')).rejects.toThrow(/devin_fara_acces_repo/)
    expect(creeaza).not.toHaveBeenCalled() // nu ardem o sesiune (bani) dacă oricum ar pica la clonare
  })

  it('verificaJobDevin întoarce progresul real din starea sesiunii', async () => {
    stare.mockResolvedValue({ status: 'working', gata: false, prUrl: null, acu: 1.5, brut: {} })
    const pr = await verificaJobDevin('sess-9', 60000)
    expect(pr.stare).toBe('working')
    expect(pr.bara).toContain('1 min')
    expect(pr.bara).toContain('1.5 ACU')
  })
})
