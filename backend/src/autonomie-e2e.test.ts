// ── AUTONOMY, THE WHOLE CHAIN: code → PR → checkpoint → merge → deploy ─────
//
// `autonomie.test.ts` checks WHEN Kelion refuses to work (pause, missing
// token, forbidden branch). Here we check what it does when it really WORKS —
// i.e. exactly the road code takes into production, without a human hand.
//
// We don't settle for "it returned ok:true". We check the REAL requests it
// sends: the branch is made from master's tip, the content leaves base64, the
// PR has base master, BEFORE the merge a recovery point is saved, the merge
// is squash, and master reaches the new commit (which is where the deploy
// starts from). GitHub is the one from `testing/fake-github.ts`: an unknown
// route returns 599, so nothing can pass unseen.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { creeazaFakeGitHub } from './testing/fake-github.js'

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

const { repoWrite, repoOpenPR, repoMergePR } = await import('./services/github.js')
const { runRunbook } = await import('./services/runbooks.js')

const j = (s: string): Record<string, unknown> => JSON.parse(s) as Record<string, unknown>
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64')

let gh: ReturnType<typeof creeazaFakeGitHub>

beforeEach(() => {
  kv.clear()
  gh = creeazaFakeGitHub()
  process.env.GITHUB_TOKEN = 'token-de-test'
  vi.spyOn(globalThis, 'fetch').mockImplementation(gh.fetch as typeof fetch)
})
afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.GITHUB_TOKEN
})

describe('autonomie E2E — Kelion scrie cod pe o ramură nouă', () => {
  it('creează ramura DIN VÂRFUL lui master și pune conținutul base64', async () => {
    const r = j(await repoWrite('kelion/fix-microfon', 'backend/src/x.ts', 'const a = 1\n', 'fix'))
    expect(r.ok).toBe(true)
    expect(r.branch).toBe('kelion/fix-microfon')

    // The branch starts exactly from the commit master is on NOW.
    const creare = gh.cereri.find((c) => c.path === '/git/refs' && c.method === 'POST')!
    expect(creare.body).toEqual({ ref: 'refs/heads/kelion/fix-microfon', sha: 'a'.repeat(40) })

    // The file leaves encoded, on its branch — not on master.
    const scriere = gh.cereri.find((c) => c.method === 'PUT' && c.path.startsWith('/contents/'))!
    const corp = scriere.body as Record<string, string>
    expect(corp.branch).toBe('kelion/fix-microfon')
    expect(corp.content).toBe(b64('const a = 1\n'))
    expect(Buffer.from(corp.content, 'base64').toString('utf8')).toBe('const a = 1\n')
    expect(gh.fisiere.get('kelion/fix-microfon:backend/src/x.ts')).toBeTruthy()
  })

  it('a doua scriere pe același fișier trimite sha-ul curent (altfel GitHub dă 409)', async () => {
    await repoWrite('kelion/fix', 'a.ts', 'v1', 'primul')
    const r = j(await repoWrite('kelion/fix', 'a.ts', 'v2', 'al doilea'))
    expect(r.ok).toBe(true)
    const scrieri = gh.cereri.filter((c) => c.method === 'PUT' && c.path.startsWith('/contents/'))
    expect(scrieri).toHaveLength(2)
    expect((scrieri[0].body as Record<string, unknown>).sha).toBeUndefined() // new file
    expect((scrieri[1].body as Record<string, unknown>).sha).toBe('blob1') // overwrite
    expect(Buffer.from(gh.fisiere.get('kelion/fix:a.ts')!.continut, 'base64').toString()).toBe('v2')
  })

  it('refolosește ramura dacă există deja (nu crapă la a doua cerere)', async () => {
    await repoWrite('kelion/fix', 'a.ts', 'v1', 'm')
    await repoWrite('kelion/fix', 'b.ts', 'v1', 'm')
    const creari = gh.cereri.filter((c) => c.path === '/git/refs' && c.method === 'POST')
    expect(creari).toHaveLength(1) // a single branch creation
  })

  it('numele cu diacritice se REPARĂ, nu se respinge (incidentul din 25 iul)', async () => {
    const r = j(await repoWrite('kelion/reparație urgentă', 'a.ts', 'x', 'm'))
    expect(r.ok).toBe(true)
    expect(String(r.branch)).toMatch(/^[A-Za-z0-9._/-]+$/)
    expect(String(r.branch)).not.toMatch(/\s/)
  })
})

describe('autonomie E2E — deschide PR spre master', () => {
  it('PR-ul are baza master și capul pe ramura scrisă', async () => {
    await repoWrite('kelion/fix', 'a.ts', 'x', 'm')
    const r = j(await repoOpenPR('kelion/fix', 'Repar microfonul', 'descriere'))
    expect(r.ok).toBe(true)
    expect(r.pr).toBe(100)

    const cerere = gh.cereri.find((c) => c.path === '/pulls' && c.method === 'POST')!
    const corp = cerere.body as Record<string, string>
    expect(corp.base).toBe('master')
    expect(corp.head).toBe('kelion/fix')
    expect(corp.title).toBe('Repar microfonul')
    expect(corp.body).toContain('Kelion') // you can see who opened it
  })

  it('un PR pe o ramură inexistentă raportează eroarea, nu tace', async () => {
    const r = j(await repoOpenPR('kelion/nimic', 't', 'b'))
    expect(String(r.error)).toMatch(/^pr_failed_/)
  })
})

