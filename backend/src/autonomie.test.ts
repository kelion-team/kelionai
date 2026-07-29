// ── TESTELE CĂII DE AUTONOMIE (cererea ta → cod → PR → merge → deploy) ──────
//
// Aici Kelion are MÂINILE pe repo și pe VPS: scrie cod, deschide PR, dă merge
// (ceea ce declanșează publicarea) și rulează operațiuni pe server. Zero teste
// până acum, pe cea mai puternică unealtă din tot softul.
//
// Ce apărăm — exact garanțiile pe care se sprijină ordinul „fără restricții":
//   1. ÎNTRERUPĂTORUL LUI ADRIAN („pauza-autonomie") oprește TOT. Dacă poarta
//      asta cedează, „stop" nu mai înseamnă stop.
//   2. Fără GITHUB_TOKEN nu se pretinde nimic — se spune sincer ce lipsește.
//   3. Numele de ramură se normalizează și master NU poate fi scris direct.
//   4. Numai runbook-urile CUNOSCUTE rulează (LLM-ul dă doar numele).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// KV în memorie: comutatorul de pauză trăiește în baza de date; îl simulăm ca să
// testăm poarta fără Postgres.
const kv = new Map<string, string>()
vi.mock('./db.js', () => ({
  loadKv: async (k: string) => kv.get(k) ?? null,
  saveKv: async (k: string, v: string) => {
    kv.set(k, v)
  },
  saveWorkOrder: async () => 1,
}))
vi.mock('./services/mail.js', () => ({ sendMail: async () => true }))
vi.mock('./config.js', () => ({
  config: { adminEmail: 'adrianenc11@gmail.com', frontendOrigin: 'https://kelionai.app' },
}))

const { normalizeBranch, isValidBranch, repoWrite, repoOpenPR, repoMergePR } = await import('./services/github.js')
const { validateRunbook, runRunbook, isOpsPaused, setOpsPaused, RUNBOOKS } = await import('./services/runbooks.js')

const jsonul = (s: string): Record<string, unknown> => JSON.parse(s) as Record<string, unknown>

beforeEach(() => {
  kv.clear()
  delete process.env.GITHUB_TOKEN
})
afterEach(() => vi.restoreAllMocks())

describe('autonomie — numele de ramură (nu se scrie pe master)', () => {
  it('normalizează spațiile, diacriticele și semnele', () => {
    expect(normalizeBranch('  Fix Microfon  ')).not.toMatch(/\s/)
    expect(normalizeBranch('kelion/fix microfon')).toMatch(/^[\w./-]+$/)
  })
  it('RESPINGE master și main — publicarea trece obligatoriu prin PR', () => {
    expect(isValidBranch('master')).toBe(false)
    expect(isValidBranch('main')).toBe(false)
  })
  it('acceptă un nume normal de ramură', () => {
    expect(isValidBranch('kelion/fix-microfon')).toBe(true)
  })
  it('respinge numele goale sau doar din semne', () => {
    expect(isValidBranch('')).toBe(false)
    expect(isValidBranch('///')).toBe(false)
  })
})

describe('autonomie — fără GITHUB_TOKEN nu se pretinde nimic', () => {
  it('scrierea de cod spune sincer ce lipsește', async () => {
    const r = jsonul(await repoWrite('kelion/x', 'a.ts', 'cod', 'mesaj'))
    expect(r.error).toBe('github_token_missing')
    expect(String(r.hint)).toContain('GITHUB_TOKEN')
  })
  it('deschiderea de PR la fel', async () => {
    expect(jsonul(await repoOpenPR('kelion/x', 't', 'b')).error).toBe('github_token_missing')
  })
  it('merge-ul (care PUBLICĂ în producție) la fel', async () => {
    expect(jsonul(await repoMergePR(123)).error).toBe('github_token_missing')
  })
})

describe('autonomie — ÎNTRERUPĂTORUL lui Adrian („pauza-autonomie")', () => {
  it('pornit din runbook, oprește TOATE acțiunile autonome', async () => {
    process.env.GITHUB_TOKEN = 'token-de-test' // token prezent: doar pauza mai poate opri
    expect(await isOpsPaused()).toBe(false)

    const pauza = jsonul(await runRunbook('pauza-autonomie'))
    expect(pauza.paused).toBe(true)
    expect(await isOpsPaused()).toBe(true)

    // Cu pauza pornită, NICIUNA din mâinile lui Kelion nu mai mișcă.
    expect(jsonul(await repoWrite('kelion/x', 'a.ts', 'cod', 'm')).error).toBe('paused_by_owner')
    expect(jsonul(await repoOpenPR('kelion/x', 't', 'b')).error).toBe('paused_by_owner')
    expect(jsonul(await repoMergePR(1)).error).toBe('paused_by_owner')
    expect(jsonul(await runRunbook('diagnostic')).error).toBe('paused_by_owner')
  })

  it('„reia-autonomia" ridică pauza — și numai Adrian o poate da', async () => {
    await setOpsPaused(true)
    expect(await isOpsPaused()).toBe(true)
    const r = jsonul(await runRunbook('reia-autonomia'))
    expect(r.paused).toBe(false)
    expect(await isOpsPaused()).toBe(false)
  })

  it('comenzile de pauză merg CHIAR ȘI fără token (nu depind de GitHub)', async () => {
    // Dacă „stop" ar avea nevoie de token, ar putea eșua exact când e mai nevoie.
    delete process.env.GITHUB_TOKEN
    expect(jsonul(await runRunbook('pauza-autonomie')).paused).toBe(true)
  })
})

describe('autonomie — numai runbook-uri CUNOSCUTE rulează', () => {
  it('un nume inventat de model e respins, cu lista celor reale', () => {
    const v = validateRunbook('sterge-tot-serverul')
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.error).toBe('unknown_runbook')
      expect(v.known.length).toBeGreaterThan(0)
    }
  })
  it('un runbook real trece și poartă un workflow', () => {
    const nume = Object.keys(RUNBOOKS)[0]
    const v = validateRunbook(nume)
    expect(v.ok).toBe(true)
    if (v.ok) expect(v.rb.workflow).toBeTruthy()
  })
  it('runRunbook refuză numele necunoscut ÎNAINTE de a atinge rețeaua', async () => {
    process.env.GITHUB_TOKEN = 'token-de-test'
    const fetchSpion = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('nu trebuia chemată rețeaua pentru un runbook necunoscut')
    })
    expect(jsonul(await runRunbook('inventat')).error).toBe('unknown_runbook')
    expect(fetchSpion).not.toHaveBeenCalled()
  })
})
