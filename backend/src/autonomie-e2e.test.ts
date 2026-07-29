// ── AUTONOMIA, LANȚUL ÎNTREG: cod → PR → checkpoint → merge → publicare ─────
//
// `autonomie.test.ts` verifică CÂND Kelion refuză să lucreze (pauză, token
// lipsă, ramură interzisă). Aici verificăm ce face când chiar LUCREAZĂ — adică
// exact drumul pe care codul ajunge în producție, fără mână de om.
//
// Nu ne mulțumim cu „a întors ok:true". Verificăm CERERILE REALE pe care le
// trimite: ramura se face din vârful lui master, conținutul pleacă base64, PR-ul
// are baza master, ÎNAINTE de merge se salvează un punct de recuperare, merge-ul
// e squash, iar master ajunge la commitul nou (de unde pornește publicarea).
// GitHub-ul e cel din `testing/fake-github.ts`: o rută necunoscută întoarce 599,
// deci nimic nu poate trece nevăzut.
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

    // Ramura pornește exact de la commitul pe care e master ACUM.
    const creare = gh.cereri.find((c) => c.path === '/git/refs' && c.method === 'POST')!
    expect(creare.body).toEqual({ ref: 'refs/heads/kelion/fix-microfon', sha: 'a'.repeat(40) })

    // Fișierul pleacă codificat, pe ramura lui — nu pe master.
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
    expect((scrieri[0].body as Record<string, unknown>).sha).toBeUndefined() // fișier nou
    expect((scrieri[1].body as Record<string, unknown>).sha).toBe('blob1') // suprascriere
    expect(Buffer.from(gh.fisiere.get('kelion/fix:a.ts')!.continut, 'base64').toString()).toBe('v2')
  })

  it('refolosește ramura dacă există deja (nu crapă la a doua cerere)', async () => {
    await repoWrite('kelion/fix', 'a.ts', 'v1', 'm')
    await repoWrite('kelion/fix', 'b.ts', 'v1', 'm')
    const creari = gh.cereri.filter((c) => c.path === '/git/refs' && c.method === 'POST')
    expect(creari).toHaveLength(1) // o singură creare de ramură
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
    expect(corp.body).toContain('Kelion') // se vede cine l-a deschis
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

    // Tag-ul de recuperare există ȘI a fost creat ÎNAINTE de merge.
    expect(gh.taguri).toHaveLength(1)
    expect(gh.taguri[0]).toMatch(/^backup-\d{4}-\d{2}-\d{2}-\d{4}-[0-9a-f]{7}$/)
    expect(String(r.checkpoint)).toBe(gh.taguri[0])
    const iTag = gh.cereri.findIndex((c) => c.path === '/git/tags')
    const iMerge = gh.cereri.findIndex((c) => c.path.endsWith('/merge'))
    expect(iTag).toBeGreaterThanOrEqual(0)
    expect(iTag).toBeLessThan(iMerge)

    // Nota checkpointului spune ce urmează — altfel e o salvare oarbă.
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
    expect(r.merged).toBe(true) // merge-ul S-A FĂCUT deși verificarea rula încă
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
    const r = j(await repoMergePR(nr)) // deja făcut merge
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

  it('cu pauza pornită NU atinge rețeaua deloc', async () => {
    await runRunbook('pauza-autonomie')
    gh.cereri.length = 0
    expect(j(await runRunbook('diagnostic')).error).toBe('paused_by_owner')
    expect(gh.cereri).toHaveLength(0)
  })
})

describe('autonomie E2E — lanțul COMPLET, dintr-o suflare', () => {
  it('cerere → cod → PR → checkpoint → merge → master mutat', async () => {
    // Exact ce face Kelion când îi ceri „repară X" și are voie să lucreze.
    const scris = j(await repoWrite('kelion/lant-complet', 'backend/src/nou.ts', 'export const ok = true\n', 'Kelion: adaug modulul'))
    expect(scris.ok).toBe(true)

    const pr = j(await repoOpenPR('kelion/lant-complet', 'Kelion: modul nou', 'de la cererea ta'))
    expect(pr.ok).toBe(true)

    const merge = j(await repoMergePR(Number(pr.pr)))
    expect(merge.merged).toBe(true)

    // Dovada de capăt: master s-a mutat, deci publicarea are de unde porni;
    // există un punct de recuperare la starea de DINAINTE; și nimic nu s-a
    // scris vreodată direct pe master.
    expect(gh.refs.get('heads/master')).not.toBe('a'.repeat(40))
    expect(gh.taguri).toHaveLength(1)
    const scrieriPeMaster = gh.cereri.filter(
      (c) => c.method === 'PUT' && (c.body as Record<string, string> | undefined)?.branch === 'master',
    )
    expect(scrieriPeMaster).toHaveLength(0)
  })
})
