// ── P7: SISTEMUL INFORMAȚIONAL AL PR-URILOR + MĂTURA ORDINELOR MERGED ───────
// (owner, 15 aug: „daca un pr este gata si este merged se arhiveaza si se
// scoate automat din lista; trebuie un sistem informational legat de creier cu
// toate datele din toate pr sa le poata accesa" — plus minciuna văzută la
// #301: ordin 'done' etichetat „în așteptare" cu PR-ul demult îmbinat.)
import { describe, expect, it, vi, beforeEach } from 'vitest'

// GitHub-ul e mockuit: testele hotărăsc ce răspunde fiecare cale.
let raspunsuri: Record<string, { status: number; corp?: unknown }> = {}
let areToken = true
vi.mock('./services/githubApi.js', () => ({
  ghToken: () => (areToken ? 'tok' : ''),
  gh: async (cale: string) => {
    const r = raspunsuri[cale]
    if (!r) throw new Error(`gh neasteptat: ${cale}`)
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corp } as Response
  },
}))

// Coada de ordine e mockuită: rândurile le pun testele.
let jobs: { id: number; status: string; prUrl: string | null }[] = []
const arhivate: number[] = []
vi.mock('./db.js', () => ({
  listBuildJobs: async () => jobs,
  arhiveazaBuildJob: async (id: number) => {
    arhivate.push(id)
    return true
  },
}))

const { listeazaPRuri, esteMerged, arhiveazaOrdineleMergeuite } = await import('./services/prInfo.js')

beforeEach(() => {
  raspunsuri = {}
  areToken = true
  jobs = []
  arhivate.length = 0
})

describe('pr_lista: toate datele, din sursa adevărată', () => {
  it('citește PR-urile cu stare/merged/ramură/sha', async () => {
    raspunsuri['/pulls?state=all&sort=updated&direction=desc&per_page=30'] = {
      status: 200,
      corp: [
        {
          number: 301, title: 'Reparația vocii', state: 'closed', merged_at: '2026-08-15T07:42:00Z',
          html_url: 'https://github.com/kelion-team/kelionai/pull/301',
          created_at: '2026-08-15T06:00:00Z', updated_at: '2026-08-15T07:42:00Z',
          head: { ref: 'kelion/job-301', sha: 'abcdef1234567890' },
        },
      ],
    }
    const v = await listeazaPRuri('all')
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.pruri[0]).toMatchObject({ numar: 301, merged: true, ramura: 'kelion/job-301', sha: 'abcdef123456' })
    }
  })

  it('citirea picată se SPUNE, nu se maschează în listă goală (regula #1)', async () => {
    raspunsuri['/pulls?state=all&sort=updated&direction=desc&per_page=30'] = { status: 500 }
    const v = await listeazaPRuri('all')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.motiv).toContain('500')
    areToken = false
    const faraToken = await listeazaPRuri('all')
    expect(faraToken.ok).toBe(false)
  })
})

describe('mătura: ordinul done cu PR ÎMBINAT iese din listă', () => {
  it('arhivează DOAR ce e confirmat merged (204); 404 = încă așteaptă; eroare = nu ghicim', async () => {
    jobs = [
      { id: 301, status: 'done', prUrl: 'https://github.com/kelion-team/kelionai/pull/301' },
      { id: 305, status: 'done', prUrl: 'https://github.com/kelion-team/kelionai/pull/305' },
      { id: 306, status: 'queued', prUrl: null },
    ]
    raspunsuri['/pulls/301/merge'] = { status: 204 } // îmbinat → se arhivează
    raspunsuri['/pulls/305/merge'] = { status: 404 } // neîmbinat → rămâne („în așteptare" e atunci ADEVĂRAT)
    const n = await arhiveazaOrdineleMergeuite()
    expect(n).toBe(1)
    expect(arhivate).toEqual([301])
  })

  it('esteMerged: 204→true, 404→false, altceva→null (nu pot verifica)', async () => {
    raspunsuri['/pulls/7/merge'] = { status: 204 }
    raspunsuri['/pulls/8/merge'] = { status: 404 }
    raspunsuri['/pulls/9/merge'] = { status: 500 }
    expect(await esteMerged(7)).toBe(true)
    expect(await esteMerged(8)).toBe(false)
    expect(await esteMerged(9)).toBe(null)
  })
})
