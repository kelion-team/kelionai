// ── SISTEMUL INFORMAȚIONAL AL PR-URILOR + ARHIVAREA ORDINELOR MERGED (P7) ───
// (owner, 15 aug: „daca un pr este gata si este merged se arhiveaza si se
// scoate automat din lista; trebuie un sistem informational legat de creier cu
// toate datele din toate pr sa le poata accesa")
//
// MĂSURAT înainte: un ordin 'done' rămânea în coadă cu eticheta „în așteptare"
// și DUPĂ ce PR-ul lui fusese demult îmbinat (#301 la owner) — nimeni nu
// întreba GitHub-ul dacă merge-ul chiar s-a întâmplat. Iar creierul nu avea
// NICIO unealtă cu care să vadă PR-urile (stare, verdict, ramură) — „toate
// datele din toate PR-urile" erau invizibile pentru el.
//
// Aici: (1) citirea PR-urilor din sursa adevărată (GitHub, prin `gh` — singura
// poartă de fetch), cu regula #1 pe schelet: citire picată → { ok:false,
// motiv }, niciodată o listă goală prezentată drept „niciun PR"; (2) mătura
// care arhivează ordinele done al căror PR e ÎMBINAT — ies din listă singure,
// nu la timerul de o zi.

import { gh, ghToken } from './githubApi.js'
import { listBuildJobs, arhiveazaBuildJob } from '../db.js'

export interface RandPR {
  numar: number
  titlu: string
  ramura: string
  stare: 'open' | 'closed'
  merged: boolean
  sha: string
  url: string
  creat: string
  actualizat: string
}

interface PrBrut {
  number: number
  title: string
  state: 'open' | 'closed'
  merged_at: string | null
  html_url: string
  created_at: string
  updated_at: string
  head?: { ref?: string; sha?: string }
}

/** Toate datele PR-urilor, din sursa adevărată. `stare`: open | closed | all. */
export async function listeazaPRuri(
  stare: 'open' | 'closed' | 'all' = 'all',
  cate = 30,
): Promise<{ ok: true; pruri: RandPR[] } | { ok: false; motiv: string }> {
  if (!ghToken()) return { ok: false, motiv: 'GITHUB_TOKEN lipsește — nu pot citi PR-urile' }
  try {
    const r = await gh(`/pulls?state=${stare}&sort=updated&direction=desc&per_page=${Math.min(100, Math.max(1, cate))}`)
    if (!r.ok) return { ok: false, motiv: `GitHub a răspuns ${r.status} la lista de PR-uri` }
    const brute = (await r.json()) as PrBrut[]
    return {
      ok: true,
      pruri: brute.map((p) => ({
        numar: p.number,
        titlu: p.title,
        ramura: p.head?.ref ?? '',
        stare: p.state,
        merged: Boolean(p.merged_at),
        sha: (p.head?.sha ?? '').slice(0, 12),
        url: p.html_url,
        creat: p.created_at,
        actualizat: p.updated_at,
      })),
    }
  } catch (e) {
    return { ok: false, motiv: `nu pot citi PR-urile: ${String((e as Error)?.message ?? e).slice(0, 120)}` }
  }
}

/** PR-ul e ÎMBINAT? null = nu pot verifica (nu inventăm nici da, nici nu). */
export async function esteMerged(numar: number): Promise<boolean | null> {
  if (!ghToken() || !Number.isInteger(numar) || numar <= 0) return null
  try {
    // GET /pulls/N/merge: 204 = merged, 404 = nu — răspuns binar, fără corp.
    const r = await gh(`/pulls/${numar}/merge`)
    if (r.status === 204) return true
    if (r.status === 404) return false
    return null
  } catch {
    return null
  }
}

const NUMAR_PR_RE = /\/pull\/(\d+)/

/** MĂTURA: ordinele 'done' cu PR ÎMBINAT se arhivează și ies din listă —
 *  ordinul ownerului, nu timerul de o zi. Întoarce câte a arhivat (măsurat). */
export async function arhiveazaOrdineleMergeuite(): Promise<number> {
  const jobs = (await listBuildJobs(200).catch(() => null)) ?? []
  const candidate = jobs.filter((j) => j.status === 'done' && j.prUrl && NUMAR_PR_RE.test(String(j.prUrl))).slice(0, 20)
  let arhivate = 0
  for (const j of candidate) {
    const numar = Number(NUMAR_PR_RE.exec(String(j.prUrl))?.[1] ?? 0)
    const merged = await esteMerged(numar)
    if (merged !== true) continue // false = încă așteaptă; null = nu știm — nu arhivăm pe ghicite
    if (await arhiveazaBuildJob(j.id)) arhivate++
  }
  return arhivate
}
