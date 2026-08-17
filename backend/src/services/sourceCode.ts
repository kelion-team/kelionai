import { promises as fs } from 'node:fs'
import path from 'node:path'

// ── FULL SOURCE CODE ACCESS (Adrian, Jul 24: "Kelion must have access to the
// full source code with full access"; Jul 25: "full access to ALL the software
// sources") ──────────────────────────────────────────────────────────────────
// Since Jul 25 the Docker image COPIES the WHOLE repo into /app (backend/,
// frontend/, deploy/, .github/, docs — see `COPY . .` in the Dockerfile), so
// Kelion can READ its entire software in production. Read-only tools, admin
// only: list (tree), read (file with line numbers), search (grep).
// Writing/deploy stays on the git→PR→VPS flow — we don't edit the live container.

function sourceRoot(): string {
  // In the container: cwd=/app (CMD node backend/dist/index.js). Local: cwd=backend.
  const cwd = process.cwd()
  const candidates = [cwd, path.resolve(cwd, '..')]
  for (const c of candidates) {
    try {
      // sync would be simpler, but we avoid extra imports: the real check
      // happens on the first operation (ENOENT → try the next one)
      if (path.basename(c) !== 'backend') return c
    } catch {
      /* the next one */
    }
  }
  return cwd
}

const ROOT = sourceRoot()
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage'])
const TEXT_EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.css', '.html', '.yml', '.yaml', '.sh', '.txt', '.sql'])

/** Resolves a relative path SAFELY inside the root (no ../ escapes).
 *  Security audit Jul 27: startsWith(ROOT) let the root's siblings through
 *  (ROOT=/app accepted /appdata) — correct containment is via path.relative. */
function safePath(rel: string): string | null {
  const p = path.resolve(ROOT, rel.replace(/^\/+/, ''))
  const r = path.relative(ROOT, p)
  if (r.startsWith('..') || path.isAbsolute(r)) return null
  return p
}

// SECRETS NEVER LEAVE TO THE MODEL (audit Jul 27): read_source could return
// .env/keys/certificates — which then went VERBATIM to the external model on
// the next round. Source code yes; secrets never.
const SECRET_FILE_RE = /(^|\/)\.env[^/]*$|\.(pem|key|p12|pfx|crt)$|(^|\/)(id_rsa|id_ed25519)[^/]*$/i

/** path.relative with FORWARD slashes on any OS — on Windows it returns
 *  backslashes, and the secret guard / tool consumers expect `/`. On Linux
 *  this is a no-op. */
function relSlash(p: string): string {
  return path.relative(ROOT, p).split(path.sep).join('/')
}

export async function listSource(rel = '.'): Promise<string> {
  const dir = safePath(rel)
  if (!dir) return JSON.stringify({ error: 'bad_path' })
  const out: string[] = []
  let truncated = false
  async function walk(d: string, depth: number): Promise<void> {
    // FULL TREE (Autonomy stage 2, Jul 29 — "Kelion must see any file it
    // needs"): the depth was 3 and it SKIPPED all dot-dirs → the real code in
    // `.github/workflows/` (the CI) and the deep files were INVISIBLE. Now we
    // go deep (8) and no longer skip the dots — only the IGNORE_DIRS noise
    // (node_modules/.git/dist...). Secrets stay blocked at READ time.
    if (depth > 8 || out.length > 2000) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await fs.readdir(d, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (IGNORE_DIRS.has(e.name)) continue
      const p = path.join(d, e.name)
      const relp = relSlash(p)
      if (e.isDirectory()) {
        out.push(`${relp}/`)
        await walk(p, depth + 1)
      } else {
        out.push(relp)
      }
    }
  }
  await walk(dir, 0)
  const body = out.join('\n') || '(gol)'
  return truncated ? `${body}\n…(arbore tăiat — listează un subdirector anume pentru restul)` : body
}

export async function readSource(rel: string, fromLine = 1): Promise<string> {
  const p = safePath(rel)
  if (!p) return JSON.stringify({ error: 'bad_path' })
  if (SECRET_FILE_RE.test(relSlash(p))) return JSON.stringify({ error: 'fisier_secret', nota: 'Fișierele de secrete (.env, chei, certificate) nu se citesc niciodată prin unealta asta.' })
  try {
    const raw = await fs.readFile(p, 'utf8')
    const lines = raw.split('\n')
    // FULL READ THROUGH PAGINATION (Autonomy stage 2, Jul 29 — "Kelion must
    // see any file"): before, it truncated at 24KB from the START, so a big
    // file (chat.ts ~2500 lines) couldn't be read whole. Now it reads from
    // `fromLine`, in ~24KB pages, with a clear hint on how to continue — the
    // file can be walked IN FULL without inflating a single round (the Jul 25
    // cost diet stays: every page ≤24KB).
    const BUDGET = 24_000
    const start = Math.max(1, Math.floor(Number(fromLine)) || 1)
    const out: string[] = []
    let bytes = 0
    let i = start - 1 // 0-based index
    for (; i < lines.length; i++) {
      const numbered = `${i + 1}\t${lines[i]}`
      if (out.length > 0 && bytes + numbered.length > BUDGET) break
      out.push(numbered)
      bytes += numbered.length + 1
    }
    const more = i < lines.length
    const foot = more
      ? `\n…(fișier de ${lines.length} linii; citite până la ${i}. Continuă: read_source(path, from_line=${i + 1}).)`
      : ''
    return (out.join('\n') || '(gol)') + foot
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
              hits.push(`${relSlash(p)}:${i + 1}: ${lines[i].trim().slice(0, 160)}`)
            }
          }
        } catch {
          /* unreadable file — skip */
        }
      }
    }
  }
  await walk(ROOT)
  return hits.join('\n') || '(niciun rezultat)'
}
