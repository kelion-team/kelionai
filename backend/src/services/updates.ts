import { promises as fs } from 'node:fs'
import path from 'node:path'

// ── CANALUL DE UPDATE AL LUI KELION (Adrian, 25 iul: „canal de informare a lui
// cu tot ce primește ca update") ─────────────────────────────────────────────
// deploy.sh scrie `deploy/last-updates.txt` (git log-ul recent) în contextul de
// build la FIECARE publicare, iar Dockerfile îl copiază în imagine. De aici
// Kelion află EXACT ce a primit la fiecare update — nu ghicește din memorie.
// Fișierul e imuabil pe viața containerului → cache pe prima citire, zero
// latență pe calea de chat.

let cached: string | null = null

/** Conținutul brut al canalului de update (gol dacă imaginea nu-l are încă). */
export async function updatesList(): Promise<string> {
  if (cached !== null) return cached
  // În container: cwd=/app → ./deploy/last-updates.txt. Local: cwd=backend → ../deploy.
  const roots = [process.cwd(), path.resolve(process.cwd(), '..')]
  for (const r of roots) {
    try {
      cached = await fs.readFile(path.join(r, 'deploy', 'last-updates.txt'), 'utf8')
      return cached
    } catch {
      /* următoarea rădăcină */
    }
  }
  cached = ''
  return cached
}

/** Primele rânduri (cele mai noi update-uri) — pentru system prompt, scurt. */
export async function latestUpdateSummary(maxLines = 5): Promise<string> {
  const raw = await updatesList()
  if (!raw) return ''
  const lines = raw.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  return lines.slice(0, maxLines).join('\n')
}

/** Doar pentru teste: golește cache-ul. */
export function resetUpdatesCache(): void {
  cached = null
}
