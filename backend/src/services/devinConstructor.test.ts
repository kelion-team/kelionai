import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mochez clientul Devin (HTTP), config (cheia) și db (coada) — testăm DOAR logica.
const creeaza = vi.fn()
const stare = vi.fn()
const asigura = vi.fn(() => Promise.resolve({ ok: true }))
vi.mock('./devin.js', () => ({
  creeazaSesiuneDevin: (...a: unknown[]) => creeaza(...a),
  stareSesiuneDevin: (...a: unknown[]) => stare(...a),
  asiguraTokenRepoLaDevin: () => asigura(),
}))
vi.mock('../config.js', () => ({ config: { devinKey: 'test-devin-key' } }))
const getRun = vi.fn()
const claim = vi.fn()
const report = vi.fn()
const progres = vi.fn()
const setSess = vi.fn()
vi.mock('../db.js', () => ({
  getOldestRunningBuildJob: () => getRun(),
  claimNextBuildJob: () => claim(),
  reportBuildJob: (...a: unknown[]) => report(...a),
  updateBuildJobProgress: (...a: unknown[]) => progres(...a),
  setDevinSessionId: (...a: unknown[]) => setSess(...a),
}))
const notify = vi.fn()
vi.mock('./adminNotification.js', () => ({ notifyAdmin: (...a: unknown[]) => notify(...a) }))

import { construiestePromptDevin, descrieProgresDevin, porneisteJobDevin, verificaJobDevin, tickDispecerDevin } from './devinConstructor.js'

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

describe('tickDispecerDevin — o trecere pe buclă', () => {
  beforeEach(() => {
    getRun.mockReset(); claim.mockReset(); report.mockReset(); progres.mockReset(); setSess.mockReset()
    creeaza.mockReset(); stare.mockReset(); asigura.mockReset(); asigura.mockResolvedValue({ ok: true }); notify.mockReset()
  })

  it('job Devin în lucru, finished + PR → raportează DONE + înștiințează în chat cu linkul PR', async () => {
    getRun.mockResolvedValue({ id: 5, devinSessionId: 'sess-5', createdAt: new Date(Date.now() - 120000).toISOString() })
    stare.mockResolvedValue({ status: 'finished', gata: true, prUrl: 'https://github.com/kelion-team/kelionai/pull/1300', acu: 4, brut: {} })
    await tickDispecerDevin()
    expect(report).toHaveBeenCalledWith(5, expect.objectContaining({ status: 'done', prUrl: 'https://github.com/kelion-team/kelionai/pull/1300', brain: 'devin' }))
    // linkul PR intră ȘI în chat (owner: „intră și pe chat")
    expect(notify).toHaveBeenCalled()
    const mesajNotif = notify.mock.calls[0].join(' ')
    expect(mesajNotif).toContain('https://github.com/kelion-team/kelionai/pull/1300')
    expect(claim).not.toHaveBeenCalled() // UN job pe rând — nu ia altul cât unul rulează
  })

  it('job în lucru, working → scrie bara REALĂ, nu raportează terminal', async () => {
    getRun.mockResolvedValue({ id: 5, devinSessionId: 'sess-5', createdAt: new Date().toISOString() })
    stare.mockResolvedValue({ status: 'working', gata: false, prUrl: null, acu: 2, brut: {} })
    await tickDispecerDevin()
    expect(progres).toHaveBeenCalledWith(5, expect.stringContaining('Devin: working'))
    expect(report).not.toHaveBeenCalled()
  })

  it('job running FĂRĂ sesiune → NU pornește a doua sesiune (fără bani dubli)', async () => {
    getRun.mockResolvedValue({ id: 5, devinSessionId: null, createdAt: new Date().toISOString() })
    await tickDispecerDevin()
    expect(claim).not.toHaveBeenCalled()
    expect(creeaza).not.toHaveBeenCalled()
  })

  it('nimic în lucru → claimează ordinul, pornește Devin și salvează sesiunea', async () => {
    getRun.mockResolvedValue(null)
    claim.mockResolvedValue({ id: 7, orderText: 'repară X' })
    creeaza.mockResolvedValue({ sessionId: 'sess-7', url: null })
    await tickDispecerDevin()
    expect(creeaza).toHaveBeenCalled()
    expect(setSess).toHaveBeenCalledWith(7, 'sess-7')
  })
})
