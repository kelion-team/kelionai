// ── JULES — agentul asincron OFICIAL Google, prin API (3 aug 2026) ──────────
//
// Adrian: „revino la Jules" + „scrie procedura și rulează". Interfața Jules nu
// se randează în browserul fără ecran (măsurat de 3 ori), dar pagina însăși
// ne-a arătat ușa corectă: API-ul oficial (jules.google/docs/api). Cheia vine
// din GitHub Secrets → vps-keys (opțiunea `jules`) → kelionai.env — NICIODATĂ
// prin chat.
//
// Ce poate Kelion cu ea: să vadă repo-urile legate la Jules, să DEA o sarcină
// (Jules lucrează în VM-ul lui Google și deschide PR), și să urmărească
// progresul. Merge-ul rămâne al ownerului, ca la constructor.
//
// Onestitate (regula #1): orice răspuns ne-2xx sau corp ne-JSON se întoarce ca
// eroare NUMITĂ (http_NNN + primele caractere), niciodată listă goală falsă.

import { config } from '../config.js'

const BAZA = 'https://jules.googleapis.com/v1alpha'

async function julesFetch(cale: string, init?: RequestInit): Promise<{ ok: true; j: unknown } | { ok: false; error: string }> {
  if (!config.julesKey) return { ok: false, error: 'jules_neconfigurat (JULES_API_KEY lipsă — vps-keys → jules)' }
  let r: Response
  try {
    r = await fetch(`${BAZA}/${cale}`, {
      ...init,
      headers: {
        'X-Goog-Api-Key': config.julesKey,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (e) {
    return { ok: false, error: `rețea: ${e instanceof Error ? e.message : String(e)}` }
  }
  const text = await r.text().catch(() => '')
  if (!r.ok) return { ok: false, error: `http_${r.status}: ${text.slice(0, 200)}` }
  try {
    return { ok: true, j: text ? JSON.parse(text) : {} }
  } catch {
    return { ok: false, error: `corp ne-JSON la http_${r.status}` }
  }
}

/** Repo-urile legate la Jules (sursele). Ownerul le leagă o dată în interfața
 *  Jules („Connect to GitHub"); de aici Kelion doar le vede și le folosește. */
/** Liveness pentru becul de credit (owner, 13 aug: „culorile la fel pt toți AI,
 *  nu gri"): cheia Jules e pusă ȘI API-ul răspunde? Verde = configurat + răspunde;
 *  roșu = lipsă cheie sau API-ul pică. Ping ieftin (GET surse, fără cost). */
export async function julesServeste(): Promise<{ ok: boolean; detaliu: string }> {
  if (!config.julesKey) return { ok: false, detaliu: 'cheia Jules nu e pusă (JULES_API_KEY)' }
  const r = await julesFetch('sources')
  return r.ok ? { ok: true, detaliu: 'API-ul Jules răspunde (surse listate)' } : { ok: false, detaliu: r.error }
}

export async function julesSurse(): Promise<string> {
  const r = await julesFetch('sources')
  if (!r.ok) return JSON.stringify({ error: r.error })
  const j = r.j as { sources?: { name?: string; githubRepo?: { owner?: string; repo?: string } }[] }
  const surse = (j.sources ?? []).map((s) => ({
    sursa: s.name ?? '',
    repo: s.githubRepo ? `${s.githubRepo.owner ?? '?'}/${s.githubRepo.repo ?? '?'}` : '(necunoscut)',
  }))
  return JSON.stringify({ total: surse.length, surse })
}

/** Dă o sarcină lui Jules pe un repo legat. `sursa` = numele exact din
 *  julesSurse (ex: sources/github/kelion-team/kelionai); `ramura` implicit
 *  master. Întoarce sesiunea creată (id + stare) — progresul se urmărește cu
 *  julesStare. */
export async function julesSarcina(prompt: string, sursa: string, ramura = 'master'): Promise<string> {
  const p = prompt.trim()
  if (p.length < 8) return JSON.stringify({ error: 'sarcina_prea_scurta' })
  if (!sursa.trim()) return JSON.stringify({ error: 'sursa_lipsa (cheamă întâi jules_repos)' })
  const r = await julesFetch('sessions', {
    method: 'POST',
    body: JSON.stringify({
      prompt: p,
      sourceContext: { source: sursa.trim(), githubRepoContext: { startingBranch: ramura } },
      title: p.slice(0, 60),
    }),
  })
  if (!r.ok) return JSON.stringify({ error: r.error })
  const j = r.j as { name?: string; state?: string; url?: string }
  return JSON.stringify({ creat: true, sesiune: j.name ?? '', stare: j.state ?? '', url: j.url ?? '' })
}

/** Starea unei sesiuni Jules + ultimele activități (ce face acum, PR-ul când
 *  apare). `sesiune` = numele din julesSarcina (sessions/...). */
export async function julesStare(sesiune: string): Promise<string> {
  const nume = sesiune.trim().replace(/^\/+/, '')
  if (!nume) return JSON.stringify({ error: 'sesiune_lipsa' })
  const [s, a] = await Promise.all([julesFetch(nume), julesFetch(`${nume}/activities?pageSize=10`)])
  if (!s.ok) return JSON.stringify({ error: s.error })
  const sj = s.j as { state?: string; title?: string; url?: string; outputs?: unknown[] }
  const activ = a.ok
    ? ((a.j as { activities?: { description?: string; createTime?: string }[] }).activities ?? [])
        .map((x) => ({ cand: x.createTime ?? '', ce: (x.description ?? '').slice(0, 160) }))
    : []
  return JSON.stringify({
    stare: sj.state ?? '(necunoscută)',
    titlu: sj.title ?? '',
    url: sj.url ?? '',
    iesiri: sj.outputs ?? [],
    activitati: activ,
    ...(a.ok ? {} : { activitati_eroare: a.error }),
  })
}
