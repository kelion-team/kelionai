import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const src = dirname(fileURLToPath(import.meta.url))

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return productionFiles(full)
    return /\.test\.(?:ts|tsx)$/u.test(entry.name) ? [] : [full]
  })
}

describe('matricea frontend', () => {
  it('clasifică fiecare fișier de producție', () => {
    const matrix = readFileSync(join(src, '../../docs/FRONTEND-LIVE-TEST-MATRIX.md'), 'utf8')
    const missing = productionFiles(src)
      .map((file) => basename(file))
      .filter((name) => !matrix.includes(name))
    expect(missing).toEqual([])
  })
})
