import { promises as fs } from 'node:fs'
import path from 'node:path'

// ── KELION'S UPDATE CHANNEL (Adrian, 25 Jul: "an information channel for
// him with everything he receives as an update") ────────────────────────────
// deploy.sh writes `deploy/last-updates.txt` (the recent git log) into the
// build context at EVERY publish, and the Dockerfile copies it into the
// image. From here Kelion finds out EXACTLY what he received with each
// update — he doesn't guess from memory. The file is immutable for the
// container's life → cached on first read, zero latency on the chat path.

let cached: string | null = null

/** The raw content of the update channel (empty if the image doesn't have it yet). */
export async function updatesList(): Promise<string> {
  if (cached !== null) return cached
  // In the container: cwd=/app → ./deploy/last-updates.txt. Locally: cwd=backend → ../deploy.
  const roots = [process.cwd(), path.resolve(process.cwd(), '..')]
  for (const r of roots) {
    try {
      cached = await fs.readFile(path.join(r, 'deploy', 'last-updates.txt'), 'utf8')
      return cached
    } catch {
      /* the next root */
    }
  }
  cached = ''
  return cached
}

/** The first rows (the newest updates) — for the system prompt, short. */
export async function latestUpdateSummary(maxLines = 5): Promise<string> {
  const raw = await updatesList()
  if (!raw) return ''
  const lines = raw.split('\n').filter((l) => l.trim() && !l.startsWith('#'))
  return lines.slice(0, maxLines).join('\n')
}

