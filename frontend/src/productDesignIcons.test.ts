import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { extname, join } from 'node:path'

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return ['.ts', '.tsx'].includes(extname(path)) && !path.endsWith('.test.ts') ? [path] : []
  })
}

describe('visible icons', () => {
  it('does not embed handcrafted SVG or style elements in React source', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src'))
      .filter((path) => /<(?:svg|style)(?:\s|>)/i.test(readFileSync(path, 'utf8')))
    expect(offenders).toEqual([])
  })
})