describe('autonomie E2E — merge-ul (pasul care PUBLICĂ)', () => {
  const pregatestePr = async (): Promise<number> => {
    await repoWrite('kelion/fix', 'a.ts', 'x', 'm')
    return Number(j(await repoOpenPR('kelion/fix', 'Repar microfonul', '')).pr)
  }

  it('ÎNAINTE de merge salvează un punct de recuperare (plasa de siguranță)', async () => {
    const nr = await pregatestePr()
    const r = j(await repoMergePR(nr))
    expect(r.ok).toBe(true)
    expect(r.merged).toBe(true)

    // The recovery tag exists AND was created BEFORE the merge.
    expect(gh.taguri).toHaveLength(1)
    expect(gh.taguri[0]).toMatch(/^backup-\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{7}$/)
    expect(String(r.checkpoint)).toBe(gh.taguri[0])
    const iTag = gh.cereri.findIndex((c) => c.path === '/git/tags')
    const iMerge = gh.cereri.findIndex((c) => c.path.endsWith('/merge'))
    expect(iTag).toBeGreaterThanOrEqual(0)
    expect(iTag).toBeLessThan(iMerge)

    // The checkpoint's note says what comes next — otherwise it's a blind save.
    const nota = String((gh.cereri.find((c) => c.path === '/git/tags')!.body as Record<string, string>).message)
    expect(nota).toContain(`PR #${nr}`)
    expect(nota).toContain('Repar microfonul')
  })

  it('merge-ul e SQUASH, iar master ajunge la commitul nou (de aici pornește publicarea)', async () => {
    const nr = await pregatestePr()
    const r = j(await repoMergePR(nr))
    const cerere = gh.cereri.find((c) => c.path === `/pulls/${nr}/merge`)!
    expect(cerere.method).toBe('PUT')
    expect(cerere.body).toEqual({ merge_method: 'squash' })
    expect(gh.refs.get('heads/master')).toBe(`merge${nr}`.padEnd(40, '0'))
    expect(String(r.sha)).toBe(`merge${nr}`.slice(0, 7))
    expect(String(r.hint)).toContain('deploy')
  })

  it('NU așteaptă după verificarea de build — o raportează doar informativ', async () => {
    gh.rulari = [{ name: 'pr-verify', status: 'in_progress', conclusion: null }]
    const nr = await pregatestePr()
    const r = j(await repoMergePR(nr))
    expect(r.merged).toBe(true) // the merge HAPPENED even though the check was still running
    expect(r.verify).toBe('in_progress')
  })

  it('două publicări picate la rând → AVERTISMENT de buclă, nu blocare', async () => {
    const nr = await pregatestePr()
    gh.rulari = [{ conclusion: 'failure' }, { conclusion: 'failure' }]
    const r = j(await repoMergePR(nr))
    expect(r.merged).toBe(true)
    expect(String(r.warning)).toContain('BUCLĂ')
    expect(String(r.warning)).toContain('schimbă abordarea')
  })

  it('un număr de PR inventat e respins ÎNAINTE de orice atingere a rețelei', async () => {
    expect(j(await repoMergePR(0)).error).toBe('invalid_pr_number')
    expect(j(await repoMergePR(-3)).error).toBe('invalid_pr_number')
    expect(j(await repoMergePR(1.5)).error).toBe('invalid_pr_number')
    expect(gh.cereri).toHaveLength(0)
  })

  it('dacă merge-ul pică, spune de ce — și NU pretinde că a publicat', async () => {
    const nr = await pregatestePr()
    await repoMergePR(nr)
    const r = j(await repoMergePR(nr)) // already merged
    expect(r.ok).toBeUndefined()
    expect(String(r.error)).toMatch(/^merge_failed_/)
  })
})

describe('autonomie E2E — operațiuni pe server (runbook)', () => {
  it('pornește EXACT workflow-ul cerut, pe master', async () => {
    const r = j(await runRunbook('diagnostic'))
    expect(r.ok).toBe(true)
    expect(gh.dispatches).toHaveLength(1)
    expect(gh.dispatches[0].ref).toBe('master')
    expect(gh.dispatches[0].workflow).toMatch(/\.yml$/)
    expect(String(r.watch)).toContain('actions/workflows/')
  })

  it('LEGEA din 16 aug: comanda veche de pauză nu mai oprește nimic — răspunde cu legea, fără rețea', async () => {
    gh.cereri.length = 0
    const r = j(await runRunbook('pauza-autonomie'))
    expect(r.paused).toBe(false)
    expect(String(r.hint)).toContain('LEGEA din 16 aug')
    expect(gh.cereri).toHaveLength(0) // comanda-lege nu atinge rețeaua
  })
})

describe('autonomie E2E — lanțul COMPLET, dintr-o suflare', () => {
  it('cerere → cod → PR → checkpoint → merge → master mutat', async () => {
    // Exactly what Kelion does when you ask it "fix X" and it's allowed to work.
    const scris = j(await repoWrite('kelion/lant-complet', 'backend/src/nou.ts', 'export const ok = true\n', 'Kelion: adaug modulul'))
    expect(scris.ok).toBe(true)

    const pr = j(await repoOpenPR('kelion/lant-complet', 'Kelion: modul nou', 'de la cererea ta'))
    expect(pr.ok).toBe(true)

    const merge = j(await repoMergePR(Number(pr.pr)))
    expect(merge.merged).toBe(true)

    // The final proof: master moved, so the deploy has somewhere to start
    // from; a recovery point exists at the BEFORE state; and nothing was ever
    // written directly on master.
    expect(gh.refs.get('heads/master')).not.toBe('a'.repeat(40))
    expect(gh.taguri).toHaveLength(1)
    const scrieriPeMaster = gh.cereri.filter(
      (c) => c.method === 'PUT' && (c.body as Record<string, string> | undefined)?.branch === 'master',
    )
    expect(scrieriPeMaster).toHaveLength(0)
  })
})
