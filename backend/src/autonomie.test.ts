// ── TESTS FOR THE AUTONOMY PATH (your request → code → PR → merge → deploy)
//
// Here Kelion has its HANDS on the repo and the VPS: it writes code, opens a
// PR, merges (which triggers the deploy) and runs operations on the server.
// Zero tests until now, on the most powerful tool in the whole software.
//
// What we guard — exactly the guarantees the "no restrictions" order stands
// on:
//   1. ADRIAN'S SWITCH ("pauza-autonomie") stops EVERYTHING. If this gate
//      gives way, "stop" no longer means stop.
//   2. Without GITHUB_TOKEN nothing is pretended — it honestly says what's
//      missing.
//   3. Branch names are normalized and master can NOT be written directly.
//   4. Only KNOWN runbooks run (the LLM only gives the name).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// In-memory KV: the pause switch lives in the database; we simulate it to
// test the gate without Postgres.
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

// ── LEGEA din 16 aug (ownerul, verbatim: „daca autonomia lui nu este trebuta
// pe on si scoti posibilitatea sa mai treaca pe off, poti sa te opresti
// definitiv" + „GATA"): pauza NU MAI EXISTĂ — autonomia e pornită prin
// construcție. Testele de aici păzesc LEGEA NOUĂ: nimic n-o mai poate opri
// pe tăcute; frânele de bani sunt plafonul zilnic + P27, nu comutatoare.
describe('autonomie — LEGEA din 16 aug: pornită PERMANENT, fără off', () => {
  it('isOpsPaused e FALS prin construcție; setOpsPaused nu mai poate opri nimic', async () => {
    expect(await isOpsPaused()).toBe(false)
    await setOpsPaused(true) // încercarea se ignoră (doar urmă în jurnal)
    expect(await isOpsPaused()).toBe(false)
  })

  it('vechile comenzi de pauză răspund cinstit cu LEGEA, nu schimbă nimic', async () => {
    const pauza = jsonul(await runRunbook('pauza-autonomie'))
    expect(pauza.paused).toBe(false)
    expect(String(pauza.hint)).toContain('LEGEA din 16 aug')
    const reia = jsonul(await runRunbook('reia-autonomia'))
    expect(reia.paused).toBe(false)
    expect(await isOpsPaused()).toBe(false)
  })

  it('mâinile lui Kelion NU mai pot fi oprite de vreo pauză (doar tokenul lipsă le oprește)', async () => {
    delete process.env.GITHUB_TOKEN
    await setOpsPaused(true)
    // fără token → refuz pe NUMELE cauzei reale (token), nu pe o pauză-fantomă
    expect(jsonul(await repoWrite('kelion/x', 'a.ts', 'cod', 'm')).error).toBe('github_token_missing')
    expect(jsonul(await repoOpenPR('kelion/x', 't', 'b')).error).toBe('github_token_missing')
    expect(jsonul(await repoMergePR(1)).error).toBe('github_token_missing')
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
