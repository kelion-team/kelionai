import { promises as fs } from 'node:fs'
import path from 'node:path'

// ── ACCES INTEGRAL LA CODUL SURSĂ (Adrian, 24 iul: „Kelion trebuie să aibă
// acces la codul sursă integral cu full acces"; 25 iul: „full acces la TOATE
// sursele soft") ─────────────────────────────────────────────────────────────
// Imaginea Docker COPIAZĂ de pe 25 iul ÎNTREG repo-ul în /app (backend/,
// frontend/, deploy/, .github/, docs — vezi `COPY . .` din Dockerfile), deci
// Kelion își poate CITI tot softul în producție. Unelte read-only, doar pentru
// admin: list (arbore), read (fișier cu numere de linie), search (grep).
// Scrierea/deploy-ul rămân pe fluxul git→PR→VPS — nu edităm containerul viu.

function sourceRoot(): string {
  // În container: cwd=/app (CMD node backend/dist/index.js). Local: cwd=backend.
  const cwd = process.cwd()
  const candidates = [cwd, path.resolve(cwd, '..')]
  for (const c of candidates) {
    try {
      // sincron ar fi mai simplu, dar evităm importuri în plus: verificarea
      // reală se face la prima operație (ENOENT → încearcă următorul)
      if (path.basename(c) !== 'backend') return c
    } catch {
      /* următorul */
    }
  }
  return cwd
}

const ROOT = sourceRoot()
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.yml', '.yaml', '.sh', '.txt', '.sql'])

/** Rezolvă o cale relativă SIGUR în interiorul rădăcinii (fără ../ evadări). */
function safePath(rel: string): string | null {
  const p = path.resolve(ROOT, rel.replace(/^\/+/, ''))
  if (!p.startsWith(ROOT)) return null
  return p
}

export async function listSource(rel = '.'): Promise<string> {
  const dir = safePath(rel)
  if (!dir) return JSON.stringify({ error: 'bad_path' })
  const out: string[] = []
  async function walk(d: string, depth: number): Promise<void> {
    if (depth > 3 || out.length > 400) return
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      const relp = path.relative(ROOT, p)
      if (e.isDirectory()) {
        out.push(`${relp}/`)
        await walk(p, depth + 1)
      } else {
        out.push(relp)
      }
    }
  }
  await walk(dir, 0)
  return out.join('\n') || '(gol)'
}

export async function readSource(rel: string): Promise<string> {
  const p = safePath(rel)
  if (!p) return JSON.stringify({ error: 'bad_path' })
  try {
    const raw = await fs.readFile(p, 'utf8')
    // DIETA DE COST (25 iul — Adrian: „chat imens", dovadă: o tură cu unelte a
    // costat $4.24): 60KB pline de cod intrau în FIECARE rundă ulterioară a
    // aceleiași ture (fiecare apel de unealtă retrimite tot ce s-a citit până
    // atunci). Coborât la 24KB — suficient pentru majoritatea fișierelor mici/
    // medii; pentru unul mare, search_source găsește linia exactă înainte.
    const clipped = raw.length > 24_000 ? raw.slice(0, 24_000) + '\n…(tăiat la 24KB — folosește search_source ca să găsești linia exactă întâi)' : raw
    // Numere de linie — ca referințele („fișier:linie") să fie precise.
    return clipped
      .split('\n')
      .map((l, i) => `${i + 1}\t${l}`)
      .join('\n')
  } catch (e) {
    return JSON.stringify({ error: `read_failed: ${String(e).slice(0, 120)}` })
  }
}

export async function searchSource(query: string): Promise<string> {
  const q = query.trim()
  if (!q) return JSON.stringify({ error: 'empty_query' })
  let re: RegExp
  try {
    re = new RegExp(q, 'i')
  } catch {
    re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
  const hits: string[] = []
  async function walk(d: string): Promise<void> {
    if (hits.length >= 80) return
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (hits.length >= 80) return
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) {
        await walk(p)
      } else if (TEXT_EXT.has(path.extname(e.name))) {
        try {
          const raw = await fs.readFile(p, 'utf8')
          if (raw.length > 2_000_000) continue
          const lines = raw.split('\n')
          for (let i = 0; i < lines.length && hits.length < 80; i++) {
            if (re.test(lines[i])) {
              hits.push(`${path.relative(ROOT, p)}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
            }
          }
        } catch {
          /* fișier necitibil — sărim */
        }
      }
    }
  }
  await walk(ROOT)
  return hits.join('\n') || '(niciun rezultat)'
}
